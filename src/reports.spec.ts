import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { ReportsService } from './reports.js';
import { localNow } from './shared.js';

const work={id:'work',administrator_id:'admin',foreman_id:'foreman',time_zone:'America/Argentina/Buenos_Aires',close_time:'23:59:00',status:'ACTIVA'};
const goals=[
  {id:'goal-1',activity_id:'activity-1',description:'Postes',expected_quantity:'20',unit:'UNIDADES',custom_unit:null},
  {id:'goal-2',activity_id:'activity-2',description:'Cable',expected_quantity:'500',unit:'METROS',custom_unit:null},
];

function setup() {
  const date=localNow(work.time_zone).date;
  const writes: {sql:string;params:unknown[]}[]=[];
  const query=vi.fn(async (sql:string,params:unknown[]=[])=>{
    if(sql.startsWith('SELECT * FROM works'))return [work];
    if(sql.startsWith('SELECT * FROM daily_goals'))return goals;
    if(sql.startsWith('SELECT first_name'))return [{first_name:'Carlos',last_name:'Pérez'}];
    if(sql.startsWith('INSERT INTO daily_reports')){writes.push({sql,params});return [{id:'report'}]}
    if(sql.startsWith('INSERT INTO daily_report_items')){writes.push({sql,params});return []}
    if(sql.includes('FROM daily_reports r JOIN works'))return [{id:'report',workId:'work',date,foremanName:'Carlos Pérez',observations:'',workName:'Obra'}];
    if(sql.includes('FROM daily_report_items WHERE report_id'))return [
      {id:'item-1',goalId:'goal-1',description:'Postes',expected:'20',actual:0,unit:'UNIDADES'},
      {id:'item-2',goalId:'goal-2',description:'Cable',expected:'500',actual:600,unit:'METROS'},
    ];
    if(sql.includes('FROM report_photos'))return [];
    return [];
  });
  const db={transaction:async (callback:(tx:{query:typeof query})=>Promise<unknown>)=>callback({query})} as unknown as DataSource;
  const admin={materialize:vi.fn(async()=>{})};
  return {service:new ReportsService(db,admin as any),writes};
}

describe('envío diario',()=>{
  it('guarda cero y sobrecumplimiento sin inflar el promedio general',async()=>{
    const {service,writes}=setup();
    const result=await service.submit(work,{observations:'',items:[{goalId:'goal-1',actualQuantity:0},{goalId:'goal-2',actualQuantity:600}]});
    expect(result.compliance).toBe(50);
    expect(writes.filter(w=>w.sql.startsWith('INSERT INTO daily_report_items')).map(w=>w.params[11])).toEqual([0,600]);
    expect(writes.find(w=>w.sql.startsWith('INSERT INTO daily_reports'))?.sql).toContain('ON CONFLICT (work_id,work_date)');
  });
  it('rechaza informes incompletos antes de escribir',async()=>{
    const {service,writes}=setup();
    await expect(service.submit(work,{items:[{goalId:'goal-1',actualQuantity:1}]})).rejects.toThrow('Informá todos');
    expect(writes).toHaveLength(0);
  });
});
