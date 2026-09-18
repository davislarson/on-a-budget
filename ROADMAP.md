# On a Budget — Roadmap

A local-first personal budgeting app. Next.js 16 (App Router) + Tailwind 4, with data in a
local SQLite file (`data/budget.sqlite`) accessed through Drizzle. Everything runs on your
own machine; no financial data leaves it or gets committed.

_Last updated: 2026-09-18_

---

## Where things stand

### Done

- **Data layer** — schema for accounts, categories, transactions, and import batches
  ([src/db/schema.ts](src/db/schema.ts)). The database creates itself on first run and seeds
  default categories with monthly caps ([src/db/seed.ts](src/db/seed.ts)).
- **Server actions** ([src/lib/actions.ts](src/lib/actions.ts)) — create/update/delete for
  accounts, categories, and transactions; transfer toggling; CSV import with duplicate
  detection.
- **Queries** ([src/lib/queries.ts](src/lib/queries.ts)) — filtered transaction list, monthly
  dashboard numbers, 12-month trends.
- **Dashboard (`/`)** — income, spending, left over, budgeted; over-budget and uncategorized
  alerts; per-category progress bars; income by category; recent transactions; onboarding
  screen when there are no accounts.
- **Transactions (`/transactions`)** — month picker, account/category filters (including
  "Uncategorized"), in/out totals, add form, inline category changes, mark as transfer,
  delete with confirmation.
- **Nav and layout** wired up; global CSS moved into layers so Tailwind utilities work.

### Not built yet

The nav links to **Budget**, **Accounts**, **Import**, and **Trends**, but those pages 404.

### Open PR

[#1 Feature/initial app](https://github.com/davislarson/on-a-budget/pull/1) — everything
above, on `feature/initial-app`. Not merged yet.

---

## Phase 0 — Housekeeping (short)

- [ ] Sign in the GitHub CLI (`gh auth login`) so PRs and CI can be managed from Claude Code.
- [ ] Give PR #1 a real title/description and merge it into `main`.
- [ ] Work on short-lived branches per phase from here on (e.g. `feature/accounts-page`).

## Phase 1 — Fix known bugs in existing code

These are in code that's already written, but aren't visible yet because the pages that call
them don't exist. Fix them before (or while) building those pages.

- [ ] **CSV import crashes on identical rows in one file.** Two genuinely separate
  transactions with the same date, amount, and description (e.g. two $5.00 coffees on the
  same day) get the same `importHash`. `importCsvRows` only de-duplicates against rows
  already in the database, not within the file, so both are inserted and the unique index
  on `(account_id, import_hash)` throws — the whole import fails.
  _Fix:_ add an occurrence counter to the hash for repeats within a file (1st, 2nd, …) so
  re-importing the same file still de-duplicates but same-day repeats are kept.
- [ ] **Can't remove a category's cap.** `updateCategoryCap` saves an empty input as `0`
  instead of `null`, so a cleared cap shows as "$0.00 budgeted" and every dollar spent is
  over budget. _Fix:_ empty → `null`.
- [ ] **Errors crash the page.** Server actions `throw` on bad input (invalid amount, deleting
  an account that has transactions, etc.) and there's no error UI, so the user sees Next's
  error screen. _Fix:_ return `{ error }` from actions and show it inline with
  `useActionState`; add an `error.tsx` boundary as a fallback.
- [ ] **Input validation.** Actions trust `Number(formData.get("id"))` and category/account
  IDs without checking they exist. Validate IDs, dates, and enum values (a small schema
  library such as Zod, or hand-written guards).

## Phase 2 — Accounts page (`/accounts`)

Needed before the app can be used with real data — the dashboard's "Add an account" button
points here.

- [ ] List accounts with type, institution, source (manual / CSV), and transaction count.
- [ ] Add-account form (`createAccount` already exists).
- [ ] Inline edit of name/type/institution (`updateAccount` exists).
- [ ] Delete, with a clear message when the account still has transactions
  (`deleteAccount` already refuses — surface that nicely).
- [ ] **Balances (new).** The schema has no balance. Add an `opening_balance_cents` and
  `opening_balance_date` to accounts; current balance = opening + sum of transactions after
  that date. Show per-account balances and net worth (assets − credit card debt).

## Phase 3 — Import page (`/import`)

The main way real data gets in. The server side (`importCsvRows`) is done; this is the UI.

- [ ] Pick an account and upload a bank CSV; parse it in the browser with Papaparse
  (already installed) so the file never leaves the machine except as parsed rows to the
  local server.
- [ ] Column mapping: choose which columns are date, amount (or separate debit/credit
  columns), payee, and description. Guess sensible defaults from header names.
- [ ] "Flip signs" option for banks that export spending as positive numbers
  (`invertAmounts` is already supported).
- [ ] Preview the first ~20 parsed rows before importing; flag rows that fail to parse.
- [ ] Show the result: imported / skipped as duplicates / unparseable.
- [ ] Remember the column mapping per account so the next import is one click
  (`import_batches.mapped_columns` already stores it).
- [ ] Import history list, with **undo import** (delete every transaction in a batch —
  `import_batch_id` makes this easy).
- [ ] Support separate debit/credit columns (many banks export this way; the current
  action expects one signed amount column).

## Phase 4 — Budget page (`/budget`)

- [ ] List expense categories with their monthly caps; edit caps inline
  (`updateCategoryCap`).
- [ ] Add a category (`createCategory`) and archive one (`archiveCategory`).
- [ ] Show total budgeted vs. typical monthly income, so over-allocation is obvious.
- [ ] Reorder categories (`sort_order` exists; needs an action).
- [ ] Rename a category (needs an action).
- [ ] Un-archive / view archived categories.

## Phase 5 — Trends page (`/trends`)

The `trends()` query and Recharts are already in place.

- [ ] Income vs. spending by month, last 12 months (bar or line chart).
- [ ] Spending by category over time (stacked bars or small multiples).
- [ ] Savings rate per month ((income − spending) / income).
- [ ] Pick the ending month and range (6 / 12 / 24 months).
- [ ] Clicking a month or category jumps to the filtered transactions list.

## Phase 6 — Make categorizing fast

Once real CSVs are flowing in, categorizing every transaction by hand gets tedious.

- [ ] **Auto-categorization rules**: "payee contains `TRADER JOE` → Groceries". New table
  `rules(pattern, category_id, priority)`; apply on import and on demand.
- [ ] "Always categorize this payee as…" shortcut from the transactions table.
- [ ] Clean up ugly bank payee strings (`SQ *COFFEE SHOP 1234 CITY ST`) into readable names.
- [ ] **Transfer detection**: suggest pairs of opposite-amount transactions on the same or
  nearby dates across two of your accounts (e.g. checking → credit card payment), and mark
  both as transfers in one click.
- [ ] Bulk actions on the transactions table: select several rows → set category / mark
  transfer / delete.
- [ ] Split a transaction across categories (e.g. a Target run that's part groceries, part
  household).

## Phase 7 — Transactions page polish

- [ ] Search by payee/description.
- [ ] Edit a transaction's date, amount, payee, and account (currently only category and
  transfer status are editable).
