import test from "node:test";
import assert from "node:assert/strict";
import { openRepository } from "../src/repository.mjs";
import { createOwnerIdentity } from "../src/owner-identity.mjs";
import { createControlPlane } from "../src/control-plane.mjs";
import { SessionAuthority } from "../src/session-authority.mjs";
import { createLearningRuntime } from "../src/learning-runtime.mjs";
import { createLearningStore } from "../src/learning-store.mjs";
import { createSourceMap } from "../src/source-map.mjs";
test("F01: a fresh email-verified owner registration has no seeded help, maps or recipes; live inspection supplies required fields", async () => {
  const repository = openRepository();
  let mail, dns;
  try {
    const identity = createOwnerIdentity(repository, {
        send: async (message) => {
          mail = message;
        },
      }),
      challenge = await identity.start("synthetic-owner@example.test"),
      code = mail.text.match(/code is (\d{6})/)[1],
      actor = identity.authenticate(
        identity.confirm(challenge.email, challenge.challenge, code).cookie,
      ),
      authority = new SessionAuthority({ repository }),
      control = createControlPlane(repository, authority, {
        dns: async () => [[dns]],
      });
    const registration = control.register(actor, {
      origin: "https://fresh.example.test",
      environment: "staging",
    });
    assert.equal(control.list(actor)[0].status, "pending");
    dns = registration.dnsValue;
    await control.verify(actor, registration.id);
    control.approve(
      {
        id: "test-platform-approver",
        organizationId: "test-platform",
        role: "platform_admin",
      },
      registration.id,
    );
    const installation = control.activate(actor, registration.id),
      session = authority.initialize({
        ...installation,
        origin: "https://fresh.example.test",
      }),
      scope = authority.context({
        sessionToken: session.sessionToken,
        origin: "https://fresh.example.test",
      });
    for (const ns of ["sources", "screen_maps", "recipes"])
      assert.equal(repository.map(ns).values().length, 0);
    const learning = createLearningRuntime(
        repository,
        createLearningStore(repository),
      ),
      map = createSourceMap(repository),
      snapshot = {
        revision: 1,
        path: "/customer",
        fields: [
          {
            ref: "r1f0",
            key: "company_name",
            label: "Company name",
            type: "text",
            required: true,
            form: "customer_form",
          },
        ],
        forms: [
          { key: "customer_form", label: "Customer", fields: ["company_name"] },
        ],
        links: [],
      };
    assert.equal(map.guidance(scope, "customer", snapshot), null);
    learning.observe({ ...scope, role: "maintainer" }, snapshot);
    const saved = learning.maps({ ...scope, role: "maintainer" });
    assert.equal(saved[0].fields[0].required, true);
    assert.equal(repository.map("sources").values().length, 0);
  } finally {
    repository.close();
  }
});
