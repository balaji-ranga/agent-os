// NYSE published calendar (2026–2028). Unknown calendar years fail closed.
// https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx
const holidays = {
  2026: ['01-01','01-19','02-16','04-03','05-25','06-19','07-03','09-07','11-26','12-25'],
  2027: ['01-01','01-18','02-15','03-26','05-31','06-18','07-05','09-06','11-25','12-24'],
  2028: ['01-17','02-21','04-14','05-29','06-19','07-04','09-04','11-23','12-25'],
};
const early = { 2026: ['11-27','12-24'], 2027: ['11-26'], 2028: ['07-03','11-24'] };
export function tradingSession(at = new Date(), cutoffMinutes = 60) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(p => [p.type,p.value]));
  const day = `${parts.month}-${parts.day}`; const calendarKnown = Boolean(holidays[parts.year]);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const close = early[parts.year]?.includes(day) ? 780 : 960;
  const tradingDay = calendarKnown && !['Sat','Sun'].includes(parts.weekday) && !holidays[parts.year].includes(day);
  const regular = tradingDay && minutes >= 570 && minutes < close;
  return { day: `${parts.year}-${day}`, calendar_known: calendarKnown, regular, minutes_to_close: close - minutes, opening_allowed: regular && minutes < close - Math.max(0,Number(cutoffMinutes)), reason: !calendarKnown ? 'market_calendar_unavailable' : !regular ? 'outside_regular_session' : minutes >= close - Number(cutoffMinutes) ? 'entry_cutoff_reached' : null };
}
