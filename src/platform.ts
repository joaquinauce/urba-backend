import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Injectable, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { DB } from './database.module.js';
import { Administrator, Client, Person } from './database/entities.js';
import { JwtGuard, type AdminRequest } from './auth.js';
import { PlatformGuard } from './platform-access.js';
import { lockIdentityEmail } from './identity-lock.js';

function name(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 180)
    throw new BadRequestException('Nombre de cliente inválido');
  return value.trim();
}
function optionalText(value: unknown, max: number, label: string) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max)
    throw new BadRequestException(`${label} inválida`);
  return value.trim() || null;
}
function email(value: unknown) {
  if (typeof value !== 'string') throw new BadRequestException('Email inválido');
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new BadRequestException('Email inválido');
  return normalized;
}

@Injectable()
export class PlatformService {
  constructor(@Inject(DB) private readonly db: DataSource) {}

  async list() {
    const clients = await this.db.getRepository(Client).find({ order: { name: 'ASC' } });
    const owners = await this.db.getRepository(Administrator).find();
    return clients.map((client) => ({ id: client.id, name: client.name, contactPhone: client.contactPhone,
      address: client.address, isActive: client.isActive,
      legacyAdministratorId: client.legacyAdministratorId,
      primaryAdministratorEmail: owners.find((owner) => owner.id === client.legacyAdministratorId)?.email ?? null,
      createdAt: client.createdAt }));
  }

  async create(body: { name?: unknown; administratorName?: unknown; administratorEmail?: unknown; password?: unknown;
    contactPhone?: unknown; address?: unknown }) {
    const clientName = name(body?.name);
    const administratorName = name(body?.administratorName);
    const administratorEmail = email(body?.administratorEmail);
    const contactPhone = optionalText(body?.contactPhone, 40, 'Teléfono');
    const address = optionalText(body?.address, 300, 'Dirección');
    if (typeof body?.password !== 'string' || body.password.length < 12)
      throw new BadRequestException('La clave inicial debe tener al menos 12 caracteres');
    const passwordHash = await hash(body.password, 12);
    try {
      return await this.db.transaction(async (manager) => {
        await lockIdentityEmail(manager, administratorEmail);
        if (await manager.getRepository(Administrator).createQueryBuilder('admin')
          .where('LOWER(BTRIM(admin.email)) = :email', { email: administratorEmail }).getExists()
          || await manager.getRepository(Person).createQueryBuilder('person')
            .where('LOWER(BTRIM(person.email)) = :email', { email: administratorEmail }).getExists())
          throw new ConflictException('Ese email ya está registrado');
        const administratorId = randomUUID();
        await manager.getRepository(Administrator).insert({ id: administratorId, email: administratorEmail,
          fullName: administratorName, passwordHash });
        // The phase-2 trigger creates the legacy-backed client in this transaction.
        const client = await manager.getRepository(Client).findOneBy({ legacyAdministratorId: administratorId });
        if (!client) throw new ConflictException('Falta instalar la base multicliente');
        client.name = clientName;
        client.contactPhone = contactPhone;
        client.address = address;
        client.updatedAt = new Date();
        await manager.getRepository(Client).save(client);
        return { id: client.id, name: client.name, contactPhone, address, isActive: client.isActive,
          legacyAdministratorId: administratorId, primaryAdministratorEmail: administratorEmail };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Ese email ya está registrado');
      throw error;
    }
  }

  async update(id: string, body: { name?: unknown; isActive?: unknown; administratorEmail?: unknown;
    contactPhone?: unknown; address?: unknown }) {
    const nextEmail = body.administratorEmail === undefined ? undefined : email(body.administratorEmail);
    const contactPhone = body.contactPhone === undefined ? undefined : optionalText(body.contactPhone, 40, 'Teléfono');
    const address = body.address === undefined ? undefined : optionalText(body.address, 300, 'Dirección');
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') throw new BadRequestException('Estado inválido');
    try {
      return await this.db.transaction(async (manager) => {
        if (nextEmail) await lockIdentityEmail(manager, nextEmail);
        const repository = manager.getRepository(Client);
        const client = await repository.createQueryBuilder('client').setLock('pessimistic_write')
          .where('client.id = :id', { id }).getOne();
        if (!client) throw new NotFoundException('Cliente no encontrado');
        if (body.name !== undefined) client.name = name(body.name);
        if (contactPhone !== undefined) client.contactPhone = contactPhone;
        if (address !== undefined) client.address = address;
        if (body.isActive !== undefined) client.isActive = body.isActive as boolean;
        if (nextEmail) {
          if (!client.legacyAdministratorId) throw new BadRequestException('Este cliente no tiene administrador inicial');
          const owner = await manager.getRepository(Administrator).findOneBy({ id: client.legacyAdministratorId });
          if (!owner) throw new NotFoundException('Administrador inicial no encontrado');
          if (email(owner.email) !== nextEmail) {
            const person = await manager.getRepository(Person).findOneBy({ administratorSourceId: owner.id });
            if (await manager.getRepository(Administrator).createQueryBuilder('admin')
              .where('LOWER(BTRIM(admin.email)) = :email AND admin.id <> :id', { email: nextEmail, id: owner.id }).getExists()
              || await manager.getRepository(Person).createQueryBuilder('person')
                .where('LOWER(BTRIM(person.email)) = :email AND person.id <> :id',
                  { email: nextEmail, id: person?.id ?? '00000000-0000-0000-0000-000000000000' }).getExists())
              throw new ConflictException('Ese email ya está registrado');
            owner.email = nextEmail;
            owner.updatedAt = new Date();
            await manager.getRepository(Administrator).save(owner);
            if (person) {
              person.email = nextEmail;
              person.updatedAt = new Date();
              await manager.getRepository(Person).save(person);
            }
          }
        }
        client.updatedAt = new Date();
        await repository.save(client);
        return { id: client.id, name: client.name, contactPhone: client.contactPhone, address: client.address,
          isActive: client.isActive, legacyAdministratorId: client.legacyAdministratorId };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Ese email ya está registrado');
      throw error;
    }
  }
}

@UseGuards(JwtGuard, PlatformGuard)
@Controller('platform/clients')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}
  @Get() list(@Req() _request: AdminRequest) { return this.platform.list(); }
  @Post() create(@Body() body: any) { return this.platform.create(body); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: any) { return this.platform.update(id, body); }
}
