import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  Unique,
  type Relation,
} from 'typeorm';

export type Numeric = string;
export type CalendarDate = string;

const UNIT_CHECK = `unit IN ('UNIDADES','METROS','METROS_CUADRADOS','METROS_CUBICOS','KILOGRAMOS','HORAS','PORCENTAJE','OTRA')`;
const CUSTOM_UNIT_CHECK = `(unit = 'OTRA' AND custom_unit IS NOT NULL AND length(btrim(custom_unit)) > 0) OR (unit <> 'OTRA' AND custom_unit IS NULL)`;
const CUSTOM_QUANTITY_CHECK = `(quantity_step IS NULL AND quantity_decimals IS NULL) OR (unit = 'OTRA' AND quantity_step IS NOT NULL AND quantity_decimals IS NOT NULL AND quantity_step > 0 AND quantity_decimals BETWEEN 0 AND 3 AND quantity_step * power(10, quantity_decimals) = trunc(quantity_step * power(10, quantity_decimals)))`;

@Entity('administrators')
@Check('administrators_email_not_blank', `length(btrim(email)) > 0`)
@Check('administrators_name_not_blank', `length(btrim(full_name)) > 0`)
@Index('administrators_email_lower_uq', { synchronize: false })
export class Administrator {
  @PrimaryColumn('uuid') id!: string;
  @Column('varchar', { length: 320 }) email!: string;
  @Column('varchar', { name: 'password_hash', length: 255, select: false })
  passwordHash!: string;
  @Column('varchar', { name: 'full_name', length: 160 }) fullName!: string;
  @Column('boolean', { name: 'is_active', default: true }) isActive!: boolean;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;

  @OneToMany(() => Foreman, (foreman) => foreman.administrator)
  foremen!: Relation<Foreman[]>;
  @OneToMany(() => Work, (work) => work.administrator) works!: Relation<Work[]>;
  @OneToOne(() => Person, (person) => person.administratorSource)
  person!: Relation<Person | null>;
}

@Entity('foremen')
@Unique('foremen_administrator_id_id_uq', ['administratorId', 'id'])
@Check('foremen_first_name_not_blank', `length(btrim(first_name)) > 0`)
@Check('foremen_last_name_not_blank', `length(btrim(last_name)) > 0`)
@Check('foremen_phone_not_blank', `length(btrim(phone)) > 0`)
@Index('foremen_administrator_idx', ['administratorId', 'isActive'])
export class Foreman {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('varchar', { name: 'first_name', length: 100 }) firstName!: string;
  @Column('varchar', { name: 'last_name', length: 100 }) lastName!: string;
  @Column('varchar', { length: 40 }) phone!: string;
  @Column('boolean', { name: 'is_active', default: true }) isActive!: boolean;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;

  @ManyToOne(() => Administrator, (administrator) => administrator.foremen, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'administrator_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'foremen_administrator_id_fkey',
  })
  administrator!: Relation<Administrator>;
  @OneToMany(() => Work, (work) => work.primaryForeman) primaryWorks!: Relation<
    Work[]
  >;
  @OneToOne(() => Person, (person) => person.foremanSource)
  person!: Relation<Person | null>;
}

