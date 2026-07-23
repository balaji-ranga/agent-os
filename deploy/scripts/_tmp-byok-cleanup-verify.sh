#!/bin/bash
# BYOK auth cleanup on switch/switchback — evidence verify (NO paste-api-key)
set -u
API="${API:-https://flolah.cloud}"
OC=agent-os-openclaw-1
BE=agent-os-backend-1
OC_VOL=/var/lib/docker/volumes/agent-os_openclaw_home/_data
TS=$(date +%s)
EMAIL="byok.cleanup.${TS}@example.com"
PASS="ByokCleanup!${TS}Aa"
FAILS=0
PASS_N=0

pass() { echo "PASS: $*"; PASS_N=$((PASS_N+1)); }
fail() { echo "FAIL: $*"; FAILS=$((FAILS+1)); }
note() { echo "NOTE: $*"; }

echo "=== PRECHECK: backend auth module deployed ==="
docker exec "$BE" test -f /opt/agent-os/backend/src/services/openclaw-byok-auth.js && pass "openclaw-byok-auth.js present" || fail "openclaw-byok-auth.js missing"
docker inspect -f 'backend_health={{.State.Health.Status}}' "$BE"
docker inspect -f 'openclaw_health={{.State.Health.Status}}' "$OC"

# ---------- helpers ----------
inspect_state() {
  local label="$1"
  python3 <<PY
import json, os, sqlite3
provider="$PROVIDER"
profile="$PROFILE"
agent="$COO_AGENT"
label="$label"
cfg=json.load(open("$OC_VOL/openclaw.json"))
prov=(cfg.get("models") or {}).get("providers") or {}
auth_profiles=((cfg.get("auth") or {}).get("profiles") or {})
byok_auth_keys=[k for k in auth_profiles if k==provider or k.startswith(provider+":") or str((auth_profiles.get(k) or {}).get("provider") or "")==provider]
sqlite_path=f"$OC_VOL/agents/{agent}/agent/openclaw-agent.sqlite"
json_path=f"$OC_VOL/agents/{agent}/agent/auth-profiles.json"
auth_json_path=f"$OC_VOL/agents/{agent}/agent/auth.json"
entry=None
for a in ((cfg.get("agents") or {}).get("list") or []):
    if a.get("id")==agent:
        entry=a; break
prim=None
if entry:
    m=entry.get("model")
    if isinstance(m, dict): prim=m.get("primary")
    else: prim=m

store_keys=[]
state_last=[]
state_usage=[]
if os.path.isfile(sqlite_path):
    con=sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    row=con.execute("SELECT store_json FROM auth_profile_store WHERE store_key='primary'").fetchone()
    if row and row[0]:
        try:
            sj=json.loads(row[0])
            store_keys=list((sj.get("profiles") or {}).keys())
        except Exception as e:
            store_keys=[f"PARSE_ERR:{e}"]
    row=con.execute("SELECT state_json FROM auth_profile_state WHERE state_key='primary'").fetchone()
    if row and row[0]:
        try:
            st=json.loads(row[0])
            state_last=list((st.get("lastGood") or {}).keys())
            state_usage=list((st.get("usageStats") or {}).keys())
        except Exception as e:
            state_last=[f"PARSE_ERR:{e}"]
    con.close()

json_keys=[]
json_exists=os.path.isfile(json_path)
auth_json_exists=os.path.isfile(auth_json_path)
if json_exists:
    try:
        j=json.load(open(json_path))
        json_keys=list((j.get("profiles") or j).keys()) if isinstance(j, dict) else []
    except Exception as e:
        json_keys=[f"PARSE_ERR:{e}"]

byok_store=[k for k in store_keys if k==provider or k.startswith(provider+":")]
byok_last=[k for k in state_last if k==provider or k.startswith(provider+":")]
byok_usage=[k for k in state_usage if k==provider or k.startswith(provider+":")]
provider_present = provider in prov

print(f"=== INSPECT [{label}] ===")
print(f"auth-profiles.json_EXISTS={json_exists} path={json_path}")
print(f"auth-profiles.json_KEYS={json_keys}")
print(f"auth.json_EXISTS={auth_json_exists} path={auth_json_path}")
print(f"sqlite_EXISTS={os.path.isfile(sqlite_path)} path={sqlite_path}")
print(f"sqlite_store_profileIds={store_keys}")
print(f"sqlite_byok_store={byok_store}")
print(f"sqlite_state_lastGood_keys={state_last}")
print(f"sqlite_byok_lastGood={byok_last}")
print(f"sqlite_state_usageStats_keys={state_usage}")
print(f"sqlite_byok_usageStats={byok_usage}")
print(f"openclaw.auth.profiles_byok_keys={byok_auth_keys}")
print(f"models.providers[{provider}]_present={provider_present}")
print(f"agent.model.primary={prim!r}")
# machine-readable for shell
open("/tmp/byok-inspect-last.json","w").write(json.dumps({
  "label": label,
  "auth_profiles_json_exists": json_exists,
  "auth_profiles_json_keys": json_keys,
  "auth_json_exists": auth_json_exists,
  "sqlite_exists": os.path.isfile(sqlite_path),
  "sqlite_store_keys": store_keys,
  "sqlite_byok_store": byok_store,
  "sqlite_byok_lastGood": byok_last,
  "sqlite_byok_usageStats": byok_usage,
  "openclaw_auth_byok_keys": byok_auth_keys,
  "provider_present": provider_present,
  "model_primary": prim,
}, indent=2))
print("WROTE /tmp/byok-inspect-last.json")
PY
}

