var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { types } from 'pg';
export const DB = 'URBA_DB';
let DatabaseModule = class DatabaseModule {
};
DatabaseModule = __decorate([
    Global(),
    Module({
        providers: [{
                provide: DB,
                useFactory: async () => {
                    if (!process.env.DB_PASSWORD)
                        throw new Error('Falta DB_PASSWORD en backend/.env (contraseña del usuario de PostgreSQL)');
                    types.setTypeParser(types.builtins.DATE, value => value);
                    const source = new DataSource({
                        type: 'postgres',
                        host: process.env.DB_HOST ?? 'localhost',
                        port: Number(process.env.DB_PORT ?? 5432),
                        username: process.env.DB_USER ?? 'postgres',
                        password: process.env.DB_PASSWORD,
                        database: process.env.DB_NAME ?? 'urba',
                        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
                        entities: [],
                        migrationsRun: false,
                        synchronize: false,
                        logging: false,
                    });
                    return source.initialize();
                },
            }],
        exports: [DB],
    })
], DatabaseModule);
export { DatabaseModule };
//# sourceMappingURL=database.module.js.map