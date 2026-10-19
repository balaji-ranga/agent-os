// Adapter integration against real browser/framework state; separate from LLM UX UAT.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.ADOPTION_PLAYWRIGHT_MODULE ||
    "./frameworks/node_modules/playwright/index.mjs"
);
const origin = process.env.ADOPTION_FIXTURE_ORIGIN || "http://127.0.0.1:4194";
if (origin !== "http://127.0.0.1:4194")
  throw new Error("This synthetic write test is loopback-only");
const out = new URL("../.local/feedback-controls/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  results = [];
context.setDefaultTimeout(12000);
const p = await context.newPage();
const check = async (id, fn) => {
  try {
    await fn();
    results.push({ id, status: "passed" });
  } catch (error) {
    results.push({ id, status: "failed", error: error.message });
    throw error;
  }
};
async function inspect() {
  return p.evaluate(async () => {
    window.adapter ||= (await import("/fixtures/web/dom.mjs")).createInspector(
      document,
    );
    window.observed = window.adapter.snapshot();
    return window.observed;
  });
}
async function fill(label, value) {
  const snapshot = await inspect(),
    field = snapshot.fields.find(
      (f) => f.label.toLowerCase() === label.toLowerCase(),
    );
  assert.ok(field, `Observed field: ${label}`);
  const result = await p.evaluate(async (input) => window.adapter.fill(input), {
    ref: field.ref,
    value,
    expectedRevision: snapshot.revision,
    approved: true,
  });
  assert.equal(result.valueObserved, true, `Observed write: ${label}`);
}
try {
  await p.goto(origin + "/customer");
  await p.getByRole("button",{name:"Decline analytics",exact:true}).click({timeout:4000}).catch(()=>{});
  await p
    .getByRole("button", { name: "Add native controls", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Add complex controls", exact: true })
    .click();
  await check(
    "F03_NATIVE_SELECT_CHECKBOX_RADIO_MULTISELECT_DATALIST",
    async () => {
      await fill("Shipping method", "Express");
      await fill("Include gift wrap", "true");
      await fill("Delivery preference", "Store pickup");
      await fill("Interests", '["Analytics","Inventory"]');
      await fill("Suggested city", "Singapore");
      assert.equal(
        await p.locator("[name=shipping_method]").inputValue(),
        "express",
      );
      assert.equal(await p.locator("[value=pickup]").isChecked(), true);
      assert.deepEqual(
        await p.locator("[name=interests] option:checked").allTextContents(),
        ["Analytics", "Inventory"],
      );
    },
  );
  await check("F05_ASYNC_PICKLIST_AND_DEPENDENT_CONTROL", async () => {
    await fill("Account search", "Orchid Trading");
    await p
      .getByText("Account selected; contacts available.", { exact: true })
      .waitFor();
    await fill("Contact", "Billing contact");
    assert.equal(
      await p.locator("[name=account_contact]").inputValue(),
      "Billing contact",
    );
  });
  await check('F05_PICKLIST_LOADING_EMPTY_ERROR_AMBIGUITY_AND_RECOVERY', async () => {
    const search=p.locator('[name=account_search]'),contact=p.locator('[name=account_contact]');
    for(const mode of ['empty','error','ambiguous']){
      await p.locator('#lookup-mode').selectOption(mode);
      const snapshot=await inspect(),field=snapshot.fields.find(f=>f.label==='Account search');
      // Catch immediately so the deliberately refused asynchronous selection is observed.
      const outcome=p.evaluate(async input=>{try{await window.adapter.fill(input);return {ok:true};}catch(error){return {ok:false,error:error.message};}},{ref:field.ref,value:'Orchid Trading',expectedRevision:snapshot.revision,approved:true});
      await p.locator('#picklist-status').getByText('Loading accounts…',{exact:true}).waitFor();
      assert.equal(await contact.isDisabled(),true);
      await p.locator('#picklist-status').getByText(mode==='empty'?'No accounts found':mode==='error'?'Account lookup failed. Try again.':'Choose an account',{exact:true}).waitFor();
      const result=await outcome;assert.equal(result.ok,false);
      assert.match(result.error,mode==='ambiguous'?/ambiguous/:/No option was selected/);
      assert.equal(await search.getAttribute('data-selected-account'),null);
      assert.equal(await contact.isDisabled(),true);
      await p.screenshot({path:new URL(`picklist-${mode}-refused.png`,out).pathname.replace(/^\/C:/,'C:'),fullPage:false});
    }
    await p.locator('#lookup-mode').selectOption('normal');
    await fill('Account search','Copper Supply');await fill('Contact','Primary contact');
    assert.equal(await search.getAttribute('data-selected-account'),'Copper Supply');
    assert.equal(await contact.isDisabled(),false);
  });
  await check(
    "F05_EDITABLE_TABLE_ROW_FILTER_SORT_PAGINATION_DYNAMIC_ROW",
    async () => {
      await fill("Item 2 quantity", "7");
      await fill('Select Item 2','true');
      assert.equal(await p.locator("[name=line_2_quantity]").inputValue(), "7");
      await p.getByRole("button", { name: "Next rows", exact: true }).click();
      await fill("Item 5 quantity", "9");
      await p.getByRole("button", { name: "Add line", exact: true }).click();
      await fill("Item 7 quantity", "3");
      await p.getByLabel("Table filter", { exact: true }).fill("Item 1");
      await fill("Item 1 quantity", "4");
      await p.getByLabel("Table filter", { exact: true }).fill("");
      await p.getByRole("button", { name: "Sort rows", exact: true }).click();
      await fill("Item 7 quantity", "8");
      await fill('Delivery date','2026-11-12');
      assert.equal(await p.locator('[name=delivery_date]').inputValue(),'2026-11-12');
      await assert.rejects(fill('Item 7 quantity','0'),/constraint|minimum|range|invalid/i);
      assert.equal(await p.locator('[name=line_7_quantity]').inputValue(),'8');
      const constrained=await inspect(),quantity=constrained.fields.find(f=>f.label==='Item 7 quantity');
      await p.locator('[name=line_7_quantity]').evaluate(e=>e.min='10');
      await assert.rejects(p.evaluate(input=>window.adapter.fill(input),{ref:quantity.ref,value:'11',expectedRevision:constrained.revision,approved:true}),/constraints changed/);
      await p.locator('[name=line_7_quantity]').evaluate(e=>e.min='1');
    },
  );
  await check("F05_MODAL_SCOPE", async () => {
    await p
      .getByRole("button", { name: "Edit delivery instructions", exact: true })
      .click();
    const snapshot = await inspect();
    assert.equal(snapshot.fields.length, 1);
    await fill("Delivery instructions", "Leave at reception");
    await p.getByRole("button", { name: "Done", exact: true }).click();
  });
  await check(
    "F05_TABLE_MODEL_AND_MULTISELECT_INDEPENDENT_READBACK",
    async () => {
      await fill("Company name", "Synthetic controls");
      await fill("Contact email", "controls@example.test");
      await fill("Region", "Singapore");
      await p
        .getByRole("button", { name: "Save synthetic record", exact: true })
        .click();
      await p
        .locator("#result")
        .getByText(/Saved synthetic record/)
        .waitFor();
      const data = await (
          await context.request.get(origin + "/api/records")
        ).json(),
        record = data.records.at(-1),
        lines = JSON.parse(record.values.line_items);
      for (const [id, quantity] of [
        [1, 4],
        [2, 7],
        [5, 9],
        [7, 8],
      ])
        assert.equal(lines.find((l) => l.id === id).quantity, quantity);
      assert.equal(lines.find(l=>l.id===2).selected,true);
      assert.deepEqual(JSON.parse(record.values.interests), [
        "analytics",
        "inventory",
      ]);
    },
  );
  await check("F03_STALE_REVIEW_REJECTS_CHANGED_OPTIONS", async () => {
    const snapshot = await inspect(),
      field = snapshot.fields.find((f) => f.label === "Shipping method");
    await p.locator("[name=shipping_method]").selectOption("standard");
    await assert.rejects(
      p.evaluate((input) => window.adapter.fill(input), {
        ref: field.ref,
        value: "Express",
        expectedRevision: snapshot.revision,
        approved: true,
      }),
      /changed/,
    );
  });
  await p.screenshot({
    path: new URL("native-complex.png", out).pathname.replace(/^\/C:/, "C:"),
    fullPage: false,
  });
  await check("F02_F07_GENERIC_BUSY_DUPLICATE_GUARD_AND_NOTICE", async () => {
    await p.evaluate(async () => {
      const { createActionFeedback } =
        await import("/fixtures/web/action-feedback.mjs");
      window.feedback = createActionFeedback(document);
      const b = document.createElement("button");
      b.id = "busy-fixture";
      b.textContent = "Synthetic async action";
      window.actionCount = 0;
      b.onclick = async () => {
        window.actionCount++;
        await window.feedback.track(
          new Promise((resolve) => setTimeout(resolve, 1000)),
        );
      };
      document.body.append(b);
    });
    await p.locator("#busy-fixture").dblclick();
    await p.locator("#busy-fixture[aria-busy=true]").waitFor();
    await p.screenshot({path:new URL('action-working.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:false});
    assert.equal(await p.evaluate(() => window.actionCount), 1);
    await p.locator("#busy-fixture:not([aria-busy])").waitFor();
    assert.equal(await p.locator("#busy-fixture").isEnabled(), true);
    await p
      .locator("#action-notice")
      .getByText(/response received/)
      .waitFor();
    await p.screenshot({path:new URL('action-completed.png',out).pathname.replace(/^\/C:/,'C:'),fullPage:false});
    await p
      .locator("#action-notice")
      .waitFor({ state: "hidden", timeout: 4000 });
    await p.evaluate(() => {
      const b=document.createElement('button');b.id='removed-action';b.textContent='Confirm removed action';
      b.onclick=async()=>{await window.feedback.track(Promise.resolve());b.remove();};document.body.append(b);
    });
    await p.locator('#removed-action').click();
    await p.locator('#action-notice').waitFor({state:'hidden',timeout:4000});
    await p.evaluate(()=>window.feedback.track(Promise.resolve('background presence')));
    assert.equal(await p.locator('#action-notice').isVisible(),false);
    assert.equal(await p.locator('#action-notice').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
  });
  for (const framework of ["react", "angular"])
    await check(
      `F03_${framework.toUpperCase()}_APPLICATION_STATE_AND_INDEPENDENT_SAVE`,
      async () => {
        await p.goto(origin + "/framework-" + framework);
        await p.getByLabel("Customer name", { exact: true }).waitFor();
        await fill("Customer name", `Synthetic ${framework}`);
        await fill("Include gift wrap", "true");
        await fill("Shipping method", "Express");
        await fill("Contact preference", "Phone");
        const state = JSON.parse(
          await p
            .getByLabel(
              `${framework === "react" ? "React" : "Angular"} application state`,
            )
            .innerText(),
        );
        assert.deepEqual(state, {
          name: `Synthetic ${framework}`,
          gift: true,
          shipping: "express",
          contact: "phone",
        });
        await p
          .getByRole("button", { name: "Save framework record", exact: true })
          .click();
        await p
          .locator("#saved")
          .getByText(/Synthetic/)
          .waitFor();
        const saved = JSON.parse(await p.locator("#saved").innerText());
        const readback = await (
          await context.request.get(origin + "/api/records")
        ).json();
        assert.ok(
          readback.records.some(
            (r) =>
              r.id === saved.id &&
              r.values.name === `Synthetic ${framework}` &&
              r.values.gift === "true" &&
              r.values.shipping === "express" &&
              r.values.contact === "phone",
          ),
        );
        await p.screenshot({
          path: new URL(`${framework}-state-saved.png`, out).pathname.replace(
            /^\/C:/,
            "C:",
          ),
          fullPage: false,
        });
      },
    );
} finally {
  await writeFile(
    new URL("results.json", out),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope: origin,
        kind: "real browser adapter/framework integration; not model end-to-end",
        results,
      },
      null,
      2,
    ),
  );
  await browser.close();
  console.log(JSON.stringify(results));
}
