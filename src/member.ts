import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { In, IsNull, type DataSource } from 'typeorm';
import { AdminService } from './admin.js';
import { DB } from './database.module.js';
import {
  DailyReport,
  ReportPhoto,
  WorkAssignment,
} from './database/entities.js';
import {
  PersonJwtGuard,
  WorkAuthorizationService,
  type PersonRequest,
} from './people-auth.js';
import { ReportsService } from './reports.js';

@Injectable()
export class MemberService {
  constructor(
    @Inject(DB) private readonly db: DataSource,
    private readonly authorization: WorkAuthorizationService,
    private readonly admin: AdminService,
    private readonly reports: ReportsService,
  ) {}

  async works(request: PersonRequest) {
    const assignments = await this.db.getRepository(WorkAssignment).find({
      where: {
        administratorId: request.actor.administratorId,
        personId: request.actor.id,
        roleCode: In(request.actor.roles),
        unassignedAt: IsNull(),
      },
      relations: { work: { primaryForeman: true } },
      order: { assignedAt: 'ASC' },
    });
    const result = new Map<
      string,
      {
        id: string;
        name: string;
        description: string | null;
        location: string | null;
        status: string;
        startDate: string;
        estimatedEndDate: string;
        foremanName: string;
        roles: string[];
      }
    >();
    for (const assignment of assignments) {
      const existing = result.get(assignment.workId);
      if (existing) {
        if (!existing.roles.includes(assignment.roleCode))
          existing.roles.push(assignment.roleCode);
        continue;
      }
      result.set(assignment.workId, {
        id: assignment.work.id,
        name: assignment.work.name,
        description: assignment.work.description,
        location: assignment.work.location,
        status: assignment.work.status,
        startDate: assignment.work.startDate,
        estimatedEndDate: assignment.work.estimatedEndDate,
        foremanName: `${assignment.work.primaryForeman.firstName} ${assignment.work.primaryForeman.lastName}`,
        roles: [assignment.roleCode],
      });
    }
    return [...result.values()];
  }

  async detail(request: PersonRequest, workId: string) {
    await this.authorization.authorize(request.actor, workId);
    return this.admin.workDetail(request.actor.administratorId, workId, false);
  }

  async reportList(request: PersonRequest, workId: string) {
    await this.authorization.authorize(request.actor, workId);
    return this.reports.list(request.actor.administratorId, workId);
  }

  async reportDetail(request: PersonRequest, reportId: string) {
    const report = await this.db.getRepository(DailyReport).findOneBy({
      id: reportId,
      administratorId: request.actor.administratorId,
    });
    if (!report) throw new NotFoundException('Informe no encontrado');
    await this.authorization.authorize(request.actor, report.workId);
    return this.reports.detail(reportId, request.actor.administratorId);
  }

  async submit(request: PersonRequest, workId: string, body: any) {
    const work = await this.authorization.authorize(
      request.actor,
      workId,
      true,
    );
    return this.reports.submit(work, body, request.actor.id);
  }

  async upload(
    request: PersonRequest,
    workId: string,
    reportId: string,
    file: Express.Multer.File,
  ) {
    const work = await this.authorization.authorize(
      request.actor,
      workId,
      true,
    );
    const belongs = await this.db.getRepository(DailyReport).existsBy({
      id: reportId,
      administratorId: request.actor.administratorId,
      workId,
    });
    if (!belongs) throw new NotFoundException('Informe no encontrado');
    return this.reports.uploadPhoto(
      request.actor.administratorId,
      reportId,
      file,
      work,
    );
  }

  async photo(request: PersonRequest, photoId: string) {
    const photo = await this.db.getRepository(ReportPhoto).findOneBy({
      id: photoId,
      administratorId: request.actor.administratorId,
    });
    if (!photo) throw new NotFoundException('Fotografía no encontrada');
    await this.authorization.authorize(request.actor, photo.workId);
    return this.reports.photo(
      request.actor.administratorId,
      photoId,
      photo.workId,
    );
  }
}

@UseGuards(PersonJwtGuard)
@Controller('member')
export class MemberController {
  constructor(private readonly members: MemberService) {}

  @Get('works')
  works(@Req() request: PersonRequest) {
    return this.members.works(request);
  }

  @Get('works/:workId')
  detail(@Req() request: PersonRequest, @Param('workId') workId: string) {
    return this.members.detail(request, workId);
  }

  @Get('works/:workId/reports')
  reports(@Req() request: PersonRequest, @Param('workId') workId: string) {
    return this.members.reportList(request, workId);
  }

  @Get('reports/:reportId')
  report(@Req() request: PersonRequest, @Param('reportId') reportId: string) {
    return this.members.reportDetail(request, reportId);
  }

  @Post('works/:workId/reports')
  submit(
    @Req() request: PersonRequest,
    @Param('workId') workId: string,
    @Body() body: any,
  ) {
    return this.members.submit(request, workId, body);
  }

  @Post('works/:workId/reports/:reportId/photos')
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: 12 * 1024 * 1024 } }),
  )
  upload(
    @Req() request: PersonRequest,
    @Param('workId') workId: string,
    @Param('reportId') reportId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.members.upload(request, workId, reportId, file);
  }

  @Get('photos/:photoId')
  async photo(
    @Req() request: PersonRequest,
    @Param('photoId') photoId: string,
    @Res() response: Response,
  ) {
    response
      .type('image/webp')
      .send(await this.members.photo(request, photoId));
  }
}
