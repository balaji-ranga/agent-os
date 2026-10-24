# Digital Adoption: website copilots and owner management

Digital Adoption adds a copilot to a registered external website. It is separate from the signed-in Flolah Platform Help copilot. Website knowledge, discovered screens and reusable teaching belong to the selected website registration and content audience. An owner's email grants management access; it does not combine the indexes of all websites. Two registrations on the same domain remain separate.

## Sign-in and website workspace

### Current-page inspection and reviewed answers

The visitor copilot receives a fresh supported-control snapshot and bounded loaded-page text, headings and repeated-item group counts when answering a page question. Its ranked highlight targets are only a relevant sample; their count is not the page's item count. It distinguishes loaded results on the current page from a displayed total across pagination. It cannot inspect unloaded pages, closed shadow roots, private-marked regions or private input values through this context. When text or heading coverage is truncated, the answer must explain that limit. Repeated-item counts describe the loaded DOM only.

Replying to an answer supplies that answer as conversational context, together with a fresh observation. Text-only inspection or counting can return an explanation without changing the page. Visual guidance highlights a fresh observed reference; it is separate from filling, clicking, navigation or Save.

Follow-ups such as “Show me where” refer to the preceding answer or the message being replied to. The copilot can point to observed text or a loaded collection as well as a form control. Changed or removed targets require fresh inspection. Recent conversation is preserved ahead of duplicated page excerpts when the request reaches its size limit. Asking to perform an operation without its necessary value should produce a focused clarification; it must not invent a query, reset an unrelated filter, or treat unobserved choices as an empty dropdown.

When platform-wide maker/checker is enabled, a repairable checker verdict is sent back to the maker and the revised answer is checked again. This does not grant action permission. Schema repair and checker-requested correction have separate bounded attempts. An invalid assistant response after repair is a response-contract failure; it does not mean that page inspection was forbidden. Repeated disagreement returns clarification without executing changes. The platform logs distinguish invalid response shape from checker/provider unavailability.

Ordinary page proposals allow one feedback correction and recheck; goal-plan creation allows two. Schema repair is limited to one initial correction and at most one additional correction after checker feedback. A safe diagnosed mismatch can be repaired even if the checker labels it reject; it still needs a fresh accepting verdict. Unsafe requests stay blocked. A valid reviewed clarification keeps the visitor-facing question rather than exposing internal review commentary. The Admin review token limit bounds response length, not these feedback-cycle limits. Simple explicit assignments can use an existing deterministic draft and only a checker call; model-generated proposals normally use maker plus checker.

Website owners use **Free Tools → Digital Adoption → Website owner sign-in** (`/free-tools/digital-adoption/owner.html`). This uses an email sign-in code and a separate session from the Flolah account. Existing Flolah accounts can use `manage.html`; platform administrators also have **Admin → Digital Adoption websites** (`/admin/digital-adoption`) to search registrations across owners and open a selected registration.

Select the registration in the persistent header. **Find another website** searches domain, label or registration ID and pages through results. The selected registration and active tab survive refresh through the page URL. Seven tabs organize the console:

- **Installation:** ownership/approval status, installation snippet, registration and verified email instructions. Choose the installation lifetime (7, 30, 90 or 365 days) before issuing; the result shows its exact origin and expiry. Existing installation permissions are unchanged.
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

**Tasks** holds private document uploads; **Connections** holds pairing and workflow connection setup. Transaction files may be parsed/OCRed for the current form or task; they do not become shared help documents. They remain task-private. End task immediately revokes access and clears browser context; original uploads are queued for deletion, while extracted passages remain in separate private search storage until its configured private-content retention cleanup (24 hours by default). **End task** clears that task's active context and stops remaining task work; it does not delete records already saved in the host application or automatically revoke the saved target group.

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

The Context strip identifies the current page/form and private-file count. Reviewed fields show current and proposed values side by side. Current values are read locally for the review and excluded from model requests, shared maps, analytics and stored proposals. Edited values require a fresh validated review; rejection changes nothing. Some sites autosave inputs, so applying fields is distinct from clicking Save or verifying a saved record. Errors remain above the composer and in task history across workspace navigation; a successful goal recovery dismisses the current error banner while retaining the earlier failure in task history; unrelated successes do not erase that history. New conversation uses an inline review explaining private-task cleanup and preserves saved pairing and earlier host effects.

