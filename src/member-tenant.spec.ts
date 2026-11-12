import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MemberService } from './member.js';
import { DailyReport, ReportPhoto } from './database/entities.js';

const request = { actor: { kind: 'person', id: 'person-a', clientId: 'client-a',
  administratorId: 'admin-a', fullName: 'Jefa', roles: ['SITE_MANAGER'] } } as any;

describe('informes y fotos de una persona', () => {
  it('rechaza un informe ajeno antes de consultar su detalle', async () => {
    const detail = vi.fn();
    const db = { getRepository: (entity: unknown) => entity === DailyReport
      ? { findOneBy: async () => null } : null } as any;
    const members = new MemberService(db, { authorize: vi.fn() } as any, {} as any, { detail } as any);
    await expect(members.reportDetail(request, 'report-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(detail).not.toHaveBeenCalled();
  });

  it('autoriza la obra del informe y de la foto antes de entregar recursos', async () => {
    const authorize = vi.fn().mockRejectedValue(new ForbiddenException('Otra constructora'));
    const detail = vi.fn();
    const photo = vi.fn();
    const db = { getRepository: (entity: unknown) => entity === DailyReport
      ? { findOneBy: async () => ({ id: 'report-a', workId: 'work-b' }) }
      : entity === ReportPhoto ? { findOneBy: async () => ({ id: 'photo-a', workId: 'work-b' }) } : null } as any;
    const members = new MemberService(db, { authorize } as any, {} as any, { detail, photo } as any);
    await expect(members.reportDetail(request, 'report-a')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(members.photo(request, 'photo-a')).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(detail).not.toHaveBeenCalled();
    expect(photo).not.toHaveBeenCalled();
  });
});
