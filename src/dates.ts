import { DateTime } from "luxon";

export function monthStart(month: string): string {
  const parsed = DateTime.fromFormat(month, "yyyy-MM", { zone: "UTC" });
  if (!parsed.isValid) {
    throw new Error("Month must use YYYY-MM format.");
  }
  return parsed.startOf("month").toISODate()!;
}

export function previousMonth(zone: string, now = DateTime.now().setZone(zone)): string {
  return now.minus({ months: 1 }).toFormat("yyyy-MM");
}

export function currentMonth(zone: string, now = DateTime.now().setZone(zone)): string {
  return now.toFormat("yyyy-MM");
}

export function monthDisplayName(month: string, locale = "uk"): string {
  return DateTime.fromISO(`${month}-01`, { zone: "UTC" }).setLocale(locale).toFormat("LLLL yyyy");
}

export function recentMonths(zone: string, count = 4): string[] {
  const start = DateTime.now().setZone(zone).startOf("month");
  return Array.from({ length: count }, (_, index) => start.minus({ months: index }).toFormat("yyyy-MM"));
}
