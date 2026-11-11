import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Logger,
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
  Administrator,
  Foreman,
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
import { clearCodeLookupForManager, recordPersonalEvent } from './personal-security.js';

type ManagedRole = PersonalRole | 'ADMINISTRATOR';
function validRoles(value: unknown): ManagedRole[] {
  if (!Array.isArray(value) || value.length !== 1)
    throw new BadRequestException('Elegí un único tipo de usuario');
  const roles = [...new Set(value)];
  if (
    roles.some(
      (role) =>
        typeof role !== 'string' ||
        ![...PERSONAL_ROLES, 'ADMINISTRATOR'].includes(role as ManagedRole),
    )
  )
    throw new BadRequestException('Rol personal inválido');
  return roles as ManagedRole[];
}

function credentials(body: { email?: unknown; password?: unknown }, requiredForRole: boolean) {
  const email = body.email === undefined || body.email === '' ? null : required(body.email, 'Email', 320).toLowerCase();
  const password = body.password === undefined || body.password === '' ? null : body.password;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Email inválido');
  if (password !== null && (typeof password !== 'string' || password.length < 10))
    throw new BadRequestException('La contraseña debe tener al menos 10 caracteres');
  if (requiredForRole && !email) throw new BadRequestException('Definí el email del usuario');
  return { email, password };
}

function sessionAfter(current: string) {
  return String(BigInt(current) + 1n);
}

@Injectable()
export class PeopleAdminService {
  private readonly logger = new Logger(PeopleAdminService.name);
  constructor(@Inject(DB) private readonly db: DataSource) {}

  private async person(
    manager: DataSource | EntityManager,
    administratorId: string,
    id: string,
  ) {
    const person = await manager.getRepository(Person).createQueryBuilder('person')
      .addSelect('person.passwordHash')
      .where('person.id = :id AND person.administratorId = :administratorId', { id, administratorId })
      .setLock('pessimistic_write')
      .getOne();
    if (!person || person.administratorSourceId)
      throw new NotFoundException('Persona no encontrada');
    return person;
  }

