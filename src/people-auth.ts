import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Post,
  Body,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHmac, randomInt } from 'node:crypto';
import type { Request } from 'express';
import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';
import { DB } from './database.module.js';
import { Person, WorkAssignment } from './database/entities.js';
import { PersonalSecurityService } from './personal-security.js';
import { activeClientAccess, activeClientAccesses, legacyClientContext, scopedPersonSession } from './client-access.js';

export const PERSONAL_ROLES = ['SITE_MANAGER', 'FOREMAN'] as const;
export type PersonalRole = (typeof PERSONAL_ROLES)[number];

export type PersonActor = {
  kind: 'person';
  id: string;
  clientId: string;
  administratorId: string;
  fullName: string;
  roles: PersonalRole[];
};

export type PersonRequest = Request & { actor: PersonActor };

function hmacSecret() {
  const secret = process.env.PERSON_CODE_HMAC_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      'PERSON_CODE_HMAC_SECRET debe tener al menos 32 caracteres',
    );
  return secret;
}

export function codeLookupHmac(code: string) {
  return createHmac('sha256', hmacSecret()).update(code).digest('hex');
}

export function validPersonalCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

export async function generatePersonalCode(db: DataSource | EntityManager) {
  const repository = db.getRepository(Person);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    if (!(await repository.existsBy({ pinLookupHmac: codeLookupHmac(code) })))
      return code;
  }
  throw new Error('No se pudo generar un código personal único');
}

@Injectable()
export class PersonAuthService {
  constructor(
    @Inject(DB) private readonly db: DataSource,
    private readonly jwt: JwtService,
    private readonly security: PersonalSecurityService,
  ) {
    hmacSecret();
  }

  async login(code: unknown, ip: string) {
    const safeCode = validPersonalCode(code) ? code : 'invalid';
    try {
      await this.security.reserve(safeCode, ip);
    } catch (error) {
      await this.security.event('LOGIN_BLOCKED', ip);
      throw error;
    }
    if (!validPersonalCode(code)) {
      await hash('000000', 12);
      await this.security.event('LOGIN_FAILED', ip);
      throw new UnauthorizedException('No se pudo ingresar con ese código');
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
      if (!person) return { state: 'unknown' as const };
      const now = new Date();
      if (!person.isActive || (person.lockedUntil && person.lockedUntil > now))
        return { state: 'denied' as const, person };
      const matches = !!person.pinHash && (await compare(code, person.pinHash));
      if (!matches) {
        person.failedAttempts += 1;
        if (person.failedAttempts % 5 === 0) {
          const level = Math.min(Math.floor(person.failedAttempts / 5) - 1, 5);
          person.lockedUntil = new Date(Date.now() + 15 * 60_000 * 2 ** level);
        }
        person.updatedAt = now;
        await manager.getRepository(Person).save(person);
        return { state: 'denied' as const, person, newlyBlocked: person.failedAttempts % 5 === 0 };
      }
      const accesses = (await activeClientAccesses(manager, person.id))
        .filter((access) => access.roles.some((role) => PERSONAL_ROLES.includes(role as PersonalRole)));
      if (!accesses.length)
        return { state: 'denied' as const, person };
      person.failedAttempts = 0;
      person.lockedUntil = null;
      person.lastAccessAt = now;
      person.updatedAt = now;
      await manager.getRepository(Person).save(person);
      return { state: 'ok' as const, person, accesses };
    });
    if (result.state === 'unknown') {
      await hash(code, 12);
      await this.security.event('LOGIN_FAILED', ip);
      throw new UnauthorizedException('No se pudo ingresar con ese código');
    }
    if (result.state !== 'ok') {
      await hash('000000', 12);
      await this.security.event('newlyBlocked' in result && result.newlyBlocked ? 'LOGIN_BLOCKED' : 'LOGIN_FAILED', ip, result.person.id, result.person.administratorId);
      throw new UnauthorizedException('No se pudo ingresar con ese código');
    }
    await this.security.clearCode(code);
    await this.security.event('LOGIN_SUCCESS', ip, result.person.id, result.person.administratorId);
    if (result.accesses.length > 1) return {
      requiresClientSelection: true,
      selectionToken: await this.jwt.signAsync({ type: 'person_selection', mode: 'pin', sub: result.person.id,
        version: String(result.person.sessionVersion) }, { expiresIn: '5m' }),
      clients: result.accesses.map(({ clientId, name, roles }) => ({ clientId, name,
        roles: roles.filter((role) => PERSONAL_ROLES.includes(role as PersonalRole)) })),
    };
    return scopedPersonSession(this.jwt, result.person, result.accesses[0], 'pin');
  }

  async selectClient(selectionToken: unknown, clientId: unknown) {
    if (typeof selectionToken !== 'string' || typeof clientId !== 'string')
      throw new UnauthorizedException('Selección de cliente inválida');
    try {
      const payload = await this.jwt.verifyAsync<{ type: string; mode: string; sub: string; version: string }>(selectionToken);
      if (payload.type !== 'person_selection' || payload.mode !== 'pin') throw new Error('mode');
      const person = await this.db.getRepository(Person).findOneBy({ id: payload.sub, isActive: true });
      if (!person || String(person.sessionVersion) !== String(payload.version)) throw new Error('revoked');
      const access = await activeClientAccess(this.db, person.id, clientId, PERSONAL_ROLES);
      return scopedPersonSession(this.jwt, person, access, 'pin');
    } catch { throw new UnauthorizedException('Selección de cliente inválida'); }
  }
}

