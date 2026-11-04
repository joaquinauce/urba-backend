import { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { Administrator, Person, PersonRole } from './database/entities.js';
export type AdminRequest = Request & {
    administratorId: string;
    administratorPersonId?: string;
};
export declare class AuthService {
    private readonly db;
    private readonly jwt;
    private readonly attempts;
    constructor(db: DataSource, jwt: JwtService);
    login(email: string, password: string, ip: string): Promise<{
        accessToken: string;
        administrator: {
            id: string;
            email: string | null;
            fullName: string;
            role: string;
        };
        person?: undefined;
    } | {
        accessToken: string;
        person: {
            id: string;
            administratorId: string;
            fullName: string;
            roles: ("SITE_MANAGER" | "FOREMAN")[];
        };
        administrator?: undefined;
    }>;
}
export declare class JwtGuard implements CanActivate {
    private readonly jwt;
    private readonly db;
    constructor(jwt: JwtService, db: DataSource);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
export declare class AuthController {
    private readonly auth;
    private readonly db;
    constructor(auth: AuthService, db: DataSource);
    login(body: {
        email: string;
        password: string;
    }, req: Request): Promise<{
        accessToken: string;
        administrator: {
            id: string;
            email: string | null;
            fullName: string;
            role: string;
        };
        person?: undefined;
    } | {
        accessToken: string;
        person: {
            id: string;
            administratorId: string;
            fullName: string;
            roles: ("SITE_MANAGER" | "FOREMAN")[];
        };
        administrator?: undefined;
    }>;
    me(req: AdminRequest): Promise<{
        role: string;
        id: string;
        administratorId: string;
        administratorSourceId: string | null;
        foremanSourceId: string | null;
        fullName: string;
        email: string | null;
        passwordHash: string | null;
        isActive: boolean;
        pinHash: string | null;
        pinLookupHmac: string | null;
        sessionVersion: string;
        failedAttempts: number;
        lockedUntil: Date | null;
        lastAccessAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        administrator: import("typeorm").Relation<Administrator>;
        administratorSource: import("typeorm").Relation<Administrator | null>;
        foremanSource: import("typeorm").Relation<import("./database/entities.js").Foreman | null>;
        roles: import("typeorm").Relation<PersonRole[]>;
        workAssignments: import("typeorm").Relation<import("./database/entities.js").WorkAssignment[]>;
        submittedReports: import("typeorm").Relation<import("./database/entities.js").DailyReport[]>;
    } | {
        role: string;
        id: string;
        email: string;
        passwordHash: string;
        fullName: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        foremen: import("typeorm").Relation<import("./database/entities.js").Foreman[]>;
        works: import("typeorm").Relation<import("./database/entities.js").Work[]>;
        person: import("typeorm").Relation<Person | null>;
    } | undefined>;
}
