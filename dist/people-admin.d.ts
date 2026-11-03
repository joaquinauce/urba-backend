import { type DataSource } from 'typeorm';
import { type AdminRequest } from './auth.js';
export declare class PeopleAdminService {
    private readonly db;
    constructor(db: DataSource);
    private person;
    list(administratorId: string): Promise<{
        id: string;
        fullName: string;
        isActive: boolean;
        hasCode: boolean;
        failedAttempts: number;
        lockedUntil: Date | null;
        lastAccessAt: Date | null;
        roles: string[];
        activeAssignments: number;
    }[]>;
    create(administratorId: string, body: {
        fullName?: unknown;
        roles?: unknown;
    }): Promise<{
        id: string;
        fullName: string;
        isActive: boolean;
        roles: ("SITE_MANAGER" | "FOREMAN")[];
    }>;
    update(administratorId: string, id: string, body: {
        fullName?: unknown;
        isActive?: unknown;
        roles?: unknown;
    }): Promise<{
        id: string;
        fullName: string;
        isActive: boolean;
        roles: string[];
    }>;
    rotateCode(administratorId: string, id: string): Promise<{
        personId: string;
        code: string;
    }>;
    assignments(administratorId: string, workId: string): Promise<{
        id: string;
        personId: string;
        personName: string;
        roleCode: string;
        isPrimary: boolean;
        assignedAt: Date;
        unassignedAt: Date | null;
        active: boolean;
    }[]>;
    assign(administratorId: string, workId: string, body: {
        personId?: unknown;
        roleCode?: unknown;
        isPrimary?: unknown;
    }): Promise<{
        id: string;
        personId: string;
        roleCode: "SITE_MANAGER" | "FOREMAN";
        isPrimary: boolean;
        assignedAt: Date;
    }>;
    unassign(administratorId: string, workId: string, assignmentId: string): Promise<{
        id: string;
        unassignedAt: Date;
        active: boolean;
    }>;
}
export declare class PeopleAdminController {
    private readonly people;
    constructor(people: PeopleAdminService);
    list(request: AdminRequest): Promise<{
        id: string;
        fullName: string;
        isActive: boolean;
        hasCode: boolean;
        failedAttempts: number;
        lockedUntil: Date | null;
        lastAccessAt: Date | null;
        roles: string[];
        activeAssignments: number;
    }[]>;
    create(request: AdminRequest, body: any): Promise<{
        id: string;
        fullName: string;
        isActive: boolean;
        roles: ("SITE_MANAGER" | "FOREMAN")[];
    }>;
    update(request: AdminRequest, id: string, body: any): Promise<{
        id: string;
        fullName: string;
        isActive: boolean;
        roles: string[];
    }>;
    rotate(request: AdminRequest, id: string): Promise<{
        personId: string;
        code: string;
    }>;
}
export declare class AssignmentAdminController {
    private readonly people;
    constructor(people: PeopleAdminService);
    list(request: AdminRequest, workId: string): Promise<{
        id: string;
        personId: string;
        personName: string;
        roleCode: string;
        isPrimary: boolean;
        assignedAt: Date;
        unassignedAt: Date | null;
        active: boolean;
    }[]>;
    assign(request: AdminRequest, workId: string, body: any): Promise<{
        id: string;
        personId: string;
        roleCode: "SITE_MANAGER" | "FOREMAN";
        isPrimary: boolean;
        assignedAt: Date;
    }>;
    unassign(request: AdminRequest, workId: string, assignmentId: string): Promise<{
        id: string;
        unassignedAt: Date;
        active: boolean;
    }>;
}
