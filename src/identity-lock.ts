import type { EntityManager } from 'typeorm';

// Serialize identity creation across both legacy administrators and people.
export async function lockIdentityEmail(manager: EntityManager, email: string) {
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);
}
