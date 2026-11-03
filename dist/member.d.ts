import type { Response } from 'express';
import { type DataSource } from 'typeorm';
import { AdminService } from './admin.js';
import { WorkAuthorizationService, type PersonRequest } from './people-auth.js';
import { ReportsService } from './reports.js';
export declare class MemberService {
    private readonly db;
    private readonly authorization;
    private readonly admin;
    private readonly reports;
    constructor(db: DataSource, authorization: WorkAuthorizationService, admin: AdminService, reports: ReportsService);
    works(request: PersonRequest): Promise<{
        id: string;
        name: string;
        description: string | null;
        location: string | null;
        status: string;
        startDate: string;
        estimatedEndDate: string;
        foremanName: string;
        roles: string[];
    }[]>;
    detail(request: PersonRequest, workId: string): Promise<{
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
    reportList(request: PersonRequest, workId: string): Promise<{
        id: string;
        date: string;
        foremanName: string;
        submittedByPersonId: string | null;
        submittedBy: {
            personId: string | null;
            name: string;
            accessType: string;
        };
        submittedAt: Date;
        updatedAt: Date;
    }[]>;
    reportDetail(request: PersonRequest, reportId: string): Promise<{
        id: string;
        workId: string;
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
        workName: string;
        items: {
            id: string;
            goalId: string;
            activityId: string;
            description: string;
            expected: string;
            actual: string;
            unit: string;
            customUnit: string | null;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
        photos: {
            id: string;
            mimeType: string;
            width: number;
            height: number;
        }[];
        compliance: number | null;
    }>;
    submit(request: PersonRequest, workId: string, body: any): Promise<{
        id: string;
        workId: string;
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
        workName: string;
        items: {
            id: string;
            goalId: string;
            activityId: string;
            description: string;
            expected: string;
            actual: string;
            unit: string;
            customUnit: string | null;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
        photos: {
            id: string;
            mimeType: string;
            width: number;
            height: number;
        }[];
        compliance: number | null;
    }>;
    upload(request: PersonRequest, workId: string, reportId: string, file: Express.Multer.File): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        width: number;
        height: number;
        mimeType: string;
    }>;
    photo(request: PersonRequest, photoId: string): Promise<Buffer<ArrayBufferLike>>;
}
export declare class MemberController {
    private readonly members;
    constructor(members: MemberService);
    works(request: PersonRequest): Promise<{
        id: string;
        name: string;
        description: string | null;
        location: string | null;
        status: string;
        startDate: string;
        estimatedEndDate: string;
        foremanName: string;
        roles: string[];
    }[]>;
    detail(request: PersonRequest, workId: string): Promise<{
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
    reports(request: PersonRequest, workId: string): Promise<{
        id: string;
        date: string;
        foremanName: string;
        submittedByPersonId: string | null;
        submittedBy: {
            personId: string | null;
            name: string;
            accessType: string;
        };
        submittedAt: Date;
        updatedAt: Date;
    }[]>;
    report(request: PersonRequest, reportId: string): Promise<{
        id: string;
        workId: string;
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
        workName: string;
        items: {
            id: string;
            goalId: string;
            activityId: string;
            description: string;
            expected: string;
            actual: string;
            unit: string;
            customUnit: string | null;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
        photos: {
            id: string;
            mimeType: string;
            width: number;
            height: number;
        }[];
        compliance: number | null;
    }>;
    submit(request: PersonRequest, workId: string, body: any): Promise<{
        id: string;
        workId: string;
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
        workName: string;
        items: {
            id: string;
            goalId: string;
            activityId: string;
            description: string;
            expected: string;
            actual: string;
            unit: string;
            customUnit: string | null;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
        photos: {
            id: string;
            mimeType: string;
            width: number;
            height: number;
        }[];
        compliance: number | null;
    }>;
    upload(request: PersonRequest, workId: string, reportId: string, file: Express.Multer.File): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        width: number;
        height: number;
        mimeType: string;
    }>;
    photo(request: PersonRequest, photoId: string, response: Response): Promise<void>;
}
