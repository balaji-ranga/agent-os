# IBKRNew live trading implementation plan

**Status:** Proposed; not approved for implementation

**Version:** 1.0

**Date:** 2026-09-02

**Related baseline:** [IBKR-EVENT-TRADER-FUNCTIONAL-SPEC.md](./IBKR-EVENT-TRADER-FUNCTIONAL-SPEC.md)

**Existing release:** `IBKRNew0` remains paper-only

## 1. Executive decision

Live trading must not be implemented as a direct `paper → live` configuration toggle. Build a separately certified `IBKRNewLive0` environment that reuses the generic event engine while keeping the current paper workflow, credentials, data and safety boundary intact.

```text
IBKRNew0 Paper
     │
     │ successful certification
     ▼
Live Shadow Mode — reads live data/account, submits nothing
     │
     │ CEO activation + safety checks
     ▼
Live Canary — small, approval-required stock orders
     │
     ├── certify short stocks
     ├── certify long calls
     └── certify long puts
     ▼
Live Controlled Automation
```

IBKR requires an authenticated TWS or IB Gateway session on the desktop. Default live ports differ from paper—IB Gateway commonly uses 4001 live/4002 paper and TWS 7496 live/7497 paper—but ports are configurable, so neither Flolah nor the bridge may use the port as proof of account environment. Paper and live sessions on the same computer must use distinct ports and should use distinct usernames and client IDs.

Official references:

