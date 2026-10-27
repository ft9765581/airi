import { array, integer, maxLength, minLength, minValue, number, object, optional, partial, pipe, string } from 'valibot'

import {
  IntentLabelSchema,
  IntentLabelStatusSchema,
  IntentRunModeSchema,
  IntentRunStatusSchema,
  IntentSampleGroupSchema,
  RunCasesSchema,
  RunMetricsSchema,
} from '../../schemas/intent-eval-contract'

/**
 * HTTP contracts for the intent evaluation resources.
 *
 * These are request DTOs, not table schemas: the persistence layer owns ids,
 * timestamps and soft deletes, and a client must not be able to set them.
 */

const InputTextSchema = pipe(string(), minLength(1), maxLength(2000))
const PreviousTextSchema = pipe(string(), maxLength(2000))

export const CreateIntentSampleSchema = object({
  input: InputTextSchema,
  previous: optional(PreviousTextSchema),
  group: IntentSampleGroupSchema,
  expected: IntentLabelSchema,
  labelStatus: optional(IntentLabelStatusSchema),
  source: optional(pipe(string(), maxLength(200))),
  sampleSetVersion: optional(pipe(number(), integer(), minValue(1))),
})

export const UpdateIntentSampleSchema = partial(CreateIntentSampleSchema)

/** One import is bounded: a larger set belongs in a script, not one request. */
export const ImportIntentSamplesSchema = object({
  samples: pipe(array(CreateIntentSampleSchema), minLength(1), maxLength(500)),
})

export const CreateIntentRunSchema = object({
  sampleSetVersion: pipe(number(), integer(), minValue(1)),
  mode: IntentRunModeSchema,
  configKey: pipe(string(), minLength(1), maxLength(400)),
  modelId: optional(pipe(string(), maxLength(200))),
  classifierPromptDigest: optional(pipe(string(), maxLength(80))),
  embeddingEndpoint: optional(pipe(string(), maxLength(400))),
  embeddingModel: optional(pipe(string(), maxLength(200))),
  embeddingMargin: optional(pipe(string(), maxLength(40))),
  total: pipe(number(), integer(), minValue(0)),
})

export const UpdateIntentRunSchema = object({
  status: optional(IntentRunStatusSchema),
  completed: optional(pipe(number(), integer(), minValue(0))),
  metrics: optional(RunMetricsSchema),
  cases: optional(RunCasesSchema),
  failureReason: optional(pipe(string(), maxLength(2000))),
})
