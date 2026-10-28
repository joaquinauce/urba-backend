import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { AdminService } from './admin.js';
import { ReportsService } from './reports.js';
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
    session(req: Request): Promise<any>;
    private limit;
    resolve(code: string, ip: string): Promise<any>;
    today(code: string, ip: string): Promise<{
        work: {
            id: any;
            name: any;
            foremanName: any;
        };
        date: string;
        goals: any;
        report: any;
        editable: boolean;
        closeTime: any;
    }>;
    todayFor(work: any): Promise<{
        work: {
            id: any;
            name: any;
            foremanName: any;
        };
        date: string;
        goals: any;
        report: any;
        editable: boolean;
        closeTime: any;
    }>;
    submit(code: string, ip: string, body: any): Promise<any>;
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
            id: any;
            name: any;
            foremanName: any;
        };
        date: string;
        goals: any;
        report: any;
        editable: boolean;
        closeTime: any;
    }>;
    submit(req: Request, body: any): Promise<any>;
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
            id: any;
            name: any;
            foremanName: any;
        };
        date: string;
        goals: any;
        report: any;
        editable: boolean;
        closeTime: any;
    }>;
    submit(code: string, req: Request, body: any): Promise<any>;
    upload(code: string, req: Request, id: string, file: Express.Multer.File): Promise<{
        id: `${string}-${string}-${string}-${string}-${string}`;
        width: number;
        height: number;
        mimeType: string;
    }>;
    photo(code: string, req: Request, id: string, res: Response): Promise<void>;
}
