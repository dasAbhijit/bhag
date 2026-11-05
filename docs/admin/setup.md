# Setup guide

For whoever runs the app. You do this once.

The app is a static site on GitHub Pages. Its data lives in a Supabase project.

## 1. Create the tables

1. Open the Supabase dashboard for your project, then **SQL Editor**.
2. Paste the whole contents of [`supabase/migrations/0001_init.sql`](https://github.com/dasAbhijit/bhag/blob/main/supabase/migrations/0001_init.sql) and run it. It is safe to run again.
3. Then do the same with [`0002_items_split.sql`](https://github.com/dasAbhijit/bhag/blob/main/supabase/migrations/0002_items_split.sql). It lets expenses be split by item. Run the numbered files in order; any later ones go the same way.

This creates the tables, the security rules, the receipt storage bucket, live updates and the daily job for repeating expenses.

## 2. Allow sign-in to come back to the app

In **Authentication, then URL Configuration**:

- **Site URL:** `https://dasabhijit.github.io/bhag/`
- **Redirect URLs:** add `https://dasabhijit.github.io/bhag/**` and, for local work, `http://localhost:5173/bhag/**`

## 3. Choose how people sign in

- **Email link and password** work as soon as you finish step 2. Supabase's built-in email sender is limited to a few emails an hour. For a family group that is usually fine. For more, add your own SMTP provider under **Authentication, then Emails**.
- **Password reset** sends an email with a link back to the app (`/reset-password`). It uses the same redirect URLs as step 2 and the same email limits as above. The link must be opened in the browser where it was requested.
- **Password sign-up** asks people to confirm their email by default. To skip that, turn off **Confirm email** under **Authentication, then Providers, then Email**.
- **Google:** under **Authentication, then Providers, then Google**, add a Google OAuth client ID and secret, and add the callback URL Supabase shows to that Google client.

## 4. Repeating expenses

The migration schedules a daily job with `pg_cron` (about 05:35 India time). If `pg_cron` is not enabled, turn it on under **Database, then Extensions** and run the migration again. Without it, repeating expenses still post, but only when someone opens that group.

## 5. Invoice scanning (optional, per person)

Nothing to set up on the server. Each person adds their own Google Gemini key in the app under **Account**. See [Scan an invoice](../scan-an-invoice.md).

## 6. App settings

The app reads two public values, set as **repository variables** in GitHub (Settings, then Secrets and variables, then Actions, then Variables):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (the `anon` or `sb_publishable_…` key)

These are safe to expose. Row-Level Security decides what each signed-in person can see. **Never** put the `service_role` or secret key in the repository or in these variables.

## 7. Check it works

1. Sign in on two devices with two accounts.
2. Create a group on one, join it from the invite link on the other.
3. Add an expense on one and watch it appear on the other.
4. Add a receipt photo, a comment, and a payment.

## Local development

```bash
cp .env.example .env.local   # add the anon key
npm install
npm run dev                  # http://localhost:5173/bhag/
npm test
```

## What the tests cover

`npm test` runs the money logic (splits, balances, debt simplification, repeating dates, CSV), the form logic for adding expenses, and the whole database migration in an in-memory Postgres, including the access rules for members and strangers.
