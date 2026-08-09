# Update Company Details & company_memory

Path: **Profile (avatar) → Update Company Details** (`/update-company-details`).

Legacy URL `/update-company-setup` redirects to the path above.

## Purpose

Edit company identity without re-running full **Company setup** Apply (teams, blueprints, systems). Values are stored in Knowledge table **`company_memory`** and kept in sync with the setup **strategic_profile**.

| UI field | company_memory `item` | Notes |
|----------|------------------------|--------|
| Company name | Company | Display name of the AI company |
| Mission | Mission | Mission statement |
| Organization DNA | Organization DNA | Preset id / label |
| DNA notes | DNA notes | Free-text notes for the DNA choice |
| Industry / company type | Industry type | e.g. content_creator |
| (always written on save) | Build around CEO | Marks CEO-centric build |

Columns: **`item`** (label) and **`detail`** (value). This is structured seed data, not a live chat or event log.

## Behaviour

1. **CEO session only**; APIs are owner-scoped (`GET/PUT /api/company-setup/company-memory`). No open/public access.
2. If Knowledge table `company_memory` does not exist, it is **created** with `item` / `detail` columns.
3. Canonical rows are **upserted** by item label; empty fields can clear a stored detail.
4. Strategic profile fields used by Company setup / Operate stay aligned with the same capture.
5. Does **not** re-Apply org blueprint, hire staff, or reinstall Day 1 autonomy — use **Company setup** (`/company-setup`) or **Company operate** for those.
6. Operates Day 1 may still append a separate “Operating model v…” row when Day 1 is installed.

## How to open

1. Sign in as CEO.
2. Avatar menu (top right) → **Update Company Details**.
3. Edit fields → **Save**.
4. Confirm rows under **Knowledge** (`/master-data`) table `company_memory`.

## Related

- Full wizard: [29-company-setup.md](./29-company-setup.md)
- Knowledge tables: [05-master-data-rag.md](./05-master-data-rag.md)
- Navigation: [02-navigation-and-chrome.md](./02-navigation-and-chrome.md)
