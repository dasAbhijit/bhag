# Add many people at once

For whoever runs the app. This creates accounts that are already confirmed, so people can sign in straight away on the **Password** tab. No emails are sent, so Supabase's low hourly email limit does not matter. No app change or redeploy is needed.

You do this on your own computer, once per batch. You need [Node.js](https://nodejs.org) 18 or newer.

## 1. Get an admin key

In Supabase open your project, then **Project Settings → API Keys**.

- Preferred: under **Secret keys**, create a new key for this job (for example `bulk-users`) and copy it. It starts with `sb_secret_`. You can delete it when you are done.
- Older projects: the **Legacy** tab has the `service_role` key. It also works.

This key can do anything in your project. Never put it in the repository, in GitHub, in the app, or in a chat. The publishable (`sb_publishable_…`) and `anon` keys cannot create users, and the script refuses them.

## 2. Make the list

Create a file called `users.csv` **outside the repository** (for example in `~/Documents/bhag-users/`), or inside `scripts/`, where git ignores it:

```
email,name,password
asha@example.com,Asha Rao,
ben@example.com,"Ben, Jr",
carol@example.com,Carol,My-Own-Pass-77
```

- `email` is required. `name` is what other people see. If you leave it out, the part before the `@` is used.
- Leave `password` blank and a strong temporary one is generated (like `Kp7m-Wn2x-Rt9q`). If you give one, it needs at least 8 characters.
- Put a value in "double quotes" if it contains a comma.

## 3. Check, then create

From the repository folder:

```bash
npm run users:add -- ~/Documents/bhag-users/users.csv --dry-run   # checks the file, changes nothing
npm run users:add -- ~/Documents/bhag-users/users.csv             # creates the accounts
```

The second command asks you to paste the key (what you type is hidden, and it is never saved), then asks you to type `yes`. It prints one line per person: `created` or `FAILED` with the reason. A person who already has an account fails with "already been registered" and nothing about them changes.

## 4. Hand out the passwords

The script saves `users-results.csv` next to your file, readable only by you. It lists each person, whether they were created, and any **generated temporary password**. Send each password to its owner privately (not in a group chat), then delete the file.

Tell people to:

1. Open https://dasabhijit.github.io/bhag/ and choose **Password**.
2. Sign in with their email and the temporary password.
3. Change it under **Account → Password**.

If someone loses their password they can use **Forgot password?** on the sign-in screen.

## 5. Put them in a group (optional)

Creating accounts does not add anyone to a group. Either send people the group's invite link (People tab), or add them all at once in the Supabase **SQL Editor**. Take the group id from the group page's address (`…/groups/<id>`):

```sql
insert into public.group_members (group_id, user_id, display_name)
select '<GROUP-ID>', u.id, coalesce(nullif(p.name, ''), split_part(u.email, '@', 1))
from auth.users u join public.profiles p on p.id = u.id
where u.email in ('asha@example.com', 'ben@example.com', 'carol@example.com')
on conflict do nothing;
```

It is safe to run twice, and people already in the group are skipped. Each person's name in the group is taken from their profile. Adding people this way does not add an entry to the activity log.

## 6. Afterwards

- Check **Authentication → Users** in Supabase to see the new accounts.
- Delete the secret key you made for this job, and delete `users-results.csv`.
- If the key was ever exposed, delete it in the same place. That makes it stop working.
