import {
  Body,
  Controller,
  Injectable,
  Post,
  Get,
  UseGuards,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
  Inject,
  Req,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { DB } from './database.module.js';
import { Administrator, Client, Person } from './database/entities.js';
import { activeClientAccess, activeClientAccesses, legacyAdministratorClient, legacyClientContext, scopedPersonSession } from './client-access.js';
import { isPlatformOperator } from './platform-access.js';

export type AdminRequest = Request & { administratorId: string; clientId: string; administratorPersonId?: string };
type ContextRequest = Request & { contextPersonId: string; contextMode: 'password' | 'pin' };

@Injectable()
export class AuthService {
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();
  constructor(
    @Inject(DB) private readonly db: DataSource,
    private readonly jwt: JwtService,
  ) {}
  async login(email: string, password: string, ip: string) {
    if (typeof email !== 'string' || typeof password !== 'string')
      throw new UnauthorizedException('Credenciales incorrectas');
    const key = ip;
    const now = Date.now();
    const entry = this.attempts.get(key);
    const next =
      !entry || entry.until < now
        ? { count: 1, until: now + 15 * 60_000 }
        : { count: entry.count + 1, until: entry.until };
    this.attempts.set(key, next);
    if (next.count > 10)
      throw new UnauthorizedException(
        'Demasiados intentos. Volvé a intentar más tarde.',
      );
    if (this.attempts.size > 10_000)
      for (const [item, value] of this.attempts)
        if (value.until < now) this.attempts.delete(item);
    const admin = await this.db
      .getRepository(Administrator)
      .createQueryBuilder('administrator')
      .addSelect('administrator.passwordHash')
      .where('LOWER(BTRIM(administrator.email)) = LOWER(:email)', {
        email: email.trim(),
      })
      .andWhere('administrator.isActive = :active', { active: true })
      .getOne();
    if (!admin || !(await compare(password, admin.passwordHash))) {
      const person = await this.db.getRepository(Person).createQueryBuilder('person')
        .addSelect('person.passwordHash')
        .where('LOWER(BTRIM(person.email)) = LOWER(:email)', { email: email.trim() })
        .andWhere('person.isActive = :active', { active: true }).getOne();
      if (!person?.passwordHash || !(await compare(password, person.passwordHash)))
        throw new UnauthorizedException('Credenciales incorrectas');
      const accesses = (await activeClientAccesses(this.db, person.id))
        .filter((access) => access.roles.some((role) => ['ADMINISTRATOR', 'SITE_MANAGER', 'FOREMAN'].includes(role)));
      if (!accesses.length) throw new UnauthorizedException('Credenciales incorrectas');
      this.attempts.delete(key);
      if (accesses.length > 1) return {
        requiresClientSelection: true,
        selectionToken: await this.jwt.signAsync({ type: 'person_selection', mode: 'password', sub: person.id,
          version: String(person.sessionVersion) }, { expiresIn: '5m' }),
        clients: accesses.map(({ clientId, name, roles }) => ({ clientId, name, roles })),
      };
      const session = await scopedPersonSession(this.jwt, person, accesses[0], 'password');
      if ('administrator' in session) return { ...session, administrator: { ...session.administrator,
        platformOperator: isPlatformOperator({ administratorId: accesses[0].administratorId, administratorPersonId: person.id }) } };
      return session;
    }
    const client = await legacyAdministratorClient(this.db, admin.id);
    this.attempts.delete(key);
    return {
      accessToken: await this.jwt.signAsync({
        type: 'administrator',
        sub: admin.id,
        administratorId: admin.id,
        clientId: client.id,
      }),
      administrator: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        role: 'ADMINISTRATOR',
        clientId: client.id,
        clientName: client.name,
        platformOperator: isPlatformOperator({ administratorId: admin.id }),
      },
    };
  }

  async selectClient(selectionToken: unknown, clientId: unknown) {
    if (typeof selectionToken !== 'string' || typeof clientId !== 'string')
      throw new UnauthorizedException('Selección de cliente inválida');
    try {
      const payload = await this.jwt.verifyAsync<{ type: string; mode: string; sub: string; version: string }>(selectionToken);
      if (payload.type !== 'person_selection' || payload.mode !== 'password') throw new Error('mode');
      const person = await this.db.getRepository(Person).findOneBy({ id: payload.sub, isActive: true });
      if (!person || String(person.sessionVersion) !== String(payload.version)) throw new Error('revoked');
      const access = await activeClientAccess(this.db, person.id, clientId, ['ADMINISTRATOR', 'SITE_MANAGER', 'FOREMAN']);
      const session = await scopedPersonSession(this.jwt, person, access, 'password');
      if ('administrator' in session) return { ...session, administrator: { ...session.administrator,
        platformOperator: isPlatformOperator({ administratorId: access.administratorId, administratorPersonId: person.id }) } };
      return session;
    } catch { throw new UnauthorizedException('Selección de cliente inválida'); }
  }

  async contexts(personId: string, mode: 'password' | 'pin') {
    const accesses = await activeClientAccesses(this.db, personId);
    return accesses.filter((access) => mode === 'password'
      ? access.roles.some((role) => ['ADMINISTRATOR', 'SITE_MANAGER', 'FOREMAN'].includes(role))
      : access.roles.some((role) => ['SITE_MANAGER', 'FOREMAN'].includes(role)))
      .map(({ clientId, name, roles }) => ({ clientId, name,
        roles: mode === 'pin' ? roles.filter((role) => role === 'SITE_MANAGER' || role === 'FOREMAN') : roles }));
  }

  async switchClient(personId: string, mode: 'password' | 'pin', clientId: unknown) {
    if (typeof clientId !== 'string') throw new UnauthorizedException('Cliente inválido');
    const person = await this.db.getRepository(Person).findOneBy({ id: personId, isActive: true });
    if (!person) throw new UnauthorizedException();
    const access = await activeClientAccess(this.db, personId, clientId,
      mode === 'password' ? ['ADMINISTRATOR', 'SITE_MANAGER', 'FOREMAN'] : ['SITE_MANAGER', 'FOREMAN']);
    const session = await scopedPersonSession(this.jwt, person, access, mode);
    if ('administrator' in session) return { ...session, administrator: { ...session.administrator,
      platformOperator: isPlatformOperator({ administratorId: access.administratorId, administratorPersonId: person.id }) } };
    return session;
  }

  async changePassword(administratorId: string, administratorPersonId: string | undefined, body: { currentPassword?: unknown; newPassword?: unknown }) {
    if (typeof body?.currentPassword !== 'string' || typeof body?.newPassword !== 'string' || body.newPassword.length < 10)
      throw new BadRequestException('Ingresá tu clave actual y una nueva de al menos 10 caracteres');
    if (administratorPersonId) return this.changePersonPassword(administratorPersonId, body.currentPassword, body.newPassword);
    const repository = this.db.getRepository(Administrator);
    const administrator = await repository.createQueryBuilder('administrator').addSelect('administrator.passwordHash')
      .where('administrator.id = :id', { id: administratorId }).getOne();
    if (!administrator || !(await compare(body.currentPassword, administrator.passwordHash)))
      throw new UnauthorizedException('La clave actual es incorrecta');
    administrator.passwordHash = await hash(body.newPassword, 12);
    await repository.save(administrator);
    return { updated: true };
  }

  async changePersonPassword(personId: string, currentPassword: string, newPassword: string) {
    if (newPassword.length < 10) throw new BadRequestException('La nueva clave debe tener al menos 10 caracteres');
    const repository = this.db.getRepository(Person);
    const person = await repository.createQueryBuilder('person').addSelect('person.passwordHash')
      .where('person.id = :id', { id: personId }).getOne();
    if (!person?.passwordHash || !(await compare(currentPassword, person.passwordHash)))
      throw new UnauthorizedException('La clave actual es incorrecta');
    person.passwordHash = await hash(newPassword, 12);
    person.sessionVersion = String(BigInt(person.sessionVersion) + 1n);
    person.updatedAt = new Date();
    await repository.save(person);
    return { updated: true };
  }
}

