import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { types } from 'pg';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { DataSource, In, type DataSourceOptions } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminService } from './admin.js';
import { AuthService, JwtGuard, type AdminRequest } from './auth.js';
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
  Work,
  WorkAssignment,
  entities,
} from './database/entities.js';
import { ReportsService } from './reports.js';
import { codeHash, localNow } from './shared.js';
import { PeopleAdminService } from './people-admin.js';
import {
  PersonAuthService,
  PersonJwtGuard,
  WorkAuthorizationService,
  type PersonRequest,
} from './people-auth.js';
import { MemberService } from './member.js';

const ADMIN_1 = randomUUID();
const ADMIN_2 = randomUUID();
const FOREMAN_1 = randomUUID();
const FOREMAN_2 = randomUUID();
const FOREMAN_3 = randomUUID();
const WORK_1 = randomUUID();
const WORK_2 = randomUUID();
const WORK_3 = randomUUID();
const ACTIVITY_1 = randomUUID();
const ACTIVITY_2 = randomUUID();
const ACTIVITY_3 = randomUUID();
const GOAL_1 = randomUUID();
const GOAL_2 = randomUUID();
const REPORT_1 = randomUUID();
const RUN_TAG = ADMIN_1.slice(0, 8).toUpperCase();
const ADMIN_1_EMAIL = `integration-${RUN_TAG}-1@example.test`;
const ADMIN_2_EMAIL = `integration-${RUN_TAG}-2@example.test`;

const integration =
  process.env.RUN_PG_WRITE_INTEGRATION === 'true'
    ? describe.sequential
    : describe.skip;

function dateOffset(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function testOptions(): DataSourceOptions {
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT);
  const username = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;
  if (!host || !port || !username || !password || !database)
    throw new Error('Faltan variables DB_*');
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('DB_PORT no es válido');
  if (database !== 'Urba') throw new Error('DB_NAME debe ser exactamente Urba');
  if (process.env.ALLOW_DEV_DB_WRITES !== 'true')
    throw new Error('Falta ALLOW_DEV_DB_WRITES=true');
  if (process.env.CONFIRM_RECENT_BACKUP !== 'true')
    throw new Error('Falta CONFIRM_RECENT_BACKUP=true');
  return {
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
    entities: [...entities],
    migrations: [],
    migrationsRun: false,
    synchronize: false,
    logging: false,
    extra: { application_name: 'beurba_write_integration' },
  };
}

