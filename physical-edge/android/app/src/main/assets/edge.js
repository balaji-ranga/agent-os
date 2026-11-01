(() => {
  // physical-edge/android/js/crypto.js
  var randomUUID = () => NativeEdge.uuid();
  var createHash = () => {
    let input = "";
    return { update(text) {
      input += text;
      return this;
    }, digest() {
      return NativeEdge.sha256(input);
    } };
  };

  // physical-edge/android/js/events.js
  var EventEmitter = class {
    constructor() {
      this.listeners = {};
    }
    on(t, f) {
      (this.listeners[t] ||= []).push(f);
      return this;
    }
    once(t, f) {
      const g = (...a) => {
        this.off(t, g);
        f(...a);
      };
      return this.on(t, g);
    }
    off(t, f) {
      this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f);
      return this;
    }
    emit(t, ...a) {
      for (const f of this.listeners[t] || []) f(...a);
    }
  };

  // physical-edge/android/js/ws.js
  var sockets = /* @__PURE__ */ new Map();
  window.nativeSocketEvent = (id2, type, data) => {
    const s = sockets.get(id2);
    if (!s) return;
    if (type === "open") s.readyState = 1;
    if (type === "close") {
      s.readyState = 3;
      sockets.delete(id2);
    }
    s.emit(type, type === "message" ? data : void 0);
  };
  var WebSocket = class extends EventEmitter {
    static OPEN = 1;
    constructor(url, options = {}) {
      super();
      this.id = NativeEdge.uuid();
      this.readyState = 0;
      sockets.set(this.id, this);
      NativeEdge.open(this.id, url, JSON.stringify(options.headers || {}));
    }
    send(message) {
      NativeEdge.send(this.id, message);
    }
    close() {
      NativeEdge.close(this.id);
    }
  };

  // backend/src/services/physical/contracts.js
  var VERSION = 1;
  var TERMINAL = /* @__PURE__ */ new Set(["completed", "failed", "cancelled", "timed_out", "uncertain", "denied"]);
  var id = (value) => {
    if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)) throw fault("Invalid identifier");
    return value;
  };
  function fault(message, status = 400) {
    return Object.assign(new Error(message), { status });
  }
  function object(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw fault("Expected object");
    return value;
  }
  function hash(value) {
    return createHash("sha256").update(value).digest("hex");
  }
  function fingerprint(value) {
    const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
    return hash(JSON.stringify(canonical(value)));
  }
  function validateInput(schema, value) {
    if (schema.type === "object") {
      object(value);
      if (Object.keys(value).some((k) => !Object.hasOwn(schema.properties || {}, k))) throw fault("Unsupported input field");
      for (const k of schema.required || []) if (!Object.hasOwn(value, k)) throw fault("Missing input: " + k);
      for (const [k, v] of Object.entries(value)) validateInput(schema.properties[k], v);
    } else {
      if (!["boolean", "string", "number", "integer"].includes(schema.type)) throw fault("Unsupported schema type");
      if (schema.type === "integer" ? !Number.isSafeInteger(value) : typeof value !== schema.type) throw fault("Input type mismatch");
      if (typeof value === "number" && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw fault("Input outside bounds");
      if (typeof value === "string" && (value.length > (schema.maxLength ?? 256) || value.length < (schema.minLength ?? 0))) throw fault("Input length outside bounds");
      if (schema.enum && !schema.enum.includes(value)) throw fault("Unsupported input value");
    }
    return value;
  }
  function validateDescription(td) {
    object(td);
    id(td.id);
    if (td["@context"] !== "https://www.w3.org/2022/wot/td/v1.1" || typeof td.title !== "string" || td.title.length > 200) throw fault("Invalid WoT profile");
    if (!["PhysicalDevice", "PhysicalAgent"].includes(td.flolah?.kind) || typeof td.flolah?.simulated !== "boolean") throw fault("Missing physical identity metadata");
    object(td.properties);
    object(td.actions);
    if (Object.keys(td.actions).length > 32 || Object.keys(td.properties).length > 32) throw fault("Too many capabilities");
    for (const [name, spec] of Object.entries(td.actions)) {
      id(name);
      if (!["routine", "approval_required", "prohibited"].includes(spec.risk) || spec.input?.type !== "object" || typeof spec.task !== "boolean") throw fault("Invalid action specification");
      if (spec.task && td.flolah.kind !== "PhysicalAgent") throw fault("Device cannot own tasks");
      if (!spec.expected || typeof spec.expected.property !== "string" || !Object.hasOwn(td.properties, spec.expected.property)) throw fault("Action requires observable evidence contract");
      if (spec.expected.input ? !Object.hasOwn(spec.input.properties || {}, spec.expected.input) : !Object.hasOwn(spec.expected, "value")) throw fault("Evidence must name an input or literal expected value");
      if (spec.task && (!td.flolah.taskLifecycle?.progress || !td.flolah.taskLifecycle?.outcomes)) throw fault("PhysicalAgent requires task lifecycle evidence");
    }
    for (const [name, spec] of Object.entries(td.properties)) {
      id(name);
      if (!["string", "number", "boolean", "integer"].includes(spec.type)) throw fault("Invalid property type");
    }
    return td;
  }
  function profile(entityId, kind = "switch") {
    id(entityId);
    const td = {
      "@context": "https://www.w3.org/2022/wot/td/v1.1",
      id: entityId,
      title: entityId,
      securityDefinitions: { flolah_sc: { scheme: "bearer", in: "header" } },
      security: ["flolah_sc"],
      flolah: { kind: kind === "robot" ? "PhysicalAgent" : "PhysicalDevice", simulated: true, profile: kind, version: VERSION },
      properties: {},
      actions: {},
      events: {}
    };
    if (kind === "switch") {
      td.properties = { on: { type: "boolean" } };
      td.actions = { set_state: { risk: "routine", task: false, input: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] }, expected: { property: "on", input: "on" } } };
    } else if (kind === "tv") {
      td.properties = { on: { type: "boolean" }, app: { type: "string" }, channel: { type: "integer" }, last_navigation: { type: "string" } };
      const action = (properties, required, expected) => ({ risk: "routine", task: false, input: { type: "object", properties, required }, expected });
      td.actions = {
        set_power: action({ on: { type: "boolean" } }, ["on"], { property: "on", input: "on" }),
        launch_app: action({ app: { type: "string", minLength: 1, maxLength: 96 } }, ["app"], { property: "app", input: "app" }),
        select_channel: action({ channel: { type: "integer", minimum: 1, maximum: 9999 } }, ["channel"], { property: "channel", input: "channel" }),
        navigate: action({ command: { type: "string", enum: ["DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT", "DPAD_CENTER", "BACK", "HOME"] } }, ["command"], { property: "last_navigation", input: "command" })
      };
    } else if (kind === "sensor") td.properties = { temperature: { type: "number" } };
    else if (kind === "robot") {
      td.flolah.taskLifecycle = { progress: true, outcomes: true, cancellation: true };
      td.properties = { task_state: { type: "string" } };
      td.actions = { clean_area: { risk: "approval_required", task: true, input: { type: "object", properties: { areaId: { type: "string", minLength: 1, maxLength: 64 } }, required: ["areaId"] }, expected: { property: "task_state", value: "completed" } } };
    } else throw fault("Unsupported profile");
    return validateDescription(td);
  }
  function validateCommand(command, entity, now = Date.now()) {
    object(command);
    id(command.id);
    id(command.entityId);
    id(command.action);
    if (command.entityId !== entity.id || command.descriptionHash !== fingerprint(entity.description)) throw fault("Capability version mismatch", 409);
    const spec = entity.description.actions[command.action];
    if (!spec) throw fault("Unsupported capability");
    if (spec.risk === "prohibited" || command.authorized !== true || command.expiresAt <= now || command.expiresAt > now + 3e5) throw fault("Invalid or expired authority", 403);
    validateInput(spec.input, command.input);
    return spec;
  }

  // physical-edge/src/gateway.js
  var EdgeGateway = class {
    constructor(config2, store2, adapters) {
      this.config = config2;
      this.store = store2;
      this.state = store2.load() || { configuration: null, journal: {}, events: [], offlineUses: {} };
      this.adapters = adapters;
      this.bindings = /* @__PURE__ */ new Map();
      this.connected = false;
      this.closed = false;
      const u = new URL(config2.cloudUrl);
      if (u.username || u.password || u.search || u.hash) throw fault("Cloud URL must not contain credentials, query or fragment");
      if (u.protocol !== "wss:" && !(config2.allowInsecureLocal === true && u.protocol === "ws:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))) throw fault("Cloud connection requires WSS");
      if (!config2.hubId || !config2.token) throw fault("Hub credentials required");
      for (const [adapterId, a] of Object.entries(adapters)) {
        id(adapterId);
        a.on("event", (e) => this.onEvent(adapterId, e));
      }
    }
    save() {
      this.store.save(this.state);
    }
    record(event) {
      if (this.state.events.length >= 1e4) throw fault("Event journal full; refusing new work", 503);
      const envelope = { ...event, eventId: randomUUID() };
      this.state.events.push(envelope);
      this.save();
      this.send({ type: "event", event: envelope });
    }
    send(message) {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    }
    adapterDescription(adapterId, d) {
      return { ...d, flolah: { ...d.flolah, adapter: { id: adapterId, version: this.adapters[adapterId].constructor.manifest.version } } };
    }
    descriptions() {
      const all = [];
      this.bindings.clear();
      for (const [adapterId, a] of Object.entries(this.adapters)) for (const raw of a.discover()) {
        const d = this.adapterDescription(adapterId, raw);
        validateDescription(d);
        if (this.bindings.has(d.id)) throw fault("Ambiguous device identity across adapters");
        this.bindings.set(d.id, adapterId);
        all.push(d);
      }
      return all;
    }
    async start() {
      for (const adapter of Object.values(this.adapters)) await adapter.start();
      this.connect();
      return this;
    }
    connect() {
      if (this.closed) return;
      this.socket = new WebSocket(this.config.cloudUrl, { headers: { Authorization: "Bearer " + this.config.token, "X-Flolah-Hub": this.config.hubId }, maxPayload: 1024 * 1024 });
      this.socket.on("error", () => {
      });
      this.socket.on("message", (raw) => {
        try {
          this.handle(JSON.parse(raw)).catch(() => this.socket.close(4002, "Invalid hub message"));
        } catch {
          this.socket.close(4002, "Malformed hub message");
        }
      });
      this.socket.on("close", () => {
        this.connected = false;
        if (!this.closed) {
          this.reconnect = setTimeout(() => this.connect(), 500);
        }
      });
    }
    async handle(message) {
      if (message.type === "configuration") {
        if (message.version !== VERSION || message.hubId !== this.config.hubId || message.siteId !== this.config.siteId || message.leaseExpiresAt <= Date.now() || message.leaseExpiresAt > Date.now() + 12e4) throw fault("Invalid hub configuration");
        const descriptions = this.descriptions();
        for (const entity of message.entities) {
          validateDescription(entity.description);
          if (entity.descriptionHash !== fingerprint(entity.description)) throw fault("Description hash mismatch");
        }
        this.state.configuration = message;
        this.save();
        this.connected = true;
        this.send({ type: "discover", descriptions });
        for (const e of message.entities) {
          const adapterId = this.bindings.get(e.id), adapter = this.adapters[adapterId];
          if (!adapter) continue;
          if (adapter.refresh) await adapter.refresh(e.id);
          else for (const property of Object.keys(e.description.properties)) {
            const observed = adapter.readProperty(e.id, property);
            if (observed) this.onEvent(adapterId, { type: "observation", entityId: e.id, property, ...observed });
          }
        }
        for (const event of this.state.events) this.send({ type: "event", event });
        for (const pending of message.pending) {
          const record = this.state.journal[pending.id];
          if (record?.lastEvent) this.send({ type: "event", event: { ...record.lastEvent, eventId: randomUUID() } });
          const adapter = record ? this.adapters[record.adapterId] : null;
          if (record && adapter?.reconcile) await adapter.reconcile(record.command, record.dispatchedAt);
          else if (!record?.lastEvent) this.send({ type: "event", event: { type: "uncertain", entityId: pending.deviceId, operationId: pending.id, error: "Gateway has no verified outcome", at: Date.now(), eventId: randomUUID() } });
        }
        this.send({ type: "ready" });
      } else if (message.type === "event_ack") {
        if (message.rejected) {
          const event = this.state.events.find((e) => e.eventId === message.eventId), record = this.state.journal[event?.operationId];
          if (record) {
            record.status = "uncertain";
            record.error = "Cloud rejected event authority or evidence";
          }
        }
        this.state.events = this.state.events.filter((e) => e.eventId !== message.eventId);
        this.save();
      } else if (message.type === "command") await this.execute(message.command);
      else if (message.type === "cancel") {
        const record = this.state.journal[message.id];
        if (!record) return;
        const adapter = this.adapters[record.adapterId];
        if (!adapter.cancelTask) {
          this.record({ type: "failed", entityId: record.command.entityId, operationId: message.id, error: "Cancellation unsupported", at: Date.now() });
          return;
        }
        await adapter.cancelTask(record.command);
      }
    }
    async execute(command, { offline = false } = {}) {
      if (this.state.events.length >= 9800) throw fault("Evidence buffer capacity reached; refusing new actions", 503);
      const c = this.state.configuration;
      if (!c || !offline && !this.connected || c.leaseExpiresAt <= Date.now()) throw fault("No current cached policy", 403);
      const e = c.entities.find((e2) => e2.id === command.entityId);
      if (!e || command.policyVersion !== e.policyVersion) throw fault("Asset scope or policy changed", 403);
      const spec = validateCommand(command, e);
      const mode = e.actions[command.action] || "prohibited";
      if (mode === "prohibited" || offline && (mode !== "autonomous" || spec.risk !== "routine")) throw fault("Local policy prohibits action", 403);
      const digest = fingerprint(command), old = this.state.journal[command.id];
      if (old) {
        if (old.digest !== digest) throw fault("Operation identity conflict", 409);
        if (old.lastEvent) this.record(old.lastEvent);
        return;
      }
      const adapterId = this.bindings.get(e.id), adapter = this.adapters[adapterId];
      if (!adapter) throw fault("No configured adapter", 409);
      if (fingerprint(this.adapterDescription(adapterId, adapter.describe(e.id))) !== e.descriptionHash) throw fault("Adapter capabilities changed; re-onboarding required", 409);
      if (!adapter.health().connected) throw fault("Adapter offline", 503);
      if (Object.values(this.state.journal).some((r) => r.command.entityId === e.id && !TERMINAL.has(r.status) && r.command.expiresAt > Date.now())) throw fault("Device has pending work", 409);
      this.state.journal[command.id] = { command, digest, adapterId, status: "dispatched", entityId: e.entityId, dispatchedAt: Date.now() };
      this.save();
      try {
        await (spec.task ? adapter.startTask(command) : adapter.invokeAction(command));
      } catch {
        this.onEvent(adapterId, { type: "uncertain", entityId: e.id, operationId: command.id, error: "Adapter could not verify dispatch", at: Date.now() });
      }
    }
    onEvent(adapterId, event) {
      if (event.type === "description") {
        if (this.connected) this.send({ type: "discover", descriptions: this.descriptions() });
        return;
      }
      const c = this.state.configuration, e = c?.entities.find((e2) => e2.id === event.entityId);
      if (!e) return;
      if (this.bindings.get(event.entityId) !== adapterId) return;
      const record = event.operationId ? this.state.journal[event.operationId] : null;
      if (record && record.command.entityId !== event.entityId) return;
      if (record && !TERMINAL.has(record.status)) {
        record.lastEvent = event;
        if (event.type === "observation") {
          const expected = e.description.actions[record.command.action].expected;
          const value = expected.input ? record.command.input[expected.input] : expected.value;
          if (event.property === expected.property && event.value === value && event.at <= record.command.expiresAt && event.at >= record.dispatchedAt) record.status = "completed";
        } else record.status = event.type;
        this.save();
      }
      this.record(event);
    }
    async offline(entityId) {
      if (this.connected) throw fault("Offline routine endpoint only operates during cloud outage", 409);
      const c = this.state.configuration, e = c?.entities.find((e2) => e2.id === entityId), grant = e?.offline;
      if (!grant || grant.expiresAt <= Date.now() || c.leaseExpiresAt <= Date.now() || (this.state.offlineUses[grant.id] || 0) >= grant.maxUses) throw fault("No valid offline grant", 403);
      const command = { id: randomUUID(), entityId, action: grant.action, input: grant.input, descriptionHash: e.descriptionHash, policyVersion: e.policyVersion, authorized: true, expiresAt: Math.min(grant.expiresAt, c.leaseExpiresAt, Date.now() + 3e4) };
      this.state.offlineUses[grant.id] = (this.state.offlineUses[grant.id] || 0) + 1;
      this.save();
      this.record({ type: "offline_start", entityId, operationId: command.id, grantId: grant.id, at: Date.now() });
      await this.execute(command, { offline: true });
      return { operationId: command.id };
    }
    status() {
      return { connected: this.connected, hubId: this.config.hubId, siteId: this.config.siteId, entities: this.state.configuration?.entities || [], journal: this.state.journal, pendingEvents: this.state.events.length, adapters: Object.entries(this.adapters).map(([id2, a]) => ({ id: id2, ...a.health() })) };
    }
    async close() {
      this.closed = true;
      clearTimeout(this.reconnect);
      this.socket?.close();
      for (const a of Object.values(this.adapters)) await a.close();
    }
  };

  // physical-edge/src/home-assistant-adapter.js
  var HomeAssistantAdapter = class extends EventEmitter {
    static manifest = { id: "home-assistant", version: 2, profiles: ["switch", "sensor", "tv"], capabilities: ["read", "invoke", "subscribe"], credentialRequirements: ["Home Assistant token"], limitations: ["Explicit entity mappings only", "Requires observed state; optimistic/assumed state is rejected", "No robot tasks in Phase 1", "TV navigation has no independently verified key feedback; remains uncertain"] };
    constructor(config2) {
      super();
      this.config = config2;
      this.pending = /* @__PURE__ */ new Map();
      this.states = /* @__PURE__ */ new Map();
      this.calls = /* @__PURE__ */ new Map();
      this.sequence = 0;
      this.entities = config2.entities || [];
      const url = new URL(config2.url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fault("Invalid HA endpoint");
      for (const e of this.entities) {
        id(e.id);
        if (e.profile === "tv") {
          if (!/^remote\.[a-z0-9_]+$/.test(e.haEntityId) || e.mediaEntityId && !/^media_player\.[a-z0-9_]+$/.test(e.mediaEntityId)) throw fault("Invalid TV mapping");
          for (const [key, a] of Object.entries(e.apps || {})) {
            id(key);
            if (typeof a.activity !== "string" || !a.activity.length || a.activity.length > 512 || typeof a.observedActivity !== "string" || !a.observedActivity.length) throw fault("TV apps require approved activity and observedActivity");
          }
          if (e.channels && (!Array.isArray(e.channels) || e.channels.some((n) => !Number.isInteger(n) || n < 1 || n > 9999))) throw fault("Invalid TV channels");
        } else if (!/^(switch|sensor)\.[a-z0-9_]+$/.test(e.haEntityId) || !["switch", "sensor"].includes(e.profile)) throw fault("Invalid HA mapping");
      }
    }
    async start() {
      if (!this.config.token) throw fault("HA token required");
      this.socket = new WebSocket(new URL("/api/websocket", this.config.url).href.replace(/^http/, "ws"), { maxPayload: 1024 * 1024 });
      this.socket.on("error", () => {
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(fault("HA connection timeout", 503)), 8e3);
        this.socket.on("message", (raw) => {
          let message;
          try {
            message = JSON.parse(raw);
          } catch {
            return;
          }
          if (message.type === "auth_required") this.socket.send(JSON.stringify({ type: "auth", access_token: this.config.token }));
          if (message.type === "auth_invalid") {
            clearTimeout(timer);
            reject(fault("HA credentials rejected", 401));
          }
          if (message.type === "auth_ok") {
            this.ready = true;
            this.call("subscribe_events", { event_type: "state_changed" }).then(() => this.call("get_states")).then((states) => {
              states.forEach((s) => this.observe(s));
              clearTimeout(timer);
              resolve();
            }).catch(reject);
          }
          if (message.type === "result") {
            const call = this.calls.get(message.id);
            if (call) {
              this.calls.delete(message.id);
              clearTimeout(call.timer);
              message.success ? call.resolve(message.result) : call.reject(fault("HA service rejected operation", 502));
            }
          }
          if (message.type === "event" && message.event?.event_type === "state_changed") this.observe(message.event.data?.new_state);
        });
      });
      return this;
    }
    call(type, args = {}) {
      return new Promise((resolve, reject) => {
        const n = ++this.sequence;
        const timer = setTimeout(() => {
          this.calls.delete(n);
          reject(fault("HA response timeout", 504));
        }, 5e3);
        this.calls.set(n, { resolve, reject, timer });
        this.socket.send(JSON.stringify({ id: n, type, ...args }));
      });
    }
    observe(state) {
      if (!state || state.attributes?.assumed_state === true || ["unknown", "unavailable"].includes(state.state)) return;
      for (const mapping of this.entities.filter((e) => e.haEntityId === state.entity_id || e.mediaEntityId === state.entity_id)) {
        const at = Date.parse(state.last_updated);
        if (!Number.isFinite(at)) continue;
        const values = {};
        if (mapping.profile === "tv") {
          if (state.entity_id === mapping.haEntityId) {
            if (["on", "off"].includes(state.state)) values.on = state.state === "on";
            const activity = state.attributes?.current_activity;
            for (const [key, a] of Object.entries(mapping.apps || {})) if (a.observedActivity === activity) values.app = key;
          }
          if (state.entity_id === mapping.mediaEntityId && Number.isInteger(state.attributes?.media_channel)) values.channel = state.attributes.media_channel;
        } else if (mapping.profile === "switch") {
          if (["on", "off"].includes(state.state)) values.on = state.state === "on";
        } else if (state.state !== "" && Number.isFinite(Number(state.state))) values.temperature = Number(state.state);
        for (const [property, value] of Object.entries(values)) {
          const td = this.describe(mapping.id);
          try {
            validateInput(td.properties[property], value);
          } catch {
            continue;
          }
          this.states.set(mapping.id + ":" + property, { value, at });
          const pending = this.pending.get(mapping.id);
          const event = { type: "observation", entityId: mapping.id, property, value, at, operationId: pending && at >= pending.dispatchedAt && at <= pending.expiresAt ? pending.id : null };
          this.emit("event", event);
          if (event.operationId && property === pending.expectedProperty && value === pending.expectedValue) this.pending.delete(mapping.id);
        }
      }
    }
    discover() {
      return this.entities.map((e) => this.describe(e.id));
    }
    describe(deviceId) {
      const mapping = this.entities.find((e) => e.id === deviceId);
      if (!mapping) return null;
      const td = profile(mapping.id, mapping.profile);
      td.flolah.simulated = mapping.simulated === true;
      if (mapping.profile === "tv") {
        const apps = Object.keys(mapping.apps || {});
        if (apps.length) td.actions.launch_app.input.properties.app.enum = apps;
        else delete td.actions.launch_app;
        if (mapping.mediaEntityId && mapping.channels?.length) td.actions.select_channel.input.properties.channel.enum = mapping.channels;
        else delete td.actions.select_channel;
      }
      return td;
    }
    pair(deviceId) {
      return this.describe(deviceId);
    }
    readProperty(deviceId, property) {
      return this.states.get(deviceId + ":" + property) || null;
    }
    async invokeAction(c) {
      if (!this.ready || this.socket.readyState !== WebSocket.OPEN) throw fault("HA unavailable", 503);
      const e = this.entities.find((e2) => e2.id === c.entityId), spec = this.describe(c.entityId)?.actions[c.action];
      if (!e || !spec) throw fault("HA capability unsupported");
      const old = this.pending.get(c.entityId);
      if (old && old.expiresAt > Date.now() && old.id !== c.id) throw fault("HA device already has pending work", 409);
      validateInput(spec.input, c.input);
      this.pending.set(c.entityId, { id: c.id, dispatchedAt: Date.now(), expiresAt: c.expiresAt, expectedProperty: spec.expected.property, expectedValue: spec.expected.input ? c.input[spec.expected.input] : spec.expected.value });
      let args;
      if (e.profile === "switch") args = { domain: "switch", service: c.input.on ? "turn_on" : "turn_off", target: { entity_id: e.haEntityId } };
      else if (c.action === "set_power") args = { domain: "remote", service: c.input.on ? "turn_on" : "turn_off", target: { entity_id: e.haEntityId } };
      else if (c.action === "launch_app") args = { domain: "remote", service: "turn_on", target: { entity_id: e.haEntityId }, service_data: { activity: e.apps[c.input.app].activity } };
      else if (c.action === "select_channel") args = { domain: "media_player", service: "play_media", target: { entity_id: e.mediaEntityId }, service_data: { media: { media_content_type: "channel", media_content_id: c.input.channel } } };
      else if (c.action === "navigate") args = { domain: "remote", service: "send_command", target: { entity_id: e.haEntityId }, service_data: { command: c.input.command } };
      else throw fault("Unsupported TV action");
      await this.call("call_service", args);
      this.emit("event", { type: "accepted", entityId: c.entityId, operationId: c.id, at: Date.now() });
    }
    health() {
      return { connected: this.socket?.readyState === WebSocket.OPEN };
    }
    async reconcile(command, dispatchedAt) {
      const expected = this.describe(command.entityId)?.actions[command.action]?.expected;
      if (!expected) throw fault("Unknown action");
      this.pending.set(command.entityId, { id: command.id, dispatchedAt, expiresAt: command.expiresAt, expectedProperty: expected.property, expectedValue: expected.input ? command.input[expected.input] : expected.value });
      const states = await this.call("get_states");
      states.forEach((s) => this.observe(s));
    }
    async close() {
      this.ready = false;
      for (const c of this.calls.values()) {
        clearTimeout(c.timer);
        c.reject(fault("HA closed", 503));
      }
      this.calls.clear();
      this.socket?.close();
    }
  };

  // physical-edge/android/js/main.js
  var store = (name) => ({ load: () => JSON.parse(NativeEdge.read(name)), save: (value) => NativeEdge.write(name, JSON.stringify(value)) });
  var VirtualAdapter = class extends EventEmitter {
    static manifest = { version: 1 };
    constructor() {
      super();
      this.values = JSON.parse(NativeEdge.read("simulator")) || { on: false, app: "home", channel: 1, last_navigation: "HOME" };
    }
    async start() {
    }
    discover() {
      return [profile("android-virtual-tv", "tv")];
    }
    describe() {
      return this.discover()[0];
    }
    readProperty(id2, p) {
      return { value: this.values[p], at: Date.now() };
    }
    health() {
      return { connected: true };
    }
    async close() {
    }
    async invokeAction(c) {
      const spec = this.describe().actions[c.action];
      validateInput(spec.input, c.input);
      const property = spec.expected.property, value = c.input[spec.expected.input];
      this.emit("event", { type: "accepted", entityId: c.entityId, operationId: c.id, at: Date.now() });
      this.values[property] = value;
      NativeEdge.write("simulator", JSON.stringify(this.values));
      this.emit("event", { type: "observation", entityId: c.entityId, operationId: c.id, property, value, at: Date.now() });
    }
  };
  var gateway;
  var output = document.getElementById("status");
  var config = document.getElementById("config");
  config.value = NativeEdge.read("config") === "null" ? "" : NativeEdge.read("config");
  window.stopEdge = () => {
    gateway?.close();
    gateway = null;
    output.textContent = "Stopped. Keep this foreground pilot open while testing.";
  };
  document.getElementById("stop").onclick = window.stopEdge;
  document.getElementById("start").onclick = async () => {
    try {
      await gateway?.close();
      const c = JSON.parse(config.value);
      if (!c.hub?.cloudUrl?.startsWith("wss://")) throw Error("Cloud WSS required");
      const adapters = {};
      for (const [name, a] of Object.entries(c.adapters || {})) {
        if (a.type !== "home-assistant" || !a.url?.startsWith("https://")) throw Error("Android pilot supports HTTPS Home Assistant adapters only");
        adapters[name] = new HomeAssistantAdapter(a);
      }
      if (!Object.keys(adapters).length) adapters.simulator = new VirtualAdapter();
      NativeEdge.write("config", JSON.stringify(c));
      gateway = new EdgeGateway(c.hub, store("gateway"), adapters);
      await gateway.start();
      output.textContent = "Connecting\u2026";
      config.value = "";
    } catch (e) {
      output.textContent = e.message;
    }
  };
  setInterval(() => {
    if (gateway) output.textContent = JSON.stringify({ connected: gateway.connected, hubId: gateway.config.hubId, adapters: gateway.status().adapters, pendingEvents: gateway.state.events.length }, null, 2);
  }, 1500);
})();
