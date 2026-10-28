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
import { BadRequestException, Body, Controller, Get, Inject, Injectable, Param, Post, Req, Res, UploadedFile, UseInterceptors, HttpException, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DB } from './database.module.js';
import { AdminService } from './admin.js';
import { ReportsService } from './reports.js';
import { codeHash, localNow, one } from './shared.js';
let PublicService = class PublicService {
    db;
    admin;
    reports;
    attempts = new Map();
    constructor(db, admin, reports) {
        this.db = db;
        this.admin = admin;
        this.reports = reports;
    }
    limit(ip) {
        const now = Date.now();
        const item = this.attempts.get(ip);
        const next = !item || item.until < now ? { count: 1, until: now + 60_000 } : { count: item.count + 1, until: item.until };
        this.attempts.set(ip, next);
        if (next.count > 60)
            throw new HttpException('Demasiados intentos; esperá un minuto', HttpStatus.TOO_MANY_REQUESTS);
        if (this.attempts.size > 10_000)
            for (const [key, value] of this.attempts)
                if (value.until < now)
                    this.attempts.delete(key);
    }
    async resolve(code, ip) {
        this.limit(ip);
        if (!/^[A-Za-z0-9_-]{32}$/.test(code))
            throw new BadRequestException('Código inválido');
        return one(this.db, 'SELECT w.*,f.first_name||\' \'||f.last_name AS foreman_name FROM works w JOIN foremen f ON f.id=w.foreman_id WHERE w.access_code_hash=$1', [codeHash(code)]);
    }
    async today(code, ip) {
        const work = await this.resolve(code, ip);
        const { date, time } = localNow(work.time_zone);
        await this.admin.materialize(work.administrator_id, work.id, date);
        const goals = await this.db.query('SELECT id,description,expected_quantity AS "expectedQuantity",unit,custom_unit AS "customUnit" FROM daily_goals WHERE work_id=$1 AND work_date=$2 AND is_active=true ORDER BY created_at,id', [work.id, date]);
        const rows = await this.db.query('SELECT id FROM daily_reports WHERE work_id=$1 AND work_date=$2', [work.id, date]);
        const report = rows.length ? await this.reports.detail(rows[0].id, work.administrator_id) : null;
        return { work: { id: work.id, name: work.name, foremanName: work.foreman_name }, date, goals, report, editable: work.status === 'ACTIVA' && time < work.close_time.slice(0, 5), closeTime: work.close_time.slice(0, 5) };
    }
    async submit(code, ip, body) {
        const work = await this.resolve(code, ip);
        return this.reports.submit(work, body);
    }
    async upload(code, ip, reportId, file) {
        const work = await this.resolve(code, ip);
        return this.reports.uploadPhoto(work.administrator_id, reportId, file, work);
    }
    async photo(code, ip, photoId) {
        const work = await this.resolve(code, ip);
        return this.reports.photo(work.administrator_id, photoId, work.id);
    }
};
PublicService = __decorate([
    Injectable(),
    __param(0, Inject(DB)),
    __metadata("design:paramtypes", [Function, AdminService, ReportsService])
], PublicService);
export { PublicService };
let PublicController = class PublicController {
    service;
    constructor(service) {
        this.service = service;
    }
    today(code, req) { return this.service.today(code, req.ip ?? 'unknown'); }
    submit(code, req, body) { return this.service.submit(code, req.ip ?? 'unknown', body); }
    upload(code, req, id, file) { return this.service.upload(code, req.ip ?? 'unknown', id, file); }
    async photo(code, req, id, res) { res.type('image/webp').send(await this.service.photo(code, req.ip ?? 'unknown', id)); }
};
__decorate([
    Get('today'),
    __param(0, Param('code')),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PublicController.prototype, "today", null);
__decorate([
    Post('reports'),
    __param(0, Param('code')),
    __param(1, Req()),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], PublicController.prototype, "submit", null);
__decorate([
    Post('reports/:reportId/photos'),
    UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 12 * 1024 * 1024 } })),
    __param(0, Param('code')),
    __param(1, Req()),
    __param(2, Param('reportId')),
    __param(3, UploadedFile()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String, Object]),
    __metadata("design:returntype", void 0)
], PublicController.prototype, "upload", null);
__decorate([
    Get('photos/:id'),
    __param(0, Param('code')),
    __param(1, Req()),
    __param(2, Param('id')),
    __param(3, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String, Object]),
    __metadata("design:returntype", Promise)
], PublicController.prototype, "photo", null);
PublicController = __decorate([
    Controller('public/works/:code'),
    __metadata("design:paramtypes", [PublicService])
], PublicController);
export { PublicController };
//# sourceMappingURL=public.js.map