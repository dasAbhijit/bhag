import type { Paise } from './money'
import type { PersonId, Transfer } from './types'

/** Above this many people with a non-zero balance, use the greedy method only. */
export const EXACT_LIMIT = 14

/**
 * Greedy settle-up: repeatedly pay the biggest creditor from the biggest debtor.
 * Needs at most (people with a balance - 1) transfers. `net`: positive = is owed.
 */
export function simplifyGreedy(net: Record<PersonId, Paise>): Transfer[] {
  const cred = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, v }))
  const debt = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, v: -v }))
  const byAmountThenId = (a: { id: string; v: number }, b: { id: string; v: number }) =>
    b.v - a.v || (a.id < b.id ? -1 : 1)
  const out: Transfer[] = []
  while (cred.length && debt.length) {
    cred.sort(byAmountThenId)
    debt.sort(byAmountThenId)
    const c = cred[0]
    const d = debt[0]
    const amt = Math.min(c.v, d.v)
    out.push({ from: d.id, to: c.id, amount: amt })
    c.v -= amt
    d.v -= amt
    if (c.v === 0) cred.shift()
    if (d.v === 0) debt.shift()
  }
  return out
}

/**
 * Fewest transfers possible. Splits people into the most groups whose balances each sum to
 * zero (bitmask search), then settles each group greedily with (size - 1) transfers.
 */
export function simplifyExact(net: Record<PersonId, Paise>): Transfer[] {
  const people = Object.entries(net)
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
  const n = people.length
  if (n === 0) return []
  if (n > 20) throw new Error('Too many people for the exact search')

  const full = (1 << n) - 1
  const sum = new Array<number>(full + 1).fill(0)
  const best = new Array<number>(full + 1).fill(0)
  for (let m = 1; m <= full; m++) {
    const low = m & -m
    sum[m] = sum[m ^ low] + people[31 - Math.clz32(low)][1]
    let b = 0
    for (let i = 0; i < n; i++) if (m & (1 << i)) b = Math.max(b, best[m ^ (1 << i)])
    best[m] = b + (sum[m] === 0 ? 1 : 0)
  }

  // Walk back from the full set to recover one order whose zero-sum prefixes mark the groups.
  const order: number[] = []
  let mask = full
  while (mask) {
    const need = best[mask] - (sum[mask] === 0 ? 1 : 0)
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i) && best[mask ^ (1 << i)] === need) {
        order.push(i)
        mask ^= 1 << i
        break
      }
    }
  }
  order.reverse()

  const out: Transfer[] = []
  let group: Record<PersonId, Paise> = {}
  let running = 0
  for (const i of order) {
    const [id, v] = people[i]
    group[id] = v
    running += v
    if (running === 0) {
      out.push(...simplifyGreedy(group))
      group = {}
    }
  }
  return out
}

/** Best available simplification: exact for small groups, greedy otherwise. */
export function simplifyDebts(net: Record<PersonId, Paise>): Transfer[] {
  const count = Object.values(net).filter((v) => v !== 0).length
  return count <= EXACT_LIMIT ? simplifyExact(net) : simplifyGreedy(net)
}
