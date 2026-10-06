import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { seedCategories } from "./seed";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "budget.sqlite");

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  institution TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  monthly_cap_cents INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  mapped_columns TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payee TEXT NOT NULL DEFAULT '',
  raw_description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  import_hash TEXT,
  is_transfer INTEGER NOT NULL DEFAULT 0,
  import_batch_id INTEGER REFERENCES import_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_import_hash
  ON transactions(account_id, import_hash)
  WHERE import_hash IS NOT NULL;
`;

// Columns added after the first release; CREATE TABLE IF NOT EXISTS won't add
// them to a database that already exists.
const ADDED_COLUMNS = [
  { table: "accounts", column: "opening_balance_cents", definition: "INTEGER NOT NULL DEFAULT 0" },
];

function addMissingColumns(sqlite: Database.Database) {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const existing = sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!existing.some((info) => info.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function createDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_SQL);
  addMissingColumns(sqlite);
  const db = drizzle(sqlite, { schema });
  seedCategories(db);
  return db;
}

const globalForDb = globalThis as unknown as {
  db?: ReturnType<typeof createDb>;
};

export const db = globalForDb.db ?? createDb();
if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
