import { Controller, Get, Inject } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DB } from './database.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: DataSource) {}

  @Get()
  async check() {
    const [result] = await this.db.query(`SELECT current_database() AS database,
      to_regclass('public.administrators') IS NOT NULL AS schema_ready`);
    return { status: result.schema_ready ? 'ok' : 'schema_missing', database: result.database };
  }
}
