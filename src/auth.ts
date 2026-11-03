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
  Inject,
  Req,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { DB } from './database.module.js';
import { Administrator } from './database/entities.js';

export type AdminRequest = Request & { administratorId: string };

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
    if (!admin || !(await compare(password, admin.passwordHash)))
      throw new UnauthorizedException('Credenciales incorrectas');
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
      },
    };
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
      }>(header.slice(7));
      if (payload.type && payload.type !== 'administrator')
        throw new Error('profile');
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
    const administrator = await this.db.getRepository(Administrator).findOne({
      select: { id: true, email: true, fullName: true },
      where: { id: req.administratorId },
    });
    return administrator ?? undefined;
  }
}
