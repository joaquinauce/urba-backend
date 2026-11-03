import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';
import { DB } from './database.module.js';
import {
  Person,
  PersonRole,
  Role,
  Work,
  WorkAssignment,
} from './database/entities.js';
import { JwtGuard, type AdminRequest } from './auth.js';
import {
  PERSONAL_ROLES,
  codeLookupHmac,
  generatePersonalCode,
  type PersonalRole,
} from './people-auth.js';
import { required, uuid } from './shared.js';

function validRoles(value: unknown): PersonalRole[] {
  if (!Array.isArray(value) || !value.length)
    throw new BadRequestException('Definí al menos un rol personal');
  const roles = [...new Set(value)];
  if (
    roles.some(
      (role) =>
        typeof role !== 'string' ||
        !PERSONAL_ROLES.includes(role as PersonalRole),
    )
  )
    throw new BadRequestException('Rol personal inválido');
  return roles as PersonalRole[];
}

function sessionAfter(current: string) {
  return String(BigInt(current) + 1n);
}

@Injectable()
export class PeopleAdminService {
  constructor(@Inject(DB) private readonly db: DataSource) {}

  private async person(
    manager: DataSource | EntityManager,
    administratorId: string,
    id: string,
  ) {
    const person = await manager.getRepository(Person).findOneBy({
      id,
      administratorId,
    });
    if (!person || person.administratorSourceId)
      throw new NotFoundException('Persona no encontrada');
    return person;
  }

