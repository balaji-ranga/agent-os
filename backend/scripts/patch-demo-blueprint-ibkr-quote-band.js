/**
 * Patch frozen demo company blueprint IBKR/monthly-trading graphs to match seed
 * quote-band policy (entry_discount_pct_max + W1 hard-gates snapshot/screener).
 *
 * Prefer this over republishing from a live CEO snapshot (avoids unrelated drift).
 *
 * Usage:
 *   node scripts/patch-demo-blueprint-ibkr-quote-band.js
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = join(
  __dirname,
  '../src/services/company-blueprints/packs/demo_balaji_ranganathan.json'
);

const PRICES_BULLET =
  '- **Prices:** set entry_price from the account snapshot reference_prices or screener last — never invent a round number. BUY limit must be within {{var.entry_slip_pct_max}}% above and {{var.entry_discount_pct_max}}% below that last. Far-below limits will not fill and hard gates will reject them.\n';

const SPENDABLE_BULLET =
  '- **Use the spendable cap:** when you take new_entry, set integer qty so notional uses min(daily_budget_usd, cash_usd, portfolio × position_size_pct_max/100) as fully as whole shares allow (at least the position_size_pct_min band when cash allows). Do not leave a leftover that could still buy another share.\n';

const BOOKABLE_SECTION =
  '\n## Bookable IBKR stock bracket (W2)\nW2 places a native stock bracket only when every new_entry has qty >= 1, entry_price, stop_price below entry, and tp_price above entry. Null tp_price is rejected by hard gates and the laptop mapper will skip the order. Default first take-profit to about {{var.partial_profit_pct_min}}% above entry unless the setup implies a tighter target.\n';

const CHECKER_PRICE_LINE =
  '- every new_entry has a real entry_price within {{var.entry_slip_pct_max}}% above / {{var.entry_discount_pct_max}}% below snapshot or screener last (reject invented far-below-market limits)\n';

const CHECKER_BRACKET_LINE =
  '- every new_entry is a bookable IBKR bracket: qty >= 1, stop_price below entry, tp_price above entry (W2 skips incomplete brackets)\n';

const IBKR_BUY_LINE =
  '- BUY entry ≤ reference_price + {{var.entry_slip_pct_max}}% and ≥ reference_price − {{var.entry_discount_pct_max}}% (do not invent far-below-market limits)';

function wf(pack, key) {
  return (pack.workflow_templates || []).find((w) => w.template_key === key);
}

function nodeById(w, id) {
  return (w?.graph?.nodes || []).find((n) => n.id === id);
}

function ensureBinding(bindings, binding) {
  if (!Array.isArray(bindings)) return [binding];
  if (bindings.some((b) => b.id === binding.id)) return bindings;
  bindings.push(binding);
  return bindings;
}

function ensureMonthlyBandVars(variables) {
  if (!variables || typeof variables !== 'object') return;
  if (variables.entry_slip_pct_max == null) variables.entry_slip_pct_max = 0.25;
  variables.entry_discount_pct_max = 3;
}

export function patchDemoBalajiIbkrQuoteBand(pack) {
  const monthlyKeys = [
    'monthly-trading-w1-post-close',
    'monthly-trading-w2-execute',
    'monthly-trading-w3-events',
    'monthly-trading-w5-weekly',
  ];
  for (const key of monthlyKeys) {
    const w = wf(pack, key);
    if (w) ensureMonthlyBandVars(w.variables);
  }

  const w1 = wf(pack, 'monthly-trading-w1-post-close');
  if (!w1) throw new Error('demo pack missing monthly-trading-w1-post-close');

  const hardGates = nodeById(w1, 'hard-gates');
  if (!hardGates?.data) throw new Error('W1 hard-gates node missing');
  hardGates.data.inputBindings = ensureBinding(hardGates.data.inputBindings || [], {
    id: 'account_snapshot',
    mode: 'dynamic',
    sourceNodeId: 'api-snapshot',
    sourceOutputKey: 'bodyText',
  });
  hardGates.data.inputBindings = ensureBinding(hardGates.data.inputBindings, {
    id: 'screener',
    mode: 'dynamic',
    sourceNodeId: 'tool-screener',
    sourceOutputKey: 'text',
  });

  const maker = nodeById(w1, 'maker-1');
  const makerPrompt = maker?.data?.taskConfig?.systemPrompt || '';
  if (makerPrompt && !makerPrompt.includes('entry_discount_pct_max')) {
    const needle =
      '- On each new_entry set notional_usd (or qty + entry_price/trigger_price) so Checker and hard gates can enforce the dollar budget.\n';
    if (!makerPrompt.includes(needle)) {
      throw new Error('W1 Maker prompt missing notional_usd bullet; cannot insert Prices rule');
    }
    maker.data.taskConfig.systemPrompt = makerPrompt.replace(needle, `${needle}${PRICES_BULLET}`);
  }
  if (makerPrompt && !String(maker.data.taskConfig.systemPrompt).includes('Use the spendable cap')) {
    const pricesNeedle = PRICES_BULLET;
    const current = maker.data.taskConfig.systemPrompt;
    if (!current.includes(pricesNeedle)) {
      throw new Error('W1 Maker prompt missing Prices bullet; cannot insert spendable cap');
    }
    maker.data.taskConfig.systemPrompt = current.replace(pricesNeedle, `${SPENDABLE_BULLET}${pricesNeedle}`);
  }
  if (maker.data?.taskConfig?.systemPrompt && !maker.data.taskConfig.systemPrompt.includes('Bookable IBKR stock bracket')) {
    const current = maker.data.taskConfig.systemPrompt;
    const afterPrices = current.includes(PRICES_BULLET)
      ? current.replace(PRICES_BULLET, `${PRICES_BULLET}${BOOKABLE_SECTION}`)
      : `${current}${BOOKABLE_SECTION}`;
    maker.data.taskConfig.systemPrompt = afterPrices;
  }

  const checker = nodeById(w1, 'checker-1');
  const checkerPrompt = checker?.data?.taskConfig?.systemPrompt || '';
  if (checkerPrompt && !checkerPrompt.includes('entry_discount_pct_max')) {
    const needle =
      '- every new_entry / raise_stop / reduce / exit / partial_profit has stop or clear exit intent where required\n';
    if (!checkerPrompt.includes(needle)) {
      throw new Error('W1 Checker prompt missing stop-intent bullet; cannot insert price band rule');
    }
    checker.data.taskConfig.systemPrompt = checkerPrompt.replace(
      needle,
      `${CHECKER_PRICE_LINE}${CHECKER_BRACKET_LINE}${needle}`
    );
  }
  if (checker.data?.taskConfig?.systemPrompt && !checker.data.taskConfig.systemPrompt.includes('bookable IBKR bracket')) {
    const current = checker.data.taskConfig.systemPrompt;
    if (current.includes(CHECKER_PRICE_LINE) && !current.includes(CHECKER_BRACKET_LINE)) {
      checker.data.taskConfig.systemPrompt = current.replace(
        CHECKER_PRICE_LINE,
        `${CHECKER_PRICE_LINE}${CHECKER_BRACKET_LINE}`
      );
    }
  }

  for (const key of ['ibkr-maker-checker-paper', 'ibkr-position-poller-paper']) {
    const w = wf(pack, key);
    if (w) ensureMonthlyBandVars(w.variables);
  }

  const ibkr = wf(pack, 'ibkr-maker-checker-paper');
  const ibkrMaker = nodeById(ibkr, 'maker-1');
  const ibkrPrompt = ibkrMaker?.data?.taskConfig?.systemPrompt || '';
  if (ibkrPrompt && !ibkrPrompt.includes('entry_discount_pct_max')) {
    const next = ibkrPrompt.replace(/- BUY entry[^\n]*/, IBKR_BUY_LINE);
    if (next === ibkrPrompt) {
      const insertAfter =
        '- stop_pct in [{{var.stop_pct_min}}, {{var.stop_pct_max}}]; tp_pct in [{{var.tp_pct_min}}, {{var.tp_pct_max}}] for BUY\n';
      if (!ibkrPrompt.includes(insertAfter)) {
        throw new Error('IBKR Maker prompt missing BUY/stop constraint; cannot insert discount band');
      }
      ibkrMaker.data.taskConfig.systemPrompt = ibkrPrompt.replace(
        insertAfter,
        `${insertAfter}${IBKR_BUY_LINE}\n`
      );
    } else {
      ibkrMaker.data.taskConfig.systemPrompt = next;
    }
  }

  return pack;
}

function main() {
  const pack = JSON.parse(readFileSync(PACK_PATH, 'utf8'));
  patchDemoBalajiIbkrQuoteBand(pack);
  writeFileSync(PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`);
  const w1 = wf(pack, 'monthly-trading-w1-post-close');
  const hg = nodeById(w1, 'hard-gates');
  console.info('[patch-demo-blueprint-ibkr-quote-band] wrote', PACK_PATH);
  console.info(
    JSON.stringify(
      {
        w1_entry_discount_pct_max: w1.variables.entry_discount_pct_max,
        hard_gates_bindings: (hg.data.inputBindings || []).map((b) => b.id),
        maker_has_discount: String(nodeById(w1, 'maker-1').data.taskConfig.systemPrompt).includes(
          'entry_discount_pct_max'
        ),
        checker_has_discount: String(nodeById(w1, 'checker-1').data.taskConfig.systemPrompt).includes(
          'entry_discount_pct_max'
        ),
      },
      null,
      2
    )
  );
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) main();
