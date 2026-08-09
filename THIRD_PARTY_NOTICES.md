# Third-party / open-source notices

Flolah (Agent OS) embeds open-source and third-party software. Those projects remain under their own licenses. This file is a **starting point** for attribution; a full automated SBOM/license scan of `frontend` and `backend` `package-lock.json` / image layers may be generated offline for compliance.

## Product license

See repository root [`LICENSE`](./LICENSE) for Flolah proprietary terms governing the product code (separate from dependency licenses).

## Public summary

A user-facing summary is published at `/legal/open-source.html` (marketing + app hosts).

## Representative dependencies (non-exhaustive)

| Component / ecosystem | Typical license family | Used for |
|-----------------------|------------------------|----------|
| React, React DOM | MIT | Web UI |
| Vite | MIT | Frontend build |
| Express | MIT | HTTP API |
| better-sqlite3 / sqlite | various / public domain | Data store |
| Node.js | Node / MIT components | Runtime |
| Nginx | 2-clause BSD | Reverse proxy (deploy) |
| OpenSearch / Dashboards | Apache-2.0 | Admin search console |
| Playwright / Chromium | Apache-2.0 / BSD | Browser automation (where enabled) |
| OpenClaw runtime/plugins | see upstream project | AI employee gateway (where deployed) |
| Twenty CRM | AGPL/other upstream | Optional Business Core CRM |
| Various npm packages | MIT, Apache-2.0, BSD, ISC, … | Build and runtime dependencies |

## Generating a full list (maintainers)

From each package root:

```bash
# example approaches; pick one used in CI once adopted
npx license-checker --production --summary
# or
npx generate-license-file --input package.json --output THIRD_PARTY_LICENSES.txt
```

Do not paste the full dump into Terms of Service; keep a short Terms clause and this file / Open Source page for detail.

## Free models and free APIs

Services such as local Ollama models or “free tier” cloud APIs may impose usage terms that are **not** FOSS licenses. Operators and end users must comply with those terms separately.
