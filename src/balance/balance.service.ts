import { Injectable } from '@nestjs/common';
import { BalanceRepository } from './balance.repository';

@Injectable()
export class BalanceService {
  constructor(private readonly balanceRepo: BalanceRepository) {}

  getBalances(employeeId: string) {
    const projections = this.balanceRepo.findByEmployee(employeeId);

    return projections.map((p) => {
      const loc = p.location || 'HQ';
      const held = this.balanceRepo.getActiveHoldsTotal(p.employee_id, p.leave_type, loc);
      return {
        employee_id: p.employee_id,
        leave_type: p.leave_type,
        location: loc,
        total_balance: p.total_balance,
        used_balance: p.used_balance,
        held_balance: held,
        effective_available: p.projected_available - held,
        hcm_version: p.hcm_version,
        last_synced_at: p.updated_at,
      };
    });
  }

  getBalanceByType(employeeId: string, leaveType: string, location: string = 'HQ') {
    const p = this.balanceRepo.findByEmployeeAndType(employeeId, leaveType, location);
    if (!p) return null;

    const loc = p.location || 'HQ';
    const held = this.balanceRepo.getActiveHoldsTotal(p.employee_id, p.leave_type, loc);
    return {
      employee_id: p.employee_id,
      leave_type: p.leave_type,
      location: loc,
      total_balance: p.total_balance,
      used_balance: p.used_balance,
      held_balance: held,
      effective_available: p.projected_available - held,
      hcm_version: p.hcm_version,
      last_synced_at: p.updated_at,
    };
  }
}
