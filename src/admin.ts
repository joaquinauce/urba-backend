import { BadRequestException, Body, Controller, Delete, Get, Inject, Injectable, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import QRCode from 'qrcode';
import { DB } from './database.module.js';
import { JwtGuard } from './auth.js';
import type { AdminRequest } from './auth.js';
import { code, codeHash, localNow, number, one, optional, percentage, quantityForUnit, reportSummary, required, uuid, validDate, validUnit, type Db } from './shared.js';

type Work = { id: string; administrator_id: string; foreman_id: string; name: string; description: string | null; location: string | null; start_date: string; estimated_end_date: string; status: string; time_zone: string; close_time: string };
type GoalInput = { date?: string; description?: string; expectedQuantity?: number; unit?: string; customUnit?: string; activityId?: string; recurrence?: { startsOn: string; endsOn: string; daysMask: number } };

@Injectable()
export class AdminService {
  constructor(@Inject(DB) private readonly db: DataSource) {}

  async foremen(adminId: string) {
    return this.db.query('SELECT id, first_name AS "firstName", last_name AS "lastName", phone, is_active AS "isActive" FROM foremen WHERE administrator_id = $1 ORDER BY first_name, last_name', [adminId]);
  }
  async saveForeman(adminId: string, body: any, id?: string) {
    const first = required(body.firstName, 'Nombre', 100);
    const last = required(body.lastName, 'Apellido', 100);
    const phone = required(body.phone, 'Teléfono', 40);
    if (id) {
      return one(this.db, 'UPDATE foremen SET first_name=$3,last_name=$4,phone=$5,is_active=$6,updated_at=now() WHERE administrator_id=$1 AND id=$2 RETURNING id,first_name AS "firstName",last_name AS "lastName",phone,is_active AS "isActive"', [adminId, id, first, last, phone, body.isActive !== false]);
    }
    return one(this.db, 'INSERT INTO foremen(id,administrator_id,first_name,last_name,phone,is_active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,first_name AS "firstName",last_name AS "lastName",phone,is_active AS "isActive"', [uuid(), adminId, first, last, phone, body.isActive !== false]);
  }
  async works(adminId: string) {
    return this.db.query(`SELECT w.id,w.name,w.description,w.location,w.start_date AS "startDate",w.estimated_end_date AS "estimatedEndDate",w.status,w.time_zone AS "timeZone",w.close_time AS "closeTime",w.foreman_id AS "foremanId",f.first_name||' '||f.last_name AS "foremanName" FROM works w JOIN foremen f ON f.id=w.foreman_id WHERE w.administrator_id=$1 ORDER BY CASE w.status WHEN 'ACTIVA' THEN 0 WHEN 'PAUSADA' THEN 1 ELSE 2 END,w.name`, [adminId]);
  }
  async work(adminId: string, id: string, db: Db = this.db): Promise<Work> {
    return one<Work>(db, 'SELECT * FROM works WHERE administrator_id=$1 AND id=$2', [adminId, id]);
  }
  async saveWork(adminId: string, body: any, id?: string) {
    const name = required(body.name, 'Nombre de obra', 180);
    const description = optional(body.description);
    const location = optional(body.location);
    const start = validDate(body.startDate);
    const end = validDate(body.estimatedEndDate);
    if (end < start) throw new BadRequestException('La fecha final debe ser posterior al inicio');
    const foreman = await one(this.db, 'SELECT id FROM foremen WHERE administrator_id=$1 AND id=$2 AND is_active=true', [adminId, body.foremanId]);
    void foreman;
    const status = body.status ?? 'ACTIVA';
    if (!['ACTIVA', 'PAUSADA', 'FINALIZADA'].includes(status)) throw new BadRequestException('Estado inválido');
    const timeZone = body.timeZone ?? 'America/Argentina/Cordoba';
    localNow(timeZone);
    const closeTime = body.closeTime ?? '19:00';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(closeTime)) throw new BadRequestException('Hora de cierre inválida');
    if (id) {
      await this.work(adminId, id);
      return one(this.db, `UPDATE works SET foreman_id=$3,name=$4,description=$5,location=$6,start_date=$7,estimated_end_date=$8,status=$9,time_zone=$10,close_time=$11,updated_at=now() WHERE administrator_id=$1 AND id=$2 RETURNING id,name,status`, [adminId,id,body.foremanId,name,description,location,start,end,status,timeZone,closeTime]);
    }
    const accessCode = code();
    const workId = uuid();
    await this.db.query(`INSERT INTO works(id,administrator_id,foreman_id,name,description,location,start_date,estimated_end_date,status,time_zone,close_time,access_code_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [workId,adminId,body.foremanId,name,description,location,start,end,status,timeZone,closeTime,codeHash(accessCode)]);
    return this.accessResult(workId, name, accessCode);
  }
  private async accessResult(id: string, name: string, accessCode: string) {
    const url = `${(process.env.PUBLIC_APP_URL ?? 'http://localhost:4200').replace(/\/$/, '')}/obra/${accessCode}`;
    return { id, name, accessCode, url, qrDataUrl: await QRCode.toDataURL(url) };
  }
  async rotateCode(adminId: string, id: string) {
    const work = await this.work(adminId,id);
    const accessCode = code();
    await this.db.query('UPDATE works SET access_code_hash=$3,access_code_rotated_at=now(),updated_at=now() WHERE administrator_id=$1 AND id=$2', [adminId,id,codeHash(accessCode)]);
    return this.accessResult(id,work.name,accessCode);
  }

  async materialize(adminId: string, workId: string, date: string, db: Db = this.db): Promise<void> {
    validDate(date);
    if (db === this.db) return this.db.transaction(async tx => {
      await tx.query('SELECT id FROM works WHERE administrator_id=$1 AND id=$2 FOR UPDATE',[adminId,workId]);
      return this.materialize(adminId,workId,date,tx);
    });
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const bit = 1 << ((weekday + 6) % 7);
    await db.query(`INSERT INTO daily_goals(id,administrator_id,work_id,activity_id,recurrence_id,work_date,description,expected_quantity,unit,custom_unit)
      SELECT gen_random_uuid(),r.administrator_id,r.work_id,r.activity_id,r.id,$3,r.description,r.expected_quantity,a.unit,a.custom_unit
      FROM goal_recurrences r JOIN activities a ON a.id=r.activity_id
      WHERE r.administrator_id=$1 AND r.work_id=$2 AND r.is_active=true AND $3::date BETWEEN r.starts_on AND r.ends_on AND (r.days_mask & $4)<>0
        AND NOT EXISTS (SELECT 1 FROM daily_reports reported WHERE reported.work_id=r.work_id AND reported.work_date=$3::date)
      ON CONFLICT (recurrence_id,work_date) WHERE recurrence_id IS NOT NULL DO NOTHING`, [adminId,workId,date,bit]);
  }
  async materializeAll(adminId: string, workId: string) {
    await this.db.transaction(async tx => {
      await tx.query('SELECT id FROM works WHERE administrator_id=$1 AND id=$2 FOR UPDATE',[adminId,workId]);
      await tx.query(`INSERT INTO daily_goals(id,administrator_id,work_id,activity_id,recurrence_id,work_date,description,expected_quantity,unit,custom_unit)
      SELECT gen_random_uuid(),r.administrator_id,r.work_id,r.activity_id,r.id,days.day::date,r.description,r.expected_quantity,a.unit,a.custom_unit
      FROM goal_recurrences r JOIN activities a ON a.id=r.activity_id
      CROSS JOIN LATERAL generate_series(r.starts_on,r.ends_on,interval '1 day') AS days(day)
      WHERE r.administrator_id=$1 AND r.work_id=$2 AND r.is_active=true
        AND (r.days_mask & (1 << (extract(isodow from days.day)::int-1)))<>0
        AND NOT EXISTS (SELECT 1 FROM daily_reports reported WHERE reported.work_id=r.work_id AND reported.work_date=days.day::date)
      ON CONFLICT (recurrence_id,work_date) WHERE recurrence_id IS NOT NULL DO NOTHING`,[adminId,workId]);
    });
  }
  async goals(adminId: string, workId: string, date: string) {
    await this.work(adminId,workId);
    await this.materialize(adminId,workId,date);
    return this.db.query('SELECT id,activity_id AS "activityId",recurrence_id AS "recurrenceId",work_date AS date,description,expected_quantity AS "expectedQuantity",unit,custom_unit AS "customUnit",is_active AS "isActive" FROM daily_goals WHERE administrator_id=$1 AND work_id=$2 AND work_date=$3 ORDER BY created_at,id', [adminId,workId,date]);
  }
  async recurrences(adminId: string, workId: string) {
    await this.work(adminId,workId);
    return this.db.query('SELECT id,activity_id AS "activityId",description,expected_quantity AS "expectedQuantity",starts_on AS "startsOn",ends_on AS "endsOn",days_mask AS "daysMask",is_active AS "isActive" FROM goal_recurrences WHERE administrator_id=$1 AND work_id=$2 ORDER BY created_at DESC', [adminId,workId]);
  }
  async createGoal(adminId: string, workId: string, body: GoalInput) {
    await this.work(adminId,workId);
    const description = required(body.description,'Descripción');
    const {unit,customUnit} = validUnit(body.unit,body.customUnit);
    const expected = quantityForUnit(body.expectedQuantity,unit,'Meta',true);
    return this.db.transaction(async tx => {
      await tx.query('SELECT id FROM works WHERE administrator_id=$1 AND id=$2 FOR UPDATE',[adminId,workId]);
      let activityId = body.activityId;
      if (activityId) {
        const activity = await one<any>(tx,'SELECT id,unit,custom_unit FROM activities WHERE administrator_id=$1 AND work_id=$2 AND id=$3 AND is_active=true',[adminId,workId,activityId]);
        if (activity.unit !== unit || activity.custom_unit !== customUnit) throw new BadRequestException('La unidad de la actividad debe mantenerse');
      } else {
        activityId = uuid();
        await tx.query('INSERT INTO activities(id,administrator_id,work_id,name,unit,custom_unit) VALUES($1,$2,$3,$4,$5,$6)',[activityId,adminId,workId,description,unit,customUnit]);
      }
      if (body.recurrence) {
        const { startsOn, endsOn, daysMask } = body.recurrence;
        validDate(startsOn); validDate(endsOn);
        if (endsOn < startsOn || (Date.parse(endsOn)-Date.parse(startsOn))/86400000 > 730) throw new BadRequestException('Rango de recurrencia inválido (máximo dos años)');
        if (!Number.isInteger(daysMask) || daysMask < 1 || daysMask > 127) throw new BadRequestException('Días de recurrencia inválidos');
        const id = uuid();
        await tx.query('INSERT INTO goal_recurrences(id,administrator_id,work_id,activity_id,description,expected_quantity,starts_on,ends_on,days_mask) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,adminId,workId,activityId,description,expected,startsOn,endsOn,daysMask]);
        return { id, activityId, recurrence: true };
      }
      const date = validDate(body.date!);
      const reported = await tx.query('SELECT 1 FROM daily_reports WHERE administrator_id=$1 AND work_id=$2 AND work_date=$3',[adminId,workId,date]);
      if (reported.length) throw new BadRequestException('No se pueden agregar objetivos a un día informado');
      const id = uuid();
      await tx.query('INSERT INTO daily_goals(id,administrator_id,work_id,activity_id,work_date,description,expected_quantity,unit,custom_unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,adminId,workId,activityId,date,description,expected,unit,customUnit]);
      return { id, activityId, recurrence: false };
    });
  }
  async updateGoal(adminId: string, workId: string, goalId: string, body: any) {
    return this.db.transaction(async tx => {
      await tx.query('SELECT id FROM works WHERE administrator_id=$1 AND id=$2 FOR UPDATE',[adminId,workId]);
      const goal = await one<any>(tx,'SELECT * FROM daily_goals WHERE administrator_id=$1 AND work_id=$2 AND id=$3 FOR UPDATE',[adminId,workId,goalId]);
      const reported = await tx.query('SELECT 1 FROM daily_reports WHERE work_id=$1 AND work_date=$2',[workId,goal.work_date]);
      if (reported.length) throw new BadRequestException('El objetivo ya fue informado');
      const description = required(body.description ?? goal.description,'Descripción');
      const expected = quantityForUnit(body.expectedQuantity ?? goal.expected_quantity,goal.unit,'Meta',true);
      return one(tx,'UPDATE daily_goals SET description=$4,expected_quantity=$5,is_active=$6,updated_at=now() WHERE administrator_id=$1 AND work_id=$2 AND id=$3 RETURNING id,description,expected_quantity AS "expectedQuantity",is_active AS "isActive"',[adminId,workId,goalId,description,expected,body.isActive ?? goal.is_active]);
    });
  }
  async deactivateRecurrence(adminId: string, workId: string, id: string) {
    const work = await this.work(adminId,workId);
    const today = localNow(work.time_zone).date;
    return this.db.transaction(async tx => {
      await tx.query('SELECT id FROM works WHERE administrator_id=$1 AND id=$2 FOR UPDATE',[adminId,workId]);
      const result = await one(tx,'UPDATE goal_recurrences SET is_active=false,updated_at=now() WHERE administrator_id=$1 AND work_id=$2 AND id=$3 RETURNING id,is_active AS "isActive"',[adminId,workId,id]);
      await tx.query(`UPDATE daily_goals g SET is_active=false,updated_at=now() WHERE g.administrator_id=$1 AND g.work_id=$2 AND g.recurrence_id=$3 AND g.work_date>=$4 AND NOT EXISTS(SELECT 1 FROM daily_reports r WHERE r.work_id=g.work_id AND r.work_date=g.work_date)`,[adminId,workId,id,today]);
      return result;
    });
  }
  async copyGoals(adminId: string, workId: string, date: string) {
    validDate(date);
    const previous = new Date(`${date}T12:00:00Z`); previous.setUTCDate(previous.getUTCDate()-1);
    const prev = previous.toISOString().slice(0,10);
    await this.materialize(adminId,workId,prev);
    return this.db.transaction(async tx => {
      await tx.query('SELECT id FROM works WHERE administrator_id=$1 AND id=$2 FOR UPDATE',[adminId,workId]);
      const reported = await tx.query('SELECT 1 FROM daily_reports WHERE work_id=$1 AND work_date=$2',[workId,date]);
      if (reported.length) throw new BadRequestException('El día ya fue informado');
      const result = await tx.query(`INSERT INTO daily_goals(id,administrator_id,work_id,activity_id,work_date,description,expected_quantity,unit,custom_unit)
        SELECT gen_random_uuid(),administrator_id,work_id,activity_id,$3,description,expected_quantity,unit,custom_unit FROM daily_goals
        WHERE administrator_id=$1 AND work_id=$2 AND work_date=$4 AND is_active=true
        AND NOT EXISTS (SELECT 1 FROM daily_goals target WHERE target.work_id=$2 AND target.work_date=$3 AND target.activity_id=daily_goals.activity_id AND target.description=daily_goals.description)
        RETURNING id`,[adminId,workId,date,prev]);
      return { copied: result.length };
    });
  }

  async dashboard(adminId: string) {
    const works = await this.db.query(`SELECT w.*,f.first_name||' '||f.last_name AS foreman_name FROM works w JOIN foremen f ON f.id=w.foreman_id WHERE w.administrator_id=$1 AND w.status='ACTIVA'`,[adminId]);
    const result: any[] = [];
    for (const work of works) {
      const {date,time} = localNow(work.time_zone);
      await this.materializeAll(adminId,work.id);
      const goals = await this.db.query('SELECT id FROM daily_goals WHERE work_id=$1 AND work_date=$2 AND is_active=true',[work.id,date]);
      const reports = await this.db.query('SELECT id,work_date FROM daily_reports WHERE work_id=$1 ORDER BY work_date DESC LIMIT 7',[work.id]);
      const today = reports.find((r:any) => r.work_date === date);
      let compliance: number | null = null;
      const averages: number[] = [];
      for (const report of reports) {
        const items = await this.db.query('SELECT actual_quantity,expected_quantity_snapshot FROM daily_report_items WHERE report_id=$1',[report.id]);
        const score = reportSummary(items);
        if (score !== null) averages.push(score);
        if (report.id === today?.id) compliance = score;
      }
      const status = goals.length === 0 ? 'SIN_OBJETIVOS' : today ? (compliance === null ? 'SIN_OBJETIVOS' : compliance >= 100 ? 'VERDE' : compliance >= 70 ? 'AMARILLO' : 'ROJO') : time >= work.close_time.slice(0,5) ? 'NEGRO' : 'GRIS';
      const daysRemaining = Math.ceil((Date.parse(`${work.estimated_end_date}T12:00:00Z`)-Date.parse(`${date}T12:00:00Z`))/86400000);
      const deviationRows = await this.db.query(`SELECT g.activity_id,SUM(g.expected_quantity)::numeric AS planned,COALESCE(SUM(i.actual_quantity),0)::numeric AS executed
        FROM daily_goals g LEFT JOIN daily_report_items i ON i.goal_id=g.id
        WHERE g.work_id=$1 AND g.work_date<=$2 AND g.is_active=true GROUP BY g.activity_id`,[work.id,date]);
      const deviations=deviationRows.map((row:any)=>({activityId:row.activity_id,planned:number(row.planned),executed:number(row.executed),difference:number(row.executed)-number(row.planned)}));
      result.push({ id:work.id,name:work.name,foremanName:work.foreman_name,today:date,timeZone:work.time_zone,estimatedEndDate:work.estimated_end_date,daysRemaining,compliance,average7: averages.length ? Math.round(averages.reduce((a,b)=>a+b,0)/averages.length) : null,reportStatus:status,hasReport:!!today,deviations });
    }
    const order: Record<string,number> = {NEGRO:0,ROJO:1,AMARILLO:2,GRIS:3,SIN_OBJETIVOS:4,VERDE:5};
    return result.sort((a,b)=>order[a.reportStatus]-order[b.reportStatus] || a.name.localeCompare(b.name));
  }
  async workDetail(adminId: string, workId: string) {
    const work = await this.work(adminId,workId);
    const {date:today,time:todayTime} = localNow(work.time_zone);
    await this.materializeAll(adminId,workId);
    const goals = await this.db.query('SELECT id,activity_id AS "activityId",work_date AS date,description,expected_quantity AS "expectedQuantity",unit FROM daily_goals WHERE administrator_id=$1 AND work_id=$2 AND is_active=true ORDER BY work_date DESC',[adminId,workId]);
    const reports = await this.db.query('SELECT id,work_date AS date,foreman_name_snapshot AS "foremanName",observations,submitted_at AS "submittedAt",updated_at AS "updatedAt" FROM daily_reports WHERE administrator_id=$1 AND work_id=$2 ORDER BY work_date DESC',[adminId,workId]);
    const activities = await this.db.query('SELECT id,name,unit,custom_unit AS "customUnit" FROM activities WHERE administrator_id=$1 AND work_id=$2',[adminId,workId]);
    const items = await this.db.query(`SELECT i.report_id AS "reportId",i.activity_id AS "activityId",i.goal_id AS "goalId",i.description_snapshot AS description,i.expected_quantity_snapshot AS expected,i.actual_quantity AS actual,i.unit_snapshot AS unit,r.work_date AS date FROM daily_report_items i JOIN daily_reports r ON r.id=i.report_id WHERE i.administrator_id=$1 AND i.work_id=$2 ORDER BY r.work_date DESC`,[adminId,workId]);
    const photos = await this.db.query('SELECT p.id,p.report_id AS "reportId" FROM report_photos p WHERE p.administrator_id=$1 AND p.work_id=$2',[adminId,workId]);
    const corrections = await this.db.query('SELECT id,report_id AS "reportId",before_value AS before,after_value AS after,reason,created_at AS "createdAt" FROM report_corrections WHERE administrator_id=$1 AND work_id=$2 ORDER BY created_at DESC',[adminId,workId]);
    const progress = activities.map((activity:any) => {
      const planned = goals.filter((g:any)=>g.activityId===activity.id && g.date<=today).reduce((s:number,g:any)=>s+number(g.expectedQuantity),0);
      const executed = items.filter((i:any)=>i.activityId===activity.id && i.date<=today).reduce((s:number,i:any)=>s+number(i.actual),0);
      const reportedDays = new Set(items.filter((i:any)=>i.activityId===activity.id && i.date<=today).map((i:any)=>i.date)).size;
      const remaining = goals.filter((g:any)=>g.activityId===activity.id && g.date>today).reduce((s:number,g:any)=>s+number(g.expectedQuantity),0);
      const rate = reportedDays >= 2 ? executed/reportedDays : null;
      const projectedDays = rate && rate>0 ? Math.ceil(Math.max(0,planned+remaining-executed)/rate) : null;
      return {activityId:activity.id,name:activity.name,unit:activity.unit,planned,executed,difference:executed-planned,compliance:planned>0?Math.round(percentage(executed,planned)):null,projectedDays,risk: projectedDays !== null && projectedDays > Math.ceil((Date.parse(`${work.estimated_end_date}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/86400000)};
    });
    return { today,todayTime,work:{id:work.id,name:work.name,description:work.description,location:work.location,startDate:work.start_date,estimatedEndDate:work.estimated_end_date,status:work.status,foremanId:work.foreman_id,timeZone:work.time_zone,closeTime:work.close_time},goals,reports,items,photos,corrections,progress,activities };
  }
}

