-- Bhag schema. Run once in the Supabase SQL editor (safe to re-run).
--
-- Security model:
--   * Every table has Row-Level Security. Signed-in users can only READ rows of groups they belong to.
--   * Clients never write tables directly. All writes go through the functions below, which check
--     membership and validate amounts inside one transaction.
--   * Money is whole paise (bigint). Currency is INR.

------------------------------------------------------------------------------------------------
-- Profiles
------------------------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''),
             split_part(coalesce(new.email, ''), '@', 1), ''),
    new.email)
  on conflict (id) do nothing;
  return new;
end $fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill users created before this migration.
insert into public.profiles (id, name, email)
select u.id, coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(u.email, ''), '@', 1), ''), u.email
from auth.users u
on conflict (id) do nothing;

------------------------------------------------------------------------------------------------
-- Groups and members
------------------------------------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  currency text not null default 'INR' check (currency = 'INR'),
  is_direct boolean not null default false,          -- true for a 1-on-1 ledger with a friend
  simplify_debts boolean not null default true,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,   -- null = friend who has not signed up yet
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index if not exists group_members_user_unique
  on public.group_members (group_id, user_id) where user_id is not null;
create index if not exists group_members_user_idx on public.group_members (user_id);

create or replace function public.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid())
$fn$;

create or replace function public.today_ist() returns date
language sql stable as $fn$ select (now() at time zone 'Asia/Kolkata')::date $fn$;

------------------------------------------------------------------------------------------------
-- Recurring templates (before expenses, which reference them)
------------------------------------------------------------------------------------------------
create table if not exists public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  amount_paise bigint not null check (amount_paise > 0),
  category text not null default 'general',
  split_method text not null default 'equal' check (split_method in ('equal', 'exact', 'percent', 'shares')),
  split_input jsonb,
  payers jsonb not null,           -- [{member_id, paid_paise}]
  splits jsonb not null,           -- [{member_id, owed_paise}]
  frequency text not null check (frequency in ('weekly', 'monthly', 'yearly')),
  start_date date not null,
  end_date date,
  occurrences_posted int not null default 0,
  next_run date not null,
  active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists recurring_due_idx on public.recurring_templates (next_run) where active;

------------------------------------------------------------------------------------------------
-- Expenses
------------------------------------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  expense_date date not null default current_date,
  category text not null default 'general',
  split_method text not null default 'equal' check (split_method in ('equal', 'exact', 'percent', 'shares')),
  split_input jsonb,                -- what the user typed (percents, shares, exact amounts), to re-open the editor
  note text,
  recurring_id uuid references public.recurring_templates (id) on delete set null,
  created_by uuid references auth.users (id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_group_idx on public.expenses (group_id, expense_date desc);

create table if not exists public.expense_payers (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  member_id uuid not null references public.group_members (id),
  paid_paise bigint not null check (paid_paise > 0),
  primary key (expense_id, member_id)
);

create table if not exists public.expense_splits (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  member_id uuid not null references public.group_members (id),
  owed_paise bigint not null check (owed_paise > 0),
  primary key (expense_id, member_id)
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_member uuid not null references public.group_members (id),   -- paid
  to_member uuid not null references public.group_members (id),     -- received
  amount_paise bigint not null check (amount_paise > 0),
  settled_on date not null default current_date,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (from_member <> to_member)
);
create index if not exists settlements_group_idx on public.settlements (group_id, settled_on desc);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  author_user_id uuid references auth.users (id),
  author_name text not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists comments_expense_idx on public.comments (expense_id, created_at);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  storage_path text not null unique,
  mime text not null,
  size_bytes int not null,
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists attachments_expense_idx on public.attachments (expense_id);

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  actor_user_id uuid,
  actor_name text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_group_idx on public.activity_log (group_id, id desc);

------------------------------------------------------------------------------------------------
-- Row-Level Security: read-only for members. No write policies exist on purpose.
------------------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.recurring_templates enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_payers enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.activity_log enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated using (public.is_member(id));
drop policy if exists members_select on public.group_members;
create policy members_select on public.group_members for select to authenticated using (public.is_member(group_id));
drop policy if exists recurring_select on public.recurring_templates;
create policy recurring_select on public.recurring_templates for select to authenticated using (public.is_member(group_id));
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated using (public.is_member(group_id));
drop policy if exists payers_select on public.expense_payers;
create policy payers_select on public.expense_payers for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.group_id)));
drop policy if exists splits_select on public.expense_splits;
create policy splits_select on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.group_id)));
drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements for select to authenticated using (public.is_member(group_id));
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated using (public.is_member(group_id));
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select to authenticated using (public.is_member(group_id));
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log for select to authenticated using (public.is_member(group_id));