assert_after_register() {
  python3 <<'PY'
import json, sys
d=json.load(open("/tmp/byok-inspect-last.json"))
ok=True
def fail(m):
  global ok; ok=False; print("FAIL:", m)
def pass_(m): print("PASS:", m)
if not d["auth_profiles_json_exists"]:
  fail("auth-profiles.json must EXIST after register")
else:
  pass_("auth-profiles.json EXISTS")
keys=d["auth_profiles_json_keys"]
manual=[k for k in keys if k.endswith(":manual")]
default=[k for k in keys if k.endswith(":default")]
if not any(k.endswith(":manual") for k in d["sqlite_byok_store"] or keys):
  # accept either json or sqlite having :manual
  if not any(str(k).endswith(":manual") for k in (d["sqlite_store_keys"] or [])):
    fail(f"sqlite missing byok-…:manual; store={d['sqlite_store_keys']}")
  else:
    pass_(f"sqlite has byok-…:manual ({[k for k in d['sqlite_store_keys'] if str(k).endswith(':manual')]})")
else:
  pass_(f"sqlite/json has byok-…:manual ({d['sqlite_byok_store'] or keys})")
if default:
  fail(f"unexpected :default after register: {default}")
sys.exit(0 if ok else 1)
PY
  local rc=$?
  if [ $rc -ne 0 ]; then FAILS=$((FAILS+1)); else PASS_N=$((PASS_N+1)); fi
}

