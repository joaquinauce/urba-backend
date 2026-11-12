import { describe, expect, it, vi } from 'vitest';
import { Administrator, Client, Person } from './database/entities.js';
import { PlatformService } from './platform.js';

function fixture(otherEmail = false) {
  const client = { id: 'client-a', name: 'A', legacyAdministratorId: 'admin-a',
    isActive: true, contactPhone: null, address: null, updatedAt: new Date() };
  const administrator = { id: 'admin-a', email: 'old@a.com', updatedAt: new Date() };
  const person = { id: 'person-a', administratorSourceId: 'admin-a', email: 'old@a.com', updatedAt: new Date() };
  const save = vi.fn(async (value: any) => value);
  const clientRepo = { createQueryBuilder: () => ({ setLock: () => ({
    where: () => ({ getOne: async () => client }),
  }) }), save };
  const ownerRepo = { findOneBy: async () => administrator, save,
    createQueryBuilder: () => ({ where: () => ({ getExists: async () => otherEmail }) }) };
  const personRepo = { findOneBy: async () => person, save,
    createQueryBuilder: () => ({ where: () => ({ getExists: async () => false }) }) };
  const manager = { query: vi.fn(async () => []), getRepository: (entity: unknown) =>
    entity === Client ? clientRepo : entity === Administrator ? ownerRepo : entity === Person ? personRepo : null };
  const db = { transaction: async (run: (manager: any) => Promise<any>) => run(manager) };
  return { service: new PlatformService(db as any), client, administrator, person, save, manager };
}

describe('operación de plataforma sobre clientes', () => {
  it('actualiza nombre, contacto y correo en la cuenta administradora y su persona vinculada', async () => {
    const { service, client, administrator, person, manager } = fixture();
    await service.update('client-a', { name: 'Nuevo nombre', contactPhone: '123', address: 'Calle 1',
      administratorEmail: ' NEW@A.COM ' });
    expect(client).toMatchObject({ name: 'Nuevo nombre', contactPhone: '123', address: 'Calle 1' });
    expect(administrator.email).toBe('new@a.com');
    expect(person.email).toBe('new@a.com');
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), ['new@a.com']);
  });

  it('rechaza un correo ocupado por otro administrador', async () => {
    const { service, administrator } = fixture(true);
    await expect(service.update('client-a', { administratorEmail: 'taken@a.com' }))
      .rejects.toMatchObject({ status: 409 });
    expect(administrator.email).toBe('old@a.com');
  });
});
