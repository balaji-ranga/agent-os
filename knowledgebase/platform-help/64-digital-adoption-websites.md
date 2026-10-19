# Digital Adoption: website copilots and owner management

Digital Adoption adds a copilot to a registered external website. It is separate from the signed-in Flolah Platform Help copilot. Website knowledge, discovered screens and reusable teaching belong to the selected website registration and content audience. An owner's email grants management access; it does not combine the indexes of all websites. Two registrations on the same domain remain separate.

## Sign-in and website workspace

Website owners use **Free Tools → Digital Adoption → Website owner sign-in** (`/free-tools/digital-adoption/owner.html`). This uses an email sign-in code and a separate session from the Flolah account. Existing Flolah accounts can use `manage.html`; platform administrators also have **Admin → Digital Adoption websites** (`/admin/digital-adoption`) to search registrations across owners and open a selected registration.

Select the registration in the persistent header. **Find another website** searches domain, label or registration ID and pages through results. The selected registration and active tab survive refresh through the page URL. Seven tabs organize the console:

- **Installation:** ownership/approval status, installation snippet, registration and verified email instructions.
- **Knowledge:** shared sources, processing status, retries, documents/recordings and explicitly approved public help pages. Only Ready sources can answer questions. Removing an indexed source is different from ending a visitor's private task.
- **Website map:** owner-authorized observed pages, forms, fields and navigation. Expand a page and search its field/link list. Optional reviewed source hints remain distinct from live controls. A map is not a guarantee of full dynamic-state coverage or a saved task.

### Website discovery, JSON export and descriptions

In the selected website's Teaching tab, create a coaching code. Enter it under
Coaching access in the website copilot, then open Actions → Website map → Choose
pages. Review the same-origin routes, add any missing read-only routes, choose
the page budget and select Build website map. Each run is bounded to at most
50 pages and two minutes; check unobserved/blocked routes and inspect dynamic
forms separately. Reload saved map only reads saved data, without scanning.

In Website map, select Download website map JSON to export the combined observed
structure and reviewed hints. Expand a saved page and select Edit page, form &
field descriptions. Choose a page, form or field, explain its purpose, business
meaning, accepted-value rules or dependencies, review the shared-guidance notice
and select Save description. Descriptions persist for that website and selected
content scope and are supplied to the LLM when relevant. They do not grant
permission to fill, submit or save. Do not enter visitor data or secrets.

The same schema-1 JSON can be edited and re-imported under Import an optional
structure manifest. Each screen, form and field accepts an optional description
up to 1,500 characters. Screens can include links with label/path. Review the
download before re-import; it has reviewed:false. Import replaces reviewed hints,
not observed maps. Unkeyed, ambiguous and unsupported fields are omitted from the
importable export; original observations remain available. Use an individual
page download if the full map exceeds 200 pages or 480 KB.
- **Teaching:** coaching codes, reusable drafts/published workflows, purpose metadata, validation, publication review and version history. Editors open on demand. Verified-task learning requires the host integration and participant consent.
- **Visitor groups:** saved workflow target groups, online/offline panels, pairing expiry and revocation. Owners can shorten or extend expiry; visitors can disconnect. Revocation stops remaining authority, not host changes already completed.
- **Analytics:** consent-based aggregate website/copilot activity, report windows, paged datasets and policy settings. Browser identifiers are not verified people. Possible behavior/network matches never grant workflow access or pair visitors.
- **Settings:** capabilities, reviewed native Save bindings, private host identity and audience scope. Additional approval, transfer, token and audit controls are restricted to platform administrators.

Large lists have search, page size, totals and Previous/Next controls. Website changes clear previous results and configuration immediately; late responses and stale actions cannot select another website. A request-limit message means wait and retry; signing in again does not reset that limit. Expired owner sessions require owner email sign-in, rather than another Flolah account login.

## Visitor tasks, files and pairing

Visitors use the website's own copilot panel. Owner-only Actions/discovery/teaching require coaching access; ordinary visitors do not receive the owner's management menu. Supported form context comes from fresh visible controls and the website's stored structural guidance. Explain ambiguity or missing required information before preparing changes. Unsupported widgets stay guidance-only.

**Tasks** holds private document uploads; **Connections** holds pairing and workflow connection setup. Transaction files may be parsed/OCRed for the current form or task; they do not become shared help documents. They remain task-private. End task immediately revokes access and clears browser context; original uploads are queued for deletion, while extracted passages remain in separate private search storage until its 24-hour index-retention cleanup. **End task** clears that task's active context and stops remaining task work; it does not delete records already saved in the host application or automatically revoke the saved target group.

