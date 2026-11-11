import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  DailyGoal,
  DailyReport,
  DailyReportItem,
  Foreman,
  Person,
  Work,
} from './database/entities.js';
import { ReportsService } from './reports.js';
import { localNow } from './shared.js';

const work = Object.assign(new Work(), {
  id: 'work',
  administratorId: 'admin',
  foremanId: 'foreman',
  timeZone: 'America/Argentina/Buenos_Aires',
  closeTime: '23:59:00',
  status: 'ACTIVA',
});
const goals = [
  Object.assign(new DailyGoal(), {
    id: 'goal-1',
    activityId: 'activity-1',
    description: 'Postes',
    expectedQuantity: '20',
    unit: 'UNIDADES',
    customUnit: null,
    quantityStep: null,
    quantityDecimals: null,
  }),
  Object.assign(new DailyGoal(), {
    id: 'goal-2',
    activityId: 'activity-2',
    description: 'Cable',
    expectedQuantity: '500',
    unit: 'METROS',
    customUnit: null,
    quantityStep: null,
    quantityDecimals: null,
  }),
];

function setup() {
  const date = localNow(work.timeZone).date;
  const savedItems: DailyReportItem[] = [];
  const savedReports: DailyReport[] = [];
  const reportRepository = {
    findOneBy: vi.fn(async () => null),
    existsBy: vi.fn(async () => false),
    create: vi.fn((value) => Object.assign(new DailyReport(), value)),
    save: vi.fn(async (value: DailyReport) => {
      savedReports.push(value);
      return value;
    }),
  };
  const itemRepository = {
    findBy: vi.fn(async () => []),
    create: vi.fn((value) => Object.assign(new DailyReportItem(), value)),
    save: vi.fn(async (values: DailyReportItem[]) => {
      savedItems.push(...values);
      return values;
    }),
  };
  const queryBuilder = {
    where: vi.fn().mockReturnThis(),
    setLock: vi.fn().mockReturnThis(),
    getOne: vi.fn(async () => work),
  };
  const repositories = new Map<unknown, unknown>([
    [Work, { createQueryBuilder: () => queryBuilder }],
    [DailyGoal, { find: vi.fn(async () => goals) }],
    [
      Foreman,
      {
        findOneBy: vi.fn(async () =>
          Object.assign(new Foreman(), {
            firstName: 'Carlos',
            lastName: 'Pérez',
          }),
        ),
      },
    ],
    [DailyReport, reportRepository],
    [DailyReportItem, itemRepository],
    [
      Person,
      {
        findOneBy: vi.fn(async ({ id, administratorId }) =>
          id === 'person-1' && administratorId === 'admin'
            ? Object.assign(new Person(), {
                id: 'person-1',
                administratorId: 'admin',
                fullName: 'María Capataz',
                isActive: true,
              })
            : null,
        ),
      },
    ],
  ]);
  const manager = {
    getRepository: (target: unknown) => repositories.get(target),
  };
  const db = {
    transaction: async (callback: (tx: typeof manager) => Promise<unknown>) =>
      callback(manager),
  } as unknown as DataSource;
  const service = new ReportsService(db, {
    materialize: vi.fn(async () => {}),
  } as never);
  vi.spyOn(service, 'detail').mockImplementation(async () => {
    const scores = savedItems.map((item) =>
      Math.min(
        100,
        (Number(item.actualQuantity) / Number(item.expectedQuantitySnapshot)) *
          100,
      ),
    );
    return {
      id: 'report',
      date,
      compliance: Math.round(
        scores.reduce((sum, score) => sum + score, 0) / scores.length,
      ),
    } as never;
  });
  return { service, savedItems, savedReports };
}

