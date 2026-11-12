import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthService, JwtGuard } from './auth.js';
import { PublicService } from './public.js';
import { PersonJwtGuard, WorkAuthorizationService } from './people-auth.js';
import { Administrator, Client, ClientMembership, Person, WorkAssignment } from './database/entities.js';

const clientA = { id: 'client-a', name: 'Constructora A', legacyAdministratorId: 'admin-a', isActive: true };
const clientB = { id: 'client-b', name: 'Constructora B', legacyAdministratorId: 'admin-b', isActive: true };

function context(token: string) {
  const request = { headers: { authorization: `Bearer ${token}` } } as any;
  return { request, execution: { switchToHttp: () => ({ getRequest: () => request }) } as any };
}

function fixture() {
  const state = {
    person: { id: 'person-1', administratorId: 'admin-a', fullName: 'Florencia', email: 'florencia@example.com',
      passwordHash: '', isActive: true, sessionVersion: '1' },
    memberships: [
      { clientId: clientA.id, personId: 'person-1', isActive: true, client: clientA },
      { clientId: clientB.id, personId: 'person-1', isActive: true, client: clientB },
    ],
    roles: [
      { clientId: clientA.id, personId: 'person-1', roleCode: 'SITE_MANAGER' },
      { clientId: clientB.id, personId: 'person-1', roleCode: 'FOREMAN' },
    ],
  };
  const findWork = vi.fn(async ({ where }: any) => where.clientId === clientB.id && where.workId === 'work-b'
    ? { work: { id: 'work-b', clientId: clientB.id, administratorId: 'admin-b' } } : null);
  const db = { getRepository: (entity: unknown) => {
    if (entity === Person) return {
      findOneBy: async ({ id, isActive }: any) => id === state.person.id && (!isActive || state.person.isActive) ? state.person : null,
      createQueryBuilder: () => ({ addSelect() { return this; }, where() { return this; }, andWhere() { return this; },
        getOne: async () => state.person }),
    };
    if (entity === ClientMembership) return { find: async ({ where }: any) =>
      state.memberships.filter((item) => item.personId === where.personId && item.isActive)
        .map((item) => ({ ...item, roles: state.roles.filter((role) => role.clientId === item.clientId) })) };
    if (entity === WorkAssignment) return { findOne: findWork };
    if (entity === Administrator) return {
      existsBy: async ({ id }: any) => id === 'admin-a',
      createQueryBuilder: () => ({ addSelect() { return this; }, where() { return this; }, andWhere() { return this; },
        getOne: async () => null }),
    };
    if (entity === Client) return { findOneBy: async ({ legacyAdministratorId }: any) =>
      legacyAdministratorId === 'admin-a' ? clientA : null };
    throw new Error('Unexpected repository');
  } } as any;
  return { state, db, findWork };
}