async function seedRun(db: DataSource) {
  const today = localNow('America/Argentina/Cordoba').date;
  const historicalDate = dateOffset(today, -2);
  await db.getRepository(Administrator).insert([
    {
      id: ADMIN_1,
      email: ADMIN_1_EMAIL,
      passwordHash: await hash('AdminTest123!', 4),
      fullName: `[E2E ${RUN_TAG}] Administradora Uno`,
    },
    {
      id: ADMIN_2,
      email: ADMIN_2_EMAIL,
      passwordHash: await hash('AdminTest456!', 4),
      fullName: `[E2E ${RUN_TAG}] Administrador Dos`,
    },
  ]);
  await db.getRepository(Foreman).insert([
    {
      id: FOREMAN_1,
      administratorId: ADMIN_1,
      firstName: 'E2E Ana',
      lastName: 'Capataz',
      phone: '+54 351 555 0001',
    },
    {
      id: FOREMAN_2,
      administratorId: ADMIN_1,
      firstName: 'E2E Bruno',
      lastName: 'Encargado',
      phone: '+54 351 555 0002',
    },
    {
      id: FOREMAN_3,
      administratorId: ADMIN_2,
      firstName: 'E2E Carla',
      lastName: 'Supervisora',
      phone: '+54 351 555 0003',
    },
  ]);
  await db.getRepository(Work).insert([
    {
      id: WORK_1,
      administratorId: ADMIN_1,
      foremanId: FOREMAN_1,
      name: `[E2E ${RUN_TAG}] Obra Alfa`,
      description: null,
      location: 'Córdoba Capital',
      startDate: dateOffset(today, -30),
      estimatedEndDate: dateOffset(today, 60),
      closeTime: '23:59:59',
      accessCodeHash: codeHash(`${RUN_TAG}A`.padEnd(32, 'A')),
      accessAlias: `TEST-${RUN_TAG}-ALFA`,
      aliasPinHash: await hash('123456', 4),
    },
    {
      id: WORK_2,
      administratorId: ADMIN_1,
      foremanId: FOREMAN_2,
      name: `[E2E ${RUN_TAG}] Obra Beta`,
      description: 'Segunda obra efímera',
      location: null,
      startDate: dateOffset(today, -10),
      estimatedEndDate: dateOffset(today, 90),
      closeTime: '23:59:59',
      accessCodeHash: codeHash(`${RUN_TAG}B`.padEnd(32, 'B')),
      accessAlias: `TEST-${RUN_TAG}-BETA`,
      aliasPinHash: await hash('654321', 4),
    },
    {
      id: WORK_3,
      administratorId: ADMIN_2,
      foremanId: FOREMAN_3,
      name: `[E2E ${RUN_TAG}] Obra Gamma`,
      description: 'Obra aislada del segundo administrador',
      location: 'Villa Allende',
      startDate: dateOffset(today, -20),
      estimatedEndDate: dateOffset(today, 45),
      closeTime: '23:59:59',
      accessCodeHash: codeHash(`${RUN_TAG}C`.padEnd(32, 'C')),
    },
  ]);
  await db.getRepository(Activity).insert([
    {
      id: ACTIVITY_1,
      administratorId: ADMIN_1,
      workId: WORK_1,
      name: 'Mampostería',
      unit: 'METROS_CUADRADOS',
    },
    {
      id: ACTIVITY_2,
      administratorId: ADMIN_1,
      workId: WORK_2,
      name: 'Hormigón',
      unit: 'METROS_CUBICOS',
    },
    {
      id: ACTIVITY_3,
      administratorId: ADMIN_2,
      workId: WORK_3,
      name: 'Pintura',
      unit: 'OTRA',
      customUnit: 'Latas',
      quantityStep: '0.500',
      quantityDecimals: 1,
    },
  ]);
  await db.getRepository(GoalRecurrence).insert([
    {
      id: randomUUID(),
      administratorId: ADMIN_1,
      workId: WORK_1,
      activityId: ACTIVITY_1,
      description: 'Levantar mampostería diaria',
      expectedQuantity: '12.500',
      startsOn: dateOffset(today, -7),
      endsOn: dateOffset(today, 7),
      daysMask: 127,
    },
    {
      id: randomUUID(),
      administratorId: ADMIN_1,
      workId: WORK_2,
      activityId: ACTIVITY_2,
      description: 'Hormigonado diario',
      expectedQuantity: '4.250',
      startsOn: dateOffset(today, -7),
      endsOn: dateOffset(today, 7),
      daysMask: 127,
    },
    {
      id: randomUUID(),
      administratorId: ADMIN_2,
      workId: WORK_3,
      activityId: ACTIVITY_3,
      description: 'Pintura diaria',
      expectedQuantity: '3.500',
      startsOn: dateOffset(today, -7),
      endsOn: dateOffset(today, 7),
      daysMask: 127,
    },
  ]);
  await db.getRepository(DailyGoal).insert([
    {
      id: GOAL_1,
      administratorId: ADMIN_1,
      workId: WORK_1,
      activityId: ACTIVITY_1,
      workDate: historicalDate,
      description: 'Mampostería histórica',
      expectedQuantity: '10.000',
      unit: 'METROS_CUADRADOS',
    },
    {
      id: GOAL_2,
      administratorId: ADMIN_2,
      workId: WORK_3,
      activityId: ACTIVITY_3,
      workDate: historicalDate,
      description: 'Pintura histórica',
      expectedQuantity: '2.000',
      unit: 'OTRA',
      customUnit: 'Latas',
      quantityStep: '0.500',
      quantityDecimals: 1,
    },
  ]);
  await db.getRepository(DailyReport).insert([
    {
      id: REPORT_1,
      administratorId: ADMIN_1,
      workId: WORK_1,
      workDate: historicalDate,
      foremanId: FOREMAN_1,
      foremanNameSnapshot: 'E2E Ana Capataz',
      observations: 'Informe histórico efímero',
    },
    {
      id: randomUUID(),
      administratorId: ADMIN_2,
      workId: WORK_3,
      workDate: historicalDate,
      foremanId: FOREMAN_3,
      foremanNameSnapshot: 'E2E Carla Supervisora',
      observations: null,
    },
  ]);
  await db.getRepository(DailyReportItem).insert({
    id: randomUUID(),
    administratorId: ADMIN_1,
    workId: WORK_1,
    reportId: REPORT_1,
    workDate: historicalDate,
    goalId: GOAL_1,
    activityId: ACTIVITY_1,
    descriptionSnapshot: 'Mampostería histórica',
    expectedQuantitySnapshot: '10.000',
    unitSnapshot: 'METROS_CUADRADOS',
    actualQuantity: '8.000',
  });
  await db.getRepository(ReportPhoto).insert({
    id: randomUUID(),
    administratorId: ADMIN_1,
    workId: WORK_1,
    reportId: REPORT_1,
    storageKey: `${randomUUID()}.webp`,
    mimeType: 'image/webp',
    byteSize: 64,
    width: 2,
    height: 2,
  });
  await db.getRepository(ReportCorrection).insert({
    id: randomUUID(),
    administratorId: ADMIN_1,
    workId: WORK_1,
    reportId: REPORT_1,
    correctedByAdministratorId: ADMIN_1,
    beforeValue: { observations: 'antes' },
    afterValue: { observations: 'después' },
    reason: 'Corrección efímera inicial',
  });
}

