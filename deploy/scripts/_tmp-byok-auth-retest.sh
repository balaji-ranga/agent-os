#!/bin/bash
# BYOK auth-profile sync retest — NO paste-api-key
set -u
EMAIL="${1:?email}"
PASS="${2:?password}"
OC=agent-os-openclaw-1
BE=agent-os-backend-1
OC_VOL=/var/lib/docker/volumes/agent-os_openclaw_home/_data

echo "=== 1. Confirm auth module ==="
docker exec "$BE" test -f /opt/agent-os/backend/src/services/openclaw-byok-auth.js && echo HAS_AUTH_MODULE
docker inspect -f 'backend_health={{.State.Health.Status}}' "$BE"
docker inspect -f 'openclaw_health={{.State.Health.Status}}' "$OC"

echo "=== 2. Register CEO ==="
BODY=$(python3 -c 'import json,sys; print(json.dumps({
  "email": sys.argv[1],
  "password": sys.argv[2],
  "name": "BYOK Auth Sync Test",
  "llm_provider": "ollama_free",
  "db_mode": "tenant",
  "ceo_db_mode": "tenant",
  "mfa_policy": "off"
}))' "$EMAIL" "$PASS")
HTTP_CODE=$(curl -sS -o /tmp/byok-register.json -w '%{http_code}' -X POST 'https://flolah.cloud/api/auth/register' \
  -H 'Content-Type: application/json' \
  -d "$BODY")
echo "register_HTTP=$HTTP_CODE"
python3 -c 'import json; print(json.dumps(json.load(open("/tmp/byok-register.json")), indent=2)[:2000])'

USER_ID=$(python3 -c 'import json; d=json.load(open("/tmp/byok-register.json")); print((d.get("user") or {}).get("id") or "")')
TOKEN=$(python3 -c 'import json; d=json.load(open("/tmp/byok-register.json")); s=d.get("session") or {}; print(s.get("token") or d.get("token") or d.get("access_token") or "")')
python3 -c 'import json; d=json.load(open("/tmp/byok-register.json")); print("openclaw=", json.dumps(d.get("openclaw"), indent=2)[:1500])'
echo "USER_ID=$USER_ID TOKEN_LEN=${#TOKEN}"

if [ -z "$USER_ID" ] || [ -z "$TOKEN" ]; then
  echo "FAIL: register missing user/token"
  exit 1
fi

# sanitize like backend
SAN=$(python3 -c 'import re,sys; v=sys.argv[1].strip().lower(); v=re.sub(r"[^a-z0-9_-]+","-",v); v=re.sub(r"^-+|-+$","",v) or "unknown"; print(v)' "$USER_ID")
PROVIDER="byok-${SAN}"
PROFILE="${PROVIDER}:manual"
COO_AGENT="t-${SAN}--balserve"
echo "PROVIDER=$PROVIDER"
echo "PROFILE=$PROFILE"
echo "COO_AGENT=$COO_AGENT"
echo "$USER_ID" > /tmp/byok-user-id.txt
echo "$TOKEN" > /tmp/byok-token.txt
echo "$PROVIDER" > /tmp/byok-provider.txt
echo "$COO_AGENT" > /tmp/byok-coo-agent.txt

echo "=== 3. Inspect OpenClaw (no paste) ==="
python3 <<PY
import json, os, sqlite3
provider="$PROVIDER"
profile="$PROFILE"
agent="$COO_AGENT"
cfg=json.load(open("$OC_VOL/openclaw.json"))
prov=(cfg.get("models") or {}).get("providers") or {}
print("--- models.providers[%s] ---" % provider)
p=prov.get(provider)
if not p:
    print("MISSING")
    print("byok keys:", [k for k in prov if k.startswith("byok-")][-8:])
else:
    out=dict(p)
    if out.get("apiKey"):
        k=str(out["apiKey"]); out["apiKey"]=f"{k[:4]}…REDACTED…(len={len(k)})"
    print(json.dumps(out, indent=2))

print("--- auth.profiles[%s] ---" % profile)
ap=((cfg.get("auth") or {}).get("profiles") or {}).get(profile)
print(json.dumps(ap, indent=2) if ap else "MISSING")

entry=None
for a in ((cfg.get("agents") or {}).get("list") or []):
    if a.get("id")==agent:
        entry=a; break
print("--- agent entry %s ---" % agent)
print(json.dumps({"id": entry.get("id") if entry else None,
                  "model": entry.get("model") if entry else None}, indent=2) if entry else "MISSING")

sqlite_path=f"$OC_VOL/agents/{agent}/agent/openclaw-agent.sqlite"
json_path=f"$OC_VOL/agents/{agent}/agent/auth-profiles.json"
print("--- files ---")
print("sqlite exists=", os.path.isfile(sqlite_path), sqlite_path)
print("auth-profiles.json exists=", os.path.isfile(json_path))
if os.path.isfile(json_path):
    j=json.load(open(json_path))
    keys=list((j.get("profiles") or j).keys())
    print("auth-profiles.json keys=", keys)
    hit=(j.get("profiles") or {}).get(profile)
    if hit:
        h=dict(hit)
        if isinstance(h.get("key"), str) and h["key"]:
            k=h["key"]; h["key"]=f"{k[:4]}…REDACTED…(len={len(k)})"
        print("json profile=", json.dumps(h, indent=2))
    else:
        print("json profile MISSING")

