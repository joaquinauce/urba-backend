import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { types } from 'pg';

export const DB = 'URBA_DB';

@Global()
@Module({
  providers: [{
    provide: DB,
    useFactory: async () => {
      if (!process.env.DB_PASSWORD) throw new Error('Falta DB_PASSWORD en backend/.env (contraseña del usuario de PostgreSQL)');
      // PostgreSQL DATE represents a calendar day, not an instant in a time zone.
      // Keep it as YYYY-MM-DD for comparisons, forms and JSON responses.
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
export class DatabaseModule {}
