import type { Paise } from './money'
import type { LedgerExpense, LedgerSettlement, PersonId, Transfer } from './types'

/** Net balance per person. Positive: the group owes them. Negative: they owe the group. */
export function netBalances(
  expenses: LedgerExpense[],
  settlements: LedgerSettlement[] = [],
): Record<PersonId, Paise> {
  const net: Record<PersonId, Paise> = {}
  const add = (id: PersonId, v: Paise) => {
    net[id] = (net[id] ?? 0) + v
  }
  for (const e of expenses) {
    for (const [id, v] of Object.entries(e.payers)) add(id, v)
    for (const [id, v] of Object.entries(e.owed)) add(id, -v)
  }
  for (const s of settlements) {
    add(s.from, s.amount)
    add(s.to, -s.amount)
  }
  return net
}

const SEP = '\u0000'

/**
 * Who owes whom directly, before any simplification.
 * Each expense is attributed pairwise: people who owe more than they paid are matched, in id
 * order, to the people who paid more than they owed. Every person's total stays exact to the
 * paisa. Settlements reduce the matching pair. Opposite debts between two people are netted.
 */
export function pairwiseDebts(
  expenses: LedgerExpense[],
  settlements: LedgerSettlement[] = [],
): Transfer[] {
  const owes = new Map<string, Paise>() // `${debtor}\0${creditor}` -> paise
  const bump = (a: PersonId, b: PersonId, v: Paise) => {
    const k = a + SEP + b
    owes.set(k, (owes.get(k) ?? 0) + v)
  }

  for (const e of expenses) {
    const net: Record<PersonId, Paise> = {}
    for (const [id, v] of Object.entries(e.payers)) net[id] = (net[id] ?? 0) + v
    for (const [id, v] of Object.entries(e.owed)) net[id] = (net[id] ?? 0) - v
    // Match debtors to creditors in id order. Both sides stay exact to the paisa.
    const credit = Object.entries(net).filter(([, v]) => v > 0).sort(([a], [b]) => (a < b ? -1 : 1))
    const debit = Object.entries(net).filter(([, v]) => v < 0).sort(([a], [b]) => (a < b ? -1 : 1))
    let ci = 0
    let left = credit.length ? credit[0][1] : 0
    for (const [d, v] of debit) {
      let need = -v
      while (need > 0 && ci < credit.length) {
        const amt = Math.min(need, left)
        bump(d, credit[ci][0], amt)
        need -= amt
        left -= amt
        if (left === 0) {
          ci++
          left = ci < credit.length ? credit[ci][1] : 0
        }
      }
    }
  }
  for (const s of settlements) bump(s.from, s.to, -s.amount)

  const result: Transfer[] = []
  const seen = new Set<string>()
  for (const key of owes.keys()) {
    if (seen.has(key)) continue
    const [a, b] = key.split(SEP)
    const rev = b + SEP + a
    seen.add(key)
    seen.add(rev)
    const diff = (owes.get(key) ?? 0) - (owes.get(rev) ?? 0)
    if (diff > 0) result.push({ from: a, to: b, amount: diff })
    else if (diff < 0) result.push({ from: b, to: a, amount: -diff })
  }
  return result.sort((x, y) => (x.from + x.to < y.from + y.to ? -1 : 1))
}

/**
 * Net balance of `me` with each other person across any number of ledgers.
 * Pass the combined pairwiseDebts of every shared group (with person ids that mean the same
 * person in every group). Positive: they owe me. Negative: I owe them.
 */
export function friendBalances(me: PersonId, debts: Transfer[]): Record<PersonId, Paise> {
  const out: Record<PersonId, Paise> = {}
  for (const t of debts) {
    if (t.to === me) out[t.from] = (out[t.from] ?? 0) + t.amount
    else if (t.from === me) out[t.to] = (out[t.to] ?? 0) - t.amount
  }
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k]
  return out
}
