# Flolah Free AI Tools and MCP Discovery Plan

**Status:** Proposed

**Date:** 2026-08-23

**Objective:** Bring qualified users to `flolah.cloud` by offering useful, privacy-friendly tools that work without requiring a Flolah login or registration.

## Executive summary

Flolah should not launch an unrelated collection of generic AI toys. The public tools should reinforce two clear jobs:

1. **Add AI help to a website** with a free, embeddable FAQ/help agent.
2. **Find and configure MCP servers** through a searchable, trustworthy MCP Explorer.

Small browser-local utilities can then provide search traffic and direct users toward those two flagship products. Anonymous use should be genuinely useful, while expensive inference, persistent storage, and long-running jobs should use strict quotas, browser-local execution, or bring-your-own-key (BYOK).

## Product principles

- No login is required to discover, configure, preview, or use the public tools.
- Prefer browser-local processing so usage has near-zero marginal infrastructure cost.
- Keep uploaded content private, minimize logs, and delete temporary server-side files automatically.
- Never expose an unrestricted Flolah-funded LLM endpoint to anonymous users.
- Use open-source components only after reviewing the exact version, license, notices, model terms, and dependencies selected for production.
- Give every tool a useful result before presenting an optional account or paid upgrade.
- Keep the collection focused on website owners, AI-agent builders, developers, solo founders, and lean operators.

## Track 1: Free embeddable FAQ/help agent

### User journey

1. Enter a public website URL, upload a supported document, or paste FAQ content.
2. Select pages and edit the extracted questions and answers.
3. Configure the widget name, colors, icon, placement, greeting, and suggested questions.
4. Preview the widget on desktop and mobile.
5. Download a configuration file or copy an embed snippet.
6. Install it on a website without creating a Flolah account.

Example installation:

```html
<script
  src="https://flolah.cloud/widget.js"
  data-agent="https://example.com/flolah-faq.json"
  data-theme="auto">
</script>
```

The website owner can host `flolah-faq.json` on their own domain. This avoids requiring Flolah to persist a knowledge base for every anonymous user.

### Free static mode

This should be the default and permanently free offering:

- Keyword, fuzzy, and semantic FAQ retrieval
- Suggested questions and related links
- Citations linking to the relevant source page
- Mobile-friendly and accessible interface
- Custom colors and basic branding
- Runs in the visitor's browser
- No LLM call required
- No visitor conversation sent to Flolah
- Small "Powered by Flolah" referral link

Suggested implementation components:

- Pagefind, MiniSearch, or FlexSearch for client-side retrieval
- Optional Transformers.js embeddings for browser-local semantic search
- A small Flolah-native Web Component for framework-independent embedding

### Optional AI mode

AI-generated responses can be offered through one of these controlled approaches:

- A small browser-local model
- An OpenAI-compatible endpoint supplied by the website owner
- A rate-limited Flolah demonstration allowance
- A paid or authenticated hosted inference tier added later

Do not place a reusable provider secret directly in public browser code. BYOK should use an owner-controlled proxy, restricted ephemeral token, or compatible endpoint with appropriate origin and spending controls.

### Open-source foundations to evaluate

- **AnythingLLM Embed** — MIT-licensed embeddable public RAG widget with session and chat-limit controls: <https://github.com/Mintplex-Labs/anythingllm-embed>
- **DocsGPT** — MIT-licensed self-hosted document assistant with HTML and React widgets: <https://github.com/arc53/DocsGPT>
- **Pagefind** — static low-bandwidth website search: <https://pagefind.app/>
- **Transformers.js** — machine-learning models in the browser: <https://github.com/huggingface/transformers.js>
- **MiniSearch** — in-memory full-text search: <https://github.com/lucaong/minisearch>
- **FlexSearch** — client-side full-text search: <https://github.com/nextapps-de/flexsearch>

The recommended first release is a small Flolah-native widget using deterministic client-side retrieval. AnythingLLM or DocsGPT can support an advanced hosted RAG tier later.

### Distribution loop

The free widget should create an ethical viral loop:

