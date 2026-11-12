import { readFile } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source.js';

describe('base multicliente sin migraciones automáticas', () => {
  it('modela identidad global, pertenencia, rol y obra por cliente', async () => {
    const source = new DataSource(dataSourceOptions());
    await (source as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    expect(source.options.synchronize).toBe(false);
    expect(source.options.migrationsRun).toBe(false);

    const person = source.getMetadata('people');
    const membership = source.getMetadata('client_memberships');
    const role = source.getMetadata('client_roles');
    const work = source.getMetadata('works');
    const assignment = source.getMetadata('work_assignments');

    expect(person.findColumnWithPropertyName('id')?.isPrimary).toBe(true);
    expect(person.findColumnWithPropertyName('administratorId')).toBeDefined();
    expect(person.relations.some((relation) => relation.propertyName === 'clientMemberships')).toBe(true);
    expect(membership.primaryColumns.map((column) => column.databaseName).sort()).toEqual(['client_id', 'person_id']);
    expect(role.primaryColumns.map((column) => column.databaseName).sort()).toEqual(['client_id', 'person_id', 'role_code']);
    expect(work.findColumnWithPropertyName('clientId')?.databaseName).toBe('client_id');
    expect(assignment.findColumnWithPropertyName('clientId')?.databaseName).toBe('client_id');
    expect(assignment.relations.some((relation) => relation.propertyName === 'clientRole')).toBe(true);
  });

  it('versiona una ampliación transaccional y sus controles de solo lectura', async () => {
    const [before, migration, after] = await Promise.all([
      readFile(new URL('../../sql/20261112_000_verificacion_previa_multicliente.sql', import.meta.url), 'utf8'),
      readFile(new URL('../../sql/20261112_001_base_multicliente.sql', import.meta.url), 'utf8'),
      readFile(new URL('../../sql/20261112_002_verificacion_posterior_multicliente.sql', import.meta.url), 'utf8'),
    ]);
    expect(migration).toMatch(/^BEGIN;/m);
    expect(migration).toMatch(/^COMMIT;/m);
    for (const table of ['clients', 'client_memberships', 'client_roles'])
      expect(migration).toContain(`CREATE TABLE ${table}`);
    expect(migration).toContain('CREATE UNIQUE INDEX people_email_normalized_uq');
    expect(migration).toContain('lower(btrim(email))');
    expect(migration).toContain('work_assignments_client_role_fk');
    expect(migration).toContain('work_assignments_client_work_fk');
    expect(migration).toContain('works_legacy_client_owner_fk');
    expect(migration).toContain('beurba_multiclient_baseline');
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(before).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
    expect(after).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
  });

  it('prepara la revocación sin borrar asignaciones históricas', async () => {
    const script = await readFile(new URL('../../sql/20261112_003_revocacion_roles_multicliente.sql', import.meta.url), 'utf8');
    expect(script).toMatch(/^BEGIN;/m);
    expect(script).toMatch(/^COMMIT;/m);
    expect(script).toContain('work_assignments_client_membership_fk');
    expect(script).toContain('client_memberships_close_assignments');
    expect(script).toContain('client_roles_close_assignments');
    expect(script).toContain('beurba_role_revocation_baseline');
    expect(script).not.toMatch(/\bDELETE\s+FROM\s+(work_assignments|daily_reports|report_photos|expense_reports)\b/i);
  });
});