assert_cleanup() {
  local label="$1"
  python3 <<PY
import json, sys
d=json.load(open("/tmp/byok-inspect-last.json"))
ok=True
def fail(m):
  global ok; ok=False; print("FAIL:", m)
def pass_(m): print("PASS:", m)
print("--- assert cleanup [%s] ---" % "$label")
if d["auth_profiles_json_exists"]:
  fail("auth-profiles.json must be DELETED (still exists)")
else:
  pass_("auth-profiles.json DELETED (does not exist)")
if d["auth_json_exists"]:
  fail("auth.json must be DELETED if it existed (still exists)")
else:
  pass_("auth.json absent/deleted")
if d["sqlite_byok_store"]:
  fail(f"sqlite auth_profile_store still has byok profiles: {d['sqlite_byok_store']}")
else:
  pass_("sqlite auth_profile_store has NO byok-* profiles")
if d["sqlite_byok_lastGood"] or d["sqlite_byok_usageStats"]:
  fail(f"sqlite auth_profile_state still has byok lastGood/usageStats: last={d['sqlite_byok_lastGood']} usage={d['sqlite_byok_usageStats']}")
else:
  pass_("sqlite auth_profile_state has no byok lastGood/usageStats")
if d["openclaw_auth_byok_keys"]:
  fail(f"openclaw.json auth.profiles still has byok keys: {d['openclaw_auth_byok_keys']}")
else:
  pass_("openclaw.json auth.profiles has NO byok-{userId} keys")
if d["provider_present"]:
  fail("models.providers[byok-…] still present")
else:
  pass_("models.providers[byok-…] removed")
prim=d.get("model_primary")
# cleared means None/empty/not byok
if prim and str(prim).startswith("$PROVIDER"):
  fail(f"agent model.primary still BYOK: {prim!r}")
elif prim in (None, "", {}):
  pass_(f"agent model.primary cleared ({prim!r})")
else:
  # platform may set a non-byok primary — acceptable if not byok
  if str(prim).startswith("byok-"):
    fail(f"agent model.primary still byok: {prim!r}")
  else:
    pass_(f"agent model.primary not byok ({prim!r})")
sys.exit(0 if ok else 1)
PY
  local rc=$?
  if [ $rc -ne 0 ]; then FAILS=$((FAILS+1)); else PASS_N=$((PASS_N+1)); fi
}

assert_recreated_manual_only() {
  python3 <<'PY'
import json, sys
d=json.load(open("/tmp/byok-inspect-last.json"))
ok=True
def fail(m):
  global ok; ok=False; print("FAIL:", m)
def pass_(m): print("PASS:", m)
if not d["auth_profiles_json_exists"]:
  fail("auth-profiles.json must be recreated after switch to ollama_free")
else:
  pass_("auth-profiles.json recreated")
keys=d["auth_profiles_json_keys"]
defaults=[k for k in keys if str(k).endswith(":default")]
manuals=[k for k in keys if str(k).endswith(":manual")]
if defaults:
  fail(f"auth-profiles.json has :default (must be ONLY :manual): {keys}")
else:
  pass_(f"auth-profiles.json has NO :default keys={keys}")
if not manuals:
  fail(f"auth-profiles.json missing :manual: {keys}")
else:
  pass_(f"auth-profiles.json has :manual only ({manuals})")
sys.exit(0 if ok else 1)
PY
  local rc=$?
  if [ $rc -ne 0 ]; then FAILS=$((FAILS+1)); else PASS_N=$((PASS_N+1)); fi
}

