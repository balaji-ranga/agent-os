# Copilot connectors in Flolah workflows

A workflow **Connector** node can target Digital Adoption website copilots. Choose **Digital Adoption Copilot** and its action. This is server-to-copilot delivery to authorized browser panels, not the separate Platform Help UI copilot and not a general server-side browser.

## First working workflow test: Inspect one copilot

1. In Flolah, create or open a workflow. Add a **Connector** node, select **Digital Adoption Copilot**, then choose **Inspect**.
2. In the intended website's copilot, open **Connections**. The website owner must have enabled workflow access for this registration.
3. Click **Link this copilot to my Flolah workflows** and copy the generated code. Its redemption window is two minutes by default; generate it when the workflow editor is ready.
4. Return to the node. Paste the code into **Copilot workflow link code**, then click **Link copilot as new group**. To add another separately authorized panel later, select the existing group and use **Add copilot to selected group**.
5. Select that **Workflow target group** and the website under **Websites**. Keep the default **All authorized active instances on selected websites** for this one-panel test.
6. Enter: **Inspect the current page's supported fields and navigation. Do not fill or save.**
7. **Save draft → Publish → Run** while the intended website panel stays online. Check the panel's chat and the workflow run audit for its response.
8. For the next run, reuse the saved group and website selection. You do not need a new code for each run. Reconnect or explicitly authorize a panel again only when its authority has expired, been revoked or cannot be restored.

The code belongs in the link-code field, not the group-ID field. A successful Inspect demonstrates delivery and a structural response; it does not prove a saved business task. Start here before moving to Prepare, Fill or an owner-bound Submit with the required Action Policy.

## Link once, reuse the saved target group

1. The website owner enables workflow capability for the registration. Each workflow runner signs into Flolah and uses their own entitled workflows and authorized panels. Website ownership alone does not identify or authorize a visitor.
2. In the intended browser copilot, open **Connections** and use **Link this copilot** to create a short-lived workflow link code. Share that code only with the intended signed-in workflow runner.
3. In the node's **Website copilot targets**, enter the **Copilot workflow link code**. Select **Link copilot as new group**, or choose an existing group and **Add copilot to selected group**. Each extra panel must be authorized separately. Peer pairing is optional for this direct workflow link.
4. Choose the saved **Workflow target group** and **Websites**. **All authorized active instances on selected websites** means authorized panels inside that user's selected group, not every visitor on the domain. **Select exact active instances** is available when a particular live panel is required.
5. Set the instruction, any task/result handles, delivery validity, fan-out bound and execution timeout. Save draft and Publish before running.

The definition retains the group and website IDs across runs. Do not paste a new group ID for every run. The server resolves current authorized online connections at each run. Connection recovery does not extend the saved grant; expired/revoked groups, ownership/capability changes and missing targets require explicit relinking or management. A persistent group is a consent boundary, not an always-running browser or durable work queue.

Peer pairing allows visitor-confirmed copilot-to-copilot handoffs. Workflow linking allows a signed-in Flolah user's workflow to address explicitly linked panels. A direct workflow target does not require a pair of copilots. Visitors without a Flolah login may pair website copilots; the person running a Flolah workflow still needs their own signed-in entitlement and valid link.

## Two different expiry clocks

The expiry printed beside **Link this copilot** belongs to its one-use authorization code (two minutes by default). Redeem it during that window. Once redeemed, that code expiring does not remove the workflow's saved group ID or end otherwise valid group authority. Never store the code as a workflow group ID or repeat linking for every run.

The group has a separate lifetime: the current panel defaults to four hours, or the visitor can select **Until revoked on this browser**. The shared UI currently calls this setting **Pairing lifetime**, and workflow linking uses it too. A finite group expiry or revocation does stop delivery and may require explicit relinking; do not confuse that with the short code expiry. Saved authorization cannot manufacture an online browser or survive loss of its browser proof automatically.

## Actions and authorization

- **Inspect:** return current supported form/field and approved-navigation metadata; field values are excluded from inspection output.
- **Summarize:** summarize authorized private task passages.
- **Prepare:** prepare current fields for visitor review; it does not itself fill or save.
- **Navigate:** follow a freshly observed safe link.
- **Fill:** enter supported requested values, subject to Flolah Action Policies. Hosts may autosave fields, so this is not automatically a read-only action.
- **Submit:** activate only an exact owner-reviewed native action binding on the correct page, with current policy authorization. An owner binding does not by itself authorize a workflow run.
- **Status / Cancel:** read command status or cancel active private task work. Cancellation does not undo a host write.

Visitor **Approve field changes** and workflow Action Policy authorization are different execution paths. An entitled workflow may fill autonomously only when the effective policy permits the action. If approval is required, it must be granted for the exact operation; Prohibited remains blocked. Native submission also checks the current owner binding and effect family. Do not advise changing a company policy just to make a test pass.

