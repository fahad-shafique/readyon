import { IsString, IsArray, IsNumber, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class BatchSyncItemDto {
  @IsString()
  employee_id!: string;

  @IsString()
  leave_type!: string;

  @IsNumber()
  @Min(0)
  total_balance!: number;

  @IsNumber()
  @Min(0)
  used_balance!: number;

  @IsString()
  hcm_version!: string;
}

export class BatchSyncRequestDto {
  @IsString()
  batch_id!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchSyncItemDto)
  items!: BatchSyncItemDto[];
}

export class SingleBalanceUpdateDto {
  @IsString()
  employee_id!: string;

  @IsString()
  leave_type!: string;

  @IsNumber()
  @Min(0)
  total_balance!: number;

  @IsNumber()
  @Min(0)
  used_balance!: number;

  @IsString()
  hcm_version!: string;
}
