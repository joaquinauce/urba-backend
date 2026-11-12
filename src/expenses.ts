import { BadRequestException, ConflictException, Controller, Get, Inject, Injectable, Param, Patch, Post, Body, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { DB } from './database.module.js';
import { JwtGuard, type AdminRequest } from './auth.js';
import { PersonJwtGuard, WorkAuthorizationService, type PersonRequest } from './people-auth.js';
import { PublicService } from './public.js';
import type { Work } from './database/entities.js';

const storageDir = () => resolve(process.env.PHOTO_STORAGE_DIR ?? './storage/photos');
const receiptUploadLimit = 25 * 1024 * 1024;
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

@Injectable()
export class ExpensesService {
  constructor(@Inject(DB) private readonly db: DataSource, private readonly authorization: WorkAuthorizationService) {}

  async types(administratorId: string, activeOnly = false) {
    await this.db.query(`INSERT INTO expense_types (id, administrator_id, name)
      SELECT md5($1::text || ':' || seed.name)::uuid, $1::uuid, seed.name
      FROM (VALUES ('Combustible Maquinaria'), ('Combustible Utilitario'), ('Comida'), ('Materiales Menores')) AS seed(name)
      WHERE NOT EXISTS (SELECT 1 FROM expense_types WHERE administrator_id = $1::uuid)
      ON CONFLICT DO NOTHING`, [administratorId]);
    return this.db.query('SELECT id, name, is_active AS "isActive" FROM expense_types WHERE administrator_id = $1 AND ($2::boolean = false OR is_active) ORDER BY name', [administratorId, activeOnly]);
  }

  async saveType(administratorId: string, body: { name?: unknown; isActive?: unknown }, id?: string) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) throw new BadRequestException('Ingresá un nombre de hasta 100 caracteres');
    if (id && !uuid(id)) throw new BadRequestException('Tipo inválido');
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') throw new BadRequestException('Estado inválido');
    try {
      const rows = id
        ? await this.db.query('UPDATE expense_types SET name = $3, is_active = COALESCE($4::boolean, is_active), updated_at = now() WHERE administrator_id = $1 AND id = $2 RETURNING id, name, is_active AS "isActive"', [administratorId, id, name, body.isActive ?? null])
        : await this.db.query('INSERT INTO expense_types (id, administrator_id, name, is_active) VALUES ($1, $2, $3, $4) RETURNING id, name, is_active AS "isActive"', [randomUUID(), administratorId, name, body.isActive ?? true]);
      if (!rows.length) throw new NotFoundException('Tipo no encontrado');
      return rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Ya existe un tipo con ese nombre');
      throw error;
    }
  }

  async setTypeActive(administratorId: string, id: string, active: unknown) {
    if (!uuid(id) || typeof active !== 'boolean') throw new BadRequestException('Estado inválido');
    const rows = await this.db.query('UPDATE expense_types SET is_active = $3, updated_at = now() WHERE administrator_id = $1 AND id = $2 RETURNING id, name, is_active AS "isActive"', [administratorId, id, active]);
    if (!rows.length) throw new NotFoundException('Tipo no encontrado');
    return rows[0];
  }

  async list(administratorId: string, filters: Record<string, string | undefined>) {
    const from = filters.from;
    const to = filters.to;
    if (!date(from) || !date(to) || from! > to!) throw new BadRequestException('Rango de fechas inválido');
    for (const key of ['workId', 'personId', 'typeId', 'foremanId']) if (filters[key] && !uuid(filters[key])) throw new BadRequestException('Filtro inválido');
    return this.db.query(`SELECT e.id, e.work_id AS "workId", w.name AS "workName", e.person_id AS "personId", e.foreman_id AS "foremanId", COALESCE(e.foreman_name_snapshot, p.full_name) AS "personName", e.expense_type_id AS "typeId", e.expense_type_name AS "typeName", e.amount_ars AS "amountArs", e.occurred_at AS "occurredAt", e.work_date AS "workDate"
      FROM expense_reports e JOIN works w ON w.id = e.work_id LEFT JOIN people p ON p.id = e.person_id
      WHERE e.administrator_id = $1 AND e.work_date BETWEEN $2::date AND $3::date
      AND ($4::uuid IS NULL OR e.work_id = $4) AND ($5::uuid IS NULL OR e.person_id = $5) AND ($6::uuid IS NULL OR e.expense_type_id = $6)
      AND ($7::uuid IS NULL OR e.foreman_id = $7 OR p.foreman_source_id = $7)
      ORDER BY e.work_date DESC, w.name, e.occurred_at DESC`, [administratorId, from, to, filters.workId || null, filters.personId || null, filters.typeId || null, filters.foremanId || null]);
  }

  async recent(request: PersonRequest, workId: string) {
    if (!uuid(workId)) throw new BadRequestException('Obra inválida');
    await this.authorization.authorize(request.actor, workId);
    return this.db.query(`SELECT id, expense_type_name AS "typeName", amount_ars AS "amountArs", occurred_at AS "occurredAt", work_date AS "workDate" FROM expense_reports WHERE administrator_id = $1 AND person_id = $2 AND work_id = $3 ORDER BY occurred_at DESC LIMIT 10`, [request.actor.administratorId, request.actor.id, workId]);
  }

  async recentLegacy(work: Work) {
    return this.db.query(`SELECT id, expense_type_name AS "typeName", amount_ars AS "amountArs", occurred_at AS "occurredAt", work_date AS "workDate" FROM expense_reports WHERE administrator_id = $1 AND foreman_id = $2 AND work_id = $3 ORDER BY occurred_at DESC LIMIT 10`, [work.administratorId, work.foremanId, work.id]);
  }

  async create(request: PersonRequest, workId: string, body: { amount?: unknown; typeId?: unknown; requestId?: unknown }, file?: Express.Multer.File) {
    if (!uuid(workId)) throw new BadRequestException('Obra inválida');
    const amount = this.validateInput(body, file);
    const work = await this.authorization.authorize(request.actor, workId, true);
    return this.save(work, { personId: request.actor.id }, body, file!, amount);
  }

  async createLegacy(work: Work & { foremanName: string }, body: { amount?: unknown; typeId?: unknown; requestId?: unknown }, file?: Express.Multer.File) {
    const amount = this.validateInput(body, file);
    return this.save(work, { foremanId: work.foremanId, foremanName: work.foremanName }, body, file!, amount);
  }

  private validateInput(body: { amount?: unknown; typeId?: unknown; requestId?: unknown }, file?: Express.Multer.File) {
    if (!uuid(body?.typeId) || !uuid(body?.requestId)) throw new BadRequestException('Datos del gasto inválidos');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99 || !/^\d+(\.\d{1,2})?$/.test(String(body.amount))) throw new BadRequestException('Ingresá un monto positivo con hasta dos decimales');
    if (!file?.buffer?.length || file.size > receiptUploadLimit) throw new BadRequestException('Adjuntá una fotografía de hasta 25 MB');
    return amount;
  }

  private async save(work: Work, identity: { personId?: string; foremanId?: string; foremanName?: string }, body: { amount?: unknown; typeId?: unknown; requestId?: unknown }, file: Express.Multer.File, amount: number) {
    if (work.status !== 'ACTIVA') throw new BadRequestException('La obra no está activa');
    const owner = work.administratorId;
    const identityParams = [owner, body.requestId, identity.personId ?? null, identity.foremanId ?? null];
    const existing = await this.db.query('SELECT id FROM expense_reports WHERE administrator_id = $1 AND request_id = $2 AND person_id IS NOT DISTINCT FROM $3::uuid AND foreman_id IS NOT DISTINCT FROM $4::uuid', identityParams);
    if (existing.length) return { id: existing[0].id, repeated: true };
    const types = await this.db.query('SELECT name FROM expense_types WHERE administrator_id = $1 AND id = $2 AND is_active', [owner, body.typeId]);
    if (!types.length) throw new BadRequestException('Seleccioná un tipo de gasto habilitado');
    let result: { data: Buffer; info: { width: number; height: number } };
    try {
      result = await sharp(file.buffer, { limitInputPixels: 30_000_000 }).rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    } catch { throw new BadRequestException('Formato de imagen inválido'); }
    const dir = storageDir();
    await mkdir(dir, { recursive: true });
    const key = `${randomUUID()}.webp`;
    await writeFile(join(dir, key), result.data, { flag: 'wx' });
    const id = randomUUID();
    try {
      const rows = await this.db.query(`INSERT INTO expense_reports (id, administrator_id, work_id, person_id, foreman_id, foreman_name_snapshot, expense_type_id, expense_type_name, amount_ars, work_date, receipt_storage_key, receipt_byte_size, receipt_width, receipt_height, request_id)
        SELECT $1, $2, w.id, $4, $5, $14, $6, $7, $8, (now() AT TIME ZONE w.time_zone)::date, $9, $10, $11, $12, $13
        FROM works w WHERE w.id = $3 AND w.administrator_id = $2 AND w.status = 'ACTIVA'
        AND (($4::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM work_assignments a WHERE a.administrator_id = $2 AND a.work_id = w.id AND a.person_id = $4 AND a.unassigned_at IS NULL AND a.role_code IN ('FOREMAN', 'SITE_MANAGER')))
          OR ($5::uuid IS NOT NULL AND w.foreman_id = $5 AND EXISTS (SELECT 1 FROM foremen f WHERE f.administrator_id = $2 AND f.id = $5 AND f.is_active)))
        AND EXISTS (SELECT 1 FROM expense_types t WHERE t.administrator_id = $2 AND t.id = $6 AND t.is_active)
        RETURNING id`, [id, owner, work.id, identity.personId ?? null, identity.foremanId ?? null, body.typeId, types[0].name, amount, key, result.data.length, result.info.width, result.info.height, body.requestId, identity.foremanName ?? null]);
      if (!rows.length) throw new BadRequestException('La asignación o el tipo de gasto ya no está activo');
      return { id };
    } catch (error) {
      await unlink(join(dir, key)).catch(() => {});
      if ((error as { code?: string }).code === '23505') {
        const prior = await this.db.query('SELECT id FROM expense_reports WHERE administrator_id = $1 AND request_id = $2 AND person_id IS NOT DISTINCT FROM $3::uuid AND foreman_id IS NOT DISTINCT FROM $4::uuid', identityParams);
        if (prior.length) return { id: prior[0].id, repeated: true };
      }
      throw error;
    }
  }

  async photo(administratorId: string, expenseId: string, personId?: string, foremanId?: string, workId?: string) {
    if (!uuid(expenseId)) throw new BadRequestException('Rendición inválida');
    const rows = await this.db.query('SELECT receipt_storage_key AS key FROM expense_reports WHERE administrator_id = $1 AND id = $2 AND ($3::uuid IS NULL OR person_id = $3) AND ($4::uuid IS NULL OR foreman_id = $4) AND ($5::uuid IS NULL OR work_id = $5)', [administratorId, expenseId, personId ?? null, foremanId ?? null, workId ?? null]);
    if (!rows.length) throw new NotFoundException('Comprobante no encontrado');
    const key = rows[0].key as string;
    if (!/^[0-9a-f-]{36}\.webp$/.test(key)) throw new BadRequestException('Comprobante inválido');
    return readFile(join(storageDir(), key));
  }

  async memberPhoto(request: PersonRequest, expenseId: string) {
    if (!uuid(expenseId)) throw new BadRequestException('Rendición inválida');
    const rows = await this.db.query(
      `SELECT e.work_id AS "workId" FROM expense_reports e
       JOIN works w ON w.id = e.work_id AND w.administrator_id = e.administrator_id
       WHERE e.id = $1 AND e.person_id = $2 AND e.administrator_id = $3 AND w.client_id = $4`,
      [expenseId, request.actor.id, request.actor.administratorId, request.actor.clientId],
    );
    if (!rows.length) throw new NotFoundException('Comprobante no encontrado');
    await this.authorization.authorize(request.actor, rows[0].workId);
    return this.photo(request.actor.administratorId, expenseId, request.actor.id, undefined, rows[0].workId);
  }
}

