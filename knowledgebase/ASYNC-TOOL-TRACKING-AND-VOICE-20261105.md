# Async tool tracking and voice input — 2026-11-05

## Behaviour

- Tools → Execution behaviour → Response mode: sync by default; async returns a durable `track-…` identifier immediately. Execution still follows existing tool grants and action policy.
- `tool_execution_status` reads a tracking ID or the current conversation's recent requests. Records are scoped to company, agent and conversation. Base and tenant runtime catalogs must both expose this read-only capability.
- Final updates contain the same tracking ID. Web notifications are deduplicated by that ID; completed delivery is persisted. Explicit status enquiries do not create another notification.
- WhatsApp recipients come from trusted runtime metadata, not model arguments. If the originating recipient cannot be established, use the owner's/actor's web inbox rather than guessing a recipient.
- An uncertain channel send is not sent again through another transport method. A gateway may finish an already accepted delivery later; Flolah records a web fallback when the channel receipt is uncertain.
- No tool is automatically replayed after a backend interruption. An attached physical operation is polled; an interrupted generic call without a final result becomes uncertain at its deadline.
- Async wraps the HTTP execution of any registered content tool. Provider responses that themselves return pending jobs need a status adapter; the physical operation adapter is implemented. Other pending provider jobs are not falsely declared completed.
- Finished/reported tracking history participates in the existing company retention registry. Pending work is not purged as completed history.

## Evidence

- `test-tool-async-route.mjs`: real `/invoke` handler; existing `master_data_list_tables` sync/async result parity; repeated calls retain the original tracking ID; generic status-tool dispatch; one notification; status-only requests rejected before new dispatch.
- `test-tool-async-tracking.mjs`: existing read tool and virtual-TV physical control plane; one TV dispatch; delayed result correlation; repeated worker runs do not duplicate callbacks; owner/conversation isolation; restart-like deadline becomes uncertain without replay; read web notification does not become unread again.
- `test-openclaw-session-tool-scope.mjs`: status discovery in both base and tenant agent catalogs.
- `test-async-status-turn.mjs`: observational status turns restrict tool execution to tracking/discovery; fresh explicit actions clear the turn restriction. This is a conservative language guard, not a claim of universal natural-language intent recognition.
- Live read-only callback: `track-48be3622-c45b-4e46-ac09-48295a0da9fd`, completed, notification state `sent`, attempts `1`, web notification count `1`; status enquiry returned the same ID. `master_data_list_tables` was restored to its previous mode afterward.
- Earlier startup test `track-07374e56-ff00-4f4d-b460-d860633718f7`: completed with one web fallback. Gateway startup delayed the channel receipt. This exposed the need to prevent a second transport attempt.

## Failed acceptance test and corrective action

The first native COO status follow-up test (run `a2768f7b-0f43-48ca-80c4-b78382823320`) failed. Despite an explicit read-only request, old TV context led to a new `physical_invoke`; operation `530c7082-9204-4628-96b9-8f927e6d8cf7` reported delivery. This was an unintended real toggle during testing, not a successful status test. No compensating toggle was sent.

The new status capability was derived for base-agent grants but missing from the separate tenant grant calculation. Corrective changes add tenant catalog propagation, explicit status-turn guidance, a gateway tool-call guard, and backend enforcement of the trusted status-only marker. Native tool IDs are qualified (`openclaw:agent-os-content-tools:tool_execution_status`); the guard recognizes that identifier. Status turns receive current tracking context instead of unrelated physical-operation instructions.

Final native acceptance run `60a12cd9-6823-48cc-809b-0a47f08a9ff3` passed: COO used `tool_call` and `tool_execution_status`, with zero tool failures, returned `track-48be3622-c45b-4e46-ac09-48295a0da9fd`, reported completed, and summarized the 24-table result. The acceptance runner additionally restricted this test conversation to the status tool as a safety measure; that temporary scope was restored afterward. Separate regression tests exercise the generic guard. Production logs show zero `physical_invoke` calls after the correction. Both existing completion notifications still have one attempt and one web record after restarts.

Final deployed images: backend and gateway `async-status-final-20261105`; frontend `async-voice-20261105`. Backend, frontend and gateway health checks passed. The frontend build and SQLite retention regression passed. The earlier unintended physical dispatch remains an acceptance failure in this record, not a successful test.

## Voice findings and tests

- Live Piper → Whisper synthetic round trip passed, including Ogg/Opus used by WhatsApp. The engines themselves were available.
- `MEDIA:` references were advertised but not consistently normalized; deleted staging paths were not recovered from their owner-scoped Content Explorer mirror record. Both paths are corrected without selecting arbitrary recent recordings.
- Web multipart parsing lowercased case-sensitive boundary values. The resolver now preserves the original header value; regression coverage exercises the actual upload resolver.
- Shared prompt guidance directs agents with transcription permission to call `speech_stt`, use exact attachment matching, and report actual transcription errors. It distinguishes incoming STT from outgoing TTS and does not add speech grants to unentitled agents.
- Native COO audio test run `edb3ff22-26d8-4713-9acb-9a6cbb70266a`: used `list_inbound_attachments` and `speech_stt`, returned “This is a speech recognition test. The blue notebook is on the desk.” No outbound message delivery or device action was requested in that audio test.
- `test-speech-input-routing.mjs`: media prefix normalization, exact moved-file recovery, company isolation, deleted-file suppression, multipart boundary preservation, capability guidance and callback-recipient isolation.
- A service-token attempt against the web STT endpoint returned 401, as expected for its user-authenticated boundary. This is not an authenticated browser-microphone acceptance test.
- The production web payload resolver plus STT service successfully transcribed synthetic WebM/Opus in the same JSON/base64 format used by the microphone component. This validates payload decoding and the engine, not microphone permissions or capture in the user's browser.

