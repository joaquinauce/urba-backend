import { DataSource, type DataSourceOptions } from 'typeorm';
import { entities } from './entities.js';

export function dataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'urba',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
    entities: [...entities],
    migrations: [],
    migrationsRun: false,
    synchronize: false,
    logging: false,
  };
}

export const AppDataSource = new DataSource(dataSourceOptions());
