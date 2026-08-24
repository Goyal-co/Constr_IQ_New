import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { DesignFilesController } from './design-files.controller';
import { DesignFilesService } from './design-files.service';

@Module({
  imports: [ProjectsModule],
  controllers: [DesignFilesController],
  providers: [DesignFilesService],
})
export class DesignFilesModule {}
