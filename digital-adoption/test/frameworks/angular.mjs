import "@angular/compiler";
import { Component, provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { FormsModule } from "@angular/forms";
class Fixture {
  model = { name: "", gift: false, shipping: "standard", contact: "email" };
  get state() {
    return JSON.stringify(this.model);
  }
  async save() {
    const response = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: location.pathname,
        operationId: crypto.randomUUID(),
        values: Object.fromEntries(
          Object.entries(this.model).map(([k, v]) => [k, String(v)]),
        ),
      }),
    });
    document.querySelector("#saved").textContent = JSON.stringify(
      await response.json(),
    );
  }
}
Component({
  selector: "framework-root",
  standalone: true,
  imports: [FormsModule],
  template: `<form (ngSubmit)="save()"><label>Customer name<input name="name" [(ngModel)]="model.name"></label><label>Include gift wrap<input type="checkbox" name="gift" [(ngModel)]="model.gift"></label><label>Shipping method<select name="shipping" [(ngModel)]="model.shipping"><option value="standard">Standard</option><option value="express">Express</option></select></label><fieldset><legend>Contact preference</legend><label>Email<input type="radio" name="contact" value="email" [(ngModel)]="model.contact"></label><label>Phone<input type="radio" name="contact" value="phone" [(ngModel)]="model.contact"></label></fieldset><output aria-label="Angular application state">{{state}}</output><button>Save framework record</button></form>`,
})(Fixture);
bootstrapApplication(Fixture, {
  providers: [provideZonelessChangeDetection()],
}).catch((error) => {
  document.querySelector("#saved").textContent = error.message;
});
