import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
export const uuid = () => randomUUID();
export const code = () => randomBytes(24).toString('base64url');
export const codeHash = (value) => createHash('sha256').update(value).digest('hex');
export const units = ['UNIDADES', 'METROS', 'METROS_CUADRADOS', 'METROS_CUBICOS', 'KILOGRAMOS', 'HORAS', 'PORCENTAJE', 'OTRA'];
export const quantityDecimals = { UNIDADES: 0, METROS: 2, METROS_CUADRADOS: 2, METROS_CUBICOS: 3, KILOGRAMOS: 2, HORAS: 1, PORCENTAJE: 0, OTRA: 3 };
export function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ||
        new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
        throw new BadRequestException('Fecha inválida');
    }
    return value;
}
export function positive(value, field = 'cantidad') {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || Math.abs(Math.round(n * 1000) - n * 1000) > 1e-7)
        throw new BadRequestException(`${field} debe ser positivo, con hasta tres decimales`);
    return n;
}
export function nonnegative(value, field = 'cantidad') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || Math.abs(Math.round(n * 1000) - n * 1000) > 1e-7)
        throw new BadRequestException(`${field} no puede ser negativo y admite hasta tres decimales`);
    return n;
}
export function quantityForUnit(value, unit, field, mustBePositive = false) {
    const n = mustBePositive ? positive(value, field) : nonnegative(value, field);
    const decimals = quantityDecimals[unit];
    if (decimals === undefined)
        throw new BadRequestException('Unidad inválida');
    const factor = 10 ** decimals;
    if (Math.abs(Math.round(n * factor) - n * factor) > 1e-7 || (unit === 'HORAS' && Math.abs(Math.round(n * 2) - n * 2) > 1e-7)) {
        throw new BadRequestException(`${field} admite ${decimals} decimal(es) para esta unidad${unit === 'HORAS' ? ' y pasos de 0,5' : ''}`);
    }
    return n;
}
export function required(value, field, max = 200) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
        throw new BadRequestException(`${field} es obligatorio (máximo ${max} caracteres)`);
    return value.trim();
}
export function optional(value, max = 2000) {
    if (value == null || value === '')
        return null;
    if (typeof value !== 'string' || value.length > max)
        throw new BadRequestException(`Texto demasiado largo (máximo ${max} caracteres)`);
    return value.trim();
}
export function validUnit(unit, custom) {
    if (!units.includes(unit))
        throw new BadRequestException('Unidad inválida');
    return { unit: unit, customUnit: unit === 'OTRA' ? required(custom, 'Unidad personalizada', 60) : null };
}
export async function one(db, sql, params = []) {
    const rows = await db.query(sql, params);
    if (!rows.length)
        throw new NotFoundException('Recurso no encontrado');
    return rows[0];
}
export function localNow(timeZone, now = new Date()) {
    let parts;
    try {
        parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    }
    catch {
        throw new BadRequestException('Zona horaria inválida');
    }
    const value = (type) => parts.find(p => p.type === type)?.value ?? '';
    return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` };
}
export const number = (value) => Number(value ?? 0);
export const percentage = (actual, expected) => expected > 0 ? actual / expected * 100 : 0;
export function reportSummary(items) {
    return items.length ? Math.round(items.reduce((sum, item) => sum + Math.min(100, percentage(number(item.actual_quantity), number(item.expected_quantity_snapshot))), 0) / items.length) : null;
}
//# sourceMappingURL=shared.js.map