> Powered by Flolah — create your free help agent

Publish installation guides and dedicated landing pages for:

- Plain HTML
- WordPress
- Shopify
- Webflow
- Ghost
- React and Next.js
- Docusaurus

Each installation can generate a qualified backlink and referral visit.

## Track 2: Flolah MCP Explorer

### Positioning

Use the promise:

> Discover public MCP servers from official and community sources.

Do not claim that Flolah lists every MCP available on the internet. No registry can guarantee complete discovery, continuing availability, safety, or correctness.

### Canonical source

Use the official Model Context Protocol Registry as the canonical catalog and synchronize it incrementally:

- Registry: <https://registry.modelcontextprotocol.io/>
- API documentation: <https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md>
- Registry source: <https://github.com/modelcontextprotocol/registry>

Supplement it with clearly labeled sources such as the Docker MCP Registry, GitHub repositories with valid metadata, and maintainer submissions. Community metadata must not silently override canonical publisher metadata.

### MCP detail page

Each MCP page should show:

- Name, publisher, description, and registry identifier
- Repository, documentation, and package links
- Local, stdio, streamable HTTP, or other supported transport
- Self-hosted versus remotely consumable status
- Authentication method and required secrets
- Environment variables without revealing secret values
- License and source availability
- Last release, repository activity, and last verification time
- Supported platforms and runtimes
- Tools, resources, and prompts exposed
- Installation and configuration snippets
- Security observations and known limitations

### Trust labels

Use precise, separately earned labels:

- **Listed** — metadata was imported from a named source.
- **Repository verified** — the repository exists and key metadata matches.
- **Endpoint reachable** — a declared remote endpoint responded at the stated time.
- **Protocol verified** — an isolated MCP handshake succeeded.
- **Security reviewed** — a documented automated or manual review was completed.

Never present "listed" as "safe." Verification results must include a timestamp and should expire.

### Anonymous features

No account should be needed to:

- Search, browse, sort, and filter MCPs
- Compare MCPs
- View verification and maintenance status
- Copy installation commands
- Generate configuration snippets
- Validate manifests and configurations
- Export a result as JSON
- Receive task-based MCP suggestions

Provide configuration tabs for Codex, Claude Desktop, VS Code/Copilot, Cursor, Windsurf, generic JSON, Docker, `npx`, `uvx`, and remote HTTP where applicable.

Accounts can remain optional for saved collections, alerts, publisher administration, reviews, and personalized recommendations.

### Security boundary

Do not allow anonymous visitors to make Flolah execute arbitrary MCP servers or use Flolah as an unrestricted MCP proxy.

Metadata ingestion, static analysis, outbound health checks, and protocol verification should run in isolated workers with:

- Strict network egress policy
- Private-address and cloud-metadata blocking
- CPU, memory, process, and time limits
- No production credentials
- Disposable filesystems
- Immutable audit results

## Track 3: Supporting free tools

### Priority tools that reinforce the strategy

| Tool | User value | Execution model | Priority |
|---|---|---|---|
| MCP configuration generator | Builds client-specific configurations and detects missing fields | Browser-only | P0 |
| MCP manifest validator | Validates schema, transport, package, and security metadata | Browser-first | P0 |
| Website FAQ generator | Converts selected public pages into editable FAQ data and widget configuration | Limited server crawl plus browser editing | P0 |
| AI-readable website checker | Audits sitemap, robots, metadata, documentation, `llms.txt`, and broken links | Limited server crawl | P1 |
| Prompt improver | Structures, shortens, and adapts prompts to common use cases | Browser-local or BYOK | P1 |
| Sensitive-data redactor | Finds emails, phone numbers, credentials, and common identifiers before AI use | Browser-only | P1 |
| OCR | Extracts text from images without retaining documents | Browser-local where possible | P1 |
| Document summarizer | Extracts document text and produces a summary | Browser-local or BYOK | P2 |
| Audio transcription | Transcribes short recordings | Browser-local; limited server queue if needed | P2 |
| OpenAPI-to-MCP proposal | Converts API operations into draft MCP tool definitions | Deterministic plus optional BYOK | P2 |

