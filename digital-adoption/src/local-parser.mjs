import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
export function startLocalParsers(broker, extract, {
  workers = 2
} = {}) {
  let stopped = false;
  const running = new Set();
  const ids = Array.from({
    length: workers
  }, () => `local-${randomUUID()}`);
  const tick = async id => {
    if (stopped || running.has(id)) return;
    running.add(id);
    let root, claim, heartbeat;
    try {
      claim = broker.claim(id);
      if (!claim) return;
      heartbeat = setInterval(() => {
        try {
          broker.heartbeat(claim);
        } catch {}
      }, Math.max(250, claim.leaseMs / 3));
      heartbeat.unref();
      const input = await broker.input(claim);
      root = await mkdtemp(join(tmpdir(), 'adoption-parser-'));
      const path = join(root, 'input');
      await writeFile(path, Buffer.from(input.content, 'base64'), {
        mode: 0o600
      });
      await broker.complete(claim, await extract({
        path,
        kind: input.kind
      }));
    } catch {
      if (claim) broker.fail(claim);
    } finally {
      clearInterval(heartbeat);
      if (root) await rm(root, {
        recursive: true,
        force: true
      });
      running.delete(id);
    }
  };
  const timer = setInterval(() => {
    for (const id of ids) tick(id).catch(() => {});
  }, 250);
  timer.unref();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
