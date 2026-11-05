import type { Frequency, SplitMethod } from '../core/types'

export interface Member {
  id: string
  group_id: string
  user_id: string | null
  display_name: string
  created_at: string
}

export interface Group {
  id: string
  name: string
  currency: string
  is_direct: boolean
  simplify_debts: boolean
  invite_code: string
  created_by: string
  created_at: string
  group_members: Member[]
}

export interface PayerRow {
  member_id: string
  paid_paise: number
}
export interface SplitRow {
  member_id: string
  owed_paise: number
}

export interface Expense {
  id: string
  group_id: string
  title: string
  amount_paise: number
  expense_date: string
  category: string
  split_method: SplitMethod
  split_input: Record<string, unknown> | null
  note: string | null
  recurring_id: string | null
  created_by: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  expense_payers: PayerRow[]
  expense_splits: SplitRow[]
}

export interface Settlement {
  id: string
  group_id: string
  from_member: string
  to_member: string
  amount_paise: number
  settled_on: string
  note: string | null
  created_at: string
}

export interface RecurringTemplate {
  id: string
  group_id: string
  title: string
  amount_paise: number
  category: string
  frequency: Frequency
  start_date: string
  end_date: string | null
  occurrences_posted: number
  next_run: string
  active: boolean
}

export interface Comment {
  id: string
  expense_id: string
  author_user_id: string | null
  author_name: string
  body: string
  created_at: string
}

export interface Attachment {
  id: string
  expense_id: string
  storage_path: string
  mime: string
  size_bytes: number
  created_at: string
}

export interface ActivityEntry {
  id: number
  group_id: string
  actor_name: string
  action: string
  entity_type: string
  entity_id: string | null
  summary: string | null
  before_json: ExpenseSnapshot | Record<string, unknown> | null
  after_json: ExpenseSnapshot | Record<string, unknown> | null
  created_at: string
}

export interface ExpenseSnapshot {
  title: string
  amount_paise: number
  date: string
  category: string
  split_method: string
  note: string | null
  payers: PayerRow[]
  splits: SplitRow[]
}

export interface AllData {
  groups: Group[]
  expenses: Expense[]
  settlements: Settlement[]
  recurring: RecurringTemplate[]
}

export interface ExpensePayload {
  id?: string
  group_id: string
  title: string
  amount_paise: number
  expense_date: string
  category: string
  split_method: SplitMethod
  split_input: Record<string, unknown>
  note: string
  payers: PayerRow[]
  splits: SplitRow[]
}

export interface RecurringPayload extends Omit<ExpensePayload, 'id'> {
  frequency: Frequency
  start_date: string
  end_date: string | null
}

export interface InvitePreview {
  group_id: string
  name: string
  is_direct: boolean
  already_member: boolean
  members: { id: string; name: string; claimed: boolean }[]
}
