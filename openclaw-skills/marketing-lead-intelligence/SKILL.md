---
name: marketing-lead-intelligence
description: Correlate owner-scoped multi-channel marketing engagement with CRM people, prior campaigns, interests and opportunities; qualify leads and recommend evidence-backed next actions without creating duplicate contacts or bypassing consent.
---

# Marketing Lead Intelligence

Use this skill when campaign engagement must become a lead, an existing lead returns through another channel, or the CEO needs advice on the next best follow-up.

## Identity and opportunity resolution

1. Read the Marketing workspace and CRM before creating anything.
2. Treat an exact `crm_person_reference`, `crm_lead_reference`, or platform-generated owner-scoped identity hash as authoritative.
3. Never auto-merge people from a similar name, company, email fragment, social handle, or model guess. Report a **possible match** with confidence and ask for verification when no authoritative key exists.
4. Separate **person identity** from **commercial opportunity**:
   - same person + same need/product/outcome = update the existing lead/opportunity;
   - same person + materially different need/product/outcome = reuse the CRM person and create a distinct opportunity linked to that person;
   - different authoritative identity = a different person, even when campaign interests overlap.
5. Do not create another CRM person when the existing person reference is known.

## Build the interest profile

- Use `marketing_lead_prepare` with attributed engagement event IDs and the known CRM person reference or identity reference.
- Combine evidence across campaigns and channels: delivered/read/open signals, clicks, replies, comments, messages, lead forms, conversions, call outcomes, suppressions and provider receipts.
- Keep each interest attached to its campaign, asset, channel, timestamp and evidence ID. Do not infer an interest from delivery or an impression alone.
- Give stronger weight to explicit actions such as reply, qualified call outcome, message, lead form or conversion. Apply the configured channel strategy and attribution window.
- Treat email pixels as an **open signal**, not proof of human reading; mail proxies and blocked images affect reliability.
- Suppression wins over score. Unsubscribe, opt-out, do-not-call, denied consent or an equivalent CRM restriction makes the lead ineligible for that follow-up channel.

## CRM handoff

When the prepared profile is qualified and eligible:

1. Call `marketing_crm_handoff` with the stable Marketing `lead_id`. Do not separately sequence CRM person and opportunity creation.
2. The handoff reuses the selected or exact-matching CRM person, otherwise creates a person only from a verified campaign identity, creates the lead/opportunity idempotently, and stores the returned references on the Marketing row.
3. Read the returned person and lead/opportunity IDs and report them. A retry with the same `lead_id` must return the same linked record rather than duplicate it.
4. If CRM is unavailable, create a Kanban handoff and keep the Marketing lead status qualified; do not claim CRM sync succeeded.

## CEO recommendation

Return a compact advisory with:

- whether this is a new person, an existing person with the same opportunity, or an existing person with a new opportunity;
- strongest current interest and relevant prior campaign interests;
- evidence IDs and confidence (`high`, `medium`, or `needs verification`);
- consented preferred channel and timing;
- the next best action, expected outcome and reason;
- duplicate, fatigue, suppression, conflict or stale-interest risks;
- exact CRM record created or updated, if any.

Recommendations are advice, not permission to contact. External email, WhatsApp, social messages, calls, form submissions and ad changes still require a granted tool and the effective Action Control policy.
