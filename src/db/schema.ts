import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accountTypes = ["checking", "savings", "credit"] as const;
export const dataSources = ["manual", "csv", "plaid"] as const;
export const categoryKinds = ["income", "expense"] as const;

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", { enum: accountTypes }).notNull(),
  institution: text("institution"),
  source: text("source", { enum: dataSources }).notNull().default("manual"),
  createdAt: text("created_at").notNull(),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind", { enum: categoryKinds }).notNull(),
  monthlyCapCents: integer("monthly_cap_cents"),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const importBatches = sqliteTable("import_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  mappedColumns: text("mapped_columns").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  importedCount: integer("imported_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  categoryId: integer("category_id").references(() => categories.id),
  date: text("date").notNull(),
  amountCents: integer("amount_cents").notNull(),
  payee: text("payee").notNull().default(""),
  rawDescription: text("raw_description").notNull().default(""),
  source: text("source", { enum: dataSources }).notNull().default("manual"),
  externalId: text("external_id"),
  importHash: text("import_hash"),
  isTransfer: integer("is_transfer", { mode: "boolean" }).notNull().default(false),
  importBatchId: integer("import_batch_id").references(() => importBatches.id),
});

export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
