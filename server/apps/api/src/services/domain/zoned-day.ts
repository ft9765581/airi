/**
 * Returns an IANA time zone, or UTC when the name is not a real zone.
 */
export function resolveTimeZone(timeZone: string): string {
  if (!timeZone)
    return 'UTC'
  try {
    Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  }
  catch {
    return 'UTC'
  }
}

function wallClock(instant: Date, timeZone: string): { year: number, month: number, day: number, hour: number, minute: number, second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? '0')
  let hour = read('hour')
  // Some engines report midnight as hour 24.
  if (hour === 24)
    hour = 0

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  }
}

function offsetAt(instant: Date, timeZone: string): number {
  const wall = wallClock(instant, timeZone)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  return asUtc - instant.getTime()
}

/**
 * UTC instant when the local calendar day of `now` starts in `timeZone`.
 *
 * Chat search keeps facts from this instant onward. The profile rollup takes
 * facts strictly before it. An unknown zone uses UTC.
 */
export function startOfZonedDay(timeZone: string, now: Date): Date {
  const zone = resolveTimeZone(timeZone)
  const wall = wallClock(now, zone)
  const midnightGuess = new Date(Date.UTC(wall.year, wall.month - 1, wall.day) - offsetAt(now, zone))
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day) - offsetAt(midnightGuess, zone))
}
