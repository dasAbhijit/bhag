import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { netBalances } from '../core/balances'

/**
 * Runs the real migration in an in-process Postgres (PGlite) with small stand-ins for Supabase's
 * `auth` and `storage` schemas, then checks the security rules and money rules as different users.
 */
const MIGRATION = ['0001_init.sql', '0002_items_split.sql']
  .map((f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8'))
  .join('\n')

const ALICE = '00000000-0000-4000-8000-00000000000a'
const BOB = '00000000-0000-4000-8000-00000000000b'
const CAROL = '00000000-0000-4000-8000-00000000000c'

let db: PGlite

type Q = { query: PGlite['query'] }
async function as<T>(user: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(user ? 'set local role authenticated' : 'set local role anon')
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ?? ''])
    return fn(tx as unknown as Q)
  })
}
const rows = async <T = Record<string, unknown>>(q: Q, sql: string, params: unknown[] = []) =>
  (await q.query<T>(sql, params)).rows
const one = async <T = Record<string, unknown>>(q: Q, sql: string, params: unknown[] = []) =>
  (await rows<T>(q, sql, params))[0]

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public, auth, storage to anon, authenticated;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant select, insert, delete on storage.objects to authenticated;
    create publication supabase_realtime;
  `)
  await db.exec(MIGRATION)
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ALICE}', 'alice@example.com', '{"full_name":"Alice"}'),
      ('${BOB}', 'bob@example.com', '{}'),
      ('${CAROL}', 'carol@example.com', '{"name":"Carol"}');
  `)
}, 60_000)

afterAll(async () => {
  await db.close()
})

let gid: string
let code: string
let aliceM: string
let guestM: string
let expenseId: string

describe('migration', () => {
  it('is safe to run twice', async () => {
    await db.exec(MIGRATION)
  })
  it('creates profiles from sign-ups', async () => {
    const p = await rows(db, 'select name from public.profiles order by email')
    expect(p.map((r) => r.name)).toEqual(['Alice', 'bob', 'Carol'])
  })
})

describe('groups and invites', () => {
  it('creates a group with the creator and a placeholder friend', async () => {
    await as(ALICE, async (q) => {
      gid = (await one<{ create_group: string }>(q, `select public.create_group('Goa Trip', false, null)`)).create_group
      guestM = (await one<{ add_member: string }>(q, `select public.add_member($1, 'Dev (guest)')`, [gid])).add_member
      const g = await one<{ invite_code: string }>(q, 'select invite_code from public.groups where id = $1', [gid])
      code = g.invite_code
      const m = await rows<{ id: string; display_name: string }>(q, 'select id, display_name from public.group_members where group_id = $1 order by created_at', [gid])
      expect(m.map((r) => r.display_name)).toEqual(['Alice', 'Dev (guest)'])
      aliceM = m[0].id
    })
  })
  it('strangers see nothing and cannot write tables directly', async () => {
    await as(CAROL, async (q) => {
      expect(await rows(q, 'select * from public.groups')).toHaveLength(0)
      expect(await rows(q, 'select * from public.group_members')).toHaveLength(0)
    })
    await expect(as(CAROL, (q) => q.query(`insert into public.groups(name, created_by) values ('x', '${CAROL}')`))).rejects.toThrow(/permission denied/)
    await expect(as(ALICE, (q) => q.query(`update public.groups set name = 'hacked'`))).rejects.toThrow(/permission denied/)
    await expect(as(null, (q) => q.query('select * from public.groups'))).rejects.toThrow(/permission denied/)
  })
  it('invite preview, then claim the placeholder', async () => {
    await as(BOB, async (q) => {
      const prev = await one<{ get_invite_preview: { name: string; members: { id: string; claimed: boolean }[] } }>(q, 'select public.get_invite_preview($1)', [code])
      expect(prev.get_invite_preview.name).toBe('Goa Trip')
      expect(prev.get_invite_preview.members.map((m) => m.claimed)).toEqual([true, false])
      await q.query('select public.join_group($1, $2)', [code, guestM])
      expect(await rows(q, 'select * from public.groups')).toHaveLength(1)
    })
    await expect(as(CAROL, (q) => q.query('select public.join_group($1, $2)', [code, guestM]))).rejects.toThrow(/already been claimed/)
    await expect(as(CAROL, (q) => q.query(`select public.join_group('nope')`))).rejects.toThrow(/not valid/)
  })
})