@Entity('works')
@Unique('works_administrator_id_id_uq', ['administratorId', 'id'])
@Check(
  'works_access_alias_format',
  `access_alias IS NULL OR (length(access_alias) BETWEEN 4 AND 40 AND access_alias ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$')`,
)
@Check('works_access_hash_hex', `access_code_hash ~ '^[0-9a-f]{64}$'`)
@Check(
  'works_alias_pin_hash_valid',
  `alias_pin_hash IS NULL OR length(alias_pin_hash) >= 50`,
)
@Check(
  'works_alias_requires_pin',
  `(access_alias IS NULL) = (alias_pin_hash IS NULL)`,
)
@Check('works_alias_session_version_valid', `alias_session_version >= 0`)
@Check('works_dates_valid', `estimated_end_date >= start_date`)
@Check('works_name_not_blank', `length(btrim(name)) > 0`)
@Check('works_status_valid', `status IN ('ACTIVA','PAUSADA','FINALIZADA')`)
@Check('works_pause_reason_valid', `status <> 'PAUSADA' OR (pause_reason IS NOT NULL AND length(btrim(pause_reason)) > 0)`)
@Index('works_access_alias_global_uq', { synchronize: false })
@Index('works_access_code_hash_uq', ['accessCodeHash'], { unique: true })
@Index('works_administrator_status_idx', [
  'administratorId',
  'status',
  'estimatedEndDate',
])
@Index('works_foreman_idx', ['administratorId', 'foremanId'])
export class Work {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('uuid', { name: 'foreman_id' }) foremanId!: string;
  @Column('varchar', { length: 180 }) name!: string;
  @Column('text', { nullable: true }) description!: string | null;
  @Column('text', { nullable: true }) location!: string | null;
  @Column('date', { name: 'start_date' }) startDate!: CalendarDate;
  @Column('date', { name: 'estimated_end_date' })
  estimatedEndDate!: CalendarDate;
  @Column('varchar', { length: 12, default: 'ACTIVA' }) status!: string;
  @Column('text', { name: 'pause_reason', nullable: true }) pauseReason!: string | null;
  @Column('varchar', {
    name: 'time_zone',
    length: 100,
    default: 'America/Argentina/Cordoba',
  })
  timeZone!: string;
  @Column('time', { name: 'close_time', default: '19:00:00' })
  closeTime!: string;
  @Column('char', { name: 'access_code_hash', length: 64 })
  accessCodeHash!: string;
  @Column('timestamptz', {
    name: 'access_code_rotated_at',
    default: () => 'now()',
  })
  accessCodeRotatedAt!: Date;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
  @Column('varchar', { name: 'access_alias', length: 40, nullable: true })
  accessAlias!: string | null;
  @Column('varchar', {
    name: 'alias_pin_hash',
    length: 255,
    nullable: true,
    select: false,
  })
  aliasPinHash!: string | null;
  @Column('bigint', { name: 'alias_session_version', default: 0 })
  aliasSessionVersion!: string;

  @ManyToOne(() => Administrator, (administrator) => administrator.works, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'administrator_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'works_administrator_id_fkey',
  })
  administrator!: Relation<Administrator>;
  @ManyToOne(() => Foreman, (foreman) => foreman.primaryWorks, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'works_administrator_foreman_fk',
    },
    { name: 'foreman_id', referencedColumnName: 'id' },
  ])
  primaryForeman!: Relation<Foreman>;
  @OneToMany(() => Activity, (activity) => activity.work) activities!: Relation<
    Activity[]
  >;
  @OneToMany(() => GoalRecurrence, (recurrence) => recurrence.work)
  recurrences!: Relation<GoalRecurrence[]>;
  @OneToMany(() => DailyGoal, (goal) => goal.work) goals!: Relation<
    DailyGoal[]
  >;
  @OneToMany(() => DailyReport, (report) => report.work) reports!: Relation<
    DailyReport[]
  >;
  @OneToMany(() => WorkAssignment, (assignment) => assignment.work)
  assignments!: Relation<WorkAssignment[]>;
}

@Entity('activities')
@Unique('activities_work_id_id_uq', ['administratorId', 'workId', 'id'])
@Check('activities_name_not_blank', `length(btrim(name)) > 0`)
@Check('activities_unit_valid', UNIT_CHECK)
@Check('activities_custom_unit_valid', CUSTOM_UNIT_CHECK)
@Check('activities_custom_quantity_valid', CUSTOM_QUANTITY_CHECK)
@Index('activities_work_idx', ['administratorId', 'workId', 'isActive'])
export class Activity {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('uuid', { name: 'work_id' }) workId!: string;
  @Column('varchar', { length: 200 }) name!: string;
  @Column('varchar', { length: 20 }) unit!: string;
  @Column('varchar', { name: 'custom_unit', length: 60, nullable: true })
  customUnit!: string | null;
  @Column('boolean', { name: 'is_active', default: true }) isActive!: boolean;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
  @Column('numeric', {
    name: 'quantity_step',
    precision: 14,
    scale: 3,
    nullable: true,
  })
  quantityStep!: Numeric | null;
  @Column('smallint', { name: 'quantity_decimals', nullable: true })
  quantityDecimals!: number | null;

  @ManyToOne(() => Work, (work) => work.activities, { onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'activities_work_fk',
    },
    { name: 'work_id', referencedColumnName: 'id' },
  ])
  work!: Relation<Work>;
  @OneToMany(() => GoalRecurrence, (recurrence) => recurrence.activity)
  recurrences!: Relation<GoalRecurrence[]>;
  @OneToMany(() => DailyGoal, (goal) => goal.activity) goals!: Relation<
    DailyGoal[]
  >;
}

