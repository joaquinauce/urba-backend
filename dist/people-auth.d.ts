import { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { type DataSource, type EntityManager } from 'typeorm';
export declare const PERSONAL_ROLES: readonly ["SITE_MANAGER", "FOREMAN"];
export type PersonalRole = (typeof PERSONAL_ROLES)[number];
export type PersonActor = {
    kind: 'person';
    id: string;
    administratorId: string;
    fullName: string;
    roles: PersonalRole[];
};
export type PersonRequest = Request & {
    actor: PersonActor;
};
export declare function codeLookupHmac(code: string): string;
export declare function validPersonalCode(value: unknown): value is string;
export declare function generatePersonalCode(db: DataSource | EntityManager): Promise<string>;
export declare class PersonAuthService {
    private readonly db;
    private readonly jwt;
    private readonly attempts;
    constructor(db: DataSource, jwt: JwtService);
    private limit;
    login(code: unknown, ip: string): Promise<{
        accessToken: string;
        person: {
            id: string;
            administratorId: string;
            fullName: string;
            roles: ("SITE_MANAGER" | "FOREMAN")[];
        };
    }>;
}
export declare class PersonJwtGuard implements CanActivate {
    private readonly jwt;
    private readonly db;
    constructor(jwt: JwtService, db: DataSource);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
export declare class WorkAuthorizationService {
    private readonly db;
    constructor(db: DataSource);
    authorize(actor: PersonActor, workId: string, write?: boolean): Promise<import("./database/entities.js").Work>;
}
export declare class PersonAuthController {
    private readonly auth;
    constructor(auth: PersonAuthService);
    login(body: {
        code?: unknown;
    }, request: Request): Promise<{
        accessToken: string;
        person: {
            id: string;
            administratorId: string;
            fullName: string;
            roles: ("SITE_MANAGER" | "FOREMAN")[];
        };
    }>;
    me(request: PersonRequest): Promise<PersonActor>;
}
