/** The chat flow a connection answers. */
export type ConnectionScope = 'chat' | 'medical'

/**
 * The scope a stored connection answers.
 *
 * Use for any connection kind that a flow reads by scope: the knowledge base
 * today, and the knowledge graph once a turn retrieves from it.
 *
 * NOTICE:
 * A connection saved before the scope switch existed has no value. It keeps
 * answering ordinary chat, which was the only flow that read a connection list
 * when it was written. Remove the default once every settings page has written a
 * scope for every stored connection.
 *
 * @example
 * connectionScope({ scope: undefined })
 * // => 'chat'
 */
export function connectionScope(connection: { scope?: ConnectionScope }): ConnectionScope {
  return connection.scope ?? 'chat'
}
