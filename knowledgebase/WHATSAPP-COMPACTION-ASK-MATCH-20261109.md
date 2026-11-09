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

Run `b9bac0ee-9084-4e5b-9d67-7fe7cd997546` then successfully discovered Gmail and fetched an action guide, but attempted provider action IDs as native tool IDs. It did not retrieve emails. Therefore it was not accepted as a pass. Discovery now supplies a structured guide call and explicitly distinguishes provider IDs from callable tools; guides include an example native `tool_call` envelope targeting `connector_execute_action` with the provider ID inside `args.action_id`. The envelope is labeled example-only, uses schema-derived input examples, and does not authorize or automatically dispatch anything. Tests cover unrelated connector namespaces as well as Gmail. This final contract change was deployed backend-only, without restarting WhatsApp, as `agent-os-backend:connector-invocation-20261109`.

## Actual configuration restriction and remaining acceptance boundary

Run `12b30c75-7125-446f-abba-50d13d0c8cc2` reached `connector_execute_action` with normal grants, but access was denied with `FLOASSIST_CONNECTOR_NOT_SELECTED`. Read-only inspection showed Gmail is selected and connected; the owner's FloAssist profile is **stopped**. The lifecycle and app-selection checks had shared one misleading error. They are now separated: paused/stopped profiles return `FLOASSIST_INACTIVE` and name the actual lifecycle restriction, while unselected apps retain their existing denial. Tests preserve both restrictions. No profile, grants or schedules were enabled.

The user has been asked whether explicit on-demand requests should work while proactive automation remains stopped. That decision is pending; no mailbox-summary success or actual WhatsApp delivery pass is claimed. The final replay was still an unsuccessful user task, although it reached the correct connector facade. Failed native tool attempts and the eventual real policy denial are preserved in the evidence rather than counted as a success because the CLI reported `status:ok`.

A separate operational limitation was observed: backend startup synchronizes agent tool catalogs and causes expensive gateway configuration reloads, with connection-handshake timeouts and a WhatsApp 408/reconnect during those reloads. The initial gateway restart also took several minutes. This task did not fix that reload latency; container health alone was insufficient readiness evidence. No failed handshake dispatched the replay task. Overall gateway stability and end-to-end mailbox acceptance must not be described as fully resolved.
