import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalSecurityService } from './personal-security.js';

type Row = { attempts: number; window_until: Date; blocked_until: Date | null; penalty_level: number };

function memoryDb() {
  const rows = new Map<string, Row>();
  let tail = Promise.resolve();
  const query = async (sql: string, values: unknown[]) => {
    const key = values[0] as string;
    if (sql.includes('INSERT INTO personal_login_limits')) {
      if (!rows.has(key)) rows.set(key, { attempts: 0, window_until: new Date(Date.now() + 900_000), blocked_until: null, penalty_level: 0 });
      return [];
    }
    if (sql.includes('SELECT attempts')) return [{ ...rows.get(key)! }];
    if (sql.includes('UPDATE personal_login_limits')) {
      rows.set(key, { attempts: values[1] as number, window_until: values[2] as Date,
        blocked_until: values[3] as Date | null, penalty_level: values[4] as number });
      return [];
    }
    return [];
  };
  return { rows, transaction: <T>(run: (manager: { query: typeof query }) => Promise<T>) => {
    const task = tail.then(() => run({ query }));
    tail = task.then(() => undefined, () => undefined);
    return task;
  } };
}

describe('límites persistentes de ingreso personal', () => {
  beforeEach(() => { process.env.PERSON_CODE_HMAC_SECRET = 'unit-test-person-code-secret-with-32-characters'; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete process.env.PERSON_CODE_HMAC_SECRET; });

  it('admite cinco solicitudes simultáneas y bloquea la sexta del mismo código', async () => {
    const db = memoryDb();
    const service = new PersonalSecurityService(db as any);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => service.reserve('012345', `ip-${i}`)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect([...db.rows.values()].some((row) => row.attempts === 5 && row.blocked_until)).toBe(true);
  });

  it('frena cambios de código desde una IP y ataques distribuidos por el límite global', async () => {
    const service = new PersonalSecurityService(memoryDb() as any);
    for (let i = 0; i < 30; i++) await service.reserve(String(i).padStart(6, '0'), 'one-ip');
    await expect(service.reserve('999999', 'one-ip')).rejects.toMatchObject({ status: 429 });
    for (let i = 30; i < 299; i++) await service.reserve(String(i).padStart(6, '0'), `ip-${i}`);
    await expect(service.reserve('888888', 'another-ip')).rejects.toMatchObject({ status: 429 });
  });

  it('recupera el acceso después de quince minutos y aumenta la sanción al reincidir', async () => {
    const db = memoryDb();
    const service = new PersonalSecurityService(db as any);
    for (let i = 0; i < 5; i++) await service.reserve('012345', `ip-${i}`);
    await expect(service.reserve('012345', 'later')).rejects.toMatchObject({ status: 429 });
    vi.advanceTimersByTime(15 * 60_000 + 1);
    for (let i = 0; i < 5; i++) await service.reserve('012345', `next-${i}`);
    const codeRow = [...db.rows.values()].find((row) => row.penalty_level === 2);
    expect(codeRow?.blocked_until?.getTime()).toBe(Date.now() + 30 * 60_000);
  });
});
