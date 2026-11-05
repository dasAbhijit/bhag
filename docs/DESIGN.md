# Bhag: design

Bhag ("share" in Hindi) is a Splitwise-style app for splitting bills with friends and family. Amounts are in Indian rupees (₹). See [Requirements](REQUIREMENTS.md) for what it must do and how each item was checked.

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| App hosting | GitHub Pages at `https://dasabhijit.github.io/bhag/`, deployed by GitHub Actions on every push to `main` | Free, static, sits with the code. GitBook cannot run a web app |
| Docs hosting | GitBook, synced from `/docs` (`.gitbook.yaml`) | GitBook is for documentation only. Sync is set up by the owner |
| Repo | `dasAbhijit/bhag`, public | GitHub Pages on a free account needs a public repo |
| Client | React, TypeScript, Vite, installable PWA | One codebase for web, iPhone and Android |
| Backend | Supabase: Postgres, Auth, Realtime, Storage | Live sync, sign-in and receipt storage without running a server |
| Currency | INR only, shown as ₹ with Indian grouping (12,34,567.89) | The owner's circle uses rupees |
| Sign-in | Email link, email and password, Google when switched on | Google needs an OAuth client that only the owner can create, so it is optional and hidden until enabled |
| Invoice scanning | Google Gemini, called from the browser with each person's own API key kept in `localStorage` | No server function or shared key to pay for or protect. Photos go to Google only when someone scans |
| Writes | Only through validated database functions, never direct table writes | One place enforces membership and that amounts add up |

## 2. Architecture

```
Phone / browser (React PWA)  ──►  GitHub Pages (static files, built by Actions)
        │
        ├──►  Supabase  (Auth, Postgres + RLS, Realtime, Storage, daily cron)
        └──►  Google Gemini  (only when scanning, with the person's own key)

GitBook  ◄──  /docs folder of the repo
```

- The Supabase **publishable (anon) key ships in the browser by design.** Row-Level Security decides what each signed-in person can read. The service-role key is never used.
- Sign-in uses the PKCE flow, so tokens never sit in the URL. Reset and sign-in links must be opened in the browser that asked for them.
- The app shell is cached for offline start-up. Data is never cached, so balances are not stale. There is no offline editing.
- Routes other than the home screen load on demand to keep the first load small.

## 3. Data model

Defined in `supabase/migrations/0001_init.sql` and `0002_items_split.sql`. Money is **integer paise**, never floats.

```
profiles(id → auth.users, name, email)
groups(id, name, currency='INR', is_direct, simplify_debts, invite_code, created_by)
group_members(id, group_id, user_id NULL, display_name)      -- user_id null = friend who has not signed up
expenses(id, group_id, title, amount_paise, expense_date, category,
         split_method, split_input jsonb, note, recurring_id NULL,
         created_by, deleted_at, created_at, updated_at)
expense_payers(expense_id, member_id, paid_paise)            -- several rows = multiple payers
expense_splits(expense_id, member_id, owed_paise)            -- the result of any split method
settlements(id, group_id, from_member, to_member, amount_paise, settled_on, note)
recurring_templates(id, group_id, title, amount_paise, category, split_method, split_input,
                    payers jsonb, splits jsonb, frequency, start_date, end_date,
                    occurrences_posted, next_run, active)
comments(id, expense_id, group_id, author_user_id, author_name, body)
attachments(id, expense_id, group_id, storage_path, mime, size_bytes)
activity_log(id, group_id, actor_user_id, actor_name, action, entity_type, entity_id,
             summary, before_json, after_json, created_at)
```

- `split_method` is one of `equal`, `exact`, `percent`, `shares`, `items`. `split_input` keeps what the person typed (percentages, shares, or the item list with who had each one) so an expense re-opens exactly as entered.
- Deletes of expenses are soft (`deleted_at`) so the activity log can show them and anyone can restore them.
- A one-on-one tab is a group with `is_direct` set and two members.
- A member row can exist before the person signs up. They claim it by name when they open the invite link.
- Receipts live in a private storage bucket `receipts` under `<group_id>/<expense_id>/<file>`. Only members of the group can read them.

## 4. Security model

- **Reads:** Row-Level Security on every table allows a signed-in person to read only rows of groups they belong to. Anonymous users have no access to tables or functions.
- **Writes:** clients have no write grants on tables. Every change goes through a `SECURITY DEFINER` function (`create_group`, `save_expense`, `delete_expense`, `restore_expense`, `save_settlement`, `add_comment`, `join_group`, `save_recurring`, and so on) that checks membership and validates amounts inside one transaction. Internal helpers such as `_log` are not callable by clients.
- **Validation in the database:** payers and splits must be members of the group, have no duplicates, and each sum exactly to the amount.
- **Invites:** a 20-character random code per group. Anyone with the link can join after signing in. **Make a new link** replaces it.
- **Secrets:** only public values are in the repo or the build. The Gemini key is stored only in the person's browser and sent only to Google. It is never sent to Supabase or logged.
- **Bulk accounts:** created through Supabase's admin API by a script the owner runs locally. The admin key is typed at a hidden prompt or read from an environment variable, is never stored or printed, and is refused unless it is a secret or `service_role` key. New-style `sb_secret_` keys go only in the `apikey` header. The results file holding temporary passwords is created readable only by the owner and is git-ignored.
- **Spreadsheet export:** text cells that begin with `=`, `+`, `-` or `@` are prefixed so spreadsheets do not run them as formulas.

