var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryColumn, Unique, } from 'typeorm';
const UNIT_CHECK = `unit IN ('UNIDADES','METROS','METROS_CUADRADOS','METROS_CUBICOS','KILOGRAMOS','HORAS','PORCENTAJE','OTRA')`;
const CUSTOM_UNIT_CHECK = `(unit = 'OTRA' AND custom_unit IS NOT NULL AND length(btrim(custom_unit)) > 0) OR (unit <> 'OTRA' AND custom_unit IS NULL)`;
const CUSTOM_QUANTITY_CHECK = `(quantity_step IS NULL AND quantity_decimals IS NULL) OR (unit = 'OTRA' AND quantity_step IS NOT NULL AND quantity_decimals IS NOT NULL AND quantity_step > 0 AND quantity_decimals BETWEEN 0 AND 3 AND quantity_step * power(10, quantity_decimals) = trunc(quantity_step * power(10, quantity_decimals)))`;
let Administrator = class Administrator {
    id;
    email;
    passwordHash;
    fullName;
    isActive;
    createdAt;
    updatedAt;
    foremen;
    works;
    person;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], Administrator.prototype, "id", void 0);
__decorate([
    Column('varchar', { length: 320 }),
    __metadata("design:type", String)
], Administrator.prototype, "email", void 0);
__decorate([
    Column('varchar', { name: 'password_hash', length: 255, select: false }),
    __metadata("design:type", String)
], Administrator.prototype, "passwordHash", void 0);
__decorate([
    Column('varchar', { name: 'full_name', length: 160 }),
    __metadata("design:type", String)
], Administrator.prototype, "fullName", void 0);
__decorate([
    Column('boolean', { name: 'is_active', default: true }),
    __metadata("design:type", Boolean)
], Administrator.prototype, "isActive", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Administrator.prototype, "createdAt", void 0);
__decorate([
    Column('timestamptz', { name: 'updated_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Administrator.prototype, "updatedAt", void 0);
__decorate([
    OneToMany(() => Foreman, (foreman) => foreman.administrator),
    __metadata("design:type", Object)
], Administrator.prototype, "foremen", void 0);
__decorate([
    OneToMany(() => Work, (work) => work.administrator),
    __metadata("design:type", Object)
], Administrator.prototype, "works", void 0);
__decorate([
    OneToOne(() => Person, (person) => person.administratorSource),
    __metadata("design:type", Object)
], Administrator.prototype, "person", void 0);
Administrator = __decorate([
    Entity('administrators'),
    Check('administrators_email_not_blank', `length(btrim(email)) > 0`),
    Check('administrators_name_not_blank', `length(btrim(full_name)) > 0`),
    Index('administrators_email_lower_uq', { synchronize: false })
], Administrator);
export { Administrator };
let Foreman = class Foreman {
    id;
    administratorId;
    firstName;
    lastName;
    phone;
    isActive;
    createdAt;
    updatedAt;
    administrator;
    primaryWorks;
    person;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], Foreman.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], Foreman.prototype, "administratorId", void 0);
__decorate([
    Column('varchar', { name: 'first_name', length: 100 }),
    __metadata("design:type", String)
], Foreman.prototype, "firstName", void 0);
__decorate([
    Column('varchar', { name: 'last_name', length: 100 }),
    __metadata("design:type", String)
], Foreman.prototype, "lastName", void 0);
__decorate([
    Column('varchar', { length: 40 }),
    __metadata("design:type", String)
], Foreman.prototype, "phone", void 0);
__decorate([
    Column('boolean', { name: 'is_active', default: true }),
    __metadata("design:type", Boolean)
], Foreman.prototype, "isActive", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Foreman.prototype, "createdAt", void 0);
__decorate([
    Column('timestamptz', { name: 'updated_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Foreman.prototype, "updatedAt", void 0);
__decorate([
    ManyToOne(() => Administrator, (administrator) => administrator.foremen, {
        onDelete: 'RESTRICT',
    }),
    JoinColumn({
        name: 'administrator_id',
        referencedColumnName: 'id',
        foreignKeyConstraintName: 'foremen_administrator_id_fkey',
    }),
    __metadata("design:type", Object)
], Foreman.prototype, "administrator", void 0);
__decorate([
    OneToMany(() => Work, (work) => work.primaryForeman),
    __metadata("design:type", Object)
], Foreman.prototype, "primaryWorks", void 0);
__decorate([
    OneToOne(() => Person, (person) => person.foremanSource),
    __metadata("design:type", Object)
], Foreman.prototype, "person", void 0);
Foreman = __decorate([
    Entity('foremen'),
    Unique('foremen_administrator_id_id_uq', ['administratorId', 'id']),
    Check('foremen_first_name_not_blank', `length(btrim(first_name)) > 0`),
    Check('foremen_last_name_not_blank', `length(btrim(last_name)) > 0`),
    Check('foremen_phone_not_blank', `length(btrim(phone)) > 0`),
    Index('foremen_administrator_idx', ['administratorId', 'isActive'])
], Foreman);
export { Foreman };
let Work = class Work {
    id;
    administratorId;
    foremanId;
    name;
    description;
    location;
    startDate;
    estimatedEndDate;
    status;
    timeZone;
    closeTime;
    accessCodeHash;
    accessCodeRotatedAt;
    createdAt;
    updatedAt;
    accessAlias;
    aliasPinHash;
    aliasSessionVersion;
    administrator;
    primaryForeman;
    activities;
    recurrences;
    goals;
    reports;
    assignments;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], Work.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], Work.prototype, "administratorId", void 0);
__decorate([
    Column('uuid', { name: 'foreman_id' }),
    __metadata("design:type", String)
], Work.prototype, "foremanId", void 0);
__decorate([
    Column('varchar', { length: 180 }),
    __metadata("design:type", String)
], Work.prototype, "name", void 0);
__decorate([
    Column('text', { nullable: true }),
    __metadata("design:type", Object)
], Work.prototype, "description", void 0);
__decorate([
    Column('text', { nullable: true }),
    __metadata("design:type", Object)
], Work.prototype, "location", void 0);
__decorate([
    Column('date', { name: 'start_date' }),
    __metadata("design:type", String)
], Work.prototype, "startDate", void 0);
__decorate([
    Column('date', { name: 'estimated_end_date' }),
    __metadata("design:type", String)
], Work.prototype, "estimatedEndDate", void 0);
__decorate([
    Column('varchar', { length: 12, default: 'ACTIVA' }),
    __metadata("design:type", String)
], Work.prototype, "status", void 0);
__decorate([
    Column('varchar', {
        name: 'time_zone',
        length: 100,
        default: 'America/Argentina/Cordoba',
    }),
    __metadata("design:type", String)
], Work.prototype, "timeZone", void 0);
__decorate([
    Column('time', { name: 'close_time', default: '19:00:00' }),
    __metadata("design:type", String)
], Work.prototype, "closeTime", void 0);
__decorate([
    Column('char', { name: 'access_code_hash', length: 64 }),
    __metadata("design:type", String)
], Work.prototype, "accessCodeHash", void 0);
__decorate([
    Column('timestamptz', {
        name: 'access_code_rotated_at',
        default: () => 'now()',
    }),
    __metadata("design:type", Date)
], Work.prototype, "accessCodeRotatedAt", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Work.prototype, "createdAt", void 0);
__decorate([
    Column('timestamptz', { name: 'updated_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Work.prototype, "updatedAt", void 0);
__decorate([
    Column('varchar', { name: 'access_alias', length: 40, nullable: true }),
    __metadata("design:type", Object)
], Work.prototype, "accessAlias", void 0);
__decorate([
    Column('varchar', {
        name: 'alias_pin_hash',
        length: 255,
        nullable: true,
        select: false,
    }),
    __metadata("design:type", Object)
], Work.prototype, "aliasPinHash", void 0);
__decorate([
    Column('bigint', { name: 'alias_session_version', default: 0 }),
    __metadata("design:type", String)
], Work.prototype, "aliasSessionVersion", void 0);
__decorate([
    ManyToOne(() => Administrator, (administrator) => administrator.works, {
        onDelete: 'RESTRICT',
    }),
    JoinColumn({
        name: 'administrator_id',
        referencedColumnName: 'id',
        foreignKeyConstraintName: 'works_administrator_id_fkey',
    }),
    __metadata("design:type", Object)
], Work.prototype, "administrator", void 0);
__decorate([
    ManyToOne(() => Foreman, (foreman) => foreman.primaryWorks, {
        onDelete: 'RESTRICT',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'works_administrator_foreman_fk',
        },
        { name: 'foreman_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], Work.prototype, "primaryForeman", void 0);
__decorate([
    OneToMany(() => Activity, (activity) => activity.work),
    __metadata("design:type", Object)
], Work.prototype, "activities", void 0);
__decorate([
    OneToMany(() => GoalRecurrence, (recurrence) => recurrence.work),
    __metadata("design:type", Object)
], Work.prototype, "recurrences", void 0);
__decorate([
    OneToMany(() => DailyGoal, (goal) => goal.work),
    __metadata("design:type", Object)
], Work.prototype, "goals", void 0);
__decorate([
    OneToMany(() => DailyReport, (report) => report.work),
    __metadata("design:type", Object)
], Work.prototype, "reports", void 0);
__decorate([
    OneToMany(() => WorkAssignment, (assignment) => assignment.work),
    __metadata("design:type", Object)
], Work.prototype, "assignments", void 0);
Work = __decorate([
    Entity('works'),
    Unique('works_administrator_id_id_uq', ['administratorId', 'id']),
    Check('works_access_alias_format', `access_alias IS NULL OR (length(access_alias) BETWEEN 4 AND 40 AND access_alias ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$')`),
    Check('works_access_hash_hex', `access_code_hash ~ '^[0-9a-f]{64}$'`),
    Check('works_alias_pin_hash_valid', `alias_pin_hash IS NULL OR length(alias_pin_hash) >= 50`),
    Check('works_alias_requires_pin', `(access_alias IS NULL) = (alias_pin_hash IS NULL)`),
    Check('works_alias_session_version_valid', `alias_session_version >= 0`),
    Check('works_dates_valid', `estimated_end_date >= start_date`),
    Check('works_name_not_blank', `length(btrim(name)) > 0`),
    Check('works_status_valid', `status IN ('ACTIVA','PAUSADA','FINALIZADA')`),
    Index('works_access_alias_global_uq', { synchronize: false }),
    Index('works_access_code_hash_uq', ['accessCodeHash'], { unique: true }),
    Index('works_administrator_status_idx', [
        'administratorId',
        'status',
        'estimatedEndDate',
    ]),
    Index('works_foreman_idx', ['administratorId', 'foremanId'])
], Work);
export { Work };
let Activity = class Activity {
    id;
    administratorId;
    workId;
    name;
    unit;
    customUnit;
    isActive;
    createdAt;
    updatedAt;
    quantityStep;
    quantityDecimals;
    work;
    recurrences;
    goals;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], Activity.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], Activity.prototype, "administratorId", void 0);
__decorate([
    Column('uuid', { name: 'work_id' }),
    __metadata("design:type", String)
], Activity.prototype, "workId", void 0);
__decorate([
    Column('varchar', { length: 200 }),
    __metadata("design:type", String)
], Activity.prototype, "name", void 0);
__decorate([
    Column('varchar', { length: 20 }),
    __metadata("design:type", String)
], Activity.prototype, "unit", void 0);
__decorate([
    Column('varchar', { name: 'custom_unit', length: 60, nullable: true }),
    __metadata("design:type", Object)
], Activity.prototype, "customUnit", void 0);
__decorate([
    Column('boolean', { name: 'is_active', default: true }),
    __metadata("design:type", Boolean)
], Activity.prototype, "isActive", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Activity.prototype, "createdAt", void 0);
__decorate([
    Column('timestamptz', { name: 'updated_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Activity.prototype, "updatedAt", void 0);
__decorate([
    Column('numeric', {
        name: 'quantity_step',
        precision: 14,
        scale: 3,
        nullable: true,
    }),
    __metadata("design:type", Object)
], Activity.prototype, "quantityStep", void 0);
__decorate([
    Column('smallint', { name: 'quantity_decimals', nullable: true }),
    __metadata("design:type", Object)
], Activity.prototype, "quantityDecimals", void 0);
__decorate([
    ManyToOne(() => Work, (work) => work.activities, { onDelete: 'RESTRICT' }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'activities_work_fk',
        },
        { name: 'work_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], Activity.prototype, "work", void 0);
__decorate([
    OneToMany(() => GoalRecurrence, (recurrence) => recurrence.activity),
    __metadata("design:type", Object)
], Activity.prototype, "recurrences", void 0);
__decorate([
    OneToMany(() => DailyGoal, (goal) => goal.activity),
    __metadata("design:type", Object)
], Activity.prototype, "goals", void 0);
Activity = __decorate([
    Entity('activities'),
    Unique('activities_work_id_id_uq', ['administratorId', 'workId', 'id']),
    Check('activities_name_not_blank', `length(btrim(name)) > 0`),
    Check('activities_unit_valid', UNIT_CHECK),
    Check('activities_custom_unit_valid', CUSTOM_UNIT_CHECK),
    Check('activities_custom_quantity_valid', CUSTOM_QUANTITY_CHECK),
    Index('activities_work_idx', ['administratorId', 'workId', 'isActive'])
], Activity);
export { Activity };
let GoalRecurrence = class GoalRecurrence {
    id;
    administratorId;
    workId;
    activityId;
    description;
    expectedQuantity;
    startsOn;
    endsOn;
    daysMask;
    isActive;
    createdAt;
    updatedAt;
    work;
    activity;
    goals;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], GoalRecurrence.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], GoalRecurrence.prototype, "administratorId", void 0);
__decorate([
    Column('uuid', { name: 'work_id' }),
    __metadata("design:type", String)
], GoalRecurrence.prototype, "workId", void 0);
__decorate([
    Column('uuid', { name: 'activity_id' }),
    __metadata("design:type", String)
], GoalRecurrence.prototype, "activityId", void 0);
__decorate([
    Column('varchar', { length: 200 }),
    __metadata("design:type", String)
], GoalRecurrence.prototype, "description", void 0);
__decorate([
    Column('numeric', { name: 'expected_quantity', precision: 14, scale: 3 }),
    __metadata("design:type", String)
], GoalRecurrence.prototype, "expectedQuantity", void 0);
__decorate([
    Column('date', { name: 'starts_on' }),
    __metadata("design:type", String)
], GoalRecurrence.prototype, "startsOn", void 0);
__decorate([
    Column('date', { name: 'ends_on' }),
    __metadata("design:type", String)
], GoalRecurrence.prototype, "endsOn", void 0);
__decorate([
    Column('smallint', { name: 'days_mask' }),
    __metadata("design:type", Number)
], GoalRecurrence.prototype, "daysMask", void 0);
__decorate([
    Column('boolean', { name: 'is_active', default: true }),
    __metadata("design:type", Boolean)
], GoalRecurrence.prototype, "isActive", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], GoalRecurrence.prototype, "createdAt", void 0);
__decorate([
    Column('timestamptz', { name: 'updated_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], GoalRecurrence.prototype, "updatedAt", void 0);
__decorate([
    ManyToOne(() => Work, (work) => work.recurrences, {
        onDelete: 'RESTRICT',
        createForeignKeyConstraints: false,
    }),
    JoinColumn([
        { name: 'administrator_id', referencedColumnName: 'administratorId' },
        { name: 'work_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], GoalRecurrence.prototype, "work", void 0);
__decorate([
    ManyToOne(() => Activity, (activity) => activity.recurrences, {
        onDelete: 'RESTRICT',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'goal_recurrences_activity_fk',
        },
        { name: 'work_id', referencedColumnName: 'workId' },
        { name: 'activity_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], GoalRecurrence.prototype, "activity", void 0);
__decorate([
    OneToMany(() => DailyGoal, (goal) => goal.recurrence),
    __metadata("design:type", Object)
], GoalRecurrence.prototype, "goals", void 0);
GoalRecurrence = __decorate([
    Entity('goal_recurrences'),
    Unique('goal_recurrences_work_id_id_uq', ['administratorId', 'workId', 'id']),
    Check('goal_recurrences_dates_valid', `ends_on >= starts_on`),
    Check('goal_recurrences_days_mask_valid', `days_mask BETWEEN 1 AND 127`),
    Check('goal_recurrences_description_not_blank', `length(btrim(description)) > 0`),
    Check('goal_recurrences_quantity_positive', `expected_quantity > 0`),
    Index('goal_recurrences_work_dates_idx', ['administratorId', 'workId', 'startsOn', 'endsOn'], { where: 'is_active' })
], GoalRecurrence);
export { GoalRecurrence };
let DailyGoal = class DailyGoal {
    id;
    administratorId;
    workId;
    activityId;
    recurrenceId;
    workDate;
    description;
    expectedQuantity;
    unit;
    customUnit;
    isActive;
    createdAt;
    updatedAt;
    quantityStep;
    quantityDecimals;
    work;
    activity;
    recurrence;
    reportItems;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], DailyGoal.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], DailyGoal.prototype, "administratorId", void 0);
__decorate([
    Column('uuid', { name: 'work_id' }),
    __metadata("design:type", String)
], DailyGoal.prototype, "workId", void 0);
__decorate([
    Column('uuid', { name: 'activity_id' }),
    __metadata("design:type", String)
], DailyGoal.prototype, "activityId", void 0);
__decorate([
    Column('uuid', { name: 'recurrence_id', nullable: true }),
    __metadata("design:type", Object)
], DailyGoal.prototype, "recurrenceId", void 0);
__decorate([
    Column('date', { name: 'work_date' }),
    __metadata("design:type", String)
], DailyGoal.prototype, "workDate", void 0);
__decorate([
    Column('varchar', { length: 200 }),
    __metadata("design:type", String)
], DailyGoal.prototype, "description", void 0);
__decorate([
    Column('numeric', { name: 'expected_quantity', precision: 14, scale: 3 }),
    __metadata("design:type", String)
], DailyGoal.prototype, "expectedQuantity", void 0);
__decorate([
    Column('varchar', { length: 20 }),
    __metadata("design:type", String)
], DailyGoal.prototype, "unit", void 0);
__decorate([
    Column('varchar', { name: 'custom_unit', length: 60, nullable: true }),
    __metadata("design:type", Object)
], DailyGoal.prototype, "customUnit", void 0);
__decorate([
    Column('boolean', { name: 'is_active', default: true }),
    __metadata("design:type", Boolean)
], DailyGoal.prototype, "isActive", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], DailyGoal.prototype, "createdAt", void 0);
__decorate([
    Column('timestamptz', { name: 'updated_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], DailyGoal.prototype, "updatedAt", void 0);
__decorate([
    Column('numeric', {
        name: 'quantity_step',
        precision: 14,
        scale: 3,
        nullable: true,
    }),
    __metadata("design:type", Object)
], DailyGoal.prototype, "quantityStep", void 0);
__decorate([
    Column('smallint', { name: 'quantity_decimals', nullable: true }),
    __metadata("design:type", Object)
], DailyGoal.prototype, "quantityDecimals", void 0);
__decorate([
    ManyToOne(() => Work, (work) => work.goals, {
        onDelete: 'RESTRICT',
        createForeignKeyConstraints: false,
    }),
    JoinColumn([
        { name: 'administrator_id', referencedColumnName: 'administratorId' },
        { name: 'work_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], DailyGoal.prototype, "work", void 0);
__decorate([
    ManyToOne(() => Activity, (activity) => activity.goals, {
        onDelete: 'RESTRICT',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'daily_goals_activity_fk',
        },
        { name: 'work_id', referencedColumnName: 'workId' },
        { name: 'activity_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], DailyGoal.prototype, "activity", void 0);
__decorate([
    ManyToOne(() => GoalRecurrence, (recurrence) => recurrence.goals, {
        nullable: true,
        onDelete: 'RESTRICT',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'daily_goals_recurrence_fk',
        },
        { name: 'work_id', referencedColumnName: 'workId' },
        { name: 'recurrence_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], DailyGoal.prototype, "recurrence", void 0);
__decorate([
    OneToMany(() => DailyReportItem, (item) => item.goal),
    __metadata("design:type", Object)
], DailyGoal.prototype, "reportItems", void 0);
DailyGoal = __decorate([
    Entity('daily_goals'),
    Unique('daily_goals_work_id_id_uq', ['administratorId', 'workId', 'id']),
    Unique('daily_goals_report_identity_uq', [
        'administratorId',
        'workId',
        'id',
        'workDate',
        'activityId',
    ]),
    Check('daily_goals_description_not_blank', `length(btrim(description)) > 0`),
    Check('daily_goals_quantity_positive', `expected_quantity > 0`),
    Check('daily_goals_unit_valid', UNIT_CHECK),
    Check('daily_goals_custom_unit_valid', CUSTOM_UNIT_CHECK),
    Check('daily_goals_custom_quantity_valid', CUSTOM_QUANTITY_CHECK),
    Index('daily_goals_recurrence_date_uq', ['recurrenceId', 'workDate'], {
        unique: true,
        where: 'recurrence_id IS NOT NULL',
    }),
    Index('daily_goals_work_date_idx', [
        'administratorId',
        'workId',
        'workDate',
        'isActive',
    ])
], DailyGoal);
export { DailyGoal };
let DailyReport = class DailyReport {
    id;
    administratorId;
    workId;
    workDate;
    foremanId;
    foremanNameSnapshot;
    submittedByPersonId;
    observations;
    submittedAt;
    createdAt;
    updatedAt;
    work;
    foreman;
    submittedByPerson;
    items;
    photos;
    corrections;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], DailyReport.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], DailyReport.prototype, "administratorId", void 0);
__decorate([
    Column('uuid', { name: 'work_id' }),
    __metadata("design:type", String)
], DailyReport.prototype, "workId", void 0);
__decorate([
    Column('date', { name: 'work_date' }),
    __metadata("design:type", String)
], DailyReport.prototype, "workDate", void 0);
__decorate([
    Column('uuid', { name: 'foreman_id' }),
    __metadata("design:type", String)
], DailyReport.prototype, "foremanId", void 0);
__decorate([
    Column('varchar', { name: 'foreman_name_snapshot', length: 201 }),
    __metadata("design:type", String)
], DailyReport.prototype, "foremanNameSnapshot", void 0);
__decorate([
    Column('uuid', { name: 'submitted_by_person_id', nullable: true }),
    __metadata("design:type", Object)
], DailyReport.prototype, "submittedByPersonId", void 0);
__decorate([
    Column('text', { nullable: true }),
    __metadata("design:type", Object)
], DailyReport.prototype, "observations", void 0);
__decorate([
    Column('timestamptz', { name: 'submitted_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], DailyReport.prototype, "submittedAt", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], DailyReport.prototype, "createdAt", void 0);
__decorate([
    Column('timestamptz', { name: 'updated_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], DailyReport.prototype, "updatedAt", void 0);
__decorate([
    ManyToOne(() => Work, (work) => work.reports, { onDelete: 'RESTRICT' }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'daily_reports_work_fk',
        },
        { name: 'work_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], DailyReport.prototype, "work", void 0);
__decorate([
    ManyToOne(() => Foreman, { onDelete: 'RESTRICT' }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'daily_reports_foreman_fk',
        },
        { name: 'foreman_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], DailyReport.prototype, "foreman", void 0);
__decorate([
    ManyToOne(() => Person, (person) => person.submittedReports, {
        nullable: true,
        onDelete: 'RESTRICT',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'daily_reports_submitted_by_person_fk',
        },
        { name: 'submitted_by_person_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], DailyReport.prototype, "submittedByPerson", void 0);
__decorate([
    OneToMany(() => DailyReportItem, (item) => item.report),
    __metadata("design:type", Object)
], DailyReport.prototype, "items", void 0);
__decorate([
    OneToMany(() => ReportPhoto, (photo) => photo.report),
    __metadata("design:type", Object)
], DailyReport.prototype, "photos", void 0);
__decorate([
    OneToMany(() => ReportCorrection, (correction) => correction.report),
    __metadata("design:type", Object)
], DailyReport.prototype, "corrections", void 0);
DailyReport = __decorate([
    Entity('daily_reports'),
    Unique('daily_reports_administrator_work_id_uq', [
        'administratorId',
        'workId',
        'id',
    ]),
    Unique('daily_reports_item_identity_uq', [
        'administratorId',
        'workId',
        'id',
        'workDate',
    ]),
    Unique('daily_reports_work_date_uq', ['workId', 'workDate']),
    Index('daily_reports_work_date_idx', () => ({
        administratorId: 1,
        workId: 1,
        workDate: -1,
    })),
    Index('daily_reports_submitted_by_person_idx', ['administratorId', 'submittedByPersonId'], { where: 'submitted_by_person_id IS NOT NULL' })
], DailyReport);
export { DailyReport };
let DailyReportItem = class DailyReportItem {
    id;
    administratorId;
    workId;
    reportId;
    workDate;
    goalId;
    activityId;
    descriptionSnapshot;
    expectedQuantitySnapshot;
    unitSnapshot;
    customUnitSnapshot;
    actualQuantity;
    createdAt;
    updatedAt;
    quantityStepSnapshot;
    quantityDecimalsSnapshot;
    report;
    goal;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], DailyReportItem.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], DailyReportItem.prototype, "administratorId", void 0);
__decorate([
    Column('uuid', { name: 'work_id' }),
    __metadata("design:type", String)
], DailyReportItem.prototype, "workId", void 0);
__decorate([
    Column('uuid', { name: 'report_id' }),
    __metadata("design:type", String)
], DailyReportItem.prototype, "reportId", void 0);
__decorate([
    Column('date', { name: 'work_date' }),
    __metadata("design:type", String)
], DailyReportItem.prototype, "workDate", void 0);
__decorate([
    Column('uuid', { name: 'goal_id' }),
    __metadata("design:type", String)
], DailyReportItem.prototype, "goalId", void 0);
__decorate([
    Column('uuid', { name: 'activity_id' }),
    __metadata("design:type", String)
], DailyReportItem.prototype, "activityId", void 0);
__decorate([
    Column('varchar', { name: 'description_snapshot', length: 200 }),
    __metadata("design:type", String)
], DailyReportItem.prototype, "descriptionSnapshot", void 0);
__decorate([
    Column('numeric', {
        name: 'expected_quantity_snapshot',
        precision: 14,
        scale: 3,
    }),
    __metadata("design:type", String)
], DailyReportItem.prototype, "expectedQuantitySnapshot", void 0);
__decorate([
    Column('varchar', { name: 'unit_snapshot', length: 20 }),
    __metadata("design:type", String)
], DailyReportItem.prototype, "unitSnapshot", void 0);
__decorate([
    Column('varchar', {
        name: 'custom_unit_snapshot',
        length: 60,
        nullable: true,
    }),
    __metadata("design:type", Object)
], DailyReportItem.prototype, "customUnitSnapshot", void 0);
__decorate([
    Column('numeric', { name: 'actual_quantity', precision: 14, scale: 3 }),
    __metadata("design:type", String)
], DailyReportItem.prototype, "actualQuantity", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], DailyReportItem.prototype, "createdAt", void 0);
__decorate([
    Column('timestamptz', { name: 'updated_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], DailyReportItem.prototype, "updatedAt", void 0);
__decorate([
    Column('numeric', {
        name: 'quantity_step_snapshot',
        precision: 14,
        scale: 3,
        nullable: true,
    }),
    __metadata("design:type", Object)
], DailyReportItem.prototype, "quantityStepSnapshot", void 0);
__decorate([
    Column('smallint', { name: 'quantity_decimals_snapshot', nullable: true }),
    __metadata("design:type", Object)
], DailyReportItem.prototype, "quantityDecimalsSnapshot", void 0);
__decorate([
    ManyToOne(() => DailyReport, (report) => report.items, {
        onDelete: 'CASCADE',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'daily_report_items_report_fk',
        },
        { name: 'work_id', referencedColumnName: 'workId' },
        { name: 'report_id', referencedColumnName: 'id' },
        { name: 'work_date', referencedColumnName: 'workDate' },
    ]),
    __metadata("design:type", Object)
], DailyReportItem.prototype, "report", void 0);
__decorate([
    ManyToOne(() => DailyGoal, (goal) => goal.reportItems, {
        onDelete: 'RESTRICT',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'daily_report_items_goal_fk',
        },
        { name: 'work_id', referencedColumnName: 'workId' },
        { name: 'goal_id', referencedColumnName: 'id' },
        { name: 'work_date', referencedColumnName: 'workDate' },
        { name: 'activity_id', referencedColumnName: 'activityId' },
    ]),
    __metadata("design:type", Object)
], DailyReportItem.prototype, "goal", void 0);
DailyReportItem = __decorate([
    Entity('daily_report_items'),
    Unique('daily_report_items_goal_per_report_uq', ['reportId', 'goalId']),
    Check('daily_report_items_actual_nonnegative', `actual_quantity >= 0`),
    Check('daily_report_items_expected_positive', `expected_quantity_snapshot > 0`),
    Check('daily_report_items_custom_quantity_valid', `(quantity_step_snapshot IS NULL AND quantity_decimals_snapshot IS NULL) OR (unit_snapshot = 'OTRA' AND quantity_step_snapshot IS NOT NULL AND quantity_decimals_snapshot IS NOT NULL AND quantity_step_snapshot > 0 AND quantity_decimals_snapshot BETWEEN 0 AND 3 AND quantity_step_snapshot * power(10, quantity_decimals_snapshot) = trunc(quantity_step_snapshot * power(10, quantity_decimals_snapshot)))`),
    Index('daily_report_items_activity_idx', [
        'administratorId',
        'workId',
        'activityId',
    ]),
    Index('daily_report_items_report_idx', ['reportId'])
], DailyReportItem);
export { DailyReportItem };
let ReportPhoto = class ReportPhoto {
    id;
    administratorId;
    workId;
    reportId;
    storageKey;
    mimeType;
    byteSize;
    width;
    height;
    createdAt;
    report;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], ReportPhoto.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], ReportPhoto.prototype, "administratorId", void 0);
__decorate([
    Column('uuid', { name: 'work_id' }),
    __metadata("design:type", String)
], ReportPhoto.prototype, "workId", void 0);
__decorate([
    Column('uuid', { name: 'report_id' }),
    __metadata("design:type", String)
], ReportPhoto.prototype, "reportId", void 0);
__decorate([
    Column('varchar', { name: 'storage_key', length: 500 }),
    __metadata("design:type", String)
], ReportPhoto.prototype, "storageKey", void 0);
__decorate([
    Column('varchar', { name: 'mime_type', length: 30 }),
    __metadata("design:type", String)
], ReportPhoto.prototype, "mimeType", void 0);
__decorate([
    Column('integer', { name: 'byte_size' }),
    __metadata("design:type", Number)
], ReportPhoto.prototype, "byteSize", void 0);
__decorate([
    Column('integer'),
    __metadata("design:type", Number)
], ReportPhoto.prototype, "width", void 0);
__decorate([
    Column('integer'),
    __metadata("design:type", Number)
], ReportPhoto.prototype, "height", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], ReportPhoto.prototype, "createdAt", void 0);
__decorate([
    ManyToOne(() => DailyReport, (report) => report.photos, {
        onDelete: 'CASCADE',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'report_photos_report_fk',
        },
        { name: 'work_id', referencedColumnName: 'workId' },
        { name: 'report_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], ReportPhoto.prototype, "report", void 0);
ReportPhoto = __decorate([
    Entity('report_photos'),
    Unique('report_photos_storage_key_uq', ['storageKey']),
    Check('report_photos_byte_size_positive', `byte_size > 0`),
    Check('report_photos_dimensions_positive', `width > 0 AND height > 0`),
    Check('report_photos_mime_valid', `mime_type IN ('image/jpeg','image/png','image/webp')`),
    Index('report_photos_report_idx', ['reportId'])
], ReportPhoto);
export { ReportPhoto };
let ReportCorrection = class ReportCorrection {
    id;
    administratorId;
    workId;
    reportId;
    correctedByAdministratorId;
    beforeValue;
    afterValue;
    reason;
    createdAt;
    report;
    administrator;
    correctedBy;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], ReportCorrection.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], ReportCorrection.prototype, "administratorId", void 0);
__decorate([
    Column('uuid', { name: 'work_id' }),
    __metadata("design:type", String)
], ReportCorrection.prototype, "workId", void 0);
__decorate([
    Column('uuid', { name: 'report_id' }),
    __metadata("design:type", String)
], ReportCorrection.prototype, "reportId", void 0);
__decorate([
    Column('uuid', { name: 'corrected_by_administrator_id' }),
    __metadata("design:type", String)
], ReportCorrection.prototype, "correctedByAdministratorId", void 0);
__decorate([
    Column('jsonb', { name: 'before_value' }),
    __metadata("design:type", Object)
], ReportCorrection.prototype, "beforeValue", void 0);
__decorate([
    Column('jsonb', { name: 'after_value' }),
    __metadata("design:type", Object)
], ReportCorrection.prototype, "afterValue", void 0);
__decorate([
    Column('text', { nullable: true }),
    __metadata("design:type", Object)
], ReportCorrection.prototype, "reason", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], ReportCorrection.prototype, "createdAt", void 0);
__decorate([
    ManyToOne(() => DailyReport, (report) => report.corrections, {
        onDelete: 'RESTRICT',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'report_corrections_report_fk',
        },
        { name: 'work_id', referencedColumnName: 'workId' },
        { name: 'report_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], ReportCorrection.prototype, "report", void 0);
__decorate([
    ManyToOne(() => Administrator, { onDelete: 'RESTRICT' }),
    JoinColumn({
        name: 'administrator_id',
        referencedColumnName: 'id',
        foreignKeyConstraintName: 'report_corrections_administrator_id_fkey',
    }),
    __metadata("design:type", Object)
], ReportCorrection.prototype, "administrator", void 0);
__decorate([
    ManyToOne(() => Administrator, { onDelete: 'RESTRICT' }),
    JoinColumn({
        name: 'corrected_by_administrator_id',
        referencedColumnName: 'id',
        foreignKeyConstraintName: 'report_corrections_corrected_by_administrator_id_fkey',
    }),
    __metadata("design:type", Object)
], ReportCorrection.prototype, "correctedBy", void 0);
ReportCorrection = __decorate([
    Entity('report_corrections'),
    Check('report_corrections_changed', `before_value IS DISTINCT FROM after_value`),
    Check('report_corrections_same_administrator', `administrator_id = corrected_by_administrator_id`),
    Index('report_corrections_report_date_idx', () => ({
        reportId: 1,
        createdAt: -1,
    }))
], ReportCorrection);
export { ReportCorrection };
let Role = class Role {
    code;
    name;
    createdAt;
    people;
};
__decorate([
    PrimaryColumn('varchar', { length: 40 }),
    __metadata("design:type", String)
], Role.prototype, "code", void 0);
__decorate([
    Column('varchar', { length: 100 }),
    __metadata("design:type", String)
], Role.prototype, "name", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Role.prototype, "createdAt", void 0);
__decorate([
    OneToMany(() => PersonRole, (assignment) => assignment.role),
    __metadata("design:type", Object)
], Role.prototype, "people", void 0);
Role = __decorate([
    Entity('roles'),
    Check('roles_code_valid', `code IN ('ADMINISTRATOR','SITE_MANAGER','FOREMAN')`),
    Check('roles_name_not_blank', `length(btrim(name)) > 0`)
], Role);
export { Role };
let Person = class Person {
    id;
    administratorId;
    administratorSourceId;
    foremanSourceId;
    fullName;
    email;
    passwordHash;
    isActive;
    pinHash;
    pinLookupHmac;
    sessionVersion;
    failedAttempts;
    lockedUntil;
    lastAccessAt;
    createdAt;
    updatedAt;
    administrator;
    administratorSource;
    foremanSource;
    roles;
    workAssignments;
    submittedReports;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], Person.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], Person.prototype, "administratorId", void 0);
__decorate([
    Column('uuid', { name: 'administrator_source_id', nullable: true }),
    __metadata("design:type", Object)
], Person.prototype, "administratorSourceId", void 0);
__decorate([
    Column('uuid', { name: 'foreman_source_id', nullable: true }),
    __metadata("design:type", Object)
], Person.prototype, "foremanSourceId", void 0);
__decorate([
    Column('varchar', { name: 'full_name', length: 201 }),
    __metadata("design:type", String)
], Person.prototype, "fullName", void 0);
__decorate([
    Column('varchar', { length: 320, nullable: true }),
    __metadata("design:type", Object)
], Person.prototype, "email", void 0);
__decorate([
    Column('varchar', { name: 'password_hash', length: 255, nullable: true, select: false }),
    __metadata("design:type", Object)
], Person.prototype, "passwordHash", void 0);
__decorate([
    Column('boolean', { name: 'is_active', default: true }),
    __metadata("design:type", Boolean)
], Person.prototype, "isActive", void 0);
__decorate([
    Column('varchar', {
        name: 'pin_hash',
        length: 255,
        nullable: true,
        select: false,
    }),
    __metadata("design:type", Object)
], Person.prototype, "pinHash", void 0);
__decorate([
    Column('char', {
        name: 'pin_lookup_hmac',
        length: 64,
        nullable: true,
        select: false,
    }),
    __metadata("design:type", Object)
], Person.prototype, "pinLookupHmac", void 0);
__decorate([
    Column('bigint', { name: 'session_version', default: 0 }),
    __metadata("design:type", String)
], Person.prototype, "sessionVersion", void 0);
__decorate([
    Column('integer', { name: 'failed_attempts', default: 0 }),
    __metadata("design:type", Number)
], Person.prototype, "failedAttempts", void 0);
__decorate([
    Column('timestamptz', { name: 'locked_until', nullable: true }),
    __metadata("design:type", Object)
], Person.prototype, "lockedUntil", void 0);
__decorate([
    Column('timestamptz', { name: 'last_access_at', nullable: true }),
    __metadata("design:type", Object)
], Person.prototype, "lastAccessAt", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Person.prototype, "createdAt", void 0);
__decorate([
    Column('timestamptz', { name: 'updated_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], Person.prototype, "updatedAt", void 0);
__decorate([
    ManyToOne(() => Administrator, { onDelete: 'RESTRICT' }),
    JoinColumn({
        name: 'administrator_id',
        referencedColumnName: 'id',
        foreignKeyConstraintName: 'people_administrator_fk',
    }),
    __metadata("design:type", Object)
], Person.prototype, "administrator", void 0);
__decorate([
    OneToOne(() => Administrator, (administrator) => administrator.person, {
        nullable: true,
        onDelete: 'RESTRICT',
    }),
    JoinColumn({
        name: 'administrator_source_id',
        referencedColumnName: 'id',
        foreignKeyConstraintName: 'people_administrator_source_fk',
    }),
    __metadata("design:type", Object)
], Person.prototype, "administratorSource", void 0);
__decorate([
    ManyToOne(() => Foreman, (foreman) => foreman.person, {
        nullable: true,
        onDelete: 'RESTRICT',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'people_foreman_source_fk',
        },
        { name: 'foreman_source_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], Person.prototype, "foremanSource", void 0);
__decorate([
    OneToMany(() => PersonRole, (assignment) => assignment.person),
    __metadata("design:type", Object)
], Person.prototype, "roles", void 0);
__decorate([
    OneToMany(() => WorkAssignment, (assignment) => assignment.person),
    __metadata("design:type", Object)
], Person.prototype, "workAssignments", void 0);
__decorate([
    OneToMany(() => DailyReport, (report) => report.submittedByPerson),
    __metadata("design:type", Object)
], Person.prototype, "submittedReports", void 0);
Person = __decorate([
    Entity('people'),
    Unique('people_administrator_id_id_uq', ['administratorId', 'id']),
    Unique('people_administrator_source_uq', ['administratorSourceId']),
    Unique('people_foreman_source_uq', ['foremanSourceId']),
    Check('people_name_not_blank', `length(btrim(full_name)) > 0`),
    Check('people_credentials_complete', `(email IS NULL) = (password_hash IS NULL)`),
    Check('people_email_not_blank', `email IS NULL OR length(btrim(email)) > 0`),
    Check('people_source_valid', `NOT (administrator_source_id IS NOT NULL AND foreman_source_id IS NOT NULL)`),
    Check('people_administrator_source_owner', `administrator_source_id IS NULL OR administrator_source_id = administrator_id`),
    Check('people_pin_credentials_complete', `(pin_hash IS NULL) = (pin_lookup_hmac IS NULL)`),
    Check('people_pin_hash_valid', `pin_hash IS NULL OR length(pin_hash) >= 50`),
    Check('people_pin_lookup_hmac_valid', `pin_lookup_hmac IS NULL OR pin_lookup_hmac ~ '^[0-9a-f]{64}$'`),
    Check('people_session_version_valid', `session_version >= 0`),
    Check('people_failed_attempts_valid', `failed_attempts >= 0`),
    Index('people_administrator_active_idx', ['administratorId', 'isActive']),
    Index('people_email_lower_uq', { synchronize: false }),
    Index('people_pin_lookup_hmac_uq', ['pinLookupHmac'], {
        unique: true,
        where: 'pin_lookup_hmac IS NOT NULL',
    })
], Person);
export { Person };
let PersonRole = class PersonRole {
    personId;
    roleCode;
    administratorId;
    createdAt;
    person;
    role;
    workAssignments;
};
__decorate([
    PrimaryColumn('uuid', { name: 'person_id' }),
    __metadata("design:type", String)
], PersonRole.prototype, "personId", void 0);
__decorate([
    PrimaryColumn('varchar', { name: 'role_code', length: 40 }),
    __metadata("design:type", String)
], PersonRole.prototype, "roleCode", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], PersonRole.prototype, "administratorId", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], PersonRole.prototype, "createdAt", void 0);
__decorate([
    ManyToOne(() => Person, (person) => person.roles, { onDelete: 'CASCADE' }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'person_roles_person_fk',
        },
        { name: 'person_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], PersonRole.prototype, "person", void 0);
__decorate([
    ManyToOne(() => Role, (role) => role.people, { onDelete: 'RESTRICT' }),
    JoinColumn({
        name: 'role_code',
        referencedColumnName: 'code',
        foreignKeyConstraintName: 'person_roles_role_fk',
    }),
    __metadata("design:type", Object)
], PersonRole.prototype, "role", void 0);
__decorate([
    OneToMany(() => WorkAssignment, (assignment) => assignment.personRole),
    __metadata("design:type", Object)
], PersonRole.prototype, "workAssignments", void 0);
PersonRole = __decorate([
    Entity('person_roles'),
    Unique('person_roles_assignment_identity_uq', [
        'administratorId',
        'personId',
        'roleCode',
    ])
], PersonRole);
export { PersonRole };
let WorkAssignment = class WorkAssignment {
    id;
    workId;
    personId;
    roleCode;
    administratorId;
    isPrimary;
    assignedAt;
    unassignedAt;
    createdAt;
    updatedAt;
    work;
    person;
    personRole;
};
__decorate([
    PrimaryColumn('uuid'),
    __metadata("design:type", String)
], WorkAssignment.prototype, "id", void 0);
__decorate([
    Column('uuid', { name: 'work_id' }),
    __metadata("design:type", String)
], WorkAssignment.prototype, "workId", void 0);
__decorate([
    Column('uuid', { name: 'person_id' }),
    __metadata("design:type", String)
], WorkAssignment.prototype, "personId", void 0);
__decorate([
    Column('varchar', { name: 'role_code', length: 40 }),
    __metadata("design:type", String)
], WorkAssignment.prototype, "roleCode", void 0);
__decorate([
    Column('uuid', { name: 'administrator_id' }),
    __metadata("design:type", String)
], WorkAssignment.prototype, "administratorId", void 0);
__decorate([
    Column('boolean', { name: 'is_primary', default: false }),
    __metadata("design:type", Boolean)
], WorkAssignment.prototype, "isPrimary", void 0);
__decorate([
    Column('timestamptz', { name: 'assigned_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], WorkAssignment.prototype, "assignedAt", void 0);
__decorate([
    Column('timestamptz', { name: 'unassigned_at', nullable: true }),
    __metadata("design:type", Object)
], WorkAssignment.prototype, "unassignedAt", void 0);
__decorate([
    Column('timestamptz', { name: 'created_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], WorkAssignment.prototype, "createdAt", void 0);
__decorate([
    Column('timestamptz', { name: 'updated_at', default: () => 'now()' }),
    __metadata("design:type", Date)
], WorkAssignment.prototype, "updatedAt", void 0);
__decorate([
    ManyToOne(() => Work, (work) => work.assignments, {
        onDelete: 'CASCADE',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'work_assignments_work_fk',
        },
        { name: 'work_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], WorkAssignment.prototype, "work", void 0);
__decorate([
    ManyToOne(() => Person, (person) => person.workAssignments, {
        createForeignKeyConstraints: false,
    }),
    JoinColumn([
        { name: 'administrator_id', referencedColumnName: 'administratorId' },
        { name: 'person_id', referencedColumnName: 'id' },
    ]),
    __metadata("design:type", Object)
], WorkAssignment.prototype, "person", void 0);
__decorate([
    ManyToOne(() => PersonRole, (personRole) => personRole.workAssignments, {
        onDelete: 'RESTRICT',
    }),
    JoinColumn([
        {
            name: 'administrator_id',
            referencedColumnName: 'administratorId',
            foreignKeyConstraintName: 'work_assignments_person_role_fk',
        },
        { name: 'person_id', referencedColumnName: 'personId' },
        { name: 'role_code', referencedColumnName: 'roleCode' },
    ]),
    __metadata("design:type", Object)
], WorkAssignment.prototype, "personRole", void 0);
WorkAssignment = __decorate([
    Entity('work_assignments'),
    Check('work_assignments_dates_valid', `unassigned_at IS NULL OR unassigned_at >= assigned_at`),
    Check('work_assignments_role_valid', `role_code IN ('SITE_MANAGER','FOREMAN')`),
    Index('work_assignments_active_idx', ['administratorId', 'personId', 'roleCode', 'workId'], { where: 'unassigned_at IS NULL' }),
    Index('work_assignments_active_uq', ['workId', 'personId', 'roleCode'], {
        unique: true,
        where: 'unassigned_at IS NULL',
    }),
    Index('work_assignments_primary_uq', ['workId', 'roleCode'], {
        unique: true,
        where: 'is_primary AND unassigned_at IS NULL',
    })
], WorkAssignment);
export { WorkAssignment };
export const entities = [
    Administrator,
    Foreman,
    Work,
    Activity,
    GoalRecurrence,
    DailyGoal,
    DailyReport,
    DailyReportItem,
    ReportPhoto,
    ReportCorrection,
    Role,
    Person,
    PersonRole,
    WorkAssignment,
];
//# sourceMappingURL=entities.js.map