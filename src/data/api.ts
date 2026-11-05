import { client } from '../lib/supabase'
import type {
  ActivityEntry,
  AllData,
  Attachment,
  Comment,
  Expense,
  ExpensePayload,
  Group,
  InvitePreview,
  RecurringPayload,
  RecurringTemplate,
  Settlement,
} from './types'

const PAGE = 1000

/** Read every row of a query, 1000 at a time (the API's page size). */
async function paged<T>(make: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export async function loadAll(): Promise<AllData> {
  const sb = client()
  const [groups, expenses, settlements, recurring] = await Promise.all([
    paged<Group>(() => sb.from('groups').select('*, group_members(*)').order('created_at').order('id')),
    paged<Expense>(() =>
      sb.from('expenses').select('*, expense_payers(*), expense_splits(*)').order('expense_date', { ascending: false }).order('id'),
    ),
    paged<Settlement>(() => sb.from('settlements').select('*').order('settled_on', { ascending: false }).order('id')),
    paged<RecurringTemplate>(() => sb.from('recurring_templates').select('*').order('created_at').order('id')),
  ])
  return { groups, expenses, settlements, recurring }
}

/** Turn the odd database messages people could actually meet into something they can act on. */
export function friendlyError(message: string): string {
  if (message.includes('split_method_check')) {
    return 'Splitting by item needs a database update. Ask whoever runs Bhag to run migration 0002 (see the setup guide).'
  }
  return message
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().rpc(fn, args)
  if (error) throw new Error(friendlyError(error.message))
  return data as T
}

// Groups and members
export const createGroup = (name: string, isDirect = false, friendName: string | null = null) =>
  rpc<string>('create_group', { p_name: name, p_is_direct: isDirect, p_friend_name: friendName })
export const updateGroup = (id: string, name: string, simplify: boolean) =>
  rpc('update_group', { p_group: id, p_name: name, p_simplify: simplify })
export const deleteGroup = (id: string) => rpc('delete_group', { p_group: id })
export const rotateInviteCode = (id: string) => rpc<string>('rotate_invite_code', { p_group: id })
export const addMember = (groupId: string, name: string) => rpc<string>('add_member', { p_group: groupId, p_name: name })
export const renameMember = (id: string, name: string) => rpc('rename_member', { p_member: id, p_name: name })
export const removeMember = (id: string) => rpc('remove_member', { p_member: id })
export const getInvitePreview = (code: string) => rpc<InvitePreview>('get_invite_preview', { p_code: code })
export const joinGroup = (code: string, claim: string | null) => rpc<string>('join_group', { p_code: code, p_claim: claim })

// Expenses and payments
export const saveExpense = (p: ExpensePayload) => rpc<string>('save_expense', { p })
export const deleteExpense = (id: string) => rpc('delete_expense', { p_expense: id })
export const restoreExpense = (id: string) => rpc('restore_expense', { p_expense: id })
export const saveSettlement = (p: { group_id: string; from_member: string; to_member: string; amount_paise: number; settled_on?: string; note?: string }) =>
  rpc<string>('save_settlement', { p })
export const deleteSettlement = (id: string) => rpc('delete_settlement', { p_settlement: id })

// Recurring
export const saveRecurring = (p: RecurringPayload) => rpc<string>('save_recurring', { p })
export const setRecurringActive = (id: string, active: boolean) => rpc('set_recurring_active', { p_id: id, p_active: active })
export const deleteRecurring = (id: string) => rpc('delete_recurring', { p_id: id })
export const postDueRecurring = (groupId: string) => rpc<number>('post_due_recurring', { p_group: groupId })

// Comments
export const addComment = (expenseId: string, body: string) => rpc<string>('add_comment', { p_expense: expenseId, p_body: body })
export const deleteComment = (id: string) => rpc('delete_comment', { p_comment: id })
export async function loadComments(expenseId: string): Promise<Comment[]> {
  const { data, error } = await client().from('comments').select('*').eq('expense_id', expenseId).order('created_at')
  if (error) throw new Error(error.message)
  return data as Comment[]
}

// Activity
export async function loadActivity(groupId: string): Promise<ActivityEntry[]> {
  const { data, error } = await client().from('activity_log').select('*').eq('group_id', groupId).order('id', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return data as ActivityEntry[]
}

// Receipts
const BUCKET = 'receipts'
export async function loadAttachments(expenseId: string): Promise<Attachment[]> {
  const { data, error } = await client().from('attachments').select('*').eq('expense_id', expenseId).order('created_at')
  if (error) throw new Error(error.message)
  return data as Attachment[]
}
export async function uploadReceipt(groupId: string, expenseId: string, file: Blob, ext: string): Promise<void> {
  const sb = client()
  const path = `${groupId}/${expenseId}/${crypto.randomUUID()}.${ext}`
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  try {
    await rpc('add_attachment', { p_expense: expenseId, p_path: path, p_mime: file.type, p_size: file.size })
  } catch (e) {
    await sb.storage.from(BUCKET).remove([path])
    throw e
  }
}
export async function deleteReceipt(id: string): Promise<void> {
  const path = await rpc<string>('delete_attachment', { p_attachment: id })
  await client().storage.from(BUCKET).remove([path])
}
export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

// Profile
export async function updateProfileName(userId: string, name: string): Promise<void> {
  const { error } = await client().from('profiles').update({ name }).eq('id', userId)
  if (error) throw new Error(error.message)
}
export async function loadProfileName(userId: string): Promise<string> {
  const { data, error } = await client().from('profiles').select('name').eq('id', userId).single()
  if (error) throw new Error(error.message)
  return (data as { name: string }).name
}
