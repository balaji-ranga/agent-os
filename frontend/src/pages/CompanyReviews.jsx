import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const DESTINATIONS = [
  ['working_memory', 'Working memory', 'Current goal or short-lived context'],
  ['agent_playbook', 'Agent playbook', 'Long-term, versioned operating learning'],
  ['recipe', 'Recipe / workflow', 'Repeatable deterministic execution'],
  ['org_policy', 'Org policy', 'Governed permissions or operating rules'],
];
const fmt = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

function Metric({ icon, label, value, detail, tone = 'good' }) {
  return <div className={`review-metric ${tone}`}><span className="review-metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}
function EvidenceList({ title, icon, items, empty, tone, onSelect }) {
  return <section className={`review-evidence-column ${tone || ''}`}><h3><span>{icon}</span>{title}</h3><div className="review-evidence-list">
    {items.length ? items.map((item) => <button type="button" key={item.id} className="review-evidence-item" onClick={() => onSelect?.(item)}><span className="review-evidence-dot"/><span><b>{item.title}</b><small>{item.error || `${item.completed_steps || 0}/${item.step_count || 0} steps · ${item.retries || 0} retries`}</small><em><span>Goal run</span><span>Evidence</span></em></span><i>›</i></button>) : <p className="review-empty">{empty}</p>}
  </div></section>;
}

function Overview({ review, refresh, setStage, selectEvidence }) {
  const s = review.snapshot?.summary || {};
  async function start() { if (review.status === 'ready') { await api.companyReviewsSetStatus(review.id, 'in_session'); await refresh(); } setStage('session'); }
  const openEvidence = (item) => { const actual = [...(review.snapshot?.misses || []), ...(review.snapshot?.wins || [])].find((row) => row.id === item.id) || item; selectEvidence(actual); setStage('session'); };
  return <>
    <div className="review-period"><div><b>▣ {fmt(review.period_start)} – {fmt(review.period_end)}</b><span>Prepared by COO</span><mark>● {review.status === 'ready' ? 'Ready for review' : review.status.replace('_', ' ')}</mark></div>{review.status === 'completed' ? <span className="review-locked">🔒 Review finished · snapshot locked</span> : <button onClick={start}>{review.status === 'in_session' ? '▷ Continue review' : '▷ Initiate review'}</button>}</div>
    <div className="review-metrics">
      <Metric icon="✓" label="Outcomes delivered" value={`${s.outcomes_delivered || 0}/${s.outcomes_total || 0}`} detail={`${s.completion_rate || 0}% of committed outcomes`} />
      <Metric icon="↗" label="Completion rate" value={`${s.completion_rate || 0}%`} detail="Evidence-backed" />
      <Metric icon="◎" label="Goals completed" value={s.goals_completed || 0} detail="This review period" />
      <Metric icon="!" label="Needs attention" value={s.needs_attention || 0} detail="Misses or at risk" tone="warn" />
    </div>
    <div className="review-overview-grid">
      <EvidenceList title="Wins" icon="🏆" items={review.snapshot?.wins || []} empty="No completed goals in this period." tone="wins" onSelect={selectEvidence}/>
      <EvidenceList title="Misses & blockers" icon="△" items={review.snapshot?.misses || []} empty="No misses or blockers." tone="misses" onSelect={selectEvidence}/>
      <section className="review-evidence-column candidates"><h3><span>↗</span>Improvement candidates</h3>{(review.snapshot?.improvement_candidates || []).map((item) => <button type="button" key={item.id} className="review-candidate" onClick={() => openEvidence(item)}><b>{item.title}</b><small>{item.reason}</small><em>Goal run <i>›</i></em></button>)}</section>
    </div>
  </>;
}

function Session({ review, selected, setSelected, refresh, setStage }) {
  const allEvidence = useMemo(() => [...(review.snapshot?.misses||[]),...(review.snapshot?.wins||[])], [review]);
  const defaultEvidence = review.snapshot?.misses?.find((item) => !item.success) || review.snapshot?.misses?.[0] || review.snapshot?.wins?.[0];
  const evidence = allEvidence.find((item) => item.id === selected?.id) || defaultEvidence;
  const locked = review.status === 'completed';
  const [feedback, setFeedback] = useState(''); const [rating, setRating] = useState(evidence?.success ? 'meets_expectations' : 'needs_improvement'); const [destination, setDestination] = useState('agent_playbook');
  const [opinionsLoading,setOpinionsLoading]=useState(false); const [opinionError,setOpinionError]=useState('');
  useEffect(() => { setRating(evidence?.success ? 'meets_expectations' : 'needs_improvement'); }, [evidence?.id, evidence?.success]);
  async function propose() {
    if (!feedback.trim() || !evidence) return;
    await api.companyReviewsFeedback(review.id, { evidence_type: 'goal', evidence_id: evidence.id, agent_id: evidence.agent_id, rating, feedback, classification: 'reusable_operating_lesson', scope: [evidence.agent_id].filter(Boolean) });
    await api.companyReviewsCreateImprovement(review.id, { title: `Improve: ${evidence.title}`, problem: evidence.error || `${evidence.retries || 0} retries / ${evidence.attention_steps || 0} attention steps`, proposed_change: feedback, destination, scope: [evidence.agent_id].filter(Boolean), evidence: [{ type: 'goal', id: evidence.id }], owner_agent_id: review.prepared_by_agent_id || '', success_metric: 'Fewer repeat failures on comparable goals', validation_test: 'Evaluate on the next comparable real goal run' });
    await refresh(); setFeedback(''); setStage('improvements');
  }
  async function generateOpinions() { if(!evidence||feedback.trim().length<20)return; setOpinionsLoading(true); setOpinionError(''); try { await api.companyReviewsGenerateOpinions(review.id,evidence.id,feedback.trim()); await refresh(); } catch(error) { setOpinionError(error.message); } finally { setOpinionsLoading(false); } }
  const evidenceOpinions=(review.opinions||[]).filter(x=>x.evidence_id===evidence?.id&&x.subject_text===feedback.trim());
  return <div className="review-session-layout">
    <aside className="review-agenda"><h3>Review agenda</h3>{['Outcomes','Wins','Misses & blockers','Agent feedback','Commit improvements'].map((x,i)=><button type="button" className={i===3?'active':''} key={x} onClick={()=>i===4&&setStage('improvements')}><b>{i+1}</b><span>{x}<small>{['Review committed outcomes','Celebrate what went well','Analyze gaps and causes','COO and agent respond','Agree on governed actions'][i]}</small></span></button>)}</aside>
    <section className="review-session-main">
      <div className="review-evidence-picker"><label>Evidence under review</label><select value={evidence?.id || ''} onChange={(e)=>setSelected(allEvidence.find(x=>x.id===e.target.value))}>{allEvidence.map(x=><option key={x.id} value={x.id}>{x.title} · {x.status} · {fmt(x.created_at)} · {x.id.slice(-6)}</option>)}</select></div>
      {evidence ? <><div className="review-outcome"><div><mark>{evidence.success?'Completed outcome':'Needs improvement'}</mark><h2>{evidence.title}</h2><strong>{evidence.completed_steps}/{evidence.step_count} steps completed</strong></div><div className="cause-cards"><span><b>{evidence.retries || 0}</b>Retries</span><span><b>{evidence.attention_steps || 0}</b>Blocked/failed</span><span><b>{evidence.agent_id || 'COO'}</b>Owner</span></div></div>
      <div className="review-timeline"><span>⚑<b>Planned</b></span><i>→</i><span>♙<b>Delegated</b></span><i>→</i><span>↻<b>Retry {evidence.retries || 0}</b></span><i>→</i><span className={evidence.success?'done':'blocked'}>{evidence.success?'✓':'▣'}<b>{evidence.success?'Completed':'Blocked / failed'}</b></span></div>
      <div className="review-trace"><h3>Execution evidence</h3><div><b>Actual step inputs</b><pre>{evidence.input_summary || 'No structured step input captured.'}</pre><Link to={evidence.link || '#'}>View goal</Link></div><div><b>Actual step outputs</b><pre>{evidence.output_summary || evidence.error || 'No structured step output captured.'}</pre><Link to={evidence.link || '#'}>View output</Link></div><div><b>Retry event</b><span>{evidence.retries || 0} exception-policy retries recorded</span><Link to={evidence.link || '#'}>View events</Link></div></div></> : <p>No goal evidence is available for this period.</p>}
      {locked && <div className="review-lock-notice">🔒 This completed review is read-only. Create or open a new review period to add feedback.</div>}
      <div className="review-opinion-actions"><div><h3>Review the CEO’s exact draft</h3><p>Enter CEO feedback below first. Flolah then asks the COO and affected agent whether they agree with that exact text in separate, goal-isolated sessions.</p></div><button disabled={locked||opinionsLoading||feedback.trim().length<20} onClick={generateOpinions}>{opinionsLoading?'Requesting opinions…':evidenceOpinions.length?'↻ Reassess this CEO draft':'✦ Ask COO & affected agent'}</button></div>{opinionError&&<div className="error-banner">{opinionError}</div>}
      <div className="review-opinion-grid"><section><h3>COO assessment</h3>{evidenceOpinions.filter(x=>x.actor_role==='coo').map(x=><blockquote key={x.id}><b>{x.position.replaceAll('_',' ')}</b><span>{x.content}</span>{x.proposed_revision&&<small>Suggested revision: {x.proposed_revision}</small>}<em>Generated in isolated COO review session</em></blockquote>)}{!evidenceOpinions.some(x=>x.actor_role==='coo')&&<p className="review-empty">Not requested yet.</p>}</section><section><h3>Affected agent response</h3>{evidenceOpinions.filter(x=>x.actor_role==='agent').map(x=><blockquote key={x.id}><b>{x.position.replaceAll('_',' ')}</b><span>{x.content}</span>{x.proposed_revision&&<small>Suggested revision: {x.proposed_revision}</small>}<em>Generated in isolated agent review session</em></blockquote>)}{!evidenceOpinions.some(x=>x.actor_role==='agent')&&<p className="review-empty">Not requested yet.</p>}</section></div>
      <div className="review-feedback"><label>Overall rating<select disabled={locked} value={rating} onChange={e=>setRating(e.target.value)}><option value="needs_improvement">Needs improvement</option><option value="meets_expectations">Meets expectations</option><option value="exceeds_expectations">Exceeds expectations</option></select></label><label>CEO proposed feedback<textarea disabled={locked} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="Draft the specific behavior expected next time, then request COO and agent opinions above…" /></label><label>Learning destination<select disabled={locked} value={destination} onChange={e=>setDestination(e.target.value)}>{DESTINATIONS.map(d=><option key={d[0]} value={d[0]}>{d[1]}</option>)}</select></label><button disabled={locked || feedback.trim().length < 20 || !evidenceOpinions.some(x=>x.actor_role==='coo') || !evidenceOpinions.some(x=>x.actor_role==='agent')} onClick={propose}>✦ Propose governed improvement</button></div>
    </section>
    <aside className="review-speakers"><h3>Speaking order</h3><div className="done"><b>✓ COO briefing</b><small>Evidence and outcomes prepared</small></div><div className="speaking"><b>2 Agent briefing</b><small>{evidence?.agent_explanation || `${evidence?.agent_id || 'Assigned agent'} has no captured execution explanation.`}</small></div><div><b>3 CEO feedback</b><small>{locked ? 'Review completed' : 'Guidance pending'}</small></div></aside>
  </div>;
}

function Improvements({ review, refresh }) {
  async function decide(id, decision) { await api.companyReviewsDecideImprovement(id, decision); await refresh(); }
  async function completeReview() { await api.companyReviewsSetStatus(review.id, 'completed'); await refresh(); }
  return <div className="review-improvement-layout"><section><div className="review-improvement-head"><h2>Proposed improvements <span>{review.improvements?.length || 0}</span></h2><mark>{review.improvements?.filter(x=>x.status==='draft').length || 0} awaiting CEO decision</mark></div>
    {(review.improvements || []).length ? review.improvements.map((item, idx)=>{const vague=String(item.proposed_change||'').trim().length<20||String(item.proposed_change||'').trim().split(/\s+/).length<4;return <article className={`review-improvement${vague?' vague':''}`} key={item.id}><header><b>{idx+1}</b><h3>{item.title}</h3>{vague&&<mark className="quality-warning">Needs refinement</mark>}<mark className={item.status}>{item.status.replace('_',' ')}</mark></header><div className="improvement-body"><div><small>Preview of behavior change</small><div className="behavior-diff"><span><em>Before</em>{item.problem || 'Current behavior'}</span><i>→</i><span><em>After</em>{item.proposed_change}</span></div>{vague&&<p className="quality-message">This legacy learning is too vague to guide reliable behavior. Refine it in a new review before relying on it.</p>}</div><div><small>Learning destination</small><strong>{DESTINATIONS.find(d=>d[0]===item.destination)?.[1] || item.destination}</strong><p>{DESTINATIONS.find(d=>d[0]===item.destination)?.[2]}</p><p className="soul-note">♡ Soul is not changed by this process.</p></div></div><footer><span>Owner <b>{item.owner_agent_id || 'COO'}</b></span><span>Success metric <b>{item.success_metric || 'Defined in review'}</b></span><span>Rollback <b>Versioned and reversible</b></span>{item.status==='draft'&&<><button className="secondary" onClick={()=>decide(item.id,'reject')}>Reject</button><button disabled={vague} onClick={()=>decide(item.id,'approve')}>✓ Approve</button></>}{item.status==='approved'&&<button className="secondary" onClick={()=>decide(item.id,'rollback')}>↶ Roll back</button>}</footer></article>}) : <div className="review-no-improvements"><b>No improvements proposed yet</b><span>Review evidence and add CEO feedback first.</span></div>}
    <div className="review-loop">{['Feedback','Proposed learning','CEO approval','Versioned rollout','Real task evaluation','Keep or rollback'].map((x,i)=><span key={x}><b>{x}</b><small>{['Real work','Scoped change','Explicit decision','Agents acknowledge','Measure outcome','Retain or revert'][i]}</small>{i<5&&<i>→</i>}</span>)}</div>
    <div className="review-complete"><span>{review.status === 'completed' ? '✓ Weekly review finished and snapshot locked' : 'Finish after every proposed improvement is approved or rejected. Deferred/refinement items must be resolved.'}</span>{review.status !== 'completed' && <button className="finish-review" disabled={(review.improvements||[]).some(item=>['draft','deferred','refinement_requested'].includes(item.status))} onClick={completeReview}>✓ Finish weekly review</button>}</div>
  </section><aside><h3>Review commitments</h3>{['COO owns rollout','Agents acknowledge','System runs evaluation','CEO reviews results'].map((x,i)=><div key={x}><b>{i+1}</b><span><strong>{x}</strong><small>{['Coordinates readiness and owners.','Receive the approved learning.','Measures it on real tasks.','Keeps or rolls back next review.'][i]}</small></span></div>)}<p>🔒 Learning updates are versioned, scoped, and reversible.</p></aside></div>;
}

export default function CompanyReviews() {
  const [cadence,setCadence]=useState('weekly'); const [reviews,setReviews]=useState([]); const [review,setReview]=useState(null); const [stage,setStage]=useState('overview'); const [selected,setSelected]=useState(null); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  async function load() { try { const data=await api.companyReviewsList(); let found=(data.items||[]).find(x=>x.cadence===cadence); if(!found) found=await api.companyReviewsPrepare({cadence}); setReviews(data.items||[]); setReview(found); setError(''); } catch(e){setError(e.message);} finally{setLoading(false);} }
  useEffect(()=>{setLoading(true);load();},[cadence]);
  const refresh=async()=>{if(!review)return;setReview(await api.companyReviewsGet(review.id));};
  const counts=useMemo(()=>review?.snapshot?.summary||{},[review]);
  if(loading)return <div className="company-reviews loading">Preparing evidence-backed review…</div>;
  if(error)return <div className="company-reviews"><div className="error-banner">{error}<button onClick={load}>Retry</button></div></div>;
  return <div className="company-reviews"><header className="reviews-title"><div><h1>Company Review</h1><p>Outcome-driven review of agent performance and business impact.</p></div><div className="reviews-status">{counts.outcomes_total||0} outcomes reviewed</div></header>
    <nav className="review-tabs"><button className={stage==='overview'?'active':''} onClick={()=>setStage('overview')}>Review outcomes</button><button className={stage==='session'?'active':''} onClick={()=>setStage('session')}>Feedback & analysis</button><button className={stage==='improvements'?'active':''} onClick={()=>setStage('improvements')}>Improvement plan</button><span/><button className={cadence==='weekly'?'selected':''} onClick={()=>setCadence('weekly')}>Weekly</button><button className={cadence==='monthly'?'selected':''} onClick={()=>setCadence('monthly')}>Monthly</button></nav>
    {review&&stage==='overview'&&<Overview review={review} refresh={refresh} setStage={setStage} selectEvidence={setSelected}/>} {review&&stage==='session'&&<Session review={review} selected={selected} setSelected={setSelected} refresh={refresh} setStage={setStage}/>} {review&&stage==='improvements'&&<Improvements review={review} refresh={refresh}/>}</div>;
}
