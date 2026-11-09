import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { In, type DataSource } from 'typeorm';
import QRCode from 'qrcode';
import { hash } from 'bcryptjs';
import { DB } from './database.module.js';
import { JwtGuard } from './auth.js';
import type { AdminRequest } from './auth.js';
import {
  Activity,
  DailyGoal,
  DailyReport,
  DailyReportItem,
  Foreman,
  Person,
  PersonRole,
  GoalRecurrence,
  ReportCorrection,
  ReportPhoto,
  Work,
  WorkAssignment,
} from './database/entities.js';
import {
  code,
  codeHash,
  customQuantityConfig,
  localNow,
  number,
  optional,
  percentage,
  quantityForUnit,
  reportSummary,
  required,
  uuid,
  validDate,
  validUnit,
  type Db,
} from './shared.js';

type GoalInput = {
  date?: string;
  description?: string;
  expectedQuantity?: number;
  unit?: string;
  customUnit?: string;
  quantityStep?: number;
  quantityDecimals?: number;
  activityId?: string;
  recurrence?: { startsOn: string; endsOn: string; daysMask: number };
};

export function normalizeAlias(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string')
    throw new BadRequestException('Alias inválido');
  const alias = value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (
    !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(alias) ||
    alias.length < 4 ||
    alias.length > 40
  )
    throw new BadRequestException(
      'El alias debe tener 4 a 40 letras, números o guiones',
    );
  return alias;
}
function validPin(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value))
    throw new BadRequestException('El PIN debe tener 6 dígitos');
  return value;
}

@Injectable()
export class AdminService {
  constructor(@Inject(DB) private readonly db: DataSource) {}

