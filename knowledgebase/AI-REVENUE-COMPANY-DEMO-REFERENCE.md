# AI Revenue Company — reference demo company and objectives

**Purpose:** canonical, repeatable flagship demo data and acceptance expectations.  
**Implementation plan:** [`AI-REVENUE-COMPANY-OBJECTIVES-IMPLEMENTATION.md`](./AI-REVENUE-COMPANY-OBJECTIVES-IMPLEMENTATION.md).

This document defines reference identities and business data only. It contains no password, token, API key or live personal information. Deployment must create credentials through the normal secure bootstrap process and must never commit them.

## Reference company

**Company:** Northstar Growth Systems Pte. Ltd.  
**Company ID/slug:** `demo-northstar-growth`  
**Industry:** B2B SaaS — operations software  
**Country:** Singapore  
**Currency:** SGD  
**Fiscal year:** January–December  
**Headcount:** 18  
**Offer:** operations platform for growing service, logistics and distribution SMEs  
**Typical annual contract value:** S$12,000–S$30,000  
**Mission:** Help Singapore SMEs replace fragmented operational work with a secure, measurable company operating system.  
**Management style:** AI executes internal research and reversible preparation; external communication requires CEO approval.

## Reference CEO user

**Display name:** Maya Tan  
**User ID:** `ceo-demo-northstar`  
**Role:** Founder and CEO  
**Tenant:** `demo-northstar-growth`  
**Timezone:** `Asia/Singapore`  
**Preferred briefing:** in-app every morning; WhatsApp exception summary; Monday email review  
**Authority rule:** research and internal record preparation allowed; external outreach always requires scoped approval  
**Demo credentials:** provision at deployment time and store outside Git; no fixed password belongs in this reference.

## Reference operating team

- **COO** — owns objective decomposition, initiative coordination, exception management and briefing.
- **Research Analyst** — discovers target companies and records public evidence.
- **Lead QA** — validates ICP fit and rejects unsupported candidates.
- **CRM Maker A** — creates company/contact/opportunity proposals and records.
- **CRM Checker** — validates deduplication, evidence, stage and valuation before acceptance.
- **Outreach Drafter** — prepares evidence-grounded personalised outreach.
- **Outreach Executor** — sends only content and recipients covered by a valid approval grant.
- **Response Monitor** — correlates replies, classifies intent and proposes CRM updates.

## ICP version 1

### Included

- Headquarters or meaningful operation in Singapore.
- 20–200 employees.
- B2B service, logistics, wholesale/distribution or field-operations business.
- Evidence of operational complexity such as multiple teams, locations, customer handoffs or repeat service delivery.
- Likely annual contract value of at least S$12,000.
- Publicly verifiable company identity and business activity.

### Excluded

- Consumer-only businesses.
- Companies outside Singapore with no Singapore operation.
- Fewer than 20 or more than 200 employees unless the CEO approves an exception.
- Direct competitors.
- Records with no reliable evidence of industry or location.
- Contacts or personalisation claims inferred without public evidence.

### Qualification definition

An account is **qualified** only when location, industry, size band and operational need have supporting evidence and no exclusion applies. Unknown fields remain unknown. A qualified account becomes qualified pipeline only after CRM Checker accepts an opportunity with an amount and qualifying stage.

### Pipeline calculation

The authoritative source is the tenant's CRM opportunity collection.

`qualified pipeline = sum(opportunity amount × configured stage probability)`

Included stages are Qualified, Discovery, Solution Fit and Proposal. Research candidates, rejected accounts, duplicates and unverified CRM proposals contribute zero. The UI displays both face value and probability-weighted value, with probability-weighted value used for objective progress.

## Objective alignment

The annual objective is the strategic outcome. Half-yearly and quarterly objectives are aligned contributions. Monthly objectives are near-term operating commitments. A child objective may contribute measurements to a parent, but the roll-up references the same CRM opportunities and must not sum the same opportunity more than once.

### Monthly objective — September 2026

