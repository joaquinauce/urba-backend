import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Inject } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { DB } from './database.module.js';

export type PersonalAccessResult = 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGIN_BLOCKED' | 'PIN_ROTATED' | 'UNLOCKED';
export async function recordPersonalEvent(manager: DataSource | EntityManager, result: PersonalAccessResult,
  ip: string | null, personId: string | null, administratorId: string | null, actorPersonId: string | null) {
  await manager.query(
    `INSERT INTO personal_access_events (result, ip_address, person_id, administrator_id, actor_person_id)
     VALUES ($1, $2, $3, $4, $5)`, [result, ip, personId, administratorId, actorPersonId],
  );
}
const WINDOW_MS = 15 * 60_000;
const LIMITS = { code: 5, ip: 30, global: 300 } as const;

function bucketKey(kind: keyof typeof LIMITS, value: string) {
  const secret = process.env.PERSON_CODE_HMAC_SECRET;
  if (!secret || secret.length < 32) throw new Error('PERSON_CODE_HMAC_SECRET debe tener al menos 32 caracteres');
  return createHmac('sha256', secret).update(`login:${kind}:${value}`).digest('hex');
}
export function codeBucketFromLookup(lookup: string) {
  return bucketKey('code', lookup);
}
export async function clearCodeLookupForManager(manager: DataSource | EntityManager, lookup: string) {
  await manager.query('DELETE FROM personal_login_limits WHERE bucket_key = $1', [codeBucketFromLookup(lookup)]);
}
function lookupHmac(code: string) {
  const secret = process.env.PERSON_CODE_HMAC_SECRET!;
  return createHmac('sha256', secret).update(code).digest('hex');
}

@Injectable()
export class PersonalSecurityService {
  private readonly logger = new Logger(PersonalSecurityService.name);
  private reservations = 0;
  constructor(@Inject(DB) private readonly db: DataSource) {}

  async reserve(code: string, ip: string) {
    const keys = [
      { kind: 'code' as const, key: codeBucketFromLookup(lookupHmac(code)) },
      { kind: 'ip' as const, key: bucketKey('ip', ip) },
      { kind: 'global' as const, key: bucketKey('global', 'all') },
    ].sort((a, b) => a.key.localeCompare(b.key));
    const blocked = await this.db.transaction(async (manager) => {
      let denied = false;
      for (const { kind, key } of keys) {
        // INSERT ... ON CONFLICT and the following row lock serialize attempts across workers.
        await manager.query(
          `INSERT INTO personal_login_limits (bucket_key, window_until)
           VALUES ($1, now() + interval '15 minutes') ON CONFLICT (bucket_key) DO NOTHING`, [key],
        );
        const [row] = await manager.query(
          `SELECT attempts, window_until, blocked_until, penalty_level
           FROM personal_login_limits WHERE bucket_key = $1 FOR UPDATE`, [key],
        ) as { attempts: number; window_until: Date; blocked_until: Date | null; penalty_level: number }[];
        const now = Date.now();
        if (row.blocked_until && new Date(row.blocked_until).getTime() > now) {
          denied = true;
          continue;
        }
        const attempts = new Date(row.window_until).getTime() > now ? row.attempts + 1 : 1;
        const penalty = attempts >= LIMITS[kind] ? Math.min(row.penalty_level + 1, 6) : row.penalty_level;
        const blockedUntil = attempts >= LIMITS[kind]
          ? new Date(now + WINDOW_MS * 2 ** (penalty - 1)) : null;
        await manager.query(
          `UPDATE personal_login_limits SET attempts = $2, window_until = $3,
           blocked_until = $4, penalty_level = $5, updated_at = now() WHERE bucket_key = $1`,
          [key, attempts, new Date(now + WINDOW_MS), blockedUntil, penalty],
        );
        // The threshold attempt is checked as a credential attempt; following requests wait.
      }
      return denied;
    });
    if (++this.reservations % 500 === 0) {
      try {
        await this.db.query(`DELETE FROM personal_login_limits WHERE updated_at < now() - interval '7 days'
          AND (blocked_until IS NULL OR blocked_until < now())`);
      } catch (error) {
        this.logger.warn('No se pudieron limpiar límites de acceso vencidos', error);
      }
    }
    if (blocked) throw new HttpException('Demasiados intentos. Volvé a intentar más tarde.', HttpStatus.TOO_MANY_REQUESTS);
  }

  async clearCode(code: string) {
    await this.clearCodeLookup(lookupHmac(code));
  }

  async clearCodeLookup(lookup: string) {
    await clearCodeLookupForManager(this.db, lookup);
  }

  async event(result: PersonalAccessResult, ip: string | null, personId: string | null = null,
    administratorId: string | null = null, actorPersonId: string | null = null,
    manager: DataSource | EntityManager = this.db) {
    await recordPersonalEvent(manager, result, ip, personId, administratorId, actorPersonId);
    this.logger.log(JSON.stringify({ event: 'personal_access', result, ip, personId, administratorId, actorPersonId }));
  }
}
