#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy

docker cp /tmp/test-email-workflow-resume.js agent-os-backend-1:/opt/agent-os/backend/scripts/
docker cp /tmp/test-sample-job-discovery-email-workflow.js agent-os-backend-1:/opt/agent-os/backend/scripts/
docker cp /tmp/test-pipeline-discovery-success.js agent-os-backend-1:/opt/agent-os/backend/scripts/
docker exec agent-os-backend-1 mkdir -p /opt/agent-os/tests
docker cp /tmp/api-smoke.js agent-os-backend-1:/opt/agent-os/tests/api-smoke.js

echo "======== 1 API smoke ========"
docker exec -e BASE_URL=http://127.0.0.1:3001 agent-os-backend-1 node /opt/agent-os/tests/api-smoke.js || true

echo "======== 2 Simple email send workflow ========"
docker exec \
  -e WORKFLOW_TEST_EMAIL_TO=balaji.x.ranga@gmail.com \
  -w /opt/agent-os/backend \
  agent-os-backend-1 \
  node scripts/test-email-workflow-resume.js

echo "======== 3 Job discovery plus email workflow ========"
docker exec \
  -e WORKFLOW_TEST_EMAIL_TO=balaji.x.ranga@gmail.com \
  -e WORKFLOW_TEST_AGENT_WAIT_MS=45000 \
  -w /opt/agent-os/backend \
  agent-os-backend-1 \
  node scripts/test-sample-job-discovery-email-workflow.js

echo "======== 4 Job pipeline discovery ========"
docker exec \
  -e PIPELINE_E2E_TIMEOUT_MS=600000 \
  -e PIPELINE_E2E_POLL_MS=10000 \
  -w /opt/agent-os/backend \
  agent-os-backend-1 \
  node scripts/test-pipeline-discovery-success.js

echo ALL_E2E_DONE
