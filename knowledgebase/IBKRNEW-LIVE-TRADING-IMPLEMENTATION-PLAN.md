# IBKRNew live trading implementation plan

**Status:** Proposed; not approved for implementation

**Version:** 1.1

**Date:** 2026-09-02

**Related baseline:** [IBKR-EVENT-TRADER-FUNCTIONAL-SPEC.md](./IBKR-EVENT-TRADER-FUNCTIONAL-SPEC.md)

**Existing release:** `IBKRNew0` remains paper-only until the live execution gates in this plan are implemented and accepted

## 1. Executive decision

Live trading will be exposed as a user-controlled **Trading mode: Paper / Live** setting inside the existing `IBKRNew0` product. The toggle reuses the paper-tested goal, strategy, strategy skill, policy, universe, market-data configuration, event-driven workflow and agents. It does not create a second product or require the user to rebuild the configuration.

The toggle is an activation control rather than an unguarded Boolean. Moving to Live is allowed only after the bridge verifies the intended live account and the platform completes the explicit activation checks in this plan. Paper and live broker bindings, credentials, commands, orders, fills, positions, commissions and audit records remain isolated by execution mode so simulated and financial activity cannot be confused.

```text
IBKRNew0 — Paper mode
     │
     │ user selects Live and passes activation checks
     ▼
Live account attestation and confirmation
     │
     ├── optional Shadow mode — reads live data/account, submits nothing
     └── optional conservative canary limits
     ▼
IBKRNew0 — Live mode
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

## 3. One product with mode-isolated execution

Keep a single product and navigation namespace: `IBKRNew0`. Add `trading_mode = paper | live` to its runtime configuration and show the active mode prominently throughout its UI.

Reuse across modes:

- goal and objective definition;
- strategy and strategy skill;
- risk-policy values, subject to non-bypassable live safety floors;
- stock, ETF, index and option universe filters;
- market-data selection;
- event inbox and event-driven workflow;
- strategy proposal agents;
- deterministic risk evaluator;
- retention policy; and
- desktop bridge package and generic protocol.

Isolate by mode:

- local broker-account binding and opaque account reference;
- bridge authorization, token and IBKR client ID;
- command outbox and idempotency namespace;
- exposure and budget reservations;
- orders, fills, positions, executions and commissions;
- operational health and audit records; and
- live activation and kill-switch state.

Changing the mode must not mutate or delete the saved strategy configuration. Historical reports default to the active mode and require an explicit mode filter for combined analysis. Switching to Paper stops new live entries but does not hide or abandon live positions or protective orders; those remain visible and manageable until reconciled and closed.

Live authorization and account attestation remain separate safety modules inside the shared bridge because their consequences and approval requirements differ from simulation.

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

Implement an owner-scoped, auditable live-mode state machine behind the UI toggle:

```text
PAPER_ACTIVE
  → LIVE_REQUESTED
  → ACCOUNT_ATTESTING
  → USER_CONFIRMATION_PENDING
  → LIVE_ACTIVE
  → PAPER_ACTIVE / HALTED / REVOKED

Optional: ACCOUNT_ATTESTING → SHADOW_ACTIVE → USER_CONFIRMATION_PENDING
```

Live activation requires:

- recent MFA/re-authentication;
- explicit risk-disclosure acknowledgement;
- owner-entered confirmation phrase such as `ENABLE LIVE TRADING`;
- successful live-account attestation;
- healthy bridge, Gateway and market data;
- no unreconciled orders or positions;
- active live goal and policy;
- a tested local physical kill switch.

The UI presents paper test history, shadow results and canary recommendations to support the owner's decision, but Flolah does not decide whether the strategy is profitable or suitable. Once the technical checks pass, the account owner decides whether to enable Live. No separate CEO or platform-operator approval is required.

Changing the account, bridge, strategy skill, core policy or live risk ceiling returns live mode to `PAUSED` or requires recertification. The owner can always return the configuration to Paper mode, but open live positions and orders continue to be handled through the live operations boundary until reconciled.

## 6. Live shadow mode

Shadow mode is an optional owner-selected validation mode. It connects to the live account but keeps the IBKR API read-only and prohibits order submission.

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

Recommended evidence: five complete US trading sessions in shadow mode with no stale-data, account-classification, duplicate-command or reconciliation failures. This is guidance shown to the owner, not a mandatory platform approval gate.

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

Recommend that the owner not begin live trading at the full USD 10,000 total and USD 1,000 daily limits. The UI proposes the following conservative defaults, which the owner may change within the platform's non-bypassable safety constraints.

| Stage | Instruments | Total exposure | Daily opening limit | Entry approval |
|---|---|---:|---:|---|
| Canary A | Long stocks only | USD 1,000 | USD 250 | Every trade |
| Canary B | Long stocks only | USD 2,500 | USD 500 | Every trade |
| Canary C | Add short stocks | USD 2,500 | USD 500 | Every short |
| Canary D | Add long calls/puts | USD 2,500 | USD 500 | Every option |
| Controlled live | All owner-enabled instruments | Up to USD 10,000 | Up to USD 1,000 | Configurable |

Recommend increasing limits or enabling additional instrument classes only when operational evidence is clean, rather than relying on profitability alone:

- no duplicate submissions;
- 100% order/fill/commission reconciliation;
- no unprotected positions;
- no budget overshoot;
- no stale-data entries;
- disconnect and restart drills passed;
- slippage and commission drag within configured thresholds; and
- manual halt and close-position drills passed.

Short stocks, long calls and long puts have independent feature switches so the owner can enable only the tested instrument classes. The UI retains test and operating evidence for each class. Short options remain unsupported.

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

Under **Prebuilt Workflows → IBKRNew0**:

- **Trading mode:** prominent Paper/Live selector, readiness checks, test evidence and confirmation state.
- **Strategy:** live goal, strategy skill, policy, universe and market data.
- **Summary:** net realized results after actual commissions.
- **Live Operations:** Gateway, bridge, environment attestation, positions, orders, protection and errors.
- **Audit:** every approval, configuration version, command and broker callback.
- Prominent red **LIVE** banner on every page.
- Persistent **Halt live trading** control.

Paper and live reports must never be merged without an explicit mode filter. When Live is selected, every `IBKRNew0` page displays a persistent red **LIVE** banner and immediate halt control.

When the owner selects Live, the UI shows the exact paper-tested configuration that will be reused, any stricter live safety floors, the attested masked broker account, unresolved blockers and a final confirmation. The switch is rejected while account attestation is incomplete, orders or positions are unreconciled, required market data is stale, or another live activation condition fails.

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
3. Add the mode-aware source blueprint while reusing the existing workflow and agent templates.
4. Implement live account attestation and shadow mode.
5. Implement activation state machine and UI.
6. Add live risk, reservation and command safeguards.
7. Complete simulation and fault-injection tests.
8. Expose optional shadow validation and its evidence in the UI.
9. Provide conservative long-stock canary defaults.
10. Provide independently configurable short-stock controls.
11. Provide independently configurable long-call and long-put controls.
12. Allow the owner to enable Live after deterministic activation checks pass.
13. Update Platform Help, public documentation, rollback package and operational runbook.

## 14. Implementation and activation boundary

The implementation includes the guarded Paper/Live UI control and live order path, but deploys with Live disabled by default. Implementing or deploying the capability does not activate live trading for any user.

After deployment, the account owner may select Live without a separate product, duplicated configuration, CEO approval or platform-operator approval. Activation succeeds only when deterministic account attestation, reconciliation, health, permission, budget and policy checks pass. Optional shadow and canary stages remain available as recommended evidence and conservative defaults rather than mandatory approvals.
