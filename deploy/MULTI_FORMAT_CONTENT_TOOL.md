# Multi format content tool

Exact agent tool name: `multi-format-content-tool`. Endpoint: `POST /api/tools/multi-format-content-tool` through the existing authenticated tool broker/invoke path. COO receives the default grant; other agents require a Workspace tool grant. Both static `TOOLS.md` templates and generated workspace guidance describe its contract. Owner identity comes from trusted authentication, not tool arguments.

## Inputs and outputs

Supply exactly one of `content_file`, `relative_path`/`media_uri`, `text`/`content_text`, `formatted_input`, or `content_base64`. Existing Content Folder item IDs (`up:...`, `gen:...`), relative paths and unique filenames avoid sending full documents. Registered generated/downloaded files and tenant inbound uploads are supported. Arbitrary server paths, path traversal, symlinks and other tenants' records are rejected. Source files are never overwritten or deleted by conversion.

Each generated file returns `content_file_id`. Copy it unchanged into `content_file: {id: ...}` for follow-up conversion; never invent an inbound path for a generated file. Bare filename strings also use the authenticated owner's unique-filename lookup; missing or ambiguous matches are rejected. Failure receipts distinguish nonexistent outputs from discarded temporary copies and explicitly preserve the original source file.

Text supports txt, Markdown and HTML. Formatted input is an array of heading, paragraph, list and table blocks. Base64 binary input needs `input_format` or `input_filename`. Formats: pdf, doc/docx, xls/xlsx, txt, md, html, csv and png/jpg/jpeg/webp/tiff/bmp. Outputs: pdf, docx, legacy doc, xlsx, txt, sanitized html, png and jpg. PDF-to-images returns one attachment per page. Image-to-PDF preserves the image. OCR accepts images and scanned PDFs; installed languages are eng, spa, fra and deu. `ocr=auto|force|off` and `operation=generate|convert|ocr` control extraction.

PDF-to-Word reconstructs editable text, not exact page-layout recovery. Source tables and spreadsheet cells are converted to values; source formulas, macros and network resources are not executed. OCR may misread characters and numbers. Preserve output warnings and review important results. Encrypted inputs, macro/embedded-object Office files, oversized archives, active PDFs, missing components and timeouts fail explicitly.

Limits: 25 MiB input and combined output, 20 PDF pages, 20 million image pixels, 2000 rows/50 columns per spreadsheet table, 12 columns per Word/PDF table, 500000 extracted characters. Conversion has a 120-second worker limit and a single worker slot; busy calls return retryable 429 instead of unbounded work.

## Security and delivery

Private ClamAV scanning is required before processing input and again before persisting every output. Scanner failures or any infected output fail closed. No unscanned output reaches Content Folder. Converted attachments use existing owner-registered private media serving and `files[].paste_exactly` MEDIA lines for Web/WhatsApp delivery. Multi-file results are published only after all scans pass; partial persistence is rolled back. Temporary conversion copies live only on the sidecar's tmpfs and are removed after each job, including timed-out worker groups. Existing source files remain unchanged even when processing is blocked.

The sidecar runs non-root with a read-only root filesystem, dropped capabilities, no-new-privileges, PID/CPU/memory limits and no tenant mounts. Its internal-only Docker network has no public egress or published port. RPC uses an administrator-provisioned token never exposed to agents. Tool logs retain input metadata/hash rather than raw input/base64. Conversion is deterministic and uses no LLM or paid API.

## Build and deploy

`tools/content-converter/requirements.txt` pins Python dependencies. `deploy/docker/content-converter.Dockerfile` supplies LibreOffice, Poppler and Tesseract. Add `docker-compose.content-converter.yml` to the existing Compose overlays, preserving antivirus/Knowledge/ingress overlays. `compose-file-defaults.sh` does this and provisions the token via `ensure-content-converter-env.sh`; general secret setup also supports the token. Full backend deployments build/start the converter. No trading configuration is involved.

Local harnesses: `npm run test:multi-format-content` (backend contract/security checks) and `python tools/content-converter/test_converter.py` (real generation/extraction, with explicit component skips if LibreOffice/Tesseract are absent). On the VPS run the engine suite with `--require-all`: no component skips permitted. Live COO verification must use an isolated conversation, benign input, scanned files, and include Content Folder file reuse plus OCR/office conversion evidence. Do not create unrelated workflow goals or external effects.

## Gateway restart safety

BYOK profile synchronization can create auth-only agent SQLite stores before OpenClaw first use. A subsequent deployment or platform-model reload previously exposed missing schema ownership metadata and blocked startup. The Gateway now runs `openclaw-agent-db-preflight.mjs` before each fresh process, offline. It initializes only version-zero databases containing exactly the two known authentication tables, using the installed OpenClaw canonical schema API. Consistent private backups and unchanged authentication-row verification are mandatory. Owned, unknown, newer, corrupt or symlinked databases are never reset or guessed; failures preserve data and block unsafe startup. OpenClaw still performs its own ownership/version validation.

The model watcher uses marker-content revisions rather than seconds-only timestamps, stops the old Gateway before its configuration sync, and does not log credential prefixes. Run `node deploy/scripts/test-openclaw-agent-db-preflight.mjs` locally; on the Gateway image run it with `--native` for full installed-schema validation, plus `python3 deploy/scripts/test-openclaw-model-reload.py` for an isolated primary/secondary/primary reload harness. These tests use dummy keys, not production model changes. Rebuild the OpenClaw image when the entrypoint or preflight changes; do not rely on a live container file copy that startup will overwrite.

Reference CLI behavior: [LibreOffice conversion parameters](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html), [Tesseract command-line OCR](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html). Server tests—not document claims—verify actual deployment behavior.

## Deployment verification — 12 October 2026

- Local and exact deployed backend image: 90 conversion contract checks; tenant-boundary 75 checks and action-policy 37 decisions passed. Chat correlation, delegation callback, work isolation and execution-governor regressions passed.
- Exact installed Gateway schema: 21 native preflight checks. Isolated watcher harness detected primary/secondary/primary switches with equal marker timestamps and verified offline configuration synchronization. This is not a real paid-provider switch test; production model selections were not changed.
- Converter under production isolation/resource limits: all 10 native Office/PDF/image/OCR tests passed with no component skips. Broker tests exercised real ClamAV input/output scanning and antivirus rejection.
- Actual COO isolated conversation: Markdown-to-PDF attachment, authenticated private download, anonymous denial, existing Content Folder PDF-to-Word using the returned item ID, and unchanged original PDF all passed. Previous user conversation selection was restored safely.
- Backend, Gateway and converter healthy, zero container restarts after final activation. All 399 per-agent model selections unchanged. Gateway startup still has a warm-up period and may require one bounded convergence retry after native configuration normalization; healthy readiness, not container start alone, is the acceptance condition.
