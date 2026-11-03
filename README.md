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

## AI category suggestions

After each CSV import, a local [Ollama](https://ollama.com) model suggests categories for whatever your rules didn't cover, and you review them before anything changes. Nothing leaves your computer. Install Ollama, keep it running, and download the model:

```bash
ollama pull qwen2.5:14b
```

Without Ollama, imports still work and you can categorize by hand. Set `OLLAMA_MODEL` or `OLLAMA_URL` in `.env.local` to use a different model or address. To see how well a model does on your own categorized transactions, run `npm run eval:ai -- qwen2.5:14b`.

See [ROADMAP.md](ROADMAP.md) for current status and next steps.