@Entity('goal_recurrences')
@Unique('goal_recurrences_work_id_id_uq', ['administratorId', 'workId', 'id'])
@Check('goal_recurrences_dates_valid', `ends_on >= starts_on`)
@Check('goal_recurrences_days_mask_valid', `days_mask BETWEEN 1 AND 127`)
@Check(
  'goal_recurrences_description_not_blank',
  `length(btrim(description)) > 0`,
)
@Check('goal_recurrences_quantity_positive', `expected_quantity > 0`)
@Index(
  'goal_recurrences_work_dates_idx',
  ['administratorId', 'workId', 'startsOn', 'endsOn'],
  { where: 'is_active' },
)
export class GoalRecurrence {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('uuid', { name: 'work_id' }) workId!: string;
  @Column('uuid', { name: 'activity_id' }) activityId!: string;
  @Column('varchar', { length: 200 }) description!: string;
  @Column('numeric', { name: 'expected_quantity', precision: 14, scale: 3 })
  expectedQuantity!: Numeric;
  @Column('date', { name: 'starts_on' }) startsOn!: CalendarDate;
  @Column('date', { name: 'ends_on' }) endsOn!: CalendarDate;
  @Column('smallint', { name: 'days_mask' }) daysMask!: number;
  @Column('boolean', { name: 'is_active', default: true }) isActive!: boolean;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;

  @ManyToOne(() => Work, (work) => work.recurrences, {
    onDelete: 'RESTRICT',
    createForeignKeyConstraints: false,
  })
  @JoinColumn([
    { name: 'administrator_id', referencedColumnName: 'administratorId' },
    { name: 'work_id', referencedColumnName: 'id' },
  ])
  work!: Relation<Work>;
  @ManyToOne(() => Activity, (activity) => activity.recurrences, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'goal_recurrences_activity_fk',
    },
    { name: 'work_id', referencedColumnName: 'workId' },
    { name: 'activity_id', referencedColumnName: 'id' },
  ])
  activity!: Relation<Activity>;
  @OneToMany(() => DailyGoal, (goal) => goal.recurrence) goals!: Relation<
    DailyGoal[]
  >;
}

@Entity('daily_goals')
@Unique('daily_goals_work_id_id_uq', ['administratorId', 'workId', 'id'])
@Unique('daily_goals_report_identity_uq', [
  'administratorId',
  'workId',
  'id',
  'workDate',
  'activityId',
])
@Check('daily_goals_description_not_blank', `length(btrim(description)) > 0`)
@Check('daily_goals_quantity_positive', `expected_quantity > 0`)
@Check('daily_goals_unit_valid', UNIT_CHECK)
@Check('daily_goals_custom_unit_valid', CUSTOM_UNIT_CHECK)
@Check('daily_goals_custom_quantity_valid', CUSTOM_QUANTITY_CHECK)
@Index('daily_goals_recurrence_date_uq', ['recurrenceId', 'workDate'], {
  unique: true,
  where: 'recurrence_id IS NOT NULL',
})
@Index('daily_goals_work_date_idx', [
  'administratorId',
  'workId',
  'workDate',
  'isActive',
])
export class DailyGoal {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('uuid', { name: 'work_id' }) workId!: string;
  @Column('uuid', { name: 'activity_id' }) activityId!: string;
  @Column('uuid', { name: 'recurrence_id', nullable: true }) recurrenceId!:
    string | null;
  @Column('date', { name: 'work_date' }) workDate!: CalendarDate;
  @Column('varchar', { length: 200 }) description!: string;
  @Column('numeric', { name: 'expected_quantity', precision: 14, scale: 3 })
  expectedQuantity!: Numeric;
  @Column('varchar', { length: 20 }) unit!: string;
  @Column('varchar', { name: 'custom_unit', length: 60, nullable: true })
  customUnit!: string | null;
  @Column('boolean', { name: 'is_active', default: true }) isActive!: boolean;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
  @Column('numeric', {
    name: 'quantity_step',
    precision: 14,
    scale: 3,
    nullable: true,
  })
  quantityStep!: Numeric | null;
  @Column('smallint', { name: 'quantity_decimals', nullable: true })
  quantityDecimals!: number | null;

