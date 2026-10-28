import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';

export type Db = DataSource | EntityManager;
export const uuid = () => randomUUID();
export const code = () => randomBytes(24).toString('base64url');
export const codeHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const units = ['UNIDADES', 'METROS', 'METROS_CUADRADOS', 'METROS_CUBICOS', 'KILOGRAMOS', 'HORAS', 'PORCENTAJE', 'OTRA'] as const;

export function validDate(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ||
      new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Fecha inválida');
  }
  return value;
}
export function positive(value: unknown, field = 'cantidad'): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || Math.abs(Math.round(n * 1000) - n * 1000) > 1e-7) throw new BadRequestException(`${field} debe ser positivo, con hasta tres decimales`);
  return n;
}
export function nonnegative(value: unknown, field = 'cantidad'): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || Math.abs(Math.round(n * 1000) - n * 1000) > 1e-7) throw new BadRequestException(`${field} no puede ser negativo y admite hasta tres decimales`);
  return n;
}
export function required(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException(`${field} es obligatorio (máximo ${max} caracteres)`);
  return value.trim();
}
export function optional(value: unknown, max = 2000): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new BadRequestException(`Texto demasiado largo (máximo ${max} caracteres)`);
  return value.trim();
}
export function validUnit(unit: unknown, custom: unknown): { unit: string; customUnit: string | null } {
  if (!units.includes(unit as typeof units[number])) throw new BadRequestException('Unidad inválida');
  return { unit: unit as string, customUnit: unit === 'OTRA' ? required(custom, 'Unidad personalizada', 60) : null };
}
export async function one<T = any>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await db.query(sql, params) as T[];
  if (!rows.length) throw new NotFoundException('Recurso no encontrado');
  return rows[0];
}
export function localNow(timeZone: string): { date: string; time: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  } catch { throw new BadRequestException('Zona horaria inválida'); }
  const value = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` };
}
export const number = (value: unknown) => Number(value ?? 0);
export const percentage = (actual: number, expected: number) => expected > 0 ? actual / expected * 100 : 0;
export function reportSummary(items: { actual_quantity: unknown; expected_quantity_snapshot: unknown }[]) {
  return items.length ? Math.round(items.reduce((sum, item) => sum + Math.min(100, percentage(number(item.actual_quantity), number(item.expected_quantity_snapshot))), 0) / items.length) : null;
}
