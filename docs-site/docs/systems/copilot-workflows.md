---
title: Website copilot workflow connectors
---

# Website copilot workflow connectors

Use a **Connector** node with **Digital Adoption Copilot** to send a workflow step to authorized website-copilot panels. The workflow runner must be signed into Flolah and entitled to run the workflow. The website owner must enable workflow capability.

## First working workflow test: Inspect one copilot

1. In Flolah, create or open a workflow. Add a **Connector** node, select **Digital Adoption Copilot**, then choose **Inspect**.
2. In the intended website's copilot, expand **Task files & paired copilots → Pairing & workflow access**. The website owner must have enabled workflow access for this registration.
3. Click **Link this copilot to my Flolah workflows** and copy the generated code. Its redemption window is two minutes by default; generate it when the workflow editor is ready.
4. Return to the node. Paste the code into **Copilot workflow link code**, then click **Link copilot as new group**. To add another separately authorized panel later, select the existing group and use **Add copilot to selected group**.
5. Select that **Workflow target group** and the website under **Websites**. Keep the default **All authorized active instances on selected websites** for this one-panel test.
6. Enter: **Inspect the current page's supported fields and navigation. Do not fill or save.**
7. **Save draft → Publish → Run** while the intended website panel stays online. Check the panel's chat and the workflow run audit for its response.
8. For the next run, reuse the saved group and website selection. You do not need a new code for each run. Reconnect or explicitly authorize a panel again only when its authority has expired, been revoked or cannot be restored.

The code belongs in the link-code field, not the group-ID field. A successful Inspect demonstrates delivery and a structural response; it does not prove a saved business task. Start here before moving to Prepare, Fill or an owner-bound Submit with the required Action Policy.

## Persistent group, separately authorized panels

The saved **Workflow target group** and **Websites** are the durable workflow configuration. You do not create a group for every run. Each run resolves the group's currently authorized online panels.

**Link this copilot** in a website panel creates a short-lived authorization code. In the node's **Website copilot targets**, enter that code and choose **Link copilot as new group**, or select an existing group and **Add copilot to selected group**. This authorizes the particular panel for the signed-in user's group. Knowing a group ID, owning the website or visiting the same domain does not authorize another visitor.

This is separate from peer pairing. Two copilots may pair for visitor-confirmed handoffs. A server workflow can target one directly authorized panel without pairing it with another. Visitors may use peer pairing without a Flolah account; running a Flolah workflow still requires the runner's signed-in entitlement.

## Why does the link code expire?

The displayed expiry is for a one-use authorization code, two minutes by default. Redeeming it links the intended panel; the later expiry of that code does not remove the saved workflow group.

The group has its own lifetime. The current panel defaults to four hours and offers **Until revoked on this browser**. The shared UI labels this **Pairing lifetime**, although direct workflow linking uses it too. A group's own expiry or revocation stops delivery; this is different from the short code expiry. Do not regenerate a group merely because its already-redeemed code expired.

## Configure the node

1. Select **Digital Adoption Copilot** and an action: Inspect, Summarize, Prepare, Navigate, Fill, Submit, Status or Cancel.
2. Choose a saved group and one or more websites. Refresh online copilots if needed.
3. Choose all authorized active instances on those websites, or exact active instances. This never means every visitor on the domain.
4. Enter the instruction and any authorized task/result handles. For Submit, select the exact owner-reviewed native action binding ID.
5. Set bounded delivery validity, execution timeout and fan-out, then Save draft and Publish before running.

**Prepare** proposes fields for visitor review. **Fill** and **Submit** require the effective Flolah Action Policy. An autonomous grant can permit a workflow's fill path without a visitor clicking the ordinary field-review button; approval-required and prohibited operations remain gated. A submission binding is necessary for an unknown native Save control to become eligible, but is not sufficient to authorize a workflow action. Hosts may autosave on field entry.

## Delivery and results

All captured recipients must succeed. Closed, disconnected, busy or unauthorized targets fail the step. Expiry does not queue the instruction for a future visitor. A saved group can outlive a connection, but cannot extend expired/revoked consent. Reconnect or explicitly authorize the intended panel again when necessary.

The recipient chat shows the workflow instruction and result. The run audit identifies targets and per-recipient outcomes. Inspect reports supported fields and navigation without entered field values. An acknowledgment or completed fill is not proof of saving: reopen the host record and verify it. Check an uncertain write's outcome before retrying.

Keep private document passages and extracted values in task context and pass authorized handles. Do not place full private files or their contents in a persistent workflow definition. End task clears active context and access immediately. Original uploads are queued for deletion; extracted passages await the separate 24-hour private index-retention cleanup. Ending a task does not undo host records or automatically revoke the saved group.

See [Workflows](./workflows.md), [Digital Adoption](./digital-adoption.md), and [Policies](./policies.md).


## Outcome requirements and recovery

The Copilot node's **Required outcome** selects the existing effect contract,
verified field/navigation state, website-reported Save, or a trusted saved-record
receipt. Choose the requirement that matches the action and host integration.
A missing stronger proof fails the step even if the website displayed a success
message. Browser-supplied success booleans cannot create a business-verified result.
The optional host callback is `getActionOutcome`; its backend-signed receipt uses
purpose `adoption_action_outcome` and binds the current action, proposal, session
and path. It is separate from the verified-learning receipt.

The recipient conversation waits for the coordinator's outcome acknowledgement
before announcing completion. Content-free run results include stage, target,
evidence level and applied field count; private values remain behind task handles.
Progress frames are bounded. Saved workflow groups still target current authorized
online panels; peer pairing remains optional for server delivery.

Do not rerun an uncertain write automatically. Content-free action guards and
workflow-operation tombstones reject replay after process recovery. A refreshed
connection does not restore ended files, reuse approval or replay failed commands.
For dependent forms, each new stage uses current controls and policy; the bounded
continuation stops for unsupported or ambiguous states. A native Save can leave
fields populated: navigation treats only matching, successfully submitted local
values as acknowledged; a later edit remains a draft.
