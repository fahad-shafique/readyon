import { Controller, Get, Query, Req, HttpCode } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { NotFoundException } from '../common/exceptions';

@Controller('api/v1/employees/me/balances')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get()
  @HttpCode(200)
  getBalances(
    @Req() req: any,
    @Query('leave_type') leaveType?: string,
  ) {
    const employeeId = req.headers['x-employee-id'];

    if (leaveType) {
      const balance = this.balanceService.getBalanceByType(employeeId, leaveType);
      if (!balance) {
        throw new NotFoundException('balance', `${employeeId}/${leaveType}`);
      }
      return { data: [balance] };
    }

    const balances = this.balanceService.getBalances(employeeId);
    if (balances.length === 0) {
      throw new NotFoundException('balances', employeeId);
    }
    return { data: balances };
  }
}