  @ManyToOne(() => Work, (work) => work.goals, {
    onDelete: 'RESTRICT',
    createForeignKeyConstraints: false,
  })
  @JoinColumn([
    { name: 'administrator_id', referencedColumnName: 'administratorId' },
    { name: 'work_id', referencedColumnName: 'id' },
  ])
  work!: Relation<Work>;
  @ManyToOne(() => Activity, (activity) => activity.goals, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'daily_goals_activity_fk',
    },
    { name: 'work_id', referencedColumnName: 'workId' },
    { name: 'activity_id', referencedColumnName: 'id' },
  ])
  activity!: Relation<Activity>;
  @ManyToOne(() => GoalRecurrence, (recurrence) => recurrence.goals, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'daily_goals_recurrence_fk',
    },
    { name: 'work_id', referencedColumnName: 'workId' },
    { name: 'recurrence_id', referencedColumnName: 'id' },
  ])
  recurrence!: Relation<GoalRecurrence | null>;
  @OneToMany(() => DailyReportItem, (item) => item.goal) reportItems!: Relation<
    DailyReportItem[]
  >;
}

@Entity('daily_reports')
@Unique('daily_reports_administrator_work_id_uq', [
  'administratorId',
  'workId',
  'id',
])
@Unique('daily_reports_item_identity_uq', [
  'administratorId',
  'workId',
  'id',
  'workDate',
])
@Unique('daily_reports_work_date_uq', ['workId', 'workDate'])
@Index('daily_reports_work_date_idx', () => ({
  administratorId: 1,
  workId: 1,
  workDate: -1,
}))
@Index(
  'daily_reports_submitted_by_person_idx',
  ['administratorId', 'submittedByPersonId'],
  { where: 'submitted_by_person_id IS NOT NULL' },
)
export class DailyReport {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('uuid', { name: 'work_id' }) workId!: string;
  @Column('date', { name: 'work_date' }) workDate!: CalendarDate;
  @Column('uuid', { name: 'foreman_id' }) foremanId!: string;
  @Column('varchar', { name: 'foreman_name_snapshot', length: 201 })
  foremanNameSnapshot!: string;
  @Column('uuid', { name: 'submitted_by_person_id', nullable: true })
  submittedByPersonId!: string | null;
  @Column('boolean', { name: 'administrative_entry', default: false })
  administrativeEntry!: boolean;
  @Column('text', { nullable: true }) observations!: string | null;
  @Column('timestamptz', { name: 'submitted_at', default: () => 'now()' })
  submittedAt!: Date;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;

  @ManyToOne(() => Work, (work) => work.reports, { onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'daily_reports_work_fk',
    },
    { name: 'work_id', referencedColumnName: 'id' },
  ])
  work!: Relation<Work>;
  @ManyToOne(() => Foreman, { onDelete: 'RESTRICT' })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'daily_reports_foreman_fk',
    },
    { name: 'foreman_id', referencedColumnName: 'id' },
  ])
  foreman!: Relation<Foreman>;
  @ManyToOne(() => Person, (person) => person.submittedReports, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'daily_reports_submitted_by_person_fk',
    },
    { name: 'submitted_by_person_id', referencedColumnName: 'id' },
  ])
  submittedByPerson!: Relation<Person | null>;
  @OneToMany(() => DailyReportItem, (item) => item.report) items!: Relation<
    DailyReportItem[]
  >;
  @OneToMany(() => ReportPhoto, (photo) => photo.report) photos!: Relation<
    ReportPhoto[]
  >;
  @OneToMany(() => ReportCorrection, (correction) => correction.report)
  corrections!: Relation<ReportCorrection[]>;
}

