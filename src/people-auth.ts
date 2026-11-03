import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
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
import { Person, PersonRole, WorkAssignment } from './database/entities.js';

export const PERSONAL_ROLES = ['SITE_MANAGER', 'FOREMAN'] as const;
export type PersonalRole = (typeof PERSONAL_ROLES)[number];

export type PersonActor = {
  kind: 'person';
  id: string;
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
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();

  constructor(
    @Inject(DB) private readonly db: DataSource,
    private readonly jwt: JwtService,
  ) {
    hmacSecret();
  }

  private limit(ip: string) {
    const now = Date.now();
    const current = this.attempts.get(ip);
    const next =
      !current || current.until < now
        ? { count: 1, until: now + 15 * 60_000 }
        : { count: current.count + 1, until: current.until };
    this.attempts.set(ip, next);
    if (this.attempts.size > 10_000)
      for (const [key, value] of this.attempts)
        if (value.until < now) this.attempts.delete(key);
    if (next.count > 12)
      throw new HttpException(
        'Demasiados intentos. Volvé a intentar más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  async login(code: unknown, ip: string) {
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
      if (!person) return { state: 'unknown' as const };
      const now = new Date();
      if (!person.isActive)
        return { state: 'denied' as const, person, locked: false };
      if (person.lockedUntil && person.lockedUntil > now)
        return { state: 'denied' as const, person, locked: true };
      const matches = !!person.pinHash && (await compare(code, person.pinHash));
      if (!matches) {
        person.failedAttempts += 1;
        if (person.failedAttempts >= 5) {
          person.lockedUntil = new Date(Date.now() + 15 * 60_000);
          person.failedAttempts = 0;
        }
        person.updatedAt = now;
        await manager.getRepository(Person).save(person);
        return { state: 'denied' as const, person, locked: false };
      }
      const roles = (
        await manager.getRepository(PersonRole).findBy({
          personId: person.id,
          administratorId: person.administratorId,
          roleCode: In([...PERSONAL_ROLES]),
        })
      ).map((role) => role.roleCode as PersonalRole);
      if (!roles.length)
        return { state: 'denied' as const, person, locked: false };
      person.failedAttempts = 0;
      person.lockedUntil = null;
      person.lastAccessAt = now;
      person.updatedAt = now;
      await manager.getRepository(Person).save(person);
      return { state: 'ok' as const, person, roles };
    });
    if (result.state === 'unknown') {
      await hash(code, 12);
      throw new UnauthorizedException('Código incorrecto');
    }
    if (result.state !== 'ok')
      throw new UnauthorizedException(
        result.locked ? 'Acceso temporalmente bloqueado' : 'Código incorrecto',
      );
    this.attempts.delete(ip);
    return {
      accessToken: await this.jwt.signAsync(
        {
          type: 'person',
          sub: result.person.id,
          administratorId: result.person.administratorId,
          version: String(result.person.sessionVersion),
        },
        { expiresIn: '8h' },
      ),
      person: {
        id: result.person.id,
        administratorId: result.person.administratorId,
        fullName: result.person.fullName,
        roles: result.roles,
      },
    };
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
        administratorId: string;
        version: string;
      }>(header.slice(7));
      if (payload.type !== 'person' || !payload.sub) throw new Error('invalid');
      const person = await this.db.getRepository(Person).findOneBy({
        id: payload.sub,
        administratorId: payload.administratorId,
        isActive: true,
      });
      if (!person || String(person.sessionVersion) !== String(payload.version))
        throw new Error('revoked');
      const roles = (
        await this.db.getRepository(PersonRole).findBy({
          personId: person.id,
          administratorId: person.administratorId,
          roleCode: In([...PERSONAL_ROLES]),
        })
      ).map((role) => role.roleCode as PersonalRole);
      if (!roles.length) throw new Error('role');
      request.actor = {
        kind: 'person',
        id: person.id,
        administratorId: person.administratorId,
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

  async authorize(actor: PersonActor, workId: string, write = false) {
    const allowedRoles: PersonalRole[] = write
      ? ['FOREMAN']
      : ['SITE_MANAGER', 'FOREMAN'];
    const effectiveRoles = actor.roles.filter((role) =>
      allowedRoles.includes(role),
    );
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
}

@Controller('auth/personal')
export class PersonAuthController {
  constructor(private readonly auth: PersonAuthService) {}

  @Post('login')
  login(@Body() body: { code?: unknown }, @Req() request: Request) {
    return this.auth.login(body?.code, request.ip ?? 'unknown');
  }

  @Get('me')
  @UseGuards(PersonJwtGuard)
  async me(@Req() request: PersonRequest) {
    return request.actor;
  }
}