describe('sesiones con cliente autorizado', () => {
  const jwt = new JwtService({ secret: 'test-secret-with-more-than-32-characters' });

  it('no elige un cliente de una persona con varias pertenencias y permite seleccionar uno válido', async () => {
    const { state, db } = fixture();
    state.person.passwordHash = await hash('clave-segura-123', 4);
    state.roles[1].roleCode = 'SITE_MANAGER';
    const auth = new AuthService(db, jwt);
    const login = await auth.login(state.person.email, 'clave-segura-123', 'ip-1') as any;
    expect(login.accessToken).toBeUndefined();
    expect(login.requiresClientSelection).toBe(true);
    expect(login.clients.map((client: any) => client.clientId)).toEqual(['client-a', 'client-b']);
    await expect(auth.selectClient(login.selectionToken, 'client-unknown')).rejects.toBeInstanceOf(UnauthorizedException);
    const selected = await auth.selectClient(login.selectionToken, clientB.id) as any;
    expect((await jwt.verifyAsync(selected.accessToken)).clientId).toBe(clientB.id);
    expect(selected.person.roles).toEqual(['SITE_MANAGER']);
  });

  it('revoca solo el cliente desactivado y nunca acepta una obra de otro cliente', async () => {
    const { state, db, findWork } = fixture();
    const guard = new PersonJwtGuard(jwt, db);
    const tokenA = await jwt.signAsync({ type: 'person', sub: state.person.id, clientId: clientA.id,
      administratorId: 'admin-a', version: '1' });
    const tokenB = await jwt.signAsync({ type: 'person', sub: state.person.id, clientId: clientB.id,
      administratorId: 'admin-b', version: '1' });
    const requestA = context(tokenA);
    expect(await guard.canActivate(requestA.execution)).toBe(true);
    await expect(new WorkAuthorizationService(db).authorize(requestA.request.actor, 'work-b'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(findWork).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: clientA.id }) }));
    state.memberships[0].isActive = false;
    await expect(guard.canActivate(context(tokenA).execution)).rejects.toBeInstanceOf(UnauthorizedException);
    const requestB = context(tokenB);
    expect(await guard.canActivate(requestB.execution)).toBe(true);
    expect(requestB.request.actor.roles).toEqual(['FOREMAN']);
    expect((await new WorkAuthorizationService(db).authorize(requestB.request.actor, 'work-b')).id).toBe('work-b');
    state.roles.pop();
    await expect(guard.canActivate(context(tokenB).execution)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('acepta una sesión personal legada con un solo cliente y rechaza su ambigüedad', async () => {
    const { state, db } = fixture();
    state.memberships[1].isActive = false;
    const token = await jwt.signAsync({ type: 'person', sub: state.person.id,
      administratorId: 'admin-a', version: '1' });
    const guard = new PersonJwtGuard(jwt, db);
    expect(await guard.canActivate(context(token).execution)).toBe(true);
    state.memberships[1].isActive = true;
    await expect(guard.canActivate(context(token).execution)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('valida el rol administrativo y la pertenencia en cada petición', async () => {
    const { state, db } = fixture();
    state.roles[0].roleCode = 'ADMINISTRATOR';
    const token = await jwt.signAsync({ type: 'administrator_person', sub: state.person.id,
      clientId: clientA.id, administratorId: 'admin-a', version: '1' });
    const guard = new JwtGuard(jwt, db);
    const request = context(token);
    expect(await guard.canActivate(request.execution)).toBe(true);
    expect(request.request.administratorId).toBe('admin-a');
    state.roles.shift();
    await expect(guard.canActivate(context(token).execution)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('acepta el token legado de un administrador personal para su cliente original', async () => {
    const { state, db } = fixture();
    state.roles[0].roleCode = 'ADMINISTRATOR';
    const token = await jwt.signAsync({ type: 'administrator_person', sub: state.person.id,
      administratorId: 'admin-a', version: '1' });
    const request = context(token);
    expect(await new JwtGuard(jwt, db).canActivate(request.execution)).toBe(true);
    expect(request.request.clientId).toBe(clientA.id);
  });

  it('conserva el token del administrador principal legado mientras el cliente esté activo', async () => {
    const { db } = fixture();
    const token = await jwt.signAsync({ type: 'administrator', sub: 'admin-a', administratorId: 'admin-a' });
    const request = context(token);
    expect(await new JwtGuard(jwt, db).canActivate(request.execution)).toBe(true);
    expect(request.request.clientId).toBe(clientA.id);
  });

  it('autentica al administrador principal con su cliente legado', async () => {
    const { db } = fixture();
    const admin = { id: 'admin-a', email: 'admin@example.com', fullName: 'Administrador',
      passwordHash: await hash('clave-segura-123', 4), isActive: true };
    const original = db.getRepository.bind(db);
    db.getRepository = (entity: unknown) => entity === Administrator ? {
      createQueryBuilder: () => ({ addSelect() { return this; }, where() { return this; },
        andWhere() { return this; }, getOne: async () => admin }),
    } : original(entity);
    const result = await new AuthService(db, jwt).login(admin.email, 'clave-segura-123', 'ip-2') as any;
    expect(result.administrator.clientId).toBe(clientA.id);
    expect((await jwt.verifyAsync(result.accessToken)).clientId).toBe(clientA.id);
  });

  it('conserva la sesión legada del capataz por obra y verifica su cliente', async () => {
    const work = { id: 'work-a', clientId: clientA.id, client: clientA, accessAlias: 'OBRA-A',
      aliasPinHash: await hash('012345', 4), aliasSessionVersion: '2', status: 'ACTIVA',
      primaryForeman: { firstName: 'Florencia', lastName: 'Eliane', isActive: true } };
    const db = { getRepository: () => ({
      createQueryBuilder: () => ({ innerJoin() { return this; }, addSelect() { return this; },
        where() { return this; }, andWhere() { return this; }, getOne: async () => work }),
      findOne: async () => work,
    }) } as any;
    const publicService = new PublicService(db, {} as any, {} as any, jwt);
    const login = await publicService.aliasLogin('OBRA-A', '012345', 'ip-3');
    expect((await jwt.verifyAsync(login.accessToken)).clientId).toBe(clientA.id);
    const oldToken = await jwt.signAsync({ type: 'foreman', workId: work.id, version: '2' });
    expect((await publicService.session(context(oldToken).request)).id).toBe(work.id);
    work.client.isActive = false;
    await expect(publicService.session(context(oldToken).request)).rejects.toBeInstanceOf(UnauthorizedException);
    work.client.isActive = true;
  });
});
