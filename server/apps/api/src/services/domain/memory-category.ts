/**
 * Categories a fact about the person can land in.
 *
 * The profile rollup writes the Chinese heading for the category. The ids stay
 * stable so a translated settings label does not change stored rows.
 */
export const MEMORY_CATEGORIES = ['name', 'background', 'allergy', 'concern', 'other'] as const

export type MemoryCategory = typeof MEMORY_CATEGORIES[number]

/** Heading written into the user profile for each category. */
export const PROFILE_CATEGORY_HEADING: Record<MemoryCategory, string> = {
  name: '称呼',
  background: '基本情况',
  allergy: '过敏',
  concern: '主要困扰',
  other: '其他',
}

export function isMemoryCategory(value: string): value is MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(value)
}
