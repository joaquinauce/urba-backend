import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import { type AdminRequest } from './auth.js';
import { WorkAuthorizationService, type PersonRequest } from './people-auth.js';
export declare class ExpensesService {
    private readonly db;
    private readonly authorization;
    constructor(db: DataSource, authorization: WorkAuthorizationService);
    types(administratorId: string, activeOnly?: boolean): Promise<any>;
    saveType(administratorId: string, body: {
        name?: unknown;
        isActive?: unknown;
    }, id?: string): Promise<any>;
    setTypeActive(administratorId: string, id: string, active: unknown): Promise<any>;
    list(administratorId: string, filters: Record<string, string | undefined>): Promise<any>;
    recent(request: PersonRequest, workId: string): Promise<any>;
    create(request: PersonRequest, workId: string, body: {
        amount?: unknown;
        typeId?: unknown;
        requestId?: unknown;
    }, file?: Express.Multer.File): Promise<{
        id: any;
        repeated: boolean;
    } | {
        id: `${string}-${string}-${string}-${string}-${string}`;
        repeated?: undefined;
    }>;
    photo(administratorId: string, expenseId: string, personId?: string): Promise<NonSharedBuffer>;
}
export declare class AdminExpensesController {
    private readonly expenses;
    constructor(expenses: ExpensesService);
    types(req: AdminRequest): Promise<any>;
    createType(req: AdminRequest, body: {
        name?: unknown;
        isActive?: unknown;
    }): Promise<any>;
    editType(req: AdminRequest, id: string, body: {
        name?: unknown;
        isActive?: unknown;
    }): Promise<any>;
    active(req: AdminRequest, id: string, body: {
        isActive?: unknown;
    }): Promise<any>;
    list(req: AdminRequest, filters: Record<string, string | undefined>): Promise<any>;
    photo(req: AdminRequest, id: string, res: Response): Promise<void>;
}
export declare class MemberExpensesController {
    private readonly expenses;
    constructor(expenses: ExpensesService);
    types(req: PersonRequest): Promise<any>;
    recent(req: PersonRequest, workId: string): Promise<any>;
    create(req: PersonRequest, workId: string, body: {
        amount?: unknown;
        typeId?: unknown;
        requestId?: unknown;
    }, file: Express.Multer.File): Promise<{
        id: any;
        repeated: boolean;
    } | {
        id: `${string}-${string}-${string}-${string}-${string}`;
        repeated?: undefined;
    }>;
    photo(req: PersonRequest, id: string, res: Response): Promise<void>;
}
