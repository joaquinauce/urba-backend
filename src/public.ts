import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import type { Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { DB } from './database.module.js';
import { DailyGoal, DailyReport, Work } from './database/entities.js';
import { AdminService } from './admin.js';
import { normalizeAlias } from './admin.js';
import { ReportsService } from './reports.js';
import { codeHash, localNow } from './shared.js';

export type PublicWork = Work & { foremanName: string };

@Injectable()
export class PublicService {
  private attempts = new Map<string, { count: number; until: number }>();
  private aliasAttempts = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(DB) private readonly db: DataSource,
    private readonly admin: AdminService,
    private readonly reports: ReportsService,
    private readonly jwt: JwtService,
  ) {}
  async aliases(ip: string): Promise<{ alias: string }[]> {
    this.limit(ip);
    return this.db
      .getRepository(Work)
      .createQueryBuilder('work')
      .innerJoin('work.primaryForeman', 'foreman')
      .select('work.accessAlias', 'alias')
      .where('work.accessAlias IS NOT NULL')
      .andWhere('work.status = :status', { status: 'ACTIVA' })
      .andWhere('foreman.isActive = :active', { active: true })
      .orderBy('work.accessAlias', 'ASC')
      .getRawMany<{ alias: string }>();
  }
  async aliasLogin(aliasInput: unknown, pin: unknown, ip: string) {
    this.limit(ip);
    const alias = normalizeAlias(aliasInput);
    const key = `${ip}:${alias ?? ''}`;
    const now = Date.now();
    const item = this.aliasAttempts.get(key);
    const next =
      !item || item.until < now
        ? { count: 1, until: now + 15 * 60_000 }
        : { count: item.count + 1, until: item.until };
    this.aliasAttempts.set(key, next);
    if (next.count > 8)
      throw new HttpException(
        'Demasiados intentos; volvé a intentar más tarde',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    if (this.aliasAttempts.size > 10_000)
      for (const [k, v] of this.aliasAttempts)
        if (v.until < now) this.aliasAttempts.delete(k);
    const work =
      alias && typeof pin === 'string' && /^\d{6}$/.test(pin)
        ? await this.db
            .getRepository(Work)
            .createQueryBuilder('work')
            .innerJoin('work.primaryForeman', 'foreman')
            .addSelect('work.aliasPinHash')
            .where('work.accessAlias = :alias', { alias })
            .andWhere('work.status = :status', { status: 'ACTIVA' })
            .andWhere('foreman.isActive = :active', { active: true })
            .getOne()
        : null;
    const valid = work
      ? await compare(pin as string, work.aliasPinHash!)
      : false;
    if (!work) await hash('000000', 12);
    if (!work || !valid) {
      throw new UnauthorizedException('Alias o PIN incorrectos');
    }
    this.aliasAttempts.delete(key);
    return {
      accessToken: await this.jwt.signAsync(
        {
          type: 'foreman',
          workId: work.id,
          version: String(work.aliasSessionVersion),
        },
        { expiresIn: '8h' },
      ),
    };
  }
  async session(req: Request) {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{
        type: string;
        workId: string;
        version: string;
      }>(header.slice(7));
      if (payload.type !== 'foreman' || !payload.workId)
        throw new Error('invalid');
      const work = await this.db.getRepository(Work).findOne({
        where: { id: payload.workId, status: 'ACTIVA' },
        relations: { primaryForeman: true },
      });
      if (
        !work ||
        !work.accessAlias ||
        !work.primaryForeman.isActive ||
        String(work.aliasSessionVersion) !== payload.version
      )
        throw new Error('revoked');
      return Object.assign(work, {
        foremanName: `${work.primaryForeman.firstName} ${work.primaryForeman.lastName}`,
      }) as PublicWork;
    } catch {
      throw new UnauthorizedException(
        'La sesión del capataz venció. Volvé a ingresar.',
      );
    }
  }
  private limit(ip: string) {
    const now = Date.now();
    const item = this.attempts.get(ip);
    const next =
      !item || item.until < now
        ? { count: 1, until: now + 60_000 }
        : { count: item.count + 1, until: item.until };
    this.attempts.set(ip, next);
    if (next.count > 60)
      throw new HttpException(
        'Demasiados intentos; esperá un minuto',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    if (this.attempts.size > 10_000)
      for (const [key, value] of this.attempts)
        if (value.until < now) this.attempts.delete(key);
  }
  async resolve(code: string, ip: string) {
    this.limit(ip);
    if (!/^[A-Za-z0-9_-]{32}$/.test(code))
      throw new BadRequestException('Código inválido');
    const work = await this.db.getRepository(Work).findOne({
      where: { accessCodeHash: codeHash(code) },
      relations: { primaryForeman: true },
    });
    if (!work) throw new NotFoundException('Recurso no encontrado');
    return Object.assign(work, {
      foremanName: `${work.primaryForeman.firstName} ${work.primaryForeman.lastName}`,
    }) as PublicWork;
  }
  async today(code: string, ip: string) {
    return this.todayFor(await this.resolve(code, ip));
  }
  async todayFor(work: PublicWork) {
    const { date, time } = localNow(work.timeZone);
    await this.admin.materialize(work.administratorId, work.id, date);
    const goalEntities = await this.db.getRepository(DailyGoal).find({
      where: { workId: work.id, workDate: date, isActive: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const goals = goalEntities.map((goal) => ({
      id: goal.id,
      description: goal.description,
      expectedQuantity: goal.expectedQuantity,
      unit: goal.unit,
      customUnit: goal.customUnit,
      quantityStep: goal.quantityStep,
      quantityDecimals: goal.quantityDecimals,
    }));
    const existing = await this.db.getRepository(DailyReport).findOne({
      select: { id: true },
      where: { workId: work.id, workDate: date },
    });
    const report = existing
      ? await this.reports.detail(existing.id, work.administratorId)
      : null;
    return {
      work: { id: work.id, name: work.name, foremanName: work.foremanName },
      date,
      goals,
      report,
      editable: work.status === 'ACTIVA' && time < work.closeTime.slice(0, 5),
      closeTime: work.closeTime.slice(0, 5),
    };
  }
  async submit(code: string, ip: string, body: any) {
    return this.reports.submit(await this.resolve(code, ip), body);
  }
  async upload(
    code: string,
    ip: string,
    reportId: string,
    file: Express.Multer.File,
  ) {
    const work = await this.resolve(code, ip);
    return this.reports.uploadPhoto(work.administratorId, reportId, file, work);
  }
  async photo(code: string, ip: string, photoId: string) {
    const work = await this.resolve(code, ip);
    return this.reports.photo(work.administratorId, photoId, work.id);
  }
}

@Controller('public')
export class AliasController {
  constructor(
    private readonly service: PublicService,
    private readonly reports: ReportsService,
  ) {}
  @Get('aliases') aliases(@Req() req: Request) {
    return this.service.aliases(req.ip ?? 'unknown');
  }
  @Post('alias/login') login(
    @Body() body: { alias: unknown; pin: unknown },
    @Req() req: Request,
  ) {
    return this.service.aliasLogin(body?.alias, body?.pin, req.ip ?? 'unknown');
  }
  @Get('session/today') async today(@Req() req: Request) {
    return this.service.todayFor(await this.service.session(req));
  }
  @Post('session/reports') async submit(
    @Req() req: Request,
    @Body() body: any,
  ) {
    return this.reports.submit(await this.service.session(req), body);
  }
  @Post('session/reports/:reportId/photos')
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: 12 * 1024 * 1024 } }),
  )
  async upload(
    @Req() req: Request,
    @Param('reportId') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const work = await this.service.session(req);
    return this.reports.uploadPhoto(work.administratorId, id, file, work);
  }
  @Get('session/photos/:id') async photo(
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const work = await this.service.session(req);
    res
      .type('image/webp')
      .send(await this.reports.photo(work.administratorId, id, work.id));
  }
}

@Controller('public/works/:code')
export class PublicController {
  constructor(private readonly service: PublicService) {}
  @Get('today') today(@Param('code') code: string, @Req() req: Request) {
    return this.service.today(code, req.ip ?? 'unknown');
  }
  @Post('reports') submit(
    @Param('code') code: string,
    @Req() req: Request,
    @Body() body: any,
  ) {
    return this.service.submit(code, req.ip ?? 'unknown', body);
  }
  @Post('reports/:reportId/photos')
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: 12 * 1024 * 1024 } }),
  )
  upload(
    @Param('code') code: string,
    @Req() req: Request,
    @Param('reportId') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.upload(code, req.ip ?? 'unknown', id, file);
  }
  @Get('photos/:id') async photo(
    @Param('code') code: string,
    @Req() req: Request,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    res
      .type('image/webp')
      .send(await this.service.photo(code, req.ip ?? 'unknown', id));
  }
}
