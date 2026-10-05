// Tests only. No production environment variable can bypass session gates.
export function installTestClock(at = '2026-10-05T14:00:00.000Z') {
  const NativeDate = globalThis.Date; let time = NativeDate.parse(at);
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [time++])); }
    static now() { return time; }
  };
  return { set: value => { time = NativeDate.parse(value); }, advance: ms => { time += ms; }, restore: () => { globalThis.Date = NativeDate; } };
}
