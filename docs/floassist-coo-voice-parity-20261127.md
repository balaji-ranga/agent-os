# COO voice and chat parity verification — 27 November 2026

## Problem and correction

The reported voice invitation created a guest session. Its restricted catalogue omitted organisation, agent work history and email tools; its generic CRM guidance also directed task enquiries to the wrong ledger. Chat department enquiries used ERP contacts rather than Flolah departments. Duplicate protection then correctly blocked the repeated contacts read.

Verified owner-issued COO invitations now carry a signed private-assistant audience. Unverified senders, other agents, existing guest invitations and public widgets retain guest access. Generate a fresh invitation for private COO calls. The backend derives identity and permissions; model-supplied owner identifiers cannot elevate access.

Chat receives fresh owner-scoped company, COO, departments, people, agents and assigned-skill context. The typed `organization_read` capability provides complete paginated live records. `agent_work_history` with company scope reads enabled, entitled internal-agent Kanban/delegation history; it does not represent external-agent jobs or every asynchronous platform operation. CRM tasks remain a different source.

Private voice discovers granted tools using four bounded catalogue controls and the same parameter schemas as native chat. Calls use the ordinary tool lease, tenant scope, connector restrictions, policy, approval, budget and execution safeguards. Email remains approval-required under the existing company policy. Paginated results preserve exact JSON without rerunning actions. User-turn identity survives tool continuations; parallel results resume once, and interrupted turns do not restart.

Status-only turns may read certified organisation/task/work observations while action dispatch remains blocked. Ending a private COO call saves its transcript without launching the generic extra CRM wrap-up model or creating unrequested CRM tasks. Other agents retain their existing wrap-up behavior.

## Verification

The scoped VPS image passed the 35-script FloAssist suite and eight additional policy, risk, asynchronous execution, delivery, work-history, result-paging and voice-egress suites. Native plugin build checks and frontend build/turn-continuation tests passed. Tenant isolation, non-COO restrictions, revoked grants, expired/guest invitations, typed schemas, shared snapshot paging and mocked provider manifest creation are covered.

Live governed HTTP acceptance verified 12 departments, 1 org person, 42 internal/external roster entries and 1 assigned skill. Company completed-work count matched the enabled-agent ledger (1 in the seven-day test window). Equivalent reads retained their prior successful observation; a fresh utterance could read again. Native chat context contained fresh organisation evidence and Asia/Singapore timezone.

A real provider ephemeral session credential was minted for a verified private invitation, confirming acceptance of its session/tool manifest. No audio, text or WebRTC inference was submitted. Natural-language spoken tool selection and microphone/audio behavior are therefore not claimed as tested.

Email discovery passed. A deliberately invalid-recipient safety probe returned approval-required before dispatch (dispatch count zero); its exact test approval was rejected and closed. No email was sent and no production approval policy was relaxed.

Final live checks passed: organisation and company-history reads under the status-only boundary, rejection of a new voice-invite action under that boundary, and COO hangup skipping additional model work. These final checks used zero conversational model calls. Test sessions were ended.

Deployment updates only the reviewed frontend, backend and OpenClaw images. The final follow-up rollout targets backend and OpenClaw only; other container identities are checked for preservation. Both services verified all 37 source/runtime plugin files with SHA-256 `873827542b91ef8799e9b0c3f4017ec45d271b652ebb68e2091e0c78248c436f`. Scoped Docker builds copy and verify the current plugin and shared schema sources. No runtime source hotfix, environment credential edit, schedule change, quiet-hours change, autonomy change or model-budget increase was made.
