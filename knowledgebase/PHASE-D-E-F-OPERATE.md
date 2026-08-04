# Phase D / E / F - Operate the AI company

**Status:** Design - implement after user approval  
**Product:** Flolah / Agent OS as **AI Company OS**  
**Depends on:** Phase C complete (company formed: people, mission, DNA, policy seed)  
**Canonical product doc:** [AI-COMPANY-OS.md](./AI-COMPANY-OS.md)

---

## One-line story

| Moment | Question | Outcome |
|--------|----------|---------|
| **Phase C** | *Who are we?* | Org chart, mission, DNA, recommended systems |
| **Phase D Day 0** | *How do we run?* | **Operating model** (agreed, versioned) |
| **Phase D Day 1** | *Can we operate alone?* | MD + workflows + connectors + runbooks **applied** so the company can run autonomously under CEO gates |
| **Phase E** | *Can we scale and harden?* | Native APIs, multi-company, real metrics |
| **Phase F** | *Do we get better?* | Self-improve MD + workflows from outcomes |

Phase C answers **form**. Phase D+ answers **run**. Nothing in D Day 1 is fully automated until Day 0 operating model is **confirmed**.

---

## Prerequisite: Operating model (Phase D Day 0)

### Definition

An **operating model** is the shared contract for how this company works **every day**:

1. **Cadence** - what runs on what schedule (daily / weekly / event-driven)
2. **RACI for work** - which AI employee owns which loop; who reviews; when CEO decides
3. **Autonomy matrix** - per action class: auto / recommend / require CEO approval  
   (examples: research auto; draft auto; publish gated; spend gated; external send gated)
4. **Channel ownership** - which surface each employee operates (FB / IG / LI / YT / email / Slack / etc.)
5. **Quality bars** - brand / legal / safety checks before publish
6. **Escalation paths** - when to block, reassign, or call human
7. **Systems of record for operate** - not a wish list: which connectors / Browser Session / tools must be **ready** for Day 1
8. **KPIs and reporting** - what CEO gets daily/weekly (digest shape)

Stored as versioned company artifact (e.g. `company_operating_model` + optional Knowledge tables), linked to company id / setup instance.

### How the model is produced (same pattern as org design)

| Company type | Default source | CEO can |
|--------------|----------------|---------|
| **Dedicated vertical pack** (e.g. Content Creator deep) | **Template** operating model for that industry | Edit, then confirm |
| **Thin pack** (SaaS, talent, trading, etc.) | Template skeleton + pack-specific cadences | Edit / regenerate |
| **Custom / LLM-only** | **LLM proposes** full operating model from Phase C context | Edit, regenerate, confirm |

**Rule:** Template when a pack exists; LLM when none or CEO chooses design-with-AI. Human always **confirms**.

### Interactive UX - Company Operate Day 0 (like Company Setup)

Focus-mode funnel (e.g. `/company-operate` or post-C track How we run):

| Step | Intent | UI pattern (mirrors Phase C) |
|------|--------|------------------------------|
| **0 Welcome** | Form is done. Now decide how the company operates. Offer: Design operating model / Open Home / Skip for later | Same as gate cards |
| **1 Context confirm** | Show mission, DNA, team, systems from Phase C (read-only chips) | Snapshot |
| **2 Source** | Template (if pack) / Design with AI / Start from blank | Radio + primary CTA |
| **3 Propose** | Render operating model: cadence, autonomy matrix, channel map, RACI | Cards + tables; Regenerate for LLM |
| **4 Edit cadence** | Per function / agent: daily tasks, weekly rituals, event triggers | Editable lists |
| **5 Autonomy and CEO gates** | Matrix: Research / Draft / Publish / Reply public / Spend / Hire / Infra | Toggle per row |
| **6 Channels and systems for run** | Mark each required system: not ready / setup later / ready; deep-link Browser Session, OpenConnector | Checklist with actions |
| **7 Escalation and digest** | CEO email/in-app preferences | Short form |
| **8 Review** | Diff vs defaults; I approve this operating model vN | Review + Confirm |
| **9 Day 0 done** | Artifact saved; CTA Continue to Day 1 - make the company run | Success + next |

**Skip policy:** CEO may skip Day 0 temporarily; Home shows persistent banner. Day 1 apply blocked until confirmed.

---

## Phase D Day 1 - Install autonomy (run kickstart)

**Only after** operating model vN is confirmed.

### Apply pipeline

