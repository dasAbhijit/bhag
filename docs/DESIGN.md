# Bhag: design

Bhag ("share" in Hindi) is a Splitwise-style app for splitting bills with friends and family. Amounts are in Indian rupees (₹).

## Decisions

| Topic | Decision |
|---|---|
| App hosting | GitHub Pages at `https://dasabhijit.github.io/bhag/`, deployed by GitHub Actions |
| Docs hosting | GitBook, synced from `/docs` in this repo |
| Repo | `dasAbhijit/bhag`, public |
| Client | React, TypeScript, Vite, installable PWA |
| Backend | Supabase (Postgres, Auth, Realtime, Storage) |
| Currency | INR only in v1, shown as ₹ with Indian digit grouping (12,34,567.89) |
| Auth | Magic link and Google sign-in |

GitBook cannot run a web app, so it holds the documentation and links to the app.

## Data model

```
profiles(id, name, email, avatar)
groups(id, name, currency, is_direct, created_by)             -- is_direct = 1-on-1 ledger
group_members(group_id, member_id, user_id NULL, display_name) -- user_id null = not signed up yet
expenses(id, group_id, title, amount_paise, date, category,
         split_method, created_by, deleted_at, recurring_id NULL)
expense_payers(expense_id, member_id, paid_paise)             -- several rows = multiple payers
expense_splits(expense_id, member_id, owed_paise)             -- result of any split method
settlements(id, group_id, from_member, to_member, amount_paise, date)
recurring_templates(id, group_id, template_json, frequency, next_run, end_date, active)
attachments(id, expense_id, storage_path, mime)
comments(id, expense_id, author, body, created_at)
activity_log(id, group_id, actor, action, entity, before_json, after_json, at)
```

- Money is stored as integer paise, never floats.
- Deletes are soft, so the activity log can show what was removed.
- Row-Level Security limits every table to members of the group.
- Groups have a shareable invite link. Placeholder members can be claimed later.

## Core logic (`src/core`)

Pure functions with no UI or network code, covered by unit and property tests.

1. **Split methods.** Every method returns `owed_paise` per person, summing exactly to the total.
   - Equal: divide, then spread leftover paise deterministically.
   - Exact: amounts must sum to the total.
   - Percent: must sum to 100, cents assigned by largest remainder.
   - Shares: weights such as 2:1:1, resolved by largest remainder.
2. **Multiple payers.** Paid amounts must sum to the total. Net per person = paid − owed.
3. **Balances.** Per group: sum of (paid − owed), adjusted by settlements.
4. **Debt simplification.** Match the largest creditor with the largest debtor repeatedly. That yields at most n−1 payments. An exact subset-partition search runs for groups of about 12 or fewer. Finding the true minimum is NP-hard, so larger groups use the greedy result.
5. **Combined balances.** Per friend, sum the direct pairwise balances across all shared groups. These are not simplified, so they match each group page.
6. **Recurring expenses.** A daily Supabase scheduled job posts due templates (weekly, monthly, yearly) and advances `next_run`, clamping month-end dates.
7. **CSV export.** Built in the browser from expenses, settlements and balances.

## Features

| Feature | Approach |
|---|---|
| Split methods | Editor with Equal, Exact, %, Shares tabs and a live "remaining" indicator |
| Debt simplification | Per-group toggle and a "who pays whom" settle-up screen |
| Multiple payers | "Paid by" multi-select with an amount per payer |
| Groups and friends | Unlimited groups plus auto-created 1-on-1 ledgers |
| Recurring | "Repeat" option on an expense and a manage screen |
| Receipts | Private Storage bucket, client-side compression, signed URLs, no OCR |
| Combined balances | Friends tab with net total and per-group breakdown |
| Sync | Supabase Realtime subscriptions |
| CSV export | Button on the group page |
| Activity and comments | Per-group feed with before/after values, comments on each expense |

## Screens

Auth, Dashboard, Group (expenses, balances, settle up, members, activity, export), Expense (add, edit, detail), Friends, Recurring manager, Settings.

## Milestones

| | Scope |
|---|---|
| M0 | Repo, Vite, CI, GitHub Pages deploy, Supabase project, docs |
| M1 | `core/` logic with tests |
| M2 | Auth, groups, invites, members |
| M3 | Expenses (all split methods, multiple payers) and settlements |
| M4 | Realtime sync, activity log, comments |
| M5 | Receipts, CSV export, combined friend balances |
| M6 | Recurring expenses, PWA polish, responsive layout |
| M7 | End-to-end tests, GitBook user guide, release |

## Out of scope for v1

Multi-currency conversion, receipt OCR, payment integrations (UPI), push notifications, native apps.
