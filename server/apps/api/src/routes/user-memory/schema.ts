import { array, integer, maxLength, maxValue, minLength, minValue, number, object, picklist, pipe, string } from 'valibot'

export const MemoryIdSchema = pipe(string(), minLength(1), maxLength(128))

export const SearchMemoriesQuerySchema = object({
  characterId: pipe(string(), minLength(1), maxLength(128)),
  query: pipe(string(), maxLength(4_000)),
})

export const RememberMemoriesSchema = object({
  characterId: pipe(string(), minLength(1), maxLength(128)),
  items: pipe(
    array(object({
      scope: picklist(['user', 'character']),
      content: pipe(string(), minLength(4), maxLength(500)),
      importance: pipe(number(), integer(), minValue(1), maxValue(10)),
    })),
    minLength(1),
    maxLength(3),
  ),
})