  async list(administratorId: string) {
    const people = await this.db
      .getRepository(Person)
      .createQueryBuilder('person')
      .addSelect('person.pinLookupHmac')
      .addSelect('person.passwordHash')
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
      email: person.email,
      hasPassword: person.passwordHash !== null,
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
    body: { fullName?: unknown; roles?: unknown; email?: unknown; password?: unknown },
  ) {
    const fullName = required(body?.fullName, 'Nombre completo', 201);
    const roles = validRoles(body?.roles);
    const needsLogin = roles.includes('SITE_MANAGER') || roles.includes('ADMINISTRATOR');
    const login = credentials(body, needsLogin);
    if (needsLogin && !login.password) throw new BadRequestException('Definí la contraseña del usuario');
    return this.db.transaction(async (manager) => {
      if (login.email && (await manager.getRepository(Administrator).createQueryBuilder('admin')
        .where('LOWER(admin.email) = :email', { email: login.email }).getExists()))
        throw new ConflictException('Ese email ya está en uso');
      if (login.email && (await manager.getRepository(Person).createQueryBuilder('person')
        .where('LOWER(person.email) = :email', { email: login.email }).getExists()))
        throw new ConflictException('Ese email ya está en uso');
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
        email: login.email,
        passwordHash: login.password ? await hash(login.password, 12) : null,
      });
      await manager.getRepository(Person).insert(person);
      await manager.getRepository(PersonRole).insert(
        roles.map((roleCode) => ({
          personId: person.id,
          administratorId,
          roleCode,
        })),
      );
      return { id: person.id, fullName, email: person.email, isActive: true, roles };
    });
  }

  async update(
    administratorId: string,
    id: string,
    body: { fullName?: unknown; isActive?: unknown; roles?: unknown; email?: unknown; password?: unknown },
  ) {
    return this.db.transaction(async (manager) => {
      const person = await this.person(manager, administratorId, id);
      const roles = body.roles === undefined ? null : validRoles(body.roles);
      const previousRoles = await manager.getRepository(PersonRole).findBy({ administratorId, personId: id });
      const hadLoginRole = previousRoles.some((role) => role.roleCode === 'SITE_MANAGER' || role.roleCode === 'ADMINISTRATOR');
      const login = credentials(body, false);
      if (login.email && login.email !== person.email && (await manager.getRepository(Administrator).createQueryBuilder('admin')
        .where('LOWER(admin.email) = :email', { email: login.email }).getExists()))
        throw new ConflictException('Ese email ya está en uso');
      if (login.email && login.email !== person.email && (await manager.getRepository(Person).createQueryBuilder('other')
        .where('LOWER(other.email) = :email AND other.id <> :id', { email: login.email, id }).getExists()))
        throw new ConflictException('Ese email ya está en uso');
      if (roles) {
        const existing = await manager.getRepository(PersonRole).findBy({
          administratorId,
          personId: id,
          roleCode: In([...PERSONAL_ROLES, 'ADMINISTRATOR']),
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
      const effectiveRoles = roles ?? (await manager.getRepository(PersonRole).findBy({ administratorId, personId: id })).map((role) => role.roleCode);
      const needsLogin = effectiveRoles.includes('SITE_MANAGER') || effectiveRoles.includes('ADMINISTRATOR');
      if (body.email !== undefined) person.email = login.email;
      if (login.password) person.passwordHash = await hash(login.password, 12);
      if (needsLogin && (!person.email || !person.passwordHash) &&
        (body.email !== undefined || !!login.password || !hadLoginRole))
        throw new BadRequestException('El usuario necesita email y contraseña');
      if (!needsLogin) { person.email = null; person.passwordHash = null; }
      if (body.email !== undefined || login.password || roles) person.sessionVersion = sessionAfter(person.sessionVersion);
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
        email: person.email,
        isActive: person.isActive,
        roles: currentRoles.map((role) => role.roleCode),
      };
    });
  }

  async rotateCode(administratorId: string, id: string, ip: string | null = null, actorPersonId: string | null = null) {
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
          await recordPersonalEvent(manager, 'PIN_ROTATED', ip, id, administratorId, actorPersonId);
          this.logger.log(JSON.stringify({ event: 'personal_access', result: 'PIN_ROTATED', ip, personId: id, administratorId, actorPersonId }));
          return { personId: id, code };
        });
      } catch (error) {
        if ((error as { code?: string }).code !== '23505' || attempt === 4)
          throw error;
      }
    }
    throw new ConflictException('No se pudo generar un código único');
  }

  async unlock(administratorId: string, id: string, ip: string | null = null, actorPersonId: string | null = null) {
    return this.db.transaction(async (manager) => {
      const person = await this.person(manager, administratorId, id);
      const lookup = await manager.getRepository(Person).createQueryBuilder('person')
        .addSelect('person.pinLookupHmac')
        .where('person.id = :id', { id }).getOne();
      person.failedAttempts = 0;
      person.lockedUntil = null;
      person.updatedAt = new Date();
      await manager.getRepository(Person).save(person);
      if (lookup?.pinLookupHmac) await clearCodeLookupForManager(manager, lookup.pinLookupHmac);
      await recordPersonalEvent(manager, 'UNLOCKED', ip, id, administratorId, actorPersonId);
      this.logger.log(JSON.stringify({ event: 'personal_access', result: 'UNLOCKED', ip, personId: id, administratorId, actorPersonId }));
      return { id, failedAttempts: 0, lockedUntil: null };
    });
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
    const history = assignments.map((assignment) => ({
      id: assignment.id,
      personId: assignment.personId,
      personName: assignment.person.fullName,
      roleCode: assignment.roleCode,
      isPrimary: assignment.isPrimary,
      assignedAt: assignment.assignedAt,
      unassignedAt: assignment.unassignedAt,
      active: assignment.unassignedAt === null,
    }));
    if (!assignments.some(assignment => assignment.roleCode === 'FOREMAN' && assignment.isPrimary && assignment.unassignedAt === null)) {
      const foreman = await this.db.getRepository(Foreman).findOneBy({ administratorId, id: work.foremanId });
      if (foreman) history.unshift({
        id: `current-foreman-${work.id}`,
        personId: work.foremanId,
        personName: `${foreman.firstName} ${foreman.lastName}`,
        roleCode: 'FOREMAN',
        isPrimary: true,
        assignedAt: work.createdAt,
        unassignedAt: null,
        active: true,
      });
    }
    return history;
  }

  async assign(
    administratorId: string,
    workId: string,
    body: { personId?: unknown; roleCode?: unknown; isPrimary?: unknown },
  ) {
    const personId = required(body?.personId, 'Persona', 36);
    if (body?.roleCode !== 'SITE_MANAGER' && body?.roleCode !== 'FOREMAN')
      throw new BadRequestException('Rol de obra inválido');
    const roleCode = body.roleCode;
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
      const work = await manager.getRepository(Work).createQueryBuilder('work')
        .where('work.id = :workId AND work.administratorId = :administratorId', { workId, administratorId })
        .setLock('pessimistic_write').getOne();
      if (!work) throw new NotFoundException('Obra no encontrada');
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
        if (assignment.isPrimary && assignment.roleCode === 'FOREMAN')
          throw new BadRequestException('El capataz principal se cambia al editar la obra');
        if (assignment.roleCode === 'SITE_MANAGER') {
          const activeManagers = await manager.getRepository(WorkAssignment).countBy({
            administratorId, workId, roleCode: 'SITE_MANAGER', unassignedAt: IsNull(),
          });
          if (activeManagers <= 1)
            throw new BadRequestException('La obra debe conservar un jefe de obra');
        }
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
    return this.people.rotateCode(request.administratorId, id, request.ip ?? null, request.administratorPersonId ?? null);
  }

  @Post(':id/unlock')
  unlock(@Req() request: AdminRequest, @Param('id') id: string) {
    return this.people.unlock(request.administratorId, id, request.ip ?? null, request.administratorPersonId ?? null);
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
