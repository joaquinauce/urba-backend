import { BadRequestException, Body, Controller, Get, Inject, Injectable, Param, Patch, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import sharp from 'sharp';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DB } from './database.module.js';
import { JwtGuard } from './auth.js';
import type { AdminRequest } from './auth.js';
import { AdminService } from './admin.js';
import { localNow, nonnegative, one, optional, reportSummary, uuid, type Db } from './shared.js';

type Work = { id:string; administrator_id:string; foreman_id:string; time_zone:string; close_time:string; status:string };
type Submission = { observations?:string; items:{ goalId:string; actualQuantity:number }[] };

@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: DataSource, private readonly admin: AdminService) {}
  private editable(work: Work) {
    const local = localNow(work.time_zone);
    if (work.status !== 'ACTIVA' || local.time >= work.close_time.slice(0,5)) throw new BadRequestException('El día está cerrado para informar');
    return local.date;
  }
  async submit(work: Work, body: Submission) {
    if (!Array.isArray(body?.items)) throw new BadRequestException('Faltan las cantidades');
    const date = this.editable(work);
    return this.db.transaction(async tx => {
      const current = await one<Work>(tx,'SELECT * FROM works WHERE id=$1 FOR UPDATE',[work.id]);
      if (this.editable(current) !== date) throw new BadRequestException('El día está cerrado para informar');
      await this.admin.materialize(work.administrator_id,work.id,date,tx);
      const goals = await tx.query('SELECT * FROM daily_goals WHERE work_id=$1 AND work_date=$2 AND is_active=true ORDER BY id',[work.id,date]);
      if (!goals.length) throw new BadRequestException('Hoy no hay objetivos para informar');
      const supplied = new Map<string,number>();
      for (const item of body.items) {
        if (!item || typeof item.goalId !== 'string' || supplied.has(item.goalId)) throw new BadRequestException('Objetivos duplicados o inválidos');
        supplied.set(item.goalId,nonnegative(item.actualQuantity,'Cantidad realizada'));
      }
      if (supplied.size !== goals.length || goals.some((goal:any)=>!supplied.has(goal.id))) throw new BadRequestException('Informá todos los objetivos del día');
      const foreman = await one<any>(tx,'SELECT first_name,last_name FROM foremen WHERE administrator_id=$1 AND id=$2',[work.administrator_id,work.foreman_id]);
      const observations = optional(body.observations,5000);
      const reportId = uuid();
      const rows = await tx.query(`INSERT INTO daily_reports(id,administrator_id,work_id,work_date,foreman_id,foreman_name_snapshot,observations)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (work_id,work_date) DO UPDATE SET observations=EXCLUDED.observations,foreman_id=EXCLUDED.foreman_id,foreman_name_snapshot=EXCLUDED.foreman_name_snapshot,updated_at=now(),submitted_at=now()
        RETURNING id`,[reportId,work.administrator_id,work.id,date,work.foreman_id,`${foreman.first_name} ${foreman.last_name}`,observations]);
      const id = rows[0].id;
      for (const goal of goals) {
        await tx.query(`INSERT INTO daily_report_items(id,administrator_id,work_id,report_id,work_date,goal_id,activity_id,description_snapshot,expected_quantity_snapshot,unit_snapshot,custom_unit_snapshot,actual_quantity)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT (report_id,goal_id) DO UPDATE SET actual_quantity=EXCLUDED.actual_quantity,updated_at=now()`,
          [uuid(),work.administrator_id,work.id,id,date,goal.id,goal.activity_id,goal.description,goal.expected_quantity,goal.unit,goal.custom_unit,supplied.get(goal.id)]);
      }
      return this.detail(id,work.administrator_id,tx);
    });
  }
  async detail(id: string, adminId: string, db: Db = this.db) {
    const report = await one<any>(db,`SELECT r.id,r.work_id AS "workId",r.work_date AS date,r.foreman_name_snapshot AS "foremanName",r.observations,r.submitted_at AS "submittedAt",r.updated_at AS "updatedAt",w.name AS "workName" FROM daily_reports r JOIN works w ON w.id=r.work_id WHERE r.id=$1 AND r.administrator_id=$2`,[id,adminId]);
    const items = await db.query('SELECT id,goal_id AS "goalId",activity_id AS "activityId",description_snapshot AS description,expected_quantity_snapshot AS expected,actual_quantity AS actual,unit_snapshot AS unit,custom_unit_snapshot AS "customUnit" FROM daily_report_items WHERE report_id=$1 ORDER BY created_at,id',[id]);
    const photos = await db.query('SELECT id,mime_type AS "mimeType",width,height FROM report_photos WHERE report_id=$1 ORDER BY created_at',[id]);
    return { ...report,items,photos,compliance:reportSummary(items.map((i:any)=>({actual_quantity:i.actual,expected_quantity_snapshot:i.expected}))) };
  }
  async list(adminId: string, workId: string) {
    await one(this.db,'SELECT id FROM works WHERE administrator_id=$1 AND id=$2',[adminId,workId]);
    return this.db.query('SELECT id,work_date AS date,submitted_at AS "submittedAt",updated_at AS "updatedAt" FROM daily_reports WHERE administrator_id=$1 AND work_id=$2 ORDER BY work_date DESC',[adminId,workId]);
  }
  async correct(adminId: string, reportId: string, body: { observations?:string; items?:{id:string;actualQuantity:number}[]; reason?:string }) {
    return this.db.transaction(async tx => {
      const report = await one<any>(tx,'SELECT r.*,w.time_zone,w.close_time FROM daily_reports r JOIN works w ON w.id=r.work_id WHERE r.administrator_id=$1 AND r.id=$2 FOR UPDATE OF r',[adminId,reportId]);
      const local = localNow(report.time_zone);
      if (report.work_date === local.date && local.time < report.close_time.slice(0,5)) throw new BadRequestException('El informe todavía está abierto para el capataz');
      const beforeReport = await this.detail(reportId,adminId,tx);
      const before = {observations:beforeReport.observations,items:beforeReport.items.map((item:any)=>({id:item.id,actual:item.actual}))};
      if (body.observations !== undefined) await tx.query('UPDATE daily_reports SET observations=$2,updated_at=now() WHERE id=$1',[reportId,optional(body.observations,5000)]);
      if (body.items !== undefined) {
        if (!Array.isArray(body.items)) throw new BadRequestException('Ítems inválidos');
        const ids = new Set<string>();
        for (const item of body.items) {
          if (!item || typeof item.id !== 'string' || ids.has(item.id)) throw new BadRequestException('Ítems duplicados o inválidos');
          ids.add(item.id);
          const rows = await tx.query('UPDATE daily_report_items SET actual_quantity=$3,updated_at=now() WHERE report_id=$1 AND id=$2 RETURNING id',[reportId,item.id,nonnegative(item.actualQuantity,'Cantidad realizada')]);
          if (!rows.length) throw new BadRequestException('Ítem inexistente');
        }
      }
      await tx.query('UPDATE daily_reports SET updated_at=now() WHERE id=$1',[reportId]);
      const afterReport = await this.detail(reportId,adminId,tx);
      const after = {observations:afterReport.observations,items:afterReport.items.map((item:any)=>({id:item.id,actual:item.actual}))};
      if (JSON.stringify(before) === JSON.stringify(after)) throw new BadRequestException('No hay cambios para registrar');
      await tx.query('INSERT INTO report_corrections(id,administrator_id,work_id,report_id,corrected_by_administrator_id,before_value,after_value,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uuid(),adminId,report.work_id,reportId,adminId,JSON.stringify(before),JSON.stringify(after),optional(body.reason,1000)]);
      return afterReport;
    });
  }
  async uploadPhoto(adminId: string, reportId: string, file: Express.Multer.File, publicWork?: Work) {
    if (!file || file.size > 12*1024*1024 || file.size === 0) throw new BadRequestException('La foto debe pesar menos de 12 MB');
    const report = await one<any>(this.db,'SELECT r.*,w.time_zone,w.close_time,w.status FROM daily_reports r JOIN works w ON w.id=r.work_id WHERE r.id=$1 AND r.administrator_id=$2',[reportId,adminId]);
    if (publicWork) {
      if (publicWork.id !== report.work_id || this.editable(publicWork) !== report.work_date) throw new BadRequestException('El informe ya no admite fotografías');
    }
    let data: Buffer;
    let width: number;
    let height: number;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 30_000_000 }).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:78});
      const result = await image.toBuffer({resolveWithObject:true});
      data = result.data; width = result.info.width; height = result.info.height;
    } catch { throw new BadRequestException('Formato de imagen inválido'); }
    const dir = resolve(process.env.PHOTO_STORAGE_DIR ?? './storage/photos');
    await mkdir(dir,{recursive:true});
    const key = `${uuid()}.webp`;
    await writeFile(join(dir,key),data,{flag:'wx'});
    const id = uuid();
    try {
      await this.db.query('INSERT INTO report_photos(id,administrator_id,work_id,report_id,storage_key,mime_type,byte_size,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,adminId,report.work_id,reportId,key,'image/webp',data.length,width,height]);
    } catch(error) { await unlink(join(dir,key)).catch(()=>{}); throw error; }
    return {id,width,height,mimeType:'image/webp'};
  }
  async photo(adminId: string, photoId: string, workId?: string): Promise<Buffer> {
    const photo = await one<any>(this.db,'SELECT storage_key FROM report_photos WHERE administrator_id=$1 AND id=$2 AND ($3::uuid IS NULL OR work_id=$3)',[adminId,photoId,workId ?? null]);
    if (!/^[0-9a-f-]{36}\.webp$/.test(photo.storage_key)) throw new BadRequestException('Foto inválida');
    return readFile(join(resolve(process.env.PHOTO_STORAGE_DIR ?? './storage/photos'),photo.storage_key));
  }
}

@UseGuards(JwtGuard)
@Controller('admin')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('works/:id/reports') list(@Req() req:AdminRequest,@Param('id') id:string) {return this.reports.list(req.administratorId,id);}
  @Get('reports/:id') detail(@Req() req:AdminRequest,@Param('id') id:string) {return this.reports.detail(id,req.administratorId);}
  @Patch('reports/:id') correct(@Req() req:AdminRequest,@Param('id') id:string,@Body() body:any) {return this.reports.correct(req.administratorId,id,body);}
  @Post('reports/:id/photos') @UseInterceptors(FileInterceptor('photo',{limits:{fileSize:12*1024*1024}})) upload(@Req() req:AdminRequest,@Param('id') id:string,@UploadedFile() file:Express.Multer.File) {return this.reports.uploadPhoto(req.administratorId,id,file);}
  @Get('photos/:id') async photo(@Req() req:AdminRequest,@Param('id') id:string,@Res() res:Response) {res.type('image/webp').send(await this.reports.photo(req.administratorId,id));}
}
