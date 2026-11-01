---
title: Physical AI capabilities and rollout
sidebar_label: Physical AI capabilities
description: Supported physical device capabilities and how they fit into Flolah.
---

# Physical AI capabilities and rollout

Flolah extends its existing company OS with registered physical devices alongside AI employees and humans. Existing digital connectors and workflows continue to work.

## Use the current foundation

- Run a Windows or Linux edge hub and enroll it to a company site. Multiple hubs can share a Site ID; each has its own identity and credential.
- Start with the bundled TV, switch, sensor and robot simulator profiles.
- Connect supported equipment through curated Home Assistant or MQTT adapters. Compatibility depends on the device and its integration.
- Use **Physical AI → Device mappings** to configure supported HA app catalogs or fixed scripts/buttons with independently observed feedback. Credentials stay local.
- Register devices, review capabilities and choose action policies. Grant discovery and operations to the intended users, AI employees or workflows.
- Request an operation manually, through an entitled agent, or from a **Physical Device** workflow node. Complete the required human approvals and inspect the recorded outcome.
- Inspect readiness, observation timestamps, operation status and available evidence. An accepted command alone is not verified completion.

## Understand the three delivery stages

1. **Foundation:** governed registration, edge connectivity, simulator testing, supported adapters and evidence-backed operations.
2. **Broader integrations:** additional validated devices and reusable adapter capabilities, with guided configuration and operational controls.
3. **Coordinated physical work:** supported task-capable agents and richer human/digital/physical workflows, subject to equipment compatibility and local safety controls.

Only use operations actually declared and enabled for your registered device. Android APK distribution and arbitrary robot/vendor support are not included in the current desktop hub setup.

## Start here

Follow the [step-by-step onboarding guide](/systems/physical-ai-onboarding), then read the [component and capability architecture](/systems/physical-ai). For automation, see [Workflows](/systems/workflows).
