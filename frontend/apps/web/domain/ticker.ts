/**
 * Ticker suggested from a portfolio name: initials of up to five words, or the
 * first four letters of a single word. Uppercase A–Z/0–9, 2–10 characters, or ''.
 */
export function suggestTicker(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  const ticker = words.length === 1 ? words[0].slice(0, 4) : words.slice(0, 5).map(word => word[0]).join('');
  return ticker.length >= 2 ? ticker.slice(0, 10) : (words[0] + (words[1] ?? '')).slice(0, 3).padEnd(2, 'X');
}
