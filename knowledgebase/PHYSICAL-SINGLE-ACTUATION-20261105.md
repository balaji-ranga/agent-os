# Repeated toggle incident and single-actuation fix

On 5 November 2026, 19:31:49–19:32:35 Singapore time, physical tool logs 44532–44538 show seven distinct PRISM IR operations dispatched. The agent varied its idempotency key (`-2`, `-3`, `-confirm`, etc.) instead of polling the first operation. Tool log 44539 blocked a repeated original key. The user's observed multiple TV state changes match these dispatches. This incident was not the earlier sleeping-laptop failure.

The governor fingerprint included the model's idempotency key and timeout, allowing the same device/action/input to evade duplicate detection. The invoke endpoint returned immediately at `dispatched`, and the governor labelled an HTTP success as completed even when the operation was pending. The agent then reported the final duplicate refusal instead of the actual operation result.

## Generic fix

- Physical action fingerprints use device, action and canonical input only. Changed transport keys/timeouts cannot bypass the execution guard. Physical invocations do not get automatic transient retries or configurable repeat bypasses.
- Execution-scoped idempotency keys are generated server-side. A new trusted run is separate; the model cannot create new dispatch authority by changing a key within the same run.
- Duplicate calls retrieve the original operation under owner/agent resource checks and return its current result with `additionalActionSent:false`, rather than treating the duplicate as a fresh hardware failure.
- The first invoke waits up to 15 seconds for the existing operation; pending work directs the agent to `physical_operation_get`. It never retries actuation to obtain evidence. Approval requests return without waiting for actuation.
- Pending, uncertain, failed and completed physical operations receive distinct ledger classifications. Nonterminal acknowledgements are not recorded as completed.
- Shared physical-agent instructions explicitly require one invocation followed by result/status reads. IR delivery evidence proves signal delivery only, not the resulting screen state.

## Validation and deployment

Governor tests verify changed keys/timeouts are blocked with the original operation ID, including repeated duplicate attempts, and a new run remains separate. Response tests verify delayed completion, bounded pending results, approval handling and uncertain outcomes without invoking an action. Existing governor scope/budget tests, physical-agent context tests and physical API authorization tests passed.

Backend-only release `agent-os-backend:physical-once-20261105` was built on the current edge-health image with a concurrent-deployment guard. No TV command was sent during implementation or testing. Real WhatsApp/hardware acceptance of the corrected reply remains a subsequent user test; simulator/unit regression results are not represented as a new hardware test.
