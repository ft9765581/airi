import { integer, maxValue, minValue, nonEmpty, number, object, optional, pipe, string } from 'valibot'

/**
 * One knowledge base retrieval request as the browser sends it.
 *
 * The shape follows the Dify external knowledge base contract, because that is
 * the contract the shipped knowledge base client already speaks. Accepting that
 * shape unchanged keeps the browser free of a second request format.
 *
 * `knowledge_id` and `query` are passed through to the upstream service, which
 * owns their meaning. `top_k` is bounded here because the upstream service would
 * otherwise decide how much context one caller can pull per request.
 */
export const KnowledgeBaseRetrievalRequestSchema = object({
  knowledge_id: pipe(string(), nonEmpty('knowledge_id must not be empty')),
  query: pipe(string(), nonEmpty('query must not be empty')),
  retrieval_setting: optional(object({
    top_k: optional(pipe(number(), integer(), minValue(1), maxValue(50)), 5),
    score_threshold: optional(number(), 0),
  })),
})
