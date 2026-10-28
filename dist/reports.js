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
import { BadRequestException, Body, Controller, Get, Inject, Injectable, Param, Patch, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import sharp from 'sharp';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DB } from './database.module.js';
import { JwtGuard } from './auth.js';
import { AdminService } from './admin.js';
import { localNow, one, optional, quantityForUnit, reportSummary, uuid } from './shared.js';
let ReportsService = class ReportsService {
    db;
    admin;
    constructor(db, admin) {
        this.db = db;
        this.admin = admin;
    }
    editable(work) {
        const local = localNow(work.time_zone);
        if (work.status !== 'ACTIVA' || local.time >= work.close_time.slice(0, 5))
            throw new BadRequestException('El día está cerrado para informar');
        return local.date;
    }
    async submit(work, body) {
        if (!Array.isArray(body?.items))
            throw new BadRequestException('Faltan las cantidades');
        const date = this.editable(work);
        return this.db.transaction(async (tx) => {
            const current = await one(tx, 'SELECT * FROM works WHERE id=$1 FOR UPDATE', [work.id]);
            if (this.editable(current) !== date)
                throw new BadRequestException('El día está cerrado para informar');
            await this.admin.materialize(work.administrator_id, work.id, date, tx);
            const goals = await tx.query('SELECT * FROM daily_goals WHERE work_id=$1 AND work_date=$2 AND is_active=true ORDER BY id', [work.id, date]);
            if (!goals.length)
                throw new BadRequestException('Hoy no hay objetivos para informar');
            const supplied = new Map();
            for (const item of body.items) {
                if (!item || typeof item.goalId !== 'string' || supplied.has(item.goalId))
                    throw new BadRequestException('Objetivos duplicados o inválidos');
                const goal = goals.find((candidate) => candidate.id === item.goalId);
                if (!goal)
                    throw new BadRequestException('Objetivo inexistente');
                supplied.set(item.goalId, quantityForUnit(item.actualQuantity, goal.unit, 'Cantidad realizada'));
            }
            if (supplied.size !== goals.length || goals.some((goal) => !supplied.has(goal.id)))
                throw new BadRequestException('Informá todos los objetivos del día');
            const foreman = await one(tx, 'SELECT first_name,last_name FROM foremen WHERE administrator_id=$1 AND id=$2', [work.administrator_id, work.foreman_id]);
            const observations = optional(body.observations, 5000);
            const reportId = uuid();
            const rows = await tx.query(`INSERT INTO daily_reports(id,administrator_id,work_id,work_date,foreman_id,foreman_name_snapshot,observations)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (work_id,work_date) DO UPDATE SET observations=EXCLUDED.observations,foreman_id=EXCLUDED.foreman_id,foreman_name_snapshot=EXCLUDED.foreman_name_snapshot,updated_at=now(),submitted_at=now()
        RETURNING id`, [reportId, work.administrator_id, work.id, date, work.foreman_id, `${foreman.first_name} ${foreman.last_name}`, observations]);
            const id = rows[0].id;
            for (const goal of goals) {
                await tx.query(`INSERT INTO daily_report_items(id,administrator_id,work_id,report_id,work_date,goal_id,activity_id,description_snapshot,expected_quantity_snapshot,unit_snapshot,custom_unit_snapshot,actual_quantity)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT (report_id,goal_id) DO UPDATE SET actual_quantity=EXCLUDED.actual_quantity,updated_at=now()`, [uuid(), work.administrator_id, work.id, id, date, goal.id, goal.activity_id, goal.description, goal.expected_quantity, goal.unit, goal.custom_unit, supplied.get(goal.id)]);
            }
            return this.detail(id, work.administrator_id, tx);
        });
    }
    async detail(id, adminId, db = this.db) {
        const report = await one(db, `SELECT r.id,r.work_id AS "workId",r.work_date AS date,r.foreman_name_snapshot AS "foremanName",r.observations,r.submitted_at AS "submittedAt",r.updated_at AS "updatedAt",w.name AS "workName" FROM daily_reports r JOIN works w ON w.id=r.work_id WHERE r.id=$1 AND r.administrator_id=$2`, [id, adminId]);
        const items = await db.query('SELECT id,goal_id AS "goalId",activity_id AS "activityId",description_snapshot AS description,expected_quantity_snapshot AS expected,actual_quantity AS actual,unit_snapshot AS unit,custom_unit_snapshot AS "customUnit" FROM daily_report_items WHERE report_id=$1 ORDER BY created_at,id', [id]);
        const photos = await db.query('SELECT id,mime_type AS "mimeType",width,height FROM report_photos WHERE report_id=$1 ORDER BY created_at', [id]);
        return { ...report, items, photos, compliance: reportSummary(items.map((i) => ({ actual_quantity: i.actual, expected_quantity_snapshot: i.expected }))) };
    }
    async list(adminId, workId) {
        await one(this.db, 'SELECT id FROM works WHERE administrator_id=$1 AND id=$2', [adminId, workId]);
        return this.db.query('SELECT id,work_date AS date,submitted_at AS "submittedAt",updated_at AS "updatedAt" FROM daily_reports WHERE administrator_id=$1 AND work_id=$2 ORDER BY work_date DESC', [adminId, workId]);
    }
    async correct(adminId, reportId, body) {
        return this.db.transaction(async (tx) => {
            const report = await one(tx, 'SELECT r.*,w.time_zone,w.close_time FROM daily_reports r JOIN works w ON w.id=r.work_id WHERE r.administrator_id=$1 AND r.id=$2 FOR UPDATE OF r', [adminId, reportId]);
            const local = localNow(report.time_zone);
            if (report.work_date === local.date && local.time < report.close_time.slice(0, 5))
                throw new BadRequestException('El informe todavía está abierto para el capataz');
            const beforeReport = await this.detail(reportId, adminId, tx);
            const before = { observations: beforeReport.observations, items: beforeReport.items.map((item) => ({ id: item.id, actual: item.actual })) };
            if (body.observations !== undefined)
                await tx.query('UPDATE daily_reports SET observations=$2,updated_at=now() WHERE id=$1', [reportId, optional(body.observations, 5000)]);
            if (body.items !== undefined) {
                if (!Array.isArray(body.items))
                    throw new BadRequestException('Ítems inválidos');
                const ids = new Set();
                const units = new Map((await tx.query('SELECT id,unit_snapshot FROM daily_report_items WHERE report_id=$1', [reportId])).map((row) => [row.id, row.unit_snapshot]));
                for (const item of body.items) {
                    if (!item || typeof item.id !== 'string' || ids.has(item.id))
                        throw new BadRequestException('Ítems duplicados o inválidos');
                    ids.add(item.id);
                    const unit = units.get(item.id);
                    if (!unit)
                        throw new BadRequestException('Ítem inexistente');
                    const rows = await tx.query('UPDATE daily_report_items SET actual_quantity=$3,updated_at=now() WHERE report_id=$1 AND id=$2 RETURNING id', [reportId, item.id, quantityForUnit(item.actualQuantity, unit, 'Cantidad realizada')]);
                    if (!rows.length)
                        throw new BadRequestException('Ítem inexistente');
                }
            }
            await tx.query('UPDATE daily_reports SET updated_at=now() WHERE id=$1', [reportId]);
            const afterReport = await this.detail(reportId, adminId, tx);
            const after = { observations: afterReport.observations, items: afterReport.items.map((item) => ({ id: item.id, actual: item.actual })) };
            if (JSON.stringify(before) === JSON.stringify(after))
                throw new BadRequestException('No hay cambios para registrar');
            await tx.query('INSERT INTO report_corrections(id,administrator_id,work_id,report_id,corrected_by_administrator_id,before_value,after_value,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [uuid(), adminId, report.work_id, reportId, adminId, JSON.stringify(before), JSON.stringify(after), optional(body.reason, 1000)]);
            return afterReport;
        });
    }
    async uploadPhoto(adminId, reportId, file, publicWork) {
        if (!file || file.size > 12 * 1024 * 1024 || file.size === 0)
            throw new BadRequestException('La foto debe pesar menos de 12 MB');
        const report = await one(this.db, 'SELECT r.*,w.time_zone,w.close_time,w.status FROM daily_reports r JOIN works w ON w.id=r.work_id WHERE r.id=$1 AND r.administrator_id=$2', [reportId, adminId]);
        if (publicWork) {
            if (publicWork.id !== report.work_id || this.editable(publicWork) !== report.work_date)
                throw new BadRequestException('El informe ya no admite fotografías');
        }
        let data;
        let width;
        let height;
        try {
            const image = sharp(file.buffer, { limitInputPixels: 30_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 });
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
            await this.db.query('INSERT INTO report_photos(id,administrator_id,work_id,report_id,storage_key,mime_type,byte_size,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, adminId, report.work_id, reportId, key, 'image/webp', data.length, width, height]);
        }
        catch (error) {
            await unlink(join(dir, key)).catch(() => { });
            throw error;
        }
        return { id, width, height, mimeType: 'image/webp' };
    }
    async photo(adminId, photoId, workId) {
        const photo = await one(this.db, 'SELECT storage_key FROM report_photos WHERE administrator_id=$1 AND id=$2 AND ($3::uuid IS NULL OR work_id=$3)', [adminId, photoId, workId ?? null]);
        if (!/^[0-9a-f-]{36}\.webp$/.test(photo.storage_key))
            throw new BadRequestException('Foto inválida');
        return readFile(join(resolve(process.env.PHOTO_STORAGE_DIR ?? './storage/photos'), photo.storage_key));
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
    list(req, id) { return this.reports.list(req.administratorId, id); }
    detail(req, id) { return this.reports.detail(id, req.administratorId); }
    correct(req, id, body) { return this.reports.correct(req.administratorId, id, body); }
    upload(req, id, file) { return this.reports.uploadPhoto(req.administratorId, id, file); }
    async photo(req, id, res) { res.type('image/webp').send(await this.reports.photo(req.administratorId, id)); }
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