- [IBKR API home](https://ibkrcampus.com/campus/ibkr-api-page/)
- [IBKR TWS API initial setup](https://interactivebrokers.github.io/tws-api/initial_setup.html)
- [IBKR TWS API connectivity](https://interactivebrokers.github.io/tws-api/connection.html)
- [IBKR TWS API market data](https://interactivebrokers.github.io/tws-api/market_data.html)
- [IBKR TWS API order submission](https://interactivebrokers.github.io/tws-api/order_submission.html)

Trading involves substantial risk. This plan is an engineering safety design, not financial advice or a promise of returns.

## 2. Current paper bridge: what it knows and what it does not

### 2.1 Existing defenses

The current `IBKRNew0` release has independent cloud and desktop paper gates:

1. The cloud service fixes `IBKRNEW_ENVIRONMENT` to `paper`.
2. Published policy validation rejects any non-paper environment or enabled live-execution switch.
3. The bridge table accepts only `environment = 'paper'`.
4. Issued authorizations and commands carry `environment: 'paper'`.
5. The downloadable package defaults to the paper Gateway port and keeps paper execution disabled until explicitly enabled locally.
6. Immediately before `placeOrder`, the desktop adapter requires both:
   - authorization environment equals `paper`; and
   - locally configured `IBKRNEW_ACCOUNT_ID` begins with `DU`.
7. The adapter places the order with that exact locally configured `DU…` account. The real account identifier is never sent to or stored by Flolah.

Consequences:

- If the local configuration contains a live `U…` account, the bridge rejects the command before calling IBKR.
- If the bridge connects to a live Gateway while still configured with a `DU…` account, it cannot intentionally address the live `U…` account because the order explicitly names the configured `DU…` account. IBKR should reject an account that is unavailable in that logged-in session.
- Flolah cannot switch the order to another broker account because it has only an opaque `IBKRNewAccount_*` reference, not the real identifier.

### 2.2 Identified gap

The current bridge waits for `nextValidId` and then marks the Gateway connection healthy, but it does not yet consume and validate IBKR's `managedAccounts`/account-discovery callback against the configured paper account before declaring the session execution-ready.

Therefore it does **not proactively know** that the Gateway itself is logged into a live session. A live Gateway on a configured or custom port may appear connected until account subscription or order submission fails. The port cannot safely solve this because IBKR permits custom ports.

This does not provide a supported path to live execution—the local `DU` check and explicit order account still block a live `U…` order—but it can cause confusing health reporting and relies on IBKR for the final account-mismatch rejection.

### 2.3 Mandatory prerequisite hardening

Before implementing any live capability, improve the existing paper bridge:

1. Subscribe to IBKR managed-account discovery during the connection handshake.
2. Require the configured `DU…` account to be present in the Gateway session's accessible account set.
3. Do not mark the Gateway `execution_ready` until `nextValidId`, managed accounts, account subscription, positions and open-order reconciliation all complete.
4. Emit a specific `ACCOUNT_ENVIRONMENT_MISMATCH` health error when a paper bridge reaches a live-only session.
5. Block market subscriptions, command claims and all order submissions while mismatched.
6. Re-run attestation after reconnect, Gateway restart, account change or client-ID change.
7. Add tests for:
   - paper bridge + paper Gateway;
   - paper bridge + live Gateway;
   - configured `U…` account;
   - configured `DU…` account absent from managed accounts;
   - custom live and paper ports;
   - managed-account callback missing or delayed.

The account number remains desktop-only. Events sent to Flolah contain only the opaque account reference, environment verdict and sanitized reason code.

## 3. Separate live environment

Create:

- Product/UI namespace: `IBKRNewLive0`.
- Desktop identity: `IBKRNewLiveBridge_*`.
- Opaque account reference: `IBKRNewLiveAccount_*`.
- Separate bridge token, client ID, command outbox and event stream.
- Separate live goal, policy, strategy, strategy skill, universe and market-data versions.
- Separate exposure, reservation, order, trade, commission and audit records.
- Separate global, owner and desktop kill switches.

The existing `IBKRNew0` paper workflow remains unchanged and available for continuous comparison and regression testing.

The event inbox, strategy proposal engine, deterministic risk evaluator, retention framework and desktop packaging should remain generic. Live authorization and account attestation are separate modules because their safety and approval requirements differ materially.

## 4. Live account attestation

The desktop bridge must establish that it is connected to the intended live account before live activation:

1. Connect to the locally authenticated Gateway/TWS.
2. Complete API version negotiation.
3. Wait for `nextValidId`.
4. Obtain the accounts accessible in the current broker session.
5. Confirm the locally configured live account is present and is not a paper `DU…` account.
6. Complete account, position, execution and open-order reconciliation.
7. Bind the verified account locally to one opaque Flolah account reference.
8. Send only an environment attestation, capability verdict and opaque reference to Flolah.
9. Never transmit or persist the real IBKR account number on the VPS.

The connection is not ready merely because the socket opened. IBKR provides account information and the next valid order identifier during the handshake, and requests made before connection completion may be dropped.

Use a dedicated live username, port and client ID. If paper and live run concurrently, use separate Gateway/TWS instances and separate bridge processes.

## 5. Live activation state machine

Implement an owner-scoped, auditable state machine:

```text
DISABLED
  → SHADOW_REQUESTED
  → SHADOW_ACTIVE
  → PAPER_CERTIFIED
  → LIVE_ELIGIBLE
  → CEO_APPROVAL_PENDING
  → COOLING_OFF
  → ARMED
  → LIVE_ACTIVE
  → PAUSED / HALTED / REVOKED
```

Live activation requires:

- recent MFA/re-authentication;
- explicit risk-disclosure acknowledgement;
- CEO-entered confirmation phrase;
- valid paper certification;
- successful live-account attestation;
- healthy bridge, Gateway and market data;
- no unreconciled orders or positions;
- active live goal and policy;
- a cooling-off period, recommended 24 hours;
- a second confirmation from the desktop; and
- a tested local physical kill switch.

Changing the account, bridge, strategy skill, core policy or live risk ceiling returns the environment to `PAUSED` or requires recertification.

## 6. Live shadow mode

Shadow mode connects to the live account but keeps the IBKR API read-only and prohibits order submission.

It validates:

- live market-data subscriptions and instrument trading permissions;
- account values, available cash, positions and open orders;
- stock and option contract resolution;
- shortability and borrow status;
- option chains and executable bid/ask data;
- commissions and fee estimates;
- market-data freshness and subscription capacity;
- reconciliation after reconnect and the IBKR daily reset;
- paper-versus-live signal differences; and
- proposed quantities against real account constraints.

Recommended minimum: five complete US trading sessions in shadow mode with no stale-data, account-classification, duplicate-command or reconciliation failures.

## 7. Deterministic live risk policy

Add a non-bypassable platform safety floor above all configurable owner policies:

- Live trading is disabled by default.
- No live order can originate directly from an LLM or strategy skill.
- Gross exposure includes open positions and reserved opening orders.
- Short-sale proceeds do not increase the configured budget.
- Daily opening exposure is reserved before submission.
- Risk-reducing closes do not consume opening budget.
- Actual commissions update net realized results.
- Goal completion stops new entries but not protective exits.
- Stale quote, account, position, shortability or profile data blocks entries.
- Every live entry requires broker-native protection.
- No market entry orders in the initial live release.
- No short, naked or multi-leg options.
- No automatic exercise or holding options through expiry.
- No automatic advanced-order rejection overrides.
- Duplicate or uncertain commands must reconcile before resubmission.

Order IDs must respect IBKR's persistent sequence and other connected clients' order IDs. The bridge always reconciles `nextValidId`, open orders and executions before permitting live entries.

## 8. Conservative live rollout

Do not begin live trading at the full USD 10,000 total and USD 1,000 daily limits.

| Stage | Instruments | Total exposure | Daily opening limit | Entry approval |
|---|---|---:|---:|---|
| Canary A | Long stocks only | USD 1,000 | USD 250 | Every trade |
| Canary B | Long stocks only | USD 2,500 | USD 500 | Every trade |
| Canary C | Add short stocks | USD 2,500 | USD 500 | Every short |
| Canary D | Add long calls/puts | USD 2,500 | USD 500 | Every option |
| Controlled live | All certified instruments | Up to USD 10,000 | Up to USD 1,000 | Configurable |

Promotion requires clean operational evidence, not profitability alone:

- no duplicate submissions;
- 100% order/fill/commission reconciliation;
- no unprotected positions;
- no budget overshoot;
- no stale-data entries;
- disconnect and restart drills passed;
- slippage and commission drag within configured thresholds; and
- manual halt and close-position drills passed.

Short stocks, long calls and long puts receive independent certifications and feature switches. Short options remain unsupported.

## 9. Live order lifecycle

For every live authorization:

1. Reserve exposure atomically.
2. Capture goal, policy, strategy, skill, universe and market-data versions.
3. Generate an immutable, expiring command.
4. Require claim by the correct live bridge identity.
5. Re-attest the account environment locally.
6. Recheck quote, account, position and order state.
7. Obtain a valid IBKR order ID.
8. Submit the bounded parent/protective order group.
9. Wait for broker callbacks.
10. Record order status, fills and actual commissions.
11. Release or convert the reservation.
12. Reconcile ambiguity; never blindly retry.

Protective children must be confirmed at IBKR. Failure to establish protection blocks additional entries and immediately enters the configured risk-reduction path.

## 10. Kill switches and recovery

Provide independent controls:

- global platform live halt;
- owner live halt;
- goal pause;
- strategy pause;
- instrument and direction switches;
- desktop local halt;
- cancel pending entries;
- cancel pending and close positions;
- bridge revocation; and
- automatic circuit breakers for loss, drawdown, stale data, disconnect, commission anomalies and reconciliation mismatch.

A cloud outage blocks entries while leaving IBKR-hosted protective orders active. A Gateway reconnect retrieves open orders, executions, positions and account values before live trading can resume.

## 11. UI and operating surfaces

Under **Prebuilt Workflows → IBKRNewLive0**:

- **Activation:** eligibility, certification, cooling-off and confirmation state.
- **Strategy:** live goal, strategy skill, policy, universe and market data.
- **Summary:** net realized results after actual commissions.
- **Live Operations:** Gateway, bridge, environment attestation, positions, orders, protection and errors.
- **Audit:** every approval, configuration version, command and broker callback.
- Prominent red **LIVE** banner on every page.
- Persistent **Halt live trading** control.

Paper and live reports must never be merged without an explicit environment filter.

The UI offers **Promote certified configuration to live draft**, not “switch to live.” Promotion copies values into a new unpublished live version, applies stricter live floors and requires separate publication/activation.

## 12. Testing and release gates

Required automated and fault-injection coverage:

- paper/live account misbinding;
- wrong port and wrong client ID;
- managed-account callback missing or inconsistent;
- duplicate event and command replay;
- partial fills and multiple commission reports;
- parent fill with failed protective order;
- disconnect during submission;
- unknown order status;
- external/manual TWS orders;
- Gateway daily restart;
- shortability removed after authorization;
- option expiry and exercise-risk windows;
- goal achieved while positions remain open;
- simultaneous budget reservations;
- policy changed mid-command;
- VPS unavailable and desktop unavailable;
- emergency halt during every order state; and
- cross-owner isolation and account-number redaction.

A genuine live test cannot be completed without the owner's authenticated local live Gateway/TWS and funded account. The final live canary is a supervised acceptance session.

## 13. Delivery sequence

1. Approve the live architecture and non-bypassable safety floors.
2. Harden current paper-session attestation.
3. Add live source blueprints and separate agent templates.
4. Implement live account attestation and shadow mode.
5. Implement activation state machine and UI.
6. Add live risk, reservation and command safeguards.
7. Complete simulation and fault-injection tests.
8. Run five-session live shadow certification.
9. Run approval-required long-stock canary.
10. Certify short stocks separately.
11. Certify long calls and long puts separately.
12. Permit controlled automation only after all gates pass.
13. Update Platform Help, public documentation, rollback package and operational runbook.

## 14. Recommended approval boundary

Approve only steps 1–5 initially: paper-session attestation hardening, the separate live environment, live account attestation, shadow mode and activation UI—with live order submission still structurally absent.

This produces evidence from the real live account and market-data setup before introducing financial execution risk. A second explicit approval is required before implementing or enabling the first live canary order.
