export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://api.airi.build'

/** The authenticated retrieval route on this deployment's API. */
export const KNOWLEDGE_BASE_RETRIEVAL_PATH = '/api/v1/knowledge-base/retrieval'

/** The authenticated graph search route on this deployment's API. */
export const KNOWLEDGE_GRAPH_SEARCH_PATH = '/api/v1/knowledge-graph/search'
