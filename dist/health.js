var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Inject } from '@nestjs/common';
import { DB } from './database.module.js';
let HealthController = class HealthController {
    db;
    constructor(db) {
        this.db = db;
    }
    async check() {
        const [result] = await this.db.query(`SELECT current_database() AS database,
      to_regclass('public.administrators') IS NOT NULL AS schema_ready`);
        return { status: result.schema_ready ? 'ok' : 'schema_missing', database: result.database };
    }
};
__decorate([
    Get(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "check", null);
HealthController = __decorate([
    Controller('health'),
    __param(0, Inject(DB)),
    __metadata("design:paramtypes", [Function])
], HealthController);
export { HealthController };
//# sourceMappingURL=health.js.map