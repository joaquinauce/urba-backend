import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ExpensesService } from './expenses.js';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const actor = { kind: 'person' as const, id: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222', administratorId: '22222222-2222-4222-8222-222222222222', fullName: 'Capataz', roles: ['FOREMAN' as const] };
const workId = '33333333-3333-4333-8333-333333333333';
const typeId = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const request = { actor } as never;
const file = { buffer: Buffer.from('foto'), size: 4 } as Express.Multer.File;

describe('rendiciones', () => {
  it('autoriza la obra antes de entregar un comprobante personal', async () => {
    const expenseId = '77777777-7777-4777-8777-777777777777';
    const query = vi.fn(async (_sql: string, params: unknown[]) => {
      expect(params).toEqual([expenseId, actor.id, actor.administratorId, actor.clientId]);
      return [{ workId }];
    });
    const authorize = vi.fn().mockRejectedValue(new ForbiddenException('Sin asignación'));
    const service = new ExpensesService({ query } as never, { authorize } as never);
    const photo = vi.spyOn(service, 'photo');
    await expect(service.memberPhoto(request, expenseId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorize).toHaveBeenCalledWith(actor, workId);
    expect(photo).not.toHaveBeenCalled();
  });
  it('rechaza monto no positivo y fotografía faltante antes de tocar la base', async () => {
    const query = vi.fn(); const authorize = vi.fn();
    const service = new ExpensesService({ query } as never, { authorize } as never);
    await expect(service.create(request, workId, { amount: '0', typeId, requestId }, file)).rejects.toThrow('monto positivo');
    await expect(service.create(request, workId, { amount: '100', typeId, requestId })).rejects.toThrow('fotografía');
    expect(query).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled();
  });

  it('exige asignación activa antes de registrar o mostrar rendiciones', async () => {
    const query = vi.fn(); const authorize = vi.fn().mockRejectedValue(new ForbiddenException('Sin asignación'));
    const service = new ExpensesService({ query } as never, { authorize } as never);
    await expect(service.create(request, workId, { amount: '100', typeId, requestId }, file)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.recent(request, workId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('atribuye el gasto con alias al capataz responsable de la obra', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'urba-expense-'));
    const previous = process.env.PHOTO_STORAGE_DIR;
    process.env.PHOTO_STORAGE_DIR = dir;
    const foremanId = '66666666-6666-4666-8666-666666666666';
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT id FROM expense_reports')) return [];
      if (sql.startsWith('SELECT name FROM expense_types')) return [{ name: 'Comida' }];
      if (sql.startsWith('INSERT INTO expense_reports')) {
        expect(params[3]).toBeNull();
        expect(params[4]).toBe(foremanId);
        expect(params[13]).toBe('Capataz responsable');
        return [{ id: params[0] }];
      }
      throw new Error('Consulta inesperada');
    });
    try {
      const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
      const service = new ExpensesService({ query } as never, { authorize: vi.fn() } as never);
      const result = await service.createLegacy({ id: workId, administratorId: actor.administratorId, foremanId, foremanName: 'Capataz responsable', status: 'ACTIVA', timeZone: 'America/Argentina/Cordoba' } as never, { amount: '100', typeId, requestId }, { buffer: image, size: image.length } as Express.Multer.File);
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      if (previous === undefined) delete process.env.PHOTO_STORAGE_DIR;
      else process.env.PHOTO_STORAGE_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
