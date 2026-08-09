# Update Company Setup & company_memory

Path: **Profile (avatar) → Update Company Setup** (`/update-company-setup`).

## Purpose

After (or instead of re-running) the full **Company setup** wizard, edit the **company identity** fields that seed Master Data table **`company_memory`**:

| Field | company_memory `item` |
|-------|------------------------|
| Company name | Company |
| Mission | Mission |
| Organization DNA | Organization DNA |
| DNA notes | DNA notes |
| Industry / company type | Industry type |
| (always written) | Build around CEO |

## Behaviour

1. CEO-only; owner-scoped API `GET/PUT /api/company-setup/company-memory`.
2. If Knowledge table `company_memory` does not exist, it is **created** (`item`, `detail` columns).
3. Canonical rows are **upserted** by item label; strategic setup profile is updated in parallel.
4. Does **not** re-Apply org blueprint / hire staff — use full **Company setup** for that.
5. Operates Day 1 still appends a separate "Operating model v…" row when Day 1 is installed.

## Related

- Full wizard: [29-company-setup.md](./29-company-setup.md)
- Knowledge UI: Master Data / Knowledge nav
- Tokens management: [34-tokens-management.md](./34-tokens-management.md)
