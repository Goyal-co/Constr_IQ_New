import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { WorkItemsController } from './work-items.controller';
import { WorkItemsService } from './work-items.service';

@Module({
  imports: [ProjectsModule],
  controllers: [WorkItemsController],
  providers: [WorkItemsService],
})
export class WorkItemsModule {}
