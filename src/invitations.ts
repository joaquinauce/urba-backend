import { BadRequestException, Body, CanActivate, ConflictException, Controller, ExecutionContext, Get, Inject, Injectable, NotFoundException, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { IsNull, type DataSource } from 'typeorm';
import { DB } from './database.module.js';
import { Client, ClientInvitation, ClientMembership, ClientRole, Person } from './database/entities.js';
import { activeClientAccess, activeClientAccesses, legacyClientContext } from './client-access.js';

type IdentityRequest = Request & { identityPersonId: string };
const ALL_ROLES = ['ADMINISTRATOR', 'SITE_MANAGER', 'FOREMAN'] as const;

@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, @Inject(DB) private readonly db: DataSource) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    const header = request.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{ type: string; sub: string; clientId?: string;
        administratorId?: string; version: string }>(header.slice(7));
      if (!['person', 'administrator_person'].includes(payload.type)) throw new Error('identity');
      const person = await this.db.getRepository(Person).findOneBy({ id: payload.sub, isActive: true });
      if (!person || String(person.sessionVersion) !== String(payload.version)) throw new Error('revoked');
      const access = payload.clientId
        ? await activeClientAccess(this.db, person.id, payload.clientId, ALL_ROLES)
        : legacyClientContext(await activeClientAccesses(this.db, person.id), payload.administratorId);
      if (payload.administratorId && payload.administratorId !== access.administratorId) throw new Error('owner');
      if (payload.type === 'administrator_person' && !access.roles.includes('ADMINISTRATOR')) throw new Error('role');
      if (payload.type === 'person' && !access.roles.some((role) => role === 'SITE_MANAGER' || role === 'FOREMAN')) throw new Error('role');
      request.identityPersonId = person.id;
      return true;
    } catch { throw new UnauthorizedException('La sesión personal no es válida'); }
  }
}

@Injectable()
export class InvitationService {
  constructor(@Inject(DB) private readonly db: DataSource) {}

  async pending(personId: string) {
    const invitations = await this.db.getRepository(ClientInvitation).find({
      where: { personId, acceptedAt: IsNull(), revokedAt: IsNull() },
      relations: { client: true }, order: { createdAt: 'DESC' },
    });
    const now = Date.now();
    return invitations.filter((item) => item.expiresAt.getTime() > now && item.client.isActive)
      .map((item) => ({ id: item.id, clientName: item.client.name, roleCode: item.roleCode,
        expiresAt: item.expiresAt }));
  }

  async accept(personId: string, id: string, token: unknown) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(token))
      throw new BadRequestException('Invitación inválida');
    return this.db.transaction(async (manager) => {
      const invitation = await manager.getRepository(ClientInvitation).createQueryBuilder('invitation')
        .addSelect('invitation.tokenHash')
        .where('invitation.id = :id AND invitation.personId = :personId', { id, personId })
        .setLock('pessimistic_write').getOne();
      if (!invitation) throw new NotFoundException('Invitación no encontrada');
      if (invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt.getTime() <= Date.now())
        throw new ConflictException('La invitación ya no está vigente');
      const suppliedHash = createHash('sha256').update(token).digest('hex');
      if (suppliedHash !== invitation.tokenHash) throw new BadRequestException('Invitación inválida');
      const client = await manager.getRepository(Client).findOneBy({ id: invitation.clientId });
      if (!client?.isActive) throw new ConflictException('La constructora no está activa');
      await manager.getRepository(ClientMembership).upsert({ clientId: invitation.clientId,
        personId, isActive: true, updatedAt: new Date() }, ['clientId', 'personId']);
      await manager.getRepository(ClientRole).upsert({ clientId: invitation.clientId,
        personId, roleCode: invitation.roleCode }, ['clientId', 'personId', 'roleCode']);
      invitation.acceptedAt = new Date();
      await manager.getRepository(ClientInvitation).save(invitation);
      return { clientId: invitation.clientId, roleCode: invitation.roleCode, accepted: true };
    });
  }
}

@UseGuards(IdentityGuard)
@Controller('auth/invitations')
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}
  @Get() pending(@Req() request: IdentityRequest) { return this.invitations.pending(request.identityPersonId); }
  @Post(':id/accept') accept(@Req() request: IdentityRequest, @Param('id') id: string,
    @Body() body: { token?: unknown }) {
    return this.invitations.accept(request.identityPersonId, id, body?.token);
  }
}
