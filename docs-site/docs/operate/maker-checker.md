---
title: Maker and Checker
---

# Maker and Checker

For CRM, ERP, trading, and some workflow packs, Flolah uses **two roles**:

| Role | Does |
|------|------|
| **Maker** | Drafts the work (lead, quote, order, content, trade plan) |
| **Checker** | Reviews, submits, rejects, or performs high-risk actions |

High-risk examples: large discounts, document submit/cancel, **deleting** a CRM person or company (Checker-only after a review card), live trading (if you use that pack).

## How you supervise

- Kanban cards labelled for CEO approval
- Checker chat for “approve / reject / send back”
- Multi-phase **goal plans** (CRM then ERP): the COO creates a plan; the platform advances when each step finishes; Digest and `/goal-plans` show progress

Ask the COO to run `run crm maker checker` or `run erp maker checker` when those graphs are installed.

A constrained pipeline outcome (verified records, spend cap, no unapproved send) is scored in [Pipeline under constraints](./pipeline-under-constraints.md).

Do not ask Platform Help to post to live books — use COO / Maker / Checker.
