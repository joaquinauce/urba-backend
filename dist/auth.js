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
import { Body, Controller, Injectable, Post, Get, UseGuards, UnauthorizedException, Inject, Req, } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { DB } from './database.module.js';
import { Administrator, Person, PersonRole } from './database/entities.js';
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
        const next = !entry || entry.until < now
            ? { count: 1, until: now + 15 * 60_000 }
            : { count: entry.count + 1, until: entry.until };
        this.attempts.set(key, next);
        if (next.count > 10)
            throw new UnauthorizedException('Demasiados intentos. Volvé a intentar más tarde.');
        if (this.attempts.size > 10_000)
            for (const [item, value] of this.attempts)
                if (value.until < now)
                    this.attempts.delete(item);
        const admin = await this.db
            .getRepository(Administrator)
            .createQueryBuilder('administrator')
            .addSelect('administrator.passwordHash')
            .where('LOWER(administrator.email) = LOWER(:email)', {
            email: email.trim(),
        })
            .andWhere('administrator.isActive = :active', { active: true })
            .getOne();
        if (!admin || !(await compare(password, admin.passwordHash))) {
            const person = await this.db.getRepository(Person).createQueryBuilder('person')
                .addSelect('person.passwordHash')
                .where('LOWER(person.email) = LOWER(:email)', { email: email.trim() })
                .andWhere('person.isActive = :active', { active: true }).getOne();
            if (!person?.passwordHash || !(await compare(password, person.passwordHash)))
                throw new UnauthorizedException('Credenciales incorrectas');
            const roles = (await this.db.getRepository(PersonRole).findBy({
                administratorId: person.administratorId, personId: person.id,
            })).map((role) => role.roleCode);
            if (roles.includes('ADMINISTRATOR')) {
                this.attempts.delete(key);
                return {
                    accessToken: await this.jwt.signAsync({ type: 'administrator_person', sub: person.id,
                        administratorId: person.administratorId, version: String(person.sessionVersion) }),
                    administrator: { id: person.id, email: person.email, fullName: person.fullName, role: 'ADMINISTRATOR' },
                };
            }
            if (!roles.includes('SITE_MANAGER'))
                throw new UnauthorizedException('Credenciales incorrectas');
            this.attempts.delete(key);
            return {
                accessToken: await this.jwt.signAsync({ type: 'person', sub: person.id,
                    administratorId: person.administratorId, version: String(person.sessionVersion) }, { expiresIn: '8h' }),
                person: { id: person.id, administratorId: person.administratorId,
                    fullName: person.fullName, roles: roles.filter((role) => role === 'SITE_MANAGER' || role === 'FOREMAN') },
            };
        }
        this.attempts.delete(key);
        return {
            accessToken: await this.jwt.signAsync({
                type: 'administrator',
                sub: admin.id,
                administratorId: admin.id,
            }),
            administrator: {
                id: admin.id,
                email: admin.email,
                fullName: admin.fullName,
                role: 'ADMINISTRATOR',
            },
        };
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
            if (payload.type === 'administrator_person') {
                const person = await this.db.getRepository(Person).findOneBy({ id: payload.sub,
                    administratorId: payload.administratorId, isActive: true });
                if (!person || String(person.sessionVersion) !== String(payload.version) || !person.email)
                    throw new Error('inactive');
                if (!(await this.db.getRepository(PersonRole).existsBy({
                    personId: person.id, administratorId: person.administratorId, roleCode: 'ADMINISTRATOR',
                })))
                    throw new Error('role');
                req.administratorId = person.administratorId;
                req.administratorPersonId = person.id;
                return true;
            }
            if (payload.type && payload.type !== 'administrator')
                throw new Error('profile');
            const active = await this.db
                .getRepository(Administrator)
                .existsBy({ id: payload.sub, isActive: true });
            if (!active)
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
    login(body, req) {
        return this.auth.login(body.email, body.password, req.ip ?? 'unknown');
    }
    async me(req) {
        if (req.administratorPersonId) {
            const person = await this.db.getRepository(Person).findOne({
                select: { id: true, email: true, fullName: true },
                where: { id: req.administratorPersonId, administratorId: req.administratorId },
            });
            return person ? { ...person, role: 'ADMINISTRATOR' } : undefined;
        }
        const administrator = await this.db.getRepository(Administrator).findOne({
            select: { id: true, email: true, fullName: true },
            where: { id: req.administratorId },
        });
        return administrator ? { ...administrator, role: 'ADMINISTRATOR' } : undefined;
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