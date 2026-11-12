import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('script manual de responsables compartidos', () => {
  it('preserva datos históricos y exige pertenencia al cliente de cada obra', async () => {
    const sql = await readFile(new URL('../sql/20261112_005_responsables_compartidos_informes_gastos.sql', import.meta.url), 'utf8');
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
    expect(sql).toContain('beurba_phase6_baseline');
    expect(sql).toContain('FOREIGN KEY (submitted_by_person_id) REFERENCES people(id)');
    expect(sql).toContain('FOREIGN KEY (person_id) REFERENCES people(id)');
    expect(sql).toContain('client_id=target_client AND person_id=NEW.submitted_by_person_id AND is_active');
    expect(sql).toContain('client_id=target_client AND person_id=NEW.person_id AND is_active');
    expect(sql).not.toMatch(/\b(INSERT INTO|DELETE FROM|TRUNCATE)\s+(people|works|work_assignments|daily_reports|report_photos|expense_reports)\b/i);
  });
});
