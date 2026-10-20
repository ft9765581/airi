/**
 * Maps a phone number onto the account identifier that this deployment stores.
 *
 * Use when:
 * - The sign-in page accepts a phone number as the credential identifier.
 * - A stored account email has to be shown back to the visitor.
 *
 * NOTICE:
 * Why: this deployment signs visitors in with a phone number and a password, and
 * it has no SMS channel yet, so the number cannot be verified. Better Auth
 * identifies a password account by email, and `user.email` is `NOT NULL UNIQUE`
 * in `server/packages/auth-shared`, so the number is stored as the local part of
 * a reserved domain instead.
 * Root cause: phone sign-up without an OTP endpoint needs a synthetic
 * identifier until a real `phone_number` column exists.
 * Observed: 2026-10-20, phone-first sign-in requested without SMS.
 * Removal condition: when the `phone-number` plugin lands with an SMS sender,
 * store the number in `user.phone_number`, drop this module, and migrate the
 * accounts whose email ends with {@link PHONE_ACCOUNT_DOMAIN}.
 */

/**
 * Reserved domain for phone-number accounts.
 *
 * `.local` is a reserved TLD and can never receive mail, so a stray
 * password-reset send fails loudly instead of reaching a real mailbox.
 */
export const PHONE_ACCOUNT_DOMAIN = 'phone.local'

/** Mainland China mobile numbers, which is the only format this product accepts. */
const MAINLAND_MOBILE = /^1[3-9]\d{9}$/

/**
 * Removes the separators a phone number is commonly written with.
 *
 * @example
 * normalizePhone('138 0013-8000')
 * // => '13800138000'
 */
export function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, '')
}

/**
 * Whether the input is a phone number rather than an email address.
 *
 * @example
 * isPhoneIdentifier('13800138000')
 * // => true
 */
export function isPhoneIdentifier(value: string): boolean {
  return MAINLAND_MOBILE.test(normalizePhone(value))
}

/**
 * Builds the account email that Better Auth stores for an identifier.
 *
 * An input that is not a phone number passes through unchanged, so the same
 * field keeps serving the accounts that already signed up with an email.
 *
 * @example
 * toAccountEmail('13800138000')
 * // => '13800138000@phone.local'
 * toAccountEmail('nurse@example.com')
 * // => 'nurse@example.com'
 */
export function toAccountEmail(identifier: string): string {
  const trimmed = identifier.trim()
  if (!isPhoneIdentifier(trimmed))
    return trimmed

  return `${normalizePhone(trimmed)}@${PHONE_ACCOUNT_DOMAIN}`
}

/**
 * Turns a stored account email back into what a visitor recognizes.
 *
 * @example
 * toDisplayIdentifier('13800138000@phone.local')
 * // => '13800138000'
 * toDisplayIdentifier('nurse@example.com')
 * // => 'nurse@example.com'
 */
export function toDisplayIdentifier(accountEmail: string): string {
  const suffix = `@${PHONE_ACCOUNT_DOMAIN}`
  return accountEmail.endsWith(suffix) ? accountEmail.slice(0, -suffix.length) : accountEmail
}

/**
 * Default display name for an account created from an identifier.
 *
 * A phone number keeps the number: the local part of its synthetic email is the
 * number itself, so deriving a name from the email would produce the same value
 * with the reserved domain attached.
 *
 * @example
 * defaultAccountName('13800138000')
 * // => '13800138000'
 * defaultAccountName('nurse@example.com')
 * // => 'nurse'
 */
export function defaultAccountName(identifier: string): string {
  const trimmed = identifier.trim()
  if (isPhoneIdentifier(trimmed))
    return normalizePhone(trimmed)

  return toAccountEmail(trimmed).split('@')[0]
}
