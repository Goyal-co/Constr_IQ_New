import { Global, Module } from '@nestjs/common';
import { PhasesController } from './phases.controller';
import { PhasesService } from './phases.service';

/** Global: drawings, materials, activities and templates all resolve phase ids. */
@Global()
@Module({
  controllers: [PhasesController],
  providers: [PhasesService],
  exports: [PhasesService],
})
export class PhasesModule {}
