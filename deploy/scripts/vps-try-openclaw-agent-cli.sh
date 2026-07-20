#!/bin/bash
set -euo pipefail
echo "=== openclaw agent help ==="
docker exec agent-os-openclaw-1 openclaw agent --help 2>&1 | head -n 60
echo "=== try agent message ==="
docker exec agent-os-openclaw-1 openclaw agent --agent balserve --message "Reply with exactly PONG. Do not use tools." --json 2>&1 | tail -n 40
