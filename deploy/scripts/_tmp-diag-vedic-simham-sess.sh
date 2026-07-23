#!/bin/bash
set -euo pipefail
# Compact session inspection for vedic agent
docker exec agent-os-openclaw-1 sh -c '
echo "=== tree ==="
find /root/.openclaw/agents/t-ceo-bala--vedic-astrology -maxdepth 3 \( -type d -o -name "*.jsonl" -o -name "sessions.json" -o -name "*.json" \) 2>/dev/null | head -80
echo "=== sessions dir ==="
ls -la /root/.openclaw/agents/t-ceo-bala--vedic-astrology/sessions 2>/dev/null || echo NO_SESSIONS_DIR
echo "=== grep pollution in vedic agent only ==="
grep -RIn -E "teamwork|OpenClaw.s internal|request handler|how is simham" /root/.openclaw/agents/t-ceo-bala--vedic-astrology --include="*.jsonl" 2>/dev/null | cut -c1-300 | tail -40 || true
echo "=== last 3 user/assistant turns from newest jsonl ==="
NEWEST=$(find /root/.openclaw/agents/t-ceo-bala--vedic-astrology -name "*.jsonl" ! -name "*.trajectory.jsonl" -printf "%T@ %p\n" 2>/dev/null | sort -nr | head -1 | cut -d" " -f2-)
echo "NEWEST=$NEWEST"
if [ -n "$NEWEST" ]; then
  # print last few lines truncated
  tail -n 8 "$NEWEST" | cut -c1-400
  echo "--- counts ---"
  grep -c "teamwork" "$NEWEST" || true
  grep -c "simham" "$NEWEST" || true
  grep -c "request handler" "$NEWEST" || true
fi
'
