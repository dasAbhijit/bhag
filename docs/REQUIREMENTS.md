# Bhag: requirements

What Bhag must do, and how each item has been checked. For how it is built, see the [design](DESIGN.md).

## 1. Purpose and users

Bhag helps a small circle (the owner, friends and family) split shared bills in rupees and keep track of who owes whom. Typical uses: a trip, a flat, a regular dinner, or a running tab between two people.

**Users:** anyone invited to a group. They are not expected to be technical. Most will use a phone.

**Roles:** there is one kind of member. Any member of a group can add, edit and delete expenses and payments, and comment. Only the person who created a group can delete it. The person who runs the app (the owner) sets up Supabase and the hosting once.

## 2. Verification key

| Mark | Meaning |
|---|---|
| **Auto** | Covered by automated tests that run in CI before every deploy (94 tests) |
| **Live** | Checked by hand on the deployed site, https://dasabhijit.github.io/bhag/ |
| **Fixture** | Checked by hand on the real screens with sample data, no backend |
| **Open** | Built, but not yet checked end to end. Needs two real people, a real email, or a phone |

## 3. Functional requirements

### A. Accounts and access

| ID | Requirement | Verified |
|---|---|---|
| A1 | A person can sign in with an email link, with no password | Auto (request). Live: the owner signed in on the deployed site, but which method was used was not recorded |
| A2 | A person can create an account and sign in with an email and a password. The password needs at least 8 characters only when it is being set, so older shorter passwords still sign in | Auto. Live: see A1 |
| A3 | Google sign-in is available when it is switched on in Supabase, and hidden otherwise | Hidden because it is off. Open once enabled |
| A4 | A signed-in person can change their password from Account, or have a reset link emailed to them | Auto. Open for the real email |
| A5 | A person who forgot their password can request a reset link from the sign-in screen, and choose a new password from the page it opens | Auto. Page loads on the live site. Open for the real email |
| A6 | A person can set their display name and sign out | Live (Account page) |
| A7 | A person can only see groups they belong to. Strangers and signed-out visitors see nothing | Auto (database tests as members, strangers and anonymous). Live (anonymous requests are refused) |

### B. Groups and people

| ID | Requirement | Verified |
|---|---|---|
| B1 | Unlimited groups. A member can rename one. Its creator can delete it, which removes everything in it | Auto. Live (group created) |
| B2 | One-on-one tabs with a friend, kept like a group of two | Auto (database), Fixture (screens). Open live |
| B3 | A friend can be added by name before they have an account, and can later claim that name from an invite link, keeping their history | Auto |
| B4 | Each group has an invite link that can be copied, shared and replaced. Anyone with it can join after signing in | Auto (join and preview in the database). Open live |
| B5 | A person can rename a friend who has not joined, or leave a group. Someone who appears in an expense or payment cannot be removed until those are gone | Auto |
| B6 | A group can turn "simplify debts" on or off | Auto (database), Fixture |

### C. Expenses and splitting

| ID | Requirement | Verified |
|---|---|---|
| C1 | Add an expense with a description, amount in ₹, date, category and note | Auto. Live (saved an expense) |
| C2 | Edit an expense, delete it (it stops counting), and restore it | Auto. Live (edit) |
| C3 | An expense can be paid by one person or by several people in uneven amounts. The amounts must add up to the total | Auto |
| C4 | Split **equally**, by **exact amounts**, by **percentage** (up to 2 decimals, totalling 100) or by **shares** (such as 2:1:1). Uneven paise are shared out fairly so the total always matches exactly. The form shows how much is left to assign | Auto |
| C5 | Split **by item**: list the items, tick who had each one, and share tax, service and tip in proportion to each person's items. A discount can be entered as a negative amount. The items stay saved and can be edited later | Auto. Live (one-person group). Open with several people live |
| C6 | An expense can repeat every week, month or year. Month ends are handled. Repeats are posted automatically each day, or when someone opens the group if the daily job is not enabled. Repeats can be paused, resumed and deleted | Auto (database and date rules). Open live. The daily job is not confirmed enabled |
| C7 | Attach photos or PDFs (up to 5 MB) to an expense as receipts. Photos are shrunk on the phone. Only group members can open them. They can be removed | Live (photo) |
| C8 | **Scan an invoice.** Take or choose a photo and the shop, date, category, every item (with quantities) and the tax and charges are filled in, with the total matching the printed bill. The person checks and edits everything before saving. The photo is kept as the receipt. The person supplies their own Google Gemini key in Account, which stays on their device | Auto (parsing, errors, request format). Live (two dummy invoices, clean and tilted photo, matched exactly) |

### D. Balances and settling up

| ID | Requirement | Verified |
|---|---|---|
| D1 | Each group shows every person's net balance, to the paisa | Auto |
| D2 | Debts can be simplified so the group settles with the fewest payments. If A owes B and B owes C, A pays C | Auto (settles everyone, never more than n−1 payments, never worse than the simple method) |
| D3 | A payment can be recorded (pre-filled from a suggestion, or entered by hand) and deleted. It changes balances at once | Auto (database), Fixture |
| D4 | The Friends screen shows the net balance with each person across all shared groups, with a breakdown by group | Auto (core), Fixture. Open live |
| D5 | The home screen shows the total the person is owed and owes, and the balance in each group | Fixture. Live (shows zero) |

### E. Collaboration and records

