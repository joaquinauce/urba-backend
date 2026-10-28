import { BadRequestException, Body, Controller, Get, Inject, Injectable, Param, Post, Req, Res, UploadedFile, UseInterceptors, HttpException, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { DB } from './database.module.js';
import { AdminService } from './admin.js';
import { ReportsService } from './reports.js';
import { codeHash, localNow, one } from './shared.js';

@Injectable()
export class PublicService {
  private attempts = new Map<string,{count:number;until:number}>();
  constructor(@Inject(DB) private readonly db:DataSource,private readonly admin:AdminService,private readonly reports:ReportsService) {}
  private limit(ip:string) {
    const now=Date.now(); const item=this.attempts.get(ip);
    const next=!item || item.until<now ? {count:1,until:now+60_000} : {count:item.count+1,until:item.until};
    this.attempts.set(ip,next);
    if (next.count>60) throw new HttpException('Demasiados intentos; esperá un minuto',HttpStatus.TOO_MANY_REQUESTS);
    if (this.attempts.size>10_000) for (const [key,value] of this.attempts) if (value.until<now) this.attempts.delete(key);
  }
  async resolve(code:string,ip:string) {
    this.limit(ip);
    if (!/^[A-Za-z0-9_-]{32}$/.test(code)) throw new BadRequestException('Código inválido');
    return one<any>(this.db,'SELECT w.*,f.first_name||\' \'||f.last_name AS foreman_name FROM works w JOIN foremen f ON f.id=w.foreman_id WHERE w.access_code_hash=$1',[codeHash(code)]);
  }
  async today(code:string,ip:string) {
    const work=await this.resolve(code,ip);
    const {date,time}=localNow(work.time_zone);
    await this.admin.materialize(work.administrator_id,work.id,date);
    const goals=await this.db.query('SELECT id,description,expected_quantity AS "expectedQuantity",unit,custom_unit AS "customUnit" FROM daily_goals WHERE work_id=$1 AND work_date=$2 AND is_active=true ORDER BY created_at,id',[work.id,date]);
    const rows=await this.db.query('SELECT id FROM daily_reports WHERE work_id=$1 AND work_date=$2',[work.id,date]);
    const report=rows.length ? await this.reports.detail(rows[0].id,work.administrator_id) : null;
    return {work:{id:work.id,name:work.name,foremanName:work.foreman_name},date,goals,report,editable:work.status==='ACTIVA'&&time<work.close_time.slice(0,5),closeTime:work.close_time.slice(0,5)};
  }
  async submit(code:string,ip:string,body:any) {
    const work=await this.resolve(code,ip);
    return this.reports.submit(work,body);
  }
  async upload(code:string,ip:string,reportId:string,file:Express.Multer.File) {
    const work=await this.resolve(code,ip);
    return this.reports.uploadPhoto(work.administrator_id,reportId,file,work);
  }
  async photo(code:string,ip:string,photoId:string) {
    const work=await this.resolve(code,ip);
    return this.reports.photo(work.administrator_id,photoId,work.id);
  }
}

@Controller('public/works/:code')
export class PublicController {
  constructor(private readonly service:PublicService) {}
  @Get('today') today(@Param('code') code:string,@Req() req:Request) {return this.service.today(code,req.ip ?? 'unknown');}
  @Post('reports') submit(@Param('code') code:string,@Req() req:Request,@Body() body:any) {return this.service.submit(code,req.ip ?? 'unknown',body);}
  @Post('reports/:reportId/photos') @UseInterceptors(FileInterceptor('photo',{limits:{fileSize:12*1024*1024}})) upload(@Param('code') code:string,@Req() req:Request,@Param('reportId') id:string,@UploadedFile() file:Express.Multer.File) {return this.service.upload(code,req.ip ?? 'unknown',id,file);}
  @Get('photos/:id') async photo(@Param('code') code:string,@Req() req:Request,@Param('id') id:string,@Res() res:Response) {res.type('image/webp').send(await this.service.photo(code,req.ip ?? 'unknown',id));}
}
