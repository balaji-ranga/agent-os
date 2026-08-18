# Admin — User Insights

Platform admins open **User Insights** (`/admin/user-insights`) to see **adoption**: how many people registered, who is active, and who went idle.

This is **admin-only**. It is not a CEO company screen (Efficiency / User View is per-company Kanban performance — help **18**).

## Open it

Left nav **User Insights**, or Admin toolbar → **User Insights**.

## What the numbers mean

Windows are **UTC**: today (calendar day), this week (Monday 00:00 through now), this month.

| KPI | Meaning |
|-----|---------|
| **Registered today / this week / this month** | New login accounts (company **CEO** + invited **employees**). Platform admins are not counted. |
| **Inactive (7+ days)** | Enabled accounts with no login for more than 7 days. If they never logged in, `created_at` is used. |
| **Active (7 days)** | Logged in within the last 7 days. |
| **Became inactive this week** | Last login was 7–14 days ago (crossed the idle line this week). |

**Highlights:** enabled companies, new companies today/week, employees invited, never logged in (older than 1 day), CEO activation % (logged in at least once), Company setup done, CRM/ERP enabled, Connectors linked, companies with AI employee grants, industry mix.

Tables list **newest accounts** and **inactive accounts** (name, email, role, registered, last used). No passwords or API keys.

Automated leftover names starting with **SR Import** or **Connector Test** are excluded so e2e users do not inflate adoption.

## API

`GET /api/admin/user-insights` — admin session only.

## Related

- [02-navigation-and-chrome.md](./02-navigation-and-chrome.md) — admin nav
- [45-company-people.md](./45-company-people.md) — employees under a CEO (not Admin Users)
