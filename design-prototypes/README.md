# Flolah Immersive Command Space — UX review

This is an isolated static concept. It does not change production routes, APIs, data, permissions, or the existing frontend.

## Current experience assessment

The prototype was remapped against the authenticated VPS UI on October 3, 2026. Labels, counts, sections, tabs and representative records now follow the live Balaji Ranganathan company experience rather than invented dashboard concepts.

- Flolah has strong functional breadth, but the large nested navigation makes the platform feel like a collection of modules rather than one company operating system.
- Work is represented separately in chat, goals, Kanban, live operations, people, and connectors. Users must mentally reconstruct the relationship between them.
- The current themes change surface treatment, but not the information architecture or interaction model.
- Page cards have similar visual weight, so urgent decisions, live work, and reference configuration compete for attention.
- The persistent top bar and navigation are conventional and usable, but do not express Flolah's differentiator: humans and AI employees executing together.

## Proposed experience

1. **Home remains the company pulse.** Company Space, Execution Flow and People & AI are lenses inside Home, not replacements for existing modules. Depth represents hierarchy and relationship—not status by itself.
2. **Execution flow is a contextual drill-down.** Every goal can be read left to right as steps, evidence, ownership, approvals and outcomes while Goal Plans and Kanban remain intact.
3. **Persistent COO copilot.** COO remains available without hiding the work context. Its replies cite the records and evidence used.
4. **Five existing primary destinations stay one click away.** Home, Daily Digest, Workspace, Live Operations and Reviews are always visible; every detailed module remains available through the role-aware launcher.
5. **Calm immersive motion.** Parallax, elevation and transitions explain changes. Reduced-motion and conventional list views remain first-class.

## Complete menu reorientation

No existing feature is removed. The shell becomes deliberately small while the searchable **All capabilities** launcher provides a complete, role-aware catalog.

The regenerated prototype now includes realistic working views for all live primary destinations:

- **Home:** actual operating KPIs, agent selector, COO chat, Today’s Snapshot, Team activity and Recent Workflows.
- **Digest:** the live weekly window, AI worker/task/time/value metrics, organization highlights, objective progress, goal plans, workflows and insights.
- **Workspace:** Operating Workspace header, Builder/Kanban/AI Employee links, At a glance, My tasks, AI workforce and Recent AI activity.
- **Objectives & Key Results:** objective metrics, execution flow, evidence and the live objective states.
- **Live Operations:** the live tabs, metrics, event stream, agent network, agent health and execution flow.
- **Reviews:** the live Review outcomes/Feedback/Improvement/Learnings tabs, review period, COO status, outcome metrics, Wins, Misses and Improvement candidates.

- **Command & outcomes:** Home/COO chat, Digest, Objectives & Key Results, Workspace, Live Operations and Reviews.
- **Run the company:** My Org, Kanban, CRM, ERP, Marketing, Scheduled goals, Goal plans and Broadcast.
- **Knowledge & intelligence:** Knowledge/Master Data/RAG, Content Explorer, Policies, AI Snipper and Efficiency View.
- **Automation studio:** Workflows, Job profiles, Job workflows, Browser Session and Custom scripts.
- **People, agents & worlds:** AI Employees, AgentExchange, External AI/A2A, 3D Avatars and Published Scenes.
- **Tools & connections:** Tools, Connectors, MCP integrations, Events & Productivity, Company Channels and Messaging & IoT.
- **Specialized workspaces:** IBKR Summary plus IBKRNew Strategy, Summary and Live Operations.
- **Company settings:** Workspace Builder, Menu visibility, IP Whitelists, Tokens management, API Keys and profile/retention.
- **Platform administration:** Admin overview, User Insights, A2A logs, Crons, Models & routing, Documents RAG, Tools Onboarding, TLS certificates, AgentSystem recovery, Platform feedback, Promotions and MCP Universe.

CRM and ERP remain entitlement-controlled. Admin capabilities remain visible only to platform administrators. Employee users see the same information architecture filtered through their existing RBAC grants.

## End-to-end destination pattern

Every capability opens inside the same shell instead of feeling like a separate application:

1. **Context header:** company, role, active goal/task and environment.
2. **Spatial summary:** the minimum visual model needed for that capability.
3. **Conventional working surface:** table, form, board, editor or timeline for precise work.
4. **Evidence rail:** receipts, tool calls, activity and audit history.
5. **Persistent COO:** context-aware help and action creation without leaving the screen.
6. **Deep links preserved:** current URLs remain valid so bookmarks and notifications do not break.

## Review questions

- Can a CEO understand what the company is doing within five seconds?
- Is the next human decision obvious without opening Kanban?
- Does the spatial view clarify ownership, or feel decorative?
- Is the persistent COO panel useful at this width?
- Should the default home view be Company space, Execution flow, or a role-specific variant?
- Which current navigation items must remain one-click destinations?

## Non-negotiable implementation guardrails

- No WebGL requirement for core workflows; CSS depth is the baseline and Three.js is reserved for optional scenes.
- Keyboard navigation, semantic text, WCAG contrast and browser zoom must work independently of spatial effects.
- `prefers-reduced-motion` disables parallax and animated camera movement.
- Mobile uses a conventional stacked flow and bottom navigation rather than shrinking the 3D scene.
- Existing routes, RBAC, tool grants, APIs and deep links remain unchanged during a visual-shell migration.
