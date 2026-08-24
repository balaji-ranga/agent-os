FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-minimal ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /runner
COPY backend/scripts/custom-script-runner-worker.mjs ./custom-script-runner-worker.mjs
COPY backend/scripts/custom-script-sandbox.mjs ./custom-script-sandbox.mjs
COPY backend/scripts/custom-script-sandbox.py ./custom-script-sandbox.py

ENV NODE_ENV=production CUSTOM_SCRIPT_RUNNER_JOBS_DIR=/jobs
CMD ["node", "custom-script-runner-worker.mjs"]
