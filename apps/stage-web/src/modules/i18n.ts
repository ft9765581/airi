import messages from '@proj-airi/i18n/locales'

import { resolveSupportedLocale } from '@proj-airi/i18n'
import { createI18n } from 'vue-i18n'

function getLocale() {
  // `defaults.ts` writes the deployment language into storage before the app
  // mounts, and the settings store applies it on mount. This literal keeps the
  // render between module load and mount Chinese as well, so the page never
  // starts in the language of the visitor's browser. A stored value wins, which
  // is what makes the language picker on the settings page work.
  const language = localStorage.getItem('settings/language') || 'zh-Hans'

  return resolveSupportedLocale(language, Object.keys(messages!))
}

export const i18n = createI18n({
  legacy: false,
  locale: getLocale(),
  fallbackLocale: 'en',
  messages,
})
