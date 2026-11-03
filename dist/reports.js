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
import { BadRequestException, Body, Controller, Get, Inject, Injectable, NotFoundException, Param, Patch, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors, } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import sharp from 'sharp';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DB } from './database.module.js';
import { DailyGoal, DailyReport, DailyReportItem, Foreman, Person, ReportCorrection, ReportPhoto, Work, } from './database/entities.js';
import { JwtGuard } from './auth.js';
import { AdminService } from './admin.js';
import { customQuantityConfig, localNow, optional, quantityForUnit, reportSummary, uuid, } from './shared.js';
let ReportsService = class ReportsService {
    db;
    admin;
    constructor(db, admin) {
        this.db = db;
        this.admin = admin;
    }
    editable(work) {
        const local = localNow(work.timeZone);
        if (work.status !== 'ACTIVA' || local.time >= work.closeTime.slice(0, 5))
            throw new BadRequestException('El día está cerrado para informar');
        return local.date;
    }
    async submit(work, body, submittedByPersonId) {
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
            if (!current)
                throw new NotFoundException('Recurso no encontrado');
            if (this.editable(current) !== date)
                throw new BadRequestException('El día está cerrado para informar');
            await this.admin.materialize(work.administratorId, work.id, date, tx);
            const goals = await tx.getRepository(DailyGoal).find({
                where: { workId: work.id, workDate: date, isActive: true },
                order: { id: 'ASC' },
            });
            if (!goals.length)
                throw new BadRequestException('Hoy no hay objetivos para informar');
            const supplied = new Map();
            for (const item of body.items) {
                if (!item ||
                    typeof item.goalId !== 'string' ||
                    supplied.has(item.goalId))
                    throw new BadRequestException('Objetivos duplicados o inválidos');
                const goal = goals.find((candidate) => candidate.id === item.goalId);
                if (!goal)
                    throw new BadRequestException('Objetivo inexistente');
                supplied.set(item.goalId, quantityForUnit(item.actualQuantity, goal.unit, 'Cantidad realizada', false, customQuantityConfig(goal.unit, goal.quantityStep, goal.quantityDecimals)));
            }
            if (supplied.size !== goals.length ||
                goals.some((goal) => !supplied.has(goal.id)))
                throw new BadRequestException('Informá todos los objetivos del día');
            const foreman = await tx.getRepository(Foreman).findOneBy({
                administratorId: work.administratorId,
                id: work.foremanId,
            });
            if (!foreman)
                throw new NotFoundException('Recurso no encontrado');
            const submittedByPerson = submittedByPersonId
                ? await tx.getRepository(Person).findOneBy({
                    id: submittedByPersonId,
                    administratorId: work.administratorId,
                    isActive: true,
                })
                : null;
            if (submittedByPersonId && !submittedByPerson)
                throw new NotFoundException('Responsable no encontrado');
            const responsibleName = submittedByPerson?.fullName ??
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
            const existingItems = new Map((await itemRepository.findBy({ reportId: id })).map((item) => [
                item.goalId,
                item,
            ]));
            const items = [];
            for (const goal of goals) {
                const existing = existingItems.get(goal.id);
                if (existing) {
                    existing.actualQuantity = String(supplied.get(goal.id));
                    existing.updatedAt = now;
                    items.push(existing);
                }
                else
                    items.push(itemRepository.create({
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
                    }));
            }
            await itemRepository.save(items);
            return this.detail(id, work.administratorId, tx);
        });
    }
    async detail(id, adminId, db = this.db) {
        const report = await db.getRepository(DailyReport).findOne({
            where: { id, administratorId: adminId },
            relations: { work: true, submittedByPerson: true },
        });
        if (!report)
            throw new NotFoundException('Recurso no encontrado');
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
        const responsibleName = report.submittedByPerson?.fullName ?? report.foremanNameSnapshot;
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
            compliance: reportSummary(items.map((i) => ({
                actual_quantity: i.actual,
                expected_quantity_snapshot: i.expected,
            }))),
        };
    }
    async list(adminId, workId) {
        const exists = await this.db
            .getRepository(Work)
            .existsBy({ administratorId: adminId, id: workId });
        if (!exists)
            throw new NotFoundException('Recurso no encontrado');
        const reports = await this.db.getRepository(DailyReport).find({
            where: { administratorId: adminId, workId },
            relations: { submittedByPerson: true },
            order: { workDate: 'DESC' },
        });
        return reports.map((report) => {
            const responsibleName = report.submittedByPerson?.fullName ?? report.foremanNameSnapshot;
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
    async correct(adminId, reportId, body) {
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
            if (!report)
                throw new NotFoundException('Recurso no encontrado');
            const local = localNow(report.work.timeZone);
            if (report.workDate === local.date &&
                local.time < report.work.closeTime.slice(0, 5))
                throw new BadRequestException('El informe todavía está abierto para el capataz');
            const beforeReport = await this.detail(reportId, adminId, tx);
            const before = {
                observations: beforeReport.observations,
                items: beforeReport.items.map((item) => ({
                    id: item.id,
                    actual: item.actual,
                })),
            };
            if (body.observations !== undefined)
                report.observations = optional(body.observations, 5000);
            if (body.items !== undefined) {
                if (!Array.isArray(body.items))
                    throw new BadRequestException('Ítems inválidos');
                const ids = new Set();
                const itemRepository = tx.getRepository(DailyReportItem);
                const reportItems = await itemRepository.findBy({ reportId });
                const units = new Map(reportItems.map((item) => [item.id, item]));
                for (const item of body.items) {
                    if (!item || typeof item.id !== 'string' || ids.has(item.id))
                        throw new BadRequestException('Ítems duplicados o inválidos');
                    ids.add(item.id);
                    const entity = units.get(item.id);
                    if (!entity)
                        throw new BadRequestException('Ítem inexistente');
                    entity.actualQuantity = String(quantityForUnit(item.actualQuantity, entity.unitSnapshot, 'Cantidad realizada', false, customQuantityConfig(entity.unitSnapshot, entity.quantityStepSnapshot, entity.quantityDecimalsSnapshot)));
                    entity.updatedAt = new Date();
                }
                await itemRepository.save([...units.values()].filter((item) => ids.has(item.id)));
            }
            report.updatedAt = new Date();
            await tx.getRepository(DailyReport).save(report);
            const afterReport = await this.detail(reportId, adminId, tx);
            const after = {
                observations: afterReport.observations,
                items: afterReport.items.map((item) => ({
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
    async uploadPhoto(adminId, reportId, file, publicWork) {
        if (!file || file.size > 12 * 1024 * 1024 || file.size === 0)
            throw new BadRequestException('La foto debe pesar menos de 12 MB');
        const report = await this.db.getRepository(DailyReport).findOne({
            where: { id: reportId, administratorId: adminId },
            relations: { work: true },
        });
        if (!report)
            throw new NotFoundException('Recurso no encontrado');
        if (publicWork) {
            if (publicWork.id !== report.workId ||
                this.editable(publicWork) !== report.workDate)
                throw new BadRequestException('El informe ya no admite fotografías');
        }
        let data;
        let width;
        let height;
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
        }
        catch {
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
        }
        catch (error) {
            await unlink(join(dir, key)).catch(() => { });
            throw error;
        }
        return { id, width, height, mimeType: 'image/webp' };
    }
    async photo(adminId, photoId, workId) {
        const photo = await this.db.getRepository(ReportPhoto).findOneBy({
            administratorId: adminId,
            id: photoId,
            ...(workId ? { workId } : {}),
        });
        if (!photo)
            throw new NotFoundException('Recurso no encontrado');
        if (!/^[0-9a-f-]{36}\.webp$/.test(photo.storageKey))
            throw new BadRequestException('Foto inválida');
        return readFile(join(resolve(process.env.PHOTO_STORAGE_DIR ?? './storage/photos'), photo.storageKey));
    }
};
ReportsService = __decorate([
    Injectable(),
    __param(0, Inject(DB)),
    __metadata("design:paramtypes", [Function, AdminService])
], ReportsService);
export { ReportsService };
let ReportsController = class ReportsController {
    reports;
    constructor(reports) {
        this.reports = reports;
    }
    list(req, id) {
        return this.reports.list(req.administratorId, id);
    }
    detail(req, id) {
        return this.reports.detail(id, req.administratorId);
    }
    correct(req, id, body) {
        return this.reports.correct(req.administratorId, id, body);
    }
    upload(req, id, file) {
        return this.reports.uploadPhoto(req.administratorId, id, file);
    }
    async photo(req, id, res) {
        res
            .type('image/webp')
            .send(await this.reports.photo(req.administratorId, id));
    }
};
__decorate([
    Get('works/:id/reports'),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "list", null);
__decorate([
    Get('reports/:id'),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "detail", null);
__decorate([
    Patch('reports/:id'),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "correct", null);
__decorate([
    Post('reports/:id/photos'),
    UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 12 * 1024 * 1024 } })),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, UploadedFile()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "upload", null);
__decorate([
    Get('photos/:id'),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "photo", null);
ReportsController = __decorate([
    UseGuards(JwtGuard),
    Controller('admin'),
    __metadata("design:paramtypes", [ReportsService])
], ReportsController);
export { ReportsController };
//# sourceMappingURL=reports.js.map