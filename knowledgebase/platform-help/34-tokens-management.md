# Tokens management (external packages)

Path: **Settings → Tokens management** (`/settings/tokens`).

## What is listed

Issued **laptop/package** credentials only (masked prefixes — full secrets are never returned):

| Kind | Issuer shown | Where minted |
|------|----------------|--------------|
| Workflow desktop (`dsk_`) | Workflow name | Workflows → Download for Windows |
| IBKR bridge | IBKR bridge | Connectors → Local IBKR bridge package |
| Browser Session worker (`bwk_`) | Browser session package | Browser Session / Connectors download |

## Columns

- **Token** — prefix only (e.g. `dsk_…`, first 8 hex chars for bridge)
- **Issued package** — package label at mint time
- **Issuer** — workflow name, or fixed labels for IBKR bridge / Browser Session
- **Last used** — last successful cloud auth (desktop/browser); may be empty for IBKR bridge (token is loopback-local)
- **Revoke** — disables cloud acceptance for desktop/browser; marks IBKR inventory revoked (restart bridge with a new package `.env`)

## Related

- Named secrets / BYOK vault: **Settings → API Keys** (`/api-keys`)
- IP firewall for the same packages: **Settings → IP Whitelists** ([33](./33-ip-whitelists.md))
- Browser Session package setup: [22-browser-session-and-recipes.md](./22-browser-session-and-recipes.md)
- Desktop package: [17-desktop-windows-download.md](./17-desktop-windows-download.md)


## Type filters

The UI filters by:

- **Workflow desktop** — Download for Windows tokens (`dsk_`)
- **IBKR bridge** — Connectors local bridge package (inventory of `LOCAL_BRIDGE_TOKEN`, recorded on each download after Tokens management shipped)
- **Browser session package** — browser worker tokens (`bwk_`)
