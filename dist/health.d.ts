import type { DataSource } from 'typeorm';
export declare class HealthController {
    private readonly db;
    constructor(db: DataSource);
    check(): Promise<{
        status: string;
        database: null;
    } | {
        status: string;
        database: string;
    }>;
}
