# Platform Help UI Copilot

Open the floating **Platform Help** button, or the Immersive top-bar Platform Help button. COO remains available through the existing agent chat and organization pages.

Choose **Guided**, **Autofill**, or **Hybrid**. Describe what you want to configure without entering passwords or tokens. Review the proposed actions. **Open / apply fields** opens the registered form, then presents a before/after review. **Confirm field changes** fills it; it does not save production configuration. Review the real form and use its normal **Save** button. Existing server validation and permissions remain authoritative.

## Registered forms

- Knowledge source creation: name, source kind/collections, Gmail query, Outlook folder, interval, content-selection rules, relationship options, sync and visibility toggles.
- AI employee preparation: name, role and an existing department. Template choice, reporting, budgets, tool/skill grants and other advanced choices are reviewed in the normal form/workspace. Copilot does not silently grant permissions.
- Knowledge table: name, purpose and columns; document upload: title and tags only, with manual file selection.
- Profile: display name, role title and timezone only; credentials and permissions stay manual.
- Broadcast: message text only. Select recipients and send manually.
- New scheduled goal: title, prompt, cadence, time and weekday. Select its agent, delivery and activation manually.
- Objective brief: outcome and period label only. Budget, authority and generated-plan approval remain manual.

Existing-source editing and advanced employee drafts are not automatically migrated into a new-object draft. Finish or cancel these edits before taking a Copilot detour. Other screens use source-defined field metadata and current DOM inspection: eligible visible fields can be reviewed and filled, while protected or unsupported controls remain guidance-only. Workflow graph creation/editing remains with Workflow Builder.

## Connector detours and recovery

Save the supported draft before visiting Connectors. Complete OAuth/login/MFA and secret entry yourself through the existing connection flow. **Check connection** observes the current company's configured connector status, with a bounded watcher; it does not inspect an external browser tab. The session retains the watcher across reloads, and concurrent tabs share the polling claim. A connected status is not proof that every provider permission or operation will succeed; use the connector's own test for that.

**Return to origin**, review the saved draft, and apply it. Sessions are company-and-human scoped, expire after seven days, and can be paused/resumed/cancelled. Cancellation clears assistance drafts, not saved configuration. Concurrent changes produce a reload/review error rather than overwriting another tab's state. If a form changed after a proposal, request a fresh proposal.

## Agent chat and calls

Copilot may open an entitled agent's chat and prepare a message without sending it. **Start call** opens the existing voice flow only after that explicit click; microphone consent and existing voice authorization still apply. The ordinary product-help chat remains available for help-document RAG questions.

## Security and evidence

UI guidance is not an extra OpenClaw tool grant. No arbitrary scripts, URLs or model-generated HTML execute. Every proposed route/form/agent is checked against the authenticated actor's access. Secrets belong in the existing vault/authorization screen. A proposal, filled field or opened popup is not a successful save; use the actual form's saved result as evidence.
# Guided field assistance

Platform Help has an icon launcher. Guided mode combines instructions, questions in chat, highlighting and reviewed field filling. Autofill prepares a batch for review. Both use registered or source-defined field contracts. DOM fills require approval and preserve newer user edits. Embedded CRM/ERP uses a scoped bridge; values can save immediately, and the review warns before applying. Credentials, permission grants and final submissions remain manual. A filled field is not proof of a saved record.

After an approved fill, Copilot retains a browser-reported field-entry receipt in the current assistance session. This helps follow-up questions distinguish values already entered from missing inputs. Receipts are checked against the server's reviewed proposal and current screen permissions; they are not proof of saving or a replacement for checking the actual application. Navigating away can discard unsaved fields. Registered saved drafts can be restored separately; generic field-entry receipts do not restore a form. Cancelling assistance clears the receipts along with its drafts.
