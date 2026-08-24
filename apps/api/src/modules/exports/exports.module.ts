import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ReportsModule } from '../reports/reports.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [ReportsModule, ProjectsModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