Real user WhatsApp voice-note reception and browser microphone UI interaction still require confirmation; do not equate synthetic/native-runner tests with those end-to-end checks.

## User confirmation and voice follow-up

The user confirmed receiving the WhatsApp completion for `track-48be3622-c45b-4e46-ac09-48295a0da9fd` exactly once. The reported audio failure was a WhatsApp microphone voice note, not a web microphone test. Inspection of the current COO main conversation found audio-refusal turns at 20:08–20:10 SGT on November 5, before the final gateway deployment was ready at 21:05 SGT; no newer voice-note turn was present in that inspected conversation. A fresh user-originated voice note is still required for acceptance.


## Actual voice-note failure and result recovery

The fresh WhatsApp test at 22:46 SGT did reach Whisper successfully. Action `tea-04375402-ea84-44b9-bf5b-6df70967e6cb` returned the transcript "Please transcribe this message only. A blue notebook is on the desk." The model ignored that result, tried incompatible media_ref arguments, and repeatedly encountered duplicate suppression. The plugin replaced the useful prior observation with a generic thrown error, which the final reply misrepresented as inability to process audio.

The shared governor now includes the bounded, redacted original observation in duplicate responses within the existing owner/execution scope. The plugin returns that observation without dispatching again, distinguishing original success from failure. Speech guidance tells the agent to use a successful transcript immediately and stop for transcription-only requests. The speech schema accepts string and object media_ref values and advertises the existing media filename argument. Physical duplicate guards remain enabled.

Restricted native replay of the exact recording passed: run `b9968b5b-f89c-4fce-873d-a40c92aded83`, one speech_stt invocation plus its tool_call wrapper, zero failures, matching transcript, about 11 seconds. The runner had only speech/discovery tools, no outbound delivery and no physical actions.

The first real browser upload test failed: the status-intent guard matched dashboard routing prose about workflow status rather than the transcription request. The correction excludes known dashboard routing/attachment envelopes before classification. Tests cover this exact prompt structure, a genuine status question inside that structure, and clearing a previous status restriction for a fresh audio request. Web acceptance after correction is pending.

Regression tests passed: execution governor (original success/error recovery and physical single dispatch), speech routing, status-turn envelope classification, async HTTP route, and durable async tracking.


Final deployed correction: gateway `voice-web-envelope-20261105`, backend `voice-result-20261105`, frontend unchanged `async-voice-20261105`; all healthy. A browser upload was performed through the normal authenticated UI. After the first failed web reply and correction, browser input submission stopped taking effect even though DOM reads/fills worked. The follow-up referencing the same uploaded recording is prepared in the web composer; user-assisted Send was requested. The post-correction web reply is not yet verified, and browser microphone capture remains untested. Do not describe this as a passed web end-to-end test.


## November 6 web follow-up

The user submitted the prepared web follow-up at 00:20 SGT. It failed: native `read` looked for the recording in the agent workspace, then the model searched/listed physical devices instead of using speech_stt. No transcription tool was invoked. This demonstrates that an isolated speech-only acceptance runner did not validate normal full-catalog web routing.

Correction: capability-scoped current-turn speech guidance uses the qualified speech_stt identifier and the supplied media filename/relative path, explains that uploads resolve through the media API rather than the native filesystem, and suppresses unrelated physical inventory prompt context for audio turns. Device permissions and the ability to discover devices after interpreting a spoken device request remain intact. Tests cover audio/file detection, no speech grant, and normal non-audio device prompts. Direct browser re-upload acceptance is pending deployment readiness.


The next web submission was rejected twice before agent execution by capability-ownership validation. Investigation with the actual active conversation showed router compaction reduced the 96,051-character input to 49,185 characters by removing all capability descriptions. speech_stt was present only as a name. Isolated routing without history chose speech_stt; routing with the failed conversation history chose image-analysis/help capabilities. The fix retains 40-character capability descriptions at the strongest compaction tier. The existing 60,000-character budget test and all 41 focused routing/adjudication checks pass. Ownership validation remains enforced; rejected attempts dispatched no selected tool.


Exact-envelope reproduction then showed the first router correctly selecting speech_stt, followed by the adjudicator assigning it to Platform Help, which does not own it. Thus retaining descriptions alone did not close acceptance. The adjudicator input now includes exact candidate capability-to-executor ownership derived from the supplied catalogs, and its instruction explicitly prohibits role-title-based delegation to non-owners while permitting bounded use of an orchestrator's own utility tools. Ownership validation is unchanged. The new owner-map regression, all 41 router checks, and async route regression pass. This is recorded as a separate correction, not a claim that the earlier compaction change alone passed the web test.


## Web acceptance passed: November 6, 00:44 SGT

The same recording was uploaded through the authenticated web UI and submitted to COO with its normal tool catalog (no temporary speech-only allowlist). The final reply displayed: "Please transcribe this message only. A blue notebook is on the desk."

Native trace: tool call `call_1X8FPXAexHoP6utCwFTV1mQ1` at 00:44:07 SGT invoked only `openclaw:agent-os-content-tools:speech_stt` with the exact uploaded relative path. Its result at 00:44:10 contained the transcript, no error and no duplicate marker. The final assistant reply followed at 00:44:12. No other agent tool invocation appeared in this run, including no device inventory or physical action. The UI showed two speech_stt log badges, but the native trace contains one invocation; do not interpret the two log records as two executions.

Screenshot evidence is stored locally at `.local/broadlink-workflow/web-voice-pass-20261106.jpg`. Final images: backend `voice-owner-review-20261106`, gateway `voice-routing-20261106`, frontend unchanged `async-voice-20261105`. This acceptance covers web audio upload and the returned agent answer. It does not cover live browser microphone capture. Earlier failed attempts remain documented above.
