"""Generate the self-contained review canvas from the sanitized evidence ledger."""
from pathlib import Path
import base64
import json

root=Path(__file__).resolve().parent.parent
folder=root/'test/evidence/feedback-20261018'
report=json.loads((folder/'results.json').read_text(encoding='utf-8'))
gallery=[]
for name,label in [('reviews-field-review-approve-and-reject.png','Review supports approval and rejection'),('workflow-run4060-audit-results.png','Both website results in workflow audit'),('context-chain-completed.png','Chained workflow completed with current form hidden'),('workflow-owner-workflow-restored-off.png','Temporary public workflow permission restored Off')]:
    gallery.append(dict(label=label,src='data:image/png;base64,'+base64.b64encode((folder/name).read_bytes()).decode()))
template='''import {Stack,Row,H1,H2,Text,Table,Stat,Pill,Button,Link,useState,useHostTheme} from "cursor/canvas";
const report=REPORT;
const gallery=GALLERY;
const base=BASE;
export default function DigitalAdoptionUAT(){
 const theme=useHostTheme(),[status,setStatus]=useState('all'),[feedbackOnly,setFeedbackOnly]=useState(false),[selected,setSelected]=useState('F17'),[image,setImage]=useState(2);
 const cases=report.cases.filter(c=>(status==='all'||c.status===status)&&(!feedbackOnly||c.section==='Guided feedback'));
 const current=report.cases.find(c=>c.id===selected)!;
 return <Stack gap={20} style={{padding:24,color:theme.text.primary,background:theme.bg.editor,maxWidth:1450,margin:'auto'}}>
  <Stack gap={6}><H1>Digital Adoption Copilot — UAT evidence</H1><Text>18 October 2026 · Runtime I / publication J · Platform F</Text><Text weight="semibold">Full Phase 1/2 certification remains partial.</Text><Text tone="secondary">Guided feedback: 18 passed, 1 partial. Remaining live onboarding, effect-policy, privacy and sustained-load gates are explicitly recorded.</Text></Stack>
  <Row gap={30} wrap><Stat label="Passed cases" value={report.counts.passed}/><Stat label="Partial cases" value={report.counts.partial}/><Stat label="Failed cases" value={report.counts.failed}/><Stat label="Deferred cases" value={report.counts.pending}/><Text>208 / 208 application tests locally and in the VPS image.</Text></Row>
  <Row gap={8} wrap>{['all','passed','partial','pending'].map(s=><Pill active={status===s} onClick={()=>setStatus(s)}>{s}</Pill>)}<Pill active={feedbackOnly} onClick={()=>setFeedbackOnly(!feedbackOnly)}>Guided feedback only</Pill><Link href={base+'/index.html'}>Full screenshot report</Link><Link href={base+'/results.csv'}>CSV</Link></Row>
  <Table headers={['Case / feature','Status','Observed behavior','Review']} rows={cases.map(c=>[<Stack gap={4}><Text weight="semibold">{c.id}</Text><Text>{c.feature}</Text></Stack>,c.status,<Text size="small">{c.observed}</Text>,<Button onClick={()=>setSelected(c.id)}>Evidence</Button>])} rowTone={cases.map(c=>c.status==='partial'?'warning':c.status==='pending'?'neutral':'success')} stickyHeader style={{maxHeight:540,overflow:'auto'}}/>
  <Stack gap={8}><H2>{current.id}: {current.feature}</H2><Text>{current.observed}</Text><Text weight="semibold">Recommendation</Text><Text>{current.recommendation}</Text><Row gap={12} wrap>{current.screenshots.map(p=><Link href={base+'/'+p}>{p}</Link>)}{current.artifacts.map(p=><Link href={base+'/'+p}>{p}</Link>)}</Row></Stack>
  <Stack gap={10}><H2>Selected screenshot evidence</H2><Row gap={8} wrap>{gallery.map((g,i)=><Pill active={image===i} onClick={()=>setImage(i)}>{g.label}</Pill>)}</Row><Text size="small" tone="secondary">{gallery[image].label} · Captured from actual UAT browser state, 18 October 2026.</Text><img src={gallery[image].src} alt={gallery[image].label} style={{maxWidth:'100%',maxHeight:650,objectFit:'contain',alignSelf:'start',border:'1px solid '+theme.stroke.primary}}/></Stack>
  <Text size="small" tone="secondary">Scope: loopback laptop fixture and public flolah.cloud; signed-in Flolah workflows are the control plane. Zero public host submissions/login visits. Temporary public workflow capability restored Off. Preview expires 15:17 Singapore. One coordinator/SQLite, two parser workers; no multi-coordinator HA or universal widget/device certification. The expected offline run 4062 is a passing fail-fast test.</Text>
 </Stack>;
}
'''
template=template.replace('REPORT',json.dumps(report,ensure_ascii=False)).replace('GALLERY',json.dumps(gallery)).replace('BASE',json.dumps(str(folder).replace('\\','/')))
target=root/'.local/digital-adoption-uat.canvas.tsx'
target.write_text(template,encoding='utf-8')
print('Generated self-contained UAT canvas with '+str(len(report['cases']))+' cases and four inline screenshots')
