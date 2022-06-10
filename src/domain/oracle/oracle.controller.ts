import { Body, Controller, Post } from '@nestjs/common';
import {
  oracleOutputErrorDto,
  oracleSubscriptionInputDto,
  oracleSubscriptionOutputDto,
} from './dto/oracle.dto';
import { OracleService } from './oracle.service';

@Controller('oracle')
export class OracleController {
  constructor(private readonly oracleService: OracleService) {}

  @Post('GetSubscriptionInfo')
  async getSubscriptionInfo(
    @Body() oracleSubscriptionInputData: oracleSubscriptionInputDto,
  ): Promise<oracleSubscriptionOutputDto | oracleOutputErrorDto> {
    return await this.oracleService.getSubscriptionInfo(
      oracleSubscriptionInputData,
    );
  }
}
