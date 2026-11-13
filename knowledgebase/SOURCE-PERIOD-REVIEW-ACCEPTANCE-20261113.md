# Source-period review acceptance — 2026-11-13

## VPS normal agent test

Prompt: `Look at last one month gmail and summarize`

- Native run: `04470218-edbe-4f09-8e0a-ecb4ad3c54ef`.
- Effective requested range: 2026-10-13 13:43 SGT to 2026-11-13 13:43 SGT.
- Independent Gmail metadata listing: 42 unique threads, two pages, no continuation remaining.
- Managed review: 42 discovered, 42 reviewed, zero failures, eight digest calls, 104,027 source characters.
- Final native reply completed in 190,260 ms. It summarized source-derived themes rather than returning generic advice.
- Total model usage including batch digestion and final agent reply: 83,315 input + 4,793 output = 88,108 tokens across 11 calls.
- Route: configured secondary, no model override.
- Delivery disabled for this test: this proves the normal agent/tool path, not a new WhatsApp handset receipt.

Gmail scope is the date-only query, not Primary-only. Spam/Trash inclusion was not requested or verified. Thread bodies can contain older quoted messages; the date window applies to Gmail thread search matching, not a claim that every quoted line originated inside the window.

## Local efficiency work

A local-only synthetic two-source probe traversed LiteLLM to configured llama3.2. Cold start exceeded the 30-second bound. Warm inference returned only one source; the new contract rejected it. This is evidence of validation working, not a successful local compaction quality test. Do not claim local cost savings from this probe.

Final synthesis is separate from the local digest workload. A rejected local digest may use the configured cloud fallback; local-only policy fails explicitly. After a local fallback, later batches in the same review avoid repeating the failing local attempt.

The integrated VPS fallback fixture subsequently completed both sources. A fuller local-only output shape preserved both entries but lost the deadline and amount, so local digest quality acceptance remains incomplete. The source_batch_digest workload is disabled in the live efficiency policy; existing utility workloads remain unchanged. Code support is checked in for continued testing, not a claim of local compaction readiness.
