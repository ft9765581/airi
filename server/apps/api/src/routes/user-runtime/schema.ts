import { check, maxLength, minLength, object, pipe, string, unknown } from 'valibot'

export const RuntimeTimestampSchema = pipe(
  string(),
  check(value => Number.isFinite(Date.parse(value)), 'expected an ISO timestamp'),
)

export const SaveRuntimeSettingsSchema = object({
  activeCardId: pipe(string(), minLength(1), maxLength(128)),
  activeCardUpdatedAt: RuntimeTimestampSchema,
  profileContent: pipe(string(), maxLength(20_000)),
  profileUpdatedAt: RuntimeTimestampSchema,
})

export const SaveRuntimeCardSchema = object({
  updatedAt: RuntimeTimestampSchema,
  card: unknown(),
})

export const DeleteRuntimeCardSchema = object({
  updatedAt: RuntimeTimestampSchema,
})

export const RuntimeCardIdSchema = pipe(string(), minLength(1), maxLength(128))
