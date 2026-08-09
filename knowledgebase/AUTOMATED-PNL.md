# Automated company P&L (Flolah / Agent OS)

**Status:** Design plan (not fully shipped). Captures how CEO tenants measure **cost of running an AI company**, **income streams**, and **success** — with meters in Flolah and books in ERP (ERPNext) when Business Core is on.

**Audience:** product, engineering, Finance/ERP Maker agents, Cursor.

**Related today**

| Area | What exists | Docs |
|------|-------------|------|
| Token meters + budgets | `token_usage` ledger; agent/department monthly token + error budgets | platform-help **18** |
| BYOK vs platform LLM | Profile + vault (`Platform_BYOK`, Replicate, Brave, …) | platform-help **15**, **11** |
| CRM opportunities/deals | Twenty + `crm_*` tools | platform-help **32**, BUSINESS-CORE-WORKSPACE-PLAN |
| ERP embeds + `erp_*` | ERPNext (optional) | platform-help **32** |
| IBKR fills / realized PnL | Ledger + analytics (paper vs live) | platform-help **20**, IBKR-* knowledgebase |
| Operating KPIs | Home OEI (not money) | platform-help **36** |
| Efficiency digest rates | Hourly USD rates = **imputed / management**, not CRM revenue | platform-help **02**, this-week digest explain |

**Entitlements:** every post-login meter, cost line, income line, and posting path is **owner-scoped** (CEO tenant). Never authorize on body `ceo_user_id` alone. Secrets redacted in logs.

---

## 1. Goal

Give each CEO a clear answer to:

1. **What does it cost to run this AI company this period?**  
   (Platform fees · model/API spend · outside opex.)
2. **What income did we earn / collect?**  
   (CRM commercial · channel monetization · trading/other · manual.)
3. **Is the company succeeding financially?**  
   Operating margin + leading pipeline + optional trading block + ops (OEI) — **not** one blended vanity number.

**Product framing:** not another token chart; an **AI company P&L** under the CEO tenant.

---

## 2. Three layers (always separate)

| Layer | Role | SoR / store |
|-------|------|-------------|
| **1. Facts (meters & events)** | What happened (tokens, fills, stage changes, payouts) | Flolah: usage + income_events; IBKR ledger; CRM |
| **2. Valuation & recognition** | Units → $; when money is real vs forecast | Price books + recognition policy packs |
| **3. Books** | Posted financial documents | ERPNext (preferred) or Flolah Financials Lite later; optional shadow / memo |

**Do not** write every chat turn into GL. **Do** aggregate to period lines, then draft Purchase Invoices / Sales Invoices / Journal Entries for Maker → Checker approve.

```text
        USAGE FACTS                    INCOME FACTS
   token_usage, tool units      CRM, channels, IBKR, manual
              \                      /
               \                    /
                v                  v
         price book          recognition policy
                \                  /
                 v                v
              cost_lines      revenue_lines  (owner-scoped)
                        \    /
                         v  v
                   period close pack
                         |
              ERP draft docs + Home pulse
                         |
                   Checker posts books
```

---

## 3. Cost of running the AI company

### 3.1 Cost taxonomy

| Layer | Examples | Who pays cash | Measure |
|-------|----------|---------------|---------|
| **A. Platform** | Flolah plan (free now → monthly/yearly later); overage; Business Core seats | Tenant | Subscription + add-ons catalog |
| **B. Model / tool APIs** | OpenAI/OpenRouter chat, Replicate video, Brave, ElevenLabs, FMP, … | Platform (bundled) **or** CEO (BYOK) | Units × price book; optional provider billing true-up |
| **C. Flolah-mediated infra** | Storage, browser worker minutes, workflow compute (when metered) | Often included in plan | Owned meters |
| **D. Outside Flolah** | Domain, ads, Canva, contractors, CEO’s own cloud | CEO | Manual / bank CSV / ERP import |
| **E. Imputed (memo only)** | “AI labor” hours × rate; platform LLM shadow $ | Not cash | Management ROI decks — **never** auto-post to cash books |

### 3.2 Platform vs BYOK honesty

| Path | Cash truth | CEO view |
|------|------------|----------|
| Platform LLM | Platform COGS / included allowance | Units used; optional **shadow $** for pedagogy; soft budget vs plan |
| BYOK | CEO’s OpenAI/etc. invoice | Meter always; estimate $ from **price book**; **true-up** from provider billing/CSV when available |

