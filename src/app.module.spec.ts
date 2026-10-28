import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { DB } from './database.module.js';
import { AuthController } from './auth.js';
import { AdminController } from './admin.js';
import { PublicController } from './public.js';
import { ReportsController } from './reports.js';

describe('composición de la API', () => {
  let module: TestingModule;
  beforeAll(async () => {
    process.env.JWT_SECRET='test-secret-with-more-than-32-characters';
    module=await Test.createTestingModule({imports:[AppModule]})
      .overrideProvider(DB).useValue({query:vi.fn()})
      .compile();
  });
  afterAll(async () => {await module?.close();delete process.env.JWT_SECRET});
  it('registra controladores públicos y administrativos con dependencias resueltas', () => {
    expect(module.get(AuthController)).toBeTruthy();
    expect(module.get(AdminController)).toBeTruthy();
    expect(module.get(PublicController)).toBeTruthy();
    expect(module.get(ReportsController)).toBeTruthy();
  });
});