### Open-source components to evaluate

- **Tesseract OCR** — Apache-2.0 OCR engine: <https://github.com/tesseract-ocr/tesseract>
- **Tesseract.js** — browser and Node.js OCR: <https://github.com/naptha/tesseract.js>
- **whisper.cpp** — local Whisper inference: <https://github.com/ggml-org/whisper.cpp>
- **PDF.js** — browser PDF parsing and rendering: <https://github.com/mozilla/pdf.js>
- **Transformers.js** — browser-local models: <https://github.com/huggingface/transformers.js>
- **Stirling PDF** — self-hosted PDF suite; currently open-core, so production use requires careful component-level license review: <https://github.com/Stirling-Tools/Stirling-PDF>

### Low-cost traffic utilities

These are not necessarily AI tools, but can bring recurring organic traffic at low cost:

- JSON and YAML formatter/converter
- Markdown preview and converter
- Diff checker
- QR-code generator
- Image resize, compress, and format conversion
- PDF merge, split, rotate, and compress
- Regex tester
- Base64 encoder/decoder
- UUID and secure-token generator
- Timestamp converter

Only add these when they link naturally to the FAQ builder, MCP Explorer, or Flolah's AI Company OS positioning. Avoid an unstructured utility directory.

## Anonymous execution architecture

### Tier 1: Browser-only

Use for search, configuration generation, validation, redaction, text conversion, OCR where feasible, small embeddings, and lightweight document/image operations.

Benefits:

- Near-zero marginal compute cost
- Better privacy
- Fast interaction
- No upload retention
- Less anonymous abuse surface

### Tier 2: Stateless server jobs

Use only when browser execution is impractical:

- Website crawling
- MCP reachability and protocol checks
- Large PDF processing
- Short audio transcription

Every job should have strict input size, page count, duration, concurrency, CPU, memory, and wall-clock limits. Temporary data should be automatically deleted.

### Tier 3: Authenticated, paid, or BYOK

Reserve this tier for:

- Persistent hosted knowledge bases
- Saved projects and analytics
- Large or recurring crawls
- Long transcription jobs
- Expensive LLM inference
- Removal of Flolah branding
- Higher quotas and team features

Anonymous users should still receive a complete useful result before being offered this tier.

## Abuse, privacy, and operational controls

- Rate-limit by IP, subnet, endpoint, and job type.
- Add progressive challenges only when behavior appears automated or abusive.
- Limit file size, page count, crawl depth, audio duration, concurrency, and processing time.
- Validate MIME type and file signatures rather than trusting extensions.
- Scan server-processed uploads and sandbox converters.
- Protect URL fetchers against SSRF, DNS rebinding, redirect abuse, and decompression bombs.
- Block loopback, private, link-local, cluster, and cloud-metadata destinations.
- Do not store document contents, prompts, secrets, or API keys in analytics logs.
- Automatically delete temporary uploads and intermediate artifacts.
- Publish a concise privacy explanation beside every upload or crawl action.
- Apply a global infrastructure spending ceiling and automatic circuit breakers.
- Maintain dependency, license, model-card, and third-party notice inventories.

## SEO and acquisition plan

### Landing-page structure

Create indexable pages with a single primary intent:

- `/tools/faq-agent`
- `/tools/faq-generator`
- `/mcp`
- `/mcp/config-generator`
- `/mcp/manifest-validator`
- `/tools/ai-site-checker`
- `/tools/pii-redactor`
- `/tools/ocr`

Create useful integration and comparison content around the products rather than generating thin pages for every keyword.

### Conversion paths

- FAQ widget result → copy embed → "Powered by Flolah" referrals
- MCP detail page → copy configuration → discover Flolah workflows and agent tools
- Site audit → generate FAQ widget
- OpenAPI conversion → validate MCP manifest → list MCP in Explorer
- Anonymous result → optional save, monitor, host, or collaborate account

### Core metrics

