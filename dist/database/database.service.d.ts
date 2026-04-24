import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
export declare class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private db;
    private readonly logger;
    onModuleInit(): void;
    onModuleDestroy(): void;
    getDb(): Database.Database;
    runInTransaction<T>(fn: (db: Database.Database) => T): T;
    resetDatabase(): void;
}
