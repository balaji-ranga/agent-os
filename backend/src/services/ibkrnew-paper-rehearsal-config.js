const allowed = {
  policy:['minimum_expected_net_profit_usd','maximum_round_trip_commission_pct_of_expected_gross_profit'],
  strategy:['minimum_relative_volume','single_lot_target_r'],
  universe:['stock_maximum_price_usd'],
};
const bad=message=>{throw Object.assign(new Error(message),{status:400});};

// A deliberately narrow overlay: never permit budgets, loss limits, feature
// switches, goal state, provider selection or Live controls in a Paper preset.
export function validatePaperRehearsalOverrides(kind,document) {
  const o=document.paper_rehearsal_overrides;
  if(o==null)return;
  const keys=allowed[kind];
  if(!keys || typeof o!=='object' || Array.isArray(o) || Object.keys(o).some(k=>!keys.includes(k)))bad('Unsupported Paper rehearsal override');
  for(const [key,value] of Object.entries(o)) {
    if(typeof value!=='number' || !Number.isFinite(value) || value<=0)bad(`Paper override ${key} must be positive and finite`);
    if(key==='maximum_round_trip_commission_pct_of_expected_gross_profit' && value>=100)bad('Paper commission drag must be below 100 percent');
    if(key==='stock_maximum_price_usd' && value<document.filters.stock.minimum_price_usd)bad('Paper maximum stock price is below the minimum');
  }
}

export function effectiveIbkrNewConfig(kind,document,environment) {
  const d=structuredClone(document);
  validatePaperRehearsalOverrides(kind,d);
  if(environment!=='paper' || !d.paper_rehearsal_overrides)return d;
  const o=d.paper_rehearsal_overrides;
  if(kind==='policy')Object.assign(d.commissions,o);
  if(kind==='strategy') {
    if(o.minimum_relative_volume!=null)d.entry.minimum_relative_volume=o.minimum_relative_volume;
    if(o.single_lot_target_r!=null)d.exits.single_lot_target_r=o.single_lot_target_r;
  }
  if(kind==='universe' && o.stock_maximum_price_usd!=null)d.filters.stock.maximum_price_usd=o.stock_maximum_price_usd;
  return d;
}

export function effectiveIbkrNewConfigs(configs,environment) {
  return Object.fromEntries(Object.entries(configs).map(([k,d])=>[k,effectiveIbkrNewConfig(k,d,environment)]));
}

export function paperPolicyRiskLoosened(before,after) {
  const oldC=effectiveIbkrNewConfig('policy',before,'paper').commissions;
  const newC=effectiveIbkrNewConfig('policy',after,'paper').commissions;
  return newC.minimum_expected_net_profit_usd<oldC.minimum_expected_net_profit_usd || newC.maximum_round_trip_commission_pct_of_expected_gross_profit>oldC.maximum_round_trip_commission_pct_of_expected_gross_profit;
}

export function buildPaperRehearsalPreview(configs) {
  const documents=Object.fromEntries(['policy','strategy','universe'].map(k=>{
    const d=structuredClone(configs[k]);delete d.id;delete d.version;delete d.status;delete d.published_at;return [k,d];
  }));
  documents.policy.paper_rehearsal_overrides={minimum_expected_net_profit_usd:3,maximum_round_trip_commission_pct_of_expected_gross_profit:40};
  documents.strategy.paper_rehearsal_overrides={minimum_relative_volume:1.1,single_lot_target_r:2.5};
  documents.universe.paper_rehearsal_overrides={stock_maximum_price_usd:500};
  return {environment:'paper',status:'preview_not_active',expected_versions:Object.fromEntries(['policy','strategy','universe'].map(k=>[k,configs[k].version])),documents,
    settings:{minimum_relative_volume:1.1,stock_maximum_price_usd:500,single_lot_target_r:2.5,minimum_expected_net_profit_usd:3,maximum_commission_drag_pct:40},
    budgets_and_loss_limits_unchanged:true,live_settings_unchanged:true,goal_unchanged:true,
    note:'Paper-only rehearsal. Not a profitability backtest or guaranteed order. Requires explicit publication; existing signals, data/profile checks, protective exits and risk gates remain.'};
}
