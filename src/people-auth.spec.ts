import { ForbiddenException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkAuthorizationService,
  PersonAuthService,
  codeLookupHmac,
  validPersonalCode,
  type PersonActor,
} from './people-auth.js';
import { ClientMembership, Person } from './database/entities.js';

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
    clientId: 'client-1',
    administratorId: 'admin-1',
    fullName: 'Persona',
    roles: ['SITE_MANAGER'],
  };

  it('permite escribir a un jefe de obra asignado', async () => {
    const work = { id: 'work-1', clientId: 'client-1', administratorId: 'admin-1' };
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
    const work = { id: 'work-1', clientId: 'client-1', administratorId: 'admin-1' };
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

describe('ingreso personal', () => {
  beforeEach(() => { process.env.PERSON_CODE_HMAC_SECRET = 'unit-test-person-code-secret-with-32-characters'; });
  afterEach(() => delete process.env.PERSON_CODE_HMAC_SECRET);

  it('acepta el PIN correcto, devuelve el rol SITE_MANAGER e invalida el contador del código', async () => {
    const person = { id: 'person-1', administratorId: 'admin-1', fullName: 'Jefa',
      isActive: true, pinHash: await hash('012345', 4), failedAttempts: 0,
      lockedUntil: null, sessionVersion: '2' };
    const save = vi.fn();
    const manager = { getRepository: (entity: unknown) => entity === Person ? {
      createQueryBuilder: () => ({ addSelect() { return this; }, where() { return this; },
        setLock() { return this; }, getOne: async () => person }), save,
    } : entity === ClientMembership ? { find: async () => [{ clientId: 'client-1', isActive: true,
      client: { id: 'client-1', legacyAdministratorId: 'admin-1', name: 'A', isActive: true },
      roles: [{ roleCode: 'SITE_MANAGER' }] }] } : null };
    const security = { reserve: vi.fn(), event: vi.fn(), clearCode: vi.fn() };
    const jwt = { signAsync: vi.fn().mockResolvedValue('token') };
    const service = new PersonAuthService({ transaction: (run: any) => run(manager) } as any, jwt as any, security as any);
    await expect(service.login('012345', 'test-ip')).resolves.toMatchObject({ accessToken: 'token', person: { roles: ['SITE_MANAGER'] } });
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ version: '2' }), { expiresIn: '8h' });
    expect(security.clearCode).toHaveBeenCalledWith('012345');
    expect(security.event).toHaveBeenCalledWith('LOGIN_SUCCESS', 'test-ip', 'person-1', 'admin-1');
  });

  it('da el mismo error para PIN inexistente e identificable pero inactivo', async () => {
    const security = { reserve: vi.fn(), event: vi.fn(), clearCode: vi.fn() };
    const makeService = (person: unknown) => new PersonAuthService({ transaction: (run: any) => run({
      getRepository: () => ({ createQueryBuilder: () => ({ addSelect() { return this; }, where() { return this; },
        setLock() { return this; }, getOne: async () => person }) }),
    }) } as any, { signAsync: vi.fn() } as any, security as any);
    const unknown = await makeService(null).login('012345', 'test-ip').catch((error) => error);
    const inactive = await makeService({ id: 'person-1', administratorId: 'admin-1', isActive: false }).login('012345', 'test-ip').catch((error) => error);
    expect(unknown.status).toBe(401);
    expect(inactive.status).toBe(401);
    expect(unknown.message).toBe(inactive.message);
  });

  it('ofrece los clientes del capataz compartido sin elegir uno por él', async () => {
    const person = { id: 'person-1', administratorId: 'admin-a', fullName: 'Florencia',
      isActive: true, pinHash: await hash('012345', 4), failedAttempts: 0,
      lockedUntil: null, sessionVersion: '2' };
    const memberships = [
      { clientId: 'client-a', personId: person.id, isActive: true,
        client: { name: 'A', legacyAdministratorId: 'admin-a', isActive: true } },
      { clientId: 'client-b', personId: person.id, isActive: true,
        client: { name: 'B', legacyAdministratorId: 'admin-b', isActive: true } },
    ];
    const repository = (entity: unknown) => entity === Person ? {
      createQueryBuilder: () => ({ addSelect() { return this; }, where() { return this; },
        setLock() { return this; }, getOne: async () => person }),
      findOneBy: async () => person, save: async () => person,
    } : entity === ClientMembership ? { find: async () => memberships.map((item) =>
      ({ ...item, roles: [{ roleCode: 'FOREMAN' }] })) } : null;
    const db = { transaction: (run: any) => run({ getRepository: repository }), getRepository: repository } as any;
    const jwt = new JwtService({ secret: 'test-secret-with-more-than-32-characters' });
    const security = { reserve: vi.fn(), event: vi.fn(), clearCode: vi.fn() };
    const service = new PersonAuthService(db, jwt, security as any);
    const login = await service.login('012345', 'test-ip') as any;
    expect(login.accessToken).toBeUndefined();
    expect(login.clients.map((item: any) => item.clientId)).toEqual(['client-a', 'client-b']);
    const chosen = await service.selectClient(login.selectionToken, 'client-b') as any;
    expect((await jwt.verifyAsync(chosen.accessToken)).clientId).toBe('client-b');
    expect(chosen.person.roles).toEqual(['FOREMAN']);
  });
});
