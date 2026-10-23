# Loaded-page inspection and maker/checker evidence — 23 October 2026

Deployed runtime: **20261023-inspection-b** (coordinator and model gateway only). Platform services, parser workers, provider configuration and global quality settings were preserved. Global review remains enabled, `platform_inactive`, 2,048 checker output tokens. The measured active maker slot was secondary; the inactive checker slot was primary.

The reported `COPILOT_REVIEW_FAILED` logs had category **invalid_response_shape**, which is a maker response-contract failure after bounded repair, not proof that the checker prohibited DOM inspection. Reproduction also exposed an explain/highlight mismatch and a model counting an unrelated section heading as an item. Prior context contained ranked rendered targets, not a full-page census.

The generic fix adds bounded loaded-page text, a heading outline and browser-computed repeated sibling-item group counts. No MCP-specific selector, provider name, website schema or form rule is in the implementation or system prompts. Ranked highlight targets remain separate from counts. Input values, hidden/private content, raw HTML and unloaded/paginated content are excluded. Structural counts describe loaded DOM groups; the model determines the relevant group from labels and context.

Maker requests and repairs receive a structured response schema. Repairs retain the original task, precisely identify forbidden keys or mismatched intent/actions, and keep one contract-repair attempt separate from the bounded checker-feedback correction. The maker still cannot execute or bypass review. Quality metadata distinguishes `contractRepairs` from `checkerRevisions`. Invalid-response UI wording no longer asks the visitor to clarify a request merely because the model returned invalid structure.

## Results

- **453/453 service regressions passed**, both Windows local and isolated Linux candidate. This includes existing goal/workflow, continuity, privacy, entitlement and review-contract tests. Zero failed, skipped or cancelled checks. Linux duration: 9,055 ms; final local duration: 10,140 ms.
- **2/2 browser observation scenarios passed** (`browser-results.json`): a synthetic independent directory with 70 items and the actual public MCP page. All 24 loaded MCP listing titles are captured, despite only nine initial ranked targets. No public website writes occurred.
- **3/3 real-model canaries passed** (`model-results.json`): initial count, reply-to DOM reinspection, and a deliberately wrong four-item draft. These use the actual configured maker/checker with database/config mounted read-only. Global settings were unchanged.
- **2/2 deployed visitor-panel interactions passed** (`live-browser-results.json`): initial count and an actual Reply-button follow-up. Both returned 24 with no actions or error banner. Revisions 1 and 2 prove fresh observations; the follow-up sent a real reply reference. Requests were 8,304 and 10,019 bytes; end-to-end latency was 6,204 and 8,606 ms. Screenshots are `live-initial-page-count.png` and `live-reply-full-dom-reinspection.png`.
- Browser observation measured **8.9 ms** and an **8,212-byte** public-page snapshot in one Chrome run. This is a page-level measurement, not a general browser-memory or multi-domain capacity certification. The added collector runs per requested observation, creates no polling/fetch loop, and uses bounded text/heading/group samples. Context budget trimming preserves action refs and explicitly marks omitted advisory text/headings.

## Direct proof of maker acting on checker feedback

The real configured checker rejected an injected draft saying four listings and requested: “State 24 loaded result listings and distinguish that from the 1,533 total.” The maker then returned: “There are 24 loaded result listings on this page, while the displayed dataset total is 1,533 approved listings across pagination.” The checker re-reviewed it and accepted with all three checks passing. `model-results.json` records the complete public-data feedback → corrected maker → accepted recheck trace, with `checkerRevisions: 1` and `receivedFeedback: true`.

Earlier failing canaries were used to diagnose the schema and counting gaps; the final results above apply to the deployed candidate. These incremental results do not certify untested real Safari/iOS, Android or screen-reader cases previously deferred by the user, or every possible third-party DOM structure. Full raw DOM and unloaded website pages are not promised as context.
