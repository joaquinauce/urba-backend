import { type DataSource } from 'typeorm';
import type { AdminRequest } from './auth.js';
import { Work } from './database/entities.js';
import { type Db } from './shared.js';
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
    foremen(adminId: string): Promise<{
        id: string;
        firstName: string;
        lastName: string;
        phone: string;
        isActive: boolean;
    }[]>;
    saveForeman(adminId: string, body: any, id?: string): Promise<{
        id: string;
        firstName: string;
        lastName: string;
        phone: string;
        isActive: boolean;
    }>;
    works(adminId: string): Promise<any[]>;
    work(adminId: string, id: string, db?: Db): Promise<Work>;
    saveWork(adminId: string, body: any, id?: string): Promise<{
        id: string;
        name: string;
        accessCode: string;
        url: string;
        qrDataUrl: string;
    } | {
        id: string;
        name: string;
        status: string;
        accessAlias: string | null;
    }>;
    private accessResult;
    rotateCode(adminId: string, id: string): Promise<{
        id: string;
        name: string;
        accessCode: string;
        url: string;
        qrDataUrl: string;
    }>;
    private lockWork;
    materialize(adminId: string, workId: string, date: string, db?: Db): Promise<void>;
    materializeAll(adminId: string, workId: string): Promise<void>;
    private materializeAllMany;
    goals(adminId: string, workId: string, date: string): Promise<{
        id: string;
        activityId: string;
        recurrenceId: string | null;
        date: string;
        description: string;
        expectedQuantity: string;
        unit: string;
        customUnit: string | null;
        quantityStep: string | null;
        quantityDecimals: number | null;
        isActive: boolean;
    }[]>;
    recurrences(adminId: string, workId: string): Promise<{
        id: string;
        activityId: string;
        description: string;
        expectedQuantity: string;
        startsOn: string;
        endsOn: string;
        daysMask: number;
        isActive: boolean;
    }[]>;
    createGoal(adminId: string, workId: string, body: GoalInput): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        activityId: string;
        recurrence: boolean;
    }>;
    updateGoal(adminId: string, workId: string, goalId: string, body: any): Promise<{
        id: string;
        description: string;
        expectedQuantity: string;
        isActive: boolean;
    }>;
    deactivateRecurrence(adminId: string, workId: string, id: string): Promise<{
        id: string;
        isActive: boolean;
    }>;
    copyGoals(adminId: string, workId: string, date: string): Promise<{
        copied: number;
    }>;
    dashboard(adminId: string): Promise<any[]>;
    workDetail(adminId: string, workId: string, materializeRecurrences?: boolean): Promise<{
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
        goals: {
            id: string;
            activityId: string;
            date: string;
            description: string;
            expectedQuantity: string;
            unit: string;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
        reports: {
            id: string;
            date: string;
            foremanName: string;
            submittedByPersonId: string | null;
            submittedBy: {
                personId: string | null;
                name: string;
                accessType: string;
            };
            observations: string | null;
            submittedAt: Date;
            updatedAt: Date;
        }[];
        items: {
            reportId: string;
            activityId: string;
            goalId: string;
            description: string;
            expected: string;
            actual: string;
            unit: string;
            date: string;
        }[];
        photos: {
            id: string;
            reportId: string;
        }[];
        corrections: {
            id: string;
            reportId: string;
            before: unknown;
            after: unknown;
            reason: string | null;
            createdAt: Date;
        }[];
        progress: {
            activityId: any;
            name: any;
            unit: any;
            planned: number;
            executed: number;
            difference: number;
            compliance: number | null;
            projectedDays: number | null;
            risk: boolean;
        }[];
        activities: {
            id: string;
            name: string;
            unit: string;
            customUnit: string | null;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
    }>;
}
export declare class AdminController {
    private readonly service;
    constructor(service: AdminService);
    foremen(req: AdminRequest): Promise<{
        id: string;
        firstName: string;
        lastName: string;
        phone: string;
        isActive: boolean;
    }[]>;
    createForeman(req: AdminRequest, body: any): Promise<{
        id: string;
        firstName: string;
        lastName: string;
        phone: string;
        isActive: boolean;
    }>;
    updateForeman(req: AdminRequest, id: string, body: any): Promise<{
        id: string;
        firstName: string;
        lastName: string;
        phone: string;
        isActive: boolean;
    }>;
    works(req: AdminRequest): Promise<any[]>;
    createWork(req: AdminRequest, body: any): Promise<{
        id: string;
        name: string;
        accessCode: string;
        url: string;
        qrDataUrl: string;
    } | {
        id: string;
        name: string;
        status: string;
        accessAlias: string | null;
    }>;
    updateWork(req: AdminRequest, id: string, body: any): Promise<{
        id: string;
        name: string;
        accessCode: string;
        url: string;
        qrDataUrl: string;
    } | {
        id: string;
        name: string;
        status: string;
        accessAlias: string | null;
    }>;
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
        goals: {
            id: string;
            activityId: string;
            date: string;
            description: string;
            expectedQuantity: string;
            unit: string;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
        reports: {
            id: string;
            date: string;
            foremanName: string;
            submittedByPersonId: string | null;
            submittedBy: {
                personId: string | null;
                name: string;
                accessType: string;
            };
            observations: string | null;
            submittedAt: Date;
            updatedAt: Date;
        }[];
        items: {
            reportId: string;
            activityId: string;
            goalId: string;
            description: string;
            expected: string;
            actual: string;
            unit: string;
            date: string;
        }[];
        photos: {
            id: string;
            reportId: string;
        }[];
        corrections: {
            id: string;
            reportId: string;
            before: unknown;
            after: unknown;
            reason: string | null;
            createdAt: Date;
        }[];
        progress: {
            activityId: any;
            name: any;
            unit: any;
            planned: number;
            executed: number;
            difference: number;
            compliance: number | null;
            projectedDays: number | null;
            risk: boolean;
        }[];
        activities: {
            id: string;
            name: string;
            unit: string;
            customUnit: string | null;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
    }>;
    goals(req: AdminRequest, id: string, date: string): Promise<{
        id: string;
        activityId: string;
        recurrenceId: string | null;
        date: string;
        description: string;
        expectedQuantity: string;
        unit: string;
        customUnit: string | null;
        quantityStep: string | null;
        quantityDecimals: number | null;
        isActive: boolean;
    }[]>;
    createGoal(req: AdminRequest, id: string, body: GoalInput): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        activityId: string;
        recurrence: boolean;
    }>;
    updateGoal(req: AdminRequest, id: string, goalId: string, body: any): Promise<{
        id: string;
        description: string;
        expectedQuantity: string;
        isActive: boolean;
    }>;
    copy(req: AdminRequest, id: string, body: {
        date: string;
    }): Promise<{
        copied: number;
    }>;
    recurrences(req: AdminRequest, id: string): Promise<{
        id: string;
        activityId: string;
        description: string;
        expectedQuantity: string;
        startsOn: string;
        endsOn: string;
        daysMask: number;
        isActive: boolean;
    }[]>;
    deactivate(req: AdminRequest, id: string, recurrenceId: string): Promise<{
        id: string;
        isActive: boolean;
    }>;
    dashboard(req: AdminRequest): Promise<any[]>;
}
export {};
