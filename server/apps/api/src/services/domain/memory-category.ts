/**
 * Categories a fact about the person can land in.
 *
 * The profile rollup writes the Chinese heading for the category. The ids stay
 * stable so a translated settings label does not change stored rows.
 *
 * A row saved before this split can still store `background` or `concern`.
 * Read those values as health background and this consultation.
 */
export const MEMORY_CATEGORIES = [
  'name',
  'demographics',
  'history',
  'allergy',
  'medication',
  'visit',
  'scene',
  'other',
] as const

export type MemoryCategory = typeof MEMORY_CATEGORIES[number]

/** Heading written into the user profile for each category. */
export const PROFILE_CATEGORY_HEADING: Record<MemoryCategory, string> = {
  name: '称呼',
  demographics: '人口基础信息',
  history: '健康背景',
  allergy: '过敏',
  medication: '长期用药',
  visit: '本次咨询',
  scene: '咨询场景',
  other: '其他',
}

const STORED_CATEGORY_REPLACEMENT: Record<string, MemoryCategory> = {
  background: 'history',
  concern: 'visit',
}

export function isMemoryCategory(value: string): value is MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Normalizes a stored memory category.
 *
 * @example
 * memoryCategoryFromStored('background')
 * // => 'history'
 */
export function memoryCategoryFromStored(value: string | null | undefined): MemoryCategory | null {
  if (value == null)
    return null
  if (isMemoryCategory(value))
    return value
  return STORED_CATEGORY_REPLACEMENT[value] ?? null
}
