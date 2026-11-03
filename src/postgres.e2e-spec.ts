import {
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { types } from 'pg';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminService } from './admin.js';
import { AuthService, JwtGuard, type AdminRequest } from './auth.js';
import { dataSourceOptions } from './database/data-source.js';
import {
  Activity,
  Administrator,
  DailyGoal,
  DailyReport,
  DailyReportItem,
  Foreman,
  GoalRecurrence,
  Person,
  PersonRole,
  ReportCorrection,
  ReportPhoto,
  Role,
  Work,
  WorkAssignment,
} from './database/entities.js';
import { PublicService } from './public.js';
import { ReportsService } from './reports.js';
import { HealthController } from './health.js';

const integration =
  process.env.RUN_PG_READ_INTEGRATION === 'true' ? describe : describe.skip;

integration('PostgreSQL en modo de solo lectura', () => {
  let db: DataSource;
  let admin: AdminService;
  let reports: ReportsService;
  let publicService: PublicService;
  let jwt: JwtService;
  let administrator: Administrator;
  let work: Work;

  beforeAll(async () => {
    types.setTypeParser(types.builtins.DATE, (value) => value);
    const options = dataSourceOptions();
    db = new DataSource({
      ...options,
      extra: {
        ...options.extra,
        application_name: 'beurba_read_integration',
        options: '-c default_transaction_read_only=on',
      },
    });
    await db.initialize();
    admin = new AdminService(db);
    reports = new ReportsService(db, admin);
    jwt = new JwtService({ secret: process.env.JWT_SECRET });
    publicService = new PublicService(db, admin, reports, jwt);

    const foundAdministrator = await db
      .getRepository(Administrator)
      .findOneBy({ isActive: true });
    if (!foundAdministrator)
      throw new Error('La base no contiene un administrador activo de prueba');
    administrator = foundAdministrator;

    const foundWork = await db.getRepository(Work).findOneBy({
      administratorId: administrator.id,
    });
    if (!foundWork)
      throw new Error('La base no contiene una obra para validar las lecturas');
    work = foundWork;
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  it('no detecta diferencias entre el esquema real y los metadatos TypeORM', async () => {
    const connection = await db
      .createQueryBuilder()
      .select(`current_setting('transaction_read_only')`, 'readOnly')
      .from('pg_catalog.pg_database', 'database_catalog')
      .where('database_catalog.datname = current_database()')
      .getRawOne<{ readOnly: string }>();
    expect(connection?.readOnly).toBe('on');
    await expect(new HealthController(db).check()).resolves.toMatchObject({
      status: 'ok',
    });

    const schema = await db.driver.createSchemaBuilder().log();
    expect(schema.upQueries.map(({ query }) => query)).toEqual([]);
    expect(schema.downQueries.map(({ query }) => query)).toEqual([]);
  });

  it('lee las 14 entidades y sus relaciones principales', async () => {
    const repositories = [
      Administrator,
      Foreman,
      Work,
      Activity,
      GoalRecurrence,
      DailyGoal,
      DailyReport,
      DailyReportItem,
      ReportPhoto,
      ReportCorrection,
      Role,
      Person,
      PersonRole,
      WorkAssignment,
    ] as const;
    for (const entity of repositories)
      await db.getRepository(entity).find({ take: 1 });

    const relatedWork = await db.getRepository(Work).findOne({
      where: { id: work.id },
      relations: {
        administrator: true,
        primaryForeman: true,
        activities: true,
        recurrences: true,
        goals: true,
        reports: true,
        assignments: true,
      },
    });
    expect(relatedWork?.administrator.id).toBe(administrator.id);
    expect(relatedWork?.primaryForeman.id).toBe(work.foremanId);

    const relatedForeman = await db.getRepository(Foreman).findOne({
      where: { id: work.foremanId, administratorId: administrator.id },
      relations: { administrator: true, person: true },
    });
    expect(relatedForeman?.administrator.id).toBe(administrator.id);

    await db.getRepository(Person).find({
      take: 1,
      relations: {
        administrator: true,
        administratorSource: true,
        foremanSource: true,
        roles: { role: true },
        workAssignments: { work: true, personRole: true },
      },
    });
  });

  it('valida autenticación administrativa negativa y JWT activo/revocado', async () => {
    const auth = new AuthService(db, jwt);
    await expect(
      auth.login(
        administrator.email,
        'clave-deliberadamente-incorrecta',
        'pg-read-integration',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const guard = new JwtGuard(jwt, db);
    const token = await jwt.signAsync({ sub: administrator.id });
    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as AdminRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.administratorId).toBe(administrator.id);

    const revokedToken = await jwt.signAsync({ sub: randomUUID() });
    request.headers.authorization = `Bearer ${revokedToken}`;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lista y obtiene obras preservando fechas, NULL y tipos numéricos', async () => {
    const works = await admin.works(administrator.id);
    expect(works.some(({ id }) => id === work.id)).toBe(true);
    const detail = await admin.work(administrator.id, work.id);
    expect(detail.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(detail.estimatedEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      detail.description === null || typeof detail.description === 'string',
    ).toBe(true);

    const goal = await db.getRepository(DailyGoal).findOneBy({
      administratorId: administrator.id,
      workId: work.id,
    });
    if (goal) {
      expect(goal.workDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof goal.expectedQuantity).toBe('string');
      expect(
        goal.quantityStep === null || typeof goal.quantityStep === 'string',
      ).toBe(true);
    }
  });

  it('lee objetivos y recurrencias sin materializar ni escribir', async () => {
    const recurrences = await admin.recurrences(administrator.id, work.id);
    for (const recurrence of recurrences) {
      expect(recurrence.startsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(recurrence.endsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof recurrence.expectedQuantity).toBe('string');
    }
    const goals = await db.getRepository(DailyGoal).find({
      where: { administratorId: administrator.id, workId: work.id },
      relations: { activity: true, recurrence: true },
    });
    expect(goals.every((goal) => goal.activity.workId === work.id)).toBe(true);
  });

  it('lee informes, agregaciones, fotografías y correcciones', async () => {
    const list = await reports.list(administrator.id, work.id);
    const corrections = await db.getRepository(ReportCorrection).find({
      where: { administratorId: administrator.id, workId: work.id },
      relations: { report: true, administrator: true, correctedBy: true },
    });
    expect(Array.isArray(corrections)).toBe(true);
    await db.getRepository(ReportPhoto).find({
      where: { administratorId: administrator.id, workId: work.id },
      relations: { report: true },
    });

    if (list[0]) {
      const detail = await reports.detail(list[0].id, administrator.id);
      const expectedCompliance = detail.items.length
        ? Math.round(
            detail.items.reduce(
              (sum, item) =>
                sum +
                Math.min(
                  100,
                  (Number(item.actual) / Number(item.expected)) * 100,
                ),
              0,
            ) / detail.items.length,
          )
        : null;
      expect(detail.compliance).toBe(expectedCompliance);
      expect(detail.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(detail.submittedAt).toBeInstanceOf(Date);
    }
  });

  it('valida sesión pública JWT sin conocer ni exponer el PIN', async () => {
    const aliases = await publicService.aliases('pg-read-integration-alias');
    expect(Array.isArray(aliases)).toBe(true);
    if (!work.accessAlias || work.status !== 'ACTIVA') return;

    const token = await jwt.signAsync({
      type: 'foreman',
      workId: work.id,
      version: String(work.aliasSessionVersion),
    });
    const resolved = await publicService.session({
      headers: { authorization: `Bearer ${token}` },
    } as Request);
    expect(resolved.id).toBe(work.id);
    expect(resolved.foremanName).not.toBe('');
  });

  it('impide lecturas cruzadas entre administradores', async () => {
    const anotherAdministrator = randomUUID();
    await expect(admin.works(anotherAdministrator)).resolves.toEqual([]);
    await expect(
      admin.work(anotherAdministrator, work.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      reports.list(anotherAdministrator, work.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    const report = await db.getRepository(DailyReport).findOneBy({
      administratorId: administrator.id,
      workId: work.id,
    });
    if (report)
      await expect(
        reports.detail(report.id, anotherAdministrator),
      ).rejects.toBeInstanceOf(NotFoundException);
  });
});