Chat offers **Show me where**, **Ask a question** and **Prepare changes**. Ask a question selects website Knowledge; Prepare changes selects Assist and focuses the composer. Show me where selects Guide and, when a previous question or page task exists, points to its supported field. In Current page & task, a direct question such as “Where is the search field?” points to the uniquely matching live input without another approval click. Ambiguous targets ask which field; off-screen targets scroll into view. Pointing is read-only and does not fill, navigate or save. Intentional Stop or mode-switch cancellation is shown as stopped; real connection interruptions remain errors. Settings retain Guide/Assist, appearance and website-theme restore, and add bounded panel width/height preferences. The composer remains reachable while content scrolls at short/mobile viewport sizes. Expansion affects only the floating panel. An owner can opt into docking by providing a connected host container to the SDK: `mount({...installation, layout: 'docked', dockTarget: document.getElementById('copilot-slot')})`. The host reserves that container's space; the SDK does not rewrite an arbitrary website's layout. Default embeds remain floating and adapt to the viewport.

Screen capture remains explicitly initiated, supports pause/resume, review and discard, and never requests the microphone. Authorized coaches can download the reviewed recording locally. Shared knowledge ingestion still requires authenticated owner or Flolah management; the visitor chat cannot upload shared documents. Capture/teaching access is removed when the coaching grant expires. Original private files, 24-hour temporary passage cleanup and pairing/group expiry retain their separate existing rules.


### Live page observation and the next step

In **Current page & task**, the assistant receives the requested goal and conversation context alongside a fresh observation: form labels, types, required fields, available native choices and structural validation constraints; task-relevant rendered DOM text, roles, grouping and loading/disabled/selection states; current references and the preceding action outcome when available. This is bounded coverage of the loaded page, not a claim to have inspected every website page. Input values and private-marked or hidden content remain excluded from this observation.

The maker/checker chooses a supported next step using that evidence. It can point to an already rendered result or control, offer a search when the item is not loaded, prepare reviewed field changes, propose approved navigation or ask a focused clarification. “Show me where also” reuses the preceding request. A dynamic result reference grants read-only highlighting; execution still uses the separate form, navigation and owner-approved action contracts. Page text is untrusted task data and cannot grant permissions or override Action Policies.

A reviewed lookup can show different search text and selected result—for example, search “orc” and select “Orchid Trading.” The browser waits for a stable exact enabled result, refuses duplicate or missing matches, observes cancellation before selection, dispatches the selection once and verifies the host field state. Typed text alone is not reported as a successful selection. When the final result is not yet known, a query-only proposal first types the search text. After approval, fresh DOM results and the browser-reported query outcome are sent to the model, which prepares a separate selection review. The loop is bounded; unresolved selection asks for clarification and does not offer Save. The next step uses a new observation; Save remains separately governed. Dynamic page content is not automatically published into shared website knowledge.

A visitor who cannot locate an element can ask in ordinary language; location help should highlight the exact rendered element, while a fact-only question may return an explanation. Semantic descriptions carry their own current read-only target references when available. A nearby action is not a substitute for the requested text. Changed or unavailable targets require a fresh observation or a specific explanation of the limitation. Maker/checker feedback is retained through any bounded response-format repair, so correcting JSON must not undo the requested semantic correction. Format retries and semantic corrections keep their existing limits; they do not grant execution permission.


### Goal plans for multi-step tasks

Choose **Plan a task** in Chat (or **Use → Goal plan · multi-step task**) and describe the complete goal, supplied values and constraints. The assistant proposes up to 12 ordered steps. Expand the plan to review them, then choose **Start reviewed plan**. Planning itself changes no fields.

Each step uses a fresh page observation and its own normal review: approve navigation, edit/approve/reject field changes, and confirm each Save separately. A goal plan does not grant autonomous execution or change Action Policies. The maker and optional global checker plan the task and assess semantic fill/inspection work against recorded outcomes. Verified navigation and acknowledged Save steps advance deterministically at their actual evidence level; the model does not reinterpret those known outcomes. Query-only typing is followed by fresh option discovery and a separate selection review. Incomplete steps retain their remaining instruction; verified effects are included in the next decision so they are not repeated. User-edited review values supersede corresponding proposed values for that step.

Progress shows completed/current/pending steps. **Pause plan** stops further work; **Resume with a fresh review** discards an unconsumed stale review. **Check recorded step outcome** assesses an already approved step without replaying it. Unknown or rejected outcomes block progression and require host inspection. **Cancel plan** leaves earlier host effects intact. Saves are reported at the evidence level available: a host acknowledgment alone is not independent business verification.

