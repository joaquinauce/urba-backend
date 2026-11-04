import { UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.js';
import { Administrator, Person } from './database/entities.js';

function repositoryFor<T>(entity: T) {
  const save = vi.fn(async () => entity);
  return { save, createQueryBuilder: () => ({
    addSelect() { return this; }, where() { return this; }, getOne: async () => entity,
  }) };
}

describe('cambio de clave propia', () => {
  it('exige la clave actual al administrador principal', async () => {
    const admin = { id: 'admin-1', passwordHash: await hash('clave-actual-123', 4) };
    const repository = repositoryFor(admin);
    const service = new AuthService({ getRepository: (type: unknown) => type === Administrator ? repository : null } as any, {} as any);
    await expect(service.changePassword('admin-1', undefined, { currentPassword: 'incorrecta', newPassword: 'clave-nueva-123' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.save).not.toHaveBeenCalled();
    await service.changePassword('admin-1', undefined, { currentPassword: 'clave-actual-123', newPassword: 'clave-nueva-123' });
    expect(await compare('clave-nueva-123', admin.passwordHash)).toBe(true);
  });

  it('cambia la clave personal e invalida sus sesiones anteriores', async () => {
    const person = { id: 'person-1', passwordHash: await hash('clave-actual-123', 4), sessionVersion: '3', updatedAt: new Date(0) };
    const repository = repositoryFor(person);
    const service = new AuthService({ getRepository: (type: unknown) => type === Person ? repository : null } as any, {} as any);
    await service.changePersonPassword('person-1', 'clave-actual-123', 'clave-nueva-123');
    expect(person.sessionVersion).toBe('4');
    expect(await compare('clave-nueva-123', person.passwordHash)).toBe(true);
    expect(repository.save).toHaveBeenCalledOnce();
  });
});
