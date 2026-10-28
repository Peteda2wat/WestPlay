const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function minuteOfDay(gameTime: number): number {
  return ((gameTime % 1440) + 1440) % 1440
}

/** "14:22" — the clock as shown in the sidebar. */
/** With `hours24` off (Settings › Appearance › 24-Hour Time), as America writes it: "2:22 PM". */
export function formatGameTime(gameTime: number, hours24 = true): string {
  const minutes = minuteOfDay(gameTime)
  const hour = Math.floor(minutes / 60)
  const minute = String(minutes % 60).padStart(2, '0')
  if (!hours24) return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`
  return `${String(hour).padStart(2, '0')}:${minute}`
}

/** "Thu 14:22" */
export function formatGameClock(gameTime: number): string {
  return `${DAYS[Math.floor(gameTime / 1440) % 7]} ${formatGameTime(gameTime)}`
}

/** "3", "N", "R1" */
export function formatGear(displayedGear: number): string {
  if (displayedGear > 0) return String(displayedGear)
  if (displayedGear < 0) return `R${-displayedGear}`
  return 'N'
}

/** Truck speed (m/s, negative when reversing) as whole km/h, or mph with `miles` (Settings › Appearance › Miles). */
export function speedKmh(speed: number, miles = false): number {
  return Math.round(Math.abs(speed) * (miles ? 2.236936 : 3.6))
}

/** How a trip's time is said: in minutes, or hours and minutes ("12 min", "1:05 hrs"). */
export interface TimeWords {
  minutes: (minutes: number) => string
  hours: (hours: number, minutes: string) => string
}

/** A trip's time left (game minutes) as Apple shows it: "12 min", "1:05 hrs". */
export function formatTripTime(minutes: number, words: TimeWords): string {
  const whole = Math.max(0, Math.round(minutes))
  if (whole < 60) return words.minutes(whole)
  return words.hours(Math.floor(whole / 60), String(whole % 60).padStart(2, '0'))
}

/** A distance (metres, as the game counts them) as Apple shows it: "850 m", "9.4 km", "214 km" (with the
 * language's decimal separator). Close by, to the nearest 10 m, from 100 m the nearest 50. */
export function formatTripDistance(metres: number, decimal = '.', miles = false): string {
  if (miles) return formatMiles(metres, decimal)
  if (metres < 100) return `${Math.max(0, Math.round(metres / 10) * 10)} m`
  if (metres < 975) return `${Math.round(metres / 50) * 50} m`
  if (metres < 9950) return `${(metres / 1000).toFixed(1).replace('.', decimal)} km`
  return `${Math.round(metres / 1000)} km`
}

/** As America shows it: "500 ft" under a tenth of a mile (to the nearest 50 ft, close by 10), then "0.3 mi", "214 mi". */
function formatMiles(metres: number, decimal: string): string {
  const feet = metres * 3.28084
  if (feet < 100) return `${Math.max(0, Math.round(feet / 10) * 10)} ft`
  if (feet < 500) return `${Math.round(feet / 50) * 50} ft`
  const miles = metres / 1609.344
  if (miles < 9.95) return `${Math.max(0.1, miles).toFixed(1).replace('.', decimal)} mi`
  return `${Math.round(miles)} mi`
}