1. **Materialize employee MD** from model (`AGENTS.md`, `SOUL.md`, tools grants, runbooks)
2. **Create / update workflow graphs** - one per loop; schedules + human approve nodes matching autonomy matrix
3. **Bind systems for operate** - Browser Session recipes; OpenConnector deep-links; honest readiness (no fake connected)
4. **Seed operations Knowledge** - calendar, brand kit, post log as model lists
5. **First operate pulse** (optional smoke) - dry-run; no external publish if gated
6. **Day-1 operate briefing** - what runs tonight / what needs human login / what is blocked

### Flagship vertical (must land in Phase D)

**Content Creator:** FB / IG / LI / YouTube via **Browser Session** first; native APIs later in Phase E; channel ownership and publish gates from Day 0 model.

### Phase D exit criteria

- [ ] Day 0 funnel shipped; operating model versioned and loadable
- [ ] Day 1 apply produces MD + workflows + honest connector readiness for flagship
- [ ] Content Creator can run a gated multi-channel content loop with Browser Session
- [ ] No silent connected for unauthenticated systems
- [ ] Docs and Platform Help Operate Day 0 / Day 1

---

## Phase E - Harden and scale operations

**Prerequisite:** Phase D Day 0 + Day 1 for flagship.

| Theme | Work | Outcome |
|-------|------|---------|
| **Native channels** | Browser Session vs API dual path where productized | Lower flakiness; still gated by model |
| **Multi-company** | Isolate operating models per company | No cross-leak |
| **Honest metrics** | Home from real runs, tokens, publish log | Trust |
| **Richer packs** | More Day 0 operate templates | Less LLM cold-start |
| **Ops governance** | Model vN change control and rollback | Safety |
| **Email / digest** | CEO daily operate digest from model | Close the loop |

### Phase E exit criteria

- [ ] At least one channel native/API path documented and tested
- [ ] Multi-company OR scoped single-company hardening
- [ ] Home metrics grounded in real events
- [ ] Operating model version history UI

---

## Phase F - Self-improving company (post-operate)

**Prerequisite:** Stable Phase D loops + enough run history.

| Theme | Work | Outcome |
|-------|------|---------|
| **Learning capture** | From runs / feedback, propose MD + workflow deltas | Continuous improvement |
| **Model evolution** | Suggest operating model patches with human approve | Model stays live |
| **Pack promotion** | Promote successful custom models into soft templates | Reuse |
| **Guardrails** | Never auto-weaken CEO gates | Safety first |

### Phase F exit criteria

- [ ] Closed loop: learn -> propose -> human accept -> update
- [ ] Audit trail of self-improvements
- [ ] No autonomous lowering of spend/publish gates without CEO

---

## Mapping: Phase C setup vs Phase D operate

```
CEO login
   |
   +- Phase C: Create company (form)
   |     Day 0 form funnel -> apply staff / knowledge / policy seed
   |     Briefing: meet your team
   |
   +- Phase D: Run company (operate)
         Day 0: operating model funnel -> confirm vN
         Day 1: materialize MD / graphs / systems -> autonomous ready
         Briefing: what runs without you / what needs you
```

Reuse UX patterns from CompanySetup + APIs as `/company-operate/*`.

---

## Backend sketch

| Piece | Responsibility |
|-------|----------------|
| `company_operating_models` | Version, draft/confirmed, payload |
| `.../operate/gate` | Needs Day 0? Needs Day 1 apply? |
| `.../operate/design` | Template or LLM operating model |
| `.../operate/confirm` | Lock vN |
| `.../operate/apply-day1` | MD write, graphs, seed, readiness |
| Blueprint packs | Export `operatingModel` + `day1Artifacts` |
| LLM operate design | Parallel to company-llm-design for operate |

---

## Implementation order

1. Doc + schema + gate APIs
2. Day 0 UI + template operate models (Content Creator first)
3. LLM operate design for non-pack
4. Day 1 apply: MD materializer + workflow generator
5. Browser Session recipes for Content Creator channels
6. Day-1 operate briefing + Home incomplete banner
7. Phase E backlog
8. Phase F after run data exists

---

## Non-goals

- Autonomous social posting when model says gated
- Company marketplace (later)
- Replacing Phase C form (keep form then operate)

---

## Related docs

- [AI-COMPANY-OS.md](./AI-COMPANY-OS.md)
- [CLIENT-BROWSER-SESSION.md](./CLIENT-BROWSER-SESSION.md)
- [SOCIAL_POSTING_OPTIONS.md](./SOCIAL_POSTING_OPTIONS.md)
- [JOB-APPLICANT-WORKFLOW.md](./JOB-APPLICANT-WORKFLOW.md)

---

*Last updated: Phase D Day 0 operating model prerequisite to Day 1; Phase E/F above.*
