import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { InvitationService, IdentityGuard } from './invitations.js';
import { PlatformGuard } from './platform-access.js';
import { PeopleAdminService } from './people-admin.js';
import { Administrator, Client, ClientInvitation, ClientMembership, ClientRole, Person, PersonRole, Role } from './database/entities.js';

describe('invitación y aceptación de una persona existente', () => {
  it('solo permite que la identidad invitada acepte una vez, sin cambiar A', async () => {
    const token = 'a'.repeat(43);
    const tokenHash = (await import('node:crypto')).createHash('sha256').update(token).digest('hex');
    const invitation = { id: 'invite-b', clientId: 'client-b', personId: 'florencia', roleCode: 'FOREMAN',
      tokenHash, expiresAt: new Date(Date.now() + 60_000), acceptedAt: null as Date | null,
      revokedAt: null, createdAt: new Date() };
    const memberships = [{ clientId: 'client-a', personId: 'florencia', isActive: true }];
    const roles = [{ clientId: 'client-a', personId: 'florencia', roleCode: 'SITE_MANAGER' }];
    const manager = { getRepository: (entity: unknown) => entity === ClientInvitation ? {
      createQueryBuilder: () => ({ addSelect() { return this; }, where(_sql: string, params: any) { this.personId = params.personId; return this; },
        setLock() { return this; }, personId: '', getOne: async function () { return this.personId === invitation.personId ? invitation : null; } }),
      save: async () => invitation,
    } : entity === Client ? { findOneBy: async () => ({ id: 'client-b', isActive: true }) }
      : entity === ClientMembership ? { upsert: async (item: any) => { memberships.push(item); } }
        : entity === ClientRole ? { upsert: async (item: any) => { roles.push(item); } } : null };
    const service = new InvitationService({ transaction: (run: any) => run(manager) } as any);
    await expect(service.accept('otra-persona', invitation.id, token)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.accept('florencia', invitation.id, 'b'.repeat(43))).rejects.toThrow('Invitación inválida');
    await expect(service.accept('florencia', invitation.id, token)).resolves.toMatchObject({ clientId: 'client-b', accepted: true });
    expect(memberships).toEqual(expect.arrayContaining([{ clientId: 'client-a', personId: 'florencia', isActive: true }]));
    expect(roles).toEqual(expect.arrayContaining([{ clientId: 'client-a', personId: 'florencia', roleCode: 'SITE_MANAGER' },
      { clientId: 'client-b', personId: 'florencia', roleCode: 'FOREMAN' }]));
    await expect(service.accept('florencia', invitation.id, token)).rejects.toThrow('ya no está vigente');
  });

  it('exige sesión de la persona y un rol vigente en su cliente actual', async () => {
    const jwt = new JwtService({ secret: 'test-secret-with-more-than-32-characters' });
    const account = { id: 'florencia', isActive: true, sessionVersion: '1' };
    const membership = { clientId: 'client-a', personId: account.id, isActive: true,
      client: { id: 'client-a', name: 'A', isActive: true, legacyAdministratorId: 'admin-a' },
      roles: [{ roleCode: 'SITE_MANAGER' }] };
    const db = { getRepository: (entity: unknown) => entity === Person ? { findOneBy: async () => account }
      : entity === ClientMembership ? { find: async () => membership.isActive ? [membership] : [] } : null } as any;
    const guard = new IdentityGuard(jwt, db);
    const token = await jwt.signAsync({ type: 'person', sub: account.id, clientId: 'client-a', administratorId: 'admin-a', version: '1' });
    const request = { headers: { authorization: `Bearer ${token}` } } as any;
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.identityPersonId).toBe(account.id);
    membership.isActive = false;
    await expect(guard.canActivate(context)).rejects.toThrow('sesión personal');
  });
});

describe('operaciones de plataforma', () => {
  it('rechaza a un administrador de cliente que no figura en la lista de plataforma', () => {
    const prior = process.env.PLATFORM_OPERATOR_IDS;
    process.env.PLATFORM_OPERATOR_IDS = 'platform-id';
    try {
      const context = { switchToHttp: () => ({ getRequest: () => ({ administratorId: 'client-admin-id' }) }) } as any;
      expect(() => new PlatformGuard().canActivate(context)).toThrow(ForbiddenException);
    } finally {
      if (prior === undefined) delete process.env.PLATFORM_OPERATOR_IDS;
      else process.env.PLATFORM_OPERATOR_IDS = prior;
    }
  });
});

describe('identidad única bajo altas simultáneas', () => {
  it('crea una persona para A y una invitación para B con el mismo person_id', async () => {
    let globalPerson: any = null;
    const memberships = new Set<string>();
    const invitations: any[] = [];
    const locks = new Map<string, Promise<void>>();
    function transaction<T>(run: (manager: any) => Promise<T>) {
      let release: (() => void) | undefined;
      const manager = { query: async (_sql: string, [email]: string[]) => {
        const prior = locks.get(email) ?? Promise.resolve();
        let unlock!: () => void;
        const current = new Promise<void>((resolve) => { unlock = resolve; });
        locks.set(email, prior.then(() => current));
        await prior; release = unlock;
      }, getRepository: (entity: unknown) => entity === Administrator ? {
        createQueryBuilder: () => ({ where() { return this; }, getExists: async () => false }),
      } : entity === Person ? {
        createQueryBuilder: () => ({ where() { return this; }, getOne: async () => globalPerson }),
        create: (item: any) => item, insert: async (item: any) => { globalPerson = { ...item, isActive: true }; },
      } : entity === PersonRole ? { insert: async (items: any[]) => { memberships.add(items[0].administratorId); } }
        : entity === Role ? { countBy: async () => 1 }
          : entity === ClientMembership ? { existsBy: async ({ clientId }: any) => memberships.has(clientId) }
            : entity === ClientInvitation ? { update: async () => ({}), insert: async (item: any) => { invitations.push(item); } } : null };
      return run(manager).finally(() => release?.());
    }
    const service = new PeopleAdminService({ transaction } as any);
    const [a, b] = await Promise.all([
      service.create('admin-a', { fullName: 'Florencia', roles: ['SITE_MANAGER'],
        email: 'Florencia@example.com', password: 'clave-segura-123' }, 'client-a'),
      service.create('admin-b', { fullName: 'Duplicado', roles: ['FOREMAN'],
        email: ' florencia@example.com ' }, 'client-b'),
    ]);
    expect((a as any).id).toBe(globalPerson.id);
    expect((b as any).pendingInvitation).toBe(true);
    expect(invitations).toHaveLength(1);
    expect(invitations[0].personId).toBe(globalPerson.id);
    expect(globalPerson.fullName).toBe('Florencia');
    expect(globalPerson.passwordHash).toMatch(/^\$2/);
  });
});

describe('script de fase 4', () => {
  it('es manual, transaccional y no altera tablas históricas', async () => {
    const script = await readFile(new URL('../sql/20261112_004_invitaciones_multicliente.sql', import.meta.url), 'utf8');
    expect(script).toMatch(/^BEGIN;/m);
    expect(script).toMatch(/^COMMIT;/m);
    expect(script).toContain('CREATE TABLE client_invitations');
    expect(script).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE)\s+(works|people|daily_reports|expense_reports)\b/i);
  });
});
