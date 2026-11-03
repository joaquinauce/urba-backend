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
import { BadRequestException, Body, Controller, Get, Inject, Injectable, NotFoundException, Param, Post, Req, Res, UploadedFile, UseInterceptors, HttpException, HttpStatus, UnauthorizedException, } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { DB } from './database.module.js';
import { DailyGoal, DailyReport, Work } from './database/entities.js';
import { AdminService } from './admin.js';
import { normalizeAlias } from './admin.js';
import { ReportsService } from './reports.js';
import { codeHash, localNow } from './shared.js';
let PublicService = class PublicService {
    db;
    admin;
    reports;
    jwt;
    attempts = new Map();
    aliasAttempts = new Map();
    constructor(db, admin, reports, jwt) {
        this.db = db;
        this.admin = admin;
        this.reports = reports;
        this.jwt = jwt;
    }
    async aliases(ip) {
        this.limit(ip);
        return this.db
            .getRepository(Work)
            .createQueryBuilder('work')
            .innerJoin('work.primaryForeman', 'foreman')
            .select('work.accessAlias', 'alias')
            .where('work.accessAlias IS NOT NULL')
            .andWhere('work.status = :status', { status: 'ACTIVA' })
            .andWhere('foreman.isActive = :active', { active: true })
            .orderBy('work.accessAlias', 'ASC')
            .getRawMany();
    }
    async aliasLogin(aliasInput, pin, ip) {
        this.limit(ip);
        const alias = normalizeAlias(aliasInput);
        const key = `${ip}:${alias ?? ''}`;
        const now = Date.now();
        const item = this.aliasAttempts.get(key);
        const next = !item || item.until < now
            ? { count: 1, until: now + 15 * 60_000 }
            : { count: item.count + 1, until: item.until };
        this.aliasAttempts.set(key, next);
        if (next.count > 8)
            throw new HttpException('Demasiados intentos; volvé a intentar más tarde', HttpStatus.TOO_MANY_REQUESTS);
        if (this.aliasAttempts.size > 10_000)
            for (const [k, v] of this.aliasAttempts)
                if (v.until < now)
                    this.aliasAttempts.delete(k);
        const work = alias && typeof pin === 'string' && /^\d{6}$/.test(pin)
            ? await this.db
                .getRepository(Work)
                .createQueryBuilder('work')
                .innerJoin('work.primaryForeman', 'foreman')
                .addSelect('work.aliasPinHash')
                .where('work.accessAlias = :alias', { alias })
                .andWhere('work.status = :status', { status: 'ACTIVA' })
                .andWhere('foreman.isActive = :active', { active: true })
                .getOne()
            : null;
        const valid = work
            ? await compare(pin, work.aliasPinHash)
            : false;
        if (!work)
            await hash('000000', 12);
        if (!work || !valid) {
            throw new UnauthorizedException('Alias o PIN incorrectos');
        }
        this.aliasAttempts.delete(key);
        return {
            accessToken: await this.jwt.signAsync({
                type: 'foreman',
                workId: work.id,
                version: String(work.aliasSessionVersion),
            }, { expiresIn: '8h' }),
        };
    }
    async session(req) {
        const header = req.headers.authorization ?? '';
        if (!header.startsWith('Bearer '))
            throw new UnauthorizedException();
        try {
            const payload = await this.jwt.verifyAsync(header.slice(7));
            if (payload.type !== 'foreman' || !payload.workId)
                throw new Error('invalid');
            const work = await this.db.getRepository(Work).findOne({
                where: { id: payload.workId, status: 'ACTIVA' },
                relations: { primaryForeman: true },
            });
            if (!work ||
                !work.accessAlias ||
                !work.primaryForeman.isActive ||
                String(work.aliasSessionVersion) !== payload.version)
                throw new Error('revoked');
            return Object.assign(work, {
                foremanName: `${work.primaryForeman.firstName} ${work.primaryForeman.lastName}`,
            });
        }
        catch {
            throw new UnauthorizedException('La sesión del capataz venció. Volvé a ingresar.');
        }
    }
    limit(ip) {
        const now = Date.now();
        const item = this.attempts.get(ip);
        const next = !item || item.until < now
            ? { count: 1, until: now + 60_000 }
            : { count: item.count + 1, until: item.until };
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
        const work = await this.db.getRepository(Work).findOne({
            where: { accessCodeHash: codeHash(code) },
            relations: { primaryForeman: true },
        });
        if (!work)
            throw new NotFoundException('Recurso no encontrado');
        return Object.assign(work, {
            foremanName: `${work.primaryForeman.firstName} ${work.primaryForeman.lastName}`,
        });
    }
    async today(code, ip) {
        return this.todayFor(await this.resolve(code, ip));
    }
    async todayFor(work) {
        const { date, time } = localNow(work.timeZone);
        await this.admin.materialize(work.administratorId, work.id, date);
        const goalEntities = await this.db.getRepository(DailyGoal).find({
            where: { workId: work.id, workDate: date, isActive: true },
            order: { createdAt: 'ASC', id: 'ASC' },
        });
        const goals = goalEntities.map((goal) => ({
            id: goal.id,
            description: goal.description,
            expectedQuantity: goal.expectedQuantity,
            unit: goal.unit,
            customUnit: goal.customUnit,
            quantityStep: goal.quantityStep,
            quantityDecimals: goal.quantityDecimals,
        }));
        const existing = await this.db.getRepository(DailyReport).findOne({
            select: { id: true },
            where: { workId: work.id, workDate: date },
        });
        const report = existing
            ? await this.reports.detail(existing.id, work.administratorId)
            : null;
        return {
            work: { id: work.id, name: work.name, foremanName: work.foremanName },
            date,
            goals,
            report,
            editable: work.status === 'ACTIVA' && time < work.closeTime.slice(0, 5),
            closeTime: work.closeTime.slice(0, 5),
        };
    }
    async submit(code, ip, body) {
        return this.reports.submit(await this.resolve(code, ip), body);
    }
    async upload(code, ip, reportId, file) {
        const work = await this.resolve(code, ip);
        return this.reports.uploadPhoto(work.administratorId, reportId, file, work);
    }
    async photo(code, ip, photoId) {
        const work = await this.resolve(code, ip);
        return this.reports.photo(work.administratorId, photoId, work.id);
    }
};
PublicService = __decorate([
    Injectable(),
    __param(0, Inject(DB)),
    __metadata("design:paramtypes", [Function, AdminService,
        ReportsService,
        JwtService])
], PublicService);
export { PublicService };
let AliasController = class AliasController {
    service;
    reports;
    constructor(service, reports) {
        this.service = service;
        this.reports = reports;
    }
    aliases(req) {
        return this.service.aliases(req.ip ?? 'unknown');
    }
    login(body, req) {
        return this.service.aliasLogin(body?.alias, body?.pin, req.ip ?? 'unknown');
    }
    async today(req) {
        return this.service.todayFor(await this.service.session(req));
    }
    async submit(req, body) {
        return this.reports.submit(await this.service.session(req), body);
    }
    async upload(req, id, file) {
        const work = await this.service.session(req);
        return this.reports.uploadPhoto(work.administratorId, id, file, work);
    }
    async photo(req, id, res) {
        const work = await this.service.session(req);
        res
            .type('image/webp')
            .send(await this.reports.photo(work.administratorId, id, work.id));
    }
};
__decorate([
    Get('aliases'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AliasController.prototype, "aliases", null);
__decorate([
    Post('alias/login'),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AliasController.prototype, "login", null);
__decorate([
    Get('session/today'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AliasController.prototype, "today", null);
__decorate([
    Post('session/reports'),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AliasController.prototype, "submit", null);
__decorate([
    Post('session/reports/:reportId/photos'),
    UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 12 * 1024 * 1024 } })),
    __param(0, Req()),
    __param(1, Param('reportId')),
    __param(2, UploadedFile()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AliasController.prototype, "upload", null);
__decorate([
    Get('session/photos/:id'),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AliasController.prototype, "photo", null);
AliasController = __decorate([
    Controller('public'),
    __metadata("design:paramtypes", [PublicService,
        ReportsService])
], AliasController);
export { AliasController };
let PublicController = class PublicController {
    service;
    constructor(service) {
        this.service = service;
    }
    today(code, req) {
        return this.service.today(code, req.ip ?? 'unknown');
    }
    submit(code, req, body) {
        return this.service.submit(code, req.ip ?? 'unknown', body);
    }
    upload(code, req, id, file) {
        return this.service.upload(code, req.ip ?? 'unknown', id, file);
    }
    async photo(code, req, id, res) {
        res
            .type('image/webp')
            .send(await this.service.photo(code, req.ip ?? 'unknown', id));
    }
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