import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
  // Child modules (drawings, materials, activities, attachments, reports) reuse
  // ProjectsService.assertProject so tenancy is enforced in exactly one place.
  exports: [ProjectsService],
})
export class ProjectsModule {}