# ---------- Step 1: Register ----------
echo ""
echo "=== STEP 1: Register NEW CEO llm_provider=ollama_free ==="
echo "EMAIL=$EMAIL"
BODY=$(python3 -c 'import json,sys; print(json.dumps({
  "email": sys.argv[1],
  "password": sys.argv[2],
  "name": "BYOK Cleanup Verify",
  "llm_provider": "ollama_free",
  "db_mode": "tenant",
  "ceo_db_mode": "tenant",
  "mfa_policy": "off"
}))' "$EMAIL" "$PASS")
HTTP_CODE=$(curl -sS -o /tmp/byok-register.json -w '%{http_code}' -X POST "$API/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "$BODY")
echo "register_HTTP=$HTTP_CODE"
python3 -c 'import json; print(json.dumps(json.load(open("/tmp/byok-register.json")), indent=2)[:1800])'

USER_ID=$(python3 -c 'import json; d=json.load(open("/tmp/byok-register.json")); print((d.get("user") or {}).get("id") or "")')
TOKEN=$(python3 -c 'import json; d=json.load(open("/tmp/byok-register.json")); s=d.get("session") or {}; print(s.get("token") or d.get("token") or d.get("access_token") or "")')
echo "USER_ID=$USER_ID TOKEN_LEN=${#TOKEN}"

if [ -z "$USER_ID" ] || [ -z "$TOKEN" ]; then
  fail "register missing user/token"
  echo "OVERALL=FAIL"
  exit 1
fi
pass "register succeeded"

SAN=$(python3 -c 'import re,sys; v=sys.argv[1].strip().lower(); v=re.sub(r"[^a-z0-9_-]+","-",v); v=re.sub(r"^-+|-+$","",v) or "unknown"; print(v)' "$USER_ID")
PROVIDER="byok-${SAN}"
PROFILE="${PROVIDER}:manual"
COO_AGENT="t-${SAN}--balserve"
echo "PROVIDER=$PROVIDER PROFILE=$PROFILE COO_AGENT=$COO_AGENT"

# brief wait for provision
sleep 2
inspect_state "after_register"
assert_after_register || true

# ---------- Step 2: Switchback to platform_decided ----------
echo ""
echo "=== STEP 2: PATCH /api/auth/me → llm_provider=platform_decided ==="
PATCH1='{"llm_provider":"platform_decided","clear_llm_api_key":true}'
HTTP_P1=$(curl -sS -o /tmp/byok-patch1.json -w '%{http_code}' -X PATCH "$API/api/auth/me" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "$PATCH1")
echo "patch1_HTTP=$HTTP_P1"
python3 -c 'import json; d=json.load(open("/tmp/byok-patch1.json")); u=d.get("user") or d; print("llm_provider=", (u.get("llm_provider") if isinstance(u,dict) else None) or d.get("llm_provider")); print("openclaw_sync=", json.dumps(d.get("openclaw_sync") or (u.get("openclaw_sync") if isinstance(u,dict) else None), indent=2)[:800]); print(json.dumps(d, indent=2)[:1200])'
LLM1=$(python3 -c 'import json; d=json.load(open("/tmp/byok-patch1.json")); u=d.get("user") or d; print((u.get("llm_provider") if isinstance(u,dict) else None) or d.get("llm_provider") or "")')
if [ "$LLM1" != "platform_decided" ]; then
  fail "PATCH switchback did not set llm_provider=platform_decided (got $LLM1)"
else
  pass "PATCH switchback llm_provider=platform_decided"
fi
sleep 2
inspect_state "after_switchback_1"
assert_cleanup "switchback_1" || true

# ---------- Step 3: Optional switch to ollama_free then switchback ----------
echo ""
echo "=== STEP 3: PATCH back to ollama_free then switchback again ==="
PATCH2='{"llm_provider":"ollama_free"}'
HTTP_P2=$(curl -sS -o /tmp/byok-patch2.json -w '%{http_code}' -X PATCH "$API/api/auth/me" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "$PATCH2")
echo "patch2_ollama_HTTP=$HTTP_P2"
python3 -c 'import json; d=json.load(open("/tmp/byok-patch2.json")); u=d.get("user") or d; print("llm_provider=", (u.get("llm_provider") if isinstance(u,dict) else None) or d.get("llm_provider")); print(json.dumps(d, indent=2)[:800])'
sleep 2
inspect_state "after_switch_ollama_again"
assert_recreated_manual_only || true

HTTP_P3=$(curl -sS -o /tmp/byok-patch3.json -w '%{http_code}' -X PATCH "$API/api/auth/me" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "$PATCH1")
echo "patch3_platform_HTTP=$HTTP_P3"
python3 -c 'import json; d=json.load(open("/tmp/byok-patch3.json")); u=d.get("user") or d; print("llm_provider=", (u.get("llm_provider") if isinstance(u,dict) else None) or d.get("llm_provider"))'
LLM3=$(python3 -c 'import json; d=json.load(open("/tmp/byok-patch3.json")); u=d.get("user") or d; print((u.get("llm_provider") if isinstance(u,dict) else None) or d.get("llm_provider") or "")')
if [ "$LLM3" != "platform_decided" ]; then
  fail "second switchback did not set platform_decided (got $LLM3)"
else
  pass "second switchback llm_provider=platform_decided"
fi
sleep 2
inspect_state "after_switchback_2"
assert_cleanup "switchback_2" || true

# ---------- Step 4: COO chat should use openai not ollama ----------
echo ""
echo "=== STEP 4: COO chat after final platform_decided (openai not ollama) ==="
CHAT_BODY='{"message":"Reply with exactly one word: PLATFORM_OK. Do not mention ollama."}'
HTTP_CHAT=$(curl -sS -o /tmp/byok-chat-final.json -w '%{http_code}' -X POST "$API/api/agents/balserve/chat" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "$CHAT_BODY" \
  --max-time 180)
echo "chat_HTTP=$HTTP_CHAT"
python3 -c 'import json; d=json.load(open("/tmp/byok-chat-final.json")); print(json.dumps(d, indent=2)[:2500])' 2>/dev/null || head -c 2500 /tmp/byok-chat-final.json; echo

# Evidence from logs / response for provider used
echo "--- log evidence (openai vs ollama) ---"
docker logs "$OC" --since 5m 2>&1 | grep -E "${COO_AGENT}|${PROVIDER}|openai|ollama|chat/completions|PLATFORM_OK|ProviderAuthError" | tail -40
docker logs "$BE" --since 5m 2>&1 | grep -E "${COO_AGENT}|${PROVIDER}|openai|ollama|balserve/chat|syncByok|platform_decided" | tail -30

python3 <<PY
import json, re, subprocess, sys
ok=True
def fail(m):
  global ok; ok=False; print("FAIL:", m)
def pass_(m): print("PASS:", m)
raw=open("/tmp/byok-chat-final.json").read()
try:
  d=json.loads(raw)
except Exception:
  d={"_raw": raw[:2000]}
text=json.dumps(d).lower()
print("response_provider_hints=", [])
logs=""
try:
  logs=subprocess.check_output(["docker","logs","agent-os-openclaw-1","--since","5m"], stderr=subprocess.STDOUT, text=True, errors="replace")
except Exception as e:
  logs=str(e)
provider="$PROVIDER"
# Prefer evidence from the most recent model-fetch for this provider / openai
recent = logs[-8000:] if len(logs) > 8000 else logs
used_ollama = bool(re.search(r"provider="+re.escape(provider)+r".*ollama:11434|url=http://ollama:11434", recent, re.I|re.S))
used_openai = bool(re.search(r"api\.openai\.com|provider=openai", recent, re.I))
print(f"recent_used_ollama_byok={used_ollama} recent_openai_signal={used_openai}")
has_auth_err="providerautherror" in text or "ProviderAuthError" in raw
has_reply=("platform_ok" in text) or ("PLATFORM_OK" in raw)
insp=json.load(open("/tmp/byok-inspect-last.json"))
prim=str(insp.get("model_primary") or "")
print("final_model_primary=", prim)
if prim.startswith("byok-") or "ollama" in prim.lower():
  fail(f"COO still on ollama/byok primary: {prim}")
else:
  pass_(f"COO model.primary is not ollama/byok ({prim or 'empty/cleared'})")
if used_ollama:
  fail("COO chat log still shows ollama/byok fetch after platform_decided")
elif used_openai or (not prim.startswith("byok-") and not has_auth_err):
  pass_("COO chat uses non-ollama path (openai/platform)")
if has_auth_err:
  fail("COO chat returned ProviderAuthError")
else:
  pass_("COO chat no ProviderAuthError")
http=int("$HTTP_CHAT" or "0")
if http == 200 or has_reply:
  pass_(f"COO chat brief check HTTP={http} has_PLATFORM_OK={has_reply}")
else:
  fail(f"COO chat brief check failed HTTP={http} body_head={raw[:400]}")
sys.exit(0 if ok else 1)
PY
CHAT_RC=$?
if [ $CHAT_RC -ne 0 ]; then FAILS=$((FAILS+1)); else PASS_N=$((PASS_N+1)); fi

echo ""
echo "=== OVERALL ==="
echo "EMAIL=$EMAIL USER_ID=$USER_ID PROVIDER=$PROVIDER COO_AGENT=$COO_AGENT"
echo "PASS_GROUPS≈$PASS_N FAIL_GROUPS≈$FAILS"
if [ "$FAILS" -eq 0 ]; then
  echo "VERDICT=PASS"
  exit 0
else
  echo "VERDICT=FAIL"
  exit 1
fi
