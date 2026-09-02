---
title: Desktop for Windows
---

# Desktop for Windows

Some published workflows can **Download for Windows**: a local runner that executes laptop-side steps (read/write local files, localhost APIs, LAN FTP) while SFTP and other remote nodes still run on Flolah.

## Typical setup

1. Publish the workflow.
2. Download the package from the workflow screen.
3. Create a package **token** and add your laptop’s public IP to **IP Whitelists** when asked.
4. Run the installer/script on Windows as documented in the package.

Keep the token private. Revoke it under **Tokens management** when finished.

This is optional. Most CEOs run workflows entirely in the browser.

## IBKRNew Event Bridge

IBKRNew0 uses a dedicated Windows bridge beside IB Gateway or TWS. It is one desktop service, not a downloaded workflow, and it connects outbound to Flolah without opening a public listener. Download it from **Connectors → IBKRNew Event Bridge**. Keep its generated environment file and token private, and enter the IBKR paper account only on that computer.

See [IBKRNew event-driven paper trading](../systems/ibkrnew-event-trader.md) for the event flow, paper-only boundary and health checks.
