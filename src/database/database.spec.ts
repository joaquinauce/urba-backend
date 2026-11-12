import { readFile } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source.js';

const legacyTables = [
  'activities',
  'administrators',
  'daily_goals',
  'daily_report_items',
  'daily_reports',
  'foremen',
  'goal_recurrences',
  'report_corrections',
  'report_photos',
  'works',
];

const additiveTables = ['people', 'person_roles', 'roles', 'work_assignments'];
const multiclientTables = ['clients', 'client_memberships', 'client_roles', 'client_invitations'];

describe('metadatos de persistencia', () => {
  it('registra todas las entidades sin habilitar cambios automáticos de esquema', async () => {
    const options = dataSourceOptions();
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
    expect(options.migrations).toEqual([]);

    const source = new DataSource(options);
    await (
      source as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const tables = source.entityMetadatas
      .map((metadata) => metadata.tableName)
      .sort();

    expect(tables).toEqual([...legacyTables, ...additiveTables, ...multiclientTables].sort());
    expect(
      source.entityMetadatas.every((metadata) => metadata.relations.length > 0),
    ).toBe(true);
  });

  it('no conserva accesos SQL crudos en los módulos de ejecución', async () => {
    const modules = [
      'auth',
      'admin',
      'public',
      'reports',
      'health',
      'shared',
      'people-auth',
      'people-admin',
      'member',
    ];
    const sources = await Promise.all([
      ...modules.map((module) =>
        readFile(new URL(`../${module}.ts`, import.meta.url), 'utf8'),
      ),
      readFile(
        new URL('../../scripts/create-admin.mjs', import.meta.url),
        'utf8',
      ),
    ]);
    expect(sources.join('\n')).not.toMatch(/\.query\s*\(/);
    expect(sources.join('\n')).not.toMatch(/function\s+one\s*</);
  });

  it('mantiene columnas sensibles fuera de las selecciones ORM por defecto', async () => {
    const source = new DataSource(dataSourceOptions());
    await (
      source as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    const administrators = source.getMetadata('administrators');
    const works = source.getMetadata('works');
    const people = source.getMetadata('people');
    expect(
      administrators.findColumnWithPropertyName('passwordHash')?.isSelect,
    ).toBe(false);
    expect(works.findColumnWithPropertyName('aliasPinHash')?.isSelect).toBe(
      false,
    );
    expect(people.findColumnWithPropertyName('pinHash')?.isSelect).toBe(false);
    expect(people.findColumnWithPropertyName('pinLookupHmac')?.isSelect).toBe(
      false,
    );
    expect(people.findColumnWithPropertyName('pinHash')?.isNullable).toBe(true);
    expect(people.findColumnWithPropertyName('pinLookupHmac')?.isNullable).toBe(
      true,
    );
    expect(people.findColumnWithPropertyName('sessionVersion')?.default).toBe(
      0,
    );
    expect(people.findColumnWithPropertyName('failedAttempts')?.default).toBe(
      0,
    );
  });

  it('modela roles personales y relaciones muchos-a-muchos con las obras', async () => {
    const source = new DataSource(dataSourceOptions());
    await (
      source as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    const personRoles = source.getMetadata('person_roles');
    const assignments = source.getMetadata('work_assignments');
    expect(
      personRoles.primaryColumns.map((column) => column.databaseName).sort(),
    ).toEqual(['person_id', 'role_code']);
    expect(
      assignments.primaryColumns.map((column) => column.databaseName).sort(),
    ).toEqual(['id']);
    expect(
      assignments.indices.some(
        (index) =>
          index.name === 'work_assignments_active_uq' &&
          index.isUnique &&
          index.where === 'unassigned_at IS NULL',
      ),
    ).toBe(true);
    expect(
      assignments.relations.map((relation) => relation.propertyName).sort(),
    ).toEqual(['clientRole', 'person', 'personRole', 'work']);
  });

  it('modela la trazabilidad nullable del responsable de informes', async () => {
    const source = new DataSource(dataSourceOptions());
    await (
      source as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    const reports = source.getMetadata('daily_reports');
    const responsibleColumn = reports.findColumnWithPropertyName(
      'submittedByPersonId',
    );
    const responsibleRelation = reports.relations.find(
      (relation) => relation.propertyName === 'submittedByPerson',
    );
    expect(responsibleColumn?.databaseName).toBe('submitted_by_person_id');
    expect(responsibleColumn?.isNullable).toBe(true);
    expect(responsibleRelation?.inverseEntityMetadata.tableName).toBe('people');
    expect(
      responsibleRelation?.joinColumns
        .map((column) => column.databaseName)
        .sort(),
    ).toEqual(['submitted_by_person_id']);
    expect(
      reports.indices.some(
        (index) =>
          index.name === 'daily_reports_submitted_by_person_idx' &&
          index.where === 'submitted_by_person_id IS NOT NULL',
      ),
    ).toBe(true);
  });
});

describe('script SQL versionado', () => {
  it('es transaccional, aditivo y contiene controles de integridad', async () => {
    const script = await readFile(
      new URL(
        '../../sql/20261103_001_roles_y_asignaciones_multiples.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(script).toMatch(/^BEGIN;/m);
    expect(script).toMatch(/^COMMIT;/m);
    for (const table of additiveTables)
      expect(script).toContain(`CREATE TABLE ${table}`);
    expect(script).toContain(`('SITE_MANAGER', 'Jefe de obra')`);
    expect(script).toContain(
      `CHECK (code IN ('ADMINISTRATOR', 'SITE_MANAGER', 'FOREMAN'))`,
    );
    expect(script).toContain(
      `CONSTRAINT work_assignments_pkey PRIMARY KEY (id)`,
    );
    expect(script).toContain(`CREATE UNIQUE INDEX work_assignments_active_uq`);
    expect(script).toContain(
      `ON work_assignments (work_id, person_id, role_code)`,
    );
    expect(script).toContain(`md5('beurba:work-assignment:'`);
    expect(script).toContain(
      `CHECK (role_code IN ('SITE_MANAGER', 'FOREMAN'))`,
    );
    for (const column of [
      'pin_hash',
      'pin_lookup_hmac',
      'session_version',
      'failed_attempts',
      'locked_until',
      'last_access_at',
    ])
      expect(script).toContain(column);
    expect(script).toContain(`RAISE EXCEPTION`);
    expect(script).toContain(`FROM works w`);
    expect(script).toContain(`FROM administrators a`);
    expect(script).toContain(`FROM foremen f`);
    expect(script).not.toMatch(/^\s*(?:ALTER|TRUNCATE|DROP|DELETE)\b/im);
  });

  it('convierte de forma transaccional el borrador que llegó a ejecutarse', async () => {
    const script = await readFile(
      new URL(
        '../../sql/20261103_002_convertir_borrador_roles_al_esquema_final.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(script).toMatch(/^BEGIN;/m);
    expect(script).toMatch(/^COMMIT;/m);
    expect(script).toContain(
      `ALTER TABLE roles DROP CONSTRAINT roles_code_format`,
    );
    expect(script).toContain(`('SITE_MANAGER', 'Jefe de obra')`);
    expect(script).toContain(`FROM administrator_roles ar`);
    expect(script).toContain(`FROM foreman_roles fr`);
    expect(script).toContain(`FROM work_foreman_assignments old`);
    expect(script).toContain(`CREATE UNIQUE INDEX work_assignments_active_uq`);
    expect(script).toContain(`DROP TABLE work_foreman_assignments`);
    expect(script).toContain(`DROP TABLE foreman_roles`);
    expect(script).toContain(`DROP TABLE administrator_roles`);
    expect(script).toContain(`RAISE EXCEPTION`);
  });

  it('agrega trazabilidad de informes sin inferir identidades históricas', async () => {
    const script = await readFile(
      new URL(
        '../../sql/20261103_003_trazabilidad_responsable_informes.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(script).toMatch(/^BEGIN;/m);
    expect(script).toMatch(/^COMMIT;/m);
    expect(script).toContain(
      `ADD COLUMN submitted_by_person_id uuid NULL`,
    );
    expect(script).toContain(
      `FOREIGN KEY (administrator_id, submitted_by_person_id)`,
    );
    expect(script).toContain(`REFERENCES people(administrator_id, id)`);
    expect(script).toContain(`ON DELETE RESTRICT`);
    expect(script).toContain(`NOT VALID`);
    expect(script).toContain(
      `VALIDATE CONSTRAINT daily_reports_submitted_by_person_fk`,
    );
    expect(script).toContain(`daily_reports_submitted_by_person_idx`);
    expect(script).toContain(`se asignó identidad a informes históricos`);
    expect(script).toContain(`RAISE EXCEPTION`);
    expect(script).not.toMatch(/^\s*(?:UPDATE|DELETE|TRUNCATE)\b/im);
  });
});