describe('expenses', () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    group_id: gid,
    title: 'Dinner',
    amount_paise: 300000,
    expense_date: '2026-11-01',
    category: 'food',
    split_method: 'equal',
    split_input: { participants: [aliceM, guestM] },
    payers: [{ member_id: aliceM, paid_paise: 200000 }, { member_id: guestM, paid_paise: 100000 }],
    splits: [{ member_id: aliceM, owed_paise: 150000 }, { member_id: guestM, owed_paise: 150000 }],
    ...over,
  })
  const save = (user: string, p: object) =>
    as(user, async (q) => (await one<{ save_expense: string }>(q, 'select public.save_expense($1::jsonb)', [JSON.stringify(p)])).save_expense)

  it('saves a valid expense with multiple payers', async () => {
    expenseId = await save(ALICE, payload())
    await as(BOB, async (q) => {
      expect(await rows(q, 'select * from public.expense_payers where expense_id = $1', [expenseId])).toHaveLength(2)
    })
  })
  it('rejects bad money and outsiders', async () => {
    await expect(save(ALICE, payload({ payers: [{ member_id: aliceM, paid_paise: 1 }] }))).rejects.toThrow(/paid must add up/)
    await expect(save(ALICE, payload({ splits: [{ member_id: aliceM, owed_paise: 1 }] }))).rejects.toThrow(/Shares must add up/)
    await expect(save(ALICE, payload({ amount_paise: 0 }))).rejects.toThrow(/more than zero/)
    await expect(save(ALICE, payload({ payers: [{ member_id: CAROL, paid_paise: 300000 }] }))).rejects.toThrow(/Invalid payer/)
    await expect(save(CAROL, payload())).rejects.toThrow(/not a member/)
  })
  it('edits, logs before and after, deletes and restores', async () => {
    await save(BOB, payload({ id: expenseId, title: 'Dinner at Fisherman’s', amount_paise: 400000,
      payers: [{ member_id: aliceM, paid_paise: 400000 }],
      splits: [{ member_id: aliceM, owed_paise: 100000 }, { member_id: guestM, owed_paise: 300000 }] }))
    await as(ALICE, async (q) => {
      await q.query('select public.delete_expense($1)', [expenseId])
      expect((await one<{ deleted_at: unknown }>(q, 'select deleted_at from public.expenses where id = $1', [expenseId])).deleted_at).not.toBeNull()
      await q.query('select public.restore_expense($1)', [expenseId])
      const log = await rows<{ action: string; actor_name: string; before_json: { title: string } | null; after_json: { title: string } | null }>(
        q, 'select action, actor_name, before_json, after_json from public.activity_log where entity_id = $1 order by id', [expenseId])
      expect(log.map((l) => l.action)).toEqual(['expense_added', 'expense_edited', 'expense_deleted', 'expense_restored'])
      expect(log[1].before_json?.title).toBe('Dinner')
      expect(log[1].after_json?.title).toBe('Dinner at Fisherman’s')
      // Bob claimed the placeholder "Dev (guest)", so that is the name the group knows him by.
      expect(log[1].actor_name).toBe('Dev (guest)')
    })
  })
  it('saves an itemised expense and keeps the items for editing', async () => {
    const items = [{ name: 'Dosa', amount_paise: 24000, members: [aliceM] }, { name: 'Lassi', amount_paise: 9000, members: [aliceM, guestM] }]
    const id = await save(ALICE, payload({
      title: 'Cafe Mocha', amount_paise: 36300, split_method: 'items',
      split_input: { items, extra_paise: 3300 },
      payers: [{ member_id: aliceM, paid_paise: 36300 }],
      splits: [{ member_id: aliceM, owed_paise: 30030 }, { member_id: guestM, owed_paise: 6270 }],
    }))
    await as(BOB, async (q) => {
      const e = await one<{ split_method: string; split_input: { items: unknown[]; extra_paise: number } }>(q, 'select split_method, split_input from public.expenses where id = $1', [id])
      expect(e.split_method).toBe('items')
      expect(e.split_input.items).toHaveLength(2)
      expect(e.split_input.extra_paise).toBe(3300)
    })
    await as(ALICE, (q) => q.query('select public.delete_expense($1)', [id]))
  })
  it('database totals match the core ledger', async () => {
    await as(ALICE, async (q) => {
      const p = await rows<{ member_id: string; paid_paise: string }>(q, 'select member_id, paid_paise from public.expense_payers where expense_id = $1', [expenseId])
      const s = await rows<{ member_id: string; owed_paise: string }>(q, 'select member_id, owed_paise from public.expense_splits where expense_id = $1', [expenseId])
      const net = netBalances([{ amount: 400000, payers: Object.fromEntries(p.map((r) => [r.member_id, Number(r.paid_paise)])), owed: Object.fromEntries(s.map((r) => [r.member_id, Number(r.owed_paise)])) }])
      expect(net).toEqual({ [aliceM]: 300000, [guestM]: -300000 })
    })
  })
})

