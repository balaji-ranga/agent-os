import {currentFloAssistScope} from './execution-scope.js';
const unwrap=result=>result?.data?.data||result?.data||result;
const fail=message=>Object.assign(new Error(message),{status:409,code:'FLOASSIST_CALENDAR_COVERAGE_INCOMPLETE'});

/** An empty calendar array is a provider no-op, not an all-calendar scan. */
export async function expandCalendarSelection(action,input,readCalendars,context=currentFloAssistScope()){
 if(context?.run&&action==='googlecalendar.list_events'){
  return {...input,calendarId:typeof input.calendarId==='string'&&input.calendarId.trim()?input.calendarId:'primary',...(input.orderBy==='startTime'&&input.singleEvents===undefined?{singleEvents:true}:{})};
 }
 if(!context?.run||action!=='googlecalendar.list_events_all_calendars'||input.calendarIds?.length)return input;
 const ids=new Set();let pageToken;
 for(let page=0;page<20;page++){
  const data=unwrap(await readCalendars({maxResults:250,...(pageToken?{pageToken}:{})}));
  for(const calendar of data?.items||[])if(calendar.id)ids.add(calendar.id);
  pageToken=data?.nextPageToken;
  if(!pageToken)break;
 }
 if(pageToken||!ids.size)throw fail('Could not establish the calendars to check. Calendar discovery must complete before reporting conflicts or an empty agenda.');
 return {...input,calendarIds:[...ids]};
}
export function assertCalendarCoverage(action,result,context=currentFloAssistScope()){
 if(!context?.run||action!=='googlecalendar.list_events_all_calendars')return;
 const data=unwrap(result);
 if(!data?.calendarsQueried?.length||Object.keys(data?.errorsByCalendar||{}).length)
  throw fail('The calendar scan did not verify every requested calendar. Inspect per-calendar failures; do not report no conflicts from an empty or partial check.');
}
