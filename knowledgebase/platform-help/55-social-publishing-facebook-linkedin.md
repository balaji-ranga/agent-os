# Social publishing: Facebook, LinkedIn, browser recipes, and connectors

## Quick answer

There are two supported ways to publish a social post from Flolah. Choose the route that matches the account and destination:

1. **Browser recipe** — use the Chrome extension or Desktop Browser Session worker when a person could publish through the website UI. This works for a Facebook profile or Page, LinkedIn, and other supported websites after you record and verify a recipe.
2. **Connector/API workflow** — use **Facebook / Meta Graph MCP** for a Facebook Page you manage. This is the preferred repeatable Page-publishing path. It does not publish to a personal Facebook timeline.

Both routes are governed by the employee's tool grants and **Policies → Action control**. Social publishing is an external-message action. If the resolved action is **Approval required**, Flolah creates an approval item and resumes the same browser or workflow operation only through the applicable bounded approval grant. **Prohibited** always blocks it.

## Route A — publish through a saved browser recipe

Use this route for website UI publishing, including a personal-profile destination, or when the provider API is not available.

### One-time setup

1. Open **Browser Session** (`/browser-session`).
2. Start either:
   - the **Flolah Chrome extension**, then allow the exact Facebook or LinkedIn tab; or
   - the **Desktop Browser Session worker** from **Connectors**, then sign in inside its persistent browser window.
3. Confirm the selected browser route shows **Online**.
4. In **Workspace → Tool access**, grant the publishing employee:
   - `browse_session_status`
   - `browse_recipe_list`
   - `browse_recipe_run`
   - recording or autonomous browser tools only when that employee also needs them.
5. Record the complete posting sequence. Make the body a required input named **`post_content`**. Include the final Publish/Post action and the visible success check.
6. Save and publish the recipe for this CEO. Test it once with harmless, clearly labelled content.

For the built-in verified recipes, typical names are **Facebook verified dynamic post** and **LinkedIn verified dynamic post**. An agent must list recipes and use the returned name or id; it must not invent a recipe name.

### Ask an employee or COO to run it

Use a precise request such as:

> Use my saved Facebook verified dynamic post recipe through the Desktop Browser Session worker. Set `post_content` to “Demo post to validate agent automation”. Publish exactly once and report the durable confirmation. Do not fall back to another browser driver.

The employee should call `browse_session_status`, then `browse_recipe_list`, then `browse_recipe_run` with the exact `recipe_name` and `inputs.post_content`. It should poll `browse_task_status` and report the actual terminal state. Opening a composer, clicking a button, or closing a dialog is not proof of publication.

### Chrome extension versus Desktop worker

- If the request names a driver, Flolah should use that driver with fallback disabled.
- If no driver is named, routing uses the available compatible executor. To avoid ambiguity when both are online, name **Chrome extension** or **Desktop Browser Session worker**.
- The Chrome extension only controls tabs explicitly allowed in the extension. The Desktop worker uses its own persistent browser profile.

## Route B — publish a Facebook Page through Meta Graph MCP

Use this route for a Facebook **Page** managed by the connected Meta account.

1. Open **Connectors → MCPs → Facebook / Meta Graph** and complete **Connect with OAuth**.
2. Confirm the Meta app has the required Page permissions and that the Page is returned by `get_my_pages` / `/me/accounts`.
3. Note the Page ID returned by Graph. Do not use a personal `profile.php?id=…` id.
4. Use one of these execution paths:
   - run the published **`content-publish-social`** workflow with `platform=facebook`, `page_id`, and the approved post body; or
   - add an **MCP tool** node to a workflow, select server `mcp-meta-graph`, action `create_page_post`, and bind `page_id` plus the message from prior workflow input.
5. Give the executing employee the relevant workflow/MCP action grant and allow the resolved external-message action under **Policies → Action control**.
6. Verify the provider response and the resulting Page post. Do not treat an accepted request without a provider post id or durable confirmation as success.

For a recurring content operation, use the **content_creator** company pack: content production and review feed the publish workflow; community workflows can ingest comments and prepare replies for approval.

## Which route should I use?

- **Facebook personal profile:** browser recipe.
- **Facebook Page:** Meta Graph MCP/workflow is preferred; browser recipe is an explicit fallback.
- **LinkedIn:** saved browser recipe, or a connected certified connector action when available for the required LinkedIn account.
- **A new website:** record and verify a browser recipe first. A provider-specific API adapter is needed only for direct API publishing; the generic browser task, policy, approval, executor, and recipe contracts are reused.
- **Read-only feed or notifications:** use a read-only browser goal or recipe. Do not run a posting recipe for a read request.

## Common failures

### Platform Help says there is no evidence

Ask with the destination and route, for example **“How do I publish a Facebook Page post with MCP?”** or **“How do I create a Facebook post with a browser recipe?”** Platform Help indexes both the curated help corpus and the public static guide. If neither route appears, an administrator should rebuild/reindex Platform Help rather than inventing steps.

### Recipe opens the composer but does not publish

- Confirm the latest extension/worker version is online.
- Confirm the saved recipe includes the final submit action and a durable post-publication check.
- Supply every required input, especially `post_content`.
- Confirm the requested browser driver owns the allowed/logged-in tab.
- Check **Policies → Action control** and Kanban for a waiting approval.
- Do not automatically retry a potentially successful publish; verify first to prevent duplicates.

### “Selected capability is not owned by the selected executor”

The prompt forced a browser executor that does not own the selected browser capability. Ask for the route in product terms and keep it consistent, for example:

> Use my saved Facebook publishing recipe through the Chrome extension. Publish this exact content once: “…”.

Do not mix “Chrome extension,” “Desktop worker,” and a different executor in one request.

### Facebook MCP does not show my destination

Meta Graph Page publishing only sees Pages managed by the connected account and permitted by the Meta app. Reconnect the correct account, inspect `get_my_pages`, and confirm permissions. A personal profile is not a Page-publishing destination; use the browser route.

## Related help

- [Browser Session and recipes](./22-browser-session-and-recipes.md)
- [Content creator operations](./30-content-creator-ops.md)
- [MCP connector OAuth](./31-mcp-connectors-oauth.md)
- [Policies and Action control](./10-policies-guardrails.md)
- [Workflow building](./06-workflows-building.md)

