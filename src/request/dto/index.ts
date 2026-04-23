import { IsString, IsNumber, IsOptional, Min, IsDateString } from 'class-validator';

export class CreateTimeOffRequestDto {
  @IsString()
  leave_type!: string;

  @IsDateString()
  start_date!: string;

  @IsDateString()
  end_date!: string;

  @IsNumber()
  @Min(0.01)
  hours_requested!: number;

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
