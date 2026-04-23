import Database from 'better-sqlite3';
import { Logger } from '@nestjs/common';
export declare function runMigrations(db: Database.Database, logger: Logger): void;