@UseGuards(JwtGuard)
@Controller('admin/expenses')
export class AdminExpensesController {
  constructor(private readonly expenses: ExpensesService) {}
  @Get('types') types(@Req() req: AdminRequest) { return this.expenses.types(req.administratorId); }
  @Post('types') createType(@Req() req: AdminRequest, @Body() body: { name?: unknown; isActive?: unknown }) { return this.expenses.saveType(req.administratorId, body); }
  @Patch('types/:id') editType(@Req() req: AdminRequest, @Param('id') id: string, @Body() body: { name?: unknown; isActive?: unknown }) { return this.expenses.saveType(req.administratorId, body, id); }
  @Patch('types/:id/active') active(@Req() req: AdminRequest, @Param('id') id: string, @Body() body: { isActive?: unknown }) { return this.expenses.setTypeActive(req.administratorId, id, body?.isActive); }
  @Get() list(@Req() req: AdminRequest, @Query() filters: Record<string, string | undefined>) { return this.expenses.list(req.administratorId, filters); }
  @Get(':id/receipt') async photo(@Req() req: AdminRequest, @Param('id') id: string, @Res() res: Response) { res.type('image/webp').send(await this.expenses.photo(req.administratorId, id)); }
}

@UseGuards(PersonJwtGuard)
@Controller('member/expenses')
export class MemberExpensesController {
  constructor(private readonly expenses: ExpensesService) {}
  @Get('types') types(@Req() req: PersonRequest) { return this.expenses.types(req.actor.administratorId, true); }
  @Get('works/:workId') recent(@Req() req: PersonRequest, @Param('workId') workId: string) { return this.expenses.recent(req, workId); }
  @Post('works/:workId')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: receiptUploadLimit } }))
  create(@Req() req: PersonRequest, @Param('workId') workId: string, @Body() body: { amount?: unknown; typeId?: unknown; requestId?: unknown }, @UploadedFile() file: Express.Multer.File) { return this.expenses.create(req, workId, body, file); }
  @Get(':id/receipt') async photo(@Req() req: PersonRequest, @Param('id') id: string, @Res() res: Response) {
    res.type('image/webp').send(await this.expenses.memberPhoto(req, id));
  }
}

@Controller('public/session/expenses')
export class LegacyExpensesController {
  constructor(private readonly expenses: ExpensesService, private readonly publicService: PublicService) {}
  @Get('types') async types(@Req() req: Request) {
    const work = await this.publicService.session(req);
    return this.expenses.types(work.administratorId, true);
  }
  @Get() async recent(@Req() req: Request) {
    return this.expenses.recentLegacy(await this.publicService.session(req));
  }
  @Post()
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: receiptUploadLimit } }))
  async create(@Req() req: Request, @Body() body: { amount?: unknown; typeId?: unknown; requestId?: unknown }, @UploadedFile() file: Express.Multer.File) {
    return this.expenses.createLegacy(await this.publicService.session(req), body, file);
  }
  @Get(':id/receipt') async photo(@Req() req: Request, @Param('id') id: string, @Res() res: Response) {
    const work = await this.publicService.session(req);
    res.type('image/webp').send(await this.expenses.photo(work.administratorId, id, undefined, work.foremanId, work.id));
  }
}