Never claim BYOK estimate is the final credit-card amount without true-up.

### 3.3 Usage journal (extend `token_usage` idea)

Owner-scoped **company usage facts**:

- **Who:** `owner_user_id`
- **What:** category, provider, tool / agent / workflow
- **How much:** tokens in/out, images, video-seconds, search calls, storage GB, worker minutes
- **Why:** source (`openclaw_chat`, `delegation`, `workflow_brain`, `a2a_outbound`, content tool, package, …)
- **Quality:** provider-reported vs estimated (flag estimated; Agent View already teaches this for tokens)

### 3.4 Cost valuation → `cost_lines`

Nightly or near-real-time **pricing service**:

1. **Price books** — plan catalog; model $/1M in·out; image/video/search units; included allowance + overage.
2. **Payer attribution** — platform-included vs BYOK-CEO.
3. **Outputs** — MTD AI spend by agent / department / tool / workflow; budget burn (tokens today → optional **USD caps** later); lines ready to post (`platform_subscription`, `llm_openai`, `video_replicate`, `manual_external`, …).

### 3.5 Outside costs

First-class, not an afterthought:

1. Manual line items (CEO or Finance agent)
2. Import (CSV, bank, expenses already in ERPNext)
3. Later: bank/accounting connectors

Without **D**, “AI company cost” is only a tool bill.

---

## 4. Revenue / income pipeline

Revenue is **heterogeneous pull** (CRM stages, channels, brokers, bank), not a single push meter. Same three-layer model; adapters feed one schema.

### 4.1 Income taxonomy

| Family | Examples | Cash truth | Notes |
|--------|----------|------------|-------|
| **A. Platform-mediated operating** | YouTube ads/memberships, social-adjacent if Flolah metrics/publish, content sold as service | Payouts / invoices | Adapters + CSV/API |
| **B. Platform-mediated market** | IBKR realized PnL, dividends | Broker / fills ledger | **Trading / investment block**, not sales revenue by default |
| **C. CRM commercial** | Leads → people → opportunities → deals | Invoice / bank | Twenty; amount SoR moves to **invoice** when issued |
| **D. Direct / human** | Outside retainers, grants, affiliate | Bank / ERP | Manual or import |
| **E. Flolah-as-vendor** | Flolah ARR | Stripe (platform) | **Not** in CEO company P&L |

### 4.2 Core object: `income_event`

| Field | Purpose |
|-------|---------|
| `owner_user_id` | Tenant |
| `stream_id` | e.g. `crm_retainer`, `crm_project`, `youtube_ads`, `ibkr_realized`, `manual_other` |
| `source_system` | `twenty`, `ibkr`, `youtube`, `content_ops`, `manual`, `bank_csv` |
| `source_ref` | deal id, order id, video id, invoice # |
| `occurred_at` / `period` | Economic date |
| `amount` + `currency` | Prefer gross; fees explicit |
| `status` | `forecast` · `recognized` · `collected` · `void` |
| `confidence` | `pipeline` · `contract` · `invoice` · `cash` · `broker_realized` |
| `counterparty` | CRM person/company or broker |
| `cost_center` | CONTENT / SOCIAL / TRADING / … |
| `links` | opportunity, deal, content asset, fill |

**Only `recognized` / `collected`** feed books and success $**. Forecast stays on pipeline pulse.

### 4.3 Stream registry (per company)

Each stream defines: detection · recognition · CoA map · netting · soft attribution (agent/dept).

| stream_id | Detect | Recognize | CoA idea |
|-----------|--------|-----------|----------|
| `crm_opportunity_won` | Twenty Won | On **invoice** or **cash** (policy) | Operating revenue |
| `crm_retainer_period` | Deal + schedule | Period-end; prepaid → deferred | Revenue + deferred liability |
| `youtube_ad_share` | Analytics API / CSV | Payout month or cash | Channel income |
| `social_sponsored` | CRM sponsor deal | Invoice | Projects / campaigns |
| `ibkr_realized_pnl` | Fills / closed lots | Trade day (realized only) | Trading / investment income |
| `ibkr_dividend` | Cash events | Pay date | Investment income |
| `manual_other` | Finance agent | On entry | CEO-picked |

