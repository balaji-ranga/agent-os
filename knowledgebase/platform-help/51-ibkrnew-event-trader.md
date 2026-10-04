# IBKRNew0 event-driven Paper/Live trader

**Path:** **Prebuilt Workflows → IBKRNew0 → Strategy | Summary | Live Operations**

**Desktop download:** **Connectors → IBKRNew Event Bridge**

**Release boundary:** Paper is selected by default. Either account context requires a matching local bridge attestation before order processing. This is separate from the older IBKR Monthly Positive Return workflows.

IBKRNew0 reacts to broker and market events from a Windows desktop beside IB Gateway or TWS. Flolah does not connect from the cloud directly to the local Gateway, and there is no server-side price polling loop. The desktop bridge opens outbound HTTPS connections, streams market/broker callbacks, sends canonical events to Flolah, and claims short-lived signed commands for its registered environment.

> Trading involves risk. The supplied configuration is a paper-trading baseline, not financial advice or a promise of returns. Validate the strategy and broker entitlements with paper data before relying on any result.

## Paper and Live mode

Paper and Live use one strategy skill, strategy, policy, universe, market-data configuration, six event reactions, deterministic risk engine, command path, and bridge runtime. They do **not** share goal state: each account context has its own goal definition and cycle progress. Broker identities, account projections, profiles, reservations, commands, trades, executions, commissions, events, and reports are also separated by context.

IBKRNew0 can submit orders only when all of these are true:

- the owner-selected UI mode matches the registered desktop bridge environment;
- the bridge has verified the locally configured account is present in IBKR `managedAccounts` and matches Paper (`DU…`) or Live (non-`DU…`);
- the single local `IBKRNEW_EXECUTION_ENABLED` gate is explicitly enabled;
- the active goal, strategy, universe, market data and deterministic risk checks permit the order.

An operator can enroll one enabled CEO idempotently with `backend/scripts/enable-ibkrnew-owner.mjs`. Enrollment installs/enables the complete IBKRNew0 capability—agents, reaction workflows, tool grants, workspace instructions, and baseline configuration—and verifies the result. Paper remains selected by default. Advisory and approval-required strategy modes can further restrict either environment.

## Start and event flow

```mermaid
flowchart LR
  GW[IB Gateway or TWS\non your Windows PC] -->|quotes, bars, orders, fills, positions| Bridge[IBKRNew Event Bridge]
  Bridge -->|outbound HTTPS events| Inbox[Flolah event inbox]
  Inbox --> Observe[Market observation]
  Observe --> Plan[Strategy proposal]
  Plan --> Risk[Deterministic risk and budget gate]
  Risk -->|authorized mode-scoped command| Outbox[Expiring command outbox]
  Outbox -->|bridge claims and rechecks| Bridge
  Bridge -->|protected order in selected environment| GW
  GW -->|status, fill and commission events| Bridge
  Inbox --> Monitor[Position and goal monitoring]
  Inbox --> Supervise[Health and reconciliation]
```

The bridge must be running for new market events or commands to move. If the desktop, Gateway, data or cloud connection becomes stale, new entries fail closed. Existing broker-hosted protective orders remain at IBKR, while fills, closes, reconciliation and risk-reducing actions continue to be processed.

## Reactions, agents and responsibilities

IBKRNew0 is not one long workflow and does not contain a node that waits all day. It has six independent, short-lived event reactions:

| Reaction | Employee | Main events | Responsibility |
|---|---|---|---|
| Market observation | IBKRNewMarketObserver | bars, sessions, shortability, instrument/profile refreshes | Normalize desktop observations. |
| Strategy planning | IBKRNewStrategyPlanner | closed bars, regime changes | Apply the active goal, strategy skill and universe; propose only. |
| Risk checking | IBKRNewRiskChecker | signals, account snapshots, position changes | Enforce budgets, freshness, exposure, loss and commission rules deterministically. |
| Execution | IBKRNewExecutionOperator | authorized trades, order status | Deliver immutable, expiring mode-scoped commands to the correct bridge. |
| Position monitoring | IBKRNewPositionMonitor | fills, positions, hold/expiry windows | Track protection, commissions and goal-attributed realized outcomes. |
| Trading supervision | IBKRNewTradingSupervisor | disconnects, reconciliation mismatches, circuit breakers | Fail closed, report health and coordinate recovery without opening exposure. |

