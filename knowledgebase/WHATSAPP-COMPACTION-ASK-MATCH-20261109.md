# WhatsApp conversation compaction failure — 9 November 2026

## Report and root cause

The user's Gmail review at 18:06 SGT on 8 November returned the generic “No reply was generated” fallback. Gateway run `f4db9f9c-6cdd-4298-ad2c-61e77765084a` failed pre-turn compaction with `latest_user_ask_not_reflected`. Both summary model requests returned HTTP 200. No Gmail tool was invoked in this failed turn. The preceding stored user turn was `Hi` at 18:05:19 SGT.

Reproduction using the deployed runtime's compaction test API confirmed that the summary contained the exact protected `Hi` but failed its quality audit. The ask tokenizer falls back to lexical tokens when there are no keywords; the summary tokenizer has other keywords and filters the greeting out. This asymmetric matching caused a false negative and prevented the next request from entering normal execution.

## Generic correction

The native runtime and worker now match against the union of summary keywords and normalized whole lexical tokens. No device, connector, user, or channel is special-cased. Missing asks, exact identifiers, pending-request checks and summary size limits remain enforced. No history reset, grant change, retry increase or model change is involved. Version-sensitive installation fails before writing if both expected compiled call sites are not found; repeated installation is idempotent.

The image build confirms the regression test fails on the original image and passes after patching. Cases include short greetings/acknowledgements, Unicode normalization, Gmail/calendar/audio requests, absent asks and absent identifiers. Existing speech-input routing, async-status-turn, tool-execution-governor and native-budget-reply tests pass.

## Deployment and verification

Gateway-only overlay: `/opt/agent-os-releases/compaction-ask-20261109/compose.json`; image `agent-os-openclaw:compaction-ask-20261109`. Previous gateway image and compose chain are recorded in that release's `rollback.json`. Other deployed services were preserved.

Local Home Assistant and the existing enrolled laptop edge were stopped. Restarted the existing Docker Desktop/HA deployment and edge with its protected file-based credentials. HA returned HTTP 200; authenticated edge status reported cloud connected, Home Assistant connected and simulator connected. This is service health verification, not a physical-device actuation test. A sleeping or powered-off laptop still cannot run its edge.

## Second failure found by the live retest

After readiness, run `5ec8c38b-d4f7-4c52-93a6-80da241f95b4` used the original COO session, WhatsApp channel context and normal grants (172-tool catalog; no test allowlist). Compaction no longer blocked it. It chose `email_list_messages`, a separate productivity binding, and received `FLOASSIST_CONNECTOR_ROUTE_REQUIRED`. The model then stopped instead of discovering the connected-mailbox route. The generic governor had labeled that correction a permanent error and suggested unrelated profile/approval capabilities; prompt guidance also told it to stop on non-retryable results.

The second correction provides grant-derived connector discovery guidance in system context across channels. An explicit route-required error is classified `wrong_source`, with connector discovery/guide/execution alternatives. The original call remains non-retryable; no dispatch or permission bypass is added. Genuine source-selection denials remain permanent errors. Configured fallback arrays are copied before classification, preventing accidental mutation. Regression tests cover these distinctions and web/WhatsApp prompt-hook injection.

Connector discovery, execution-policy, source-reader, async-route and async-tracking regressions pass. The first localhost async test attempt was blocked by the sandbox; rerunning with loopback access passed. A native replay started before gateway readiness timed out in the connection handshake and did not execute the Gmail task; the subsequent replay described above is the relevant tool evidence.

Final live conversation retest and actual WhatsApp delivery verification are pending. This fix alone does not establish that every connector or every possible gateway failure has been eliminated.
