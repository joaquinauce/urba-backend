import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import sharp from 'sharp';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DB } from './database.module.js';
import {
  DailyGoal,
  DailyReport,
  DailyReportItem,
  Foreman,
  Person,
  ReportCorrection,
  ReportPhoto,
  Work,
} from './database/entities.js';
import { JwtGuard } from './auth.js';
import type { AdminRequest } from './auth.js';
import { AdminService } from './admin.js';
import {
  customQuantityConfig,
  localNow,
  optional,
  quantityForUnit,
  reportSummary,
  uuid,
  type Db,
} from './shared.js';

type Submission = {
  observations?: string;
  items: { goalId: string; actualQuantity: number }[];
};

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: DataSource,
    private readonly admin: AdminService,
  ) {}
  private editable(work: Work) {
    const local = localNow(work.timeZone);
    if (work.status !== 'ACTIVA' || local.time >= work.closeTime.slice(0, 5))
      throw new BadRequestException('El día está cerrado para informar');
    return local.date;
  }
  async submit(work: Work, body: Submission, submittedByPersonId?: string) {
    if (!Array.isArray(body?.items))
      throw new BadRequestException('Faltan las cantidades');
    const date = this.editable(work);
    return this.db.transaction(async (tx) => {
      const current = await tx
        .getRepository(Work)
        .createQueryBuilder('work')
        .where('work.id = :id', { id: work.id })
        .setLock('pessimistic_write')
        .getOne();
      if (!current) throw new NotFoundException('Recurso no encontrado');
      if (this.editable(current) !== date)
        throw new BadRequestException('El día está cerrado para informar');
      await this.admin.materialize(work.administratorId, work.id, date, tx);
      const goals = await tx.getRepository(DailyGoal).find({
        where: { workId: work.id, workDate: date, isActive: true },
        order: { id: 'ASC' },
      });
      if (!goals.length)
        throw new BadRequestException('Hoy no hay objetivos para informar');
      const supplied = new Map<string, number>();
      for (const item of body.items) {
        if (
          !item ||
          typeof item.goalId !== 'string' ||
          supplied.has(item.goalId)
        )
          throw new BadRequestException('Objetivos duplicados o inválidos');
        const goal = goals.find(
          (candidate: any) => candidate.id === item.goalId,
        );
        if (!goal) throw new BadRequestException('Objetivo inexistente');
        supplied.set(
          item.goalId,
          quantityForUnit(
            item.actualQuantity,
            goal.unit,
            'Cantidad realizada',
            false,
            customQuantityConfig(
              goal.unit,
              goal.quantityStep,
              goal.quantityDecimals,
            ),
          ),
        );
      }
      if (
        supplied.size !== goals.length ||
        goals.some((goal: any) => !supplied.has(goal.id))
      )
        throw new BadRequestException('Informá todos los objetivos del día');
      const foreman = await tx.getRepository(Foreman).findOneBy({
        administratorId: work.administratorId,
        id: work.foremanId,
      });
      if (!foreman) throw new NotFoundException('Recurso no encontrado');
      const submittedByPerson = submittedByPersonId
        ? await tx.getRepository(Person).findOneBy({
            id: submittedByPersonId,
            administratorId: work.administratorId,
            isActive: true,
          })
        : null;
      if (submittedByPersonId && !submittedByPerson)
        throw new NotFoundException('Responsable no encontrado');
      const responsibleName =
        submittedByPerson?.fullName ??
        `${foreman.firstName} ${foreman.lastName}`;
      const observations = optional(body.observations, 5000);
      const reports = tx.getRepository(DailyReport);
      let report = await reports.findOneBy({ workId: work.id, workDate: date });
      const now = new Date();
      if (report)
        Object.assign(report, {
          observations,
          foremanId: work.foremanId,
          foremanNameSnapshot: responsibleName,
          submittedByPersonId: submittedByPerson?.id ?? null,
          updatedAt: now,
          submittedAt: now,
        });
      else
        report = reports.create({
          id: uuid(),
          administratorId: work.administratorId,
          workId: work.id,
          workDate: date,
          foremanId: work.foremanId,
          foremanNameSnapshot: responsibleName,
          submittedByPersonId: submittedByPerson?.id ?? null,
          observations,
        });
      report = await reports.save(report);
      const id = report.id;
      const itemRepository = tx.getRepository(DailyReportItem);
      const existingItems = new Map(
        (await itemRepository.findBy({ reportId: id })).map((item) => [
          item.goalId,
          item,
        ]),
      );
      const items: DailyReportItem[] = [];
      for (const goal of goals) {
        const existing = existingItems.get(goal.id);
        if (existing) {
          existing.actualQuantity = String(supplied.get(goal.id));
          existing.updatedAt = now;
          items.push(existing);
        } else
          items.push(
            itemRepository.create({
              id: uuid(),
              administratorId: work.administratorId,
              workId: work.id,
              reportId: id,
              workDate: date,
              goalId: goal.id,
              activityId: goal.activityId,
              descriptionSnapshot: goal.description,
              expectedQuantitySnapshot: goal.expectedQuantity,
              unitSnapshot: goal.unit,
              customUnitSnapshot: goal.customUnit,
              actualQuantity: String(supplied.get(goal.id)),
              quantityStepSnapshot: goal.quantityStep,
              quantityDecimalsSnapshot: goal.quantityDecimals,
            }),
          );
      }
      await itemRepository.save(items);
      return this.detail(id, work.administratorId, tx);
    });
  }
  async detail(id: string, adminId: string, db: Db = this.db) {
    const report = await db.getRepository(DailyReport).findOne({
      where: { id, administratorId: adminId },
      relations: { work: true, submittedByPerson: true },
    });
    if (!report) throw new NotFoundException('Recurso no encontrado');
    const [itemEntities, photoEntities] = await Promise.all([
      db.getRepository(DailyReportItem).find({
        where: { reportId: id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      db
        .getRepository(ReportPhoto)
        .find({ where: { reportId: id }, order: { createdAt: 'ASC' } }),
    ]);
    const items = itemEntities.map((item) => ({
      id: item.id,
      goalId: item.goalId,
      activityId: item.activityId,
      description: item.descriptionSnapshot,
      expected: item.expectedQuantitySnapshot,
      actual: item.actualQuantity,
      unit: item.unitSnapshot,
      customUnit: item.customUnitSnapshot,
      quantityStep: item.quantityStepSnapshot,
      quantityDecimals: item.quantityDecimalsSnapshot,
    }));
    const photos = photoEntities.map((photo) => ({
      id: photo.id,
      mimeType: photo.mimeType,
      width: photo.width,
      height: photo.height,
    }));
    const responsibleName =
      report.submittedByPerson?.fullName ?? report.foremanNameSnapshot;
    return {
      id: report.id,
      workId: report.workId,
      date: report.workDate,
      foremanName: responsibleName,
      submittedByPersonId: report.submittedByPersonId,
      submittedBy: {
        personId: report.submittedByPersonId,
        name: responsibleName,
        accessType: report.submittedByPersonId ? 'PERSONAL' : 'LEGACY',
      },
      observations: report.observations,
      submittedAt: report.submittedAt,
      updatedAt: report.updatedAt,
      workName: report.work.name,
      items,
      photos,
      compliance: reportSummary(
        items.map((i) => ({
          actual_quantity: i.actual,
          expected_quantity_snapshot: i.expected,
        })),
      ),
    };
  }
  async list(adminId: string, workId: string) {
    const exists = await this.db
      .getRepository(Work)
      .existsBy({ administratorId: adminId, id: workId });
    if (!exists) throw new NotFoundException('Recurso no encontrado');
    const reports = await this.db.getRepository(DailyReport).find({
      where: { administratorId: adminId, workId },
      relations: { submittedByPerson: true },
      order: { workDate: 'DESC' },
    });
    return reports.map((report) => {
      const responsibleName =
        report.submittedByPerson?.fullName ?? report.foremanNameSnapshot;
      return {
        id: report.id,
        date: report.workDate,
        foremanName: responsibleName,
        submittedByPersonId: report.submittedByPersonId,
        submittedBy: {
          personId: report.submittedByPersonId,
          name: responsibleName,
          accessType: report.submittedByPersonId ? 'PERSONAL' : 'LEGACY',
        },
        submittedAt: report.submittedAt,
        updatedAt: report.updatedAt,
      };
    });
  }
  async correct(
    adminId: string,
    reportId: string,
    body: {
      observations?: string;
      items?: { id: string; actualQuantity: number }[];
      reason?: string;
    },
  ) {
    return this.db.transaction(async (tx) => {
      const report = await tx
        .getRepository(DailyReport)
        .createQueryBuilder('report')
        .innerJoinAndSelect('report.work', 'work')
        .where('report.administratorId = :adminId AND report.id = :reportId', {
          adminId,
          reportId,
        })
        .setLock('pessimistic_write', undefined, ['report'])
        .getOne();
      if (!report) throw new NotFoundException('Recurso no encontrado');
      const local = localNow(report.work.timeZone);
      if (
        report.workDate === local.date &&
        local.time < report.work.closeTime.slice(0, 5)
      )
        throw new BadRequestException(
          'El informe todavía está abierto para el capataz',
        );
      const beforeReport = await this.detail(reportId, adminId, tx);
      const before = {
        observations: beforeReport.observations,
        items: beforeReport.items.map((item: any) => ({
          id: item.id,
          actual: item.actual,
        })),
      };
      if (body.observations !== undefined)
        report.observations = optional(body.observations, 5000);
      if (body.items !== undefined) {
        if (!Array.isArray(body.items))
          throw new BadRequestException('Ítems inválidos');
        const ids = new Set<string>();
        const itemRepository = tx.getRepository(DailyReportItem);
        const reportItems = await itemRepository.findBy({ reportId });
        const units = new Map(reportItems.map((item) => [item.id, item]));
        for (const item of body.items) {
          if (!item || typeof item.id !== 'string' || ids.has(item.id))
            throw new BadRequestException('Ítems duplicados o inválidos');
          ids.add(item.id);
          const entity = units.get(item.id);
          if (!entity) throw new BadRequestException('Ítem inexistente');
          entity.actualQuantity = String(
            quantityForUnit(
              item.actualQuantity,
              entity.unitSnapshot,
              'Cantidad realizada',
              false,
              customQuantityConfig(
                entity.unitSnapshot,
                entity.quantityStepSnapshot,
                entity.quantityDecimalsSnapshot,
              ),
            ),
          );
          entity.updatedAt = new Date();
        }
        await itemRepository.save(
          [...units.values()].filter((item) => ids.has(item.id)),
        );
      }
      report.updatedAt = new Date();
      await tx.getRepository(DailyReport).save(report);
      const afterReport = await this.detail(reportId, adminId, tx);
      const after = {
        observations: afterReport.observations,
        items: afterReport.items.map((item: any) => ({
          id: item.id,
          actual: item.actual,
        })),
      };
      if (JSON.stringify(before) === JSON.stringify(after))
        throw new BadRequestException('No hay cambios para registrar');
      await tx.getRepository(ReportCorrection).insert({
        id: uuid(),
        administratorId: adminId,
        workId: report.workId,
        reportId,
        correctedByAdministratorId: adminId,
        beforeValue: before,
        afterValue: after,
        reason: optional(body.reason, 1000),
      });
      return afterReport;
    });
  }
  async uploadPhoto(
    adminId: string,
    reportId: string,
    file: Express.Multer.File,
    publicWork?: Work,
  ) {
    if (!file || file.size > 12 * 1024 * 1024 || file.size === 0)
      throw new BadRequestException('La foto debe pesar menos de 12 MB');
    const report = await this.db.getRepository(DailyReport).findOne({
      where: { id: reportId, administratorId: adminId },
      relations: { work: true },
    });
    if (!report) throw new NotFoundException('Recurso no encontrado');
    if (publicWork) {
      if (
        publicWork.id !== report.workId ||
        this.editable(publicWork) !== report.workDate
      )
        throw new BadRequestException('El informe ya no admite fotografías');
    }
    let data: Buffer;
    let width: number;
    let height: number;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 30_000_000 })
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 78 });
      const result = await image.toBuffer({ resolveWithObject: true });
      data = result.data;
      width = result.info.width;
      height = result.info.height;
    } catch {
      throw new BadRequestException('Formato de imagen inválido');
    }
    const dir = resolve(process.env.PHOTO_STORAGE_DIR ?? './storage/photos');
    await mkdir(dir, { recursive: true });
    const key = `${uuid()}.webp`;
    await writeFile(join(dir, key), data, { flag: 'wx' });
    const id = uuid();
    try {
      await this.db.getRepository(ReportPhoto).insert({
        id,
        administratorId: adminId,
        workId: report.workId,
        reportId,
        storageKey: key,
        mimeType: 'image/webp',
        byteSize: data.length,
        width,
        height,
      });
    } catch (error) {
      await unlink(join(dir, key)).catch(() => {});
      throw error;
    }
    return { id, width, height, mimeType: 'image/webp' };
  }
  async photo(
    adminId: string,
    photoId: string,
    workId?: string,
  ): Promise<Buffer> {
    const photo = await this.db.getRepository(ReportPhoto).findOneBy({
      administratorId: adminId,
      id: photoId,
      ...(workId ? { workId } : {}),
    });
    if (!photo) throw new NotFoundException('Recurso no encontrado');
    if (!/^[0-9a-f-]{36}\.webp$/.test(photo.storageKey))
      throw new BadRequestException('Foto inválida');
    return readFile(
      join(
        resolve(process.env.PHOTO_STORAGE_DIR ?? './storage/photos'),
        photo.storageKey,
      ),
    );
  }
}

@UseGuards(JwtGuard)
@Controller('admin')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('works/:id/reports') list(
    @Req() req: AdminRequest,
    @Param('id') id: string,
  ) {
    return this.reports.list(req.administratorId, id);
  }
  @Get('reports/:id') detail(
    @Req() req: AdminRequest,
    @Param('id') id: string,
  ) {
    return this.reports.detail(id, req.administratorId);
  }
  @Patch('reports/:id') correct(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.reports.correct(req.administratorId, id, body);
  }
  @Post('reports/:id/photos')
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: 12 * 1024 * 1024 } }),
  )
  upload(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.reports.uploadPhoto(req.administratorId, id, file);
  }
  @Get('photos/:id') async photo(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    res
      .type('image/webp')
      .send(await this.reports.photo(req.administratorId, id));
  }
}