Each event is owner-scoped and idempotent. Retrying an acknowledged event must not create a second broker order.

## Configure the objective and trading rules

Open **IBKRNew0 → Strategy**. The tabs separate concerns:

- **Goal:** the measurable outcome and time boundary. The default is a configurable 5% net-realized return over 30 calendar days.
- **Strategy:** how eligible opportunities are proposed. The default is a configurable liquid US trend/pullback baseline.
- **Strategy skill:** instructions used by the strategy planner. It may propose a trade but cannot authorize or place one.
- **Policy:** deterministic switches, budgets, losses, position sizes, sessions, options, orders, commissions and allocation rules.
- **Universe:** eligible stock indices and independent ETF filters, liquidity/price rules and exclusions.
- **Market data:** required executable quotes, bars, shortability, account truth, instrument profiles, fundamentals and corporate events.

**Save** publishes a new owner-scoped configuration version to the database and retires the prior active version. An in-flight authorization keeps the exact versions it was checked against. The **Paper / Live** control changes only the broker account context; it does not duplicate or reset the shared strategy configuration. It does load a different goal, progress, account, positions, commands, trades, and timeline. No setting can bypass account attestation, the local execution gate, or broker restrictions.

### Default conservative-to-moderate limits

- Total gross exposure: **USD 10,000**.
- Daily new opening exposure: **USD 1,000**.
- Maximum stock position: USD 750; maximum option premium position: USD 250.
- Maximum planned loss per trade: USD 50; daily loss limit: USD 150.
- Up to six open positions, including up to three long-option positions.
- Long stocks, short stocks, long calls and long puts are independently disableable.
- Short selling applies to stocks only. Short/naked/multi-leg options are not supported.

The total limit covers gross open exposure plus reserved opening exposure. Cash raised by a short sale does not create extra Flolah budget. The daily limit counts new opening exposure, not risk-reducing closes or buy-to-cover orders.

## Goal stop behavior

The active goal authorizes new opening exposure. Progress uses closed, goal-linked trades and **net realized profit after actual commissions**.

- **One time:** reaching the target or deadline stops new entries until a new goal is activated.
- **Perpetual:** the current cycle stops at its target or deadline; the next cycle starts only at the scheduled cycle boundary.
- **Pause:** blocks new opening trades until resumed.

Achieved, expired, completed, paused or waiting-for-capital goals do not block protective exits, closes, buy-to-cover, fills, commissions, reconciliation or health events for existing positions.

## Commissions and allocation

Before an entry, the risk gate compares estimated round-trip commission and regulatory fees with expected gross profit, expected net profit and reward/risk. It can reduce quantity or reject a trade when commission drag makes it uneconomic. A single trade may use more of the daily budget only when the configured confidence, net reward/risk, concentration and commission thresholds all pass.

After execution, actual broker commission events update the trade record. Summary and goal progress use realized results after those actual commissions, not only the estimate.

## Universe and market data

Stock and ETF selection are independent:

- use stock-index membership filters to narrow eligible stocks;
- use separate ETF include/exclude and eligibility rules;
- apply configured price, volume, spread and liquidity limits;
- require fresh shortability before a short-stock entry;
- require option chain, expiry, delta, open-interest, volume and spread rules for long calls/puts.

Executable quotes, bars, order/account/position truth and commissions come from IBKR through the local bridge. Fundamentals, index/ETF membership, instrument reference data and corporate events may come from licensed profile data configured for the bridge. Fundamentals support eligibility and event-risk filters; they are not the low-latency price trigger.

Only symbols assigned by the active universe should be subscribed. Data entitlements and exchange permissions remain the responsibility of the selected IBKR account.

## Install the one desktop service

1. Install and sign in to IB Gateway or TWS on the Windows trading PC; enable its local API for the intended Paper or Live session.
2. In Flolah, open **Connectors → IBKRNew Event Bridge**.
3. Download the Paper or Live full package (portable runtime included) or its lite package (local compatible runtime required).
4. Extract it to a private local folder. Keep the generated environment file and token private.
5. Configure the Gateway host/port, a dedicated client ID, and the matching account **only on that PC**. Default Gateway ports are commonly 4002 for Paper and 4001 for Live, but the bridge never treats the port as proof of environment.
6. Run the package's offline test, then run `scripts\Install-IBKRNewBridgeTask.ps1`. It installs the bridge in the signed-in user's Local App Data, registers the `IBKRNewBridge` Windows Scheduled Task and starts it.
7. Confirm Gateway, bridge and market-data health in **Live Operations**. Use `scripts\Get-IBKRNewBridgeTaskStatus.ps1` for local task status.
8. Enable the single local execution gate after subscriptions, account attestation, positions and reconciliation are healthy. Select Paper or Live in **IBKRNew0 → Strategy**; the selected context stays blocked until its matching bridge attests successfully.

