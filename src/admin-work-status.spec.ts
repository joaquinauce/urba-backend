import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { AdminService } from './admin.js';
import { Foreman, Person, PersonRole, Work, WorkAssignment } from './database/entities.js';
import { localNow } from './shared.js';

function setup(status = 'ACTIVA') {
  const today = localNow('America/Argentina/Cordoba').date;
  const end = new Date(Date.parse(`${today}T12:00:00Z`) + 5 * 86400000).toISOString().slice(0, 10);
  const work = Object.assign(new Work(), { id: 'work-1', administratorId: 'admin', status, startDate: today, estimatedEndDate: end, timeZone: 'America/Argentina/Cordoba', pauseReason: status === 'PAUSADA' ? 'Faltan insumos' : null });
  const query = { where: vi.fn().mockReturnThis(), setLock: vi.fn().mockReturnThis(), getOne: vi.fn(async () => work) };
  const save = vi.fn(async (value: Work) => value);
  const repo = { createQueryBuilder: () => query, save };
  const db = { transaction: async (callback: (tx: { getRepository: () => typeof repo }) => Promise<unknown>) => callback({ getRepository: () => repo }) } as unknown as DataSource;
  return { service: new AdminService(db), work, save, today, end };
}

describe('pausa y reactivación de obras', () => {
  it('requiere motivo y lo conserva al pausar', async () => {
    const { service, work, save } = setup();
    await expect(service.pauseWork('admin', 'work-1', '  ')).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    await service.pauseWork('admin', 'work-1', 'Faltan insumos');
    expect(work.status).toBe('PAUSADA');
    expect(work.pauseReason).toBe('Faltan insumos');
    expect(save).toHaveBeenCalledOnce();
  });

  it('exige nueva fecha válida al reactivar y limpia el motivo', async () => {
    const { service, work, save, today } = setup('PAUSADA');
    await expect(service.resumeWork('admin', 'work-1', '2020-01-01')).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    const newEnd = new Date(Date.parse(`${today}T12:00:00Z`) + 12 * 86400000).toISOString().slice(0, 10);
    await service.resumeWork('admin', 'work-1', newEnd);
    expect(work.status).toBe('ACTIVA');
    expect(work.pauseReason).toBeNull();
    expect(work.estimatedEndDate).toBe(newEnd);
  });
});

describe('edición de responsables de obra', () => {
  it('cambia el capataz y desasigna al anterior en la misma transacción', async () => {
    const work = Object.assign(new Work(), { id: 'work-1', administratorId: 'admin', foremanId: 'foreman-1' });
    const prior = Object.assign(new WorkAssignment(), { id: 'primary-old', personId: 'person-old', isPrimary: true, unassignedAt: null });
    const promoted = Object.assign(new WorkAssignment(), { id: 'extra-new', personId: 'person-new', isPrimary: false, unassignedAt: null });
    const query = { where: vi.fn().mockReturnThis(), setLock: vi.fn().mockReturnThis(), getOne: vi.fn(async () => work) };
    const workSave = vi.fn(async (value: Work) => value);
    const assignmentSave = vi.fn(async (value: WorkAssignment) => value);
    const repositories = new Map<unknown, unknown>([
      [Work, { createQueryBuilder: () => query, save: workSave }],
      [Foreman, { findOneBy: vi.fn(async () => ({ id: 'foreman-2', firstName: 'Pedro', lastName: 'Gómez' })) }],
      [Person, { findOneBy: vi.fn(async () => ({ id: 'person-new' })) }],
      [WorkAssignment, { find: vi.fn(async () => [prior]), findOneBy: vi.fn(async () => promoted), save: assignmentSave, insert: vi.fn() }],
    ]);
    const manager = { getRepository: (entity: unknown) => repositories.get(entity) };
    const db = { transaction: async (callback: (tx: typeof manager) => Promise<unknown>) => callback(manager) } as unknown as DataSource;
    const service = new AdminService(db);
    await expect(service.changeWorkForeman('admin', 'work-1', 'foreman-2')).resolves.toMatchObject({ foremanId: 'foreman-2', foremanName: 'Pedro Gómez' });
    expect(work.foremanId).toBe('foreman-2');
    expect(prior.unassignedAt).toBeInstanceOf(Date);
    expect(prior.isPrimary).toBe(false);
    expect(promoted.isPrimary).toBe(true);
    expect(assignmentSave).toHaveBeenCalledTimes(2);
    expect(workSave).toHaveBeenCalledOnce();
  });

  it('reemplaza el jefe de obra seleccionado dentro de la actualización', async () => {
    const today = localNow('America/Argentina/Cordoba').date;
    const work = Object.assign(new Work(), {
      id: 'work-1', administratorId: 'admin', foremanId: 'foreman-1',
      name: 'Obra', startDate: today, estimatedEndDate: today, status: 'ACTIVA',
      timeZone: 'America/Argentina/Cordoba', closeTime: '19:00', accessAlias: null,
      aliasPinHash: null, aliasSessionVersion: '0',
    });
    const prior = { id: 'assignment-old', personId: 'manager-old', unassignedAt: null as Date | null, updatedAt: new Date() };
    const query = { addSelect: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), getOne: vi.fn(async () => work) };
    const saveAssignment = vi.fn(async () => prior);
    const insertAssignment = vi.fn(async () => ({}));
    const workRepo = { createQueryBuilder: () => query, save: vi.fn(async (value: Work) => value) };
    const assignmentsRepo = { find: vi.fn(async () => [prior]), save: saveAssignment, insert: insertAssignment };
    const personRepo = { findOneBy: vi.fn(async () => ({ id: 'manager-new', isActive: true })) };
    const roleRepo = { findOneBy: vi.fn(async () => ({ roleCode: 'SITE_MANAGER' })) };
    const foremanRepo = { existsBy: vi.fn(async () => true) };
    const repositories = new Map<unknown, unknown>([
      [Work, workRepo], [WorkAssignment, assignmentsRepo], [Person, personRepo],
      [PersonRole, roleRepo], [Foreman, foremanRepo],
    ]);
    const manager = { getRepository: (entity: unknown) => repositories.get(entity) };
    const db = { ...manager, transaction: async (callback: (tx: typeof manager) => Promise<unknown>) => callback(manager) } as unknown as DataSource;
    const service = new AdminService(db);
    await service.saveWork('admin', {
      name: 'Obra', description: '', location: '', startDate: today, estimatedEndDate: today,
      foremanId: 'foreman-1', siteManagerId: 'manager-new', closeTime: '19:00', timeZone: 'America/Argentina/Cordoba', accessAlias: '', aliasPin: '',
    }, 'work-1');
    expect(prior.unassignedAt).toBeInstanceOf(Date);
    expect(saveAssignment).toHaveBeenCalledOnce();
    expect(insertAssignment).toHaveBeenCalledWith(expect.objectContaining({ personId: 'manager-new', roleCode: 'SITE_MANAGER' }));
    expect(workRepo.save).toHaveBeenCalledOnce();
  });
});
