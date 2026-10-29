---
title: Physical AI — three-phase implementation plan
description: Proposed delivery gates for extending Flolah with shared human, digital and physical work.
---

# Physical AI — three-phase implementation plan

**Status: proposed, 29 October 2026.** This plan extends the existing Company OS. It reuses agents, workflows, knowledge, identity, digital integrations and governance, adding physical capabilities through the [proposed architecture](/systems/physical-ai). Phase gates establish readiness; no release dates or device compatibility are promised.

## Phase 1 — Foundation and safe local actions

**Outcome:** a person can authorize a supported physical device and verify an action through Flolah's existing governance model.

**Deliverables**

- Define PhysicalEntity, PhysicalDevice and PhysicalAgent contracts, normalized capabilities, task semantics, ownership and household/business isolation.
- Define risk tiers, permissions, approval requirements, audit events and an adapter contract covering discovery, pairing, description, state, actions, events and optional tasks.
- Build the capability interface, registry and scoped agent tools alongside existing digital connectors.
- Pilot a securely enrolled Linux Edge Hub with one Home Assistant integration and MQTT event transport. Choose one initial onboarding model: an existing Home Assistant installation or a managed installation.
- Validate WoT descriptions and Flolah policy/task extensions. Publish the tested compatibility list and pairing requirements.
- Provide basic onboarding, authorization and observed status through the web experience; define offline permissions, credential protection and update handling.

**Exit criteria**

1. Two distinct device types use the same capability contract; an authorized user can pair, read and perform a permitted action on pilot equipment.
2. An unauthorized user or another workspace cannot read or control those assets; approval-required and prohibited actions are enforced and audited.
3. Observed state confirms the action. Disconnects, stale observations, timeouts and duplicate requests cannot produce an unsupported success report or unsafe automatic retry.
4. A cloud outage permits only explicitly approved safe local actions, with buffered events reconciled on recovery.

## Phase 2 — Shared human, digital and physical workflows

**Outcome:** pilot users complete an end-to-end routine with accountable actors and evidence across all three forms of work.

**Deliverables**

- Add one supported robot adapter and a PhysicalAgent wrapper with authorization, dispatch, acceptance, progress, final outcomes, cancellation where supported and reconciliation.
- Compose physical tasks with existing digital tools and assigned human steps. Record approval decisions, manual confirmations and exceptions in the workflow history.
- Pilot a Home routine such as preparing for guests and a Business routine such as closing a shop with permitted CRM/ERP or POS access and equipment actions.
- Add guided pairing, progress, notifications and approval experiences. Pilot an Android TV client on compatible existing equipment while retaining the separate Edge Hub.
- Validate consent, camera-data handling if cameras enter the pilot, bounded retries, manual override and clear recovery guidance.

**Exit criteria**

1. A nontechnical pilot user completes onboarding and a routine combining a human step, digital work and a supported physical task.
2. A cleaning task can be submitted, monitored and reconciled; cancellation is verified when supported and limitations are shown when it is unavailable.
3. An obstruction, offline robot, rejected approval or missing human confirmation produces an actionable exception and prevents false completion.
4. A shop-closing pilot produces an auditable record of digital results, observed physical outcomes, staff confirmations and unresolved work.

## Phase 3 — Validated expansion and operational readiness

**Outcome:** expand supported homes and SMEs with repeatable onboarding, reliable operations and evidence of customer value.

**Deliverables**

- Add a second vendor through the capability contract, then prioritize direct Matter, camera, robot or SME protocol adapters according to pilot demand.
- Evaluate a dedicated industrial gateway only when a real SME protocol requirement warrants it. Keep gateway responsibilities clear.
- Establish compatibility certification, adapter versioning, secure updates, recovery, diagnostics, support and fleet health monitoring.
- Package reusable Home and Business skills with declared permissions, safety boundaries and outcome evidence.
- Validate licenses, vendor terms and applicable hardware certification before distributing managed hardware. Consider branded HDMI hardware only after the software and Edge Hub pilots establish demand and support feasibility.

**Exit criteria**

1. A second vendor passes capability and policy checks without rewriting the business workflow.
2. Pilot operations demonstrate recovery after network loss, hub restart and update failure without unsafe replay or false-success reporting.
3. Product and engineering owners agree measurable launch thresholds and confirm pilot results meet them before broader release.
4. Compatibility, limitations, onboarding, support and rollback procedures are documented for the release scope.

## Measurement and release decisions

Track activation-to-first-authorized-action time, pairing success by tested device, task completion, timeout and reconciliation rates, false-success incidents, manual setup effort, adapter effort for a second vendor, time saved and support burden. Establish baselines in Phase 1, assess usefulness in Phase 2 and use agreed thresholds for Phase 3 launch decisions.

Each phase needs product ownership for scope and pilot value, engineering ownership for contracts and reliability, security/privacy review of permissions and data handling, and operations ownership for onboarding and recovery. Phase 2 depends on the Phase 1 gate; Phase 3 depends on validated shared-workflow pilots. Hardware commercialization remains a separate decision.

This three-phase plan consolidates the supplied architecture proposal's contracts/local gateway, physical task/end-user experience, and SME/expansion stages. It is a delivery proposal, not a claim that these capabilities are already implemented.