Plans are private, website/session/conversation-scoped database records, not shared website knowledge or OpenSearch help content. Their 24-hour maximum retention is separate from session authorization. End task, file removal and a new conversation clear the current session's plans. Private-file reviews also check current task access and content revision at approval and dispatch. A backend restart or copilot-panel reload retains authorized progress; a full host reload/new visitor session does not automatically inherit the old session's plan. Browser tabs must remain online; no browser-closed execution or delivery to future visitors is scheduled.

Deployment settings `goals.retentionMs` (10 minutes–24 hours, default 24 hours), `goals.maxAttempts` (1–6 planning attempts per step, default 4) and `goals.leaseMs` (1–240 seconds, default model deadline plus 5 seconds) are server controlled. Concurrent planning and late model responses are fenced. Cached approvals are also bound to the active goal, current audience/coaching permissions, host principal and website configuration; pause, cancellation or access changes refuse further dispatch on the server. Context is bounded to 128 KiB per saved plan. Expiry cleanup uses the database expiry index. Model calls share existing global/per-website concurrency and request budgets.


If a goal needs more information, reply in the same Goal-plan chat. The original goal and the assistant's question remain in private server state. New information produces a revised plan for review; completed steps and recorded effects remain available so they are not repeated. Pending unconsumed reviews are rejected before replanning. An already approved step with an uncertain outcome must be checked before changing the plan. Up to eight clarification rounds and 8,000 characters of combined user goal/context are supported. Starting a Flolah workflow afterward uses its own private review context.

If the checker provider returns an empty or truncated response, the gateway may retry that read-only inference once within the existing deadline, using the same configured model and token budget. A second failure stops preparation; no browser action is retried or authorized by this recovery.

Goal drafts have separate bounded repair budgets: at most one schema repair and two semantic checker repairs for planning; assessment and ordinary proposals retain one semantic repair. Repairing missing JSON metadata does not consume the semantic correction budget. They share the existing request deadline and grant no action permission.

Choice interpretation uses the actual observed option labels. A clear spelling error or unique short form can become the exact available label in the field review; ambiguous or unsupported wording requires clarification. No website-specific alias list is used, and free-text business names, email addresses and amounts are preserved. A correction does not authorize Save: approve the field review, then confirm any separately requested Save. Visual guidance uses an animated pointer and highlight for visible fields, menu items and buttons. “Next” means guidance only; it never clicks. A click ripple appears only when an authorized navigation, checkbox/radio, loaded picklist selection or separately approved Save is dispatched. Text/select changes show “Applying”. The overlay never grants permission or activates arbitrary controls. It follows moving targets, respects reduced-motion preferences and clears on fresh inspection, Stop or expiry.

An explicit request to fill a draft with dummy/sample values permits synthetic content for applicable visible writable fields, using their labels, native choices, validation rules and owner descriptions. The assistant labels generated values as synthetic, preserves supplied values, and proposes them for review. This does not authorize Save or invent secret credentials, document facts or entity lookup identities. “Confirm with me before saving” permits preparing/filling the draft after review, then awaiting the separate Save confirmation. Guide-only mode explains that its highlights do not fill fields and directs the visitor to Prepare changes for reviewed filling.


Follow-up requests are interpreted using the latest conversation, any explicitly replied-to message and fresh browser observations. Browser-local recent field identities distinguish a prepared review from verified applied changes; current field values are not uploaded as continuity context. A clear new field request uses its own fresh target. A reference to past work must use controls still present on the same page/form; unavailable or ambiguous referents need clarification, with no replay of fills or Save. New conversation, End task and session termination clear this local transaction context. The context bar identifies the visible screen heading; the Context dialog shows its origin and path separately from the website name.


### Private conversation history and website temporary storage

Select **+** to archive the current conversation privately and start a fresh chat immediately. **History** is a separate header button: choose **Continue conversation** to restore earlier messages, or **Delete conversation** to revoke the archive. Opening history does not replay a field change, navigation, Save, workflow command or an old approval. The resumed assistant uses historical context with fresh current-page observations; it asks when the referent or intended next task is unclear. New chats and resumed chats end the preceding active private task; expired or ended task files are never revived. Pairing and workflow connections keep their own lifetime.