------------------------------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
------------------------------------------------------------------------------------------------
create or replace function public._log(
  gid uuid, act text, etype text, eid uuid, summ text, b jsonb, a jsonb
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.activity_log (group_id, actor_user_id, actor_name, action, entity_type, entity_id, summary, before_json, after_json)
  values (
    gid, auth.uid(),
    coalesce((select display_name from public.group_members where group_id = gid and user_id = auth.uid() limit 1),
             case when auth.uid() is null then 'Recurring' else 'Someone' end),
    act, etype, eid, summ, b, a);
end $fn$;

create or replace function public._require_member(gid uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not public.is_member(gid) then
    raise exception 'You are not a member of this group' using errcode = '42501';
  end if;
end $fn$;

create or replace function public._expense_json(eid uuid) returns jsonb
language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'title', e.title, 'amount_paise', e.amount_paise, 'date', e.expense_date, 'category', e.category,
    'split_method', e.split_method, 'note', e.note,
    'payers', coalesce((select jsonb_agg(jsonb_build_object('member_id', p.member_id, 'paid_paise', p.paid_paise) order by p.member_id)
                        from public.expense_payers p where p.expense_id = e.id), '[]'::jsonb),
    'splits', coalesce((select jsonb_agg(jsonb_build_object('member_id', s.member_id, 'owed_paise', s.owed_paise) order by s.member_id)
                        from public.expense_splits s where s.expense_id = e.id), '[]'::jsonb))
  from public.expenses e where e.id = eid
$fn$;

-- Checks that payers and splits are valid members of the group and each add up to the amount.
create or replace function public._check_allocation(gid uuid, amt bigint, payers jsonb, splits jsonb) returns void
language plpgsql security definer set search_path = public as $fn$
declare total bigint; bad int; dup int;
begin
  if amt is null or amt <= 0 then raise exception 'Amount must be more than zero'; end if;
  if jsonb_typeof(payers) is distinct from 'array' or jsonb_array_length(payers) = 0 then
    raise exception 'Choose who paid'; end if;
  if jsonb_typeof(splits) is distinct from 'array' or jsonb_array_length(splits) = 0 then
    raise exception 'Choose who shares this expense'; end if;

  select coalesce(sum(x.paid_paise), 0), count(*) filter (where x.paid_paise is null or x.paid_paise <= 0
           or not exists (select 1 from public.group_members m where m.id = x.member_id and m.group_id = gid)),
         count(*) - count(distinct x.member_id)
    into total, bad, dup
    from jsonb_to_recordset(payers) as x(member_id uuid, paid_paise bigint);
  if bad > 0 or dup > 0 then raise exception 'Invalid payer list'; end if;
  if total <> amt then raise exception 'Amounts paid must add up to the total'; end if;

  select coalesce(sum(x.owed_paise), 0), count(*) filter (where x.owed_paise is null or x.owed_paise < 0
           or not exists (select 1 from public.group_members m where m.id = x.member_id and m.group_id = gid)),
         count(*) - count(distinct x.member_id)
    into total, bad, dup
    from jsonb_to_recordset(splits) as x(member_id uuid, owed_paise bigint);
  if bad > 0 or dup > 0 then raise exception 'Invalid split list'; end if;
  if total <> amt then raise exception 'Shares must add up to the total'; end if;
end $fn$;

create or replace function public.recurrence_date(start date, freq text, n int) returns date
language sql immutable as $fn$
  select case freq
    when 'weekly' then start + 7 * n
    when 'monthly' then (start + make_interval(months => n))::date
    when 'yearly' then (start + make_interval(years => n))::date
  end
$fn$;

------------------------------------------------------------------------------------------------
-- Groups and members (client-callable)
------------------------------------------------------------------------------------------------
create or replace function public.create_group(p_name text, p_is_direct boolean default false, p_friend_name text default null)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare gid uuid; me text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into public.groups (name, is_direct, created_by) values (btrim(p_name), p_is_direct, auth.uid()) returning id into gid;
  select coalesce(nullif(name, ''), nullif(split_part(coalesce(email, ''), '@', 1), ''), 'Me') into me from public.profiles where id = auth.uid();
  insert into public.group_members (group_id, user_id, display_name) values (gid, auth.uid(), coalesce(me, 'Me'));
  if p_friend_name is not null and btrim(p_friend_name) <> '' then
    insert into public.group_members (group_id, display_name) values (gid, btrim(p_friend_name));
  end if;
  perform public._log(gid, 'group_created', 'group', gid, btrim(p_name), null, null);
  return gid;
end $fn$;

create or replace function public.update_group(p_group uuid, p_name text, p_simplify boolean) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  perform public._require_member(p_group);
  update public.groups set name = btrim(p_name), simplify_debts = p_simplify where id = p_group;
end $fn$;

create or replace function public.delete_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not exists (select 1 from public.groups where id = p_group and created_by = auth.uid()) then
    raise exception 'Only the person who created the group can delete it' using errcode = '42501';
  end if;
  -- Clear money rows first: members are protected from deletion while expenses reference them.
  delete from public.expenses where group_id = p_group;
  delete from public.settlements where group_id = p_group;
  delete from public.groups where id = p_group;
end $fn$;

create or replace function public.rotate_invite_code(p_group uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare c text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
begin
  perform public._require_member(p_group);
  update public.groups set invite_code = c where id = p_group;
  return c;
end $fn$;

create or replace function public.add_member(p_group uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare mid uuid;
begin
  perform public._require_member(p_group);
  insert into public.group_members (group_id, display_name) values (p_group, btrim(p_name)) returning id into mid;
  perform public._log(p_group, 'member_added', 'member', mid, btrim(p_name), null, null);
  return mid;
end $fn$;

create or replace function public.rename_member(p_member uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $fn$
declare gid uuid; old text;
begin
  select group_id, display_name into gid, old from public.group_members
   where id = p_member and (user_id is null or user_id = auth.uid());
  if gid is null then raise exception 'You can only rename yourself or friends who have not joined yet'; end if;
  perform public._require_member(gid);
  update public.group_members set display_name = btrim(p_name) where id = p_member;
  perform public._log(gid, 'member_renamed', 'member', p_member, btrim(p_name), jsonb_build_object('name', old), jsonb_build_object('name', btrim(p_name)));
end $fn$;

create or replace function public.remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare gid uuid; nm text;
begin
  select group_id, display_name into gid, nm from public.group_members
   where id = p_member and (user_id is null or user_id = auth.uid());
  if gid is null then raise exception 'You can only remove yourself or friends who have not joined yet'; end if;
  perform public._require_member(gid);
  begin
    delete from public.group_members where id = p_member;
  exception when foreign_key_violation then
    raise exception 'This person has expenses or payments in the group, so they cannot be removed';
  end;
  perform public._log(gid, 'member_removed', 'member', p_member, nm, null, null);
end $fn$;

create or replace function public.get_invite_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into g from public.groups where invite_code = p_code;
  if g.id is null then raise exception 'This invite link is not valid'; end if;
  return jsonb_build_object(
    'group_id', g.id, 'name', g.name, 'is_direct', g.is_direct, 'already_member', public.is_member(g.id),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.display_name, 'claimed', m.user_id is not null) order by m.created_at)
                         from public.group_members m where m.group_id = g.id), '[]'::jsonb));