print("--- auth_profile_store ---")
if os.path.isfile(sqlite_path):
    con=sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    cols=[r[1] for r in con.execute("PRAGMA table_info(auth_profile_store)")]
    print("cols=", cols)
    for row in con.execute("SELECT * FROM auth_profile_store"):
        o=dict(zip(cols,row))
        try:
            j=json.loads(o.get("store_json") or "{}")
            for pid,prof in (j.get("profiles") or {}).items():
                if isinstance(prof, dict) and isinstance(prof.get("key"), str) and prof["key"]:
                    k=prof["key"]; prof["key"]=f"{k[:4]}…REDACTED…(len={len(k)})"
            o["store_json"]=j
            print("profileIds=", list((j.get("profiles") or {}).keys()))
            print("has_target_profile=", profile in (j.get("profiles") or {}))
        except Exception as e:
            o["err"]=str(e)
        print(json.dumps(o, indent=2)[:2500])
    con.close()
else:
    print("SQLITE_MISSING")

model_ok = False
if entry:
    prim=(entry.get("model") or {})
    if isinstance(prim, dict):
        prim=prim.get("primary")
    model_ok = str(prim or "").startswith(provider+"/")
print("MODEL_PRIMARY_OK=", model_ok, "primary=", (entry or {}).get("model"))
print("PROVIDER_OK=", bool(p))
print("AUTH_PROFILE_META_OK=", bool(ap))
PY

echo "=== 4. Chat COO WITHOUT restart ==="
CHAT_BODY='{"message":"Reply with exactly: OLLAMA_AUTH_SYNC_OK"}'
HTTP1=$(curl -sS -o /tmp/byok-chat1.json -w '%{http_code}' -X POST 'https://flolah.cloud/api/agents/balserve/chat' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "$CHAT_BODY" \
  --max-time 180)
echo "chat1_HTTP=$HTTP1"
python3 -c 'import json; d=json.load(open("/tmp/byok-chat1.json")); print(json.dumps(d, indent=2)[:3000])' 2>/dev/null || head -c 3000 /tmp/byok-chat1.json; echo

NEED_RESTART=0
if grep -qiE 'ProviderAuthError' /tmp/byok-chat1.json; then
  NEED_RESTART=1
fi
if [ "$HTTP1" = "502" ] && grep -qiE 'ProviderAuthError|auth|api.?key' /tmp/byok-chat1.json; then
  NEED_RESTART=1
fi

RESTART_REQUIRED=no
if [ "$NEED_RESTART" = "1" ]; then
  echo "=== ProviderAuthError — restart openclaw ONCE (NO paste-api-key) ==="
  cd /opt/agent-os/deploy
  docker compose restart openclaw
  for i in $(seq 1 40); do
    H=$(docker inspect -f '{{.State.Health.Status}}' "$OC" 2>/dev/null || echo starting)
    echo "wait openclaw health=$H ($i)"
    [ "$H" = "healthy" ] && break
    sleep 5
  done
  echo "=== 4b. Retry chat AFTER restart (still no paste) ==="
  HTTP2=$(curl -sS -o /tmp/byok-chat2.json -w '%{http_code}' -X POST 'https://flolah.cloud/api/agents/balserve/chat' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    -d "$CHAT_BODY" \
    --max-time 180)
  echo "chat2_HTTP=$HTTP2"
  python3 -c 'import json; d=json.load(open("/tmp/byok-chat2.json")); print(json.dumps(d, indent=2)[:3000])' 2>/dev/null || head -c 3000 /tmp/byok-chat2.json; echo
  RESTART_REQUIRED=yes
else
  cp /tmp/byok-chat1.json /tmp/byok-chat2.json
  HTTP2=$HTTP1
fi
echo "RESTART_REQUIRED=$RESTART_REQUIRED" | tee /tmp/byok-restart-flag.txt

echo "=== 5. Logs evidence ==="
echo "--- openclaw logs ---"
docker logs "$OC" --since 15m 2>&1 | grep -E "${PROVIDER}|ollama:11434|OLLAMA_AUTH_SYNC_OK|ProviderAuthError|chat/completions|${COO_AGENT}" | tail -50
echo "--- backend logs ---"
docker logs "$BE" --since 15m 2>&1 | grep -E "${PROVIDER}|OLLAMA_AUTH_SYNC_OK|ProviderAuthError|balserve/chat|syncByok|auth.profile" | tail -40

echo "=== FINAL VERDICT ==="
python3 <<'PY'
import json, os, re
restart=open("/tmp/byok-restart-flag.txt").read().strip()
raw=open("/tmp/byok-chat2.json").read()
first=open("/tmp/byok-chat1.json").read()
try:
    d=json.loads(raw)
except Exception:
    d={"_raw": raw[:2000]}
text=json.dumps(d)
ok = "OLLAMA_AUTH_SYNC_OK" in text
auth_err_final = "ProviderAuthError" in text
auth_err_first = "ProviderAuthError" in first
# also check reply fields
reply = d.get("reply") or d.get("content") or d.get("message") or ""
if isinstance(reply, dict):
    reply=json.dumps(reply)
ok = ok or ("OLLAMA_AUTH_SYNC_OK" in str(reply))
# nested turns
if not ok:
    for k in ("turns","messages","data"):
        if k in d and "OLLAMA_AUTH_SYNC_OK" in json.dumps(d[k]):
            ok=True
print("RESTART_REQUIRED=", restart.replace("RESTART_REQUIRED=",""))
print("CHAT_HAS_OLLAMA_AUTH_SYNC_OK=", ok)
print("FINAL_HAS_ProviderAuthError=", auth_err_final)
print("FIRST_HAD_ProviderAuthError=", auth_err_first)
print("PASTE_API_KEY_USED=no")
if ok and not auth_err_final:
    print("VERDICT=PASS")
else:
    print("VERDICT=FAIL")
    print("FINAL_BODY_HEAD=", text[:1500])
PY
