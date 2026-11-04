import { ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkAuthorizationService,
  codeLookupHmac,
  validPersonalCode,
  type PersonActor,
} from './people-auth.js';

describe('códigos personales', () => {
  beforeEach(() => {
    process.env.PERSON_CODE_HMAC_SECRET =
      'unit-test-person-code-secret-with-32-characters';
  });
  afterEach(() => delete process.env.PERSON_CODE_HMAC_SECRET);

  it('valida exactamente seis dígitos y produce una búsqueda HMAC estable', () => {
    expect(validPersonalCode('012345')).toBe(true);
    expect(validPersonalCode('12345')).toBe(false);
    expect(validPersonalCode('12345A')).toBe(false);
    const first = codeLookupHmac('012345');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(codeLookupHmac('012345')).toBe(first);
    expect(codeLookupHmac('012346')).not.toBe(first);
  });
});

describe('autorización por asignación', () => {
  const actor: PersonActor = {
    kind: 'person',
    id: 'person-1',
    administratorId: 'admin-1',
    fullName: 'Persona',
    roles: ['SITE_MANAGER'],
  };

  it('permite escribir a un jefe de obra asignado', async () => {
    const work = { id: 'work-1' };
    const db = { getRepository: () => ({ findOne: vi.fn().mockResolvedValue({ work }) }) } as any;
    await expect(new WorkAuthorizationService(db).authorize(actor, 'work-1', true)).resolves.toBe(work);
  });

  it('exige una asignación activa incluso para lectura', async () => {
    const db = {
      getRepository: () => ({ findOne: vi.fn().mockResolvedValue(null) }),
    } as any;
    await expect(
      new WorkAuthorizationService(db).authorize(actor, 'work-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite escribir al capataz con asignación activa', async () => {
    const work = { id: 'work-1' };
    const db = {
      getRepository: () => ({
        findOne: vi.fn().mockResolvedValue({ work }),
      }),
    } as any;
    await expect(
      new WorkAuthorizationService(db).authorize(
        { ...actor, roles: ['FOREMAN'] },
        'work-1',
        true,
      ),
    ).resolves.toBe(work);
  });
});
