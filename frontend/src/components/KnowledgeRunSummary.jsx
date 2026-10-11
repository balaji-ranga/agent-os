import {formatLocalDateTime} from '../utils/formatDateTime.js';
export default function KnowledgeRunSummary({job:j}) {
  return <div>
    <p>{j.status} · {j.trigger || 'Legacy / unknown trigger'} · Started {formatLocalDateTime(j.started_at,{second:'2-digit'})} · Finished {formatLocalDateTime(j.ended_at,{second:'2-digit'})}</p>
    <p>{j.records} records checked · {j.changed ?? '—'} changed/reindexed · {j.reused ?? '—'} unchanged/reused · {j.deleted ?? '—'} deleted from index</p>
    {j.content_groups_loaded != null && <p title="A source object can produce several indexed passages. Metadata/ID discovery still runs to detect deletion and filter changes.">{j.content_groups_loaded} source objects loaded for content · unchanged content skipped using source versions/history</p>}
    {j.changed == null && <small>Detailed counters were not recorded for this run.</small>}
    <small>Run {j.id}</small>{j.error && <p role="alert">{j.error}</p>}
  </div>;
}
