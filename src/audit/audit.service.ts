import { Injectable } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DatabaseService } from '../database/database.service';
import { AuditLogRow, EntityType, ActorType } from '../common/types';
import { generateId } from '../common/utils';

export interface CreateAuditLogParams {
  entityType: EntityType;
  entityId: string;
  action: string;
  actorType: ActorType;
  actorId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  correlationId?: string | null;
}

@Injectable()
export class AuditService {
  private insertStmt: Database.Statement | null = null;

  constructor(private readonly dbService: DatabaseService) {}

  private getInsertStmt(): Database.Statement {
    if (!this.insertStmt) {
      this.insertStmt = this.dbService.getDb().prepare(`
        INSERT INTO audit_logs (id, entity_type, entity_id, action, actor_type, actor_id,
          before_state, after_state, metadata, correlation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }
    return this.insertStmt;
  }

  log(params: CreateAuditLogParams): void {
    this.getInsertStmt().run(
      generateId(),
      params.entityType,
      params.entityId,
      params.action,
      params.actorType,
      params.actorId,
      params.beforeState ? JSON.stringify(params.beforeState) : null,
      params.afterState ? JSON.stringify(params.afterState) : null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.correlationId || null,
    );
  }

  /**
   * Log within an existing transaction (uses the same db connection).
   * Since better-sqlite3 is synchronous, this works inside transactions.
   */
  logInTransaction(params: CreateAuditLogParams): void {
    this.log(params);
  }

  findByEntity(entityType: EntityType, entityId: string): AuditLogRow[] {
    return this.dbService
      .getDb()
      .prepare('SELECT * FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC')
      .all(entityType, entityId) as AuditLogRow[];
  }
}
