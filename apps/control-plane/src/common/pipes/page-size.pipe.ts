import { type PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { SepError, ErrorCode } from '@sep/common';

const MAX_PAGE_SIZE = 100;

@Injectable()
export class PageSizePipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1) {
      throw new BadRequestException(
        new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
          field: 'pageSize',
          message: 'pageSize must be a positive integer',
        }).toClientJson(),
      );
    }
    if (num > MAX_PAGE_SIZE) {
      throw new BadRequestException(
        new SepError(ErrorCode.VALIDATION_SCHEMA_FAILED, {
          field: 'pageSize',
          message: `pageSize must not exceed ${MAX_PAGE_SIZE}`,
        }).toClientJson(),
      );
    }
    return num;
  }
}

export { MAX_PAGE_SIZE };
