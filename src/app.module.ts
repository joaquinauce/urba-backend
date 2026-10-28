import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from './database.module.js';
import { AuthController, AuthService, JwtGuard } from './auth.js';
import { AdminController, AdminService } from './admin.js';
import { PublicController, PublicService } from './public.js';
import { ReportsController, ReportsService } from './reports.js';
import { HealthController } from './health.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({ useFactory: () => {
      const secret = process.env.JWT_SECRET;
      if (!secret || secret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
      return { secret, signOptions: { expiresIn: '12h' } };
    } }),
    DatabaseModule,
  ],
  controllers: [HealthController, AuthController, AdminController, PublicController, ReportsController],
  providers: [AuthService, JwtGuard, AdminService, PublicService, ReportsService],
})
export class AppModule {}
