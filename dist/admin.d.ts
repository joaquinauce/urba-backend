import type { DataSource } from 'typeorm';
import type { AdminRequest } from './auth.js';
import { type Db } from './shared.js';
type Work = {
    id: string;
    administrator_id: string;
    foreman_id: string;
    name: string;
    description: string | null;
    location: string | null;
    start_date: string;
    estimated_end_date: string;
    status: string;
    time_zone: string;
    close_time: string;
};
type GoalInput = {
    date?: string;
    description?: string;
    expectedQuantity?: number;
    unit?: string;
    customUnit?: string;
    quantityStep?: number;
    quantityDecimals?: number;
    activityId?: string;
    recurrence?: {
        startsOn: string;
        endsOn: string;
        daysMask: number;
    };
};
export declare function normalizeAlias(value: unknown): string | null;
export declare class AdminService {
    private readonly db;
    constructor(db: DataSource);
    foremen(adminId: string): Promise<any>;
    saveForeman(adminId: string, body: any, id?: string): Promise<any>;
    works(adminId: string): Promise<any>;
    work(adminId: string, id: string, db?: Db): Promise<Work>;
    saveWork(adminId: string, body: any, id?: string): Promise<any>;
    private accessResult;
    rotateCode(adminId: string, id: string): Promise<{
        id: string;
        name: string;
        accessCode: string;
        url: string;
        qrDataUrl: string;
    }>;
    materialize(adminId: string, workId: string, date: string, db?: Db): Promise<void>;
    materializeAll(adminId: string, workId: string): Promise<void>;
    goals(adminId: string, workId: string, date: string): Promise<any>;
    recurrences(adminId: string, workId: string): Promise<any>;
    createGoal(adminId: string, workId: string, body: GoalInput): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        activityId: string;
        recurrence: boolean;
    }>;
    updateGoal(adminId: string, workId: string, goalId: string, body: any): Promise<any>;
    deactivateRecurrence(adminId: string, workId: string, id: string): Promise<any>;
    copyGoals(adminId: string, workId: string, date: string): Promise<{
        copied: any;
    }>;
    dashboard(adminId: string): Promise<any[]>;
    workDetail(adminId: string, workId: string): Promise<{
        today: string;
        todayTime: string;
        work: {
            id: string;
            name: string;
            description: string | null;
            location: string | null;
            startDate: string;
            estimatedEndDate: string;
            status: string;
            foremanId: string;
            timeZone: string;
            closeTime: string;
            accessAlias: string | null;
        };
        goals: any;
        reports: any;
        items: any;
        photos: any;
        corrections: any;
        progress: any;
        activities: any;
    }>;
}
export declare class AdminController {
    private readonly service;
    constructor(service: AdminService);
    foremen(req: AdminRequest): Promise<any>;
    createForeman(req: AdminRequest, body: any): Promise<any>;
    updateForeman(req: AdminRequest, id: string, body: any): Promise<any>;
    works(req: AdminRequest): Promise<any>;
    createWork(req: AdminRequest, body: any): Promise<any>;
    updateWork(req: AdminRequest, id: string, body: any): Promise<any>;
    rotateCode(req: AdminRequest, id: string): Promise<{
        id: string;
        name: string;
        accessCode: string;
        url: string;
        qrDataUrl: string;
    }>;
    detail(req: AdminRequest, id: string): Promise<{
        today: string;
        todayTime: string;
        work: {
            id: string;
            name: string;
            description: string | null;
            location: string | null;
            startDate: string;
            estimatedEndDate: string;
            status: string;
            foremanId: string;
            timeZone: string;
            closeTime: string;
            accessAlias: string | null;
        };
        goals: any;
        reports: any;
        items: any;
        photos: any;
        corrections: any;
        progress: any;
        activities: any;
    }>;
    goals(req: AdminRequest, id: string, date: string): Promise<any>;
    createGoal(req: AdminRequest, id: string, body: GoalInput): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        activityId: string;
        recurrence: boolean;
    }>;
    updateGoal(req: AdminRequest, id: string, goalId: string, body: any): Promise<any>;
    copy(req: AdminRequest, id: string, body: {
        date: string;
    }): Promise<{
        copied: any;
    }>;
    recurrences(req: AdminRequest, id: string): Promise<any>;
    deactivate(req: AdminRequest, id: string, recurrenceId: string): Promise<any>;
    dashboard(req: AdminRequest): Promise<any[]>;
}
export {};
