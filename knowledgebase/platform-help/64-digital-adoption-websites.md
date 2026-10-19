# Digital Adoption: website copilots and owner management

Digital Adoption adds a copilot to a registered external website. It is separate from the signed-in Flolah Platform Help copilot. Website knowledge, discovered screens and reusable teaching belong to the selected website registration and content audience. An owner's email grants management access; it does not combine the indexes of all websites. Two registrations on the same domain remain separate.

## Sign-in and website workspace

Website owners use **Free Tools → Digital Adoption → Website owner sign-in** (`/free-tools/digital-adoption/owner.html`). This uses an email sign-in code and a separate session from the Flolah account. Existing Flolah accounts can use `manage.html`; platform administrators also have **Admin → Digital Adoption websites** (`/admin/digital-adoption`) to search registrations across owners and open a selected registration.

Select the registration in the persistent header. **Find another website** searches domain, label or registration ID and pages through results. The selected registration and active tab survive refresh through the page URL. Seven tabs organize the console:

- **Installation:** ownership/approval status, installation snippet, registration and verified email instructions.
- **Knowledge:** shared sources, processing status, retries, documents/recordings and explicitly approved public help pages. Only Ready sources can answer questions. Removing an indexed source is different from ending a visitor's private task.
- **Website map:** owner-authorized observed pages, forms, fields and navigation. Expand a page and search its field/link list. Optional reviewed source hints remain distinct from live controls. A map is not a guarantee of full dynamic-state coverage or a saved task.
- **Teaching:** coaching codes, reusable drafts/published workflows, purpose metadata, validation, publication review and version history. Editors open on demand. Verified-task learning requires the host integration and participant consent.
- **Visitor groups:** saved workflow target groups, online/offline panels, pairing expiry and revocation. Owners can shorten or extend expiry; visitors can disconnect. Revocation stops remaining authority, not host changes already completed.
- **Analytics:** consent-based aggregate website/copilot activity, report windows, paged datasets and policy settings. Browser identifiers are not verified people. Possible behavior/network matches never grant workflow access or pair visitors.
- **Settings:** capabilities, reviewed native Save bindings, private host identity and audience scope. Additional approval, transfer, token and audit controls are restricted to platform administrators.

Large lists have search, page size, totals and Previous/Next controls. Website changes clear previous results and configuration immediately; late responses and stale actions cannot select another website. A request-limit message means wait and retry; signing in again does not reset that limit. Expired owner sessions require owner email sign-in, rather than another Flolah account login.

## Visitor tasks, files and pairing

Visitors use the website's own copilot panel. Owner-only Actions/discovery/teaching require coaching access; ordinary visitors do not receive the owner's management menu. Supported form context comes from fresh visible controls and the website's stored structural guidance. Explain ambiguity or missing required information before preparing changes. Unsupported widgets stay guidance-only.

**Task files & paired copilots** is for private document upload and connection setup. Transaction files may be parsed/OCRed for the current form or task; they do not become shared help documents. They remain task-private. End task immediately revokes access and clears browser context; original uploads are queued for deletion, while extracted passages remain in separate private search storage until its 24-hour index-retention cleanup. **End task** clears that task's active context and stops remaining task work; it does not delete records already saved in the host application or automatically revoke the saved target group.

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
