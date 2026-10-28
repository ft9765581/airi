import { integer, maxLength, maxValue, minValue, nonEmpty, number, object, optional, pipe, string, transform } from 'valibot'

/**
 * One graph search request as the browser sends it.
 *
 * The shape follows the published search contract of the knowledge service, so
 * the browser's query string is forwarded unchanged. `q` and `limit` are bounded
 * here because the service would otherwise decide how much one caller can pull
 * per request; these are the bounds the service documents. An absent `limit` is
 * forwarded as absent, so the service applies its own default instead of this
 * process inventing one.
 */
export const KnowledgeGraphSearchQuerySchema = object({
  q: pipe(
    string(),
    nonEmpty('q must not be empty'),
    maxLength(2000),
  ),
  limit: optional(
    pipe(
      // Every query-string value arrives as text. The conversion runs inside the
      // pipeline so an out-of-range value fails validation instead of reaching the
      // route as a string that looks valid.
      string(),
      nonEmpty('limit must not be empty'),
      transform(value => Number(value)),
      number('limit must be a number'),
      integer('limit must be an integer'),
      minValue(1),
      maxValue(50),
    ),
  ),
  book_id: optional(
    pipe(
      string(),
      nonEmpty('book_id must not be empty'),
    ),
  ),
})
