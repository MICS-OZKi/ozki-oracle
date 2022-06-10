import { Module } from '@nestjs/common';
import { OracleController } from './oracle.controller';
import { OracleService } from './oracle.service';

@Module({
  imports: [],
  controllers: [OracleController],
  providers: [OracleService],
})
export class OracleModule {}