@Entity('daily_report_items')
@Unique('daily_report_items_goal_per_report_uq', ['reportId', 'goalId'])
@Check('daily_report_items_actual_nonnegative', `actual_quantity >= 0`)
@Check('daily_report_items_expected_positive', `expected_quantity_snapshot > 0`)
@Check(
  'daily_report_items_custom_quantity_valid',
  `(quantity_step_snapshot IS NULL AND quantity_decimals_snapshot IS NULL) OR (unit_snapshot = 'OTRA' AND quantity_step_snapshot IS NOT NULL AND quantity_decimals_snapshot IS NOT NULL AND quantity_step_snapshot > 0 AND quantity_decimals_snapshot BETWEEN 0 AND 3 AND quantity_step_snapshot * power(10, quantity_decimals_snapshot) = trunc(quantity_step_snapshot * power(10, quantity_decimals_snapshot)))`,
)
@Index('daily_report_items_activity_idx', [
  'administratorId',
  'workId',
  'activityId',
])
@Index('daily_report_items_report_idx', ['reportId'])
export class DailyReportItem {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('uuid', { name: 'work_id' }) workId!: string;
  @Column('uuid', { name: 'report_id' }) reportId!: string;
  @Column('date', { name: 'work_date' }) workDate!: CalendarDate;
  @Column('uuid', { name: 'goal_id' }) goalId!: string;
  @Column('uuid', { name: 'activity_id' }) activityId!: string;
  @Column('varchar', { name: 'description_snapshot', length: 200 })
  descriptionSnapshot!: string;
  @Column('numeric', {
    name: 'expected_quantity_snapshot',
    precision: 14,
    scale: 3,
  })
  expectedQuantitySnapshot!: Numeric;
  @Column('varchar', { name: 'unit_snapshot', length: 20 })
  unitSnapshot!: string;
  @Column('varchar', {
    name: 'custom_unit_snapshot',
    length: 60,
    nullable: true,
  })
  customUnitSnapshot!: string | null;
  @Column('numeric', { name: 'actual_quantity', precision: 14, scale: 3 })
  actualQuantity!: Numeric;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
  @Column('numeric', {
    name: 'quantity_step_snapshot',
    precision: 14,
    scale: 3,
    nullable: true,
  })
  quantityStepSnapshot!: Numeric | null;
  @Column('smallint', { name: 'quantity_decimals_snapshot', nullable: true })
  quantityDecimalsSnapshot!: number | null;

  @ManyToOne(() => DailyReport, (report) => report.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'daily_report_items_report_fk',
    },
    { name: 'work_id', referencedColumnName: 'workId' },
    { name: 'report_id', referencedColumnName: 'id' },
    { name: 'work_date', referencedColumnName: 'workDate' },
  ])
  report!: Relation<DailyReport>;
  @ManyToOne(() => DailyGoal, (goal) => goal.reportItems, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'daily_report_items_goal_fk',
    },
    { name: 'work_id', referencedColumnName: 'workId' },
    { name: 'goal_id', referencedColumnName: 'id' },
    { name: 'work_date', referencedColumnName: 'workDate' },
    { name: 'activity_id', referencedColumnName: 'activityId' },
  ])
  goal!: Relation<DailyGoal>;
}

@Entity('report_photos')
@Unique('report_photos_storage_key_uq', ['storageKey'])
@Check('report_photos_byte_size_positive', `byte_size > 0`)
@Check('report_photos_dimensions_positive', `width > 0 AND height > 0`)
@Check(
  'report_photos_mime_valid',
  `mime_type IN ('image/jpeg','image/png','image/webp')`,
)
@Index('report_photos_report_idx', ['reportId'])
export class ReportPhoto {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('uuid', { name: 'work_id' }) workId!: string;
  @Column('uuid', { name: 'report_id' }) reportId!: string;
  @Column('varchar', { name: 'storage_key', length: 500 }) storageKey!: string;
  @Column('varchar', { name: 'mime_type', length: 30 }) mimeType!: string;
  @Column('integer', { name: 'byte_size' }) byteSize!: number;
  @Column('integer') width!: number;
  @Column('integer') height!: number;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne(() => DailyReport, (report) => report.photos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'report_photos_report_fk',
    },
    { name: 'work_id', referencedColumnName: 'workId' },
    { name: 'report_id', referencedColumnName: 'id' },
  ])
  report!: Relation<DailyReport>;
}

