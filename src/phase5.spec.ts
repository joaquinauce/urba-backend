import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { AuthService, ContextGuard } from './auth.js';
import { scopedPersonSession } from './client-access.js';
import { ClientMembership, Person, WorkAssignment } from './database/entities.js';
import { PersonJwtGuard, WorkAuthorizationService } from './people-auth.js';

const jwt = new JwtService({ secret: 'phase-five-secret-with-at-least-32-characters' });
const person = { id: 'florencia', fullName: 'Florencia', email: 'florencia@example.com',
  isActive: true, sessionVersion: '2' } as Person;
const memberships = [
  { clientId: 'client-a', isActive: true, client: { id: 'client-a', name: 'Constructora A', isActive: true,
    legacyAdministratorId: 'admin-a' }, roles: [{ roleCode: 'ADMINISTRATOR' }, { roleCode: 'FOREMAN' }] },
  { clientId: 'client-b', isActive: true, client: { id: 'client-b', name: 'Constructora B', isActive: true,
    legacyAdministratorId: 'admin-b' }, roles: [{ roleCode: 'SITE_MANAGER' }] },
];
function database() {
  return { getRepository: (entity: unknown) => entity === Person ? { findOneBy: async () => person }
    : entity === ClientMembership ? { find: async () => memberships.filter(item => item.isActive) }
      : entity === WorkAssignment ? { findOne: async () => null } : null } as any;
}

describe('contexto multicliente de fase 5', () => {
  it('emite permisos administrativos y operativos juntos para A', async () => {
    const session = await scopedPersonSession(jwt, person, {
      clientId: 'client-a', administratorId: 'admin-a', name: 'Constructora A', roles: ['ADMINISTRATOR', 'FOREMAN'],
    }, 'password');
    expect(session).toMatchObject({ administrator: { clientId: 'client-a', roles: ['FOREMAN'] },
      person: { clientId: 'client-a', roles: ['FOREMAN'] } });
    expect((await jwt.verifyAsync<any>(session.accessToken)).mode).toBe('password');
  });

  it('cambia de A a B con token nuevo y respeta el rol diferente', async () => {
    const auth = new AuthService(database(), jwt);
    const choices = await auth.contexts(person.id, 'password');
    expect(choices.map(item => item.clientId)).toEqual(['client-a', 'client-b']);
    const session = await auth.switchClient(person.id, 'password', 'client-b');
    expect(session).toMatchObject({ person: { clientId: 'client-b', roles: ['SITE_MANAGER'] } });
    expect(session).not.toHaveProperty('administrator');
    expect((await jwt.verifyAsync<any>(session.accessToken)).clientId).toBe('client-b');
  });

  it('con PIN solo presenta roles operativos y no concede ADMINISTRATOR', async () => {
    const auth = new AuthService(database(), jwt);
    expect(await auth.contexts(person.id, 'pin')).toEqual([
      { clientId: 'client-a', name: 'Constructora A', roles: ['FOREMAN'] },
      { clientId: 'client-b', name: 'Constructora B', roles: ['SITE_MANAGER'] },
    ]);
    const session = await auth.switchClient(person.id, 'pin', 'client-a');
    expect(session).not.toHaveProperty('administrator');
    expect(session).toMatchObject({ person: { roles: ['FOREMAN'] } });
  });

  it('una revocación en B no impide volver a A, y B deja de ser seleccionable', async () => {
    const auth = new AuthService(database(), jwt);
    memberships[1].isActive = false;
    try {
      expect((await auth.contexts(person.id, 'password')).map(item => item.clientId)).toEqual(['client-a']);
      await expect(auth.switchClient(person.id, 'password', 'client-b')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(auth.switchClient(person.id, 'password', 'client-a')).resolves.toHaveProperty('accessToken');
    } finally { memberships[1].isActive = true; }
  });

  it('revocar FOREMAN en A invalida ese permiso sin afectar SITE_MANAGER en B', async () => {
    const guard = new PersonJwtGuard(jwt, database());
    const tokenA = await jwt.signAsync({ type: 'administrator_person', sub: person.id,
      clientId: 'client-a', administratorId: 'admin-a', version: '2' });
    const tokenB = await jwt.signAsync({ type: 'person', sub: person.id,
      clientId: 'client-b', administratorId: 'admin-b', version: '2' });
    const check = (token: string) => guard.canActivate({ switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
    }) } as any);
    const previous = memberships[0].roles;
    memberships[0].roles = [{ roleCode: 'ADMINISTRATOR' }];
    try {
      await expect(check(tokenA)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(check(tokenB)).resolves.toBe(true);
    } finally { memberships[0].roles = previous; }
  });

  it('rechaza una obra ajena o una asignación revocada aunque la URL cambie', async () => {
    const service = new WorkAuthorizationService(database());
    await expect(service.authorize({ kind: 'person', id: person.id, clientId: 'client-a',
      administratorId: 'admin-a', fullName: person.fullName, roles: ['FOREMAN'] }, 'work-b'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el guard conserva identidad para cambiar de cliente aun si el contexto actual fue revocado', async () => {
    const guard = new ContextGuard(jwt, database());
    const accessToken = await jwt.signAsync({ type: 'person', sub: person.id, mode: 'password',
      clientId: 'client-b', version: '2' });
    memberships[1].isActive = false;
    try {
      const request = { headers: { authorization: `Bearer ${accessToken}` } } as any;
      expect(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any)).toBe(true);
      expect(request.contextPersonId).toBe(person.id);
      expect(request.contextMode).toBe('password');
    } finally { memberships[1].isActive = true; }
  });
});