  async list(administratorId: string) {
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
    if (!people.length) return [];
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
      activeAssignments: assignments.filter(
        (assignment) => assignment.personId === person.id,
      ).length,
    }));
  }

  async create(
    administratorId: string,
    body: { fullName?: unknown; roles?: unknown },
  ) {
    const fullName = required(body?.fullName, 'Nombre completo', 201);
    const roles = validRoles(body?.roles);
    return this.db.transaction(async (manager) => {
      const available = await manager
        .getRepository(Role)
        .countBy({ code: In(roles) });
      if (available !== roles.length)
        throw new ConflictException(
          'Los roles requeridos no están disponibles',
        );
      const person = manager.getRepository(Person).create({
        id: uuid(),
        administratorId,
        fullName,
      });
      await manager.getRepository(Person).insert(person);
      await manager.getRepository(PersonRole).insert(
        roles.map((roleCode) => ({
          personId: person.id,
          administratorId,
          roleCode,
        })),
      );
      return { id: person.id, fullName, isActive: true, roles };
    });
  }

  async update(
    administratorId: string,
    id: string,
    body: { fullName?: unknown; isActive?: unknown; roles?: unknown },
  ) {
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
          .filter((role) => !roles.includes(role as PersonalRole));
        if (
          removed.length &&
          (await manager.getRepository(WorkAssignment).existsBy({
            administratorId,
            personId: id,
            roleCode: In(removed),
            unassignedAt: IsNull(),
          }))
        )
          throw new ConflictException(
            'Desasigná las obras activas antes de retirar el rol',
          );
        if (removed.length)
          await manager.getRepository(PersonRole).delete({
            administratorId,
            personId: id,
            roleCode: In(removed),
          });
        const existingCodes = new Set(existing.map((item) => item.roleCode));
        const additions = roles.filter((role) => !existingCodes.has(role));
        if (additions.length)
          await manager.getRepository(PersonRole).insert(
            additions.map((roleCode) => ({
              personId: id,
              administratorId,
              roleCode,
            })),
          );
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

  async rotateCode(administratorId: string, id: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = await generatePersonalCode(this.db);
      const pinHash = await hash(code, 12);
      try {
        return await this.db.transaction(async (manager) => {
          const person = await manager
            .getRepository(Person)
            .createQueryBuilder('person')
            .where(
              'person.id = :id AND person.administratorId = :administratorId',
              { id, administratorId },
            )
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
            throw new BadRequestException(
              'La persona no tiene un rol operativo',
            );
          person.pinHash = pinHash;
          person.pinLookupHmac = codeLookupHmac(code);
          person.sessionVersion = sessionAfter(person.sessionVersion);
          person.failedAttempts = 0;
          person.lockedUntil = null;
          person.updatedAt = new Date();
          await manager.getRepository(Person).save(person);
          return { personId: id, code };
        });
      } catch (error) {
        if ((error as { code?: string }).code !== '23505' || attempt === 4)
          throw error;
      }
    }
    throw new ConflictException('No se pudo generar un código único');
  }

  async assignments(administratorId: string, workId: string) {
    const work = await this.db.getRepository(Work).findOneBy({
      id: workId,
      administratorId,
    });
    if (!work) throw new NotFoundException('Obra no encontrada');
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

  async assign(
    administratorId: string,
    workId: string,
    body: { personId?: unknown; roleCode?: unknown; isPrimary?: unknown },
  ) {
    const personId = required(body?.personId, 'Persona', 36);
    const [roleCode] = validRoles([body?.roleCode]);
    const isPrimary = body?.isPrimary === true;
    try {
      return await this.db.transaction(async (manager) => {
        const work = await manager
          .getRepository(Work)
          .createQueryBuilder('work')
          .where(
            'work.id = :workId AND work.administratorId = :administratorId',
            { workId, administratorId },
          )
          .setLock('pessimistic_write')
          .getOne();
        if (!work) throw new NotFoundException('Obra no encontrada');
        const person = await this.person(manager, administratorId, personId);
        if (!person.isActive)
          throw new BadRequestException('La persona está inactiva');
        const role = await manager.getRepository(PersonRole).findOneBy({
          administratorId,
          personId,
          roleCode,
        });
        if (!role) throw new BadRequestException('La persona no posee ese rol');
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
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException(
          isPrimary
            ? 'Ya existe una asignación activa o primaria para ese rol'
            : 'La persona ya tiene esa asignación activa',
        );
      throw error;
    }
  }

  async unassign(
    administratorId: string,
    workId: string,
    assignmentId: string,
  ) {
    return this.db.transaction(async (manager) => {
      const assignment = await manager
        .getRepository(WorkAssignment)
        .createQueryBuilder('assignment')
        .where(
          'assignment.id = :assignmentId AND assignment.workId = :workId AND assignment.administratorId = :administratorId',
          { assignmentId, workId, administratorId },
        )
        .setLock('pessimistic_write')
        .getOne();
      if (!assignment) throw new NotFoundException('Asignación no encontrada');
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
}

@UseGuards(JwtGuard)
@Controller('admin/people')
export class PeopleAdminController {
  constructor(private readonly people: PeopleAdminService) {}

  @Get()
  list(@Req() request: AdminRequest) {
    return this.people.list(request.administratorId);
  }

  @Post()
  create(@Req() request: AdminRequest, @Body() body: any) {
    return this.people.create(request.administratorId, body);
  }

  @Patch(':id')
  update(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.people.update(request.administratorId, id, body);
  }

  @Post(':id/code/rotate')
  rotate(@Req() request: AdminRequest, @Param('id') id: string) {
    return this.people.rotateCode(request.administratorId, id);
  }
}

@UseGuards(JwtGuard)
@Controller('admin/works/:workId/assignments')
export class AssignmentAdminController {
  constructor(private readonly people: PeopleAdminService) {}

  @Get()
  list(@Req() request: AdminRequest, @Param('workId') workId: string) {
    return this.people.assignments(request.administratorId, workId);
  }

  @Post()
  assign(
    @Req() request: AdminRequest,
    @Param('workId') workId: string,
    @Body() body: any,
  ) {
    return this.people.assign(request.administratorId, workId, body);
  }

  @Patch(':assignmentId/unassign')
  unassign(
    @Req() request: AdminRequest,
    @Param('workId') workId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.people.unassign(request.administratorId, workId, assignmentId);
  }
}