  async foremen(adminId: string) {
    const foremen = await this.db.getRepository(Foreman).find({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
      },
      where: { administratorId: adminId },
      order: { firstName: 'ASC', lastName: 'ASC' },
    });
    return foremen.map(({ id, firstName, lastName, phone, isActive }) => ({
      id,
      firstName,
      lastName,
      phone,
      isActive,
    }));
  }
  async saveForeman(adminId: string, body: any, id?: string) {
    const first = required(body.firstName, 'Nombre', 100);
    const last = required(body.lastName, 'Apellido', 100);
    const phone = required(body.phone, 'Teléfono', 40);
    const repository = this.db.getRepository(Foreman);
    if (id) {
      const foreman = await repository.findOneBy({
        id,
        administratorId: adminId,
      });
      if (!foreman) throw new NotFoundException('Recurso no encontrado');
      Object.assign(foreman, {
        firstName: first,
        lastName: last,
        phone,
        isActive: body.isActive !== false,
        updatedAt: new Date(),
      });
      const saved = await repository.save(foreman);
      return {
        id: saved.id,
        firstName: saved.firstName,
        lastName: saved.lastName,
        phone: saved.phone,
        isActive: saved.isActive,
      };
    }
    const saved = await repository.save(
      repository.create({
        id: uuid(),
        administratorId: adminId,
        firstName: first,
        lastName: last,
        phone,
        isActive: body.isActive !== false,
      }),
    );
    return {
      id: saved.id,
      firstName: saved.firstName,
      lastName: saved.lastName,
      phone: saved.phone,
      isActive: saved.isActive,
    };
  }
  async works(adminId: string) {
    return this.db
      .getRepository(Work)
      .createQueryBuilder('work')
      .innerJoin('work.primaryForeman', 'foreman')
      .select('work.id', 'id')
      .addSelect('work.name', 'name')
      .addSelect('work.description', 'description')
      .addSelect('work.location', 'location')
      .addSelect('work.startDate', 'startDate')
      .addSelect('work.estimatedEndDate', 'estimatedEndDate')
      .addSelect('work.status', 'status')
      .addSelect('work.timeZone', 'timeZone')
      .addSelect('work.closeTime', 'closeTime')
      .addSelect('work.foremanId', 'foremanId')
      .addSelect('work.accessAlias', 'accessAlias')
      .addSelect(`foreman.firstName || ' ' || foreman.lastName`, 'foremanName')
      .where('work.administratorId = :adminId', { adminId })
      .orderBy(
        `CASE work.status WHEN 'ACTIVA' THEN 0 WHEN 'PAUSADA' THEN 1 ELSE 2 END`,
        'ASC',
      )
      .addOrderBy('work.name', 'ASC')
      .getRawMany();
  }
  async work(adminId: string, id: string, db: Db = this.db): Promise<Work> {
    const work = await db
      .getRepository(Work)
      .findOneBy({ administratorId: adminId, id });
    if (!work) throw new NotFoundException('Recurso no encontrado');
    return work;
  }
  async saveWork(adminId: string, body: any, id?: string) {
    const name = required(body.name, 'Nombre de obra', 180);
    const description = optional(body.description);
    const location = optional(body.location);
    const start = validDate(body.startDate);
    const end = validDate(body.estimatedEndDate);
    if (end < start)
      throw new BadRequestException(
        'La fecha final debe ser posterior al inicio',
      );
    const foremanExists = await this.db.getRepository(Foreman).existsBy({
      administratorId: adminId,
      id: body.foremanId,
      isActive: true,
    });
    if (!foremanExists) throw new NotFoundException('Recurso no encontrado');
    const status = body.status ?? 'ACTIVA';
    if (!['ACTIVA', 'PAUSADA', 'FINALIZADA'].includes(status))
      throw new BadRequestException('Estado inválido');
    const timeZone = body.timeZone ?? 'America/Argentina/Cordoba';
    localNow(timeZone);
    const closeTime = body.closeTime ?? '19:00';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(closeTime))
      throw new BadRequestException('Hora de cierre inválida');
    const alias = normalizeAlias(body.accessAlias);
    const repository = this.db.getRepository(Work);
    if (id) {
      const previous = await repository
        .createQueryBuilder('work')
        .addSelect('work.aliasPinHash')
        .where('work.administratorId = :adminId AND work.id = :id', {
          adminId,
          id,
        })
        .getOne();
      if (!previous) throw new NotFoundException('Recurso no encontrado');
      const effectiveAlias =
        body.accessAlias === undefined ? previous.accessAlias : alias;
      const pinChanged = body.aliasPin !== undefined && body.aliasPin !== '';
      if (effectiveAlias && !pinChanged && !previous.aliasPinHash)
        throw new BadRequestException('Definí un PIN para habilitar el alias');
      const pinHash = effectiveAlias
        ? pinChanged
          ? await hash(validPin(body.aliasPin), 12)
          : previous.aliasPinHash
        : null;
      const revoke = effectiveAlias !== previous.accessAlias || pinChanged;
      Object.assign(previous, {
        foremanId: body.foremanId,
        name,
        description,
        location,
        startDate: start,
        estimatedEndDate: end,
        status,
        timeZone,
        closeTime,
        accessAlias: effectiveAlias,
        aliasPinHash: pinHash,
        aliasSessionVersion: String(
          BigInt(previous.aliasSessionVersion) + BigInt(revoke ? 1 : 0),
        ),
        updatedAt: new Date(),
      });
      try {
        const saved = await repository.save(previous);
        return {
          id: saved.id,
          name: saved.name,
          status: saved.status,
          accessAlias: saved.accessAlias,
        };
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new ConflictException('Ese alias ya está en uso');
        throw error;
      }
    }
    if (alias && !body.aliasPin)
      throw new BadRequestException('Definí un PIN para habilitar el alias');
    const assignments: { personId: string; roleCode: 'SITE_MANAGER' | 'FOREMAN' }[] = body.assignments ?? [];
    if (!Array.isArray(assignments) || assignments.some((assignment) =>
      !assignment || typeof assignment.personId !== 'string' ||
      !['SITE_MANAGER', 'FOREMAN'].includes(assignment.roleCode)))
      throw new BadRequestException('Responsables inválidos');
    const keys = assignments.map((assignment) => `${assignment.personId}:${assignment.roleCode}`);
    if (new Set(keys).size !== keys.length) throw new BadRequestException('Responsables repetidos');
    const pinHash = alias ? await hash(validPin(body.aliasPin), 12) : null;
    const accessCode = code();
    const workId = uuid();
    try {
      await this.db.transaction(async (manager) => {
        for (const assignment of assignments) {
          const person = await manager.getRepository(Person).findOneBy({ id: assignment.personId, administratorId: adminId, isActive: true });
          const role = await manager.getRepository(PersonRole).findOneBy({ personId: assignment.personId, administratorId: adminId, roleCode: assignment.roleCode });
          if (!person || !role) throw new BadRequestException('Responsable no disponible para ese rol');
        }
        await manager.getRepository(Work).save(manager.getRepository(Work).create({
          id: workId,
          administratorId: adminId,
          foremanId: body.foremanId,
          name,
          description,
          location,
          startDate: start,
          estimatedEndDate: end,
          status,
          timeZone,
          closeTime,
          accessCodeHash: codeHash(accessCode),
          accessAlias: alias,
          aliasPinHash: pinHash,
        }));
        if (assignments.length) await manager.getRepository(WorkAssignment).insert(assignments.map((assignment) => ({
          id: uuid(), administratorId: adminId, workId, personId: assignment.personId,
          roleCode: assignment.roleCode, isPrimary: false,
        })));
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('Ese alias ya está en uso');
      throw error;
    }
    return this.accessResult(workId, name, accessCode);
  }
  private async accessResult(id: string, name: string, accessCode: string) {
    const url = `${(process.env.PUBLIC_APP_URL ?? 'http://localhost:4200').replace(/\/$/, '')}/obra/${accessCode}`;
    return {
      id,
      name,
      accessCode,
      url,
      qrDataUrl: await QRCode.toDataURL(url),
    };
  }
  async rotateCode(adminId: string, id: string) {
    const work = await this.work(adminId, id);
    const accessCode = code();
    await this.db.getRepository(Work).update(
      { administratorId: adminId, id },
      {
        accessCodeHash: codeHash(accessCode),
        accessCodeRotatedAt: new Date(),
        updatedAt: new Date(),
      },
    );
    return this.accessResult(id, work.name, accessCode);
  }

  private async lockWork(db: Db, adminId: string, workId: string) {
    const work = await db
      .getRepository(Work)
      .createQueryBuilder('work')
      .where('work.administratorId = :adminId AND work.id = :workId', {
        adminId,
        workId,
      })
      .setLock('pessimistic_write')
      .getOne();
    if (!work) throw new NotFoundException('Recurso no encontrado');
    return work;
  }

  async materialize(
    adminId: string,
    workId: string,
    date: string,
    db: Db = this.db,
  ): Promise<void> {
    validDate(date);
    if (db === this.db)
      return this.db.transaction(async (tx) => {
        await this.lockWork(tx, adminId, workId);
        return this.materialize(adminId, workId, date, tx);
      });
    const reported = await db
      .getRepository(DailyReport)
      .existsBy({ workId, workDate: date });
    if (reported) return;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const bit = 1 << ((weekday + 6) % 7);
    const recurrences = await db
      .getRepository(GoalRecurrence)
      .createQueryBuilder('recurrence')
      .innerJoinAndSelect('recurrence.activity', 'activity')
      .where('recurrence.administratorId = :adminId', { adminId })
      .andWhere('recurrence.workId = :workId', { workId })
      .andWhere('recurrence.isActive = :active', { active: true })
      .andWhere(':date BETWEEN recurrence.startsOn AND recurrence.endsOn', {
        date,
      })
      .andWhere('(recurrence.daysMask & :bit) <> 0', { bit })
      .getMany();
    if (!recurrences.length) return;
    const existing = new Set(
      (
        await db.getRepository(DailyGoal).find({
          select: { recurrenceId: true },
          where: { workId, workDate: date },
        })
      ).map((goal) => goal.recurrenceId),
    );
    const goals = recurrences
      .filter((recurrence) => !existing.has(recurrence.id))
      .map((recurrence) =>
        db.getRepository(DailyGoal).create({
          id: uuid(),
          administratorId: recurrence.administratorId,
          workId: recurrence.workId,
          activityId: recurrence.activityId,
          recurrenceId: recurrence.id,
          workDate: date,
          description: recurrence.description,
          expectedQuantity: recurrence.expectedQuantity,
          unit: recurrence.activity.unit,
          customUnit: recurrence.activity.customUnit,
          quantityStep: recurrence.activity.quantityStep,
          quantityDecimals: recurrence.activity.quantityDecimals,
        }),
      );
    if (goals.length) await db.getRepository(DailyGoal).insert(goals);
  }
  async materializeAll(adminId: string, workId: string) {
    await this.materializeAllMany(adminId, [workId]);
  }

  private async materializeAllMany(adminId: string, workIds: string[]) {
    if (!workIds.length) return;
    await this.db.transaction(async (tx) => {
      const locked = await tx
        .getRepository(Work)
        .createQueryBuilder('work')
        .where('work.administratorId = :adminId', { adminId })
        .andWhere('work.id IN (:...workIds)', { workIds })
        .setLock('pessimistic_write')
        .getMany();
      if (locked.length !== workIds.length)
        throw new NotFoundException('Recurso no encontrado');
      const recurrences = await tx.getRepository(GoalRecurrence).find({
        where: {
          administratorId: adminId,
          workId: In(workIds),
          isActive: true,
        },
        relations: { activity: true },
      });
      if (!recurrences.length) return;
      const reports = new Set(
        (
          await tx.getRepository(DailyReport).find({
            select: { workId: true, workDate: true },
            where: { workId: In(workIds) },
          })
        ).map((report) => `${report.workId}:${report.workDate}`),
      );
      const existing = new Set(
        (
          await tx.getRepository(DailyGoal).find({
            select: { recurrenceId: true, workDate: true },
            where: { workId: In(workIds) },
          })
        ).map((goal) => `${goal.recurrenceId}:${goal.workDate}`),
      );
      const goals: DailyGoal[] = [];
      for (const recurrence of recurrences) {
        for (
          let cursor = new Date(`${recurrence.startsOn}T12:00:00Z`);
          cursor <= new Date(`${recurrence.endsOn}T12:00:00Z`);
          cursor.setUTCDate(cursor.getUTCDate() + 1)
        ) {
          const date = cursor.toISOString().slice(0, 10);
          const bit = 1 << ((cursor.getUTCDay() + 6) % 7);
          if (
            (recurrence.daysMask & bit) === 0 ||
            reports.has(`${recurrence.workId}:${date}`) ||
            existing.has(`${recurrence.id}:${date}`)
          )
            continue;
          goals.push(
            tx.getRepository(DailyGoal).create({
              id: uuid(),
              administratorId: adminId,
              workId: recurrence.workId,
              activityId: recurrence.activityId,
              recurrenceId: recurrence.id,
              workDate: date,
              description: recurrence.description,
              expectedQuantity: recurrence.expectedQuantity,
              unit: recurrence.activity.unit,
              customUnit: recurrence.activity.customUnit,
              quantityStep: recurrence.activity.quantityStep,
              quantityDecimals: recurrence.activity.quantityDecimals,
            }),
          );
        }
      }
      if (goals.length) await tx.getRepository(DailyGoal).insert(goals);
    });
  }
  async goals(adminId: string, workId: string, date: string) {
    await this.work(adminId, workId);
    await this.materialize(adminId, workId, date);
    const goals = await this.db.getRepository(DailyGoal).find({
      where: { administratorId: adminId, workId, workDate: date },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return goals.map((goal) => ({
      id: goal.id,
      activityId: goal.activityId,
      recurrenceId: goal.recurrenceId,
      date: goal.workDate,
      description: goal.description,
      expectedQuantity: goal.expectedQuantity,
      unit: goal.unit,
      customUnit: goal.customUnit,
      quantityStep: goal.quantityStep,
      quantityDecimals: goal.quantityDecimals,
      isActive: goal.isActive,
    }));
  }
  async recurrences(adminId: string, workId: string) {
    await this.work(adminId, workId);
    const recurrences = await this.db.getRepository(GoalRecurrence).find({
      where: { administratorId: adminId, workId },
      order: { createdAt: 'DESC' },
    });
    return recurrences.map((item) => ({
      id: item.id,
      activityId: item.activityId,
      description: item.description,
      expectedQuantity: item.expectedQuantity,
      startsOn: item.startsOn,
      endsOn: item.endsOn,
      daysMask: item.daysMask,
      isActive: item.isActive,
    }));
  }
  async createGoal(adminId: string, workId: string, body: GoalInput) {
    await this.work(adminId, workId);
    const description = required(body.description, 'Descripción');
    const { unit, customUnit } = validUnit(body.unit, body.customUnit);
    let config = customQuantityConfig(
      unit,
      body.quantityStep,
      body.quantityDecimals,
    );
    return this.db.transaction(async (tx) => {
      await this.lockWork(tx, adminId, workId);
      let activityId = body.activityId;
      if (activityId) {
        const activity = await tx.getRepository(Activity).findOneBy({
          administratorId: adminId,
          workId,
          id: activityId,
          isActive: true,
        });
        if (!activity) throw new NotFoundException('Recurso no encontrado');
        if (activity.unit !== unit || activity.customUnit !== customUnit)
          throw new BadRequestException(
            'La unidad de la actividad debe mantenerse',
          );
        const existing = customQuantityConfig(
          unit,
          activity.quantityStep,
          activity.quantityDecimals,
        );
        if (
          config &&
          (config.step !== (existing?.step ?? 0.001) ||
            config.decimals !== (existing?.decimals ?? 3))
        )
          throw new BadRequestException(
            'El paso y decimales deben coincidir con la actividad',
          );
        config = existing;
      } else {
        activityId = uuid();
        await tx.getRepository(Activity).insert({
          id: activityId,
          administratorId: adminId,
          workId,
          name: description,
          unit,
          customUnit,
          quantityStep: config ? String(config.step) : null,
          quantityDecimals: config?.decimals ?? null,
        });
      }
      const expected = quantityForUnit(
        body.expectedQuantity,
        unit,
        'Meta',
        true,
        config,
      );
      if (body.recurrence) {
        const { startsOn, endsOn, daysMask } = body.recurrence;
        validDate(startsOn);
        validDate(endsOn);
        if (
          endsOn < startsOn ||
          (Date.parse(endsOn) - Date.parse(startsOn)) / 86400000 > 730
        )
          throw new BadRequestException(
            'Rango de recurrencia inválido (máximo dos años)',
          );
        if (!Number.isInteger(daysMask) || daysMask < 1 || daysMask > 127)
          throw new BadRequestException('Días de recurrencia inválidos');
        const id = uuid();
        await tx.getRepository(GoalRecurrence).insert({
          id,
          administratorId: adminId,
          workId,
          activityId,
          description,
          expectedQuantity: String(expected),
          startsOn,
          endsOn,
          daysMask,
        });
        return { id, activityId, recurrence: true };
      }
      const date = validDate(body.date!);
      const reported = await tx
        .getRepository(DailyReport)
        .existsBy({ administratorId: adminId, workId, workDate: date });
      if (reported)
        throw new BadRequestException(
          'No se pueden agregar objetivos a un día informado',
        );
      const id = uuid();
      await tx.getRepository(DailyGoal).insert({
        id,
        administratorId: adminId,
        workId,
        activityId,
        workDate: date,
        description,
        expectedQuantity: String(expected),
        unit,
        customUnit,
        quantityStep: config ? String(config.step) : null,
        quantityDecimals: config?.decimals ?? null,
      });
      return { id, activityId, recurrence: false };
    });
  }
  async updateGoal(adminId: string, workId: string, goalId: string, body: any) {
    return this.db.transaction(async (tx) => {
      await this.lockWork(tx, adminId, workId);
      const goal = await tx
        .getRepository(DailyGoal)
        .createQueryBuilder('goal')
        .where(
          'goal.administratorId = :adminId AND goal.workId = :workId AND goal.id = :goalId',
          { adminId, workId, goalId },
        )
        .setLock('pessimistic_write')
        .getOne();
      if (!goal) throw new NotFoundException('Recurso no encontrado');
      const reported = await tx
        .getRepository(DailyReport)
        .existsBy({ workId, workDate: goal.workDate });
      if (reported)
        throw new BadRequestException('El objetivo ya fue informado');
      const description = required(
        body.description ?? goal.description,
        'Descripción',
      );
      const config = customQuantityConfig(
        goal.unit,
        goal.quantityStep,
        goal.quantityDecimals,
      );
      const expected = quantityForUnit(
        body.expectedQuantity ?? goal.expectedQuantity,
        goal.unit,
        'Meta',
        true,
        config,
      );
      Object.assign(goal, {
        description,
        expectedQuantity: String(expected),
        isActive: body.isActive ?? goal.isActive,
        updatedAt: new Date(),
      });
      const saved = await tx.getRepository(DailyGoal).save(goal);
      return {
        id: saved.id,
        description: saved.description,
        expectedQuantity: saved.expectedQuantity,
        isActive: saved.isActive,
      };
    });
  }
  async deactivateRecurrence(adminId: string, workId: string, id: string) {
    const work = await this.work(adminId, workId);
    const today = localNow(work.timeZone).date;
    return this.db.transaction(async (tx) => {
      await this.lockWork(tx, adminId, workId);
      const recurrence = await tx
        .getRepository(GoalRecurrence)
        .findOneBy({ administratorId: adminId, workId, id });
      if (!recurrence) throw new NotFoundException('Recurso no encontrado');
      recurrence.isActive = false;
      recurrence.updatedAt = new Date();
      await tx.getRepository(GoalRecurrence).save(recurrence);
      await tx
        .getRepository(DailyGoal)
        .createQueryBuilder()
        .update(DailyGoal)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          'administrator_id = :adminId AND work_id = :workId AND recurrence_id = :id AND work_date >= :today',
          { adminId, workId, id, today },
        )
        .andWhere(
          `NOT EXISTS (${tx.getRepository(DailyReport).createQueryBuilder('report').select('1').where('report.work_id = daily_goals.work_id').andWhere('report.work_date = daily_goals.work_date').getQuery()})`,
        )
        .execute();
      return { id: recurrence.id, isActive: recurrence.isActive };
    });
  }
  async copyGoals(adminId: string, workId: string, date: string) {
    validDate(date);
    const previous = new Date(`${date}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const prev = previous.toISOString().slice(0, 10);
    await this.materialize(adminId, workId, prev);
    return this.db.transaction(async (tx) => {
      await this.lockWork(tx, adminId, workId);
      const reported = await tx
        .getRepository(DailyReport)
        .existsBy({ workId, workDate: date });
      if (reported) throw new BadRequestException('El día ya fue informado');
      const source = await tx.getRepository(DailyGoal).findBy({
        administratorId: adminId,
        workId,
        workDate: prev,
        isActive: true,
      });
      const target = await tx.getRepository(DailyGoal).find({
        select: { activityId: true, description: true },
        where: { workId, workDate: date },
      });
      const existing = new Set(
        target.map((goal) => `${goal.activityId}:${goal.description}`),
      );
      const copies = source
        .filter(
          (goal) => !existing.has(`${goal.activityId}:${goal.description}`),
        )
        .map((goal) =>
          tx.getRepository(DailyGoal).create({
            id: uuid(),
            administratorId: goal.administratorId,
            workId: goal.workId,
            activityId: goal.activityId,
            workDate: date,
            description: goal.description,
            expectedQuantity: goal.expectedQuantity,
            unit: goal.unit,
            customUnit: goal.customUnit,
            quantityStep: goal.quantityStep,
            quantityDecimals: goal.quantityDecimals,
          }),
        );
      if (copies.length) await tx.getRepository(DailyGoal).insert(copies);
      return { copied: copies.length };
    });
  }

  async dashboard(adminId: string) {
    const works = await this.db.getRepository(Work).find({
      where: { administratorId: adminId, status: 'ACTIVA' },
      relations: { primaryForeman: true },
    });
    const workIds = works.map((work) => work.id);
    if (!workIds.length) return [];
    await this.materializeAllMany(adminId, workIds);
    const [allGoals, allReports, allItems] = await Promise.all([
      this.db.getRepository(DailyGoal).find({
        where: {
          administratorId: adminId,
          workId: In(workIds),
          isActive: true,
        },
      }),
      this.db.getRepository(DailyReport).find({
        where: { administratorId: adminId, workId: In(workIds) },
        order: { workDate: 'DESC' },
      }),
      this.db.getRepository(DailyReportItem).find({
        where: { administratorId: adminId, workId: In(workIds) },
      }),
    ]);
    const itemsByReport = new Map<string, DailyReportItem[]>();
    for (const item of allItems) {
      const items = itemsByReport.get(item.reportId) ?? [];
      items.push(item);
      itemsByReport.set(item.reportId, items);
    }
    const result: any[] = [];
    for (const work of works) {
      const { date, time } = localNow(work.timeZone);
      const workGoals = allGoals.filter((goal) => goal.workId === work.id);
      const goals = workGoals.filter((goal) => goal.workDate === date);
      const reports = allReports
        .filter((report) => report.workId === work.id)
        .slice(0, 7);
      const today = reports.find((report) => report.workDate === date);
      let compliance: number | null = null;
      const averages: number[] = [];
      for (const report of reports) {
        const score = reportSummary(
          (itemsByReport.get(report.id) ?? []).map((item) => ({
            actual_quantity: item.actualQuantity,
            expected_quantity_snapshot: item.expectedQuantitySnapshot,
          })),
        );
        if (score !== null) averages.push(score);
        if (report.id === today?.id) compliance = score;
      }
      const status =
        goals.length === 0
          ? 'SIN_OBJETIVOS'
          : today
            ? compliance === null
              ? 'SIN_OBJETIVOS'
              : compliance >= 100
                ? 'VERDE'
                : compliance >= 70
                  ? 'AMARILLO'
                  : 'ROJO'
            : time >= work.closeTime.slice(0, 5)
              ? 'NEGRO'
              : 'GRIS';
      const daysRemaining = Math.ceil(
        (Date.parse(`${work.estimatedEndDate}T12:00:00Z`) -
          Date.parse(`${date}T12:00:00Z`)) /
          86400000,
      );
      const deviationActivities = new Set(
        workGoals
          .filter((goal) => goal.workDate <= date)
          .map((goal) => goal.activityId),
      );
      const deviations = [...deviationActivities].map((activityId) => {
        const relevant = workGoals.filter(
          (goal) => goal.activityId === activityId && goal.workDate <= date,
        );
        const goalIds = new Set(relevant.map((goal) => goal.id));
        const planned = relevant.reduce(
          (sum, goal) => sum + number(goal.expectedQuantity),
          0,
        );
        const executed = allItems
          .filter((item) => item.workId === work.id && goalIds.has(item.goalId))
          .reduce((sum, item) => sum + number(item.actualQuantity), 0);
        return {
          activityId,
          planned,
          executed,
          difference: executed - planned,
        };
      });
      result.push({
        id: work.id,
        name: work.name,
        foremanName: `${work.primaryForeman.firstName} ${work.primaryForeman.lastName}`,
        today: date,
        timeZone: work.timeZone,
        estimatedEndDate: work.estimatedEndDate,
        daysRemaining,
        compliance,
        average7: averages.length
          ? Math.round(averages.reduce((a, b) => a + b, 0) / averages.length)
          : null,
        reportStatus: status,
        hasReport: !!today,
        deviations,
      });
    }
    const order: Record<string, number> = {
      NEGRO: 0,
      ROJO: 1,
      AMARILLO: 2,
      GRIS: 3,
      SIN_OBJETIVOS: 4,
      VERDE: 5,
    };
    return result.sort(
      (a, b) =>
        order[a.reportStatus] - order[b.reportStatus] ||
        a.name.localeCompare(b.name),
    );
  }
  async workDetail(
    adminId: string,
    workId: string,
    materializeRecurrences = true,
  ) {
    const work = await this.work(adminId, workId);
    const primaryForeman = await this.db.getRepository(Foreman).findOneBy({ id: work.foremanId, administratorId: adminId });
    const { date: today, time: todayTime } = localNow(work.timeZone);
    if (materializeRecurrences) await this.materializeAll(adminId, workId);
    const [
      goalEntities,
      reportEntities,
      activityEntities,
      itemEntities,
      photoEntities,
      correctionEntities,
    ] = await Promise.all([
      this.db.getRepository(DailyGoal).find({
        where: { administratorId: adminId, workId, isActive: true },
        order: { workDate: 'DESC' },
      }),
      this.db.getRepository(DailyReport).find({
        where: { administratorId: adminId, workId },
        relations: { submittedByPerson: true },
        order: { workDate: 'DESC' },
      }),
      this.db
        .getRepository(Activity)
        .findBy({ administratorId: adminId, workId }),
      this.db.getRepository(DailyReportItem).find({
        where: { administratorId: adminId, workId },
        relations: { report: true },
        order: { report: { workDate: 'DESC' } },
      }),
      this.db
        .getRepository(ReportPhoto)
        .findBy({ administratorId: adminId, workId }),
      this.db.getRepository(ReportCorrection).find({
        where: { administratorId: adminId, workId },
        order: { createdAt: 'DESC' },
      }),
    ]);
    const goals = goalEntities.map((goal) => ({
      id: goal.id,
      activityId: goal.activityId,
      date: goal.workDate,
      description: goal.description,
      expectedQuantity: goal.expectedQuantity,
      unit: goal.unit,
      quantityStep: goal.quantityStep,
      quantityDecimals: goal.quantityDecimals,
    }));
    const reports = reportEntities.map((report) => {
      const responsibleName =
        report.submittedByPerson?.fullName ?? report.foremanNameSnapshot;
      return {
        id: report.id,
        date: report.workDate,
        foremanName: responsibleName,
        submittedByPersonId: report.submittedByPersonId,
        submittedBy: {
          personId: report.submittedByPersonId,
          name: responsibleName,
          accessType: report.submittedByPersonId ? 'PERSONAL' : 'LEGACY',
        },
        observations: report.observations,
        submittedAt: report.submittedAt,
        updatedAt: report.updatedAt,
      };
    });
    const activities = activityEntities.map((activity) => ({
      id: activity.id,
      name: activity.name,
      unit: activity.unit,
      customUnit: activity.customUnit,
      quantityStep: activity.quantityStep,
      quantityDecimals: activity.quantityDecimals,
    }));
    const items = itemEntities.map((item) => ({
      reportId: item.reportId,
      activityId: item.activityId,
      goalId: item.goalId,
      description: item.descriptionSnapshot,
      expected: item.expectedQuantitySnapshot,
      actual: item.actualQuantity,
      unit: item.unitSnapshot,
      date: item.report.workDate,
    }));
    const photos = photoEntities.map((photo) => ({
      id: photo.id,
      reportId: photo.reportId,
    }));
    const corrections = correctionEntities.map((item) => ({
      id: item.id,
      reportId: item.reportId,
      before: item.beforeValue,
      after: item.afterValue,
      reason: item.reason,
      createdAt: item.createdAt,
    }));
    const progress = activities.map((activity: any) => {
      const planned = goals
        .filter((g: any) => g.activityId === activity.id && g.date <= today)
        .reduce((s: number, g: any) => s + number(g.expectedQuantity), 0);
      const executed = items
        .filter((i: any) => i.activityId === activity.id && i.date <= today)
        .reduce((s: number, i: any) => s + number(i.actual), 0);
      const reportedDays = new Set(
        items
          .filter((i: any) => i.activityId === activity.id && i.date <= today)
          .map((i: any) => i.date),
      ).size;
      const remaining = goals
        .filter((g: any) => g.activityId === activity.id && g.date > today)
        .reduce((s: number, g: any) => s + number(g.expectedQuantity), 0);
      const rate = reportedDays >= 2 ? executed / reportedDays : null;
      const projectedDays =
        rate && rate > 0
          ? Math.ceil(Math.max(0, planned + remaining - executed) / rate)
          : null;
      return {
        activityId: activity.id,
        name: activity.name,
        unit: activity.unit,
        planned,
        executed,
        difference: executed - planned,
        compliance:
          planned > 0 ? Math.round(percentage(executed, planned)) : null,
        projectedDays,
        risk:
          projectedDays !== null &&
          projectedDays >
            Math.ceil(
              (Date.parse(`${work.estimatedEndDate}T12:00:00Z`) -
                Date.parse(`${today}T12:00:00Z`)) /
                86400000,
            ),
      };
    });
    return {
      today,
      todayTime,
      work: {
        id: work.id,
        name: work.name,
        description: work.description,
        location: work.location,
        startDate: work.startDate,
        estimatedEndDate: work.estimatedEndDate,
        status: work.status,
        foremanId: work.foremanId,
        foremanName: primaryForeman ? `${primaryForeman.firstName} ${primaryForeman.lastName}` : '',
        timeZone: work.timeZone,
        closeTime: work.closeTime,
        accessAlias: work.accessAlias,
      },
      goals,
      reports,
      items,
      photos,
      corrections,
      progress,
      activities,
    };
  }
}

@UseGuards(JwtGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}
  @Get('foremen') foremen(@Req() req: AdminRequest) {
    return this.service.foremen(req.administratorId);
  }
  @Post('foremen') createForeman(@Req() req: AdminRequest, @Body() body: any) {
    return this.service.saveForeman(req.administratorId, body);
  }
  @Patch('foremen/:id') updateForeman(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.saveForeman(req.administratorId, body, id);
  }
  @Get('works') works(@Req() req: AdminRequest) {
    return this.service.works(req.administratorId);
  }
  @Post('works') createWork(@Req() req: AdminRequest, @Body() body: any) {
    return this.service.saveWork(req.administratorId, body);
  }
  @Patch('works/:id') updateWork(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.saveWork(req.administratorId, body, id);
  }
  @Post('works/:id/rotate-code') rotateCode(
    @Req() req: AdminRequest,
    @Param('id') id: string,
  ) {
    return this.service.rotateCode(req.administratorId, id);
  }
  @Get('works/:id') detail(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.service.workDetail(req.administratorId, id);
  }
  @Get('works/:id/goals') goals(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Query('date') date: string,
  ) {
    return this.service.goals(req.administratorId, id, validDate(date));
  }
  @Post('works/:id/goals') createGoal(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: GoalInput,
  ) {
    return this.service.createGoal(req.administratorId, id, body);
  }
  @Patch('works/:id/goals/:goalId') updateGoal(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('goalId') goalId: string,
    @Body() body: any,
  ) {
    return this.service.updateGoal(req.administratorId, id, goalId, body);
  }
  @Post('works/:id/goals/copy') copy(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Body() body: { date: string },
  ) {
    return this.service.copyGoals(req.administratorId, id, body.date);
  }
  @Get('works/:id/recurrences') recurrences(
    @Req() req: AdminRequest,
    @Param('id') id: string,
  ) {
    return this.service.recurrences(req.administratorId, id);
  }
  @Delete('works/:id/recurrences/:recurrenceId') deactivate(
    @Req() req: AdminRequest,
    @Param('id') id: string,
    @Param('recurrenceId') recurrenceId: string,
  ) {
    return this.service.deactivateRecurrence(
      req.administratorId,
      id,
      recurrenceId,
    );
  }
  @Get('dashboard') dashboard(@Req() req: AdminRequest) {
    return this.service.dashboard(req.administratorId);
  }
}
