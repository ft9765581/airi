import messages from '@proj-airi/i18n/locales'

import { resolveSupportedLocale } from '@proj-airi/i18n'
import { createI18n } from 'vue-i18n'

/**
 * The language of this sign-in surface.
 *
 * The value is fixed on purpose, and it replaces the usual lookup order
 * (`settings/language`, then `navigator.language`).
 *
 * - The stored value is useless here. This app runs on its own origin, so it
 *   cannot read the language that the stage app stores for a different origin.
 * - The browser value is wrong here. One deployment serves one product in one
 *   language, and a visitor whose browser reports English must still read the
 *   form in Chinese.
 *
 * Change this value to serve another language, then check that
 * `packages/i18n/src/locales/<locale>/server/auth.yaml` is complete. The stage
 * app keeps its own language setting.
 */
const SIGN_IN_LOCALE = 'zh-Hans'

export const i18n = createI18n({
  legacy: false,
  // `resolveSupportedLocale` falls back to `en` when the locale is not compiled
  // into the bundle, so a typo here shows English instead of a crash.
  locale: resolveSupportedLocale(SIGN_IN_LOCALE, Object.keys(messages!)),
  fallbackLocale: 'en',
  messages,
})