@Entity('report_corrections')
@Check(
  'report_corrections_changed',
  `before_value IS DISTINCT FROM after_value`,
)
@Check(
  'report_corrections_same_administrator',
  `administrator_id = corrected_by_administrator_id`,
)
@Index('report_corrections_report_date_idx', () => ({
  reportId: 1,
  createdAt: -1,
}))
export class ReportCorrection {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('uuid', { name: 'work_id' }) workId!: string;
  @Column('uuid', { name: 'report_id' }) reportId!: string;
  @Column('uuid', { name: 'corrected_by_administrator_id' })
  correctedByAdministratorId!: string;
  @Column('jsonb', { name: 'before_value' }) beforeValue!: unknown;
  @Column('jsonb', { name: 'after_value' }) afterValue!: unknown;
  @Column('text', { nullable: true }) reason!: string | null;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne(() => DailyReport, (report) => report.corrections, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'report_corrections_report_fk',
    },
    { name: 'work_id', referencedColumnName: 'workId' },
    { name: 'report_id', referencedColumnName: 'id' },
  ])
  report!: Relation<DailyReport>;
  @ManyToOne(() => Administrator, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'administrator_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'report_corrections_administrator_id_fkey',
  })
  administrator!: Relation<Administrator>;
  @ManyToOne(() => Administrator, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'corrected_by_administrator_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName:
      'report_corrections_corrected_by_administrator_id_fkey',
  })
  correctedBy!: Relation<Administrator>;
}

@Entity('roles')
@Check('roles_code_valid', `code IN ('ADMINISTRATOR','SITE_MANAGER','FOREMAN')`)
@Check('roles_name_not_blank', `length(btrim(name)) > 0`)
export class Role {
  @PrimaryColumn('varchar', { length: 40 }) code!: string;
  @Column('varchar', { length: 100 }) name!: string;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @OneToMany(() => PersonRole, (assignment) => assignment.role)
  people!: Relation<PersonRole[]>;
}

@Entity('people')
@Unique('people_administrator_id_id_uq', ['administratorId', 'id'])
@Unique('people_administrator_source_uq', ['administratorSourceId'])
@Unique('people_foreman_source_uq', ['foremanSourceId'])
@Check('people_name_not_blank', `length(btrim(full_name)) > 0`)
@Check('people_credentials_complete', `(email IS NULL) = (password_hash IS NULL)`)
@Check('people_email_not_blank', `email IS NULL OR length(btrim(email)) > 0`)
@Check(
  'people_source_valid',
  `NOT (administrator_source_id IS NOT NULL AND foreman_source_id IS NOT NULL)`,
)
@Check(
  'people_administrator_source_owner',
  `administrator_source_id IS NULL OR administrator_source_id = administrator_id`,
)
@Check(
  'people_pin_credentials_complete',
  `(pin_hash IS NULL) = (pin_lookup_hmac IS NULL)`,
)
@Check('people_pin_hash_valid', `pin_hash IS NULL OR length(pin_hash) >= 50`)
@Check(
  'people_pin_lookup_hmac_valid',
  `pin_lookup_hmac IS NULL OR pin_lookup_hmac ~ '^[0-9a-f]{64}$'`,
)
@Check('people_session_version_valid', `session_version >= 0`)
@Check('people_failed_attempts_valid', `failed_attempts >= 0`)
@Index('people_administrator_active_idx', ['administratorId', 'isActive'])
@Index('people_email_lower_uq', { synchronize: false })
@Index('people_pin_lookup_hmac_uq', ['pinLookupHmac'], {
  unique: true,
  where: 'pin_lookup_hmac IS NOT NULL',
})
export class Person {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('uuid', { name: 'administrator_source_id', nullable: true })
  administratorSourceId!: string | null;
  @Column('uuid', { name: 'foreman_source_id', nullable: true })
  foremanSourceId!: string | null;
  @Column('varchar', { name: 'full_name', length: 201 }) fullName!: string;
  @Column('varchar', { length: 320, nullable: true }) email!: string | null;
  @Column('varchar', { name: 'password_hash', length: 255, nullable: true, select: false }) passwordHash!: string | null;
  @Column('boolean', { name: 'is_active', default: true }) isActive!: boolean;
  @Column('varchar', {
    name: 'pin_hash',
    length: 255,
    nullable: true,
    select: false,
  })
  pinHash!: string | null;
  @Column('char', {
    name: 'pin_lookup_hmac',
    length: 64,
    nullable: true,
    select: false,
  })
  pinLookupHmac!: string | null;
  @Column('bigint', { name: 'session_version', default: 0 })
  sessionVersion!: string;
  @Column('integer', { name: 'failed_attempts', default: 0 })
  failedAttempts!: number;
  @Column('timestamptz', { name: 'locked_until', nullable: true })
  lockedUntil!: Date | null;
  @Column('timestamptz', { name: 'last_access_at', nullable: true })
  lastAccessAt!: Date | null;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;

