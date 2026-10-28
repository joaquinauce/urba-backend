import { describe, expect, it } from 'vitest';
import { code, codeHash, localNow, nonnegative, percentage, reportSummary, validDate } from './shared.js';

describe('reglas críticas de informes', () => {
  it('acepta cero realizado, rechaza negativos y conserva sobrecumplimiento individual', () => {
    expect(nonnegative(0)).toBe(0);
    expect(() => nonnegative(-1)).toThrow();
    expect(percentage(15,10)).toBe(150);
  });
  it('limita cada objetivo al 100% antes del promedio general', () => {
    expect(reportSummary([{actual_quantity:15,expected_quantity_snapshot:10},{actual_quantity:0,expected_quantity_snapshot:10}])).toBe(50);
    expect(reportSummary([{actual_quantity:7,expected_quantity_snapshot:10},{actual_quantity:10,expected_quantity_snapshot:10}])).toBe(85);
    expect(reportSummary([])).toBeNull();
  });
  it('usa la fecha local de la zona horaria y valida fechas reales', () => {
    expect(localNow('America/Argentina/Buenos_Aires').date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(() => validDate('2026-02-30')).toThrow();
    expect(validDate('2026-10-27')).toBe('2026-10-27');
  });
  it('genera códigos opacos de alta entropía y hashes estables', () => {
    const a=code(), b=code();
    expect(a).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(codeHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(codeHash(a)).toBe(codeHash(a));
  });
});
