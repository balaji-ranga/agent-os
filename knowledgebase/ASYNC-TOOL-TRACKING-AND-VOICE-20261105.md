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