- FAQ widgets generated
- Successful and active installations
- Referral traffic from embedded widgets
- MCP searches that lead to a copied configuration
- Configuration validation success rate
- Repeat anonymous visitors
- Organic landing pages indexed and ranking
- Cost per completed tool operation
- Abuse-block rate and false-positive rate
- Anonymous-to-account conversion after a completed result

## Delivery roadmap

### Phase 0: Validation and design — 1 week

- Interview 5–10 website owners and 5–10 MCP users.
- Confirm the smallest FAQ configuration format and embed API.
- Prototype Official Registry synchronization and client configuration mappings.
- Complete dependency, license, privacy, and threat-model reviews.
- Define anonymous quotas and infrastructure spending limits.

**Exit criteria:** Tested widget prototype, working registry importer, agreed public schemas, and approved security boundaries.

### Phase 1: Focused public launch — 3 to 4 weeks

- Launch static FAQ/help widget builder and preview.
- Support paste/upload input and limited public-site extraction.
- Launch MCP Explorer using the Official MCP Registry.
- Launch MCP configuration generator and manifest validator.
- Add JSON/YAML utility where it supports configuration workflows.
- Publish HTML, WordPress, Shopify, Webflow, React, and Docusaurus guides.
- Add privacy messaging, rate limiting, telemetry, and cost circuit breakers.

**Exit criteria:** Anonymous visitor can create and install a useful FAQ widget and can discover, validate, and configure an MCP without registering.

### Phase 2: Trust and traffic — 4 to 6 weeks

- Add MCP health, maintenance, and verification labels.
- Add website AI-readiness audit.
- Add browser-local OCR and sensitive-data redaction.
- Add structured FAQ exports: JSON, Markdown, and HTML.
- Add task-based MCP recommendations.
- Build public integration and comparison content.

**Exit criteria:** Verification is timestamped and reproducible; browser-local tools are measurable acquisition channels with controlled operating cost.

### Phase 3: Sustainable conversion

- Add optional saved projects and collections.
- Add MCP alerts and publisher claims.
- Add hosted FAQ knowledge bases and analytics.
- Add controlled AI response generation and BYOK.
- Offer branding removal, higher quotas, team features, and managed hosting.

**Exit criteria:** Free tools continue working without login while optional paid capabilities cover hosted compute, persistence, and operational support.

## Recommended initial backlog

### P0

- Define `flolah-faq.json` schema.
- Build accessible Web Component widget.
- Implement client-side retrieval and source citations.
- Build builder, preview, and embed-code generator.
- Import and normalize the Official MCP Registry.
- Build MCP search and detail pages.
- Generate configurations for the first supported clients.
- Build schema-based manifest/config validator.
- Add anonymous limits, privacy controls, and cost monitoring.

### P1

- Add limited crawler and sitemap selection.
- Add integration-specific installation guides.
- Add MCP verification worker and expiring trust labels.
- Add AI-readable site audit.
- Add browser-local PII redaction and OCR.
- Add referral attribution for the powered-by link.

### P2

- Add browser-local embeddings and optional local generation.
- Add BYOK through a safe owner-controlled pattern.
- Add document summaries and short transcription.
- Add MCP compare, collections, alerts, and publisher workflows.
- Test paid hosted RAG and branding removal.

## Key decisions

1. The FAQ widget and MCP Explorer are the flagship products.
2. The permanently free widget uses browser-side retrieval and does not depend on Flolah-funded inference.
3. The Official MCP Registry is canonical; other sources are supplemental and labeled.
4. Flolah reports verification evidence instead of declaring unreviewed MCPs safe.
5. Anonymous users cannot execute arbitrary MCP servers through Flolah infrastructure.
6. Browser-local processing is the default for public utilities.
7. Accounts are optional for persistence and personalization, not required to obtain the core result.

## Immediate next action

Run Phase 0 and produce three artifacts before implementation begins:

1. `flolah-faq.json` schema and embed API specification
2. MCP normalized catalog and trust-label specification
3. Anonymous-tool threat model, quota table, and cost ceiling

These artifacts keep the first release focused, cheap to operate, and safe enough to expose publicly.