## 5. Core logic (`src/core`)

Pure functions with no UI or network code, covered by unit and randomized tests.

1. **Split methods.** Every method returns `owed_paise` per person, summing exactly to the total.
   - **Equal:** divide, then hand out leftover paise deterministically (lowest id first).
   - **Exact:** amounts must sum to the total.
   - **Percent:** up to 2 decimals, must sum to 100. Largest-remainder rounding.
   - **Shares:** weights such as 2:1:1, largest-remainder rounding.
   - **Items:** each line is divided equally among the people who had it. Tax, service and tip are one signed amount (negative for a discount), shared in proportion to each person's item subtotal.
   - Big totals use BigInt internally so nothing overflows.
2. **Multiple payers.** Paid amounts must sum to the total. Net per person = paid − owed.
3. **Balances.** Per group: sum of (paid − owed), adjusted by payments. Positive means the group owes them.
4. **Pairwise debts.** For each expense, people who owe more than they paid are matched in id order to people who paid more than they owed. This keeps every person's total exact to the paisa. A first version that split each debt proportionally was off by a paisa and was replaced.
5. **Debt simplification.** Repeatedly pay the biggest creditor from the biggest debtor (at most n−1 payments). For up to 14 people with a balance, an exact bitmask search first splits the group into the most zero-sum subgroups, then settles each one. Finding the true minimum is NP-hard, so bigger groups use the greedy result.
6. **Combined balances.** Per friend, add up the direct pairwise balances across all shared groups. These are not simplified, so they match each group page. People are matched across groups by their account.
7. **Recurring expenses.** Occurrence *n* is the start date plus *n* weeks, months or years, counted from the start. A monthly bill on the 31st lands on the 28th/29th/30th in short months. The database and the app use the same rule. A daily job (`pg_cron`, about 05:35 India time) posts anything due. If cron is not enabled, due items are posted when someone opens the group.
8. **CSV export.** Built in the browser: one row per expense or payment, one column per person (paid minus owed), and a total row.
9. **Invoice scan calls.** Temporary Google errors (5xx) and dropped connections are retried twice, then once more with the lighter model `gemini-3.5-flash-lite`, and the result says so. Errors that retrying cannot fix (bad key, quota, unknown model, blocked image) are shown at once. Every error carries a small troubleshooting line (status, model, photo size, time).
10. **Invoice scan parsing.** The model's reply is treated as untrusted. It is parsed defensively into paise, valid dates and known categories. Negative lines become discounts. The charges amount is *invoice total − items*, so the total always matches the printed bill, and a warning shows when items and stated charges disagree.

## 6. Features

| Feature | Approach |
|---|---|
| Split methods | Editor with Equal, Exact, %, Shares and Items tabs and a live "left to assign" indicator |
| Debt simplification | Per-group toggle and a "who pays whom" settle-up screen with a Settle button |
| Multiple payers | "Several people paid" with an amount per person |
| Groups and friends | Unlimited groups plus one-on-one tabs. Invite link, friends added by name before they join |
| Recurring | "Repeat" on a new expense, and a screen to pause, resume or delete schedules |
| Receipts | Private storage, photos shrunk on the phone first, opened through short-lived signed links |
| Invoice scanning | Scan invoice fills description, date, category, items and charges, and switches to the Items split. Everything stays editable. The photo is attached as the receipt |
| Combined balances | Friends tab with the net total and a per-group breakdown |
| Live sync | Supabase Realtime change events trigger a refresh. The app also refreshes when it comes back to the foreground |
| CSV export | Button on the People tab |
| Activity and comments | Per-group feed with what changed and who did it, restore for deleted expenses, comments on each expense |
| Password | Change it or email a reset link from Account. Forgot password on the sign-in screen. The reset email opens a "choose a new password" page |
| Install | Web app manifest, icons, and an install hint for iPhone and Android |

## 7. Screens

