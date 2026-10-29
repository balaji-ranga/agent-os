---
title: Physical AI, humans and digital agents
description: Planned expansion of the Flolah Company OS to coordinate people, digital agents and supported physical equipment.
---

# Physical AI, humans and digital agents

Flolah remains the **AI Company OS**: humans set direction, digital AI employees own outcomes, and workflows execute under policy and supervision. The proposed physical AI expansion extends that same platform to supported devices and task-capable robots, bringing human, digital and physical work into one coordinated process.

:::info Proposed scope — 29 October 2026
This page describes the planned architecture and product direction. It does not announce generally available device integrations, robot support, an Edge Hub or a TV app. Existing Company OS capabilities and guides continue to apply. Delivery follows the [three-phase implementation plan](/systems/physical-ai-implementation-plan).
:::

## One platform, expanded experiences

**Flolah Business** extends company operations for shops, cafés, offices and service businesses. A closing routine could combine sales and inventory records, permitted equipment actions, and staff checks in one workflow.

**Flolah Home** is a proposed household experience on the shared platform. It would coordinate household members, routines, connected equipment and supported robots with household-specific roles and permissions. The company onboarding instructions elsewhere in this guide describe the existing business experience; household onboarding is planned separately.

Both experiences reuse the platform's agents, knowledge, workflows, policies, approvals and audit capabilities. Business and household data and authority must remain isolated.

## Who does what

- **Humans** request outcomes, grant authority, approve consequential actions and perform work requiring a person. A workflow must identify the person responsible for a manual step and record their confirmation or exception.
- **Digital agents** plan, coordinate and use approved digital tools and physical capabilities. They escalate missing permissions, uncertainty and failures to people.
- **Physical agents** own delegated physical tasks and expose progress and outcomes. A supported cleaning robot could accept a room-cleaning task through an adapter.
- **Physical devices** expose state, commands or events. Lights, sensors and thermostats are resources; executing a command does not make them autonomous agents.

The proposed **PhysicalEntity** registry describes real-world assets, ownership, location, connectivity and capabilities. A **PhysicalDevice** exposes properties, actions and events. A **PhysicalAgent** adds delegated task responsibility, permissions, progress and failure handling. Agent identity is separate from hardware, and a physical agent need not use an LLM.

## How the architecture expands

The existing [Company OS capability architecture](/start/company-os-capabilities) and [operating model](/start/how-the-company-runs) remain the foundation. The proposed extension adds a governed physical capability layer alongside existing digital connectors:

1. **Existing platform:** people and digital agents define and coordinate work through goals, knowledge, workflows, policies, approvals and audit.
2. **Unified capability interface:** discover assets, read properties, invoke approved actions, subscribe to events and manage supported tasks. Curated agent tools expose only authorized capabilities.
3. **Registry and task records:** track asset identity and permissions, observed state, task ownership, progress, timeouts and outcomes.
4. **Local Edge Hub:** enroll devices, run adapters, execute authorized commands, buffer events and apply approved offline policy over an authenticated connection.
5. **Equipment and controllers:** retain responsibility for navigation, obstacle avoidance, interlocks, emergency stops and other local safety controls.

Existing SaaS, CRM and ERP connectors continue to serve digital work. Physical adapters translate the same workflow's permitted physical steps into supported vendor interfaces. Flolah coordinates work; it does not manufacture robots or replace real-time robot controllers.

### Proposed integration approach

Use W3C Web of Things Thing Descriptions for device properties, actions and events, with Flolah extensions for identity, policy and task lifecycle. Begin with a Home Assistant integration and MQTT events; use Matter through tested controller and device pathways. Compatibility depends on the selected equipment, APIs, bridges and vendor permissions.

Add camera, robot and industrial adapters only for validated use cases. Candidate interfaces include ONVIF, robot vendor APIs or ROS 2, and dedicated gateways for Modbus, OPC UA or BACnet. Avoid overlapping gateway runtimes in the initial pilot.

### Interfaces and hardware

Web, mobile, voice and a proposed Android TV app provide conversation, status and approvals. A separate Linux Edge Hub is the preferred device gateway. An ordinary USB storage stick cannot turn an arbitrary TV into a Flolah client. An optional HDMI computing device is a later product decision, after hardware and support validation.

## Shared workflows in practice

**Close shop — Business:** a manager requests closing; a digital agent summarizes permitted sales and inventory data; a staff member completes a manual premises check; authorized equipment actions run; Flolah records observed results, outstanding approvals and exceptions. A missing staff confirmation leaves the step incomplete.

**Prepare for guests — Home:** a household member requests preparation; a digital agent checks permitted context and proposes a routine; a supported physical agent cleans the selected room; a person handles any obstruction or exception. Completion requires task results, not merely acceptance of a command.

## Authority, safety and evidence

Every action must be scoped to the requester, workspace, location, capability and applicable policy. Consequential actions require the appropriate human approval. Camera access requires explicit authorization, clear retention rules and local processing where feasible; cloud model access is not implicit.

LLMs must not issue low-level motor commands or bypass vendor safety controls. Local emergency stops and manual overrides remain independent of Flolah. During cloud outages, only pre-approved safe local routines may run; unknown or unsafe actions fail closed.

Task records must distinguish proposed, authorized, queued, dispatched, accepted, running and final outcomes. Capture requester, accountable actor, policy decision, progress, timeout, errors and audit references. Support cancellation where equipment permits it, and reconcile uncertain state after connectivity returns. Retry only when safe, with deduplication where supported; network retries cannot guarantee exactly-once physical actuation.

## Related guides

- [Three-phase implementation plan](/systems/physical-ai-implementation-plan)
- [Human-directed agent work](/start/human-directed-agent-work)
- [Workflows](/systems/workflows)
- [Connectors and MCP](/systems/connectors-and-mcp)
- [Policies](/systems/policies)
