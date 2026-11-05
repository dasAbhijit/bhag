# Bhag

Split bills with friends and family. Amounts in ₹.

- **Live app:** https://dasabhijit.github.io/bhag/
- **User guide:** [docs/](docs/README.md)
- **Requirements:** [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- **Design:** [docs/DESIGN.md](docs/DESIGN.md)
- **Setup (Supabase, sign-in, repeating jobs):** [docs/admin/setup.md](docs/admin/setup.md)

## Stack

React, TypeScript and Vite as an installable PWA on GitHub Pages. Supabase for sign-in, Postgres with Row-Level Security, live sync and receipt storage.

## Develop

```bash
cp .env.example .env.local   # add the Supabase anon key
npm install
npm run dev
npm test
```

Only the Supabase URL and the anon/publishable key are used in the browser. Never commit the service-role key.

## Layout

```
src/core/       money, splits, balances, debt simplification, recurrence, CSV (pure, tested)
src/data/       API calls, ledger glue, activity text
src/pages/      screens
supabase/       SQL migration (tables, security rules, functions, storage, cron)
docs/           user guide (synced to GitBook) and design
```