Archives are accessible only with a valid website session and the visitor's browser-held private history proof. Website, exact origin, authenticated host principal where available, audience and coaching scope are checked on every list/read/resume/delete. Anonymous visitors need no Flolah login; another browser does not inherit their private proof. Signed-in host identities cannot use another user's history. IP addresses do not authorize history. A page reload can find saved archives using that same browser proof; blocked or cleared browser storage can make them unavailable.

The database owns archive identity, content checksum, entitlement, expiry and revocation. Production message bodies and extracted transaction passages live in a website-specific temporary index, separate from the website knowledge index. Both use **search.privateRetentionHours**, currently **24**; there is no independent chat-retention setting. Access is denied at expiry. A cleanup worker deletes expired temporary documents every minute; failures emit a secret-free operational alert and are retried. Legacy shared hourly task buckets are read-only during their original retention window. One temporary index per website avoids multiplying shards by active hours.

Unverified registration creates database setup only. Successful domain verification provisions the website knowledge index and its temporary private index; activation checks both before issuing an installation. Existing verified approved websites are provisioned idempotently at startup. A provisioning failure does not issue an installation. Shared knowledge still requires authenticated owner/Flolah management and does not receive visitor chat or task content.

History lists are paged. Default limits are 20 archives per visitor scope, 1,000 per website and 10,000 overall; each archive is bounded to 200 messages and 120 KiB. An oversized or full archive preserves the current chat and explains recovery. **Download current conversation** saves a private local JSON copy; clearing the current chat remains available in Settings.


### Pointing and action intent

The assistant interprets the complete request, reply context and current observed controls. It may resolve a uniquely matching singular/plural form or obvious spelling variant; consequential ambiguity needs clarification. A request to show a link or button produces a read-only highlight, including controls whose labels contain action words. Opening a destination, preparing field changes and saving remain separate stages with their existing reviews and policies. The maker declares guide, explain, edit, navigate or clarify intent; the checker judges whether that intent and its actions fulfill the request. Intent never grants execution authority. Guide proposals can contain highlights only; Save remains a separately authorized host action.

Use the **History icon** to view private conversation titles and choose **Continue conversation**. The **+** button archives the current chat and starts a fresh one. Continuing restores advisory conversation context; it never replays historical actions or restores ended task files.

### Cross-website goal recovery and resource use

A receiving copilot acts against its own current page. The already-delivered assignment is not an instruction to send the work back to its sender. The sender receives the actual result automatically. Every field change and Save retains its normal separate review. A handoff can contain only a relevant instruction or selected value; attaching a file is optional.

Pairing expiry does not extend browser-session authorization. If an existing panel becomes unauthorized, reconnect it explicitly, then continue only unfinished work. Completed Save evidence stays in the goal and must not be replayed. Recovered goals retain earlier interruption codes and clarification counts in their final recorded summary; completion does not mean the first attempt was failure-free.

Website observations are bounded and action-triggered. WebSocket protocol pings maintain transport liveness without a redundant browser heartbeat timer; they do not extend authorization. Analytics recurring timers start only after opt-in and stop on opt-out or widget destruction. These controls limit background work but do not establish capacity or latency on every device.

### Task capacity and readiness freshness

The Tasks panel shows effective website/server limits for one active task separately from the rolling visitor-session upload allowance. The default active task accepts four files; the larger session allowance does not permit all of those files in one task. Remove an unneeded task file before adding another, or end the task and explicitly start fresh. Removing files does not reset rolling upload or byte quotas. These notices reflect server-enforced limits; they do not increase capacity.

Saved website maps remain available after 24 hours. Setup readiness requires a recently observed map and a current published-task test, so a stale saved map can still be visible while readiness asks for a new observation.

**Summarize files** opens Chat with the private supporting passages so the result is visible immediately. File upload/removal remains in Tasks. This read-only summary does not fill or submit a website form.

### Asking about the current page

**Ask a question** reads a fresh, bounded observation of the current page alongside your authorized knowledge or task files. You can ask what an input means, which section it belongs to, why a control is disabled, or how displayed information relates. The assistant uses page titles, labels, descriptions, nearby text, loaded item groups and control states. It distinguishes displayed facts from calculations and states assumptions where the page does not prove them. It cannot read unloaded pages, hidden/private regions or embedded frames.

Fresh page observations appear as cited current-page evidence. They are not uploaded to the website knowledge index, and current input values are excluded. Asking does not fill, navigate, save or invalidate an outstanding field review. Use **Prepare changes** for reviewed actions and **Plan a task** for multiple steps. Owner-only Actions and existing approvals are unchanged.
