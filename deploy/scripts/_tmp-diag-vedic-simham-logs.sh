#!/bin/bash
set -euo pipefail
echo "===== logs last 2h filtered ====="
docker logs agent-os-openclaw-1 --since 2h 2>&1 | grep -iE 'vedic|simham|teamwork|master_data_rag|notify_ceo|request.handler|gpt-4o|deepseek|ollama|fallback|429|400|t-ceo-bala--vedic|openai-responses|ProviderAuth|tool call|tools' | tail -250 || true

echo ""
echo "===== timestamps 01:45-01:55 ====="
docker logs agent-os-openclaw-1 --since 90m --timestamps 2>&1 | grep -E '2026-07-23T01:(4[5-9]|5[0-5])' | tail -200 || true

echo ""
echo "===== session tree vedic ====="
docker exec agent-os-openclaw-1 sh -c 'ls -la /root/.openclaw/agents/t-ceo-bala--vedic-astrology/; find /root/.openclaw/agents/t-ceo-bala--vedic-astrology -maxdepth 3 -type f | head -50; ls -lt /root/.openclaw/agents/t-ceo-bala--vedic-astrology/sessions 2>/dev/null | head -20'

echo ""
echo "===== grep teamwork/simham in vedic sessions ====="
docker exec agent-os-openclaw-1 sh -c 'grep -RIn -E "teamwork|simham|request.handler|master_data_rag|notify_ceo|OpenClaw.s internal" /root/.openclaw/agents/t-ceo-bala--vedic-astrology --include="*.jsonl" 2>/dev/null | tail -80 || true'

echo ""
echo "===== newest jsonl mtime under vedic ====="
docker exec agent-os-openclaw-1 sh -c 'find /root/.openclaw/agents/t-ceo-bala--vedic-astrology -name "*.jsonl" -printf "%T@ %p\n" 2>/dev/null | sort -nr | head -10'