**Name:** Prove the Singapore SME revenue engine  
**Period:** 1–30 September 2026  
**Owner:** COO  
**Outcome:** demonstrate a safe, repeatable research-to-approved-outreach loop and create the first S$25,000 of probability-weighted qualified pipeline.  
**Budget:** S$100 AI and external-tool cost  
**Authority:** internal research, qualification and reversible CRM writes allowed; no external sends without CEO approval.

Key results:

1. Research at least **60 unique accounts**, with public source evidence on 100%.
2. Produce at least **24 qualified accounts** and record a reason for 100% of rejected accounts.
3. Create at least **10 CRM opportunities** accepted by CRM Checker, with zero duplicate opportunities.
4. Reach **S$25,000 probability-weighted qualified pipeline** in CRM.
5. Prepare at least **12 personalised outreach drafts**, with every material claim linked to evidence.
6. Place every proposed external message into one or more CEO approval batches; **zero unapproved sends**.
7. Keep total attributed AI/tool cost at or below **S$100**.
8. Produce a reconciled daily briefing by 08:30 Singapore time with metrics, cost, approvals and exceptions.

Expected initiatives:

- Daily account discovery, weekdays at 09:00.
- Daily Lead QA after discovery completes.
- CRM Maker/Checker batch after qualification.
- Outreach drafting after CRM acceptance.
- Approval collection and approved-send execution.
- Response ingestion and CRM update.

Exit criteria: all safety key results pass, at least S$25,000 is verifiably present in CRM, and the CEO can trace every headline metric to evidence.

### Quarterly objective — Q4 2026

**Name:** Generate S$100k qualified pipeline in Singapore  
**Period:** 1 October–31 December 2026  
**Owner:** COO  
**Aligned to:** FY2026 revenue growth and the H2 2026 revenue objective  
**Outcome:** create S$100,000 of probability-weighted qualified pipeline from the approved Singapore SME ICP.  
**Budget:** S$450 AI/tool cost, excluding human sales payroll  
**Authority:** research and CRM preparation allowed; all first-touch external outreach requires CEO approval.

Key results:

1. Research **240 unique target accounts**, all with current source evidence.
2. Qualify at least **90 accounts** at an evidence completeness rate of at least **95%**.
3. Create at least **35 Checker-accepted CRM opportunities** with zero duplicate opportunity IDs.
4. Reach **S$100,000 probability-weighted pipeline** and at least **S$180,000 face-value pipeline**.
5. Obtain CEO decisions on 90% of outreach drafts within **two business days**.
6. Execute at least **50 approved first-touch messages** with 100% provider receipts and zero unapproved sends.
7. Achieve at least **12 positive responses** and **8 booked discovery meetings**.
8. Keep cost per qualified account at or below **S$5** and attributed AI/tool cost at or below **S$450**.

Health rules:

- Off track when forecast probability-weighted pipeline is below S$90,000 for seven consecutive days.
- At risk when approval backlog contains more than 15 drafts older than two business days.
- Blocked when CRM or the active outreach channel cannot authenticate.
- Data-quality breach when any counted opportunity lacks qualification or CRM read-back evidence.

### Half-yearly objective — H2 2026

**Name:** Establish a repeatable founder-supervised revenue operation  
**Period:** 1 July–31 December 2026  
**Owner:** CEO, operated by COO  
**Outcome:** build a governed revenue engine that consistently discovers, qualifies, contacts and progresses Singapore SME opportunities with minimal founder coordination.  
**Budget:** S$900 AI/tool cost  
**Authority:** external communication remains approval-bound for the entire half year.

Key results:

1. Maintain a rolling pool of at least **120 qualified accounts** with evidence refreshed within 90 days.
2. Create **S$300,000 probability-weighted pipeline** without double-counting opportunities shared with monthly or quarterly objectives.
3. Generate at least **25 positive responses**, **18 discovery meetings** and **8 proposals**.
4. Convert at least **3 opportunities to Closed Won**, with at least **S$45,000 total annual contract value**.
5. Keep false qualification below **10%**, measured from Checker rejection and later sales disposition.
6. Keep duplicate CRM records and duplicate external sends at **zero**.
7. Keep median CEO management time below **20 minutes per business day**, excluding sales meetings.
8. Produce a monthly retrospective with accepted improvement proposals; no improvement may weaken approval, tenant or evidence controls automatically.

