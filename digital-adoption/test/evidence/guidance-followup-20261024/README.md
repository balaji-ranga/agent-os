# Generic UI context, continuity and guidance regression

Deployed release: `20261024-guidance-followup-k`, 24 October 2026.

Final scoped results:

- **469/469 service regressions**, on both Windows and Linux, including existing workflow/goal contracts, permissions, proposal reviews and failure handling.
- **10/10 real-model acceptance scenarios**: nine context/continuity scenarios on release J, plus the targeted lookup regression on K. Deployment verification confirms the planner, prompts and browser context modules are byte-identical between those releases; K adds precise bounded action-shape repair diagnostics. Passed cases were reused to avoid unnecessary model spend.
- **6/6 DOM and performance cases**, including an unrelated equipment register, public-page text targets, collection pointers, stale-target rejection and privacy exclusions.
- **9/9 deployed public visitor cases**, including count → “Show me where”, loaded collection → pointer, search-field guidance, explicit replies to older answers, Knowledge mode, and missing-value preparation.
- **6/6 local visitor regressions**, including reviewed synthetic filling, last-change continuity, a new navigation target, current-page knowledge, radio-choice typo/checkbox interpretation, and dynamic search followed by verified host selection.

These are final results after targeted retesting. Original reports and failed-assertion screenshots remain alongside the retest reports. One model-provider timeout was retained and successfully retested. Some test assumptions were corrected: a request to find/search can legitimately receive grounded visual guidance, while explicitly preparing an operation with missing values must ask for them. The local fixture uses **Delivery preference** with **Home delivery / Store pickup** and table-row checkboxes; it has no Shipping method/Express/gift-wrap controls. Tests now use the actual observed UI, and an explicitly supplied reserved email makes draft assertions reproducible.

## What changed

- Fresh bounded text/status elements and repeated collections now have read-only live refs. Pointing no longer has to guess a nearby button when its source text was readable but untargetable.
- Regions are named from their own headings rather than the first nested result card.
- Request budgeting preserves recent dialogue and explicit replies before trimming duplicated advisory page excerpts. The maker receives bounded conversation turns, and both maker and checker receive the same fresh observed evidence. The latest task and explicit reply are kept explicit; the widget no longer rewrites short follow-ups into guessed requests.
- A consolidated website-independent interaction contract distinguishes explaining, pointing, preparing changes and navigation. Missing values are not empty fills or invented defaults. Optional filters do not become prerequisites.
- Safe diagnosed checker mismatches receive bounded correction and recheck. Unsafe requests remain blocked. Valid no-action clarification questions are preserved. Duplicate-action repairs now identify the affected ref and shape error, without copying field values into diagnostics.

No domain/provider/card labels or business-field rules were added to production guidance. Public pages were not submitted, local records were not saved, and model settings, platform containers and parser-worker containers were unchanged.

## Performance and token economics

On the public-page DOM test, the observation took **19.1 ms** and serialized to **10,046 bytes**. Across 100 repeated observations, mean time was **3.40 ms**, maximum **7.8 ms**, retained heap growth after collection was **259,252 bytes**, and observation-triggered network requests were **zero**. These are isolated laptop measurements, not a claim about every website.

The planner retains the **30,000-byte request cap**; bytes are not tokens. Fixed instructions were consolidated, recent dialogue is bounded, and there are no new background scans or model calls. Ordinary requests normally need maker + checker, with one feedback correction permitted; simple deterministic field proposals can need only the checker. Schema repairs are separately bounded to two total, with the second available after checker feedback. Goal-plan creation permits two feedback corrections. Existing request deadlines and approved Admin model/token settings remain in force.

`token-economics.json` contains measured token usage for selected targeted retests and the incremental lookup test, including their measurement scope. It does not estimate all development/production spend or claim currency savings. Earlier failed runs are not hidden by the final pass rate.

## Evidence

- `acceptance-results.json`: final per-suite matrix, with retained first-run reports.
- `acceptance-model-results.json`: real maker/checker results, feedback revisions, targeted retests and incremental lookup trace.
- `live-browser-results.json`, `live-browser-retest-results.json`: public browser requests/results and screenshots.
- `local/results.json`, `local/retest-results.json`: local browser results and host-selection verification.
- `browser-results.json`, `snapshots.json`: actual DOM observations, privacy/staleness checks and performance.
- `windows-tests.txt`, `linux-tests.txt`: complete TAP regression output.
- `deployment-verification.json`: runtime health, deployed source hashes and unchanged settings/container checks.

This evidence covers the scoped UI-context/guidance regression. It does not renew the separate historical full-device, fresh-owner/DNS or live Flolah workflow-run certifications. Previously deferred hardware/accessibility cases remain deferred.
