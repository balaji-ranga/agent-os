# Third-party / open-source notices

Flolah (Agent OS) application code is licensed under the **Apache License 2.0** — see repository root [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). This file attributes **other open-source and third-party software** that Flolah embeds, ships in container images, or runs as optional sidecars. Those projects remain under **their own licenses**. Hosted [flolah.cloud](https://flolah.cloud) is also governed by the site Terms of Service.

**User-facing summary:** `/legal/open-source.html` (marketing + login hosts).  
**This file:** engineering attribution, Apache NOTICE reproduction, and named first-party dependencies.

Last reviewed: **2026-08-18**. Licenses below are the upstream SPDX / project licenses as of that date. Confirm the tag or lockfile you actually run if you need a compliance snapshot.

## Scope

| Included | Not a substitute for |
|----------|----------------------|
| Runtime and infrastructure images in `deploy/docker-compose.yml` and `deploy/docker-compose.business-core.yml` | A generated SBOM of every transitive npm/pip/OS package in image layers |
| Direct npm dependencies in `backend/`, `frontend/`, `docs-site/`, `tools/web-scrape-mcp/`, `backend/local-browser-worker/`, `backend/local-ibkr-bridge/` | Vendor SaaS terms (OpenAI, Anthropic, Meta, Brave, IBKR, …) |
| Optional sidecars (Open Connector, Ollama, voice, embeddings, Business Core) | Model-weight terms (Llama, Qwen, Whisper, Piper voices, Hunyuan3D, …) |

Provider and app **names, trademarks, logos, and APIs** belong to their owners. Listing them is for identification and interoperability only — not endorsement.

## Product license

Flolah application code: **Apache-2.0** ([`LICENSE`](./LICENSE), [`NOTICE`](./NOTICE)). Components listed here keep their respective licenses. Branding and trademarks are not licensed for confusingly similar products except as Apache §6 allows.

---

## 1. Runtime and container platform

| Component | Upstream | License | Used for |
|-----------|----------|---------|----------|
| **Node.js** 22 (Debian bookworm-slim / bookworm images) | [nodejs.org](https://nodejs.org/) / [github.com/nodejs/node](https://github.com/nodejs/node) | MIT, plus bundled components (V8, npm, OpenSSL, …) under their own notices — see Node `LICENSE` | API, gateway image, MCP sidecars, docs build |
| **npm** | [github.com/npm/cli](https://github.com/npm/cli) | Artistic-2.0 | Package install |
| **Docker Engine** / **containerd** | [moby/moby](https://github.com/moby/moby) | Apache-2.0 | Container runtime |
| **Docker Compose** / Compose spec | [docker/compose](https://github.com/docker/compose) | Apache-2.0 | `deploy/docker-compose*.yml` |
| **Podman** (optional operator runtime) | [containers/podman](https://github.com/containers/podman) | Apache-2.0 | Alternate to Docker |
| **Debian** (bookworm) | [debian.org](https://www.debian.org/) | DFSG; per-package | Base OS in most app images |
| **Alpine Linux** | [alpinelinux.org](https://www.alpinelinux.org/) | MIT (musl/apk) + per-package | `nginx:1.27-alpine`, some DB images |
| **Python** 3.11 / 3.12 | [python.org](https://www.python.org/) | PSF-2.0 | Instaloader, embeddings, Piper, workflow sandbox |
| **Nginx** 1.27 | [nginx.org](https://nginx.org/) | BSD-2-Clause | Reverse proxy + SPA static |
| **SQLite** (via better-sqlite3) | [sqlite.org](https://www.sqlite.org/) | Public domain | Primary Flolah metadata store |
| **FFmpeg** (Debian package in backend / OpenClaw images) | [ffmpeg.org](https://ffmpeg.org/) | LGPL-2.1-or-later; Debian builds are often **GPL-2+** with extra codecs | Video assembly (S5), media convert |
| **Git** | [git-scm.com](https://git-scm.com/) | GPL-2.0 | OpenClaw image tooling |

Full texts: [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0), [MIT](https://opensource.org/license/mit), [BSD-2-Clause](https://opensource.org/license/bsd-2-clause), [GPL-2.0](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html), [LGPL-2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html), [PSF-2.0](https://docs.python.org/3/license.html).

---

## 2. Search — OpenSearch

Flolah uses **OpenSearch 2.18.0** for document meta and RAG (`opensearchproject/opensearch:2.18.0`) and **OpenSearch Dashboards 2.18.0** for the admin console BFF (`/opensearch/`).

| Component | Upstream | License |
|-----------|----------|---------|
| OpenSearch | [github.com/opensearch-project/OpenSearch](https://github.com/opensearch-project/OpenSearch) | Apache-2.0 |
| OpenSearch Dashboards | [github.com/opensearch-project/OpenSearch-Dashboards](https://github.com/opensearch-project/OpenSearch-Dashboards) | Apache-2.0 |

### NOTICE (OpenSearch)

Reproduced from upstream `NOTICE.txt` as required by Apache-2.0 §4(d):

```
OpenSearch (https://opensearch.org/)
Copyright OpenSearch Contributors

This product includes software developed by
Elasticsearch (http://www.elastic.co).
Copyright 2009-2018 Elasticsearch

This product includes software developed by The Apache Software
Foundation (http://www.apache.org/).

This product includes software developed by
Joda.org (http://www.joda.org/).

This product includes software developed by
Morten Haraldsen (ethlo) (https://github.com/ethlo) under the Apache License, version 2.0.
```

---

## 3. Connectors — Open Connector

Flolah Connectors (`optional-openconnector`) runs the published image `ghcr.io/oomol-lab/open-connector` (default tag `tip`). Catalog credit: **~1,300 connectors** in product UI; upstream advertises 1,000+ providers and 10,000+ actions.

| Component | Upstream | License |
|-----------|----------|---------|
| **Open Connector** (OpenConnector) | [github.com/oomol-lab/open-connector](https://github.com/oomol-lab/open-connector) · [openconnector.dev](https://openconnector.dev/#connectors) | Apache-2.0 |
| Copyright | OOMOL Lab | |

The Apache-2.0 license for Open Connector **does not** grant rights to third-party provider trademarks, logos, APIs, or copyrighted brand assets. Provider names appear only for identification and interoperability.

### NOTICE (Open Connector)

Reproduced from upstream `NOTICE.md` as required by Apache-2.0 §4(d):

```
OOMOL Connect is licensed under the Apache License, Version 2.0, except where otherwise noted.

Third-party provider and app names, trademarks, logos, icons, service marks, trade names, APIs,
documentation, and brand assets remain the property of their respective owners.

References to third-party providers are included for identification and interoperability only. Such
references do not imply endorsement, sponsorship, partnership, certification, or verification by the
third-party owner.
```

Full license: [github.com/oomol-lab/open-connector/blob/main/LICENSE.txt](https://github.com/oomol-lab/open-connector/blob/main/LICENSE.txt) (Apache License, Version 2.0).

---

## 4. AI employee gateway — OpenClaw

The `openclaw` service installs the **openclaw** npm package (`npm install -g openclaw`) and Playwright Chromium.

| Component | Upstream | License |
|-----------|----------|---------|
| **OpenClaw** | [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) · [openclaw.ai](https://openclaw.ai) | MIT |
| Copyright | OpenClaw Foundation, 2026 | |

### MIT notice (OpenClaw)

```
MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

OpenClaw’s own `THIRD_PARTY_NOTICES.md` covers code it incorporates. Playwright (Apache-2.0) and Chromium (BSD-3-Clause and other Chromium licenses) ship in the same image when browser automation is enabled.

---

## 5. Optional Business Core (copyleft)

These run only with `docker-compose.business-core.yml` profiles. **Copyleft applies to those programs**, not to Flolah Apache-2.0 code that talks to them over HTTP/SSO.

| Component | Image / upstream | License | Notes |
|-----------|------------------|---------|-------|
| **Twenty CRM** | `twentycrm/twenty` · [github.com/twentyhq/twenty](https://github.com/twentyhq/twenty) | **AGPL-3.0-or-later** (most of the repo) + MIT packages + optional Enterprise files | Additional permission for apps that only use published APIs; modifying Twenty itself stays AGPL (network clause). |
| **ERPNext** | `frappe/erpnext:v15.49.0` · [github.com/frappe/erpnext](https://github.com/frappe/erpnext) | **GPL-3.0** | Built on Frappe Framework (GPL-3.0). |
| **Frappe Framework** | [github.com/frappe/frappe](https://github.com/frappe/frappe) | GPL-3.0 | ERPNext runtime |
| **PostgreSQL** 16 | `postgres:16-alpine` | PostgreSQL License | Twenty database (and optional Flolah PG) |
| **Redis** 7 | `redis:7-alpine` | **Check the image tag.** Redis 7.2.x is BSD-3-Clause; Redis **7.4+** is RSALv2 / SSPL (not OSI BSD). | Twenty / ERPNext cache |
| **MariaDB** 10.11 | `mariadb:10.11` | GPL-2.0 | ERPNext database |

Source availability for AGPL/GPL components: use the upstream GitHub repositories and the Docker image tags you deploy. Flolah does not relicense Twenty or ERPNext.

---

## 6. Optional AI / media sidecars

| Component | Image / package | License | Used for |
|-----------|-----------------|---------|----------|
| **Ollama** | `ollama/ollama` · [github.com/ollama/ollama](https://github.com/ollama/ollama) | MIT | Local LLM runtime. **Model weights** (Llama, Mistral, DeepSeek, …) have **separate** licenses. |
| **faster-whisper-server** | `fedirz/faster-whisper-server` · [github.com/SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | Local STT. Whisper weights: OpenAI MIT. |
| **Piper TTS** | `piper-tts` (rhasspy/piper) · [github.com/rhasspy/piper](https://github.com/rhasspy/piper) | MIT | Local TTS. Voice files (e.g. `en_US-lessac-medium` from Hugging Face `rhasspy/piper-voices`) follow their upstream terms (typically MIT). |
| **Qwen3 Embedding** | `Qwen/Qwen3-Embedding-0.6B` · sentence-transformers / transformers / PyTorch | Model: Apache-2.0 (Qwen); libs: Apache-2.0 / BSD-3 | Optional local RAG embeddings |
| **Instaloader** | PyPI `instaloader` · [github.com/instaloader/instaloader](https://github.com/instaloader/instaloader) | MIT | Instagram public-profile sidecar |
| **Flask** / **Waitress** | Pallets / Zope | BSD-3-Clause / ZPL-2.1 | Sidecar HTTP |
| **Crawlee** + Cheerio | [github.com/apify/crawlee](https://github.com/apify/crawlee) | Apache-2.0 / MIT | Web scrape MCP |
| **Playwright** | [github.com/microsoft/playwright](https://github.com/microsoft/playwright) | Apache-2.0 | Browser Session worker, scrape MCP, OpenClaw Chromium |
| **Chromium** | [chromium.org](https://www.chromium.org/) | BSD-3-Clause + other Chromium licenses | Headless/headed browser |
| **linuxserver/webtop** | `ghcr.io/linuxserver/webtop:ubuntu-xfce` · [github.com/linuxserver/docker-webtop](https://github.com/linuxserver/docker-webtop) | GPL-3.0 (image sources) | Optional noVNC desktop |
| **Hunyuan3D** (optional GPU) | `tencent/hunyuan3d` · [github.com/Tencent/Hunyuan3D-2](https://github.com/Tencent/Hunyuan3D-2) | **Tencent Hunyuan 3D 2.0 Community License** (not OSI Apache). Territory excludes EU, UK, and South Korea; 1M MAU commercial cap. | Optional 3D avatars |

### Hunyuan3D required notice

Tencent Hunyuan 3D 2.0 is licensed under the Tencent Hunyuan 3D 2.0 Community License Agreement, Copyright © 2025 Tencent. All Rights Reserved. The trademark rights of “Tencent Hunyuan” are owned by Tencent or its affiliate.

---

## 7. Direct npm dependencies (application)

Licenses taken from each package’s `package-lock.json` (or declared license when no lockfile). Transitive packages are mostly MIT / ISC / BSD / Apache-2.0; generate a full list with the commands in §10.

### Backend (`backend/package.json`)

| Package | License | Role |
|---------|---------|------|
| express | MIT | HTTP API |
| better-sqlite3 | MIT | SQLite driver |
| cors | MIT | CORS |
| dotenv | BSD-2-Clause | Env files |
| pg | MIT | Optional PostgreSQL client |
| node-cron | ISC | In-process schedules |
| iso-3166 | MIT | Country/region codes |
| mammoth | BSD-2-Clause | Word (.docx) extract |
| pdf-parse | Apache-2.0 | PDF text extract |
| pdfkit | MIT | PDF generate |
| xlsx (SheetJS Community 0.20.3) | Apache-2.0 | Excel |
| ssh2-sftp-client | Apache-2.0 | Workflow SFTP |
| astronomy-engine | MIT | Astronomy helpers |
| @stoqey/ib | MIT | IBKR Gateway/TWS client wrapper (IBKR itself is proprietary) |

### Frontend (`frontend/package.json`)

| Package | License | Role |
|---------|---------|------|
| react, react-dom | MIT | UI |
| react-router-dom | MIT | Routing |
| @xyflow/react (React Flow) | MIT | Workflow editor |
| three | MIT | 3D avatars / virtual room |
| qrcode | MIT | TOTP enrollment QR |
| iso-3166 | MIT | Country/region dropdowns |
| vite, @vitejs/plugin-react | MIT | Build (devDependency) |

### Public docs (`docs-site/package.json`)

| Package | License | Role |
|---------|---------|------|
| @docusaurus/core, @docusaurus/preset-classic | MIT | [https://flolah.cloud/docs/](https://flolah.cloud/docs/) |
| react, react-dom, @mdx-js/react, clsx, prism-react-renderer | MIT | Docs UI |

### Other packages

| Package | License | Role |
|---------|---------|------|
| playwright (`local-browser-worker`, `web-scrape-mcp`) | Apache-2.0 | Desktop browser worker / scrape |
| crawlee, @crawlee/* | Apache-2.0 | Domain crawl MCP |
| cheerio | MIT | HTML parse |
| dotenv (`local-ibkr-bridge`) | BSD-2-Clause | Laptop IBKR bridge |

---

## 8. Protocol / standards (not Flolah source)

| Name | License | Role |
|------|---------|------|
| **Model Context Protocol (MCP)** | Apache-2.0 · [modelcontextprotocol.io](https://modelcontextprotocol.io/) | MCP servers and workflow MCP nodes |
| **A2A** (Agent-to-Agent HTTP) | Protocol docs as published by upstream; Flolah’s implementation is Apache-2.0 with this repository | AgentExchange |

---

## 9. Free models and non-FOSS terms

Local **Ollama** models, Hugging Face weights, “free tier” cloud APIs, and Interactive Brokers software are **not** FOSS licenses just because they are free of charge. Operators and end users must comply with those terms separately. Hunyuan3D is a **community license with geographic and MAU limits**, not Apache-2.0.

---

## 10. Generating a full dependency list (maintainers)

From each package root that has a lockfile:

```bash
# Production npm licenses (backend / frontend / docs-site)
npx --yes license-checker --production --summary
npx --yes generate-license-file --input package.json --output THIRD_PARTY_LICENSES.txt
```

Do not paste a full dump into Terms of Service. Keep a short Terms clause and this file plus `/legal/open-source.html` for detail.

Image-layer OS packages (Debian/Alpine) can be listed with `dpkg -l` / `apk info` inside each running container when a complete SBOM is required.

---

## 11. Where notices are published

| Location | Audience |
|----------|----------|
| `THIRD_PARTY_NOTICES.md` (repo root; copied into the backend image) | Operators / engineering |
| `frontend/public/legal/THIRD_PARTY_NOTICES.md` | Login host `/legal/THIRD_PARTY_NOTICES.md` |
| `deploy/static/flolah-home/legal/THIRD_PARTY_NOTICES.md` | Marketing host `/legal/THIRD_PARTY_NOTICES.md` |
| `/legal/open-source.html` | End users (short list + links) |
# MCP Registry

MCP Universe imports public metadata from the official Model Context Protocol Registry. Listing names, descriptions, repositories, packages, endpoints, and publisher marks remain the property of their respective publishers. Source: https://registry.modelcontextprotocol.io and https://github.com/modelcontextprotocol/registry.
