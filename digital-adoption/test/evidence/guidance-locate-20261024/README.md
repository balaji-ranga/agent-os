# Generic location guidance and checker-repair follow-up

Release: `20261024-guidance-locate-p`. Public/synthetic evidence only. This is a scoped follow-up, not full Phase 1/2 certification or a production reliability estimate.

The exact reported sequence was tested in Chrome on the public opt-in preview: “i am not able to locate total listings”, followed by “Show me where”. Before this update the first request produced an explanation without a highlight; the second request highlighted the paragraph. The user's older failure with a neighboring Inspect button was not reproduced in that fresh browser. Loaded asset hashes matched the then-current source and had `Cache-Control: no-store`; an old in-memory host module in the user's existing browser was not independently confirmed.

Changes are website-independent. Semantic elements now carry an exact read-only target reference associated by DOM identity and validated against label and role. Maker/checker instructions distinguish an indirect request for location help from a fact-only question. A discovered repair failure was corrected: when the maker added a highlight but retained an incompatible explanation intent, the subsequent format repair discarded that semantic correction. The most recent bounded checker feedback now survives format repair. No intent or reference is silently coerced. Missing checker check fields can use the existing single verdict-format retry; repeated invalid verdicts fail closed. Exhausted corrections no longer present internal repair instructions as the visitor answer.

Final results:

- 472/472 service regressions on Windows and Linux (`windows-tests.txt`, `linux-tests.txt`).
- 6/6 DOM/observation checks, including an independent equipment-register fixture, exact public text highlighting, changed-target rejection and collection membership checks (`browser-results.json`).
- 3/3 targeted real-model scenarios: indirect location plus follow-up on each of two layouts, and a deliberately wrong neighboring-button draft corrected by the real checker/maker and checked again (`model-results.json`).
- 2/2 exact-wording live public checks (`results.json`, `exact-0.png`, `exact-1.png`). The actual overlay rectangle matches the requested paragraph, rather than a listing button.
- 2/2 live count/context regression checks (`count-regression/live-browser-retest-results.json`): a count-only request has no actions, and its follow-up highlights the displayed statement. Public writes were blocked and none occurred. Search text and transport stayed unchanged.

Historical failures are retained in `before-results.json`, `before-exact-*.png`, `model-before-results.json` and `model-n-results.json`; those are not final passes. The tests ran with isolated Chrome profiles, not by attaching to the user's existing Chrome profile.

Observation performance: 100 observations averaged 3.68 ms, maximum 7.30 ms, maximum serialized snapshot 10,287 bytes, retained heap increase 427,280 bytes after collection, and zero observation-generated network requests. These are a single Chrome/public-page measurement, not a capacity benchmark.

Normal maker/checker call count, semantic correction limits, request size cap, Admin checker mode and token budgets are unchanged. One bounded semantic-feedback record is added only when a format repair follows a semantic correction; it avoids resending a growing repair transcript. `token-economics.json` describes only the final targeted real-model batch, not all development iterations or live-browser requests. No monetary savings are asserted.

`deployment-verification.json` records the activated release, running containers, deployed source hashes and unchanged global checker settings. Platform containers and parser workers were not restarted. New host code requires a website reload in a tab that loaded the older SDK; an iframe reload alone does not replace already evaluated parent-page modules. No automatic host-page reload was introduced.

Existing real-device/accessibility deferrals and full release-readiness gates remain outside this follow-up. Public submissions, Save operations and the Flolah workflow engine were not exercised by these new live checks; the service regression includes their existing contracts.
