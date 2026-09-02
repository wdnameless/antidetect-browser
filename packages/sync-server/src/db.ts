import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { runMigrations } from './migrations';

export class DbManager {
  private db: Database | null = null;
  private filePath: string | null = null;

  async init(dbPath?: string): Promise<Database> {
    const SQL = await initSqlJs();
    this.filePath = dbPath ?? null;

    if (dbPath && fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    // Enable foreign keys
    this.db.run('PRAGMA foreign_keys = ON;');

    // Run idempotent migrations
    runMigrations(this.db);
    this.persist();

    return this.db;
  }

  getDb(): Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  persist(): void {
    if (!this.db || !this.filePath) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, buffer);
  }

  close(): void {
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = null;
    }
  }
}
