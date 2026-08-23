---
slug: what-we-learned-building-flolah-with-flolah
title: What We Learned Building Flolah with Flolah
authors: [rajisri]
tags: [ai-agents, open-source, building-in-public, flolah]
description: The hardest part of an agent company is organising responsibility, context, and human judgement.
---

Building a system for AI-agent companies creates an unavoidable test: can the product help operate its own development?

We have used Flolah's organisational model while shaping Flolah itself—giving work to specialist roles, preserving product knowledge, coordinating through a COO, and keeping consequential decisions with people.

The experience reinforced a lesson that agent demonstrations often miss. Generating work is not the hardest part. Organising responsibility is.

<!-- truncate -->

## A capable agent still needs a clear job

Broad roles produce broad answers.

When an agent is described only as “helpful” or “technical,” it must infer the objective, audience, boundaries, and definition of completion every time. The results may be impressive but inconsistent.

Durable specialist roles worked better. Research gathers evidence. Platform Help answers from product documentation. Workflow Builder handles visual workflows. The COO plans and delegates. Each role has a purpose and knows which peers exist.

The [AI employee guide](https://flolah.cloud/docs/setup/hire-ai-employees/) documents how Flolah stores those identities as workspace instructions, collaboration rules, tools, and memory.

## One outcome beats ten disconnected prompts

We found that delegation works best when the human states one clear outcome.

“Document this feature, verify the behaviour, and flag decisions” gives the COO something it can decompose. A sequence of disconnected micro-prompts makes the human responsible for orchestration again.

The COO model is valuable because it owns the relationship between specialist tasks. Flolah's [delegation guide](https://flolah.cloud/docs/run/chat-and-coo/) describes how clear asks are routed with context and represented on Kanban.

## Documentation is operational memory

Product knowledge cannot live only in the founder's head or in old chats.

Writing public documentation forced concepts to become explicit: what an AI employee is, how company knowledge works, which tools require configuration, and where approvals belong. That documentation then becomes usable context for both people and agents.

This creates a useful loop. Building improves the docs; the docs improve agent performance; agent questions reveal where the product remains unclear.

The [Flolah user guide](https://flolah.cloud/docs/) is public and requires no sign-in, so customers and contributors can examine the operating model directly.

## Visibility changes the quality of delegation

It is easier to delegate when work does not disappear.

Kanban cards, notifications, stand-ups, and run history make background execution understandable. The founder can see whether a task is active, blocked, waiting for review, or complete without asking every specialist for an update.

Visibility also exposes weak delegation. If cards repeatedly stall, the issue may be missing context, unclear ownership, excessive permissions, or an approval placed at the wrong stage.

## Human control should be designed, not improvised

Some actions should remain drafts until a person approves them. Publishing an article, changing access, sending an external message, or deploying production code carries responsibility beyond the quality of the generated output.

We learned to treat approval as a normal workflow stage. Agents should prepare enough evidence for a decision, while the person retains meaningful authority to accept, reject, or revise.

This approach enables more autonomy because the boundary is visible.

## Open source sharpens accountability

Flolah's application source is licensed under Apache 2.0 and available in the [agent-os repository](https://github.com/balaji-ranga/agent-os). The hosted Flolah.cloud service remains a commercial offering; the [open-source notices](https://flolah.cloud/legal/open-source.html) document the boundary and major components.

Publishing source does not make a product correct automatically. It does make design decisions inspectable. Contributors can trace how roles, permissions, tools, and workflows are represented and challenge assumptions with evidence.

## The product is the operating model

The most important insight is that an agent company is not defined by the number of agents it runs.

It is defined by how clearly work moves from human intent to specialist responsibility, governed execution, visible progress, and human judgement. Models and tools will continue to change. A sound operating model makes those changes usable.

We are still learning. That is precisely why building Flolah with Flolah matters: every failure is not merely a product bug; it is evidence about how AI-native organisations need to work.

## Build alongside us

Try the [first 15 minutes](https://flolah.cloud/docs/start/first-15-minutes/), inspect the [open-source repository](https://github.com/balaji-ranga/agent-os), and share what works—or breaks—in the [Flolah forum](https://flolah.cloud/blog/forum/). [Explore Flolah](https://flolah.cloud/).
