import { array, boolean, maxLength, nonEmpty, object, optional, picklist, pipe, record, string, unknown } from 'valibot'

export const SharedRuntimeSettingsSchema = object({
  cards: pipe(array(object({ id: pipe(string(), nonEmpty(), maxLength(128)), card: record(string(), unknown()) })), maxLength(50)),
  activeCardId: pipe(string(), nonEmpty(), maxLength(128)),
  models: object({
    chatProvider: string(),
    chatModel: string(),
    speechProvider: string(),
    speechModel: string(),
    speechVoice: string(),
    hearingProvider: string(),
    hearingModel: string(),
    visionProvider: string(),
    visionModel: string(),
    artistryProvider: string(),
    artistryModel: string(),
  }),
  knowledgeBase: pipe(array(object({
    id: string(),
    name: string(),
    baseUrl: string(),
    knowledgeBaseId: string(),
    enabled: boolean(),
    scope: optional(picklist(['chat', 'medical'])),
  })), maxLength(50)),
})
