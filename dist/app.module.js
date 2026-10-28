var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from './database.module.js';
import { AuthController, AuthService, JwtGuard } from './auth.js';
import { AdminController, AdminService } from './admin.js';
import { AliasController, PublicController, PublicService } from './public.js';
import { ReportsController, ReportsService } from './reports.js';
import { HealthController } from './health.js';
let AppModule = class AppModule {
};
AppModule = __decorate([
    Module({
        imports: [
            ConfigModule.forRoot({ isGlobal: true }),
            JwtModule.registerAsync({ useFactory: () => {
                    const secret = process.env.JWT_SECRET;
                    if (!secret || secret.length < 32)
                        throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
                    return { secret, signOptions: { expiresIn: '12h' } };
                } }),
            DatabaseModule,
        ],
        controllers: [HealthController, AuthController, AdminController, PublicController, AliasController, ReportsController],
        providers: [AuthService, JwtGuard, AdminService, PublicService, ReportsService],
    })
], AppModule);
export { AppModule };
//# sourceMappingURL=app.module.js.map