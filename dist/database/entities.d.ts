import { type Relation } from 'typeorm';
export type Numeric = string;
export type CalendarDate = string;
export declare class Administrator {
    id: string;
    email: string;
    passwordHash: string;
    fullName: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    foremen: Relation<Foreman[]>;
    works: Relation<Work[]>;
    person: Relation<Person | null>;
}
export declare class Foreman {
    id: string;
    administratorId: string;
    firstName: string;
    lastName: string;
    phone: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    administrator: Relation<Administrator>;
    primaryWorks: Relation<Work[]>;
    person: Relation<Person | null>;
}
export declare class Work {
    id: string;
    administratorId: string;
    foremanId: string;
    name: string;
    description: string | null;
    location: string | null;
    startDate: CalendarDate;
    estimatedEndDate: CalendarDate;
    status: string;
    timeZone: string;
    closeTime: string;
    accessCodeHash: string;
    accessCodeRotatedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    accessAlias: string | null;
    aliasPinHash: string | null;
    aliasSessionVersion: string;
    administrator: Relation<Administrator>;
    primaryForeman: Relation<Foreman>;
    activities: Relation<Activity[]>;
    recurrences: Relation<GoalRecurrence[]>;
    goals: Relation<DailyGoal[]>;
    reports: Relation<DailyReport[]>;
    assignments: Relation<WorkAssignment[]>;
}
export declare class Activity {
    id: string;
    administratorId: string;
    workId: string;
    name: string;
    unit: string;
    customUnit: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    quantityStep: Numeric | null;
    quantityDecimals: number | null;
    work: Relation<Work>;
    recurrences: Relation<GoalRecurrence[]>;
    goals: Relation<DailyGoal[]>;
}
export declare class GoalRecurrence {
    id: string;
    administratorId: string;
    workId: string;
    activityId: string;
    description: string;
    expectedQuantity: Numeric;
    startsOn: CalendarDate;
    endsOn: CalendarDate;
    daysMask: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    work: Relation<Work>;
    activity: Relation<Activity>;
    goals: Relation<DailyGoal[]>;
}
export declare class DailyGoal {
    id: string;
    administratorId: string;
    workId: string;
    activityId: string;
    recurrenceId: string | null;
    workDate: CalendarDate;
    description: string;
    expectedQuantity: Numeric;
    unit: string;
    customUnit: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    quantityStep: Numeric | null;
    quantityDecimals: number | null;
    work: Relation<Work>;
    activity: Relation<Activity>;
    recurrence: Relation<GoalRecurrence | null>;
    reportItems: Relation<DailyReportItem[]>;
}
export declare class DailyReport {
    id: string;
    administratorId: string;
    workId: string;
    workDate: CalendarDate;
    foremanId: string;
    foremanNameSnapshot: string;
    submittedByPersonId: string | null;
    observations: string | null;
    submittedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    work: Relation<Work>;
    foreman: Relation<Foreman>;
    submittedByPerson: Relation<Person | null>;
    items: Relation<DailyReportItem[]>;
    photos: Relation<ReportPhoto[]>;
    corrections: Relation<ReportCorrection[]>;
}
export declare class DailyReportItem {
    id: string;
    administratorId: string;
    workId: string;
    reportId: string;
    workDate: CalendarDate;
    goalId: string;
    activityId: string;
    descriptionSnapshot: string;
    expectedQuantitySnapshot: Numeric;
    unitSnapshot: string;
    customUnitSnapshot: string | null;
    actualQuantity: Numeric;
    createdAt: Date;
    updatedAt: Date;
    quantityStepSnapshot: Numeric | null;
    quantityDecimalsSnapshot: number | null;
    report: Relation<DailyReport>;
    goal: Relation<DailyGoal>;
}
export declare class ReportPhoto {
    id: string;
    administratorId: string;
    workId: string;
    reportId: string;
    storageKey: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    createdAt: Date;
    report: Relation<DailyReport>;
}
export declare class ReportCorrection {
    id: string;
    administratorId: string;
    workId: string;
    reportId: string;
    correctedByAdministratorId: string;
    beforeValue: unknown;
    afterValue: unknown;
    reason: string | null;
    createdAt: Date;
    report: Relation<DailyReport>;
    administrator: Relation<Administrator>;
    correctedBy: Relation<Administrator>;
}
export declare class Role {
    code: string;
    name: string;
    createdAt: Date;
    people: Relation<PersonRole[]>;
}
export declare class Person {
    id: string;
    administratorId: string;
    administratorSourceId: string | null;
    foremanSourceId: string | null;
    fullName: string;
    email: string | null;
    passwordHash: string | null;
    isActive: boolean;
    pinHash: string | null;
    pinLookupHmac: string | null;
    sessionVersion: string;
    failedAttempts: number;
    lockedUntil: Date | null;
    lastAccessAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    administrator: Relation<Administrator>;
    administratorSource: Relation<Administrator | null>;
    foremanSource: Relation<Foreman | null>;
    roles: Relation<PersonRole[]>;
    workAssignments: Relation<WorkAssignment[]>;
    submittedReports: Relation<DailyReport[]>;
}
export declare class PersonRole {
    personId: string;
    roleCode: string;
    administratorId: string;
    createdAt: Date;
    person: Relation<Person>;
    role: Relation<Role>;
    workAssignments: Relation<WorkAssignment[]>;
}
export declare class WorkAssignment {
    id: string;
    workId: string;
    personId: string;
    roleCode: string;
    administratorId: string;
    isPrimary: boolean;
    assignedAt: Date;
    unassignedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    work: Relation<Work>;
    person: Relation<Person>;
    personRole: Relation<PersonRole>;
}
export declare const entities: readonly [typeof Administrator, typeof Foreman, typeof Work, typeof Activity, typeof GoalRecurrence, typeof DailyGoal, typeof DailyReport, typeof DailyReportItem, typeof ReportPhoto, typeof ReportCorrection, typeof Role, typeof Person, typeof PersonRole, typeof WorkAssignment];
