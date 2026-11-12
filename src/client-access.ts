import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { type DataSource, type EntityManager } from 'typeorm';
import type { JwtService } from '@nestjs/jwt';
import { Client, ClientMembership, type Person } from './database/entities.js';

export type ClientAccess = {
  clientId: string;
  administratorId: string;
  name: string;
  roles: string[];
};

type Database = DataSource | EntityManager;

// Only legacy-backed clients can be served by the current repositories. A
// future phase can replace administratorId queries without changing identity.
export async function activeClientAccesses(db: Database, personId: string): Promise<ClientAccess[]> {
  const memberships = await db.getRepository(ClientMembership).find({
    where: { personId, isActive: true }, relations: { client: true, roles: true },
  });
  const active = memberships.filter((item) => item.client?.isActive && item.client.legacyAdministratorId);
  return active.map((item) => ({
    clientId: item.clientId,
    administratorId: item.client.legacyAdministratorId!,
    name: item.client.name,
    roles: item.roles.map((role) => role.roleCode),
  })).filter((item) => item.roles.length > 0);
}

export async function activeClientAccess(
  db: Database, personId: string, clientId: string, requiredRoles: readonly string[],
): Promise<ClientAccess> {
  const access = (await activeClientAccesses(db, personId))
    .find((item) => item.clientId === clientId && item.roles.some((role) => requiredRoles.includes(role)));
  if (!access) throw new UnauthorizedException('El acceso al cliente ya no está vigente');
  return access;
}

export function legacyClientContext(accesses: ClientAccess[], administratorId: string | undefined): ClientAccess {
  const matching = accesses.filter((item) => item.administratorId === administratorId);
  // Legacy tokens have no explicit client claim: never let them select one of
  // several active memberships by accident.
  if (accesses.length !== 1 || matching.length !== 1)
    throw new UnauthorizedException('La sesión requiere elegir un cliente');
  return matching[0];
}

export async function legacyAdministratorClient(db: Database, administratorId: string): Promise<Client> {
  const client = await db.getRepository(Client).findOneBy({ legacyAdministratorId: administratorId, isActive: true });
  if (!client) throw new ForbiddenException('El cliente no está activo');
  return client;
}

export async function scopedPersonSession(
  jwt: JwtService, person: Person, access: ClientAccess, mode: 'password' | 'pin',
) {
  const administrator = mode === 'password' && access.roles.includes('ADMINISTRATOR');
  const roles = access.roles.filter((role) => role === 'SITE_MANAGER' || role === 'FOREMAN');
  const accessToken = await jwt.signAsync({
    type: administrator ? 'administrator_person' : 'person',
    sub: person.id,
    clientId: access.clientId,
    administratorId: access.administratorId,
    mode,
    version: String(person.sessionVersion),
  }, administrator ? undefined : { expiresIn: '8h' });
  return administrator
    ? { accessToken, administrator: { id: person.id, email: person.email, fullName: person.fullName, role: 'ADMINISTRATOR', clientId: access.clientId, clientName: access.name, roles },
        ...(roles.length ? { person: { id: person.id, clientId: access.clientId, clientName: access.name, administratorId: access.administratorId, fullName: person.fullName, roles } } : {}) }
    : { accessToken, person: { id: person.id, clientId: access.clientId, clientName: access.name, administratorId: access.administratorId, fullName: person.fullName, roles } };
}
