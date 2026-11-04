# BroadLink / PRISM hybrid workflow acceptance — 4 November 2026

## Verified hardware path

Home Assistant `remote.bala` sends the learned `prism_tv / power_toggle` IR code once through the RM4 Pro. The user confirmed that one transmission woke the PRISM screen and a subsequent transmission put it into standby. This is a toggle, not a discrete off command. Do not replay automatically.

The managed Flolah asset is `PRISM E55 — BroadLink IR (delivery receipt only)`, operation `send_power_toggle`. It binds to HA `script.prism_ir_power_toggle`. The script sends the code once and emits a delivery event after HA's remote service returns. `sensor.prism_ir_delivery` records that event. This receipt does **not** prove that the television received IR or changed screen state.

## Published hybrid workflow

Existing definition `virtual-room-camera-brain-tv-off-mvz8tp4k` is now named **Room Camera Brain - PRISM IR TV Control**. It remains manual, with no schedule. It captures a simulated room image, uses the vision model, checks on-state and confidence >= 0.85, checks actual Asia/Singapore time in [13:00,18:00), and requires run input `actual_tv_confirmed_on: true` before sending one real IR toggle. Synthetic camera pixels cannot establish the real screen state. The previous simulated post-off confirmation nodes were removed.

Run 4084 timed out at camera approval before any real command. It is not a passed test. After the policy fix, live run **4085 completed** without approval: capture operation `f0a6d283-0cd6-4c5e-bc88-66098199054d`, dynamic image output passed to vision, `tv_state=on`, confidence `0.9`, actual SGT `19:29`, `in_window=false`, continue branch completed. No real IR command was issued by this run.

## Policy integration correction

The physical control plane previously rechecked only the company's R2 default and ignored configured tool/workflow exceptions. The workflow runner now supplies its trusted definition ID; the physical runtime uses the existing Actions Policy evaluator. Tool routes reuse the middleware decision rather than consuming a bounded exception twice. Device-specific action modes and resource grants still apply. Physical invoke/cancel default to R2 even if tool metadata has not been seeded.

Validation passed: isolated real workflow runner, scoped workflow autonomy, one-use consumption, unrelated approval requirement, higher-priority agent approval, device prohibition, API authorization, tenant isolation and resource isolation. Deployed backend image: `agent-os-backend:physical-policy-20261104`, layered on the existing running image with patch checks and a concurrent-deployment guard. Only backend was recreated; deployment rollback metadata is retained on the VPS.

## Remaining acceptance

**COO live test passed:** direct chat discovered the asset, invoked `send_power_toggle` once, and read operation `83d4311b-773d-43e8-bdd1-8780d768da14`. It completed autonomously at 19:34:28 SGT with `ir_delivery=sent`. The user independently confirmed **TV entered standby**. COO correctly distinguished delivery from actual screen verification. No second command was sent. An earlier long request created goal `agr-5a7d08f617074dc0`; the planner rejected its unsupported deliverable kind before any action. That goal was cancelled before the successful direct request. This remains a planner-routing gap, not a device transport failure.

- The user approved removing COO's redundant R2 approval override. Deleted only `agent: balserve / communicate_external / approval_required` under Policies → Action control → Scoped overrides & recurring grants. Company R2 remains approval-required; COO financial prohibition and other rules remain intact.
- Actual screen state was confirmed before and after the single COO toggle. The automatic receipt remains delivery-only; independent real-camera or power telemetry is still required for unattended physical-state evidence.
- The live run is outside the configured afternoon window; a successful skip verifies the negative branch, not the real timed-off branch.
- Managed revision activation resets permissions for all included mappings, including unchanged mappings. Fire TV's previous enabled / launch_app approval-required setting was restored in the UI; existing resource grants were preserved. Improve revision granularity separately.

Public docs remain capability/how-to documentation. This acceptance record is internal engineering knowledge.
