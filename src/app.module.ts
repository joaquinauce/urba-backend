import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from './database.module.js';
import { AuthController, AuthService, JwtGuard } from './auth.js';
import { AdminController, AdminService } from './admin.js';
import { AliasController, PublicController, PublicService } from './public.js';
import { ReportsController, ReportsService } from './reports.js';
import { HealthController } from './health.js';
import {
  PersonAuthController,
  PersonAuthService,
  PersonJwtGuard,
  WorkAuthorizationService,
} from './people-auth.js';
import {
  AssignmentAdminController,
  PeopleAdminController,
  PeopleAdminService,
} from './people-admin.js';
import { MemberController, MemberService } from './member.js';
import { AdminExpensesController, MemberExpensesController, LegacyExpensesController, ExpensesService } from './expenses.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32)
          throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
        const codeSecret = process.env.PERSON_CODE_HMAC_SECRET;
        if (!codeSecret || codeSecret.length < 32)
          throw new Error(
            'PERSON_CODE_HMAC_SECRET debe tener al menos 32 caracteres',
          );
        return { secret, signOptions: { expiresIn: '12h' } };
      },
    }),
    DatabaseModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    PersonAuthController,
    AdminController,
    PeopleAdminController,
    AssignmentAdminController,
    MemberController,
    AdminExpensesController,
    MemberExpensesController,
    LegacyExpensesController,
    PublicController,
    AliasController,
    ReportsController,
  ],
  providers: [
    AuthService,
    JwtGuard,
    PersonAuthService,
    PersonJwtGuard,
    WorkAuthorizationService,
    AdminService,
    PeopleAdminService,
    MemberService,
    ExpensesService,
    PublicService,
    ReportsService,
  ],
})
export class AppModule {}
