"""Owner-neutral internal inference adapter for IBKR quant backends.

Models are advisory only. This service never has broker credentials and never
places orders. Missing model artifacts or optional Granite dependencies return
a structured error so the Agent OS adapter can use its deterministic baseline.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request

app = Flask(__name__)
MODELS_DIR = Path(os.getenv("QUANT_MODELS_DIR", "/models"))
DEFAULT_BACKEND = os.getenv("QUANT_DEFAULT_BACKEND", "baseline").lower()
GRANITE_MODEL_ID = os.getenv("GRANITE_TTM_MODEL_ID", "ibm-granite/granite-timeseries-ttm-r2")
_models: dict[str, Any] = {}


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _vector(features: dict[str, Any]) -> list[float]:
    keys = ("momentum_pct", "volatility_pct", "volume_ratio", "drawdown_pct", "sentiment_score")
    return [float(features.get(k, 0) or 0) for k in keys]


def _load_tabular(backend: str):
    if backend in _models:
        return _models[backend]
    path = MODELS_DIR / f"{backend}.json"
    if not path.exists():
        raise RuntimeError(f"{backend} model artifact is not installed at {path}")
    try:
        if backend == "lightgbm":
            import lightgbm as lgb
            model = lgb.Booster(model_file=str(path))
        else:
            import xgboost as xgb
            model = xgb.XGBClassifier()
            model.load_model(str(path))
    except Exception as exc:
        raise RuntimeError(f"unable to load {backend} artifact: {exc}") from exc
    _models[backend] = model
    return model


def _baseline_infer(task: str, features: dict[str, Any], text: str = "") -> dict[str, Any]:
    momentum = float(features.get("momentum_pct", features.get("momentum", 0)) or 0)
    volatility = max(0.0, float(features.get("volatility_pct", features.get("volatility", 0)) or 0))
    volume = max(0.0, float(features.get("volume_ratio", 1) or 1))
    drawdown = max(0.0, float(features.get("drawdown_pct", features.get("drawdown", 0)) or 0))
    sentiment = features.get("sentiment_score")
    lower = text.lower()
    score = float(sentiment) if sentiment is not None else (0.55 if "positive" in lower or "upgrade" in lower else -0.55 if "negative" in lower or "downgrade" in lower else 0.0)
    risk = min(1.0, (volatility / 10) * 0.45 + (drawdown / 20) * 0.35 + (0.2 if score < -0.4 else 0))
    direction = "bullish" if momentum > 0.75 and score > -0.25 else "bearish" if momentum < -0.75 or score < -0.55 else "neutral"
    probability = max(0.05, min(0.95, 0.5 + min(0.35, abs(momentum) / 10) + min(0.1, max(0, volume - 1) / 10) - risk * 0.25))
    if task == "news_sentiment":
        return {"label": "positive" if score > 0.2 else "negative" if score < -0.2 else "neutral", "probability": probability, "risk_score": risk}
    if task == "risk_classification":
        return {"label": "high" if risk > 0.65 else "moderate" if risk > 0.35 else "low", "probability": probability, "risk_score": risk}
    if task == "candidate_ranking":
        return {"score": probability * (1 - risk), "direction": direction, "risk_score": risk}
    if task == "return_forecast":
        expected = momentum * 0.18 + score * 0.5 - volatility * 0.04
        return {"expected_return_pct": expected, "quantiles_pct": {"p10": expected - volatility * 0.7, "p50": expected, "p90": expected + volatility * 0.7}, "direction": direction, "probability": probability, "risk_score": risk}
    return {"regime": "high_volatility" if volatility > 6 else "risk_on" if momentum > 1 else "risk_off" if momentum < -1 else "mixed", "direction": direction, "probability": probability, "risk_score": risk}


def _tabular_infer(backend: str, task: str, features: dict[str, Any], text: str = "") -> dict[str, Any]:
    model = _load_tabular(backend)
    row = [_vector(features)]
    pred = model.predict(row)
    value = float(pred[0][0] if hasattr(pred[0], "__len__") else pred[0])
    # Tabular models produce a scalar signal; map it into the same canonical
    # task contract as the baseline instead of exposing model-specific fields.
    derived = dict(features)
    derived["momentum_pct"] = value
    return _baseline_infer(task, derived, text)


def _granite_infer(series: list[float], horizon: int) -> dict[str, Any]:
    if len(series) < 2:
        raise RuntimeError("Granite TTM requires at least two observations")
    try:
        from tsfm_public import TinyTimeMixerForPrediction
        import torch
    except Exception as exc:
        raise RuntimeError(f"Granite TTM runtime unavailable: {exc}") from exc
    # Keep model loading lazy: the optional profile should not download weights
    # until a Granite request is actually made.
    model = TinyTimeMixerForPrediction.from_pretrained(GRANITE_MODEL_ID)
    context = model.config.context_length
    values = series[-context:]
    if len(values) < context:
        values = [values[0]] * (context - len(values)) + values
    tensor = torch.tensor(values, dtype=torch.float32).reshape(1, context, 1)
    with torch.no_grad():
        output = model(past_values=tensor)
    forecast = output.prediction_outputs.detach().cpu().reshape(-1).tolist()[:horizon]
    forecast = [round(float(x), 6) for x in forecast]
    expected = forecast[-1]
    spread = max(forecast) - min(forecast) if len(forecast) > 1 else 0.0
    direction = "bullish" if len(forecast) > 1 and forecast[-1] > forecast[0] else "bearish" if len(forecast) > 1 and forecast[-1] < forecast[0] else "neutral"
    return {"expected_return_pct": expected, "quantiles_pct": {"p10": expected - spread, "p50": expected, "p90": expected + spread}, "direction": direction, "probability": 0.5, "risk_score": 0.5, "model": GRANITE_MODEL_ID}


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "ibkr-quant", "backends": ["baseline", "lightgbm", "xgboost", "granite_ttm"]})


@app.post("/v1/infer")
def infer():
    body = request.get_json(silent=True) or {}
    backend = str(body.get("backend") or DEFAULT_BACKEND).lower()
    features = body.get("features") if isinstance(body.get("features"), dict) else {}
    try:
        task = str(body.get("task") or "regime_classification")
        if backend in {"lightgbm", "xgboost"}:
            output = _tabular_infer(backend, task, features, str(body.get("text") or ""))
        elif backend == "baseline":
            output = _baseline_infer(task, features, str(body.get("text") or ""))
        elif backend in {"granite", "granite_ttm", "granite-ttm"}:
            output = _granite_infer([float(x) for x in body.get("series", [])], max(1, int(body.get("horizon") or 1)))
        else:
            return jsonify({"error": f"unsupported quant backend: {backend}"}), 400
        return jsonify({"ok": True, "backend": backend, "advisory_only": True, "output": output, "input_hash": _hash(body)})
    except Exception as exc:
        return jsonify({"ok": False, "backend": backend, "error": str(exc)}), 503


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("QUANT_PORT", "8090")))
