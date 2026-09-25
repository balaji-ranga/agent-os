---
title: Social publishing
---

# Social publishing

Flolah supports two publishing routes. Use a **browser recipe** when you need the website UI, including a personal-profile destination. Use **Facebook / Meta Graph MCP** for repeatable publishing to a Facebook Page you manage.

## Publish with a browser recipe

1. Open **Browser Session** and bring either the Chrome extension or Desktop Browser Session worker online.
2. Sign in to the destination website. For the extension, allow the exact tab Flolah may control.
3. Record the complete posting sequence and save the post body as required input **`post_content`**.
4. Make sure the employee has `browse_session_status`, `browse_recipe_list`, and `browse_recipe_run` under **Workspace → Tool access**.
5. Ask the employee or COO to list and run the saved recipe with the exact content. Name the browser route when both extension and desktop worker are online.
6. Check the terminal task result. An opened composer or closed dialog is not proof that the post was published.

Example request:

> Use my saved Facebook verified dynamic post recipe through the Desktop Browser Session worker. Set `post_content` to “Demo post to validate agent automation”. Publish exactly once and report the durable confirmation. Do not fall back to another browser driver.

The same recipe pattern can be recorded for LinkedIn or a new website. Provider-specific direct API publishing may still need an adapter, but the browser executor, recipe inputs, policy checks, approval, and verification model are shared.

## Publish a Facebook Page with MCP

1. Open **Connectors → MCPs → Facebook / Meta Graph** and complete OAuth.
2. Confirm the Page is returned by the connected account and note its Graph Page ID.
3. Run the published **`content-publish-social`** workflow with `platform=facebook`, `page_id`, and the approved body; or add an **MCP tool** workflow node using server `mcp-meta-graph` and action `create_page_post`.
4. Give the employee the required workflow/MCP action grant.
5. Verify the provider result and resulting Page post.

Meta Graph posts to managed **Pages**, not personal Facebook timelines. Use a browser recipe for a personal-profile destination.

## Approval and safety

Social publishing is an external-message action governed by **Policies → Action control**. **Approval required** creates an approval item before the governed action can continue. **Prohibited** blocks it. Tool grants and connector authorization are also required; policy approval does not grant a missing tool or OAuth connection.

Never automatically retry an uncertain publish. Verify first so a delayed confirmation cannot produce a duplicate post.

## Troubleshooting

- **Recipe only opens the composer:** confirm the recipe includes final submit and visible success verification, all required inputs were supplied, and the latest worker or extension is online.
- **Wrong browser route:** explicitly name Chrome extension or Desktop Browser Session worker and request no fallback.
- **Waiting:** check Kanban for Action control approval and Browser Session for task state.
- **Facebook Page absent:** reconnect the correct Meta account and confirm the app's Page permissions.
- **Read request opened a composer:** run a read-only feed/notification recipe or goal, not a publish recipe.

See [Browser Session](./browser-session.md), [Connectors and MCP](./connectors-and-mcp.md), [Workflows](./workflows.md), and [Policies](./policies.md).

