#!/usr/bin/env bash
# Verify the org-member delegation fixes are live on the VPS image:
#  - A2A replies are extracted from both JSON-RPC result shapes
#  - COO classifier keys are stripped of AGENTS.md markdown before routing
#  - budget / ACL refusals no longer spend a member's error budget
# Runs the two self-cleaning e2e packs and checks the deployed help doc.
#
# Usage (on VPS): bash /opt/agent-os/deploy/scripts/vps-verify-org-delegation.sh
set -u
cd /opt/agent-os/deploy

fails=0
step() { echo; echo "==> $1"; }
expect() {
  if [ "$1" -eq 0 ]; then echo "    OK  $2"; else echo "   FAIL $2"; fails=$((fails + 1)); fi
}

run_in_backend() {
  docker compose exec -T -w /opt/agent-os/backend backend "$@"
}

step "org leaf member delegation e2e (self-cleaning)"
out=$(run_in_backend node scripts/test-org-member-delegation-e2e.js 2>&1)
echo "$out" | tail -5
echo "$out" | grep -q '\[e2e\] PASS'
expect $? "org member delegation e2e"

step "A2A private visibility e2e (self-cleaning)"
out=$(run_in_backend node scripts/test-a2a-private-visibility.js 2>&1)
echo "$out" | tail -4
echo "$out" | grep -q '\[e2e\] PASS'
expect $? "A2A private visibility e2e"

step "deployed backend source carries the fixes"
run_in_backend grep -q 'extractA2AReply' src/services/org-member-delegation.js
expect $? "A2A reply extraction handles message + task shapes"
run_in_backend grep -q 'normalizeAllocationKey' src/services/coo-specialty-delegation.js
expect $? "COO classifier strips markdown from allocated ids"
run_in_backend grep -q 'budget blocked member=' src/services/org-member-delegation.js
expect $? "budget refusal logged without an invocation record"

step "help doc propagated"
grep -q 'never spend the error budget' /opt/agent-os/knowledgebase/platform-help/18-agent-budgets-and-org-members.md
expect $? "18-agent-budgets-and-org-members.md updated on disk"

echo
if [ "$fails" -eq 0 ]; then
  echo "VPS_ORG_DELEGATION_VERIFY_OK"
else
  echo "VPS_ORG_DELEGATION_VERIFY_FAILED fails=$fails"
  exit 1
fi