- [ ] "All time" / date-range view in addition to single months.
- [ ] Pagination or virtual scrolling for large months.
- [ ] Compact card layout on phones instead of a sideways-scrolling table.
- [ ] Notes field shown and editable (stored in `raw_description` today).

## Phase 8 — Budgeting features

- [ ] **Rollover**: unspent (or overspent) amounts carry into next month's cap, per category.
- [ ] **Per-month caps**: override a cap for one month (e.g. higher "Fun" in December)
  without changing the default.
- [ ] **Savings goals**: target amount + date, progress tracked from a savings account.
- [ ] **Recurring bills**: detect or declare subscriptions and fixed bills; show what's
  still due this month.
- [ ] Income categories that aren't budget-counted (e.g. reimbursements).

## Phase 9 — Data safety and quality

- [ ] **Backups**: one-click "export database" and an automatic dated copy of
  `budget.sqlite` (e.g. on app start, keep the last 10).
- [ ] Export transactions to CSV.
- [ ] **One source of truth for the schema.** Tables are defined twice — in
  [schema.ts](src/db/schema.ts) and in raw SQL in [src/db/index.ts](src/db/index.ts) — and
  will drift. Switch to Drizzle migrations (`drizzle.config.ts` is already set up; the
  `./drizzle` folder doesn't exist yet) and run them on startup.
- [ ] Sample-data script (`npm run seed:sample`) and a reset script, instead of hand-written
  SQL.

## Phase 10 — Tests and tooling

- [ ] Unit tests (Vitest) for the logic that handles money:
  `dollarsToCents` / `formatCents`, `parseFlexibleDate`, `monthBounds`, `importHash`.
- [ ] Tests for `monthDashboard` and `importCsvRows` against a temporary SQLite database —
  especially duplicate handling and transfer exclusion.
- [ ] A few end-to-end checks (Playwright): add account → import CSV → categorize → see
  dashboard update.
- [ ] GitHub Actions CI: typecheck, lint, tests on every PR.
- [ ] Replace the placeholder files in `public/` (Next/Vercel logos) and add a real favicon.

## Later / maybe

- [ ] **Automatic bank sync** via Plaid or similar — the schema already anticipates it
  (`source: "plaid"`, `external_id`). Needs API keys, token storage, and a real threat model.
- [ ] Multiple currencies.
- [ ] Dark mode (colors are already CSS variables, so this is mostly a second palette).
- [ ] Installable as a desktop/PWA app.

---

## Things to keep in mind

- **Keep it local.** The app has no login. It's safe on your own machine, but must not be
  deployed to a public server as-is. (The default README's "Deploy on Vercel" advice doesn't
  apply — Vercel also can't persist a SQLite file.) If remote access is ever wanted, add
  authentication first.
- **Never commit real data.** `.gitignore` already excludes `data/*.sqlite*`, `/uploads/`,
  and `*.csv`. Keep test CSVs out of the repo, or add obviously fake ones under an explicit
  exception.
- **Money is stored in integer cents.** Keep it that way; never use floats for amounts.
- **Next.js 16 differs from older versions** — check `node_modules/next/dist/docs/` before
  using an unfamiliar API (see [AGENTS.md](AGENTS.md)).

## Suggested order

1. Phase 0 + Phase 1 (bugs) — small, and prevents confusing failures later.
2. Phase 2 Accounts → Phase 3 Import — the app becomes usable with real bank data.
3. Phase 4 Budget → Phase 5 Trends — every nav link works.
4. Phase 6 — categorizing becomes quick enough to keep up with monthly.
5. Phases 9–10 (backups, tests, CI) — before trusting it with years of history.
6. Phases 7–8 and "Later" as wanted.
