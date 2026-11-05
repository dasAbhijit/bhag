import { friendBalances, netBalances, pairwiseDebts } from '../core/balances'
import type { Paise } from '../core/money'
import { simplifyDebts } from '../core/simplify'
import type { LedgerExpense, LedgerSettlement, Transfer } from '../core/types'
import type { AllData, Expense, Group, Member, Settlement } from './types'

export function toLedgerExpense(e: Expense): LedgerExpense {
  return {
    amount: e.amount_paise,
    payers: Object.fromEntries(e.expense_payers.map((p) => [p.member_id, p.paid_paise])),
    owed: Object.fromEntries(e.expense_splits.map((s) => [s.member_id, s.owed_paise])),
  }
}

export function toLedgerSettlement(s: Settlement): LedgerSettlement {
  return { from: s.from_member, to: s.to_member, amount: s.amount_paise }
}

export interface GroupView {
  group: Group
  members: Member[]
  memberById: Map<string, Member>
  me: Member | undefined
  expenses: Expense[] // not deleted, newest first
  deleted: Expense[]
  settlements: Settlement[]
  net: Record<string, Paise> // by member id; positive = owed money
  debts: Transfer[] // direct, unsimplified
  suggestions: Transfer[] // what to pay to settle up (simplified when the group has it on)
  myNet: Paise
}

export function buildGroupView(group: Group, data: AllData, userId: string): GroupView {
  const all = data.expenses.filter((e) => e.group_id === group.id)
  const expenses = all.filter((e) => !e.deleted_at)
  const deleted = all.filter((e) => e.deleted_at)
  const settlements = data.settlements.filter((s) => s.group_id === group.id)
  const ledgerE = expenses.map(toLedgerExpense)
  const ledgerS = settlements.map(toLedgerSettlement)
  const net = netBalances(ledgerE, ledgerS)
  const debts = pairwiseDebts(ledgerE, ledgerS)
  const members = [...group.group_members].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const me = members.find((m) => m.user_id === userId)
  return {
    group,
    members,
    memberById: new Map(members.map((m) => [m.id, m])),
    me,
    expenses,
    deleted,
    settlements,
    net,
    debts,
    suggestions: group.simplify_debts ? simplifyDebts(net) : debts,
    myNet: me ? (net[me.id] ?? 0) : 0,
  }
}

export function buildViews(data: AllData, userId: string): GroupView[] {
  return data.groups.map((g) => buildGroupView(g, data, userId))
}

/** A stable id for a person across groups: their account if they have one, else the placeholder. */
export const personKey = (m: Member): string => m.user_id ?? `m:${m.id}`

export interface FriendBalance {
  key: string
  name: string
  total: Paise // positive: they owe you
  groups: { group: Group; amount: Paise }[]
}

/** Your net balance with each person, added up across every group you share. */
export function buildFriends(views: GroupView[], userId: string): FriendBalance[] {
  const byKey = new Map<string, FriendBalance>()
  for (const v of views) {
    const keyOf = new Map(v.members.map((m) => [m.id, personKey(m)]))
    const rekey = (t: Transfer): Transfer => ({ from: keyOf.get(t.from) ?? t.from, to: keyOf.get(t.to) ?? t.to, amount: t.amount })
    const perFriend = friendBalances(userId, v.debts.map(rekey))
    for (const [key, amount] of Object.entries(perFriend)) {
      const name = v.members.find((m) => personKey(m) === key)?.display_name ?? 'Someone'
      const f = byKey.get(key) ?? { key, name, total: 0, groups: [] }
      f.total += amount
      f.groups.push({ group: v.group, amount })
      byKey.set(key, f)
    }
  }
  return [...byKey.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.name.localeCompare(b.name))
}

export function totals(views: GroupView[]): { owed: Paise; owe: Paise } {
  let owed = 0
  let owe = 0
  for (const v of views) {
    if (v.myNet > 0) owed += v.myNet
    else owe += -v.myNet
  }
  return { owed, owe }
}
