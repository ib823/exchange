import { Module } from '@nestjs/common';
import { KeyReferencesController } from './key-references.controller';
import { KeyReferencesService } from './key-references.service';

@Module({
  controllers: [KeyReferencesController],
  providers: [KeyReferencesService],
  exports: [KeyReferencesService],
})
export class KeyReferencesModule {}
