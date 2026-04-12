import { Module } from '@nestjs/common';
import { PartnerProfilesController } from './partner-profiles.controller';
import { PartnerProfilesService } from './partner-profiles.service';

@Module({
  controllers: [PartnerProfilesController],
  providers: [PartnerProfilesService],
  exports: [PartnerProfilesService],
})
export class PartnerProfilesModule {}
