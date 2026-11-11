import { describe, expect, it, vi } from 'vitest';
import { PeopleAdminService } from './people-admin.js';
import { Work, WorkAssignment } from './database/entities.js';

function setup(roleCode: string, count: number, isPrimary = false) {
  const assignment = { id: 'assignment-1', roleCode, isPrimary, unassignedAt: null as Date | null, updatedAt: new Date() };
  const builder = (value: unknown) => ({ where() { return this; }, setLock() { return this; }, getOne: async () => value });
  const save = vi.fn(async () => assignment);
  const manager = { getRepository: (entity: unknown) => entity === Work
    ? { createQueryBuilder: () => builder({ id: 'work-1' }) }
    : entity === WorkAssignment
      ? { createQueryBuilder: () => builder(assignment), countBy: vi.fn(async () => count), save }
      : undefined };
  const service = new PeopleAdminService({ transaction: (run: (value: typeof manager) => Promise<unknown>) => run(manager) } as never);
  return { service, assignment, save };
}

describe('desasignación de responsables', () => {
  it('impide quitar el único jefe de obra', async () => {
    const { service, save } = setup('SITE_MANAGER', 1);
    await expect(service.unassign('admin', 'work-1', 'assignment-1')).rejects.toThrow('conservar un jefe');
    expect(save).not.toHaveBeenCalled();
  });

  it('permite quitar un capataz adicional', async () => {
    const { service, assignment, save } = setup('FOREMAN', 1);
    await service.unassign('admin', 'work-1', 'assignment-1');
    expect(assignment.unassignedAt).toBeInstanceOf(Date);
    expect(save).toHaveBeenCalledOnce();
  });

  it('protege al capataz principal', async () => {
    const { service, save } = setup('FOREMAN', 2, true);
    await expect(service.unassign('admin', 'work-1', 'assignment-1')).rejects.toThrow('capataz principal');
    expect(save).not.toHaveBeenCalled();
  });

  it('permite quitar un jefe marcado como principal si queda otro', async () => {
    const { service, assignment, save } = setup('SITE_MANAGER', 2, true);
    await service.unassign('admin', 'work-1', 'assignment-1');
    expect(assignment.unassignedAt).toBeInstanceOf(Date);
    expect(save).toHaveBeenCalledOnce();
  });
});
