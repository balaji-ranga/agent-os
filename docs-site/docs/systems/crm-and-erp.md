---
title: CRM and ERP
---

# CRM and ERP

Optional **Business Core**. Not required to use Flolah.

Enable under **Profile** or **Company setup → Systems**:

- **CRM:** Twenty or ERPNext
- **ERP:** ERPNext

## What you get

Prefab **Maker A / Maker B / Checker** employees for **your company only**, plus Maker/Checker workflows (`run crm maker checker` / `run erp maker checker`). Switching the provider off removes those prefab employees.

If you enable **Twenty CRM**, those employees are added even when the CRM desk is still being created. The platform keeps **one Twenty workspace per company**. Unused desks (for example after you switch CRM away from Twenty) are released so a new company can open CRM. The desk is never shared with another company.

| Track | Process |
|-------|---------|
| **CRM** | Lead → Prospect → Qualified deal → Proposal → Won → ERP Order |
| **ERP** | Quote → order → deliver → invoice → cash (O2C) and request → PO → bill → pay (P2P), plus stock, accounting, projects |

Makers draft. **Checkers** review and perform high-risk actions (including CRM **deletes** after a review card). See [Maker and Checker](../operate/maker-checker.md).

**CRM** and **ERP** menu items appear when the matching provider is selected. The desk opens in an embed for your company only — not a shared global CRM.

## How to work

1. Enable the provider and save.
2. Confirm Makers/Checker in **AI Employees** / Chat with.
3. Ask the **COO** for pipeline or books **status**, or talk to the Maker for creates and stage changes.
4. **Platform Help** explains the process; it does not read live pipeline or ledgers.

## Licenses

Optional Business Core runs **open-source** CRM/ERP next to Flolah:

- **Twenty CRM** — [github.com/twentyhq/twenty](https://github.com/twentyhq/twenty), AGPL-3.0
- **ERPNext** — [github.com/frappe/erpnext](https://github.com/frappe/erpnext), GPL-3.0

Those licenses apply to Twenty and ERPNext, not to Flolah’s Apache-2.0 application code. See [Open source notices](https://flolah.cloud/legal/open-source.html).

Never invent customers to “fill” the pipeline. Real enquiries only (website, chat, WhatsApp, Business Discovery Act, or your ask).

If a CRM workspace hostname does not load in the browser, contact support — DNS for company subdomains is handled by the platform.
