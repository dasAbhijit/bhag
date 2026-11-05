import type { Paise } from './money'
import type { PersonId } from './types'

export class SplitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SplitError'
  }
}

export type SplitInput =
  | { method: 'equal'; participants: PersonId[] }
  | { method: 'exact'; amounts: Record<PersonId, Paise> }
  | { method: 'percent'; percents: Record<PersonId, number> }
  | { method: 'shares'; shares: Record<PersonId, number> }

/**
 * Split `total` paise in proportion to integer `weights` using the largest-remainder method.
 * The result always sums to `total`. Ties go to the lowest id, so output is deterministic.
 * Uses BigInt internally so large totals cannot overflow.
 */
export function allocate(total: Paise, weights: Record<PersonId, number>): Record<PersonId, Paise> {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new SplitError('Amount must be a whole number of paise, zero or more')
  }
  const ids = Object.keys(weights).sort()
  const out: Record<PersonId, Paise> = Object.fromEntries(ids.map((id) => [id, 0]))
  for (const id of ids) {
    if (!Number.isSafeInteger(weights[id]) || weights[id] < 0) {
      throw new SplitError('Weights must be whole numbers, zero or more')
    }
  }
  if (total === 0) return out
  const active = ids.filter((id) => weights[id] > 0)
  if (active.length === 0) throw new SplitError('Choose at least one person to split with')

  const sumW = active.reduce((s, id) => s + BigInt(weights[id]), 0n)
  const T = BigInt(total)
  const rows = active.map((id) => {
    const prod = T * BigInt(weights[id])
    return { id, base: prod / sumW, rem: prod % sumW }
  })
  let leftover = T - rows.reduce((s, r) => s + r.base, 0n)
  rows.sort((a, b) => (a.rem === b.rem ? (a.id < b.id ? -1 : 1) : a.rem > b.rem ? -1 : 1))
  for (const r of rows) {
    if (leftover > 0n) {
      r.base += 1n
      leftover -= 1n
    }
    out[r.id] = Number(r.base)
  }
  return out
}

/** Convert a user-entered number with up to 2 decimals to an integer count of hundredths. */
function toHundredths(value: number, what: string): number {
  if (!Number.isFinite(value) || value < 0) throw new SplitError(`${what} must be zero or more`)
  const h = Math.round(value * 100)
  if (Math.abs(value * 100 - h) > 1e-6) throw new SplitError(`${what} can have at most 2 decimal places`)
  return h
}

/** Work out how much each person owes for a bill of `total` paise. Throws SplitError if invalid. */
export function computeSplit(total: Paise, input: SplitInput): Record<PersonId, Paise> {
  switch (input.method) {
    case 'equal': {
      const unique = [...new Set(input.participants)]
      return allocate(total, Object.fromEntries(unique.map((id) => [id, 1])))
    }
    case 'exact': {
      const ids = Object.keys(input.amounts)
      let sum = 0
      for (const id of ids) {
        const a = input.amounts[id]
        if (!Number.isSafeInteger(a) || a < 0) throw new SplitError('Amounts must be zero or more')
        sum += a
      }
      if (sum !== total) throw new SplitError('Amounts must add up to the total')
      return { ...input.amounts }
    }
    case 'percent': {
      const w: Record<PersonId, number> = {}
      let sum = 0
      for (const [id, p] of Object.entries(input.percents)) {
        w[id] = toHundredths(p, 'Percentage')
        sum += w[id]
      }
      if (sum !== 10000) throw new SplitError('Percentages must add up to 100')
      return allocate(total, w)
    }
    case 'shares': {
      const w: Record<PersonId, number> = {}
      for (const [id, s] of Object.entries(input.shares)) w[id] = toHundredths(s, 'Shares')
      return allocate(total, w)
    }
  }
}

/**
 * How far the input is from valid, for a live "left to assign" indicator.
 * `exact`: paise left. `percent`: hundredths of a percent left. Others: always 0.
 */
export function splitRemaining(total: Paise, input: SplitInput): number {
  if (input.method === 'exact') {
    return total - Object.values(input.amounts).reduce((s, a) => s + (Number.isFinite(a) ? a : 0), 0)
  }
  if (input.method === 'percent') {
    return 10000 - Object.values(input.percents).reduce((s, p) => s + Math.round((Number.isFinite(p) ? p : 0) * 100), 0)
  }
  return 0
}
