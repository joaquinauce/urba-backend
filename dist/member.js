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
import { Body, Controller, Get, Inject, Injectable, NotFoundException, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors, } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { In, IsNull } from 'typeorm';
import { AdminService } from './admin.js';
import { AuthService } from './auth.js';
import { DB } from './database.module.js';
import { DailyReport, ReportPhoto, WorkAssignment, } from './database/entities.js';
import { PersonJwtGuard, WorkAuthorizationService, } from './people-auth.js';
import { ReportsService } from './reports.js';
let MemberService = class MemberService {
    db;
    authorization;
    admin;
    reports;
    constructor(db, authorization, admin, reports) {
        this.db = db;
        this.authorization = authorization;
        this.admin = admin;
        this.reports = reports;
    }
    async works(request) {
        const assignments = await this.db.getRepository(WorkAssignment).find({
            where: {
                administratorId: request.actor.administratorId,
                personId: request.actor.id,
                roleCode: In(request.actor.roles),
                unassignedAt: IsNull(),
            },
            relations: { work: { primaryForeman: true } },
            order: { assignedAt: 'ASC' },
        });
        const result = new Map();
        for (const assignment of assignments) {
            const existing = result.get(assignment.workId);
            if (existing) {
                if (!existing.roles.includes(assignment.roleCode))
                    existing.roles.push(assignment.roleCode);
                continue;
            }
            result.set(assignment.workId, {
                id: assignment.work.id,
                name: assignment.work.name,
                description: assignment.work.description,
                location: assignment.work.location,
                status: assignment.work.status,
                startDate: assignment.work.startDate,
                estimatedEndDate: assignment.work.estimatedEndDate,
                foremanName: `${assignment.work.primaryForeman.firstName} ${assignment.work.primaryForeman.lastName}`,
                roles: [assignment.roleCode],
            });
        }
        return [...result.values()];
    }
    async detail(request, workId) {
        await this.authorization.authorize(request.actor, workId);
        return this.admin.workDetail(request.actor.administratorId, workId, false);
    }
    async reportList(request, workId) {
        await this.authorization.authorize(request.actor, workId);
        return this.reports.list(request.actor.administratorId, workId);
    }
    async reportDetail(request, reportId) {
        const report = await this.db.getRepository(DailyReport).findOneBy({
            id: reportId,
            administratorId: request.actor.administratorId,
        });
        if (!report)
            throw new NotFoundException('Informe no encontrado');
        await this.authorization.authorize(request.actor, report.workId);
        return this.reports.detail(reportId, request.actor.administratorId);
    }
    async submit(request, workId, body) {
        const work = await this.authorization.authorize(request.actor, workId, true);
        return this.reports.submit(work, body, request.actor.id);
    }
    async upload(request, workId, reportId, file) {
        const work = await this.authorization.authorize(request.actor, workId, true);
        const belongs = await this.db.getRepository(DailyReport).existsBy({
            id: reportId,
            administratorId: request.actor.administratorId,
            workId,
        });
        if (!belongs)
            throw new NotFoundException('Informe no encontrado');
        return this.reports.uploadPhoto(request.actor.administratorId, reportId, file, work);
    }
    async photo(request, photoId) {
        const photo = await this.db.getRepository(ReportPhoto).findOneBy({
            id: photoId,
            administratorId: request.actor.administratorId,
        });
        if (!photo)
            throw new NotFoundException('Fotografía no encontrada');
        await this.authorization.authorize(request.actor, photo.workId);
        return this.reports.photo(request.actor.administratorId, photoId, photo.workId);
    }
};
MemberService = __decorate([
    Injectable(),
    __param(0, Inject(DB)),
    __metadata("design:paramtypes", [Function, WorkAuthorizationService,
        AdminService,
        ReportsService])
], MemberService);
export { MemberService };
let MemberController = class MemberController {
    members;
    auth;
    constructor(members, auth) {
        this.members = members;
        this.auth = auth;
    }
    password(req, body) {
        return this.auth.changePersonPassword(req.actor.id, String(body?.currentPassword ?? ''), String(body?.newPassword ?? ''));
    }
    works(request) {
        return this.members.works(request);
    }
    detail(request, workId) {
        return this.members.detail(request, workId);
    }
    reports(request, workId) {
        return this.members.reportList(request, workId);
    }
    report(request, reportId) {
        return this.members.reportDetail(request, reportId);
    }
    submit(request, workId, body) {
        return this.members.submit(request, workId, body);
    }
    upload(request, workId, reportId, file) {
        return this.members.upload(request, workId, reportId, file);
    }
    async photo(request, photoId, response) {
        response
            .type('image/webp')
            .send(await this.members.photo(request, photoId));
    }
};
__decorate([
    Post('password'),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], MemberController.prototype, "password", null);
__decorate([
    Get('works'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MemberController.prototype, "works", null);
__decorate([
    Get('works/:workId'),
    __param(0, Req()),
    __param(1, Param('workId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MemberController.prototype, "detail", null);
__decorate([
    Get('works/:workId/reports'),
    __param(0, Req()),
    __param(1, Param('workId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MemberController.prototype, "reports", null);
__decorate([
    Get('reports/:reportId'),
    __param(0, Req()),
    __param(1, Param('reportId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], MemberController.prototype, "report", null);
__decorate([
    Post('works/:workId/reports'),
    __param(0, Req()),
    __param(1, Param('workId')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], MemberController.prototype, "submit", null);
__decorate([
    Post('works/:workId/reports/:reportId/photos'),
    UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 12 * 1024 * 1024 } })),
    __param(0, Req()),
    __param(1, Param('workId')),
    __param(2, Param('reportId')),
    __param(3, UploadedFile()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", void 0)
], MemberController.prototype, "upload", null);
__decorate([
    Get('photos/:photoId'),
    __param(0, Req()),
    __param(1, Param('photoId')),
    __param(2, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MemberController.prototype, "photo", null);
MemberController = __decorate([
    UseGuards(PersonJwtGuard),
    Controller('member'),
    __metadata("design:paramtypes", [MemberService, AuthService])
], MemberController);
export { MemberController };
//# sourceMappingURL=member.js.map