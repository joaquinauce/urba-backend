import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PeopleAdminService } from './people-admin.js';
import { Administrator, ClientInvitation, ClientMembership, ClientRole, Person, PersonRole, Role, Work, WorkAssignment } from './database/entities.js';

const person = { id: 'person-a', administratorId: 'admin-a', administratorSourceId: null,
  fullName: 'Florencia', email: 'florencia@example.com', passwordHash: 'hash-global',
  pinHash: 'pin-global', isActive: true, sessionVersion: '4' };

describe('personas por cliente', () => {
  it('rechaza cambios de credenciales y nombre global desde la administración', async () => {
    const transaction = vi.fn();
    const service = new PeopleAdminService({ transaction } as any);
    for (const body of [{ fullName: 'Otro nombre' }, { email: 'otro@example.com' }, { password: 'nueva-clave-123' }])
      await expect(service.update('admin-b', person.id, body, 'client-b')).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('desactiva solo la pertenencia B y conserva la identidad global', async () => {
    const membership = { clientId: 'client-b', personId: person.id, isActive: true, updatedAt: new Date(0) };
    const save = vi.fn(async () => membership);
    const manager = { getRepository: (entity: unknown) => entity === Person ? {
      createQueryBuilder: () => ({ innerJoin() { return this; }, addSelect() { return this; },
        where() { return this; }, setLock() { return this; }, getOne: async () => person }),
    } : entity === ClientMembership ? { findOneBy: async () => membership, save }
      : entity === ClientRole ? { findBy: async () => [{ roleCode: 'FOREMAN' }] } : null };
    const service = new PeopleAdminService({ transaction: (run: any) => run(manager) } as any);
    const result = await service.update('admin-b', person.id, { isActive: false }, 'client-b');
    expect(result.isActive).toBe(false);
    expect(membership.isActive).toBe(false);
    expect(person.isActive).toBe(true);
    expect(person.passwordHash).toBe('hash-global');
    expect(person.sessionVersion).toBe('4');
    expect(save).toHaveBeenCalledOnce();
  });

  it('cambia el rol en B sin tocar el rol, PIN ni clave de A', async () => {
    const membership = { clientId: 'client-b', personId: person.id, isActive: true };
    let roles = [{ roleCode: 'SITE_MANAGER' }];
    const legacyRoles = { insert: vi.fn(), delete: vi.fn(), existsBy: vi.fn() };
    const manager = { getRepository: (entity: unknown) => entity === Person ? {
      createQueryBuilder: () => ({ innerJoin() { return this; }, addSelect() { return this; },
        where() { return this; }, setLock() { return this; }, getOne: async () => person }),
    } : entity === ClientMembership ? { findOneBy: async () => membership }
      : entity === ClientRole ? { findBy: async () => roles,
        delete: async () => { roles = []; }, insert: async () => { roles = [{ roleCode: 'FOREMAN' }]; } }
        : entity === PersonRole ? legacyRoles : null };
    const service = new PeopleAdminService({ transaction: (run: any) => run(manager) } as any);
    const result = await service.update('admin-b', person.id, { roles: ['FOREMAN'] }, 'client-b');
    expect(result.roles).toEqual(['FOREMAN']);
    expect(legacyRoles.insert).not.toHaveBeenCalled();
    expect(legacyRoles.delete).not.toHaveBeenCalled();
    expect(person.pinHash).toBe('pin-global');
    expect(person.passwordHash).toBe('hash-global');
    expect(person.sessionVersion).toBe('4');
  });

  it('reutiliza la identidad existente y prepara una invitación sin alterar su cuenta', async () => {
    const query = vi.fn(async () => []);
    const personInsert = vi.fn();
    const invitationInsert = vi.fn();
    const manager = { query, getRepository: (entity: unknown) => entity === Administrator ? {
      createQueryBuilder: () => ({ where() { return this; }, getExists: async () => false }),
    } : entity === Person ? { createQueryBuilder: () => ({ where() { return this; }, getOne: async () => person }), insert: personInsert }
      : entity === Role ? { countBy: async () => 1 }
        : entity === ClientMembership ? { existsBy: async () => false }
          : entity === ClientInvitation ? { update: async () => ({}), insert: invitationInsert } : null };
    const service = new PeopleAdminService({ transaction: (run: any) => run(manager) } as any);
    const result = await service.create('admin-b', { roles: ['FOREMAN'], email: ' FLORENCIA@example.com ' }, 'client-b') as any;
    expect(result.pendingInvitation).toBe(true);
    expect(result.email).toBe('florencia@example.com');
    expect(result).not.toHaveProperty('personId');
    expect(personInsert).not.toHaveBeenCalled();
    expect(invitationInsert).toHaveBeenCalledWith(expect.objectContaining({ personId: person.id, clientId: 'client-b' }));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), ['florencia@example.com']);
    expect(person.passwordHash).toBe('hash-global');
  });
  it('solo asigna a obras y roles del cliente autorizado', async () => {
    const inserted: any[] = [];
    let visibleWork = true;
    let activeMembership = true;
    const manager = { getRepository: (entity: unknown) => entity === Work ? {
      createQueryBuilder: () => ({ where() { return this; }, setLock() { return this; },
        getOne: async () => visibleWork ? { id: 'work-b', clientId: 'client-b' } : null }),
    } : entity === Person ? {
      createQueryBuilder: () => ({ innerJoin() { return this; }, addSelect() { return this; },
        where() { return this; }, setLock() { return this; }, getOne: async () => person }),
    } : entity === ClientMembership ? { existsBy: async () => activeMembership }
      : entity === ClientRole ? { findOneBy: async () => ({ roleCode: 'FOREMAN' }) }
        : entity === WorkAssignment ? { create: (value: any) => value, insert: async (value: any) => { inserted.push(value); } } : null };
    const service = new PeopleAdminService({ transaction: (run: any) => run(manager) } as any);
    await expect(service.assign('admin-b', 'work-b', { personId: person.id, roleCode: 'FOREMAN' }, 'client-b'))
      .resolves.toMatchObject({ personId: person.id, roleCode: 'FOREMAN' });
    expect(inserted[0]).toMatchObject({ clientId: 'client-b', workId: 'work-b', personId: person.id });
    visibleWork = false;
    await expect(service.assign('admin-b', 'work-a', { personId: person.id, roleCode: 'FOREMAN' }, 'client-b'))
      .rejects.toBeInstanceOf(NotFoundException);
    activeMembership = false; visibleWork = true;
    await expect(service.assign('admin-b', 'work-b', { personId: person.id, roleCode: 'FOREMAN' }, 'client-b'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toHaveLength(1);
  });
});