Peer pairing is visitor-confirmed. The confirmer selects lifetime/inactivity settings; saved authorization is separate from the current live connection. Reloading can reconnect an authorized panel, but does not extend consent or restore expired/revoked authority. Use a paired copilot's **@mention** in the ordinary composer for a handoff. Relevant passages, values and task results require sharing consent; unrelated histories and website indexes remain separate. Pairing alone does not authorize a Flolah workflow.

## Review, Save and model review

Visitor field filling uses the inline change review with approval/rejection. A separate native submission requires a unique live control and an exact owner-reviewed action binding. Without bindings, guidance and supported reviewed filling remain available, while unknown Save controls cannot gain autonomous authority. Some hosts autosave on field entry; field approval can therefore have effects even without clicking Save.

Administrators can enable **Digital Adoption copilot review** under Admin, Models & routing, or Digital Adoption websites. This global website-copilot setting defaults Off. When enabled, the active platform model makes a proposal and the inactive slot checks it; an optional configured local reasoning route is available. The checker can accept, request one revision, ask for clarification or reject. An unavailable checker stops the request. It cannot grant permissions, replace visitor review or override Action Policies. This setting governs Digital Adoption website model responses; it does not make the separate Platform Help UI copilot autonomous.

See **Copilot connectors in workflows** for server-to-browser commands. A website being installed, mapped or online is not proof that a business task completed. Verify the host application's saved result independently.


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


Shared knowledge uploads require a signed-in Flolah account authorized to manage the selected website, or its email-authenticated owner console. Visitors and coaching sessions cannot upload into Ask Knowledge. For a visitor's private transaction file, use **Tasks**. The default private-upload controls include 16 MiB per file, a five-second cooldown, five attempts per minute per session, and 20 files/64 MiB per session per 24 hours, plus website, owner, network and platform limits. A lower website limit takes precedence. The panel displays the limits and any retry delay. End task or Remove file does not reset upload budgets.


### Copilot workspace

The visitor panel uses **Chat**, **Tasks**, **Workflows** and **Connections**. **Actions** appears only while an authenticated server-issued owner coaching grant is current. A Flolah sign-in, owner email, URL parameter or visible button never substitutes for that grant. Platform Admin remains in the authenticated Flolah Admin UI and is not exposed as a visitor-panel preview.

Use the single chat composer for messages and `@recipient` handoffs. Its **Use** selector chooses current-page/task guidance or website knowledge; answers retain their channel/reply references in one conversation. **Tasks** holds private attachments and End task. **Connections** holds pairing lifetime/inactivity, bilateral confirmation, sharing consent and the one-use workflow link code. Send handoff instructions from Chat. **Workflows** shows the current visitor's connected Flolah run, step and outcome; instructions and responses also remain in Chat. Owner teaching previews stay separately scoped to coaching. Website workflow permission, Flolah user entitlement and Action Policies still gate delivery and effects on the server; pairing alone grants none of them.

The Context strip identifies the current page/form and private-file count. Reviewed fields show current and proposed values side by side. Current values are read locally for the review and excluded from model requests, shared maps, analytics and stored proposals. Edited values require a fresh validated review; rejection changes nothing. Some sites autosave inputs, so applying fields is distinct from clicking Save or verifying a saved record. Errors remain above the composer and in task history across workspace navigation; an unrelated successful action does not dismiss them. New conversation uses an inline review explaining private-task cleanup and preserves saved pairing and earlier host effects.

Chat offers **Show me where**, **Ask a question** and **Prepare changes**. Ask a question selects website Knowledge; Prepare changes selects Assist and focuses the composer. Show me where selects Guide and, when a previous question or page task exists, points to its supported field. In Current page & task, a direct question such as “Where is the search field?” points to the uniquely matching live input without another approval click. Ambiguous targets ask which field; off-screen targets scroll into view. Pointing is read-only and does not fill, navigate or save. Intentional Stop or mode-switch cancellation is shown as stopped; real connection interruptions remain errors. Settings retain Guide/Assist, appearance and website-theme restore, and add bounded panel width/height preferences. The composer remains reachable while content scrolls at short/mobile viewport sizes. Expansion affects only the floating panel. An owner can opt into docking by providing a connected host container to the SDK: `mount({...installation, layout: 'docked', dockTarget: document.getElementById('copilot-slot')})`. The host reserves that container's space; the SDK does not rewrite an arbitrary website's layout. Default embeds remain floating and adapt to the viewport.

Screen capture remains explicitly initiated, supports pause/resume, review and discard, and never requests the microphone. Authorized coaches can download the reviewed recording locally. Shared knowledge ingestion still requires authenticated owner or Flolah management; the visitor chat cannot upload shared documents. Capture/teaching access is removed when the coaching grant expires. Original private files, 24-hour temporary passage cleanup and pairing/group expiry retain their separate existing rules.
