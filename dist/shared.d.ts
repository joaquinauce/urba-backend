import type { DataSource, EntityManager } from 'typeorm';
export type Db = DataSource | EntityManager;
export declare const uuid: () => `${string}-${string}-${string}-${string}-${string}`;
export declare const code: () => string;
export declare const codeHash: (value: string) => string;
export declare const units: readonly ["UNIDADES", "METROS", "METROS_CUADRADOS", "METROS_CUBICOS", "KILOGRAMOS", "HORAS", "PORCENTAJE", "OTRA"];
export declare function validDate(value: string): string;
export declare function positive(value: unknown, field?: string): number;
export declare function nonnegative(value: unknown, field?: string): number;
export declare function required(value: unknown, field: string, max?: number): string;
export declare function optional(value: unknown, max?: number): string | null;
export declare function validUnit(unit: unknown, custom: unknown): {
    unit: string;
    customUnit: string | null;
};
export declare function one<T = any>(db: Db, sql: string, params?: unknown[]): Promise<T>;
export declare function localNow(timeZone: string): {
    date: string;
    time: string;
};
export declare const number: (value: unknown) => number;
export declare const percentage: (actual: number, expected: number) => number;
export declare function reportSummary(items: {
    actual_quantity: unknown;
    expected_quantity_snapshot: unknown;
}[]): number | null;
