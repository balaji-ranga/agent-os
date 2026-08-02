# Onboarding Helper — implementation plan (v1)

**Status:** Shipped — UI wizard + OpenClaw bridge (`onboarding_save_proposal` / `onboarding_apply_proposal`), selective Review checkboxes, CEO help **27**. Video Tours player later.
**Access:** CEO owner only. Menu: user icon → **Onboarding**; Dashboard chat **Onboarding Helper**.  
**UX:** Chat-primary (OpenClaw or page wizard) + UI confirmation cards with **selective apply**.  
**Agent:** Single COO-style **Onboarding Helper** (`onboardinghelper`).  
**Apply mode:** Structured proposal → draft_journey → Review checkboxes → Apply (or chat `onboarding_apply_proposal` after explicit confirm). **Warn that apply adds org recommendations** when custom agents already exist.  
**Default without helper:** Existing lean CEO pack (COO + Workflow Builder + Platform Help).  
**Ops / E2E prompts:** `knowledgebase/platform-help/27-onboarding-helper.md` · `backend/scripts/e2e-onboarding-wf-prompts.mjs`.

---

## Journey steps (interrelated)

Order matters: later steps consume earlier answers.

1. **Welcome & override warning** — existing org detect; confirm proceed.  
2. **Organization purpose** — what the company does.  
3. **Vision** — aspirational north star.  
4. **Goals** — short-term (1–3y) + long-term (~5y); store in DB.  
5. **Strategic context** — industry, team size, channels (WA/web), risk, budget appetite, content vs ops vs trading emphasis, etc.  
6. **Recommended departments** — cards from purpose/vision; confirm/edit.  
7. **Recommended agents** — mapped to depts; confirm/edit.  
8. **Tools per agent** — grants; confirm.  
9. **Workflows** — starter published graphs / templates; confirm.  
10. **Channels & policies (optional)** — WA/Slack pointers; Policies link.  
11. **Review & apply** — diff vs current; final override confirm; execute.  
12. **Done** — links to Video Tours + Platform Help + Dashboard.

Every step: helper asks 1–3 questions; user answers in chat; UI cards show proposed structured result; Confirm / Edit / Ask again.

---

## Data model (new)

Suggested table `ceo_org_strategy` (owner-scoped):

- owner_user_id (PK/FK)  
- purpose TEXT  
- vision TEXT  
- goals_short_term TEXT / JSON  
- goals_long_term TEXT / JSON  
- strategic_profile JSON (industry, size, channels, priorities, …)  
- draft_journey JSON (step id, answers, proposed org snapshot)  
- status: draft | applied  
- applied_at, updated_at, created_at  

Apply path writes org chart / agents / tools / workflows through existing services (OrgDesigner, create-full-agent, grants, workflow seed) inside a transactional or staged apply with clear logs.

---

## API (sketch)

- `GET /api/onboarding/helper` — draft + status (CEO entitlement)  
- `PUT /api/onboarding/helper/draft` — save step answers  
- `POST /api/onboarding/helper/chat` — guided turn (OpenClaw Onboarding Helper agent)  
- `POST /api/onboarding/helper/confirm-step` — accept card payload for step  
- `POST /api/onboarding/helper/reset` — clear journey session only (not departments/agents)  
- `POST /api/onboarding/helper/apply` — override warning ack required  

---

## Frontend

- Route `/onboarding`  
- User menu item **Onboarding**  
- Layout: left/main chat (guided), right/stepper + confirmation cards  
- Back button restores previous step from draft_journey  

---

## OpenClaw

- Agent id e.g. `onboardinghelper` (CEO-scoped runtime)  
- SOUL/TOOLS: ask clarifying questions; emit structured JSON proposals for cards; never apply without confirm  
- Tools: read-only org snapshot + write only via Agent OS apply API (not raw workspace mutation)

---

## Out of scope for v1

- Multi-agent panel of specialists  
- Automatic YouTube publish  
- Implementing the full content-creation pipeline agents (see CONTENT-CREATION-ORG-BLUEPRINT.md)