describe('envío diario', () => {
  it('guarda cero y sobrecumplimiento sin inflar el promedio general', async () => {
    const { service, savedItems, savedReports } = setup();
    const result = await service.submit(work, {
      observations: '',
      items: [
        { goalId: 'goal-1', actualQuantity: 0 },
        { goalId: 'goal-2', actualQuantity: 600 },
      ],
    });
    expect(result.compliance).toBe(50);
    expect(savedItems.map((item) => Number(item.actualQuantity))).toEqual([
      0, 600,
    ]);
    expect(savedReports).toHaveLength(1);
    expect(savedReports[0]).toMatchObject({
      submittedByPersonId: null,
      foremanNameSnapshot: 'Carlos Pérez',
    });
  });
  it('atribuye el informe a la persona autenticada del mismo administrador', async () => {
    const { service, savedReports } = setup();
    await service.submit(
      work,
      {
        items: [
          { goalId: 'goal-1', actualQuantity: 1 },
          { goalId: 'goal-2', actualQuantity: 1 },
        ],
      },
      'person-1',
    );
    expect(savedReports[0]).toMatchObject({
      submittedByPersonId: 'person-1',
      foremanNameSnapshot: 'María Capataz',
    });
  });
  it('rechaza responsables inexistentes o pertenecientes a otro administrador', async () => {
    const { service, savedReports } = setup();
    await expect(
      service.submit(
        work,
        {
          items: [
            { goalId: 'goal-1', actualQuantity: 1 },
            { goalId: 'goal-2', actualQuantity: 1 },
          ],
        },
        'person-from-another-administrator',
      ),
    ).rejects.toThrow('Responsable no encontrado');
    expect(savedReports).toHaveLength(0);
  });
  it('rechaza informes incompletos antes de escribir', async () => {
    const { service, savedItems, savedReports } = setup();
    await expect(
      service.submit(work, {
        items: [{ goalId: 'goal-1', actualQuantity: 1 }],
      }),
    ).rejects.toThrow('Informá todos');
    expect(savedItems).toHaveLength(0);
    expect(savedReports).toHaveLength(0);
  });
});

describe('informe de avance de objetivos diarios', () => {
  it('usa las rendiciones históricas y calcula el porcentaje de cada objetivo', async () => {
    const report = Object.assign(new DailyReport(), {
      id: 'report-1', workId: 'work-1', workDate: '2026-11-09', foremanId: 'foreman-1',
      work: Object.assign(new Work(), { name: 'Obra Norte' }),
      foreman: Object.assign(new Foreman(), { firstName: 'Ana', lastName: 'Pérez' }),
    });
    const reportFind = vi.fn(async () => [report]);
    const itemFind = vi.fn(async () => [Object.assign(new DailyReportItem(), {
      id: 'item-1', reportId: 'report-1', descriptionSnapshot: 'Colocar postes',
      expectedQuantitySnapshot: '20', actualQuantity: '15', unitSnapshot: 'UNIDADES',
    })]);
    const db = { getRepository: (entity: unknown) => entity === DailyReport ? { find: reportFind } : { find: itemFind } } as unknown as DataSource;
    const service = new ReportsService(db, {} as never);
    const result = await service.dailyGoals('admin', '2026-11-01', '2026-11-10', 'work-1', 'foreman-1');
    expect(reportFind).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ administratorId: 'admin', workId: 'work-1', foremanId: 'foreman-1' }) }));
    expect(result[0]).toMatchObject({ date: '2026-11-09', workName: 'Obra Norte', foremanName: 'Ana Pérez', compliance: 75, items: [{ description: 'Colocar postes', expected: 20, actual: 15, percentage: 75 }] });
    expect(itemFind).toHaveBeenCalledOnce();
  });
});

describe('carga administrativa de informes vencidos', () => {
  it('guarda el informe histórico con atribución administrativa', async () => {
    const { service, savedReports, savedItems } = setup();
    const result = await service.submit(work, {
      observations: 'Carga de día vencido',
      items: [
        { goalId: 'goal-1', actualQuantity: 4 },
        { goalId: 'goal-2', actualQuantity: 8 },
      ],
    }, undefined, '2026-11-09');
    expect(result.id).toBe('report');
    expect(savedReports[0].administrativeEntry).toBe(true);
    expect(savedItems).toHaveLength(2);
  });

  it('acepta una fecha anterior y la envía por el mismo circuito de objetivos', async () => {
    const today = localNow('America/Argentina/Cordoba').date;
    const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const work = Object.assign(new Work(), { id: 'work-1', administratorId: 'admin', startDate: yesterday, timeZone: 'America/Argentina/Cordoba', closeTime: '19:00' });
    const service = new ReportsService({} as DataSource, { work: vi.fn(async () => work) } as never);
    const submit = vi.spyOn(service, 'submit').mockResolvedValue({ id: 'report-1' } as never);
    const body = { items: [{ goalId: 'goal-1', actualQuantity: 4 }] };
    await expect(service.submitMissing('admin', 'work-1', yesterday, body)).resolves.toEqual({ id: 'report-1' });
    expect(submit).toHaveBeenCalledWith(work, body, undefined, yesterday);
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await expect(service.submitMissing('admin', 'work-1', tomorrow, body)).rejects.toThrow();
  });
});
