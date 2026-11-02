# Device-defined workflow output contracts

## Design

Device operation I/O is declared in the registered Thing Description, not inferred from the workflow node type. An action can include `output: {version, schema, bindings}`. The bounded schema supports scalar values, nested objects and bounded arrays. Each root field has a declarative binding to the independently matched observation value/time, a typed path inside an adapter's device result, or a protected image evidence reference. Bindings cannot run code, select arbitrary modules or choose credentials. Existing operations without output declarations retain legacy behavior.

The generic control plane validates the projected output before recording success. Required missing/mistyped fields fail the operation, even if the observation matched. Each completed operation retains its output contract version/hash and validated `outputs` values. These are visible in Physical AI → Operations & evidence.

Physical AI → Devices shows the selected operation's input schema, output version, typed output names and complete output schema. The registered contract is the common source for this UI and the workflow editor. No per-device output list belongs in the generic workflow node.

A company/resource-scoped GET `/api/physical/entities/:id/workflow-contract` returns the selected action/read contract, typed workflow ports and a fingerprint over the asset identity, operation/input/output contract and expected observation. Workflow nodes pin that snapshot. The editor exposes its ports to downstream bindings and can explicitly refresh a changed contract. Publication and runtime reject changed pins. Runtime also rejects completed results recorded under a different output contract. Legacy workflows do not silently acquire new pins or lose their output aliases.

Media outputs are protected typed references, not inline binaries or exposed camera credentials. The image-analysis node dereferences the actual stored image with owner/resource access, freshness and integrity checks. A schema saying video/stream does not implement video transport or model support.

## Test workflow

The existing virtual room workflow now binds `capture.frame` (typed image reference) to the vision node's `image` input. TV `set_power` declares `power_state:boolean` and `reported_at:number`; an additional IF consumes `power_state=false` before the post-off room capture. These are device contract ports, rather than the legacy generic `image`/`result` ports. The common operation metadata remains available. All targets stay simulator-only and the schedule stays manual-only.

The virtual camera declares `frame` and `captured_at`; the virtual TV's power action declares `power_state` and `reported_at`. Another unit fixture uses unrelated `relay_state` and nested `readings` array outputs, plus a renamed `scene` image port, to demonstrate projection is not based on camera/TV field-name branches in the generic runtime.

## Verification

- Final edge suite: 52 passing checks. An offline-reconciliation timing failure occurred once during the full suite; the isolated phase-one transport fixture passed and the final full suite passed. No transport retry semantics were changed for that transient result.
- Dynamic tests cover arbitrary names/nested arrays, missing/mistyped/oversized required values, reserved names, unsafe binding paths/transports, version drift, mismatched target and pinned ports, read properties and legacy devices.
- Full runner tests consume typed frame/power outputs, retain human gates, and exercise on/off/unknown/low-confidence/outside-hours/malformed-vision paths. Their vision HTTP endpoint is explicitly mocked.
- Publication rejects a boolean TV power port connected to the image-analysis image input. Contract API tests enforce member action/discovery and company isolation.
- Live same-workflow acceptance: five completed runs on the actual enrolled laptop MQTT simulator, using the actual configured `gpt-4o-mini` vision model:
  - 4079: TV on, confidence 0.90, labelled 14:00 SGT test clock; dynamic camera `frame` object reached vision without a legacy `image` alias; approved TV operation returned boolean `power_state=false`; the additional IF consumed it; final dynamic frame showed the dark screen.
  - 4080: already-off capture, confidence 1.00; continue branch, no power operation.
  - 4081: TV on, confidence 1.00, exactly 18:00 SGT; continue branch, TV stayed on.
  - 4082: obscured capture, `unknown` confidence 0.50; continue branch, TV stayed on.
  - 4083: TV on, confidence 0.90, actual clock 23:17 SGT with `simulated_clock=false`; continue branch, no power operation.
- Positive run camera contract v1/hash `b500708916bef5b508e7a8964dcf311006404ee2ad45ae0862a2fba661e2b13f`; TV power v1/hash `2d51a2873b8e8098508a22304baadf3c699ba96821a71519acab7d14a7cd8438`. Operation and workflow hashes match. Before/after frame SHA256 values differ and match the known lit/unlit fixtures.
- Reviewed and revalidated only the existing virtual camera and TV descriptions through the normal UI. Restored their existing enabled/approval-required policies; no new member/agent grants, autonomous authority, or real-device commands.
- Verified Physical AI → Devices shows camera `frame:image`, `captured_at:number`, TV `power_state:boolean`, `reported_at:number`, required markers, version and expandable input/output schemas. The workflow editor loaded the live contracts and exposed matching typed output ports; refreshed and published the same definition with manual-only trigger.
- Release `dynamic-output-1793631871` has healthy backend/frontend and retained gateway. Backend-only compatibility correction `dynamic-compat-1793632145` preserves legacy untyped image-port publication while keeping explicit device type checks. Both negative typed-media and positive legacy publication regressions pass. The laptop runs edge suite 0.3.3; package SHA256 `9e4070c5291eb732dae7395cc45d5d8af6d9b0d70e4904a32c494cce2ca50b7c`.
- Run audit: https://login.flolah.cloud/workflows/runs/4079 . Real PRISM standby-off remains unresolved and outside this test.
