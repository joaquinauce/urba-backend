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
import { createHash, randomBytes } from 'node:crypto';
import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';
import { DB } from './database.module.js';
import {
  Administrator,
  ClientMembership,
  ClientInvitation,
  ClientRole,
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
import { lockIdentityEmail } from './identity-lock.js';

type ManagedRole = PersonalRole | 'ADMINISTRATOR';
function validRoles(value: unknown, allowEmpty = false): ManagedRole[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 3)
    throw new BadRequestException('Elegí al menos un rol válido');
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
    clientId: string,
    id: string,
  ) {
    const person = await manager.getRepository(Person).createQueryBuilder('person')
      .innerJoin('person.clientMemberships', 'membership', 'membership.clientId = :clientId', { clientId })
      .addSelect('person.passwordHash')
      .where('person.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
    if (!person || person.administratorSourceId)
      throw new NotFoundException('Persona no encontrada');
    return person;
  }

  async list(administratorId: string, clientId = administratorId) {
    const people = await this.db
      .getRepository(Person)
      .createQueryBuilder('person')
      .innerJoin('person.clientMemberships', 'membership', 'membership.clientId = :clientId', { clientId })
      .addSelect('person.pinLookupHmac')
      .addSelect('person.passwordHash')
      .where('person.administratorSourceId IS NULL')
      .orderBy('person.fullName', 'ASC')
      .getMany();
    if (!people.length) return [];
    const ids = people.map((person) => person.id);
    const [roles, assignments, memberships] = await Promise.all([
      this.db.getRepository(ClientRole).findBy({
        clientId,
        personId: In(ids),
      }),
      this.db.getRepository(WorkAssignment).findBy({
        clientId,
        personId: In(ids),
        unassignedAt: IsNull(),
      }),
      this.db.getRepository(ClientMembership).findBy({ clientId, personId: In(ids) }),
    ]);
    return people.map((person) => ({
      id: person.id,
      fullName: person.fullName,
      shared: person.administratorId !== administratorId,
      isActive: person.isActive && memberships.some((membership) => membership.personId === person.id && membership.isActive),
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
    clientId = administratorId,
  ) {
    const roles = validRoles(body?.roles);
    if (roles.length !== 1) throw new BadRequestException('Elegí un rol inicial');
    const needsLogin = roles.includes('SITE_MANAGER') || roles.includes('ADMINISTRATOR');
    const login = credentials(body, false);
    return this.db.transaction(async (manager) => {
      if (login.email) await lockIdentityEmail(manager, login.email);
      if (login.email && (await manager.getRepository(Administrator).createQueryBuilder('admin')
        .where('LOWER(BTRIM(admin.email)) = :email', { email: login.email }).getExists()))
        throw new ConflictException('Ese email ya está en uso');
      const existing = login.email ? await manager.getRepository(Person).createQueryBuilder('person')
        .where('LOWER(BTRIM(person.email)) = :email', { email: login.email }).getOne() : null;
      const available = await manager
        .getRepository(Role)
        .countBy({ code: In(roles) });
      if (available !== roles.length)
        throw new ConflictException(
          'Los roles requeridos no están disponibles',
        );
      if (existing) {
        if (!existing.isActive) throw new ConflictException('La cuenta no está activa para recibir invitaciones');
        if (await manager.getRepository(ClientMembership).existsBy({ clientId, personId: existing.id }))
          throw new ConflictException('Ese email ya pertenece a este cliente');
        const invitations = manager.getRepository(ClientInvitation);
        await invitations.update({ clientId, personId: existing.id, roleCode: roles[0],
          acceptedAt: IsNull(), revokedAt: IsNull() }, { revokedAt: new Date() });
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
        const invitationId = uuid();
        await invitations.insert({ id: invitationId, clientId, personId: existing.id, roleCode: roles[0],
          tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt });
        return { pendingInvitation: true, email: login.email, invitationId, invitationToken: token, expiresAt };
      }
      const fullName = required(body?.fullName, 'Nombre completo', 201);
      if (needsLogin && !login.email) throw new BadRequestException('Definí el email del usuario');
      if (needsLogin && !login.password) throw new BadRequestException('Definí la contraseña del usuario');
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
    clientId = administratorId,
  ) {
    if (body.fullName !== undefined || body.email !== undefined || body.password !== undefined)
      throw new BadRequestException('Los datos y credenciales globales se cambian desde la cuenta personal');
    return this.db.transaction(async (manager) => {
      const person = await this.person(manager, clientId, id);
      const memberships = manager.getRepository(ClientMembership);
      const membership = await memberships.findOneBy({ clientId, personId: id });
      if (!membership) throw new NotFoundException('Pertenencia no encontrada');
      if (body.roles !== undefined) {
        const requested = validRoles(body.roles, true);
        const roleRepository = manager.getRepository(ClientRole);
        const existing = await roleRepository.findBy({ clientId, personId: id });
        const desired = new Set(requested);
        for (const role of existing) {
          if (desired.has(role.roleCode as ManagedRole)) continue;
          if (person.administratorId === administratorId &&
            await manager.getRepository(PersonRole).existsBy({ administratorId, personId: id, roleCode: role.roleCode }))
            await manager.getRepository(PersonRole).delete({ administratorId, personId: id, roleCode: role.roleCode });
          else await roleRepository.delete({ clientId, personId: id, roleCode: role.roleCode });
        }
        const current = new Set(existing.map((role) => role.roleCode));
        for (const roleCode of requested) {
          if (current.has(roleCode)) continue;
          if (person.administratorId === administratorId)
            await manager.getRepository(PersonRole).insert({ administratorId, personId: id, roleCode });
          else await roleRepository.insert({ clientId, personId: id, roleCode });
        }
      }
      if (body.isActive !== undefined) {
        if (typeof body.isActive !== 'boolean') throw new BadRequestException('Estado inválido');
        membership.isActive = body.isActive;
        membership.updatedAt = new Date();
        await memberships.save(membership);
      }
      const currentRoles = await manager.getRepository(ClientRole).findBy({ clientId, personId: id });
      return { id, fullName: person.fullName, email: person.email,
        isActive: person.isActive && membership.isActive,
        roles: currentRoles.map((role) => role.roleCode) };
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
          if (await manager.getRepository(ClientMembership).countBy({ personId: id }) > 1)
            throw new BadRequestException('El código global de una persona compartida debe gestionarlo su titular');
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
      if (await manager.getRepository(ClientMembership).countBy({ personId: id }) > 1)
        throw new BadRequestException('El acceso global de una persona compartida debe gestionarlo su titular');
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

  async assignments(administratorId: string, workId: string, clientId = administratorId) {
    const work = await this.db.getRepository(Work).findOneBy({
      id: workId,
      administratorId,
      clientId,
    });
    if (!work) throw new NotFoundException('Obra no encontrada');
    const assignments = await this.db.getRepository(WorkAssignment).find({
      where: { administratorId, clientId, workId },
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
    clientId = administratorId,
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
            'work.id = :workId AND work.administratorId = :administratorId AND work.clientId = :clientId',
            { workId, administratorId, clientId },
          )
          .setLock('pessimistic_write')
          .getOne();
        if (!work) throw new NotFoundException('Obra no encontrada');
        const person = await this.person(manager, clientId, personId);
        if (!person.isActive)
          throw new BadRequestException('La persona está inactiva');
        if (!(await manager.getRepository(ClientMembership).existsBy({ clientId, personId, isActive: true })))
          throw new BadRequestException('La persona no está activa en este cliente');
        const role = await manager.getRepository(ClientRole).findOneBy({
          clientId,
          personId,
          roleCode,
        });
        if (!role) throw new BadRequestException('La persona no posee ese rol');
        const assignedAt = new Date();
        const assignment = manager.getRepository(WorkAssignment).create({
          id: uuid(),
          administratorId,
          clientId,
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
    clientId = administratorId,
  ) {
    return this.db.transaction(async (manager) => {
      const work = await manager.getRepository(Work).createQueryBuilder('work')
        .where('work.id = :workId AND work.administratorId = :administratorId AND work.clientId = :clientId', { workId, administratorId, clientId })
        .setLock('pessimistic_write').getOne();
      if (!work) throw new NotFoundException('Obra no encontrada');
      const assignment = await manager
        .getRepository(WorkAssignment)
        .createQueryBuilder('assignment')
        .where(
          'assignment.id = :assignmentId AND assignment.workId = :workId AND assignment.administratorId = :administratorId AND assignment.clientId = :clientId',
          { assignmentId, workId, administratorId, clientId },
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
    return this.people.list(request.administratorId, request.clientId);
  }

  @Post()
  create(@Req() request: AdminRequest, @Body() body: any) {
    return this.people.create(request.administratorId, body, request.clientId);
  }

  @Patch(':id')
  update(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.people.update(request.administratorId, id, body, request.clientId);
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
    return this.people.assignments(request.administratorId, workId, request.clientId);
  }

  @Post()
  assign(
    @Req() request: AdminRequest,
    @Param('workId') workId: string,
    @Body() body: any,
  ) {
    return this.people.assign(request.administratorId, workId, body, request.clientId);
  }

  @Patch(':assignmentId/unassign')
  unassign(
    @Req() request: AdminRequest,
    @Param('workId') workId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.people.unassign(request.administratorId, workId, assignmentId, request.clientId);
  }
}