### Annual objective — FY2027

**Name:** Make AI-assisted revenue operations a dependable company capability  
**Period:** 1 January–31 December 2027  
**Owner:** CEO  
**Outcome:** operate an auditable, cost-effective revenue system that produces predictable pipeline and revenue while the CEO manages objectives, approvals and exceptions rather than individual tasks.  
**Budget:** S$3,600 AI/tool cost  
**Authority:** policy remains approval-bound until the CEO explicitly approves a narrower recurring grant for a verified segment/channel.

Key results:

1. Produce at least **S$750,000 probability-weighted qualified pipeline** during FY2027.
2. Create at least **180 Checker-accepted opportunities** with complete source and qualification evidence.
3. Generate at least **60 discovery meetings**, **24 proposals** and **10 Closed Won opportunities**.
4. Close at least **S$180,000 annual contract value** attributable to the governed revenue operation.
5. Maintain CRM duplicate rate below **1%**, unsupported personalisation claims at **zero**, and unapproved external sends at **zero**.
6. Keep AI/tool cost below **0.5% of generated face-value pipeline** and report provider cost separately from human cost.
7. Keep median exception-resolution time below **one business day**.
8. Ensure 100% of objective KPI values are reproducible from CRM, evidence, approval and cost records.
9. Complete quarterly objective reviews and two half-year retrospectives with versioned CEO decisions.

## Daily briefing reference

At 08:30 Singapore time, Home Today's Snapshot and the channel briefing use the same objective read model:

> Yesterday: 17 accounts researched, 9 qualified, 8 rejected, 6 outreach drafts awaiting approval, projected qualified pipeline S$42k. Cost S$3.81. One LinkedIn authentication issue needs you.

Required drill-downs:

- **17 researched** opens the candidate records and source evidence.
- **9 qualified** opens qualification decisions.
- **8 rejected** opens rejection reasons.
- **6 awaiting approval** opens the batch approval view.
- **S$42k** opens contributing CRM opportunities and the calculation.
- **S$3.81** opens objective-attributed model/tool cost lines.
- **Authentication issue** opens the affected connector with a reauthentication action.

WhatsApp receives the compact exception-oriented version. Monday email receives the fuller weekly roll-up. Neither channel calculates metrics independently.

## Canonical demo script

1. Sign in as `ceo-demo-northstar` and show Company mission, Revenue Company team, CRM connection and Action control.
2. Open Objectives and enter the quarterly outcome in natural language.
3. Review Objective Studio's proposed key results, assumptions, authority and initiatives.
4. Approve and operate.
5. Open the objective cockpit and show Goal Plans starting under the discovery and qualification initiatives.
6. Drill from a qualified count to public evidence, then to a Checker-accepted CRM opportunity.
7. Show outreach drafts waiting without any external send.
8. Approve selected drafts and show exact-scope grants, provider receipts and CRM activities.
9. Ingest a positive reply and show Response Monitor update the objective and propose the CRM stage change.
10. Open Home/Digest and show the evidence-backed briefing, forecast, cost, effectiveness and one actionable exception.
11. Ask the COO on WhatsApp, "Why were eight accounts rejected?" and receive a grounded answer plus secure drill-down.
12. Amend the ICP from the UI or channel; show a new objective version and re-planning of only affected initiatives.

## Demo acceptance criteria

- The demo can be reset and replayed without duplicate CRM records or sends.
- All identities and records remain inside `demo-northstar-growth`.
- Every counted account and opportunity has evidence.
- No external action occurs before a matching approval.
- Every approved send has a provider receipt and CRM activity.
- Objective values reconcile across cockpit, Home, Digest, WhatsApp and email.
- Monthly, quarterly, half-yearly and annual roll-ups reuse record references and never double-count.
- A disconnected CRM or channel fails closed and produces one actionable exception.
- The CEO can understand the outcome without opening Workflow Builder or technical logs.
