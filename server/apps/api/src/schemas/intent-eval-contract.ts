import { array, boolean, maxLength, minLength, number, object, optional, picklist, pipe, string } from 'valibot'

/**
 * The vocabulary and the stored JSON of the intent evaluation resources.
 *
 * Both the HTTP layer and the persistence layer read these, so they live beside
 * the tables and neither has to import the other's request DTOs.
 */

/** The human label. Anything else is a client bug, not a new label. */
export const IntentLabelSchema = picklist(['medical', 'chat'])

/** The slices the labelled set is read by. Fixed so a report cannot invent groups. */
export const IntentSampleGroupSchema = picklist([
  'medical-explicit',
  'medical-implicit',
  'medical-knowledge',
  'hospital-process',
  'chitchat',
  'short-reply',
  'asr-noise',
])

/** A label nobody confirmed is not an answer a release report may use. */
export const IntentLabelStatusSchema = picklist(['unreviewed', 'reviewed'])

/** One earlier turn a sample depends on. The role decides how it reads. */
export const IntentContextMessageSchema = object({
  role: picklist(['user', 'assistant']),
  content: pipe(string(), minLength(1), maxLength(2000)),
})

/** Up to ten turns: more than one turn is enough to read a follow-up. */
export const IntentContextSchema = pipe(array(IntentContextMessageSchema), maxLength(10))

/** Where a collection sits in the evaluation plan. It grants no permission. */
export const IntentCollectionPurposeSchema = picklist(['development', 'acceptance'])

/** Which method produced a run. */
export const IntentRunModeSchema = picklist(['rules', 'model', 'compare'])

/** A batch outlives one request, so it reports where it is. */
export const IntentRunStatusSchema = picklist(['running', 'completed', 'failed', 'cancelled'])

/** One method's numbers. The denominator travels with the rate (§9.3). */
export const RunMethodMetricsSchema = object({
  recall: optional(number()),
  falsePositive: optional(number()),
  failure: optional(number()),
  uncertain: optional(number()),
  medicalTotal: optional(number()),
  chatTotal: optional(number()),
})

export const RunMetricsSchema = object({
  rules: optional(RunMethodMetricsSchema),
  model: optional(RunMethodMetricsSchema),
})

/**
 * One sample's verdicts, kept with the text and label the run actually saw.
 *
 * This snapshot is why an old report stays readable after the sample set
 * changes: the run never depends on what the current row says.
 */
export const RunCaseSchema = object({
  sampleId: pipe(string(), minLength(1), maxLength(200)),
  input: pipe(string(), minLength(1), maxLength(2000)),
  /** The earlier turns the run actually saw, so a snapshot can be replayed. */
  context: optional(IntentContextSchema),
  expected: optional(IntentLabelSchema),
  rules: optional(string()),
  model: optional(string()),
  disagreement: optional(boolean()),
})

export const RunCasesSchema = array(RunCaseSchema)
