/**
 * The state a connection test can report.
 *
 * Both settings tabs show it: the knowledge base list and the knowledge graph
 * list read the same four states, because both tests do the same thing.
 */
export type ConnectionTestStatus = 'untested' | 'testing' | 'connected' | 'failed'
