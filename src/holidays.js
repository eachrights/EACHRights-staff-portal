// Weekends and public holidays, shared by the Attendance page and the calendar.
// Keep this file as the one place to add or change days off.

const DAY_MS = 86400000;

// "YYYY-MM-DD" helpers (dates are kept as plain Nairobi calendar days, not instants)
const addDays = (key, n) => new Date(+new Date(`${key}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay(); // 0 = Sunday

// 0 = Sunday, 6 = Saturday. Change this if the office works Saturdays.
export const WEEKEND_DAYS = [0, 6];

export const isWeekend = (key) => WEEKEND_DAYS.includes(weekday(key));

// Fixed-date public holidays ("MM-DD"). Check this list against the official gazette each year.
export const FIXED_HOLIDAYS = {
  "01-01": "New Year's Day",
  "05-01": "Labour Day",
  "06-01": "Madaraka Day",
  "10-10": "Huduma Day",
  "10-20": "Mashujaa Day",
  "12-12": "Jamhuri Day",
  "12-25": "Christmas Day",
  "12-26": "Boxing Day",
};

// Holidays whose date changes every year (Easter, Eid) and any one-off days the government declares.
// Add each one here as "YYYY-MM-DD": "Name".
export const EXTRA_HOLIDAYS = {
  "2026-04-03": "Good Friday",
  "2026-04-06": "Easter Monday",
};

// Name of the public holiday on this day, or "" if it is a normal day
export function holidayName(key) {
  if (EXTRA_HOLIDAYS[key]) return EXTRA_HOLIDAYS[key];
  if (FIXED_HOLIDAYS[key.slice(5)]) return FIXED_HOLIDAYS[key.slice(5)];
  // A fixed holiday that falls on a Sunday is observed on the Monday
  const prev = addDays(key, -1);
  if (weekday(prev) === 0 && FIXED_HOLIDAYS[prev.slice(5)]) return `${FIXED_HOLIDAYS[prev.slice(5)]} (observed)`;
  return "";
}
