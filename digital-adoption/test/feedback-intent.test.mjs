import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformPlanner } from "../src/platform-model.mjs";
import {
  readOnlyIntent,
  booleanIntent,
  groundedValue,
} from "../src/task-intent.mjs";
const snapshot = {
  revision: 1,
  path: "/customer",
  fields: [
    { ref: "r1f0", label: "Shipping method", type: "select-one" },
    { ref: "r1f1", label: "Include gift wrap", type: "checkbox" },
  ],
};
test("F04: mixed dropdown/checkbox request reaches semantic planning with both fresh fields", async () => {
  let task;
  const planner = createPlatformPlanner({
    gatewayUrl: "https://model.example.test/plan",
    serviceToken: "test-service-token-with-at-least-thirty-two-characters",
    fetchImpl: async (url, init) => {
      task = JSON.parse(JSON.parse(init.body).messages[1].content);
      return {
        ok: true,
        json: async () => ({
          content: JSON.stringify({
            message: "Review Express shipping and gift wrap.",
            actions: [
              { type: "fill", ref: "r1f0", value: "Express" },
              { type: "fill", ref: "r1f1", value: "true" },
            ],
          }),
        }),
      };
    },
  });
  const result = await planner({
    text: "Set Shipping method to Express and select Include gift wrap. Do not save.",
    snapshot,
  });
  assert.deepEqual(
    result.actions.map((a) => a.value),
    ["Express", "true"],
  );
  assert.equal(task.observed.fields.length, 2);
  assert.equal(
    booleanIntent("select Include gift wrap.", snapshot.fields[1]),
    "true",
  );
  assert.equal(
    booleanIntent("Uncheck Include gift wrap.", snapshot.fields[1]),
    "false",
  );
  assert.equal(
    groundedValue("true", snapshot.fields[1], ["select Include gift wrap."]),
    true,
  );
  assert.equal(booleanIntent("Do not select Include gift wrap.",snapshot.fields[1]),null);
  assert.equal(readOnlyIntent("Inspect the form. Do not select Include gift wrap."),true);
  assert.equal(groundedValue("true",snapshot.fields[1],["Do not select Include gift wrap."]),false);
});
test("F10: summary/no-fill constraints prevent model effects and do not activate repair fallback", async () => {
  let calls = 0;
  const planner = createPlatformPlanner({
    gatewayUrl: "https://model.example.test/plan",
    serviceToken: "test-service-token-with-at-least-thirty-two-characters",
    fetchImpl: async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({
          content: JSON.stringify({
            message: "Summary only.",
            actions: [{ type: "fill", ref: "r1f0", value: "Express" }],
          }),
        }),
      };
    },
  });
  const text = "Summarize my attachment. Do not fill or submit anything.";
  assert.equal(readOnlyIntent(text), true);
  const result = await planner({
    text,
    snapshot,
    privateGuidance: { evidence: [{ text: "Shipping method: Express" }] },
  });
  assert.deepEqual(result.actions, []);
  assert.equal(calls, 1);
});
