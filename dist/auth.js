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
import { Body, Controller, Injectable, Post, Get, UseGuards, UnauthorizedException, Inject, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { DB } from './database.module.js';
let AuthService = class AuthService {
    db;
    jwt;
    attempts = new Map();
    constructor(db, jwt) {
        this.db = db;
        this.jwt = jwt;
    }
    async login(email, password, ip) {
        if (typeof email !== 'string' || typeof password !== 'string')
            throw new UnauthorizedException('Credenciales incorrectas');
        const key = ip;
        const now = Date.now();
        const entry = this.attempts.get(key);
        const next = !entry || entry.until < now ? { count: 1, until: now + 15 * 60_000 } : { count: entry.count + 1, until: entry.until };
        this.attempts.set(key, next);
        if (next.count > 10)
            throw new UnauthorizedException('Demasiados intentos. Volvé a intentar más tarde.');
        if (this.attempts.size > 10_000)
            for (const [item, value] of this.attempts)
                if (value.until < now)
                    this.attempts.delete(item);
        const rows = await this.db.query('SELECT id, email, full_name, password_hash FROM administrators WHERE lower(email) = lower($1) AND is_active = true', [email.trim()]);
        const admin = rows[0];
        if (!admin || !(await compare(password, admin.password_hash)))
            throw new UnauthorizedException('Credenciales incorrectas');
        this.attempts.delete(key);
        return { accessToken: await this.jwt.signAsync({ sub: admin.id }), administrator: { id: admin.id, email: admin.email, fullName: admin.full_name } };
    }
};
AuthService = __decorate([
    Injectable(),
    __param(0, Inject(DB)),
    __metadata("design:paramtypes", [Function, JwtService])
], AuthService);
export { AuthService };
let JwtGuard = class JwtGuard {
    jwt;
    db;
    constructor(jwt, db) {
        this.jwt = jwt;
        this.db = db;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const header = req.headers.authorization ?? '';
        if (!header.startsWith('Bearer '))
            throw new UnauthorizedException();
        try {
            const payload = await this.jwt.verifyAsync(header.slice(7));
            const rows = await this.db.query('SELECT id FROM administrators WHERE id = $1 AND is_active = true', [payload.sub]);
            if (!rows.length)
                throw new Error('inactive');
            req.administratorId = payload.sub;
            return true;
        }
        catch {
            throw new UnauthorizedException();
        }
    }
};
JwtGuard = __decorate([
    Injectable(),
    __param(1, Inject(DB)),
    __metadata("design:paramtypes", [JwtService, Function])
], JwtGuard);
export { JwtGuard };
let AuthController = class AuthController {
    auth;
    db;
    constructor(auth, db) {
        this.auth = auth;
        this.db = db;
    }
    login(body, req) { return this.auth.login(body.email, body.password, req.ip ?? 'unknown'); }
    async me(req) {
        const [row] = await this.db.query('SELECT id, email, full_name AS "fullName" FROM administrators WHERE id = $1', [req.administratorId]);
        return row;
    }
};
__decorate([
    Post('login'),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "login", null);
__decorate([
    UseGuards(JwtGuard),
    Get('me'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
AuthController = __decorate([
    Controller('auth'),
    __param(1, Inject(DB)),
    __metadata("design:paramtypes", [AuthService, Function])
], AuthController);
export { AuthController };
//# sourceMappingURL=auth.js.map