@UseGuards(JwtGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}
  @Get('foremen') foremen(@Req() req: AdminRequest) { return this.service.foremen(req.administratorId); }
  @Post('foremen') createForeman(@Req() req: AdminRequest,@Body() body:any) { return this.service.saveForeman(req.administratorId,body); }
  @Patch('foremen/:id') updateForeman(@Req() req: AdminRequest,@Param('id') id:string,@Body() body:any) { return this.service.saveForeman(req.administratorId,body,id); }
  @Get('works') works(@Req() req: AdminRequest) { return this.service.works(req.administratorId); }
  @Post('works') createWork(@Req() req: AdminRequest,@Body() body:any) { return this.service.saveWork(req.administratorId,body); }
  @Patch('works/:id') updateWork(@Req() req: AdminRequest,@Param('id') id:string,@Body() body:any) { return this.service.saveWork(req.administratorId,body,id); }
  @Post('works/:id/rotate-code') rotateCode(@Req() req: AdminRequest,@Param('id') id:string) { return this.service.rotateCode(req.administratorId,id); }
  @Get('works/:id') detail(@Req() req: AdminRequest,@Param('id') id:string) { return this.service.workDetail(req.administratorId,id); }
  @Get('works/:id/goals') goals(@Req() req: AdminRequest,@Param('id') id:string,@Query('date') date:string) { return this.service.goals(req.administratorId,id,validDate(date)); }
  @Post('works/:id/goals') createGoal(@Req() req: AdminRequest,@Param('id') id:string,@Body() body:GoalInput) { return this.service.createGoal(req.administratorId,id,body); }
  @Patch('works/:id/goals/:goalId') updateGoal(@Req() req: AdminRequest,@Param('id') id:string,@Param('goalId') goalId:string,@Body() body:any) { return this.service.updateGoal(req.administratorId,id,goalId,body); }
  @Post('works/:id/goals/copy') copy(@Req() req: AdminRequest,@Param('id') id:string,@Body() body:{date:string}) { return this.service.copyGoals(req.administratorId,id,body.date); }
  @Get('works/:id/recurrences') recurrences(@Req() req: AdminRequest,@Param('id') id:string) { return this.service.recurrences(req.administratorId,id); }
  @Delete('works/:id/recurrences/:recurrenceId') deactivate(@Req() req: AdminRequest,@Param('id') id:string,@Param('recurrenceId') recurrenceId:string) { return this.service.deactivateRecurrence(req.administratorId,id,recurrenceId); }
  @Get('dashboard') dashboard(@Req() req: AdminRequest) { return this.service.dashboard(req.administratorId); }
}