| ID | Requirement | Verified |
|---|---|---|
| E1 | Changes by anyone appear on everyone's devices without reloading | Open (needs two signed-in people) |
| E2 | An activity log lists every add, edit, delete, payment, comment and join, with before and after values, and lets deleted expenses be restored | Auto. Live (edit logged with old and new amounts) |
| E3 | Each expense has comments. A person can delete their own | Auto (database), Fixture. Open live |
| E4 | A group can be exported to a CSV spreadsheet: one row per expense or payment, one column per person, and a total row | Auto (file contents). Open for the browser download |

### F. Platform and docs

| ID | Requirement | Verified |
|---|---|---|
| F1 | Works in a web browser on a laptop, iPhone and Android, and can be installed to the home screen | Live (installable manifest and icons are served). Open for an actual phone install |
| F2 | Phone-first layout that also works on a wide screen, in light and dark | Fixture (390px and desktop, both themes, no overflow) |
| F3 | Amounts show as ₹ with Indian grouping (12,34,567.89) | Auto |
| F4 | A user guide and a setup guide exist and can be synced to GitBook | Written. GitBook sync is pending the owner |

## 4. Non-functional requirements

| ID | Requirement | How it is met | Verified |
|---|---|---|---|
| N1 | **Money is exact.** No rounding drift. Every split, balance and settlement adds up to the paisa | Whole paise throughout, largest-remainder rounding, exact matching of debts | Auto (randomized checks) |
| N2 | **Security.** Only members can read or change a group's data. Nothing secret is in the code or the build | Row-Level Security, writes only through validated database functions, public key only in the browser | Auto. Live (anonymous calls refused, internal function not exposed) |
| N3 | **Privacy of scanning.** The person's Gemini key is never sent to Bhag's server. A photo leaves the device only when they scan, and only to Google. The key is not in the URL | Key in the browser's local storage, sent only in a request header to Google. A disclosure sits next to the key field | Auto (request shape). Live |
| N4 | **Speed on a phone.** The first screen loads quickly | Screens load on demand. Main script is about 156 KB compressed, and the busiest screen adds about 7 KB | Measured from the build |
| N5 | **Usable by everyone.** Labelled controls, visible focus, large touch targets, dialogs that close with Escape | Built in throughout | Not formally audited |
| N6 | **Clear errors.** Failures say what happened and what to do | Plain messages for sign-in, password, Google/Gemini and database problems | Auto |
| N7 | **Safe releases.** Nothing deploys unless lint, tests and the build pass | GitHub Actions | CI has passed on every release since GitHub Pages was enabled |
| N8 | **Low cost.** No paid service is required | GitHub Pages, Supabase free tier, each person's own Gemini key | Design |
| N9 | **Maintainable.** Money logic is separate from screens and fully tested. Docs are kept with the code | `src/core`, tests, `/docs` | Design |

## 5. Constraints and assumptions

- Hosting is GitHub Pages (static). GitBook is used for documentation only, because it cannot run an app.
- Data lives in one Supabase project. Its free tier limits storage and, for the built-in email sender, a few emails an hour.
- Currency is rupees only.
- Sign-in and reset links work only in the browser that asked for them.
- Scanning needs an internet connection and a Gemini key from the person scanning. On Google's free tier, Google may use what is sent to improve its products.
- Database changes are applied by the owner by hand in the Supabase SQL editor, in numbered order (`0001`, then `0002`).

## 6. Out of scope

Other currencies and conversion, payment links (UPI and similar), push notifications, native app-store apps, offline editing, scanning PDFs (photos only), editing a repeating schedule in place (delete and recreate instead).

## 7. Open items and backlog

**To finish verification (needs people or accounts):**

1. Two people on two devices: invite, join, claim a friend's name, add an expense on one and see it on the other (B4, E1, E3).
2. A real password reset email, opened in the same browser (A4, A5).
3. Install on an iPhone and an Android phone (F1).
4. Confirm the daily job for repeating expenses is enabled, or that repeats post when a group is opened (C6).
5. Download a CSV from a real group and open it in a spreadsheet (E4).
6. Turn on Google sign-in (A3) and connect GitBook (F4), when the owner is ready.

**Candidate improvements:**

- Say "no balance" instead of "not involved" when someone paid for something and owes all of it.
- Show a shop name such as `SPICE ROUTE` in normal capitals.
- Let a repeating schedule be edited.
- Keep a person's Gemini key on their account so it follows them between devices (would need encryption and a clear privacy choice).
- Browser end-to-end tests against a separate test Supabase project.
- Summaries computed on the server if groups grow very large.
- Move scanning to Google's newer API if the current call is retired.

## 8. How the requirements changed

| When | Change |
|---|---|
| Start | Ten features requested: multiple split methods, debt simplification, multiple payers, unlimited groups and friends, recurring expenses, receipt attachments (storage only, no text reading), combined balances, sync across iOS, Android and web, CSV export, activity log and comments. Hosting asked for on GitBook |
| Design review | Mockups of every screen were asked for and added to the design page |
| Hosting | GitBook cannot host an app, so the app moved to GitHub Pages and GitBook holds the docs |
| Scanning | "Scan an invoice and save the entries, editable" was requested. This **replaced** the original "no text reading" rule. Chosen: Google Gemini with each person's own key set in Settings, and an itemised split |
| Passwords | A way to reset a password from the Account section was requested |
