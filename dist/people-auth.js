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
import { Controller, ForbiddenException, Get, HttpException, HttpStatus, Inject, Injectable, Post, Body, Req, UnauthorizedException, UseGuards, } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHmac, randomInt } from 'node:crypto';
import { In, IsNull } from 'typeorm';
import { DB } from './database.module.js';
import { Person, PersonRole, WorkAssignment } from './database/entities.js';
export const PERSONAL_ROLES = ['SITE_MANAGER', 'FOREMAN'];
function hmacSecret() {
    const secret = process.env.PERSON_CODE_HMAC_SECRET;
    if (!secret || secret.length < 32)
        throw new Error('PERSON_CODE_HMAC_SECRET debe tener al menos 32 caracteres');
    return secret;
}
export function codeLookupHmac(code) {
    return createHmac('sha256', hmacSecret()).update(code).digest('hex');
}
export function validPersonalCode(value) {
    return typeof value === 'string' && /^\d{6}$/.test(value);
}
export async function generatePersonalCode(db) {
    const repository = db.getRepository(Person);
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        if (!(await repository.existsBy({ pinLookupHmac: codeLookupHmac(code) })))
            return code;
    }
    throw new Error('No se pudo generar un código personal único');
}
let PersonAuthService = class PersonAuthService {
    db;
    jwt;
    attempts = new Map();
    constructor(db, jwt) {
        this.db = db;
        this.jwt = jwt;
        hmacSecret();
    }
    limit(ip) {
        const now = Date.now();
        const current = this.attempts.get(ip);
        const next = !current || current.until < now
            ? { count: 1, until: now + 15 * 60_000 }
            : { count: current.count + 1, until: current.until };
        this.attempts.set(ip, next);
        if (this.attempts.size > 10_000)
            for (const [key, value] of this.attempts)
                if (value.until < now)
                    this.attempts.delete(key);
        if (next.count > 12)
            throw new HttpException('Demasiados intentos. Volvé a intentar más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }
    async login(code, ip) {
        this.limit(ip);
        if (!validPersonalCode(code)) {
            await hash('000000', 12);
            throw new UnauthorizedException('Código incorrecto');
        }
        const lookup = codeLookupHmac(code);
        const result = await this.db.transaction(async (manager) => {
            const person = await manager
                .getRepository(Person)
                .createQueryBuilder('person')
                .addSelect('person.pinHash')
                .addSelect('person.pinLookupHmac')
                .where('person.pinLookupHmac = :lookup', { lookup })
                .setLock('pessimistic_write')
                .getOne();
            if (!person)
                return { state: 'unknown' };
            const now = new Date();
            if (!person.isActive)
                return { state: 'denied', person, locked: false };
            if (person.lockedUntil && person.lockedUntil > now)
                return { state: 'denied', person, locked: true };
            const matches = !!person.pinHash && (await compare(code, person.pinHash));
            if (!matches) {
                person.failedAttempts += 1;
                if (person.failedAttempts >= 5) {
                    person.lockedUntil = new Date(Date.now() + 15 * 60_000);
                    person.failedAttempts = 0;
                }
                person.updatedAt = now;
                await manager.getRepository(Person).save(person);
                return { state: 'denied', person, locked: false };
            }
            const roles = (await manager.getRepository(PersonRole).findBy({
                personId: person.id,
                administratorId: person.administratorId,
                roleCode: In([...PERSONAL_ROLES]),
            })).map((role) => role.roleCode);
            if (!roles.length)
                return { state: 'denied', person, locked: false };
            person.failedAttempts = 0;
            person.lockedUntil = null;
            person.lastAccessAt = now;
            person.updatedAt = now;
            await manager.getRepository(Person).save(person);
            return { state: 'ok', person, roles };
        });
        if (result.state === 'unknown') {
            await hash(code, 12);
            throw new UnauthorizedException('Código incorrecto');
        }
        if (result.state !== 'ok')
            throw new UnauthorizedException(result.locked ? 'Acceso temporalmente bloqueado' : 'Código incorrecto');
        this.attempts.delete(ip);
        return {
            accessToken: await this.jwt.signAsync({
                type: 'person',
                sub: result.person.id,
                administratorId: result.person.administratorId,
                version: String(result.person.sessionVersion),
            }, { expiresIn: '8h' }),
            person: {
                id: result.person.id,
                administratorId: result.person.administratorId,
                fullName: result.person.fullName,
                roles: result.roles,
            },
        };
    }
};
PersonAuthService = __decorate([
    Injectable(),
    __param(0, Inject(DB)),
    __metadata("design:paramtypes", [Function, JwtService])
], PersonAuthService);
export { PersonAuthService };
let PersonJwtGuard = class PersonJwtGuard {
    jwt;
    db;
    constructor(jwt, db) {
        this.jwt = jwt;
        this.db = db;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const header = request.headers.authorization ?? '';
        if (!header.startsWith('Bearer '))
            throw new UnauthorizedException();
        try {
            const payload = await this.jwt.verifyAsync(header.slice(7));
            if (payload.type !== 'person' || !payload.sub)
                throw new Error('invalid');
            const person = await this.db.getRepository(Person).findOneBy({
                id: payload.sub,
                administratorId: payload.administratorId,
                isActive: true,
            });
            if (!person || String(person.sessionVersion) !== String(payload.version))
                throw new Error('revoked');
            const roles = (await this.db.getRepository(PersonRole).findBy({
                personId: person.id,
                administratorId: person.administratorId,
                roleCode: In([...PERSONAL_ROLES]),
            })).map((role) => role.roleCode);
            if (!roles.length)
                throw new Error('role');
            request.actor = {
                kind: 'person',
                id: person.id,
                administratorId: person.administratorId,
                fullName: person.fullName,
                roles,
            };
            return true;
        }
        catch {
            throw new UnauthorizedException('La sesión personal no es válida');
        }
    }
};
PersonJwtGuard = __decorate([
    Injectable(),
    __param(1, Inject(DB)),
    __metadata("design:paramtypes", [JwtService, Function])
], PersonJwtGuard);
export { PersonJwtGuard };
let WorkAuthorizationService = class WorkAuthorizationService {
    db;
    constructor(db) {
        this.db = db;
    }
    async authorize(actor, workId, write = false) {
        const allowedRoles = write
            ? ['FOREMAN']
            : ['SITE_MANAGER', 'FOREMAN'];
        const effectiveRoles = actor.roles.filter((role) => allowedRoles.includes(role));
        if (!effectiveRoles.length)
            throw new ForbiddenException('El perfil no permite esta operación');
        const assignment = await this.db.getRepository(WorkAssignment).findOne({
            where: {
                administratorId: actor.administratorId,
                personId: actor.id,
                workId,
                roleCode: In(effectiveRoles),
                unassignedAt: IsNull(),
            },
            relations: { work: true },
            order: { isPrimary: 'DESC', assignedAt: 'ASC' },
        });
        if (!assignment)
            throw new ForbiddenException('No tenés una asignación activa a la obra');
        return assignment.work;
    }
};
WorkAuthorizationService = __decorate([
    Injectable(),
    __param(0, Inject(DB)),
    __metadata("design:paramtypes", [Function])
], WorkAuthorizationService);
export { WorkAuthorizationService };
let PersonAuthController = class PersonAuthController {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    login(body, request) {
        return this.auth.login(body?.code, request.ip ?? 'unknown');
    }
    async me(request) {
        return request.actor;
    }
};
__decorate([
    Post('login'),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PersonAuthController.prototype, "login", null);
__decorate([
    Get('me'),
    UseGuards(PersonJwtGuard),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PersonAuthController.prototype, "me", null);
PersonAuthController = __decorate([
    Controller('auth/personal'),
    __metadata("design:paramtypes", [PersonAuthService])
], PersonAuthController);
export { PersonAuthController };
//# sourceMappingURL=people-auth.js.map