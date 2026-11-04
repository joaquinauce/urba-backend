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
import { Administrator, Person, PersonRole } from './database/entities.js';

export type AdminRequest = Request & { administratorId: string; administratorPersonId?: string };

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
      if (!roles.includes('SITE_MANAGER')) throw new UnauthorizedException('Credenciales incorrectas');
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
        version?: string;
      }>(header.slice(7));
      if (payload.type === 'administrator_person') {
        const person = await this.db.getRepository(Person).findOneBy({ id: payload.sub,
          administratorId: payload.administratorId, isActive: true });
        if (!person || String(person.sessionVersion) !== String(payload.version) || !person.email)
          throw new Error('inactive');
        if (!(await this.db.getRepository(PersonRole).existsBy({
          personId: person.id, administratorId: person.administratorId, roleCode: 'ADMINISTRATOR',
        }))) throw new Error('role');
        req.administratorId = person.administratorId;
        req.administratorPersonId = person.id;
        return true;
      }
      if (payload.type && payload.type !== 'administrator') throw new Error('profile');
      const active = await this.db
        .getRepository(Administrator)
        .existsBy({ id: payload.sub, isActive: true });
      if (!active) throw new Error('inactive');
      req.administratorId = payload.sub;
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
  @UseGuards(JwtGuard) @Get('me') async me(@Req() req: AdminRequest) {
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
  @UseGuards(JwtGuard) @Post('password') password(@Req() req: AdminRequest, @Body() body: { currentPassword?: unknown; newPassword?: unknown }) {
    return this.auth.changePassword(req.administratorId, req.administratorPersonId, body);
  }
}
