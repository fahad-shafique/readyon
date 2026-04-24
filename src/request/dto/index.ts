import { IsString, IsNumber, IsOptional, Min, IsDateString, IsInt } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateTimeOffRequestDto {
  @IsString()
  leave_type!: string;

  @IsDateString()
  start_date!: string;

  @IsDateString()
  end_date!: string;

  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  hours_requested!: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CancelRequestDto {
  @IsNumber()
  version!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ApproveRequestDto {
  @IsNumber()
  version!: number;
}

export class RejectRequestDto {
  @IsNumber()
  version!: number;

  @IsString()
  rejection_reason!: string;
}