async function cleanupRun(db: DataSource) {
  const administrators = In([ADMIN_1, ADMIN_2]);
  await db
    .getRepository(ReportCorrection)
    .delete({ administratorId: administrators });
  await db
    .getRepository(ReportPhoto)
    .delete({ administratorId: administrators });
  await db
    .getRepository(DailyReportItem)
    .delete({ administratorId: administrators });
  await db
    .getRepository(DailyReport)
    .delete({ administratorId: administrators });
  await db.getRepository(DailyGoal).delete({ administratorId: administrators });
  await db
    .getRepository(GoalRecurrence)
    .delete({ administratorId: administrators });
  await db.getRepository(Activity).delete({ administratorId: administrators });
  await db
    .getRepository(WorkAssignment)
    .delete({ administratorId: administrators });
  await db
    .getRepository(PersonRole)
    .delete({ administratorId: administrators });
  await db.getRepository(Person).delete({ administratorId: administrators });
  await db.getRepository(Work).delete({ administratorId: administrators });
  await db.getRepository(Foreman).delete({ administratorId: administrators });
  await db.getRepository(Administrator).delete({ id: administrators });
}

integration('PostgreSQL aislado: escrituras y concurrencia', () => {
  let db: DataSource;
  let admin: AdminService;
  let reports: ReportsService;
  let people: PeopleAdminService;
  let personAuth: PersonAuthService;
  let personGuard: PersonJwtGuard;
  let members: MemberService;
  let jwt: JwtService;
  let photoDirectory: string;
  let reportId: string;
  let siteManagerId: string;
  let foremanPersonId: string;
  let foreignForemanPersonId: string;
  let siteManagerRequest: PersonRequest;
  let foremanRequest: PersonRequest;
  let siteManagerToken: string;
  let siteManagerCode: string;
  let siteWork2AssignmentId: string;
  let previousPhotoDirectory: string | undefined;

  beforeAll(async () => {
    types.setTypeParser(types.builtins.DATE, (value) => value);
    photoDirectory = resolve('./storage/test-photos', RUN_TAG);
    if (!photoDirectory.includes('test'))
      throw new Error(
        'El almacenamiento temporal debe ser un directorio de pruebas',
      );
    previousPhotoDirectory = process.env.PHOTO_STORAGE_DIR;
    process.env.PHOTO_STORAGE_DIR = photoDirectory;
    await rm(photoDirectory, { recursive: true, force: true });

    db = new DataSource(testOptions());
    await db.initialize();
    await seedRun(db);
    admin = new AdminService(db);
    reports = new ReportsService(db, admin);
    jwt = new JwtService({ secret: process.env.JWT_SECRET });
    const authorization = new WorkAuthorizationService(db);
    people = new PeopleAdminService(db);
    personAuth = new PersonAuthService(db, jwt);
    personGuard = new PersonJwtGuard(jwt, db);
    members = new MemberService(db, authorization, admin, reports);
  });

  afterAll(async () => {
    try {
      if (db?.isInitialized) {
        await cleanupRun(db);
        const remaining = await db
          .getRepository(Administrator)
          .countBy({ id: In([ADMIN_1, ADMIN_2]) });
        if (remaining !== 0)
          throw new Error(
            `No se pudieron eliminar los administradores E2E ${ADMIN_1}, ${ADMIN_2}`,
          );
      }
    } finally {
      if (db?.isInitialized) await db.destroy();
      if (photoDirectory?.includes('test'))
        await rm(photoDirectory, { recursive: true, force: true });
      if (previousPhotoDirectory === undefined)
        delete process.env.PHOTO_STORAGE_DIR;
      else process.env.PHOTO_STORAGE_DIR = previousPhotoDirectory;
    }
  });

  async function personalRequest(token: string) {
    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as PersonRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await personGuard.canActivate(context);
    return request;
  }

  it('inicia con el esquema exacto y dos administradores efímeros', async () => {
    const server = await db
      .createQueryBuilder()
      .select(`current_setting('server_version_num')`, 'version')
      .from('pg_catalog.pg_database', 'database_catalog')
      .where('database_catalog.datname = current_database()')
      .getRawOne<{ version: string }>();
    expect(Number(server?.version)).toBeGreaterThanOrEqual(160_000);
    expect(Number(server?.version)).toBeLessThan(170_000);

    const schema = await db.driver.createSchemaBuilder().log();
    expect(schema.upQueries.map(({ query }) => query)).toEqual([]);
    expect(
      await db.getRepository(Work).countBy({ administratorId: ADMIN_1 }),
    ).toBe(2);
    expect(
      await db.getRepository(Work).countBy({ administratorId: ADMIN_2 }),
    ).toBe(1);
    expect(
      await db.getRepository(ReportPhoto).countBy({ administratorId: ADMIN_1 }),
    ).toBeGreaterThan(0);
    expect(
      await db
        .getRepository(ReportCorrection)
        .countBy({ administratorId: ADMIN_1 }),
    ).toBeGreaterThan(0);
    await expect(reports.detail(REPORT_1, ADMIN_1)).resolves.toMatchObject({
      submittedByPersonId: null,
      submittedBy: {
        personId: null,
        name: 'E2E Ana Capataz',
        accessType: 'LEGACY',
      },
    });
  });

  it('valida login, JWT y aislamiento real entre administradores', async () => {
    const auth = new AuthService(db, jwt);
    const login1 = await auth.login(
      ADMIN_1_EMAIL.toUpperCase(),
      'AdminTest123!',
      'write-test-admin-1',
    );
    const login2 = await auth.login(
      ADMIN_2_EMAIL,
      'AdminTest456!',
      'write-test-admin-2',
    );
    expect(login1.administrator.id).toBe(ADMIN_1);
    expect(login2.administrator.id).toBe(ADMIN_2);

    const request = {
      headers: { authorization: `Bearer ${login1.accessToken}` },
    } as AdminRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await expect(new JwtGuard(jwt, db).canActivate(context)).resolves.toBe(
      true,
    );
    expect(request.administratorId).toBe(ADMIN_1);

    await expect(admin.work(ADMIN_1, WORK_3)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(admin.work(ADMIN_2, WORK_1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('gestiona personas, múltiples asignaciones y autenticación personal', async () => {
    const siteManager = await people.create(ADMIN_1, {
      fullName: `[E2E ${RUN_TAG}] Jefe de obra`,
      roles: ['SITE_MANAGER'],
    });
    const foreman = await people.create(ADMIN_1, {
      fullName: `[E2E ${RUN_TAG}] Capataz personal`,
      roles: ['FOREMAN'],
    });
    const foreignForeman = await people.create(ADMIN_2, {
      fullName: `[E2E ${RUN_TAG}] Capataz de otro administrador`,
      roles: ['FOREMAN'],
    });
    siteManagerId = siteManager.id;
    foremanPersonId = foreman.id;
    foreignForemanPersonId = foreignForeman.id;

    await people.assign(ADMIN_1, WORK_1, {
      personId: siteManagerId,
      roleCode: 'SITE_MANAGER',
      isPrimary: true,
    });
    const siteWork2 = await people.assign(ADMIN_1, WORK_2, {
      personId: siteManagerId,
      roleCode: 'SITE_MANAGER',
    });
    siteWork2AssignmentId = siteWork2.id;
    await people.assign(ADMIN_1, WORK_1, {
      personId: foremanPersonId,
      roleCode: 'FOREMAN',
    });
    await people.assign(ADMIN_1, WORK_2, {
      personId: foremanPersonId,
      roleCode: 'FOREMAN',
    });
    await expect(
      people.assign(ADMIN_2, WORK_3, {
        personId: siteManagerId,
        roleCode: 'SITE_MANAGER',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    siteManagerCode = (await people.rotateCode(ADMIN_1, siteManagerId)).code;
    const foremanCode = (await people.rotateCode(ADMIN_1, foremanPersonId))
      .code;
    const siteLogin = await personAuth.login(
      siteManagerCode,
      `site-${RUN_TAG}`,
    );
    const foremanLogin = await personAuth.login(
      foremanCode,
      `foreman-${RUN_TAG}`,
    );
    siteManagerToken = siteLogin.accessToken;
    siteManagerRequest = await personalRequest(siteManagerToken);
    foremanRequest = await personalRequest(foremanLogin.accessToken);

    expect(siteManagerRequest.actor.roles).toEqual(['SITE_MANAGER']);
    expect(foremanRequest.actor.roles).toEqual(['FOREMAN']);
    await expect(members.works(siteManagerRequest)).resolves.toHaveLength(2);
    await expect(members.works(foremanRequest)).resolves.toHaveLength(2);
    const goalsBeforeRead = await db
      .getRepository(DailyGoal)
      .countBy({ workId: WORK_1 });
    await expect(
      members.detail(siteManagerRequest, WORK_1),
    ).resolves.toMatchObject({ work: { id: WORK_1 } });
    expect(await db.getRepository(DailyGoal).countBy({ workId: WORK_1 })).toBe(
      goalsBeforeRead,
    );
    await expect(
      members.detail(siteManagerRequest, WORK_3),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      members.submit(siteManagerRequest, WORK_1, { items: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invalida sesiones al rotar códigos, desactivar y desasignar', async () => {
    const rotated = await people.rotateCode(ADMIN_1, siteManagerId);
    await expect(personalRequest(siteManagerToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      personAuth.login(siteManagerCode, `old-site-${RUN_TAG}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const current = await personAuth.login(rotated.code, `new-site-${RUN_TAG}`);
    siteManagerRequest = await personalRequest(current.accessToken);

    await people.update(ADMIN_1, siteManagerId, { isActive: false });
    await expect(personalRequest(current.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await people.update(ADMIN_1, siteManagerId, { isActive: true });
    const reactivated = await personAuth.login(
      rotated.code,
      `reactivated-site-${RUN_TAG}`,
    );
    siteManagerRequest = await personalRequest(reactivated.accessToken);

    await people.unassign(ADMIN_1, WORK_2, siteWork2AssignmentId);
    await expect(
      members.detail(siteManagerRequest, WORK_2),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await people.assign(ADMIN_1, WORK_2, {
      personId: siteManagerId,
      roleCode: 'SITE_MANAGER',
    });
    const history = await people.assignments(ADMIN_1, WORK_2);
    expect(
      history.some(
        (assignment) =>
          assignment.id === siteWork2AssignmentId && !assignment.active,
      ),
    ).toBe(true);
    expect(
      history.some(
        (assignment) =>
          assignment.personId === siteManagerId && assignment.active,
      ),
    ).toBe(true);
  });

  it('escribe CRUD administrativo y revierte una transacción fallida', async () => {
    const foreman = await admin.saveForeman(ADMIN_1, {
      firstName: 'E2E Diego',
      lastName: 'Prueba',
      phone: '+54 351 555 0099',
    });
    const updatedForeman = await admin.saveForeman(
      ADMIN_1,
      { ...foreman, firstName: 'Diego Editado' },
      foreman.id,
    );
    expect(updatedForeman.firstName).toBe('Diego Editado');

    const today = localNow('America/Argentina/Cordoba').date;
    const createdWork = await admin.saveWork(ADMIN_1, {
      foremanId: foreman.id,
      name: `[E2E ${RUN_TAG}] Obra transaccional`,
      description: null,
      location: 'Laboratorio',
      startDate: today,
      estimatedEndDate: dateOffset(today, 30),
      status: 'ACTIVA',
      timeZone: 'America/Argentina/Cordoba',
      closeTime: '23:59',
      accessAlias: `TEST-${RUN_TAG}-TRANSACCIONAL`,
      aliasPin: '112233',
    });
    if (!('accessCode' in createdWork))
      throw new Error('La creación no devolvió el código de acceso');
    expect(createdWork.accessCode).toHaveLength(32);
    const rotated = await admin.rotateCode(ADMIN_1, createdWork.id);
    expect(rotated.accessCode).not.toBe(createdWork.accessCode);

    const rollbackActivity = randomUUID();
    await expect(
      db.transaction(async (manager) => {
        await manager.getRepository(Activity).insert({
          id: rollbackActivity,
          administratorId: ADMIN_1,
          workId: createdWork.id,
          name: 'Debe revertirse',
          unit: 'UNIDADES',
        });
        throw new Error('rollback deliberado');
      }),
    ).rejects.toThrow('rollback deliberado');
    await expect(
      db.getRepository(Activity).existsBy({ id: rollbackActivity }),
    ).resolves.toBe(false);
  });

  it('materializa recurrencias, copia objetivos y calcula el dashboard', async () => {
    const dashboard = await admin.dashboard(ADMIN_1);
    expect(dashboard).toHaveLength(3);
    expect(dashboard.every((entry) => entry.id !== WORK_3)).toBe(true);

    const work = await admin.work(ADMIN_1, WORK_1);
    const today = localNow(work.timeZone).date;
    const initial = await admin.goals(ADMIN_1, WORK_1, today);
    expect(initial.length).toBeGreaterThan(0);
    const initialCount = await db
      .getRepository(DailyGoal)
      .countBy({ workId: WORK_1, workDate: today });
    await admin.goals(ADMIN_1, WORK_1, today);
    expect(
      await db
        .getRepository(DailyGoal)
        .countBy({ workId: WORK_1, workDate: today }),
    ).toBe(initialCount);

    const oneTime = await admin.createGoal(ADMIN_1, WORK_1, {
      description: 'Objetivo manual de integración',
      expectedQuantity: 7,
      unit: 'UNIDADES',
      date: today,
    });
    const changed = await admin.updateGoal(ADMIN_1, WORK_1, oneTime.id, {
      expectedQuantity: 9,
    });
    expect(Number(changed.expectedQuantity)).toBe(9);

    const copied = await admin.copyGoals(ADMIN_1, WORK_1, dateOffset(today, 1));
    expect(copied.copied).toBeGreaterThan(0);

    const recurrence = await admin.createGoal(ADMIN_1, WORK_1, {
      description: 'Recurrencia descartable',
      expectedQuantity: 1,
      unit: 'HORAS',
      recurrence: {
        startsOn: today,
        endsOn: dateOffset(today, 3),
        daysMask: 127,
      },
    });
    await expect(
      admin.deactivateRecurrence(ADMIN_1, WORK_1, recurrence.id),
    ).resolves.toMatchObject({ isActive: false });

    const detail = await admin.workDetail(ADMIN_1, WORK_1);
    expect(detail.goals.length).toBeGreaterThan(0);
    expect(detail.reports.length).toBeGreaterThan(0);
    expect(detail.corrections.length).toBeGreaterThan(0);
  });

  it('crea y actualiza informes, fotografías y correcciones', async () => {
    let work = await admin.work(ADMIN_1, WORK_1);
    for (const zone of [
      'UTC',
      'America/Argentina/Cordoba',
      'Pacific/Honolulu',
    ]) {
      if (localNow(zone).time < '23:59') {
        work.timeZone = zone;
        break;
      }
    }
    work.closeTime = '23:59:59';
    await db.getRepository(Work).save(work);
    const date = localNow(work.timeZone).date;
    const goals = await admin.goals(ADMIN_1, WORK_1, date);
    const body = {
      observations: 'Informe creado por integración',
      items: goals.map((goal) => ({
        goalId: goal.id,
        actualQuantity: goal.unit === 'UNIDADES' ? 1 : 1.5,
      })),
    };
    const created = await members.submit(foremanRequest, WORK_1, body);
    reportId = created.id;
    expect(created.foremanName).toBe(foremanRequest.actor.fullName);
    expect(created.submittedByPersonId).toBe(foremanPersonId);
    expect(created.submittedBy).toEqual({
      personId: foremanPersonId,
      name: foremanRequest.actor.fullName,
      accessType: 'PERSONAL',
    });
    const updated = await members.submit(foremanRequest, WORK_1, {
      ...body,
      observations: 'Informe actualizado por integración',
    });
    expect(updated.id).toBe(reportId);
    await expect(
      reports.submit(work, body, foreignForemanPersonId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      db.transaction((manager) =>
        manager.getRepository(DailyReport).update(
          { id: reportId, administratorId: ADMIN_1 },
          { submittedByPersonId: foreignForemanPersonId },
        ),
      ),
    ).rejects.toThrow();
    await expect(reports.detail(reportId, ADMIN_2)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      (await db.getRepository(DailyReport).findOneByOrFail({ id: reportId }))
        .submittedByPersonId,
    ).toBe(foremanPersonId);

    const image = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 30, g: 120, b: 200 },
      },
    })
      .png()
      .toBuffer();
    const photo = await members.upload(foremanRequest, WORK_1, reportId, {
      buffer: image,
      size: image.length,
    } as Express.Multer.File);
    await expect(members.photo(foremanRequest, photo.id)).resolves.toEqual(
      expect.any(Buffer),
    );
    await expect(members.photo(siteManagerRequest, photo.id)).resolves.toEqual(
      expect.any(Buffer),
    );
    await expect(reports.photo(ADMIN_2, photo.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    await db
      .getRepository(Work)
      .update({ id: WORK_1 }, { closeTime: '00:00:00' });
    const corrected = await reports.correct(ADMIN_1, reportId, {
      observations: 'Informe corregido y cerrado',
      reason: 'Prueba de auditoría',
    });
    expect(corrected.observations).toBe('Informe corregido y cerrado');
    await expect(
      members.reportDetail(siteManagerRequest, reportId),
    ).resolves.toMatchObject({ id: reportId });
    expect(
      await db.getRepository(ReportCorrection).countBy({ reportId }),
    ).toBeGreaterThan(0);
    await expect(
      reports.correct(ADMIN_2, reportId, { observations: 'Intrusión' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const dashboard = await admin.dashboard(ADMIN_1);
    expect(dashboard.find(({ id }) => id === WORK_1)?.hasReport).toBe(true);
  });

  it('serializa bloqueos pesimistas y rechaza un escritor concurrente', async () => {
    const first = db.createQueryRunner();
    const second = db.createQueryRunner();
    await first.connect();
    await second.connect();
    await first.startTransaction();
    await second.startTransaction();
    try {
      await first.manager
        .getRepository(Work)
        .createQueryBuilder('work')
        .where('work.id = :id', { id: WORK_1 })
        .setLock('pessimistic_write')
        .getOneOrFail();

      const competing = second.manager
        .getRepository(Work)
        .createQueryBuilder('work')
        .where('work.id = :id', { id: WORK_1 })
        .setLock('pessimistic_write')
        .setOnLocked('nowait')
        .getOneOrFail();
      await expect(competing).rejects.toMatchObject({
        driverError: { code: '55P03' },
      });
    } finally {
      await second.rollbackTransaction();
      await first.rollbackTransaction();
      await second.release();
      await first.release();
    }
  });
});
