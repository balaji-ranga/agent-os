# IBKR quant adapter

This is an owner-neutral, advisory-only inference service. It has no broker
credentials and no order-placement routes.

The Agent OS adapter sends `task`, `features`, `series`, `horizon`, and a
selected `backend`. The response is normalized by
`backend/src/services/ibkr-quant-inference.js` into the versioned quant output
contract before strategy code can consume it.

Backends:

- `baseline`: deterministic in-process heuristic (the default and always
  available fallback).
- `lightgbm`: loads `/models/lightgbm.json`.
- `xgboost`: loads `/models/xgboost.json`.
- `granite_ttm`: lazily downloads the configured IBM Granite TTM model into
  the persistent Hugging Face cache when first used.

Enable the container explicitly with:

```text
docker compose --profile optional-ibkr-quant up -d --build ibkr-quant
IBKR_QUANT_ENDPOINT_URL=http://ibkr-quant:8090/v1/infer
IBKR_QUANT_BACKEND=lightgbm|xgboost|granite_ttm
```

Do not enable a tabular backend until its trained and reviewed artifact is
installed. Missing artifacts and invalid model output are reported and safely
fall back to the baseline contract; they never place trades.
