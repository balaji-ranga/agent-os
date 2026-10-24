# Generic page understanding — 24 October 2026

Final deployed coordinator/gateway: **20261024-page-understanding-f**. The platform, parser workers, provider implementation and global maker/checker settings were preserved. This report covers this incremental fix, not certification of every website or the previously deferred device/accessibility matrix.

## What failed

The earlier inspection fix tested the current-page planner (`/v1/plan`). **Ask a question** (`/v1/ask`) and private-task summaries did not receive a fresh DOM snapshot. A maker and checker cannot ground a page answer in evidence neither receives. The old page-aware route also mixed a previous dataset-total answer with a later loaded-page question. A sequential browser test caught that defect after isolated prompts passed. Its diagnostic screenshot is [before-scope-failure.png](before-scope-failure.png).

Read-through of the first corrected browser run also caught an incorrect intermediate division despite the correct final page estimate. That became a separate actual-model regression; it was not counted as a final pass.

## Generic implementation

- Both question paths receive a fresh rendered-page observation, with request-local citations. Questions preserve pending field-review references and scoped reply history, including in an active private task with no attachment.
- Bounded semantic evidence relates document titles, section names, labels, descriptions, control states, navigation and repeated sibling groups. Repeated table/list rows do not require headings. Lower-page semantics survive truncation of the longer prose excerpt. No implementation rule or system prompt names an MCP page, provider, business label or website-specific selector.
- The latest task establishes the requested scope; history helps resolve references. Loaded groups, displayed dataset statistics and inferred calculations remain distinct. Inferences state their basis and limitations.
- Maker/checker share the readable evidence. Review judges fulfillment and unsupported absence claims; repairs stay within the supplied facts. A small non-evaluating arithmetic helper supplies computed results to the semantic judge, which distinguishes assertions, rounding and quotations. It neither routes tasks nor executes code or host actions.
- Current field values, editable content, hidden/private regions and embedded/unloaded content are excluded. Fresh page evidence is never indexed into shared website knowledge. Owner Actions, execution approvals and website entitlements are unchanged.

## Final results

- **461/461 service regressions passed on Windows and Linux**, with no failures, skips or cancellations. Full TAP: [Windows](windows-tests.txt), [Linux](linux-tests.txt). Linux duration: 8,930 ms; Windows: 10,763 ms. Existing goal, workflow/paired-task, isolation, upload, approval and continuity tests remain in this suite.
- **3/3 browser observation scenarios passed**: independent equipment-register table, duplicate input labels in different sections, disabled controls, late-page semantics and the actual public directory. [Browser results](browser-results.json), [snapshots](snapshots.json).
- **7/7 real-model scenarios passed**: both three-question sequences, combined public-page facts/inference, independent form interpretation, independent table interpretation, false-absence feedback correction, and arithmetic feedback correction. [Six semantic scenarios and traces](model-results.json), [arithmetic correction trace](arithmetic-model-results.json). Settings/data mounts were read-only.
- **8/8 final deployed visitor checks passed**: all three reported questions in both modes, an actual Reply-button continuation, and applying a pending field review after a knowledge question. [Final live results](live-browser-results.json). There were **zero public website submissions**. The pending-review test changed only the browser-local search input, verified it, then cleared it without clicking Search; transport and loaded results stayed unchanged.
- [Deployment verification](deployment-verification.json) confirms the final images, unchanged platform/parser containers and unchanged global checker settings.

At the observed directory state, the answer was **1,535 dataset listings**, **24 loaded items**, and **64 estimated pages** assuming a consistent 24-item page size. No unseen page count was claimed as independently verified.

## Screenshots

- [Planner: displayed dataset total](guide-total.png), [page estimate](guide-pages.png), [loaded count](guide-loaded.png).
- [Question mode: displayed dataset total](knowledge-total.png), [page estimate](knowledge-pages.png), [loaded count](knowledge-loaded.png).
- [Reply continuity](knowledge-reply-continuity.png).
- [Pending field review preserved across a question](question-preserves-pending-field-review.png).
- [Public page used for observation](public-page-observation.png).

## Proof of review and repair

The real checker rejected an injected “information is not visible” response, identified the relevant section description and disabled control, and requested revision. The maker applied that feedback; the checker accepted the corrected explanation. A second injected response used `107 / 10 = 10.2`. The checker received the application-computed `10.7`, requested correction, and accepted the maker's revised `10.7 → 11 pages` explanation. Both traces record the rejected draft, feedback, maker correction and accepted recheck.

## Resource measurements and scope

The public DOM observation took **9.1 ms** and produced a **9,310-byte snapshot** in the recorded Chrome run; the independent fixtures took 3.8–8.3 ms. Final live request bodies were at most **9,964 bytes**. Observations occur on request, without a new polling loop. Read-only page sources are capped at 12 KB and model requests retain their existing 30 KB budget with explicit truncation. Arithmetic checks are bounded to eight literal expressions and never use `eval`.

The longest recorded final live model round trip was **14,802 ms**, which includes server/provider review and is separate from DOM collection cost. These are measured cases, not universal latency, memory or multi-domain load certification. No new Safari/iOS, Android or screen-reader claim is made.
