var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { BadRequestException, ConflictException, Controller, Get, Inject, Injectable, Param, Patch, Post, Body, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { DB } from './database.module.js';
import { JwtGuard } from './auth.js';
import { PersonJwtGuard, WorkAuthorizationService } from './people-auth.js';
const storageDir = () => resolve(process.env.PHOTO_STORAGE_DIR ?? './storage/photos');
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const parsed = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
let ExpensesService = class ExpensesService {
    db;
    authorization;
    constructor(db, authorization) {
        this.db = db;
        this.authorization = authorization;
    }
    async types(administratorId, activeOnly = false) {
        await this.db.query(`INSERT INTO expense_types (id, administrator_id, name)
      SELECT md5($1::text || ':' || seed.name)::uuid, $1::uuid, seed.name
      FROM (VALUES ('Combustible Maquinaria'), ('Combustible Utilitario'), ('Comida'), ('Materiales Menores')) AS seed(name)
      WHERE NOT EXISTS (SELECT 1 FROM expense_types WHERE administrator_id = $1::uuid)
      ON CONFLICT DO NOTHING`, [administratorId]);
        return this.db.query('SELECT id, name, is_active AS "isActive" FROM expense_types WHERE administrator_id = $1 AND ($2::boolean = false OR is_active) ORDER BY name', [administratorId, activeOnly]);
    }
    async saveType(administratorId, body, id) {
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > 100)
            throw new BadRequestException('Ingresá un nombre de hasta 100 caracteres');
        if (id && !uuid(id))
            throw new BadRequestException('Tipo inválido');
        if (body.isActive !== undefined && typeof body.isActive !== 'boolean')
            throw new BadRequestException('Estado inválido');
        try {
            const rows = id
                ? await this.db.query('UPDATE expense_types SET name = $3, is_active = COALESCE($4::boolean, is_active), updated_at = now() WHERE administrator_id = $1 AND id = $2 RETURNING id, name, is_active AS "isActive"', [administratorId, id, name, body.isActive ?? null])
                : await this.db.query('INSERT INTO expense_types (id, administrator_id, name, is_active) VALUES ($1, $2, $3, $4) RETURNING id, name, is_active AS "isActive"', [randomUUID(), administratorId, name, body.isActive ?? true]);
            if (!rows.length)
                throw new NotFoundException('Tipo no encontrado');
            return rows[0];
        }
        catch (error) {
            if (error.code === '23505')
                throw new ConflictException('Ya existe un tipo con ese nombre');
            throw error;
        }
    }
    async setTypeActive(administratorId, id, active) {
        if (!uuid(id) || typeof active !== 'boolean')
            throw new BadRequestException('Estado inválido');
        const rows = await this.db.query('UPDATE expense_types SET is_active = $3, updated_at = now() WHERE administrator_id = $1 AND id = $2 RETURNING id, name, is_active AS "isActive"', [administratorId, id, active]);
        if (!rows.length)
            throw new NotFoundException('Tipo no encontrado');
        return rows[0];
    }
    async list(administratorId, filters) {
        const from = filters.from;
        const to = filters.to;
        if (!date(from) || !date(to) || from > to)
            throw new BadRequestException('Rango de fechas inválido');
        for (const key of ['workId', 'personId', 'typeId', 'foremanId'])
            if (filters[key] && !uuid(filters[key]))
                throw new BadRequestException('Filtro inválido');
        return this.db.query(`SELECT e.id, e.work_id AS "workId", w.name AS "workName", e.person_id AS "personId", p.full_name AS "personName", e.expense_type_id AS "typeId", e.expense_type_name AS "typeName", e.amount_ars AS "amountArs", e.occurred_at AS "occurredAt", e.work_date AS "workDate"
      FROM expense_reports e JOIN works w ON w.id = e.work_id JOIN people p ON p.id = e.person_id
      WHERE e.administrator_id = $1 AND e.work_date BETWEEN $2::date AND $3::date
      AND ($4::uuid IS NULL OR e.work_id = $4) AND ($5::uuid IS NULL OR e.person_id = $5) AND ($6::uuid IS NULL OR e.expense_type_id = $6)
      AND ($7::uuid IS NULL OR p.foreman_source_id = $7)
      ORDER BY e.work_date DESC, w.name, e.occurred_at DESC`, [administratorId, from, to, filters.workId || null, filters.personId || null, filters.typeId || null, filters.foremanId || null]);
    }
    async recent(request, workId) {
        if (!uuid(workId))
            throw new BadRequestException('Obra inválida');
        await this.authorization.authorize(request.actor, workId);
        return this.db.query(`SELECT id, expense_type_name AS "typeName", amount_ars AS "amountArs", occurred_at AS "occurredAt", work_date AS "workDate" FROM expense_reports WHERE administrator_id = $1 AND person_id = $2 AND work_id = $3 ORDER BY occurred_at DESC LIMIT 10`, [request.actor.administratorId, request.actor.id, workId]);
    }
    async create(request, workId, body, file) {
        if (!uuid(workId) || !uuid(body?.typeId) || !uuid(body?.requestId))
            throw new BadRequestException('Datos del gasto inválidos');
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99 || !/^\d+(\.\d{1,2})?$/.test(String(body.amount)))
            throw new BadRequestException('Ingresá un monto positivo con hasta dos decimales');
        if (!file?.buffer?.length || file.size > 12 * 1024 * 1024)
            throw new BadRequestException('Adjuntá una fotografía de hasta 12 MB');
        const work = await this.authorization.authorize(request.actor, workId, true);
        if (work.status !== 'ACTIVA')
            throw new BadRequestException('La obra no está activa');
        const owner = request.actor.administratorId;
        const existing = await this.db.query('SELECT id FROM expense_reports WHERE administrator_id = $1 AND person_id = $2 AND request_id = $3', [owner, request.actor.id, body.requestId]);
        if (existing.length)
            return { id: existing[0].id, repeated: true };
        const types = await this.db.query('SELECT name FROM expense_types WHERE administrator_id = $1 AND id = $2 AND is_active', [owner, body.typeId]);
        if (!types.length)
            throw new BadRequestException('Seleccioná un tipo de gasto habilitado');
        let result;
        try {
            result = await sharp(file.buffer, { limitInputPixels: 30_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
        }
        catch {
            throw new BadRequestException('Formato de imagen inválido');
        }
        const dir = storageDir();
        await mkdir(dir, { recursive: true });
        const key = `${randomUUID()}.webp`;
        await writeFile(join(dir, key), result.data, { flag: 'wx' });
        const id = randomUUID();
        try {
            const rows = await this.db.query(`INSERT INTO expense_reports (id, administrator_id, work_id, person_id, expense_type_id, expense_type_name, amount_ars, work_date, receipt_storage_key, receipt_byte_size, receipt_width, receipt_height, request_id)
        SELECT $1, $2, w.id, $4, $5, $6, $7, (now() AT TIME ZONE w.time_zone)::date, $8, $9, $10, $11, $12
        FROM works w WHERE w.id = $3 AND w.administrator_id = $2 AND w.status = 'ACTIVA'
        AND EXISTS (SELECT 1 FROM work_assignments a WHERE a.administrator_id = $2 AND a.work_id = w.id AND a.person_id = $4 AND a.unassigned_at IS NULL AND a.role_code IN ('FOREMAN', 'SITE_MANAGER'))
        AND EXISTS (SELECT 1 FROM expense_types t WHERE t.administrator_id = $2 AND t.id = $5 AND t.is_active)
        RETURNING id`, [id, owner, workId, request.actor.id, body.typeId, types[0].name, amount, key, result.data.length, result.info.width, result.info.height, body.requestId]);
            if (!rows.length)
                throw new BadRequestException('La asignación o el tipo de gasto ya no está activo');
            return { id };
        }
        catch (error) {
            await unlink(join(dir, key)).catch(() => { });
            if (error.code === '23505') {
                const prior = await this.db.query('SELECT id FROM expense_reports WHERE administrator_id = $1 AND person_id = $2 AND request_id = $3', [owner, request.actor.id, body.requestId]);
                if (prior.length)
                    return { id: prior[0].id, repeated: true };
            }
            throw error;
        }
    }
    async photo(administratorId, expenseId, personId) {
        if (!uuid(expenseId))
            throw new BadRequestException('Rendición inválida');
        const rows = await this.db.query('SELECT receipt_storage_key AS key FROM expense_reports WHERE administrator_id = $1 AND id = $2 AND ($3::uuid IS NULL OR person_id = $3)', [administratorId, expenseId, personId ?? null]);
        if (!rows.length)
            throw new NotFoundException('Comprobante no encontrado');
        const key = rows[0].key;
        if (!/^[0-9a-f-]{36}\.webp$/.test(key))
            throw new BadRequestException('Comprobante inválido');
        return readFile(join(storageDir(), key));
    }
};
ExpensesService = __decorate([
    Injectable(),
    __param(0, Inject(DB)),
    __metadata("design:paramtypes", [Function, WorkAuthorizationService])
], ExpensesService);
export { ExpensesService };
let AdminExpensesController = class AdminExpensesController {
    expenses;
    constructor(expenses) {
        this.expenses = expenses;
    }
    types(req) { return this.expenses.types(req.administratorId); }
    createType(req, body) { return this.expenses.saveType(req.administratorId, body); }
    editType(req, id, body) { return this.expenses.saveType(req.administratorId, body, id); }
    active(req, id, body) { return this.expenses.setTypeActive(req.administratorId, id, body?.isActive); }
    list(req, filters) { return this.expenses.list(req.administratorId, filters); }
    async photo(req, id, res) { res.type('image/webp').send(await this.expenses.photo(req.administratorId, id)); }
};
__decorate([
    Get('types'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AdminExpensesController.prototype, "types", null);
__decorate([
    Post('types'),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AdminExpensesController.prototype, "createType", null);
__decorate([
    Patch('types/:id'),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AdminExpensesController.prototype, "editType", null);
__decorate([
    Patch('types/:id/active'),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AdminExpensesController.prototype, "active", null);
__decorate([
    Get(),
    __param(0, Req()),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AdminExpensesController.prototype, "list", null);
__decorate([
    Get(':id/receipt'),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AdminExpensesController.prototype, "photo", null);
AdminExpensesController = __decorate([
    UseGuards(JwtGuard),
    Controller('admin/expenses'),
    __metadata("design:paramtypes", [ExpensesService])
], AdminExpensesController);
export { AdminExpensesController };
let MemberExpensesController = class MemberExpensesController {
    expenses;
    constructor(expenses) {
        this.expenses = expenses;
    }
    types(req) { return this.expenses.types(req.actor.administratorId, true); }
    recent(req, workId) { return this.expenses.recent(req, workId); }
    create(req, workId, body, file) { return this.expenses.create(req, workId, body, file); }
    async photo(req, id, res) { res.type('image/webp').send(await this.expenses.photo(req.actor.administratorId, id, req.actor.id)); }
};
__decorate([
    Get('types'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MemberExpensesController.prototype, "types", null);
__decorate([
    Get('works/:workId'),
    __param(0, Req()),
    __param(1, Param('workId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MemberExpensesController.prototype, "recent", null);
__decorate([
    Post('works/:workId'),
    UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 12 * 1024 * 1024 } })),
    __param(0, Req()),
    __param(1, Param('workId')),
    __param(2, Body()),
    __param(3, UploadedFile()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, Object]),
    __metadata("design:returntype", void 0)
], MemberExpensesController.prototype, "create", null);
__decorate([
    Get(':id/receipt'),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemberExpensesController.prototype, "photo", null);
MemberExpensesController = __decorate([
    UseGuards(PersonJwtGuard),
    Controller('member/expenses'),
    __metadata("design:paramtypes", [ExpensesService])
], MemberExpensesController);
export { MemberExpensesController };
//# sourceMappingURL=expenses.js.map