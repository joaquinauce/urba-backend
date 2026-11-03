import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import { Work } from './database/entities.js';
import type { AdminRequest } from './auth.js';
import { AdminService } from './admin.js';
import { type Db } from './shared.js';
type Submission = {
    observations?: string;
    items: {
        goalId: string;
        actualQuantity: number;
    }[];
};
export declare class ReportsService {
    private readonly db;
    private readonly admin;
    constructor(db: DataSource, admin: AdminService);
    private editable;
    submit(work: Work, body: Submission, submittedByPersonId?: string): Promise<{
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
    detail(id: string, adminId: string, db?: Db): Promise<{
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
    list(adminId: string, workId: string): Promise<{
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
    correct(adminId: string, reportId: string, body: {
        observations?: string;
        items?: {
            id: string;
            actualQuantity: number;
        }[];
        reason?: string;
    }): Promise<{
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
    uploadPhoto(adminId: string, reportId: string, file: Express.Multer.File, publicWork?: Work): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        width: number;
        height: number;
        mimeType: string;
    }>;
    photo(adminId: string, photoId: string, workId?: string): Promise<Buffer>;
}
export declare class ReportsController {
    private readonly reports;
    constructor(reports: ReportsService);
    list(req: AdminRequest, id: string): Promise<{
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
    detail(req: AdminRequest, id: string): Promise<{
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
    correct(req: AdminRequest, id: string, body: any): Promise<{
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
    upload(req: AdminRequest, id: string, file: Express.Multer.File): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        width: number;
        height: number;
        mimeType: string;
    }>;
    photo(req: AdminRequest, id: string, res: Response): Promise<void>;
}
export {};
