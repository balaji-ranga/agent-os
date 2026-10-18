import React from "react";
import { createRoot } from "react-dom/client";
const h = React.createElement;
function Fixture() {
  const [model, setModel] = React.useState({
    name: "",
    gift: false,
    shipping: "standard",
    contact: "email",
  });
  const update = (key, value) => setModel((m) => ({ ...m, [key]: value }));
  return h(
    "form",
    {
      onSubmit: async (event) => {
        event.preventDefault();
        const result = await fetch("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: location.pathname,
            operationId: crypto.randomUUID(),
            values: Object.fromEntries(
              Object.entries(model).map(([k, v]) => [k, String(v)]),
            ),
          }),
        });
        document.querySelector("#saved").textContent = JSON.stringify(
          await result.json(),
        );
      },
    },
    h(
      "label",
      null,
      "Customer name",
      h("input", {
        name: "name",
        value: model.name,
        onChange: (e) => update("name", e.target.value),
      }),
    ),
    h(
      "label",
      null,
      "Include gift wrap",
      h("input", {
        type: "checkbox",
        name: "gift",
        checked: model.gift,
        onChange: (e) => update("gift", e.target.checked),
      }),
    ),
    h(
      "label",
      null,
      "Shipping method",
      h(
        "select",
        {
          name: "shipping",
          value: model.shipping,
          onChange: (e) => update("shipping", e.target.value),
        },
        h("option", { value: "standard" }, "Standard"),
        h("option", { value: "express" }, "Express"),
      ),
    ),
    h(
      "fieldset",
      null,
      h("legend", null, "Contact preference"),
      ...["email", "phone"].map((value) =>
        h(
          "label",
          { key: value },
          value,
          h("input", {
            type: "radio",
            name: "contact",
            value,
            checked: model.contact === value,
            onChange: (e) => update("contact", e.target.value),
          }),
        ),
      ),
    ),
    h(
      "output",
      { "aria-label": "React application state" },
      JSON.stringify(model),
    ),
    h("button", null, "Save framework record"),
  );
}
createRoot(document.querySelector("#framework-root")).render(h(Fixture));
