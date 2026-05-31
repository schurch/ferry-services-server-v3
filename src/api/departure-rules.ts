import { dateString } from "./time.js";

export function departureQueryParams(queryDate: string, serviceId: number): Array<string | number> {
  const weekOfMonthRules = matchedWeekOfMonthRulesForDate(queryDate);
  const bankHolidayRules = matchedBankHolidayRulesForDate(queryDate);
  const paddedBankHolidayRules = padTo(12, "__no_matching_bank_holiday__", bankHolidayRules);
  return [
    queryDate,
    serviceId,
    serviceId,
    serviceId,
    ...padTo(4, "__no_matching_week_of_month__", weekOfMonthRules),
    bankHolidayRules.length > 0 ? 1 : 0,
    ...paddedBankHolidayRules,
    ...paddedBankHolidayRules
  ];
}

function weekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function dateUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function firstMondayOfMonth(year: number, month: number): Date {
  for (let day = 1; day <= 7; day += 1) {
    const candidate = dateUtc(year, month, day);
    if (weekday(candidate) === 1) return candidate;
  }
  return dateUtc(year, month, 1);
}

function lastMondayOfMonth(year: number, month: number): Date {
  const monthEnd = addDays(month === 12 ? dateUtc(year + 1, 1, 1) : dateUtc(year, month + 1, 1), -1);
  for (let offset = 0; offset <= 6; offset += 1) {
    const candidate = addDays(monthEnd, -offset);
    if (weekday(candidate) === 1) return candidate;
  }
  return monthEnd;
}

function gregorianEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = ((19 * a) + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + (2 * e) + (2 * i) - h - k) % 7;
  const m = Math.floor((a + (11 * h) + (22 * l)) / 451);
  const month = Math.floor((h + l - (7 * m) + 114) / 31);
  const day = ((h + l - (7 * m) + 114) % 31) + 1;
  return dateUtc(year, month, day);
}

function observedNewYearsDay(year: number): Date {
  const day = dateUtc(year, 1, 1);
  if (weekday(day) === 6) return dateUtc(year, 1, 3);
  if (weekday(day) === 7) return dateUtc(year, 1, 2);
  return day;
}

function observedJan2ndScotland(year: number): Date {
  const day = dateUtc(year, 1, 2);
  if (weekday(day) === 6) return dateUtc(year, 1, 4);
  if (weekday(day) === 7) return dateUtc(year, 1, 3);
  return day;
}

function observedChristmasDay(year: number): Date {
  const day = dateUtc(year, 12, 25);
  return weekday(day) === 6 || weekday(day) === 7 ? dateUtc(year, 12, 27) : day;
}

function observedBoxingDay(year: number): Date {
  const day = dateUtc(year, 12, 26);
  if (weekday(day) === 6 || weekday(day) === 7) return dateUtc(year, 12, 28);
  return dateString(observedChristmasDay(year)) === dateString(day) ? dateUtc(year, 12, 27) : day;
}

function observedStAndrewsDay(year: number): Date {
  const day = dateUtc(year, 11, 30);
  if (weekday(day) === 6) return dateUtc(year, 12, 2);
  if (weekday(day) === 7) return dateUtc(year, 12, 1);
  return day;
}

function specificScottishBankHolidays(year: number): Array<[string, Date]> {
  const easterSunday = gregorianEasterSunday(year);
  return [
    ["new_years_day", dateUtc(year, 1, 1)],
    ["new_years_day_holiday", observedNewYearsDay(year)],
    ["jan2nd_scotland", observedJan2ndScotland(year)],
    ["good_friday", addDays(easterSunday, -2)],
    ["easter_monday", addDays(easterSunday, 1)],
    ["may_day", firstMondayOfMonth(year, 5)],
    ["spring_bank", lastMondayOfMonth(year, 5)],
    ["august_bank_holiday_scotland", firstMondayOfMonth(year, 8)],
    ["late_summer_bank_holiday_not_scotland", lastMondayOfMonth(year, 8)],
    ["st_andrews_day", observedStAndrewsDay(year)],
    ["christmas_day", dateUtc(year, 12, 25)],
    ["christmas_day_holiday", observedChristmasDay(year)],
    ["boxing_day", dateUtc(year, 12, 26)],
    ["boxing_day_holiday", observedBoxingDay(year)]
  ];
}

function isAnyScottishBankHoliday(date: Date): boolean {
  const year = date.getUTCFullYear();
  return specificScottishBankHolidays(year).some(([, day]) => dateString(day) === dateString(date));
}

function isDisplacementHoliday(date: Date): boolean {
  const year = date.getUTCFullYear();
  const observed: Array<[Date, Date]> = [
    [observedNewYearsDay(year), dateUtc(year, 1, 1)],
    [observedJan2ndScotland(year), dateUtc(year, 1, 2)],
    [observedStAndrewsDay(year), dateUtc(year, 11, 30)],
    [observedChristmasDay(year), dateUtc(year, 12, 25)],
    [observedBoxingDay(year), dateUtc(year, 12, 26)]
  ];
  return observed.some(([holiday, base]) => dateString(date) === dateString(holiday) && dateString(holiday) !== dateString(base));
}

function matchedWeekOfMonthRulesForDate(queryDate: string): string[] {
  const date = new Date(`${queryDate}T00:00:00Z`);
  const dayOfMonth = date.getUTCDate();
  const ordinal = ["first", "second", "third", "fourth"][Math.floor((dayOfMonth - 1) / 7)] ?? "fifth";
  const nextWeek = addDays(date, 7);
  const last = date.getUTCFullYear() !== nextWeek.getUTCFullYear() || date.getUTCMonth() !== nextWeek.getUTCMonth();
  return last ? ["every_week", ordinal, "last"] : ["every_week", ordinal];
}

function matchedBankHolidayRulesForDate(queryDate: string): string[] {
  const date = new Date(`${queryDate}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const anyBankHoliday = isAnyScottishBankHoliday(date);
  return [...new Set([
    ...(anyBankHoliday ? ["all_bank_holidays", "other_public_holiday"] : []),
    ...specificScottishBankHolidays(year).filter(([, holiday]) => dateString(holiday) === queryDate).map(([rule]) => rule),
    ...(isDisplacementHoliday(date) ? ["displacement_holidays"] : []),
    ...(weekday(date) === 1 && anyBankHoliday ? ["holiday_mondays"] : []),
    ...(anyBankHoliday && !(month === 12 && (day === 25 || dateString(observedChristmasDay(year)) === queryDate)) ? ["all_holidays_except_christmas"] : []),
    ...(!anyBankHoliday ? ["no_holidays"] : []),
    ...(month === 12 && day === 24 ? ["christmas_eve"] : []),
    ...(month === 12 && day === 31 ? ["new_years_eve"] : []),
    ...((month === 12 && (day === 24 || day === 31)) ? ["early_run_off_days"] : [])
  ])];
}

function padTo<T>(size: number, filler: T, values: T[]): T[] {
  return [...values, ...Array(size).fill(filler)].slice(0, size);
}
