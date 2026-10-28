import { Body, Controller, Injectable, Post, Get, UseGuards, CanActivate, ExecutionContext, UnauthorizedException, Inject, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { DB } from './database.module.js';

export type AdminRequest = Request & { administratorId: string };

@Injectable()
export class AuthService {
  private readonly attempts = new Map<string,{count:number;until:number}>();
  constructor(@Inject(DB) private readonly db: DataSource, private readonly jwt: JwtService) {}
  async login(email: string, password: string, ip: string) {
    if (typeof email !== 'string' || typeof password !== 'string') throw new UnauthorizedException('Credenciales incorrectas');
    const key=ip;
    const now=Date.now();
    const entry=this.attempts.get(key);
    const next=!entry||entry.until<now?{count:1,until:now+15*60_000}:{count:entry.count+1,until:entry.until};
    this.attempts.set(key,next);
    if(next.count>10) throw new UnauthorizedException('Demasiados intentos. Volvé a intentar más tarde.');
    if(this.attempts.size>10_000)for(const [item,value] of this.attempts)if(value.until<now)this.attempts.delete(item);
    const rows = await this.db.query('SELECT id, email, full_name, password_hash FROM administrators WHERE lower(email) = lower($1) AND is_active = true', [email.trim()]);
    const admin = rows[0];
    if (!admin || !(await compare(password, admin.password_hash))) throw new UnauthorizedException('Credenciales incorrectas');
    this.attempts.delete(key);
    return { accessToken: await this.jwt.signAsync({ sub: admin.id }), administrator: { id: admin.id, email: admin.email, fullName: admin.full_name } };
  }
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, @Inject(DB) private readonly db: DataSource) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(header.slice(7));
      const rows = await this.db.query('SELECT id FROM administrators WHERE id = $1 AND is_active = true', [payload.sub]);
      if (!rows.length) throw new Error('inactive');
      req.administratorId = payload.sub;
      return true;
    } catch { throw new UnauthorizedException(); }
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(DB) private readonly db: DataSource) {}
  @Post('login') login(@Body() body: { email: string; password: string },@Req() req:Request) { return this.auth.login(body.email, body.password,req.ip ?? 'unknown'); }
  @UseGuards(JwtGuard) @Get('me') async me(@Req() req: AdminRequest) {
    const [row] = await this.db.query('SELECT id, email, full_name AS "fullName" FROM administrators WHERE id = $1', [req.administratorId]);
    return row;
  }
}