### 4.4 CRM commercial path

```text
Lead/New → Qualified → Proposal → Negotiation → Won → [Invoice] → [Paid]
                                              ↘ Lost (forecast → zero)
```

| Stage | Income layer | UI / books |
|-------|--------------|------------|
| Open opp | Forecast (optional × probability) | Pipeline only |
| Won, no invoice | Contract backlog | Soft commit |
| Invoice issued | Recognized (accrual pack) / AR | ERP Sales Invoice |
| Cash received | Collected | Payment Entry |
| Fail collect | Void / bad debt | JE |

**Rules**

- Weighted pipeline must **not** post to GL as revenue.
- Agent-estimated deal values need Won + document (or invoice).
- A2A task complete ≠ money unless a priced product rule ties work → invoice.
- On conflict, **invoice amount wins** over CRM estimate.

**Attribution (soft, for ROI):** counterparty, campaign, content asset / video id, originating agent — for *which motions produced income* next to that agent’s AI cost.

### 4.5 YouTube / channel operating income

Flolah is strong on operate/publish/CRM; monetization SoR often external.

| Pattern | Trust |
|---------|--------|
| Manual / payout CSV | High for cash |
| Read-only analytics API | Trends; true-up on payout |
| Bank match | Best collection signal |
| CRM “sponsor for video X” | Same commercial path as retainers |

Split under one channel: ads, memberships, Super Thanks, merch, **brand deals (CRM)**. Do not invent organic social reach → revenue; put reach in **OEI/ops**, money in CRM/invoice/payout.

**Asset join for ROI**

```text
content asset → publish events → engagement
             ↘ income_events
             ↘ cost_lines (tokens, video gen)
→ contribution per asset / campaign
```

### 4.6 IBKR / trading

Existing ledger (fills, cash, positions, realized PnL) is the **facts** layer.

| Fact | Status | Books |
|------|--------|-------|
| Realized PnL | `recognized` | Trading contribution |
| Unrealized mark | memo only | Never “revenue” / never GL as sales |
| Dividends / interest | pay date / cash | Investment income |
| Fees / commissions | expense or net of PnL | Trading costs |
| Paper account | memo / sandbox | **Exclude** from success $ by default |

Present **Operating margin** vs **Trading contribution** vs **Total company** separately. Product copy: automation tooling, not financial advice.

### 4.7 Recognition policy packs (company dials)

| Pack | CRM | Channels | IBKR |
|------|-----|----------|------|
| **Cash basis (simple)** | When paid | When payout hits | Realized + cash divs |
| **Accrual commercial** | Invoice issued | Accrue estimate; true-up payout | Realized on close |
| **Strict** | Collected only in success $ | Cash only | Cash-settled only |

**Default early AI companies:** cash + realized-only trading for success $; pipeline and estimates secondary.

### 4.8 Income adapters

```text
                    ┌─ CRMAdapter (Twenty poll/webhook)
income_orchestrator ┼─ ChannelAdapter (YouTube CSV/API)
                    ┼─ TradingAdapter (IBKR ledger)
                    ┼─ ManualAdapter
                    └─ BankMatchAdapter (later)
                              ↓
                     normalizer → income_events
                              ↓
                     recognition_engine (policy pack)
                              ↓
                     ERP poster + Home pulse
```

New stream = `stream_id` + adapter mapping + CoA — not a new dashboard each time. Owner scope, redacted secrets, read-only first where possible.

---

## 5. Success scorecard (do not blend)

```text
Operating success $ = operating revenue (recognized/collected per policy)
                      − cash AI/run opex − outside opex

Trading success $   = realized net − trading fees   (optional block)

Pipeline health     = open $ × stage weights         (leading, not success $)

Ops health          = OEI, error budgets             (non-money)
```

Avoid mixing unrealized PnL + weighted pipeline + shadow AI labor into one “company profit.”

**Imputed labor** and **platform LLM shadow $** stay on **memo** accounts or reports only.

---

## 6. ERP posting map

When Profile ERP = ERPNext (Business Core):

| Doc type | Direction | Examples |
|----------|-----------|----------|
| Purchase Invoice / Expense | Out | Platform subscription, BYOK LLM accrual, freelancers, ads |
| Sales Invoice / Payment | In | Client retainers, projects |
| Journal Entry | Adjust | AI/provider true-up; trading realized summary |
| Cost center / project | Slice | Department, campaign, agent pool |