@Injectable()
export class PersonJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: DataSource,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PersonRequest>();
    const header = request.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{
        type: string;
        sub: string;
        administratorId?: string;
        clientId?: string;
        version: string;
      }>(header.slice(7));
      if (!['person', 'administrator_person'].includes(payload.type) || !payload.sub) throw new Error('invalid');
      const person = await this.db.getRepository(Person).findOneBy({
        id: payload.sub,
        isActive: true,
      });
      if (!person || String(person.sessionVersion) !== String(payload.version))
        throw new Error('revoked');
      const access = payload.clientId
        ? await activeClientAccess(this.db, person.id, payload.clientId, PERSONAL_ROLES)
        : legacyClientContext((await activeClientAccesses(this.db, person.id))
            .filter((item) => item.roles.some((role) => PERSONAL_ROLES.includes(role as PersonalRole))), payload.administratorId);
      if (payload.administratorId && payload.administratorId !== access.administratorId) throw new Error('owner');
      const roles = access.roles.filter((role): role is PersonalRole => PERSONAL_ROLES.includes(role as PersonalRole));
      if (!roles.length) throw new Error('role');
      request.actor = {
        kind: 'person',
        id: person.id,
        clientId: access.clientId,
        administratorId: access.administratorId,
        fullName: person.fullName,
        roles,
      };
      return true;
    } catch {
      throw new UnauthorizedException('La sesión personal no es válida');
    }
  }
}

@Injectable()
export class WorkAuthorizationService {
  constructor(@Inject(DB) private readonly db: DataSource) {}

  async authorize(actor: PersonActor, workId: string, _write = false) {
    const allowedRoles: PersonalRole[] = ['SITE_MANAGER', 'FOREMAN'];
    const effectiveRoles = actor.roles.filter((role) =>
      allowedRoles.includes(role),
    );
    if (!effectiveRoles.length)
      throw new ForbiddenException('El perfil no permite esta operación');
    const assignment = await this.db.getRepository(WorkAssignment).findOne({
      where: {
        clientId: actor.clientId,
        administratorId: actor.administratorId,
        personId: actor.id,
        workId,
        roleCode: In(effectiveRoles),
        unassignedAt: IsNull(),
      },
      relations: { work: true },
      order: { isPrimary: 'DESC', assignedAt: 'ASC' },
    });
    if (!assignment || assignment.work.clientId !== actor.clientId || assignment.work.administratorId !== actor.administratorId)
      throw new ForbiddenException('No tenés una asignación activa a la obra');
    return assignment.work;
  }
}

@Controller('auth/personal')
export class PersonAuthController {
  constructor(private readonly auth: PersonAuthService) {}

  @Post('login')
  login(@Body() body: { code?: unknown }, @Req() request: Request) {
    return this.auth.login(body?.code, request.ip ?? 'unknown');
  }

  @Post('select-client')
  selectClient(@Body() body: { selectionToken?: unknown; clientId?: unknown }) {
    return this.auth.selectClient(body?.selectionToken, body?.clientId);
  }

  @Get('me')
  @UseGuards(PersonJwtGuard)
  async me(@Req() request: PersonRequest) {
    return request.actor;
  }
}
