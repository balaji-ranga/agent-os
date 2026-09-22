---
sidebar_position: 4
title: Sign in and MFA
---

# Sign in and MFA

## Sign in

1. Open [https://login.flolah.cloud](https://login.flolah.cloud).
2. Enter the email and password you registered with.
3. If your organisation requires multi-factor authentication, complete the extra step (email code or authenticator app).

Use **Forgot password?** on the same page if you cannot sign in.

**Admin login** on that page is for platform operators only, not for CEOs.

For account security and operational insight, Flolah records the client IP and a locally resolved country with each successful login session. Country resolution does not send the IP to an external lookup service. Private addresses or an address without a local match may show an unknown country. These details are restricted to platform administrators and follow session/account cleanup.

## Multi-factor authentication (MFA)

Your organisation may **require** MFA or leave it optional.

### Authenticator app (TOTP)

On **first enrollment**, Flolah shows:

- A **QR code** to scan with your authenticator app
- A **security key** (secret) you can type manually if you cannot scan

Then enter the 6-digit code. Store the security key somewhere safe (password manager). You will need it if you lose the phone.

### Email one-time code

If email MFA is offered, Flolah sends a code to your address. Use **resend** if it is delayed, and check spam.

### Later changes

Open **Profile** (avatar menu → **Edit profile**) to manage MFA when policy allows.

## After you are in

New CEOs often go to **Company setup** first. Existing CEOs land on **Home** chat with the **COO** selected.

Next: [Your first 15 minutes](./first-15-minutes.md).