Post **period aggregates** tagged `source=flolah_usage` or `source=flolah_income`, period, owner company. **Maker drafts, Checker posts.**

Categories without ERP still need **Home / Finance pulse** from `cost_lines` + `revenue_lines` so free-tier CEOs learn burn before paid plans and books.

### 6.1 Example lean chart of accounts (content-focused company)

| Code | Account | Type | Notes |
|------|---------|------|-------|
| 1000 | Cash / Bank | Asset | |
| 1100 | Usage / true-up clearing | Asset/liability | Optional estimate hold |
| 1200 | AR — Clients | Asset | |
| 2000 | AP — Vendors | Liability | OpenAI, Replicate, freelancers |
| 2100 | Deferred revenue | Liability | Prepaid retainers |
| 4000 | Revenue — Content retainers | Income | |
| 4100 | Revenue — Project deliverables | Income | |
| 4200 | Revenue — Channel / sponsorship | Income | |
| 4300 | Trading / investment income | Income | IBKR-style; separate in views |
| 5000 | COGS/OpEx — AI inference (BYOK) | Expense | |
| 5100 | COGS/OpEx — Video / media gen | Expense | |
| 5200 | Human production (contractor) | Expense | |
| 6000 | Platform — Flolah subscription | Expense | $0 until paid plans |
| 6100 | Platform — metered overage | Expense | Future |
| 6200 | Software — other SaaS | Expense | Manual |
| 6300 | Ads & distribution | Expense | Manual |
| 6400 | Infra / domain / email | Expense | Manual |
| 7000 | Shadow — platform included LLM | **Memo** | Do not post as cash |
| 7100 | Shadow — imputed AI labor | **Memo** | Do not post as cash |

**Illustrative cost centers:** `CC-EXEC`, `CC-CONTENT`, `CC-COMMUNITY`, `CC-SOCIAL`, `CC-TRADING`, `CC-SHARED`.

### 6.2 Category → CoA defaults

| Flolah category | Default CoA |
|-----------------|-------------|
| `llm_byok_*` | 5000 |
| `video_*` | 5100 |
| `search_*` | 5000 or 6200 |
| `platform_subscription` | 6000 |
| `platform_overage` | 6100 |
| `manual_*` | CEO pick |
| `shadow_*` | **do not post** |
| CRM / channel operating income streams | 4000–4200 |
| `ibkr_realized_*` | 4300 (or trading expense net) |

### 6.3 Sample month-close (content + light trading)

**Cost side (est.)**

| JE | Dr | Cr | Notes |
|----|----|----|-------|
| Accrue AI BYOK | 5000/5100 + search | AP 2000 | From cost_lines; `confidence=estimated` |
| Outside opex | 5200/6200/6300/6400 | Cash/AP | Manual/import |
| Platform plan | 6000 | Cash | $0 while free (or skip) |
| True-up next period | 5000 delta | AP/Cash | When OpenAI bill ≠ estimate |

**Income side**

| JE | Dr | Cr | Notes |
|----|----|----|-------|
| Retainer invoice paid | Cash/AR | 4000 | CRM deal linked |
| Project invoiced | AR | 4100 | Not yet paid → AR |
| YT ads CSV | Cash / clearing | 4200 | True-up on payout |
| Sponsor still Proposal | — | — | Forecast only |
| IBKR realized | Clearing | 4300 | Separate pulse block |
| IBKR unrealized | — | — | Memo only |

**Management view (illustrative)**

```text
Operating revenue (recognized)     3,300+
Cash AI stack                        (83)
Human production / ads / other      (677)
Platform                               (0)
Operating contribution             ~2,540

Trading realized                      +90
Pipeline open (not in margin)      1,000
Memo: platform LLM shadow              6
Memo: imputed labor                 3,000
```

---

## 7. CEO product surfaces (target)

1. **Company financial pulse** (Home or Finance board) — MTD platform fees, AI API est., other opex, revenue, operating margin; drill by agent/dept/workflow; trading block optional.
2. **Plan & usage** — entitlements + burn vs included bundle (works while plan is $0).
3. **Cost rules** — currency, price book, shadow platform $ on/off, token and later USD budgets.
4. **ERP sync** (if ERPNext) — CoA map, draft monthly pack, Checker approve.
5. **Finance AI employees** — Maker drafts close; Checker signs; expense categorization for outside costs; CRM commercial cases.

