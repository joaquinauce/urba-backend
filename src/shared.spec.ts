import { describe, expect, it } from 'vitest';
import { code, codeHash, customQuantityConfig, localNow, nonnegative, percentage, quantityForUnit, reportSummary, validDate } from './shared.js';
import { normalizeAlias } from './admin.js';

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
  it('separa el día argentino del día de una obra en Kiritimati', () => {
    const instant = new Date('2026-10-28T12:00:00Z');
    expect(localNow('America/Argentina/Cordoba',instant)).toEqual({date:'2026-10-28',time:'09:00'});
    expect(localNow('Pacific/Kiritimati',instant)).toEqual({date:'2026-10-29',time:'02:00'});
  });
  it('valida la precisión según la unidad sin redondear', () => {
    expect(quantityForUnit(4,'UNIDADES','Cantidad')).toBe(4);
    expect(() => quantityForUnit(4.001,'UNIDADES','Cantidad')).toThrow();
    expect(quantityForUnit(125.50,'METROS','Cantidad')).toBe(125.5);
    expect(() => quantityForUnit(125.501,'METROS','Cantidad')).toThrow();
    expect(quantityForUnit(2.375,'METROS_CUBICOS','Cantidad')).toBe(2.375);
    expect(quantityForUnit(1.5,'HORAS','Cantidad')).toBe(1.5);
    expect(() => quantityForUnit(1.25,'HORAS','Cantidad')).toThrow();
  });
  it('genera códigos opacos de alta entropía y hashes estables', () => {
    const a=code(), b=code();
    expect(a).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(codeHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(codeHash(a)).toBe(codeHash(a));
  });
  it('normaliza alias y valida cantidades personalizadas sin redondear', () => {
    expect(normalizeAlias('  iluminación-ciudad  ')).toBe('ILUMINACION-CIUDAD');
    expect(() => normalizeAlias('alias inválido')).toThrow();
    const config=customQuantityConfig('OTRA',0.25,2);
    expect(quantityForUnit(2.5,'OTRA','Cantidad',false,config)).toBe(2.5);
    expect(() => quantityForUnit(2.3,'OTRA','Cantidad',false,config)).toThrow();
    expect(() => customQuantityConfig('OTRA',0.025,2)).toThrow();
  });
});
