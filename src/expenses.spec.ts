import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ExpensesService } from './expenses.js';

const actor = { kind: 'person' as const, id: '11111111-1111-4111-8111-111111111111', administratorId: '22222222-2222-4222-8222-222222222222', fullName: 'Capataz', roles: ['FOREMAN' as const] };
const workId = '33333333-3333-4333-8333-333333333333';
const typeId = '44444444-4444-4444-8444-444444444444';
const requestId = '55555555-5555-4555-8555-555555555555';
const request = { actor } as never;
const file = { buffer: Buffer.from('foto'), size: 4 } as Express.Multer.File;

describe('rendiciones', () => {
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
});
