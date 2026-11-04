import { BadRequestException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { PeopleAdminService } from './people-admin.js';
import { Administrator, Person, PersonRole } from './database/entities.js';

describe('tipo de usuario', () => {
  it('rechaza combinaciones de administrador y capataz antes de guardar', async () => {
    const transaction = vi.fn();
    const service = new PeopleAdminService({ transaction } as any);
    await expect(service.create('owner-id', {
      fullName: 'Persona de prueba', roles: ['ADMINISTRATOR', 'FOREMAN'],
      email: 'persona@example.com', password: 'clave-segura-123',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('edición de personas', () => {
  it('permite renombrar a un jefe existente aunque todavía no tenga credenciales', async () => {
    const person = { id: 'person-id', administratorId: 'owner-id', administratorSourceId: null,
      fullName: 'Nombre anterior', email: null, passwordHash: null,
      isActive: true, sessionVersion: '0' };
    const manager = { getRepository: (entity: unknown) => {
      if (entity === Person) return { createQueryBuilder: () => ({
        addSelect() { return this; }, where() { return this; }, getOne: async () => person,
      }), save: async () => person };
      if (entity === PersonRole) return { findBy: async () => [{ roleCode: 'SITE_MANAGER' }] };
      throw new Error('Repositorio inesperado');
    } };
    const service = new PeopleAdminService({ transaction: (run: (value: unknown) => Promise<unknown>) => run(manager) } as any);
    await expect(service.update('owner-id', 'person-id', { fullName: 'Nombre nuevo' }))
      .resolves.toMatchObject({ fullName: 'Nombre nuevo' });
  });

  it('actualiza nombre y clave, e invalida el ingreso al desactivar', async () => {
    const person = {
      id: 'person-id', administratorId: 'owner-id', administratorSourceId: null,
      fullName: 'Nombre anterior', email: 'jefa@example.com', passwordHash: 'hash anterior',
      isActive: true, sessionVersion: '0',
    };
    const save = vi.fn(async () => person);
    const manager = { getRepository: (entity: unknown) => {
      if (entity === Person) return {
        createQueryBuilder: () => ({
          addSelect() { return this; }, where() { return this; },
          getOne: async () => person,
        }), save,
      };
      if (entity === PersonRole) return { findBy: async () => [{ roleCode: 'SITE_MANAGER' }] };
      if (entity === Administrator) return { createQueryBuilder: vi.fn() };
      throw new Error('Repositorio inesperado');
    } };
    const service = new PeopleAdminService({ transaction: (run: (value: unknown) => Promise<unknown>) => run(manager) } as any);
    const result = await service.update('owner-id', 'person-id', {
      fullName: 'Nombre nuevo', password: 'clave-nueva-123', isActive: false,
    });
    expect(result).toMatchObject({ fullName: 'Nombre nuevo', isActive: false });
    expect(await compare('clave-nueva-123', person.passwordHash)).toBe(true);
    expect(person.sessionVersion).toBe('2');
    expect(save).toHaveBeenCalledOnce();
  });
});
