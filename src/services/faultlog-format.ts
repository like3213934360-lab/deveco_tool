/** Calendar suffixes are device-local; epoch suffixes are timezone-independent. */
export function faultlogTimestamp(
  name: string,
  offsetMinutes: number,
): number | null {
  const raw = /-(\d{10,17})(?:\.log)?$/.exec(name)?.[1];
  if (!raw) return null;
  if (/^(?:19|20)\d{12}(?:\d{3})?$/.test(raw)) {
    const year = Number(raw.slice(0, 4)),
      month = Number(raw.slice(4, 6)),
      day = Number(raw.slice(6, 8)),
      hour = Number(raw.slice(8, 10)),
      minute = Number(raw.slice(10, 12)),
      second = Number(raw.slice(12, 14)),
      stamp = Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        second,
        Number(raw.slice(14) || 0),
      ),
      date = new Date(stamp);
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    )
      return null;
    return stamp - offsetMinutes * 60000;
  }
  const stamp = Number(raw) * (raw.length <= 11 ? 1000 : 1);
  return Number.isSafeInteger(stamp) && !Number.isNaN(new Date(stamp).getTime())
    ? stamp
    : null;
}
export function faultlogBundle(name: string): string | null {
  const body = /^(?:jscrash|cppcrash|appfreeze)-(.+)-\d{10,17}(?:\.log)?$/
    .exec(name)?.[1]
    ?.replace(/-\d+$/, "");
  return body && /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(body) ? body : null;
}