  @ManyToOne(() => Administrator, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'administrator_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'people_administrator_fk',
  })
  administrator!: Relation<Administrator>;
  @OneToOne(() => Administrator, (administrator) => administrator.person, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'administrator_source_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'people_administrator_source_fk',
  })
  administratorSource!: Relation<Administrator | null>;
  // PostgreSQL enforces the one-to-one cardinality with
  // people_foreman_source_uq on foreman_source_id. Modeling the owning side
  // as OneToOne would make TypeORM expect an additional, redundant unique
  // constraint over (administrator_id, foreman_source_id).
  @ManyToOne(() => Foreman, (foreman) => foreman.person, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'people_foreman_source_fk',
    },
    { name: 'foreman_source_id', referencedColumnName: 'id' },
  ])
  foremanSource!: Relation<Foreman | null>;
  @OneToMany(() => PersonRole, (assignment) => assignment.person)
  roles!: Relation<PersonRole[]>;
  @OneToMany(() => WorkAssignment, (assignment) => assignment.person)
  workAssignments!: Relation<WorkAssignment[]>;
  @OneToMany(() => DailyReport, (report) => report.submittedByPerson)
  submittedReports!: Relation<DailyReport[]>;
}

@Entity('person_roles')
@Unique('person_roles_assignment_identity_uq', [
  'administratorId',
  'personId',
  'roleCode',
])
export class PersonRole {
  @PrimaryColumn('uuid', { name: 'person_id' }) personId!: string;
  @PrimaryColumn('varchar', { name: 'role_code', length: 40 })
  roleCode!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne(() => Person, (person) => person.roles, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'person_roles_person_fk',
    },
    { name: 'person_id', referencedColumnName: 'id' },
  ])
  person!: Relation<Person>;
  @ManyToOne(() => Role, (role) => role.people, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'role_code',
    referencedColumnName: 'code',
    foreignKeyConstraintName: 'person_roles_role_fk',
  })
  role!: Relation<Role>;
  @OneToMany(() => WorkAssignment, (assignment) => assignment.personRole)
  workAssignments!: Relation<WorkAssignment[]>;
}

@Entity('work_assignments')
@Check(
  'work_assignments_dates_valid',
  `unassigned_at IS NULL OR unassigned_at >= assigned_at`,
)
@Check('work_assignments_role_valid', `role_code IN ('SITE_MANAGER','FOREMAN')`)
@Index(
  'work_assignments_active_idx',
  ['administratorId', 'personId', 'roleCode', 'workId'],
  { where: 'unassigned_at IS NULL' },
)
@Index('work_assignments_active_uq', ['workId', 'personId', 'roleCode'], {
  unique: true,
  where: 'unassigned_at IS NULL',
})
@Index('work_assignments_primary_uq', ['workId', 'roleCode'], {
  unique: true,
  where: 'is_primary AND unassigned_at IS NULL',
})
export class WorkAssignment {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid', { name: 'work_id' }) workId!: string;
  @Column('uuid', { name: 'person_id' }) personId!: string;
  @Column('varchar', { name: 'role_code', length: 40 })
  roleCode!: string;
  @Column('uuid', { name: 'administrator_id' }) administratorId!: string;
  @Column('boolean', { name: 'is_primary', default: false })
  isPrimary!: boolean;
  @Column('timestamptz', { name: 'assigned_at', default: () => 'now()' })
  assignedAt!: Date;
  @Column('timestamptz', { name: 'unassigned_at', nullable: true })
  unassignedAt!: Date | null;
  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;

  @ManyToOne(() => Work, (work) => work.assignments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'work_assignments_work_fk',
    },
    { name: 'work_id', referencedColumnName: 'id' },
  ])
  work!: Relation<Work>;
  @ManyToOne(() => Person, (person) => person.workAssignments, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn([
    { name: 'administrator_id', referencedColumnName: 'administratorId' },
    { name: 'person_id', referencedColumnName: 'id' },
  ])
  person!: Relation<Person>;
  @ManyToOne(() => PersonRole, (personRole) => personRole.workAssignments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn([
    {
      name: 'administrator_id',
      referencedColumnName: 'administratorId',
      foreignKeyConstraintName: 'work_assignments_person_role_fk',
    },
    { name: 'person_id', referencedColumnName: 'personId' },
    { name: 'role_code', referencedColumnName: 'roleCode' },
  ])
  personRole!: Relation<PersonRole>;
}

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
] as const;
