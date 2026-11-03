import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { types } from 'pg';
import { dataSourceOptions } from './database/data-source.js';

export const DB = 'URBA_DB';

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: async () => {
        if (!process.env.DB_PASSWORD)
          throw new Error(
            'Falta DB_PASSWORD en backend/.env (contraseña del usuario de PostgreSQL)',
          );
        // PostgreSQL DATE represents a calendar day, not an instant in a time zone.
        // Keep it as YYYY-MM-DD for comparisons, forms and JSON responses.
        types.setTypeParser(types.builtins.DATE, (value) => value);
        const source = new DataSource(dataSourceOptions());
        return source.initialize();
      },
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