@Injectable()
export class ContextGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, @Inject(DB) private readonly db: DataSource) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ContextRequest>();
    const header = request.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{ type?: string; sub: string; version?: string; mode?: string }>(header.slice(7));
      if (!['person', 'administrator_person'].includes(payload.type ?? '')) throw new Error('profile');
      const person = await this.db.getRepository(Person).findOneBy({ id: payload.sub, isActive: true });
      if (!person || String(person.sessionVersion) !== String(payload.version)) throw new Error('revoked');
      request.contextPersonId = person.id;
      request.contextMode = payload.type === 'administrator_person' || payload.mode === 'password' ? 'password' : 'pin';
      return true;
    } catch { throw new UnauthorizedException('La sesión venció'); }
  }
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: DataSource,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{
        type?: string;
        sub: string;
        administratorId?: string;
        clientId?: string;
        version?: string;
      }>(header.slice(7));
      if (payload.type === 'administrator_person') {
        const person = await this.db.getRepository(Person).findOneBy({ id: payload.sub, isActive: true });
        if (!person || String(person.sessionVersion) !== String(payload.version) || !person.email)
          throw new Error('inactive');
        const access = payload.clientId
          ? await activeClientAccess(this.db, person.id, payload.clientId, ['ADMINISTRATOR'])
          : legacyClientContext((await activeClientAccesses(this.db, person.id))
              .filter((item) => item.roles.includes('ADMINISTRATOR')), payload.administratorId);
        if (payload.administratorId && payload.administratorId !== access.administratorId) throw new Error('owner');
        req.administratorId = access.administratorId;
        req.clientId = access.clientId;
        req.administratorPersonId = person.id;
        return true;
      }
      if (payload.type && payload.type !== 'administrator') throw new Error('profile');
      const active = await this.db
        .getRepository(Administrator)
        .existsBy({ id: payload.sub, isActive: true });
      if (!active) throw new Error('inactive');
      const client = await legacyAdministratorClient(this.db, payload.sub);
      if (payload.clientId && payload.clientId !== client.id) throw new Error('client');
      req.administratorId = payload.sub;
      req.clientId = client.id;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(DB) private readonly db: DataSource,
  ) {}
  @Post('login') login(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
  ) {
    return this.auth.login(body.email, body.password, req.ip ?? 'unknown');
  }
  @Post('select-client') selectClient(@Body() body: { selectionToken?: unknown; clientId?: unknown }) {
    return this.auth.selectClient(body?.selectionToken, body?.clientId);
  }
  @UseGuards(ContextGuard) @Get('contexts') contexts(@Req() req: ContextRequest) {
    return this.auth.contexts(req.contextPersonId, req.contextMode);
  }
  @UseGuards(ContextGuard) @Post('switch-client') switchClient(@Req() req: ContextRequest, @Body() body: { clientId?: unknown }) {
    return this.auth.switchClient(req.contextPersonId, req.contextMode, body?.clientId);
  }
  @UseGuards(JwtGuard) @Get('me') async me(@Req() req: AdminRequest) {
    const client = await this.db.getRepository(Client).findOneBy({ id: req.clientId });
    if (req.administratorPersonId) {
      const person = await this.db.getRepository(Person).findOne({
        select: { id: true, email: true, fullName: true },
        where: { id: req.administratorPersonId },
      });
      return person ? { ...person, role: 'ADMINISTRATOR', clientId: req.clientId, clientName: client?.name,
        platformOperator: isPlatformOperator(req) } : undefined;
    }
    const administrator = await this.db.getRepository(Administrator).findOne({
      select: { id: true, email: true, fullName: true },
      where: { id: req.administratorId },
    });
    return administrator ? { ...administrator, role: 'ADMINISTRATOR', clientId: req.clientId, clientName: client?.name,
      platformOperator: isPlatformOperator(req) } : undefined;
  }
  @UseGuards(JwtGuard) @Post('password') password(@Req() req: AdminRequest, @Body() body: { currentPassword?: unknown; newPassword?: unknown }) {
    return this.auth.changePassword(req.administratorId, req.administratorPersonId, body);
  }
}