describe('settlements, comments, receipts', () => {
  it('records and deletes a payment', async () => {
    await as(BOB, async (q) => {
      const id = (await one<{ save_settlement: string }>(q, 'select public.save_settlement($1::jsonb)', [JSON.stringify({ group_id: gid, from_member: guestM, to_member: aliceM, amount_paise: 50000 })])).save_settlement
      expect(await rows(q, 'select * from public.settlements')).toHaveLength(1)
      await q.query('select public.delete_settlement($1)', [id])
      expect(await rows(q, 'select * from public.settlements')).toHaveLength(0)
    })
    await expect(as(BOB, (q) => q.query('select public.save_settlement($1::jsonb)', [JSON.stringify({ group_id: gid, from_member: aliceM, to_member: aliceM, amount_paise: 1 })]))).rejects.toThrow(/different people/)
  })
  it('comments: members only, author can delete', async () => {
    const cid = await as(ALICE, async (q) => (await one<{ add_comment: string }>(q, `select public.add_comment($1, 'Was this the sunset place?')`, [expenseId])).add_comment)
    await expect(as(CAROL, (q) => q.query(`select public.add_comment($1, 'hi')`, [expenseId]))).rejects.toThrow(/not a member/)
    await expect(as(BOB, (q) => q.query('select public.delete_comment($1)', [cid]))).rejects.toThrow(/own comments/)
    await as(ALICE, (q) => q.query('select public.delete_comment($1)', [cid]))
  })
  it('attachments must live under the group and expense path', async () => {
    await expect(as(ALICE, (q) => q.query(`select public.add_attachment($1, 'other/x.jpg', 'image/jpeg', 10)`, [expenseId]))).rejects.toThrow(/Invalid file path/)
    const aid = await as(ALICE, async (q) => (await one<{ add_attachment: string }>(q, 'select public.add_attachment($1, $2, $3, 10)', [expenseId, `${gid}/${expenseId}/r.jpg`, 'image/jpeg'])).add_attachment)
    const path = await as(BOB, async (q) => (await one<{ delete_attachment: string }>(q, 'select public.delete_attachment($1)', [aid])).delete_attachment)
    expect(path).toBe(`${gid}/${expenseId}/r.jpg`)
  })
  it('storage policy follows group membership', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name) values ('receipts', '${gid}/${expenseId}/r.jpg')`)
    expect(await as(ALICE, (q) => rows(q, 'select name from storage.objects'))).toHaveLength(1)
    expect(await as(CAROL, (q) => rows(q, 'select name from storage.objects'))).toHaveLength(0)
  })
})

describe('recurring expenses', () => {
  const tpl = (start: string) => ({
    group_id: gid, title: 'Rent', amount_paise: 1000000, frequency: 'weekly', start_date: start,
    split_method: 'equal',
    payers: [{ member_id: aliceM, paid_paise: 1000000 }],
    splits: [{ member_id: aliceM, owed_paise: 500000 }, { member_id: guestM, owed_paise: 500000 }],
  })
  it('posts missed occurrences once and schedules the next', async () => {
    const start = (await one<{ d: string }>(db, `select (public.today_ist() - 14)::text as d`)).d
    const rid = await as(ALICE, async (q) => (await one<{ save_recurring: string }>(q, 'select public.save_recurring($1::jsonb)', [JSON.stringify(tpl(start))])).save_recurring)
    const posted = await rows<{ expense_date: string }>(db, `select expense_date::text from public.expenses where recurring_id = $1 order by expense_date`, [rid])
    expect(posted).toHaveLength(3)
    const t = await one<{ occurrences_posted: number; next_run: string; today: string }>(db, `select occurrences_posted, next_run::text, public.today_ist()::text as today from public.recurring_templates where id = $1`, [rid])
    expect(t.occurrences_posted).toBe(3)
    expect(t.next_run).toBe((await one<{ d: string }>(db, `select (public.today_ist() + 7)::text as d`)).d)
    // Running again posts nothing; cron (no user) works, a signed-in user cannot call it without a group.
    expect((await one<{ post_due_recurring: number }>(db, 'select public.post_due_recurring()')).post_due_recurring).toBe(0)
    await expect(as(ALICE, (q) => q.query('select public.post_due_recurring()'))).rejects.toThrow(/Not allowed/)
    await as(ALICE, (q) => q.query('select public.delete_recurring($1)', [rid]))
  })
  it('monthly schedules clamp to month end', async () => {
    expect((await one<{ d: string }>(db, `select public.recurrence_date('2026-01-31', 'monthly', 1)::text as d`)).d).toBe('2026-02-28')
    expect((await one<{ d: string }>(db, `select public.recurrence_date('2026-01-31', 'monthly', 2)::text as d`)).d).toBe('2026-03-31')
    expect((await one<{ d: string }>(db, `select public.recurrence_date('2024-02-29', 'yearly', 1)::text as d`)).d).toBe('2025-02-28')
  })
})

describe('membership changes and deletion', () => {
  it('cannot remove someone who has expenses', async () => {
    await expect(as(ALICE, (q) => q.query('select public.remove_member($1)', [aliceM]))).rejects.toThrow(/cannot be removed/)
  })
  it('only the creator can delete the group, and it cascades', async () => {
    await expect(as(BOB, (q) => q.query('select public.delete_group($1)', [gid]))).rejects.toThrow(/Only the person who created/)
    await as(ALICE, (q) => q.query('select public.delete_group($1)', [gid]))
    expect(await rows(db, 'select * from public.expenses')).toHaveLength(0)
    expect(await rows(db, 'select * from public.group_members')).toHaveLength(0)
  })
})