The node requires every captured recipient to succeed. Closed, disconnected, busy, expired or unauthorized targets fail the step; login or unavailable controls are reported, rather than queued for a future arbitrary visitor. Delivery validity is bounded to 1–60 seconds, execution to 1–120 seconds, and fan-out to 1–25 recipients. Expiry does not mean keep sending the instruction to new visitors until the time runs out. An unknown result must be checked against host state before retrying a write.

## Task context, audit and troubleshooting

Use **Task handle / ID** and **Result handles from earlier task steps** for authorized private context. Keep document passages and extracted values in task context; do not paste confidential source files or their full contents into a persistent workflow definition. Relevant shared passages/values/results require task sharing consent; unrelated chats and website knowledge stay isolated. Ending the private task removes its files/context, so an old handle is not a durable archive.

The recipient chat records the workflow instruction, progress and result; sender handoffs also leave a chat trace. The workflow run audit identifies the selected website/panel, action and per-recipient outcome. Inspect includes the observed path and supported field/navigation summary. Content-free audit/task handles are not independent proof of saving a business record. For a Customer → Note → Opportunity journey, navigate/inspect each form, fill the requested values, use each form's reviewed submission binding, then independently reopen and check the saved records.

If no target appears, use **Refresh online copilots**, confirm the selected group and websites, check the website's workflow capability and current link authority, and ensure the intended panel is online. Offline persistent groups can remain saved in the definition; they do not authorize background delivery. If the request is refused, check Action Policies and the per-recipient error before retrying. Never substitute another user's browser group or broaden website permissions implicitly.


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


### Using the copilot workspace

In the website copilot, open **Connections** to create a workflow link code. Peer pairing is optional. In Flolah, add a Copilot connector node and link the code to a new or existing persistent target group, then select the intended website(s). The code authorizes initial linking and expires; the saved target group is reused across runs. Only the workflow user's authorized online browser clients receive commands. Keep those website tabs open. Offline steps fail immediately and are not delivered to a later visitor.

The website **Workflows** tab shows the current run/step/outcome. Its instruction and response also appear in **Chat**. Action Policies still decide whether an effect requires a visitor review or is authorized for autonomous execution. For peer-to-peer handoffs, set up consent in **Connections**, then use `@recipient` in the single Chat composer; do not use workflow linking as peer-sharing consent. Private files and End task are in **Tasks**, separate from the saved workflow target group's lifetime.


### Private copilot-to-copilot tasks and goals

No file is required. Pair the two open panels under the same website owner and confirm in both. In **Connections**, **Inspect this copilot** requests the other panel's current supported forms, required fields and navigation; it returns structure without current values or browser writes. The response appears in both chats and becomes private task evidence for subsequent planning. It is not published into either website's shared knowledge.

To continue work in another tab, select private-context sharing consent, optionally select **Include current nonsecret form values**, then use `@` in the normal Chat composer to choose the current paired recipient and describe the task. The recipient interprets the incoming instruction with its own live page and shared task evidence. Read-only inspection plans can complete without a write review. Plans containing changes are shown for review; field changes, navigation and Save keep their existing confirmations. An active recipient goal is not replaced: finish/cancel it before selecting **Review received goal**. A request can be declined.

A goal can also include a **peer** step selecting one currently observed recipient. Review **Send to paired copilot**, choose whether to include current nonsecret form values, and send. The source shows **Waiting for the paired copilot** while the recipient reviews and executes its own goal. Source progress advances only after a validated inspection response or a completed recipient goal with recorded outcomes. Example: fill and save Customer in tab A, inspect Note in tab B, then use the shared Customer name/email to fill and save Note there. A receipt is browser/host-reported evidence; it is not independently verified business completion unless that integration exists.

Pairing is required for this visitor-to-visitor exchange; server workflow delivery continues to use separately linked workflow groups. Different website indexes remain isolated. Each RPC checks exact live source/recipient, bilateral pairing, owner, website/session and private task access. Values come only from supported visible nonsecret controls when explicitly selected. Pair revocation, changed permissions, task end, cancellation or disconnect invalidates pending work and associated pending goal approvals. Unfinished work fails without automatic replay or delivery to a replacement visitor. Private peer context is bounded and expires with its task; no attachment or shared document upload is implied.

### Conversation recovery and planning scope

Choose **Plan a task** / **Goal plan** before sending a coordinated multi-website request. **Current page & task** prepares one current-page proposal; its review identifies this boundary and offers Plan complete task to preserve the full request in Goal plan. Selecting Plan a task can reuse the last request for review; it does not start or approve it automatically. Review completed work and remove already completed effects before starting a new plan.

A dropped live connection invalidates pending private context and actions but retains the visible historical conversation. Reconnection never replays a fill or Save. An ordinary conversation is not ended merely because its idle pairing socket closes. Explicit End task, conversation reset and actual authorization expiry retain their separate privacy behavior.
