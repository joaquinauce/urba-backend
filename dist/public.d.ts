import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { Work } from './database/entities.js';
import { AdminService } from './admin.js';
import { ReportsService } from './reports.js';
export type PublicWork = Work & {
    foremanName: string;
};
export declare class PublicService {
    private readonly db;
    private readonly admin;
    private readonly reports;
    private readonly jwt;
    private attempts;
    private aliasAttempts;
    constructor(db: DataSource, admin: AdminService, reports: ReportsService, jwt: JwtService);
    aliases(ip: string): Promise<{
        alias: string;
    }[]>;
    aliasLogin(aliasInput: unknown, pin: unknown, ip: string): Promise<{
        accessToken: string;
    }>;
    session(req: Request): Promise<PublicWork>;
    private limit;
    resolve(code: string, ip: string): Promise<PublicWork>;
    today(code: string, ip: string): Promise<{
        work: {
            id: string;
            name: string;
            foremanName: string;
        };
        date: string;
        goals: {
            id: string;
            description: string;
            expectedQuantity: string;
            unit: string;
            customUnit: string | null;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
        report: {
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
        } | null;
        editable: boolean;
        closeTime: string;
    }>;
    todayFor(work: PublicWork): Promise<{
        work: {
            id: string;
            name: string;
            foremanName: string;
        };
        date: string;
        goals: {
            id: string;
            description: string;
            expectedQuantity: string;
            unit: string;
            customUnit: string | null;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
        report: {
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
        } | null;
        editable: boolean;
        closeTime: string;
    }>;
    submit(code: string, ip: string, body: any): Promise<{
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
    upload(code: string, ip: string, reportId: string, file: Express.Multer.File): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        width: number;
        height: number;
        mimeType: string;
    }>;
    photo(code: string, ip: string, photoId: string): Promise<Buffer<ArrayBufferLike>>;
}
export declare class AliasController {
    private readonly service;
    private readonly reports;
    constructor(service: PublicService, reports: ReportsService);
    aliases(req: Request): Promise<{
        alias: string;
    }[]>;
    login(body: {
        alias: unknown;
        pin: unknown;
    }, req: Request): Promise<{
        accessToken: string;
    }>;
    today(req: Request): Promise<{
        work: {
            id: string;
            name: string;
            foremanName: string;
        };
        date: string;
        goals: {
            id: string;
            description: string;
            expectedQuantity: string;
            unit: string;
            customUnit: string | null;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
        report: {
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
        } | null;
        editable: boolean;
        closeTime: string;
    }>;
    submit(req: Request, body: any): Promise<{
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
    upload(req: Request, id: string, file: Express.Multer.File): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        width: number;
        height: number;
        mimeType: string;
    }>;
    photo(req: Request, id: string, res: Response): Promise<void>;
}
export declare class PublicController {
    private readonly service;
    constructor(service: PublicService);
    today(code: string, req: Request): Promise<{
        work: {
            id: string;
            name: string;
            foremanName: string;
        };
        date: string;
        goals: {
            id: string;
            description: string;
            expectedQuantity: string;
            unit: string;
            customUnit: string | null;
            quantityStep: string | null;
            quantityDecimals: number | null;
        }[];
        report: {
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
        } | null;
        editable: boolean;
        closeTime: string;
    }>;
    submit(code: string, req: Request, body: any): Promise<{
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
    upload(code: string, req: Request, id: string, file: Express.Multer.File): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        width: number;
        height: number;
        mimeType: string;
    }>;
    photo(code: string, req: Request, id: string, res: Response): Promise<void>;
}
