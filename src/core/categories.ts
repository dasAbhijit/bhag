export const CATEGORIES = [
  ['general', 'General'], ['food', 'Food & drink'], ['groceries', 'Groceries'], ['rent', 'Rent'],
  ['utilities', 'Utilities'], ['travel', 'Travel'], ['transport', 'Transport'], ['entertainment', 'Entertainment'],
  ['subscriptions', 'Subscriptions'], ['shopping', 'Shopping'], ['health', 'Health'], ['other', 'Other'],
] as const

export const categoryLabel = (c: string): string => CATEGORIES.find(([k]) => k === c)?.[1] ?? 'General'
export const isCategory = (c: unknown): c is (typeof CATEGORIES)[number][0] => CATEGORIES.some(([k]) => k === c)
