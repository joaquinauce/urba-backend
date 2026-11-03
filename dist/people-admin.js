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
import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, NotFoundException, Param, Patch, Post, Req, UseGuards, } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { In, IsNull } from 'typeorm';
import { DB } from './database.module.js';
import { Person, PersonRole, Role, Work, WorkAssignment, } from './database/entities.js';
import { JwtGuard } from './auth.js';
import { PERSONAL_ROLES, codeLookupHmac, generatePersonalCode, } from './people-auth.js';
import { required, uuid } from './shared.js';
function validRoles(value) {
    if (!Array.isArray(value) || !value.length)
        throw new BadRequestException('Definí al menos un rol personal');
    const roles = [...new Set(value)];
    if (roles.some((role) => typeof role !== 'string' ||
        !PERSONAL_ROLES.includes(role)))
        throw new BadRequestException('Rol personal inválido');
    return roles;
}
function sessionAfter(current) {
    return String(BigInt(current) + 1n);
}
let PeopleAdminService = class PeopleAdminService {
    db;
    constructor(db) {
        this.db = db;
    }
    async person(manager, administratorId, id) {
        const person = await manager.getRepository(Person).findOneBy({
            id,
            administratorId,
        });
        if (!person || person.administratorSourceId)
            throw new NotFoundException('Persona no encontrada');
        return person;
    }
    async list(administratorId) {
        const people = await this.db
            .getRepository(Person)
            .createQueryBuilder('person')
            .addSelect('person.pinLookupHmac')
            .where('person.administratorId = :administratorId', {
            administratorId,
        })
            .andWhere('person.administratorSourceId IS NULL')
            .orderBy('person.fullName', 'ASC')
            .getMany();
        if (!people.length)
            return [];
        const ids = people.map((person) => person.id);
        const [roles, assignments] = await Promise.all([
            this.db.getRepository(PersonRole).findBy({
                administratorId,
                personId: In(ids),
            }),
            this.db.getRepository(WorkAssignment).findBy({
                administratorId,
                personId: In(ids),
                unassignedAt: IsNull(),
            }),
        ]);
        return people.map((person) => ({
            id: person.id,
            fullName: person.fullName,
            isActive: person.isActive,
            hasCode: person.pinLookupHmac !== null,
            failedAttempts: person.failedAttempts,
            lockedUntil: person.lockedUntil,
            lastAccessAt: person.lastAccessAt,
            roles: roles
                .filter((role) => role.personId === person.id)
                .map((role) => role.roleCode),
            activeAssignments: assignments.filter((assignment) => assignment.personId === person.id).length,
        }));
    }
    async create(administratorId, body) {
        const fullName = required(body?.fullName, 'Nombre completo', 201);
        const roles = validRoles(body?.roles);
        return this.db.transaction(async (manager) => {
            const available = await manager
                .getRepository(Role)
                .countBy({ code: In(roles) });
            if (available !== roles.length)
                throw new ConflictException('Los roles requeridos no están disponibles');
            const person = manager.getRepository(Person).create({
                id: uuid(),
                administratorId,
                fullName,
            });
            await manager.getRepository(Person).insert(person);
            await manager.getRepository(PersonRole).insert(roles.map((roleCode) => ({
                personId: person.id,
                administratorId,
                roleCode,
            })));
            return { id: person.id, fullName, isActive: true, roles };
        });
    }
    async update(administratorId, id, body) {
        return this.db.transaction(async (manager) => {
            const person = await this.person(manager, administratorId, id);
            const roles = body.roles === undefined ? null : validRoles(body.roles);
            if (roles) {
                const existing = await manager.getRepository(PersonRole).findBy({
                    administratorId,
                    personId: id,
                    roleCode: In([...PERSONAL_ROLES]),
                });
                const removed = existing
                    .map((item) => item.roleCode)
                    .filter((role) => !roles.includes(role));
                if (removed.length &&
                    (await manager.getRepository(WorkAssignment).existsBy({
                        administratorId,
                        personId: id,
                        roleCode: In(removed),
                        unassignedAt: IsNull(),
                    })))
                    throw new ConflictException('Desasigná las obras activas antes de retirar el rol');
                if (removed.length)
                    await manager.getRepository(PersonRole).delete({
                        administratorId,
                        personId: id,
                        roleCode: In(removed),
                    });
                const existingCodes = new Set(existing.map((item) => item.roleCode));
                const additions = roles.filter((role) => !existingCodes.has(role));
                if (additions.length)
                    await manager.getRepository(PersonRole).insert(additions.map((roleCode) => ({
                        personId: id,
                        administratorId,
                        roleCode,
                    })));
            }
            if (body.fullName !== undefined)
                person.fullName = required(body.fullName, 'Nombre completo', 201);
            if (body.isActive !== undefined) {
                if (typeof body.isActive !== 'boolean')
                    throw new BadRequestException('Estado inválido');
                if (person.isActive !== body.isActive)
                    person.sessionVersion = sessionAfter(person.sessionVersion);
                person.isActive = body.isActive;
            }
            person.updatedAt = new Date();
            await manager.getRepository(Person).save(person);
            const currentRoles = await manager.getRepository(PersonRole).findBy({
                administratorId,
                personId: id,
            });
            return {
                id,
                fullName: person.fullName,
                isActive: person.isActive,
                roles: currentRoles.map((role) => role.roleCode),
            };
        });
    }
    async rotateCode(administratorId, id) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const code = await generatePersonalCode(this.db);
            const pinHash = await hash(code, 12);
            try {
                return await this.db.transaction(async (manager) => {
                    const person = await manager
                        .getRepository(Person)
                        .createQueryBuilder('person')
                        .where('person.id = :id AND person.administratorId = :administratorId', { id, administratorId })
                        .setLock('pessimistic_write')
                        .getOne();
                    if (!person || person.administratorSourceId)
                        throw new NotFoundException('Persona no encontrada');
                    const hasPersonalRole = await manager
                        .getRepository(PersonRole)
                        .existsBy({
                        administratorId,
                        personId: id,
                        roleCode: In([...PERSONAL_ROLES]),
                    });
                    if (!hasPersonalRole)
                        throw new BadRequestException('La persona no tiene un rol operativo');
                    person.pinHash = pinHash;
                    person.pinLookupHmac = codeLookupHmac(code);
                    person.sessionVersion = sessionAfter(person.sessionVersion);
                    person.failedAttempts = 0;
                    person.lockedUntil = null;
                    person.updatedAt = new Date();
                    await manager.getRepository(Person).save(person);
                    return { personId: id, code };
                });
            }
            catch (error) {
                if (error.code !== '23505' || attempt === 4)
                    throw error;
            }
        }
        throw new ConflictException('No se pudo generar un código único');
    }
    async assignments(administratorId, workId) {
        const work = await this.db.getRepository(Work).findOneBy({
            id: workId,
            administratorId,
        });
        if (!work)
            throw new NotFoundException('Obra no encontrada');
        const assignments = await this.db.getRepository(WorkAssignment).find({
            where: { administratorId, workId },
            relations: { person: true },
            order: { assignedAt: 'DESC' },
        });
        return assignments.map((assignment) => ({
            id: assignment.id,
            personId: assignment.personId,
            personName: assignment.person.fullName,
            roleCode: assignment.roleCode,
            isPrimary: assignment.isPrimary,
            assignedAt: assignment.assignedAt,
            unassignedAt: assignment.unassignedAt,
            active: assignment.unassignedAt === null,
        }));
    }
    async assign(administratorId, workId, body) {
        const personId = required(body?.personId, 'Persona', 36);
        const [roleCode] = validRoles([body?.roleCode]);
        const isPrimary = body?.isPrimary === true;
        try {
            return await this.db.transaction(async (manager) => {
                const work = await manager
                    .getRepository(Work)
                    .createQueryBuilder('work')
                    .where('work.id = :workId AND work.administratorId = :administratorId', { workId, administratorId })
                    .setLock('pessimistic_write')
                    .getOne();
                if (!work)
                    throw new NotFoundException('Obra no encontrada');
                const person = await this.person(manager, administratorId, personId);
                if (!person.isActive)
                    throw new BadRequestException('La persona está inactiva');
                const role = await manager.getRepository(PersonRole).findOneBy({
                    administratorId,
                    personId,
                    roleCode,
                });
                if (!role)
                    throw new BadRequestException('La persona no posee ese rol');
                const assignedAt = new Date();
                const assignment = manager.getRepository(WorkAssignment).create({
                    id: uuid(),
                    administratorId,
                    workId,
                    personId,
                    roleCode,
                    isPrimary,
                    assignedAt,
                });
                await manager.getRepository(WorkAssignment).insert(assignment);
                return {
                    id: assignment.id,
                    personId,
                    roleCode,
                    isPrimary,
                    assignedAt,
                };
            });
        }
        catch (error) {
            if (error.code === '23505')
                throw new ConflictException(isPrimary
                    ? 'Ya existe una asignación activa o primaria para ese rol'
                    : 'La persona ya tiene esa asignación activa');
            throw error;
        }
    }
    async unassign(administratorId, workId, assignmentId) {
        return this.db.transaction(async (manager) => {
            const assignment = await manager
                .getRepository(WorkAssignment)
                .createQueryBuilder('assignment')
                .where('assignment.id = :assignmentId AND assignment.workId = :workId AND assignment.administratorId = :administratorId', { assignmentId, workId, administratorId })
                .setLock('pessimistic_write')
                .getOne();
            if (!assignment)
                throw new NotFoundException('Asignación no encontrada');
            if (!assignment.unassignedAt) {
                assignment.unassignedAt = new Date();
                assignment.isPrimary = false;
                assignment.updatedAt = new Date();
                await manager.getRepository(WorkAssignment).save(assignment);
            }
            return {
                id: assignment.id,
                unassignedAt: assignment.unassignedAt,
                active: false,
            };
        });
    }
};
PeopleAdminService = __decorate([
    Injectable(),
    __param(0, Inject(DB)),
    __metadata("design:paramtypes", [Function])
], PeopleAdminService);
export { PeopleAdminService };
let PeopleAdminController = class PeopleAdminController {
    people;
    constructor(people) {
        this.people = people;
    }
    list(request) {
        return this.people.list(request.administratorId);
    }
    create(request, body) {
        return this.people.create(request.administratorId, body);
    }
    update(request, id, body) {
        return this.people.update(request.administratorId, id, body);
    }
    rotate(request, id) {
        return this.people.rotateCode(request.administratorId, id);
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PeopleAdminController.prototype, "list", null);
__decorate([
    Post(),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PeopleAdminController.prototype, "create", null);
__decorate([
    Patch(':id'),
    __param(0, Req()),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], PeopleAdminController.prototype, "update", null);
__decorate([
    Post(':id/code/rotate'),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PeopleAdminController.prototype, "rotate", null);
PeopleAdminController = __decorate([
    UseGuards(JwtGuard),
    Controller('admin/people'),
    __metadata("design:paramtypes", [PeopleAdminService])
], PeopleAdminController);
export { PeopleAdminController };
let AssignmentAdminController = class AssignmentAdminController {
    people;
    constructor(people) {
        this.people = people;
    }
    list(request, workId) {
        return this.people.assignments(request.administratorId, workId);
    }
    assign(request, workId, body) {
        return this.people.assign(request.administratorId, workId, body);
    }
    unassign(request, workId, assignmentId) {
        return this.people.unassign(request.administratorId, workId, assignmentId);
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __param(1, Param('workId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AssignmentAdminController.prototype, "list", null);
__decorate([
    Post(),
    __param(0, Req()),
    __param(1, Param('workId')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AssignmentAdminController.prototype, "assign", null);
__decorate([
    Patch(':assignmentId/unassign'),
    __param(0, Req()),
    __param(1, Param('workId')),
    __param(2, Param('assignmentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], AssignmentAdminController.prototype, "unassign", null);
AssignmentAdminController = __decorate([
    UseGuards(JwtGuard),
    Controller('admin/works/:workId/assignments'),
    __metadata("design:paramtypes", [PeopleAdminService])
], AssignmentAdminController);
export { AssignmentAdminController };
//# sourceMappingURL=people-admin.js.map