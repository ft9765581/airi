import { array, integer, maxLength, maxValue, minLength, minValue, number, object, optional, picklist, pipe, string } from 'valibot'

import { MEMORY_CATEGORIES } from '../../services/domain/memory-category'

export const MemoryIdSchema = pipe(string(), minLength(1), maxLength(128))

export const SearchMemoriesQuerySchema = object({
  characterId: pipe(string(), minLength(1), maxLength(128)),
  query: pipe(string(), maxLength(4_000)),
  timeZone: optional(pipe(string(), minLength(1), maxLength(64))),
})

const MemoryFactSchema = object({
  scope: picklist(['user', 'character']),
  content: pipe(string(), minLength(4), maxLength(500)),
  importance: pipe(number(), integer(), minValue(1), maxValue(10)),
  category: optional(picklist(MEMORY_CATEGORIES)),
})

export const RememberMemoriesSchema = object({
  characterId: pipe(string(), minLength(1), maxLength(128)),
  items: pipe(
    array(MemoryFactSchema),
    minLength(1),
    maxLength(3),
  ),
})

export const UpdateMemorySchema = object({
  content: pipe(string(), minLength(4), maxLength(500)),
  category: optional(picklist(MEMORY_CATEGORIES)),
})

export const RollupMemoriesSchema = object({
  timeZone: pipe(string(), minLength(1), maxLength(64)),
  profileContent: pipe(string(), maxLength(20_000)),
  profileUpdatedAt: pipe(string(), minLength(1), maxLength(40)),
  replayIds: optional(pipe(array(MemoryIdSchema), maxLength(50))),
})