---

## 8. Architecture principles

1. **Owner-scoped always** — same entitlements rules as tools.
2. **Meters ≠ money ≠ books.**
3. **Estimate then true-up** — flag estimated $; JE variance on provider/channel bills.
4. **BYOK honesty** — estimate vs OpenAI (etc.) invoice.
5. **Platform path honesty** — included allowance and/or shadow $, not fake CEO charge without billing.
6. **Post aggregates** — not per chat / per fill row into AR unless product explicitly needs it.
7. **Outside costs and outside income first-class.**
8. **Trading ≠ operating revenue** by default.
9. **Invoice > CRM amount** when both exist.
10. **Privacy** — never log raw keys; redact usage payloads as elsewhere.
11. **Paper trading excluded** from success $ unless CEO opts in.

---

## 9. Phased rollout

### Cost phases

| Phase | Deliver | CEO gets |
|-------|---------|----------|
| **C0** | Normalize usage events + $ price book + MTD AI cost by agent | Est. AI stack cost |
| **C1** | Platform plan object (even $0) + included allowance | Ready for paid plans |
| **C2** | Manual/import other opex + simple revenue lines | Contribution without full ERP |
| **C3** | ERPNext posting + CoA map + Maker/Checker close | Real books |
| **C4** | Provider true-up + USD budgets | Hard cost caps |
| **C5** | ROI packs (cost/outcome, imputed labor) | Is it working? |

### Revenue phases (pair with cost)

| Phase | Deliver | Pairs with |
|-------|---------|------------|
| **R0** | Manual income + CRM open/won report (no auto GL) | C0 |
| **R1** | `income_events`; forecast vs recognized; Home pulse | C1 price book |
| **R2** | CRM Won → draft invoice; payment → collected | C2 |
| **R3** | Channel CSV (e.g. YT payouts); bank optional | C3 |
| **R4** | IBKR realized → trading income block | Full close pack |
| **R5** | Channel APIs + asset↔deal↔cost attribution | C5 ROI |

Ship **R0–R1 early** so commercial income is not blocked on YouTube APIs.

**Suggested implementation sequence:** C0 → R0 → R1 → C1 → R2 → C2–C3 → R3–R4 → C4–C5/R5.

---

## 10. Open product decisions

1. Bundled platform LLM: show shadow $ only, or % of allowance only?
2. Books path: ERP-only when configured, or always Flolah Financials Lite?
3. Multi-currency / tax / multi-entity — later; start one currency.
4. Who may see $: CEO only vs Finance dept agents?
5. A2A leaf billing: caller tenant vs leaf owner (mirror token-billing policy)?
6. Success UX: pure margin, or **margin + OEI** product pairing?
7. Default recognition pack: cash vs accrual commercial?
8. Trading always a separate scorecard tile?

---

## 11. Explicit non-goals (v1)

- Full double-entry ERP rewrite inside SQLite.
- Auto-posting every token or fill as its own GL line.
- Treating Digest hourly rates or OEI as revenue.
- Converting paper IBKR to company success by default.
- Treating Flolah platform ARR as tenant revenue.
- Scraping bank without CEO-initiated import/connect.

---

## 12. Implementation notes (when built)

- Prefer services over hotfixes: e.g. `usage-metering`, `pricing-book`, `cost-lines`, `income-events`, `period-close`, `erp-pnl-posting` — each owner-aware.
- Reuse token usage writing paths (`recordTokenUsage` / tool wrappers) as emit points for broader usage facts.
- ERP posting should use existing business-core owner maps (`erpnext_company_id`, `X-Ceo-User-Id` on tools).
- Logs: period totals and categories; never full prompts or vault secrets.
- Tests: synthetic owner meters → cost_lines → draft JE shape; CRM won → forecast→invoice→collected; IBKR paper excluded.
- Deploy/docs: keep this file + platform-help pointer updated; price book / plan catalog also in `.env.example` comments when config lands.

---

## 13. Document history

| Date | Note |
|------|------|
| 2026-08-09 | Initial design from cost + revenue ideation (content sample CoA, CRM/YouTube/IBKR streams, phased roadmap). Design only — not a release claim. |
