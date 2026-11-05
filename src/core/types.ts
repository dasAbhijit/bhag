import type { Paise } from './money'

/** Opaque id of a person in a ledger (a group member, or a person key spanning groups). */
export type PersonId = string

export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares'
export type Frequency = 'weekly' | 'monthly' | 'yearly'

/** One expense reduced to what the ledger needs. payers and owed each sum to amount. */
export interface LedgerExpense {
  amount: Paise
  payers: Record<PersonId, Paise>
  owed: Record<PersonId, Paise>
}

/** `from` paid `to` back `amount`. */
export interface LedgerSettlement {
  from: PersonId
  to: PersonId
  amount: Paise
}

/** `from` should pay `to` this amount. */
export interface Transfer {
  from: PersonId
  to: PersonId
  amount: Paise
}
