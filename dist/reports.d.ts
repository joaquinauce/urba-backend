import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import type { AdminRequest } from './auth.js';
import { AdminService } from './admin.js';
import { type Db } from './shared.js';
type Work = {
    id: string;
    administrator_id: string;
    foreman_id: string;
    time_zone: string;
    close_time: string;
    status: string;
};
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
    submit(work: Work, body: Submission): Promise<any>;
    detail(id: string, adminId: string, db?: Db): Promise<any>;
    list(adminId: string, workId: string): Promise<any>;
    correct(adminId: string, reportId: string, body: {
        observations?: string;
        items?: {
            id: string;
            actualQuantity: number;
        }[];
        reason?: string;
    }): Promise<any>;
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
    list(req: AdminRequest, id: string): Promise<any>;
    detail(req: AdminRequest, id: string): Promise<any>;
    correct(req: AdminRequest, id: string, body: any): Promise<any>;
    upload(req: AdminRequest, id: string, file: Express.Multer.File): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        width: number;
        height: number;
        mimeType: string;
    }>;
    photo(req: AdminRequest, id: string, res: Response): Promise<void>;
}
export {};
