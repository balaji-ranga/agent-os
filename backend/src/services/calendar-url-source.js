import { createHash } from 'crypto';
import { requestValidatedHttps } from '../lib/ssrf.js';

const CALENDAR_FEED_MAX_BYTES = 5 * 1024 * 1024;
const CALENDAR_FEED_MAX_EVENTS = 5_000;

function text(value, max = 20_000) { return String(value ?? '').trim().slice(0, max); }
function hash(value) { return createHash('sha256').update(String(value ?? '')).digest('hex'); }
function timestamp(value, fallback = '1970-01-01T00:00:00.000Z') {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
function calendarSourceError(message, code = 'CALENDAR_URL_FETCH_FAILED') {
  return Object.assign(new Error(message), { status: 409, code });
}
function unescapeIcsText(value) {
  return String(value || '').replace(/\\[nN]/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
function zonedLocalToUtc(parts, timeZone) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let pass = 0; pass < 3; pass += 1) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const rendered = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
    guess += target - rendered;
  }
  return new Date(guess).toISOString();
}
function icsDate(value, parameters = '') {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!match) return timestamp(raw);
  const [, year, month, day, hour = '00', minute = '00', second = '00', utc] = match;
  const parts = { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute), second: Number(second) };
  const timezone = String(parameters || '').match(/(?:^|;)TZID=([^;:]+)/i)?.[1];
  if (timezone && !utc) {
    try { return zonedLocalToUtc(parts, timezone); } catch { /* fall through to UTC-compatible parsing */ }
  }
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)).toISOString();
}
function normalizeCalendar(row = {}) {
  const payload = {
    provider_event_id: text(row.id, 500),
    title: text(row.title, 500),
    status: text(row.status || 'confirmed', 40).toLowerCase(),
    created_at: timestamp(row.created_at || row.start),
    updated_at: timestamp(row.updated_at || row.created_at || row.start),
    start: row.start || null,
    end: row.end || null,
    organizer: row.organizer || null,
    location: row.location || null,
    description: text(row.description, 5_000),
    transparency: text(row.transparency || 'opaque', 40).toLowerCase(),
    sequence: Number(row.sequence || 0),
  };
  return { ...payload, fingerprint: hash(JSON.stringify(payload)) };
}

export function parseIcalendarFeed(value) {
  const unfolded = String(value || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current?.UID?.value) {
        const id = current['RECURRENCE-ID']?.value ? `${current.UID.value}:${current['RECURRENCE-ID'].value}` : current.UID.value;
        events.push(normalizeCalendar({
          id,
          title: unescapeIcsText(current.SUMMARY?.value),
          status: current.STATUS?.value || 'confirmed',
          created_at: icsDate(current.CREATED?.value || current.DTSTART?.value, current.CREATED?.parameters || current.DTSTART?.parameters),
          updated_at: icsDate(current['LAST-MODIFIED']?.value || current.DTSTAMP?.value || current.DTSTART?.value, current['LAST-MODIFIED']?.parameters || current.DTSTAMP?.parameters || current.DTSTART?.parameters),
          start: icsDate(current.DTSTART?.value, current.DTSTART?.parameters),
          end: current.DTEND ? icsDate(current.DTEND.value, current.DTEND.parameters) : null,
          organizer: current.ORGANIZER ? unescapeIcsText(current.ORGANIZER.value.replace(/^mailto:/i, '')) : null,
          location: current.LOCATION ? unescapeIcsText(current.LOCATION.value) : null,
          description: current.DESCRIPTION ? unescapeIcsText(current.DESCRIPTION.value) : '',
          transparency: current.TRANSP?.value || 'opaque',
          sequence: Number(current.SEQUENCE?.value || 0),
        }));
      }
      current = null;
      if (events.length >= CALENDAR_FEED_MAX_EVENTS) break;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const property = line.slice(0, colon);
    const name = property.split(';')[0].toUpperCase();
    current[name] = { value: line.slice(colon + 1), parameters: property.slice(name.length) };
  }
  return events.filter((row) => row.provider_event_id);
}

export async function fetchIcalendarFeed({ url: initialUrl, httpCache = {}, request = requestValidatedHttps } = {}) {
  let url = String(initialUrl || '').trim();
  const headers = { Accept: 'text/calendar, text/plain;q=0.9' };
  if (httpCache.etag) headers['If-None-Match'] = httpCache.etag;
  if (httpCache.last_modified) headers['If-Modified-Since'] = httpCache.last_modified;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let response;
    try {
      response = await request(url, { headers, signal: controller.signal, maxBytes: CALENDAR_FEED_MAX_BYTES });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.location;
      if (!location || redirects === 3) throw calendarSourceError('Published calendar URL redirected too many times');
      url = new URL(location, url).toString();
      continue;
    }
    const http = {
      etag: text(response.headers?.etag, 500),
      last_modified: text(response.headers?.['last-modified'], 500),
    };
    if (response.status === 304) return { rows: [], not_modified: true, http };
    if (!response.ok) throw calendarSourceError(`Published calendar returned HTTP ${response.status}`);
    const body = await response.text();
    if (!/^\s*BEGIN:VCALENDAR/m.test(body)) throw calendarSourceError('The URL did not return an iCalendar (ICS) feed', 'CALENDAR_URL_INVALID_FEED');
    return { rows: parseIcalendarFeed(body), not_modified: false, http };
  }
  throw calendarSourceError('Published calendar could not be fetched');
}
