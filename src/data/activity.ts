import { formatINR } from '../core/money'
import type { ActivityEntry, ExpenseSnapshot, PayerRow, SplitRow } from './types'

type NameOf = (memberId: string) => string

export interface Described {
  text: string
  details: string[]
}

const isSnapshot = (v: unknown): v is ExpenseSnapshot =>
  typeof v === 'object' && v !== null && 'amount_paise' in v && 'payers' in v

const people = (rows: (PayerRow | SplitRow)[], nameOf: NameOf, key: 'paid_paise' | 'owed_paise') =>
  rows
    .map((r) => `${nameOf(r.member_id)} ${formatINR((r as unknown as Record<string, number>)[key])}`)
    .sort()
    .join(', ')

/** What changed between two versions of an expense, as short lines. */
export function diffExpense(before: ExpenseSnapshot, after: ExpenseSnapshot, nameOf: NameOf): string[] {
  const out: string[] = []
  if (before.title !== after.title) out.push(`Name: ${before.title} → ${after.title}`)
  if (before.amount_paise !== after.amount_paise) out.push(`Amount: ${formatINR(before.amount_paise)} → ${formatINR(after.amount_paise)}`)
  if (before.date !== after.date) out.push(`Date: ${before.date} → ${after.date}`)
  if (before.category !== after.category) out.push(`Category: ${before.category} → ${after.category}`)
  if ((before.note ?? '') !== (after.note ?? '')) out.push('Note changed')
  const bp = people(before.payers, nameOf, 'paid_paise')
  const ap = people(after.payers, nameOf, 'paid_paise')
  if (bp !== ap) out.push(`Paid by: ${bp} → ${ap}`)
  const bs = people(before.splits, nameOf, 'owed_paise')
  const as = people(after.splits, nameOf, 'owed_paise')
  if (bs !== as) out.push(`Split: ${bs} → ${as}`)
  return out
}

export function describeActivity(a: ActivityEntry, nameOf: NameOf): Described {
  const t = a.summary ? `“${a.summary}”` : ''
  const after = a.after_json as Record<string, unknown> | null
  const before = a.before_json as Record<string, unknown> | null
  switch (a.action) {
    case 'group_created':
      return { text: `created the group ${t}`, details: [] }
    case 'expense_added':
      return { text: `added ${t}`, details: isSnapshot(after) ? [formatINR(after.amount_paise)] : [] }
    case 'expense_edited': {
      const details = isSnapshot(before) && isSnapshot(after) ? diffExpense(before, after, nameOf) : []
      return { text: `edited ${t}`, details: details.length ? details : ['No visible changes'] }
    }
    case 'expense_deleted':
      return { text: `deleted ${t}`, details: isSnapshot(before) ? [formatINR(before.amount_paise)] : [] }
    case 'expense_restored':
      return { text: `restored ${t}`, details: [] }
    case 'payment_added': {
      const p = after as { from_member: string; to_member: string; amount_paise: number } | null
      if (!p) return { text: 'recorded a payment', details: [] }
      const from = nameOf(p.from_member)
      const paid = `${from} paid ${nameOf(p.to_member)} ${formatINR(p.amount_paise)}`
      return { text: `recorded a payment: ${paid}`, details: [] }
    }
    case 'payment_deleted': {
      const p = before as { from_member: string; to_member: string; amount_paise: number } | null
      return { text: p ? `deleted the payment from ${nameOf(p.from_member)} to ${nameOf(p.to_member)} (${formatINR(p.amount_paise)})` : 'deleted a payment', details: [] }
    }
    case 'comment_added':
      return { text: `commented on ${t}`, details: typeof after?.body === 'string' ? [after.body] : [] }
    case 'receipt_added':
      return { text: `added a receipt to ${t}`, details: [] }
    case 'member_added':
      return { text: `added ${a.summary ?? 'someone'} to the group`, details: [] }
    case 'member_joined':
      return { text: 'joined the group', details: [] }
    case 'member_removed':
      return { text: `removed ${a.summary ?? 'someone'} from the group`, details: [] }
    case 'member_renamed':
      return { text: `renamed ${(before?.name as string) ?? 'someone'} to ${a.summary ?? ''}`, details: [] }
    case 'recurring_added':
      return { text: `set up a repeating expense ${t}`, details: [] }
    case 'recurring_deleted':
      return { text: `removed the repeating expense ${t}`, details: [] }
    default:
      return { text: a.action.replace(/_/g, ' '), details: [] }
  }
}
