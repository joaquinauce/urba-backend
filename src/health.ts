import { Controller, Get, Inject } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DB } from './database.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: DataSource) {}

  @Get()
  async check() {
    const result = await this.db
      .createQueryBuilder()
      .select('current_database()', 'database')
      .addSelect(
        `to_regclass('public.administrators') IS NOT NULL`,
        'schema_ready',
      )
      .from('pg_catalog.pg_database', 'database_catalog')
      .where('database_catalog.datname = current_database()')
      .getRawOne<{ database: string; schema_ready: boolean }>();
    if (!result) return { status: 'schema_missing', database: null };
    return {
      status: result.schema_ready ? 'ok' : 'schema_missing',
      database: result.database,
    };
  }
}
