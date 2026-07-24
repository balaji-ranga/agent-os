#!/usr/bin/env node
/**
 * Flolah desktop workflow entry — local orchestration, remote state / remote nodes.
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './log.js';
import { createFlolahClient } from './flolah-client.js';
import { runDesktopOrchestration } from './orchestrator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { params: null, input: '', inputJson: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--params' && argv[i + 1]) out.params = argv[++i];
    else if (a === '--input' && argv[i + 1]) out.input = argv[++i];
    else if (a === '--input-json' && argv[i + 1]) out.inputJson = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const packageRoot = resolve(__dirname, '..');
  const paramsPath = resolve(args.params || resolve(packageRoot, 'workflow.params.json'));
  const params = JSON.parse(readFileSync(paramsPath, 'utf8'));

  if (params.format !== 'agent-os-desktop-workflow') {
    throw new Error('Invalid workflow.params.json format');
  }
  if (!params.desktop_token || !params.desktop_api_base) {
    throw new Error('workflow.params.json missing desktop_token or desktop_api_base');
  }

  const log = createLogger(packageRoot, params.log || {});
  log.info('Desktop runner starting', {
    definition_id: params.definition_id,
    definition_name: params.definition_name,
    base_url: params.base_url,
    log_file: log.file,
  });

  let input = args.input || '';
  if (args.inputJson) {
    try {
      input = JSON.parse(args.inputJson);
    } catch {
      throw new Error('--input-json is not valid JSON');
    }
  }

  const client = createFlolahClient(params, log);
  const result = await runDesktopOrchestration({
    params,
    client,
    log,
    input,
    packageRoot,
  });
  console.log(JSON.stringify({ ok: true, run_id: result.runId, status: result.status }, null, 2));
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
