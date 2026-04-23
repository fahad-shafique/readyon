import { DatabaseService } from '../database/database.service';
import { AuditLogRow, EntityType, ActorType } from '../common/types';
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
export declare class AuditService {
    private readonly dbService;
    private insertStmt;
    constructor(dbService: DatabaseService);
    private getInsertStmt;
    log(params: CreateAuditLogParams): void;
    logInTransaction(params: CreateAuditLogParams): void;
    findByEntity(entityType: EntityType, entityId: string): AuditLogRow[];
}