end $fn$;

create or replace function public.join_group(p_code text, p_claim uuid default null) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare gid uuid; me text; mid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select id into gid from public.groups where invite_code = p_code;
  if gid is null then raise exception 'This invite link is not valid'; end if;
  if public.is_member(gid) then return gid; end if;
  select coalesce(nullif(name, ''), nullif(split_part(coalesce(email, ''), '@', 1), ''), 'Me') into me from public.profiles where id = auth.uid();
  if p_claim is not null then
    update public.group_members set user_id = auth.uid() where id = p_claim and group_id = gid and user_id is null returning id into mid;
    if mid is null then raise exception 'That person has already been claimed'; end if;
  else
    insert into public.group_members (group_id, user_id, display_name) values (gid, auth.uid(), coalesce(me, 'Me')) returning id into mid;
  end if;
  perform public._log(gid, 'member_joined', 'member', mid, null, null, null);
  return gid;
end $fn$;

------------------------------------------------------------------------------------------------
-- Expenses, settlements, comments, attachments (client-callable)
------------------------------------------------------------------------------------------------
-- p: {id?, group_id, title, amount_paise, expense_date, category, split_method, split_input, note,
--     payers: [{member_id, paid_paise}], splits: [{member_id, owed_paise}]}
create or replace function public.save_expense(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  gid uuid := (p ->> 'group_id')::uuid;
  eid uuid := nullif(p ->> 'id', '')::uuid;
  amt bigint := (p ->> 'amount_paise')::bigint;
  b jsonb; act text;
begin
  perform public._require_member(gid);
  perform public._check_allocation(gid, amt, p -> 'payers', p -> 'splits');

  if eid is null then
    insert into public.expenses (group_id, title, amount_paise, expense_date, category, split_method, split_input, note, created_by)
    values (gid, btrim(p ->> 'title'), amt, coalesce(nullif(p ->> 'expense_date', '')::date, public.today_ist()),
            coalesce(nullif(p ->> 'category', ''), 'general'), coalesce(nullif(p ->> 'split_method', ''), 'equal'),
            p -> 'split_input', nullif(btrim(coalesce(p ->> 'note', '')), ''), auth.uid())
    returning id into eid;
    act := 'expense_added';
  else
    b := public._expense_json(eid);
    if b is null or not exists (select 1 from public.expenses where id = eid and group_id = gid and deleted_at is null) then
      raise exception 'Expense not found';
    end if;
    update public.expenses set
      title = btrim(p ->> 'title'), amount_paise = amt,
      expense_date = coalesce(nullif(p ->> 'expense_date', '')::date, expense_date),
      category = coalesce(nullif(p ->> 'category', ''), 'general'),
      split_method = coalesce(nullif(p ->> 'split_method', ''), 'equal'),
      split_input = p -> 'split_input', note = nullif(btrim(coalesce(p ->> 'note', '')), ''), updated_at = now()
    where id = eid;
    delete from public.expense_payers where expense_id = eid;
    delete from public.expense_splits where expense_id = eid;
    act := 'expense_edited';
  end if;

  insert into public.expense_payers (expense_id, member_id, paid_paise)
    select eid, x.member_id, x.paid_paise from jsonb_to_recordset(p -> 'payers') as x(member_id uuid, paid_paise bigint);
  insert into public.expense_splits (expense_id, member_id, owed_paise)
    select eid, x.member_id, x.owed_paise from jsonb_to_recordset(p -> 'splits') as x(member_id uuid, owed_paise bigint)
    where x.owed_paise > 0;

  perform public._log(gid, act, 'expense', eid, btrim(p ->> 'title'), b, public._expense_json(eid));
  return eid;
end $fn$;

create or replace function public.delete_expense(p_expense uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare gid uuid; t text;
begin
  select group_id, title into gid, t from public.expenses where id = p_expense and deleted_at is null;
  if gid is null then raise exception 'Expense not found'; end if;
  perform public._require_member(gid);
  update public.expenses set deleted_at = now(), updated_at = now() where id = p_expense;
  perform public._log(gid, 'expense_deleted', 'expense', p_expense, t, public._expense_json(p_expense), null);
end $fn$;

create or replace function public.restore_expense(p_expense uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare gid uuid; t text;
begin
  select group_id, title into gid, t from public.expenses where id = p_expense and deleted_at is not null;
  if gid is null then raise exception 'Expense not found'; end if;
  perform public._require_member(gid);
  update public.expenses set deleted_at = null, updated_at = now() where id = p_expense;
  perform public._log(gid, 'expense_restored', 'expense', p_expense, t, null, public._expense_json(p_expense));
end $fn$;

-- p: {group_id, from_member, to_member, amount_paise, settled_on, note}
create or replace function public.save_settlement(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare gid uuid := (p ->> 'group_id')::uuid; sid uuid; f uuid := (p ->> 'from_member')::uuid; t uuid := (p ->> 'to_member')::uuid;
begin
  perform public._require_member(gid);
  if f = t then raise exception 'Choose two different people'; end if;
  if (select count(*) from public.group_members where group_id = gid and id in (f, t)) <> 2 then
    raise exception 'Both people must be in the group'; end if;
  insert into public.settlements (group_id, from_member, to_member, amount_paise, settled_on, note, created_by)
  values (gid, f, t, (p ->> 'amount_paise')::bigint, coalesce(nullif(p ->> 'settled_on', '')::date, public.today_ist()),
          nullif(btrim(coalesce(p ->> 'note', '')), ''), auth.uid())
  returning id into sid;
  perform public._log(gid, 'payment_added', 'settlement', sid, null, null,
    (select to_jsonb(s) - 'created_by' from public.settlements s where s.id = sid));
  return sid;
end $fn$;

create or replace function public.delete_settlement(p_settlement uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare s public.settlements;
begin
  select * into s from public.settlements where id = p_settlement;
  if s.id is null then raise exception 'Payment not found'; end if;
  perform public._require_member(s.group_id);
  delete from public.settlements where id = p_settlement;
  perform public._log(s.group_id, 'payment_deleted', 'settlement', s.id, null, to_jsonb(s) - 'created_by', null);
end $fn$;

create or replace function public.add_comment(p_expense uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare gid uuid; t text; cid uuid; nm text;
begin
  select group_id, title into gid, t from public.expenses where id = p_expense;
  if gid is null then raise exception 'Expense not found'; end if;
  perform public._require_member(gid);
  select display_name into nm from public.group_members where group_id = gid and user_id = auth.uid();
  insert into public.comments (expense_id, group_id, author_user_id, author_name, body)
  values (p_expense, gid, auth.uid(), coalesce(nm, 'Someone'), btrim(p_body)) returning id into cid;
  perform public._log(gid, 'comment_added', 'expense', p_expense, t, null, jsonb_build_object('body', btrim(p_body)));
  return cid;
end $fn$;

create or replace function public.delete_comment(p_comment uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare c public.comments;
begin
  select * into c from public.comments where id = p_comment and author_user_id = auth.uid();
  if c.id is null then raise exception 'You can only delete your own comments'; end if;
  delete from public.comments where id = p_comment;
end $fn$;

-- Storage path convention: <group_id>/<expense_id>/<file>
create or replace function public.add_attachment(p_expense uuid, p_path text, p_mime text, p_size int) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare gid uuid; t text; aid uuid;
begin
  select group_id, title into gid, t from public.expenses where id = p_expense;
  if gid is null then raise exception 'Expense not found'; end if;
  perform public._require_member(gid);
  if split_part(p_path, '/', 1) <> gid::text or split_part(p_path, '/', 2) <> p_expense::text then
    raise exception 'Invalid file path'; end if;
  insert into public.attachments (expense_id, group_id, storage_path, mime, size_bytes, uploaded_by)
  values (p_expense, gid, p_path, p_mime, p_size, auth.uid()) returning id into aid;
  perform public._log(gid, 'receipt_added', 'expense', p_expense, t, null, null);
  return aid;
end $fn$;

create or replace function public.delete_attachment(p_attachment uuid) returns text
language plpgsql security definer set search_path = public as $fn$
declare a public.attachments;
begin
  select * into a from public.attachments where id = p_attachment;
  if a.id is null then raise exception 'File not found'; end if;
  perform public._require_member(a.group_id);
  delete from public.attachments where id = p_attachment;
  return a.storage_path;
end $fn$;

------------------------------------------------------------------------------------------------
-- Recurring expenses
------------------------------------------------------------------------------------------------
-- p: {group_id, title, amount_paise, category, split_method, split_input, payers, splits,
--     frequency, start_date, end_date?}. Posts the first expense now if start_date is today or earlier.
create or replace function public.save_recurring(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare gid uuid := (p ->> 'group_id')::uuid; rid uuid; sd date := (p ->> 'start_date')::date;
begin
  perform public._require_member(gid);
  perform public._check_allocation(gid, (p ->> 'amount_paise')::bigint, p -> 'payers', p -> 'splits');
  insert into public.recurring_templates (group_id, title, amount_paise, category, split_method, split_input, payers, splits,
                                          frequency, start_date, end_date, next_run, created_by)
  values (gid, btrim(p ->> 'title'), (p ->> 'amount_paise')::bigint, coalesce(nullif(p ->> 'category', ''), 'general'),
          coalesce(nullif(p ->> 'split_method', ''), 'equal'), p -> 'split_input', p -> 'payers', p -> 'splits',
          p ->> 'frequency', sd, nullif(p ->> 'end_date', '')::date, sd, auth.uid())
  returning id into rid;
  perform public._log(gid, 'recurring_added', 'recurring', rid, btrim(p ->> 'title'), null, null);
  perform public.post_due_recurring(gid);
  return rid;
end $fn$;

create or replace function public.set_recurring_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $fn$
declare gid uuid;
begin
  select group_id into gid from public.recurring_templates where id = p_id;
  if gid is null then raise exception 'Schedule not found'; end if;
  perform public._require_member(gid);
  update public.recurring_templates set active = p_active where id = p_id;
  perform public.post_due_recurring(gid);
end $fn$;

create or replace function public.delete_recurring(p_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare gid uuid; t text;
begin
  select group_id, title into gid, t from public.recurring_templates where id = p_id;
  if gid is null then raise exception 'Schedule not found'; end if;
  perform public._require_member(gid);
  delete from public.recurring_templates where id = p_id;
  perform public._log(gid, 'recurring_deleted', 'recurring', p_id, t, null, null);
end $fn$;

-- Posts every due occurrence. Called daily by pg_cron (no arguments, no signed-in user) and by the app
-- for one group when it opens, so schedules still run if cron is not enabled.
create or replace function public.post_due_recurring(p_group uuid default null) returns int
language plpgsql security definer set search_path = public as $fn$
declare t public.recurring_templates; n int; d date; posted int := 0; cnt int; eid uuid; today date := public.today_ist();
begin
  if p_group is null then
    if auth.uid() is not null then raise exception 'Not allowed' using errcode = '42501'; end if;
  else
    perform public._require_member(p_group);
  end if;

  for t in
    select * from public.recurring_templates
    where active and next_run <= today and (p_group is null or group_id = p_group)
    order by created_at for update skip locked
  loop
    -- Pause the schedule if someone in it has since been removed from the group.
    if exists (
      select 1 from jsonb_to_recordset(t.payers || t.splits) as x(member_id uuid)
      where not exists (select 1 from public.group_members m where m.id = x.member_id)
    ) then
      update public.recurring_templates set active = false where id = t.id;
      continue;
    end if;

    n := t.occurrences_posted; cnt := 0;
    loop
      d := public.recurrence_date(t.start_date, t.frequency, n);
      exit when d > today or (t.end_date is not null and d > t.end_date) or cnt >= 366;
      insert into public.expenses (group_id, title, amount_paise, expense_date, category, split_method, split_input, recurring_id, created_by)
      values (t.group_id, t.title, t.amount_paise, d, t.category, t.split_method, t.split_input, t.id, t.created_by)
      returning id into eid;
      insert into public.expense_payers (expense_id, member_id, paid_paise)
        select eid, x.member_id, x.paid_paise from jsonb_to_recordset(t.payers) as x(member_id uuid, paid_paise bigint);
      insert into public.expense_splits (expense_id, member_id, owed_paise)
        select eid, x.member_id, x.owed_paise from jsonb_to_recordset(t.splits) as x(member_id uuid, owed_paise bigint)
        where x.owed_paise > 0;
      perform public._log(t.group_id, 'expense_added', 'expense', eid, t.title, null, public._expense_json(eid));
      n := n + 1; cnt := cnt + 1; posted := posted + 1;
    end loop;

    update public.recurring_templates set
      occurrences_posted = n,
      next_run = public.recurrence_date(start_date, frequency, n),
      active = active and not (end_date is not null and public.recurrence_date(start_date, frequency, n) > end_date)
    where id = t.id;
  end loop;
  return posted;
end $fn$;

-- Daily at 00:05 UTC (05:35 IST). Needs the pg_cron extension (Database > Extensions in Supabase).
do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'bhag-recurring';
    perform cron.schedule('bhag-recurring', '5 0 * * *', 'select public.post_due_recurring()');
  else
    raise notice 'pg_cron is not available. Recurring expenses will post when someone opens the group.';
  end if;
exception when others then
  raise notice 'Could not schedule pg_cron job (%). Recurring expenses will post when someone opens the group.', sqlerrm;
end $cron$;

------------------------------------------------------------------------------------------------
-- Receipt storage (private bucket, members of the group only)
------------------------------------------------------------------------------------------------
create or replace function public._path_group(name text) returns uuid
language plpgsql immutable as $fn$
begin
  return split_part(name, '/', 1)::uuid;
exception when others then
  return null;
end $fn$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_member(public._path_group(name)));
drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_member(public._path_group(name)));
drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.is_member(public._path_group(name)));

------------------------------------------------------------------------------------------------
-- Realtime
------------------------------------------------------------------------------------------------
do $rt$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['groups', 'group_members', 'expenses', 'expense_payers', 'expense_splits',
                             'settlements', 'comments', 'attachments', 'activity_log', 'recurring_templates']
    loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $rt$;

------------------------------------------------------------------------------------------------
-- Privileges: anonymous users get nothing; signed-in users read tables and call the functions below.
------------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on public.profiles, public.groups, public.group_members, public.recurring_templates, public.expenses,
  public.expense_payers, public.expense_splits, public.settlements, public.comments, public.attachments,
  public.activity_log to authenticated;
grant update (name) on public.profiles to authenticated;

grant execute on function
  public.is_member(uuid), public.create_group(text, boolean, text), public.update_group(uuid, text, boolean),
  public.delete_group(uuid), public.rotate_invite_code(uuid), public.add_member(uuid, text),
  public.rename_member(uuid, text), public.remove_member(uuid), public.get_invite_preview(text),
  public.join_group(text, uuid), public.save_expense(jsonb), public.delete_expense(uuid),
  public.restore_expense(uuid), public.save_settlement(jsonb), public.delete_settlement(uuid),
  public.add_comment(uuid, text), public.delete_comment(uuid), public.add_attachment(uuid, text, text, int),
  public.delete_attachment(uuid), public.save_recurring(jsonb), public.set_recurring_active(uuid, boolean),
  public.delete_recurring(uuid), public.post_due_recurring(uuid), public.today_ist(), public._path_group(text)
to authenticated;
