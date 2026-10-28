import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.FRONTEND_ORIGIN?.split(',') ?? ['http://localhost:4200'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true }));
  app.use((req: {path:string}, res: {setHeader:(name:string,value:string)=>void}, next:()=>void) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    if (req.path.startsWith('/api/public/') || req.path.includes('/photos/')) res.setHeader('Cache-Control','no-store');
    next();
  });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
