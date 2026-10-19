---
title: Digital Adoption website copilots
---

# Digital Adoption website copilots

Digital Adoption embeds a copilot on a registered website. It can guide visitors through supported visible controls, use private transaction files, and receive governed [workflow connector instructions](./copilot-workflows.md). It works with website-specific knowledge and live context; it is separate from [Flolah Platform Help](../run/platform-help-copilot.md).

## Owner workspace

Open **Free Tools → Digital Adoption** and choose website owner sign-in. Owner email sign-in is separate from a Flolah account session. Existing Flolah accounts can also open account management; platform administrators have **Admin → Digital Adoption websites** for the platform-wide list.

Select the website registration in the persistent header. **Find another website** searches registrations. The seven tabs are **Installation**, **Knowledge**, **Website map**, **Teaching**, **Visitor groups**, **Analytics** and **Settings**. Each tab belongs to that selection; switching clears earlier results. Search, page sizes and Previous/Next controls keep large lists manageable. Advanced forms and editors open on demand.

Knowledge and teaching are indexed by website registration and audience. The owner email grants access; it does not pool every website's knowledge. Two registrations on the same domain remain separate. Website maps describe observed structure and optional reviewed hints, not every dynamic state or proof of a completed task.

Website map supports **Download website map JSON** and **Edit page, form & field
descriptions** inside each saved page. Explain the purpose and accepted-value
rules, review the sharing notice and save. Descriptions persist under that
website/content scope and reach relevant LLM planner guidance. Downloads combine
observed structure with reviewed hints and can be edited/re-imported using the
schema-1 manifest; optional `description` is supported on screens, forms and
fields (1,500 characters each), and `links` on screens contains label/path pairs.
Import replaces hints only. It never changes observed evidence or authorizes
execution. Discovery still needs owner coaching and approved read-only routes;
saved-map reload does not scan. Check gaps, hidden/dynamic states and unsupported
controls separately; at most 50 pages are observed per bounded discovery run.

## Visitor tasks

Ordinary visitors use chat and supported form review. Owner discovery/teaching Actions require coaching access. Task files are private transaction inputs for parsing, OCR, summaries and form preparation. They do not become the website's shared help index. End task immediately clears browser context and server access. Original uploads are queued for deletion; extracted passages await the separate private-search 24-hour index-retention cleanup. Ending a task does not delete business records already saved in the host website.

Visitors explicitly confirm peer pairing and choose its lifetime/inactivity settings. Authorized handoffs use **@mentions** in the normal composer and require sharing consent for relevant passages, values and results. Refresh can reconnect an authorized panel; it cannot restore expired or revoked authority. Owners can manage group expiry and revoke authority in Visitor groups. Saved workflow target groups are a separate server-delivery authorization: see [copilot workflow connectors](./copilot-workflows.md).

## Review and analytics

Approve or reject proposed field changes before visitor filling. Some websites autosave, so read the review before applying values. Native Save automation requires exact owner-reviewed bindings and current authorization; without them the copilot can guide or prepare supported fields but cannot treat an arbitrary button as an authorized Save. Independently verify the host result.

Analytics requires owner enablement and visitor consent. Reports cover pseudonymous browser activity, page/form use and copilot events, with bounded reports and paged tables. Typed values, document contents and chat prompts are excluded. Browser IDs and possible network/behavior matches are not proof of a person's identity and never grant access.

Administrators may enable the global **Digital Adoption copilot review** setting. An independent checker can accept, request one revision, clarify or reject a website model response; an unavailable checker stops the response. Review does not replace visitor consent, website permissions or Action Policies. This setting is for Digital Adoption website copilots, not an autonomous mode for the separate Platform Help UI.


## Reliable execution, review editing and setup readiness

The copilot observes current controls, applies an authorized step once, then
checks its result. New dependent controls need fresh observations: visitors see
a new review; an authorized workflow can continue through up to three bounded
stages with fresh policy checks. Known failures retain earlier verified changes.
An uncertain Save stops for reconciliation and is never automatically replayed.
An already-satisfied native assignment emits no redundant input/change event.

Use **Edit values** to change proposed values before applying them, or **Reject**
to leave the host untouched. Edited values create a replacement proposal; the old
approval is invalid. Native types, choices and live constraints still apply.
Stop remains available during planning and execution. Short button feedback lasts
three seconds; material errors remain in the conversation until resolved or
dismissed. Field readback, website-reported Save and trusted saved-record proof
are different outcomes. A successful request alone does not establish a Save.

**Installation → Setup readiness** checks registration, DNS, platform approval,
active installation, a recent connected panel, observed maps, teaching and a
current task-tested publication. **Snippet issued** does not mean installed.
Pending DNS challenges can be renewed without creating another registration;
update the TXT value and verify again. Owner email sign-in and the separate
platform approval gate remain required. Guidance includes origin, token, CSP
and blocked-frame checks. Empty shared-document indexes are supported.

In **Teaching**, **Check compatibility** checks observed structure only.
For **Test task**, open the website, enable owner coaching, choose **Actions →
Reusable workflows**, enter synthetic parameters and select **Test task**.
Approve each supported step. This does not authorize Save. The service records
content-free evidence only after consumed effects are observed; map, policy or
recipe changes invalidate readiness. Publishing unchanged tested steps retains
their test evidence, while structural-only publication remains visibly untested.

**Settings → Native Save controls** provides ordinary fields for exact binding
name, page path, visible label and Action Policy family. Advanced JSON remains
available. Optional saved-record verification needs a host backend integration;
its private signing key stays with the host. A learning-only receipt is not an
action verification receipt. Without this integration the panel reports honest
website status and does not claim independent business verification.


Shared knowledge uploads require a signed-in Flolah account authorized to manage the selected website, or its email-authenticated owner console. Visitors and coaching sessions cannot upload into Ask Knowledge. For a visitor's private transaction file, use **Task files & paired copilots**. The default private-upload controls include 16 MiB per file, a five-second cooldown, five attempts per minute per session, and 20 files/64 MiB per session per 24 hours, plus website, owner, network and platform limits. A lower website limit takes precedence. The panel displays the limits and any retry delay. End task or Remove file does not reset upload budgets.
