# IBKRNew Paper/Live account-context implementation

**Status:** Implemented locally; pending VPS deployment and supervised acceptance

**Version:** 2.0

**Date:** 2026-10-04

**Related baseline:** [IBKR-EVENT-TRADER-FUNCTIONAL-SPEC.md](./IBKR-EVENT-TRADER-FUNCTIONAL-SPEC.md)

## 1. Architecture decision

IBKRNew0 has one trading implementation. Paper and Live are account contexts, not separate strategies, workflows, agents, risk engines, or order lifecycles.

The UI toggle selects which broker context may supply events and claim commands. It does not enable an alternative Live code path and does not copy Paper progress into Live.

Shared across both contexts:

- strategy and strategy skill;
- policy, budgets, loss limits, commission rules, and allocation logic;
- universe and market-data rules;
- six event reactions and agent templates;
- event normalization, planner, deterministic risk authorization, approval, command, and reconciliation code;
- desktop bridge runtime and protocol; and
- retention and privacy controls.

Isolated by `owner_user_id + environment`:

- goal definition and goal cycles;
- broker bridge identity and opaque account reference;
- account and position projections;
- instrument profiles;
- authorizations, reservations, commands, orders, fills, executions, commissions, and trades;
- event timeline, health, errors, summary, and Live Operations data.

This prevents a Paper goal, profit result, position, or reservation from becoming Live state when the owner changes the toggle.

## 2. Single execution flow

```text
IBKR event from selected bridge
  → verify owner and Paper/Live context
  → load that context's account projection and goal
  → run the shared strategy planner
  → run the shared deterministic risk and commission checks
  → create a context-scoped authorization and command
  → matching bridge rechecks account class and command
  → submit through the shared IBKR order path
  → persist callbacks only in that context's ledger
```

The only context-specific decision before processing or submission is account safety:

- Paper requires the locally configured account to begin with `DU` and to be present in IBKR `managedAccounts`.
- Live requires a non-`DU` locally configured account to be present in IBKR `managedAccounts`.
- The bridge sends only the sanitized environment verdict and opaque account reference to Flolah. The real account number stays on the desktop.
- A Paper bridge cannot claim a Live command and a Live bridge cannot claim a Paper command.

Default ports may be 4002 for Paper and 4001 for Live, but a port is configuration, never proof of account type.

## 3. Generic readiness state

Both Paper and Live use the same readiness states:

```text
AWAITING_BRIDGE → ACTIVE
                → BLOCKED
```

- `AWAITING_BRIDGE`: no fresh verified bridge attestation exists for the selected context.
- `ACTIVE`: the selected context has a fresh matching bridge attestation and may process commands when the shared policy permits it.
- `BLOCKED`: the selected bridge reported an account mismatch or failed attestation.

Changing context cancels unsubmitted authorizations and releases their reservations in the prior context. It does not close existing broker positions, delete history, or alter either context's goal. Residual Live exposure remains visible when Paper is selected so it cannot be forgotten.

## 4. Desktop safety gate

The package uses the same settings for either context:

```dotenv
IBKRNEW_TRADING_MODE=paper
IBKRNEW_ACCOUNT_ID=
IBKRNEW_EXECUTION_ENABLED=0
```

To use Live, set `IBKRNEW_TRADING_MODE=live`, use the Live Gateway connection, and configure the matching non-Paper account locally. The single `IBKRNEW_EXECUTION_ENABLED` gate controls submission in both contexts. There are no separate Paper and Live execution switches.

Before `placeOrder`, the bridge verifies:

1. its configured context matches the command context;
2. the configured account is present in the current `managedAccounts` result;
3. the account has the expected Paper or Live classification;
4. account, positions, and open orders are reconciled;
5. the command signature, expiry, opaque account reference, and authorization are valid; and
6. the shared goal and risk controls still permit the action.

## 5. Goal and operations isolation

The Strategy page loads and edits the goal for the selected context. A Paper goal and a Live goal have different IDs, cycles, capital basis, profit progress, status, and history.

Example:

```text
Paper: 5% / 30 days — cycle progress 2.1%
Live:  3% / 20 days — waiting for Live account capital
```

Switching Paper → Live loads the Live row; it never continues the Paper cycle. Switching back reloads the same Paper cycle that existed before.

Summary and Live Operations default to the selected context. Timeline queries are server-paginated and environment-filtered. An explicit environment filter may retrieve historical data from the inactive context, but the UI does not merge the datasets into current operational state.

## 6. Configuration and operating behavior

The shared policy keeps the existing owner-configurable controls, including:

- USD 10,000 total gross exposure and USD 1,000 daily opening exposure defaults;
- long stock, short stock, long call, and long put switches;
- position, loss, drawdown, liquidity, freshness, and commission gates;
- automatic, approval-required, or advisory strategy execution mode; and
- goal target, duration, one-time/perpetual behavior, and pause/resume.

The policy has one `execution_enabled` switch. Live does not silently apply different strategy logic or risk limits. The owner can deliberately configure more conservative values before selecting Live, but that is a normal shared policy change and is versioned like any other configuration update.

## 7. Local harness acceptance

The release harness must prove:

- identical Paper and Live signal-to-command behavior for equal inputs;
- Paper (`DU`) and Live (non-`DU`) attestation success and mismatch failure;
- no command claim before fresh attestation in either context;
- a bridge cannot claim the other context's command;
- Paper and Live goal IDs and cycles are distinct;
- replacing or pausing the Paper goal does not modify the Live goal, and vice versa;
- account projections, profiles, events, reservations, commands, trades, and reports stay context-scoped;
- switching context cancels only unsubmitted prior-context work and releases its reservation;
- residual Live exposure stays visible while Paper is selected;
- real IBKR account identifiers are neither accepted nor persisted by the VPS; and
- package, installer, source, Docker/build inputs, static help, and templates use the shared contract.

## 8. VPS acceptance boundary

Local tests can validate the shared lifecycle and safety contracts without a broker order. VPS deployment should be followed by:

1. Paper bridge attestation and end-to-end Paper lifecycle verification.
2. Live bridge connection to an authenticated Live Gateway with `IBKRNEW_EXECUTION_ENABLED=0` to verify account classification and read-only reconciliation.
3. Confirmation that the Live goal and Live Operations dataset do not contain Paper progress.
4. A separately authorized supervised Live canary if the owner chooses to enable actual order submission.

A real Live order is never part of an automated deployment test. It requires the owner’s authenticated broker session, suitable account permissions, and explicit operational decision.

## 9. Rollback

The prior local checkpoint is commit `3a46bcab`. The account-context correction is maintained as a separate commit so it can be reviewed or reverted independently before deployment. No VPS database or `.env` file is changed by the local implementation.
