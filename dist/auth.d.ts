import { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
export type AdminRequest = Request & {
    administratorId: string;
};
export declare class AuthService {
    private readonly db;
    private readonly jwt;
    private readonly attempts;
    constructor(db: DataSource, jwt: JwtService);
    login(email: string, password: string, ip: string): Promise<{
        accessToken: string;
        administrator: {
            id: any;
            email: any;
            fullName: any;
        };
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
            id: any;
            email: any;
            fullName: any;
        };
    }>;
    me(req: AdminRequest): Promise<any>;
}
