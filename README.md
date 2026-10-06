# on-a-budget
A personalized budgeting app for my personal finances

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Data is stored locally in `data/budget.sqlite`, which is created on first run and is never committed.

To try things out without touching your real data, point the app at a separate database file:

```bash
BUDGET_DB_PATH=data/test-budget.sqlite npm run dev
```

See [ROADMAP.md](ROADMAP.md) for current status and next steps.
