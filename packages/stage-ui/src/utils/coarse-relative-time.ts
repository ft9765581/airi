const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

/**
 * Normalizes an epoch timestamp into a coarse relative label.
 *
 * The chat history list and the long-term memory list share this label.
 *
 * @example
 * formatCoarseRelativeTime(Date.now() - 5 * 60 * 1000, Date.now(), 'en')
 * // => '5 minutes ago'
 */
export function formatCoarseRelativeTime(timestamp: number, now = Date.now(), locale?: string): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const delta = timestamp - now
  const abs = Math.abs(delta)
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) {
      const value = Math.round(delta / ms)
      return formatter.format(value, unit)
    }
  }
  return formatter.format(0, 'second')
}
