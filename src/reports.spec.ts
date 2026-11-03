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