The package runs one supervised IBKRNew bridge process. The task starts at user sign-in, restarts a failed process, starts missed runs when Windows becomes available and reconnects to Gateway after Modern Standby. Every cloud request has a timeout, and an independent progress watchdog exits a wedged runtime so the supervisor can restart it instead of leaving a falsely Running but offline process. IB Gateway still requires an authenticated desktop session; if that session expires, new exposure remains blocked until the user signs in again. The six event reactions run in Flolah; no workflow package is downloaded to the desktop. Revoking a bridge in Live Operations invalidates its token and pending commands.

## Monitor and troubleshoot

**Summary** shows commission-adjusted outcomes, goal-cycle progress and allocation decisions. **Live Operations** is the authoritative runtime audit rather than an agent-chat transcript. Its six-agent activity cards show the current state and latest correlated event for Market Observer, Strategy Planner, Risk Checker, Execution Operator, Position Monitor and Trading Supervisor.

The causal event timeline is loaded with server-side pagination (20 events per page), event-type and status filters, and is scoped to the selected Paper or Live mode. Each row explains what happened in plain language. **View lifecycle** loads one event's detail on demand and shows the ordered six-role lifecycle, persisted planner/risk decision, authorization, command, trade and execution evidence using a common correlation ID. Health, snapshots, profiles, approvals and executions refresh separately, so an ever-growing event history is never downloaded into the page. All event and decision evidence remains owner-scoped and follows the owner’s configured retention and offboarding policy. Returning to Paper does not hide residual live exposure: Live Operations displays a red reconciliation warning until the live bridge reports no positions or open orders.

The current account projection is refreshed frequently for the risk gate, but historical snapshot rows are compacted: a new row is retained when position/order structure changes or when the five-minute checkpoint is due. Valuation-only refreshes inside that window update current state without adding redundant snapshot history. The daily retention job removes snapshots and events older than the CEO profile's 30, 60, 90, 120 or 365-day selection (90 days by default).

Before expecting an order, verify:

1. Goal state is active and cycle capital is available.
2. Trading and the desired instrument/direction switches are enabled.
3. The selected-mode desktop bridge and Gateway show online, attested and reconciled.
4. Quote, feature, account, shortability and instrument data are fresh.
5. The symbol passes the active stock-index or ETF universe filters.
6. Total, daily, position, loss and commission gates have capacity.
7. Any required CEO approval is still within its expiry window.

On disconnect or uncertain submission, do not manually replay a command. Restore Gateway/bridge connectivity and let reconciliation resolve open orders, executions and positions before enabling new entries.

If Live Operations shows the bridge offline, check the `IBKRNewBridge` Scheduled Task first. A Running task with a stale heartbeat should be restarted; the current package also self-recovers from a stalled cloud request through its watchdog. Local supervisor/runtime logs are under `%LOCALAPPDATA%\Flolah\IBKRNewBridge\logs`; they rotate automatically and should never be copied into public help or source control.

## Privacy and sensitive data

The real IBKR account number is configured locally and must not be entered in Flolah chat or browser forms. Flolah stores a random opaque account reference, owner-scoped events/projections, configuration versions, positions, orders, fills, commissions, health and audit records. Bridge credentials are generated per owner/bridge, stored hashed on the server, and shown only as needed in the downloaded package.

Do not upload the downloaded environment file, bridge token, Gateway credentials, account number, statements or diagnostic logs containing them to Master Data or a public issue. Revoke the bridge and generate a new package if its token may have been exposed.

## Related

- **Older monthly strategy:** [IBKR Monthly Positive Return](./20-ibkr-monthly-trading.md) — separate workflows and data.
- **Connector packages:** [Connectors and OpenConnector](./16-connectors-openconnector.md).
- **External package tokens:** [Tokens management](./34-tokens-management.md).
- **Retention:** [Scheduled jobs and data retention](./19-scheduled-jobs-and-crons.md).
