import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as path from 'path';
import { runMigrations } from './migrations/index';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db!: Database.Database;
  private readonly logger = new Logger(DatabaseService.name);

  onModuleInit(): void {
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'readyon.db');
    this.logger.log(`Initializing SQLite database at: ${dbPath}`);

    this.db = new Database(dbPath);

    // Set pragmas for production use
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');

    // Run migrations
    runMigrations(this.db, this.logger);

    this.logger.log('Database initialized successfully');
  }

  onModuleDestroy(): void {
    if (this.db) {
      this.db.close();
      this.logger.log('Database connection closed');
    }
  }

  getDb(): Database.Database {
    return this.db;
  }

  runInTransaction<T>(fn: (db: Database.Database) => T): T {
    const transaction = this.db.transaction(fn);
    return transaction(this.db);
  }

  resetDatabase(): void {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as any[];
    
    this.db.prepare('PRAGMA foreign_keys = OFF').run();
    try {
      this.db.transaction(() => {
        for (const table of tables) {
          this.db.prepare(`DELETE FROM ${table.name}`).run();
        }
      })();
    } finally {
      this.db.prepare('PRAGMA foreign_keys = ON').run();
    }
    this.logger.log('All database tables cleared');
  }
}