Phone-first. On wide screens the same layout centres in a 760px column and the bottom tab bar becomes a top menu. Green means someone owes you, amber means you owe. Light and dark themes follow the device. Mockups of every screen are on the [design page](https://claude.ai/artifact/2kT9FZ66Wj1xjVZNoRrT5h) (private to the owner).

| Screen | What it shows |
|---|---|
| Sign in | Email link or password, Forgot password, Google when enabled |
| Home | Total you are owed and owe, then groups and one-on-one tabs, each with your balance. `+ Group` and `+ Friend` |
| Group, Expenses | Expenses and payments newest first, with "you lent" or "you owe" per row. `+ Add expense` |
| Group, Balances | Net balance per person, then the settle-up payments, each with a Settle button |
| Group, Activity | Every add, edit, delete, payment and comment with what changed. Deleted expenses can be restored |
| Group, People | Members, invite link (copy, share, make a new one), simplify toggle, repeating expenses, CSV export, delete group |
| Add or edit expense | Description, amount, date, category, paid by, split tabs, repeat, receipt photos, and a Scan invoice card |
| Expense detail | Who paid and who owes what, the item list for itemised splits, receipts, comments, edit and delete |
| Friends | Net balance with each person across all shared groups, expandable by group |
| Recurring | Schedules with next date, pause, resume, delete |
| Account | Name, change password or email a reset link, invoice-scanning key and model, install hint, sign out |
| Reset password | Opened from the reset email. Choose a new password |
| Join | Opened from an invite link. Pick which friend you are, or join as new |

## 8. Testing and quality

| Layer | How | Count |
|---|---|---|
| Money logic | Unit and randomized tests (split totals, itemised splits, balances agree with ledger, simplification settles everyone with no more than n−1 payments, recurrence, CSV) | 35 |
| Database | The real migrations run in an in-memory Postgres (PGlite) with stand-ins for Supabase's auth and storage. Tests act as different users: members, strangers, anonymous. Includes the bulk add-to-group SQL | 19 |
| Screens | Add-expense form (all split methods, several payers, repeat, items, scanning, error cases), sign-in and forgot password, password form | 23 |
| Gemini client, password helpers, activity text | Faked Google and Supabase replies and errors, including temporary errors, retries and the fallback model | 25 |
| Admin script | `scripts/bulk-add-users.mjs` run as a real command against a stand-in Supabase: request headers for both key kinds, results file and its permissions, failures, dry run, refusing the wrong key, confirmation | 11 |
| **Total** | `npm test`, also run in CI before every deploy | **113** |

Also checked by hand: layout at a 390px phone width and desktop, light and dark, no horizontal overflow and no console errors, using fixture data. On the live site: sign-in screen, key test, scanning two dummy invoices (clean and tilted photo), saving, receipt upload, editing and the activity log.

Not covered by automated browser tests: anything needing two real signed-in people (live sync between devices, invite and join), real emails, the daily job, Google sign-in, and phone install. The [setup guide](admin/setup.md) lists a manual two-device check.

## 9. Known limits and risks

- **Google busy errors.** New Gemini models sometimes answer "overloaded" (503). Retries and the fallback model reduce this but cannot remove it.
- **Gemini API drift.** Google's docs now lead with a newer "Interactions" endpoint. The app uses the older `generateContent` call, which works today. The model name is changeable in Account.
- **Scan accuracy** is good on clean and tilted printed bills. Handwritten, crumpled or very long receipts are untested. The person always reviews before saving.
- **Free tier privacy.** On Google's free tier, what is sent for scanning may be used to improve its products. The app says so next to the key field.
- **Key per device.** The Gemini key is stored per browser, so it is added again on each device.
- **Email limits.** Supabase's built-in email sender allows only a few emails an hour. Sign-in and reset emails share that limit.
- **Same-browser links.** Sign-in and reset links only work in the browser that asked for them.
- **All data is loaded.** The home screen loads every group, expense and payment the person can see, in pages of 1,000 rows. That suits family and friend use. Very large histories would need server-side summaries.
- **Schedules cannot be edited**, only paused or deleted and recreated.
- **A person with expenses cannot be removed** from a group until those are deleted.
- **Wording:** a row where someone paid for something and also owes all of it says "not involved". It should say there is no balance.

## 10. Milestones

| | Scope | Status |
|---|---|---|
| M0 | Repo, Vite, CI, GitHub Pages deploy, Supabase project, docs | Done |
| M1 | `core/` logic with tests | Done |
| M2 | Auth, groups, invites, members | Done |
| M3 | Expenses (all split methods, multiple payers) and settlements | Done |
| M4 | Realtime sync, activity log, comments | Done |
| M5 | Receipts, CSV export, combined friend balances | Done |
| M6 | Recurring expenses, PWA install, responsive layout | Done |
| M7 | Tests, GitBook user guide, setup guide, release | Done. Browser end-to-end tests across two real users are not included |
| Added | Invoice scanning and the Items split (Gemini, migration 0002) | Done and checked live |
| Added | Change and reset password | Done. Emails not yet exercised |

## 11. Out of scope

Other currencies and conversion, payment links (UPI and similar), push notifications, native app-store apps, offline editing, scanning PDFs (photos only).
