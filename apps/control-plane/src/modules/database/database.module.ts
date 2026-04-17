import { Module, Global } from '@nestjs/common';
import { DatabaseService } from '@sep/db';

@Global()
@Module({
  providers: [
    { provide: DatabaseService, useFactory: (): DatabaseService => new DatabaseService() },
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
