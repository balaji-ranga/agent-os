#!/bin/bash
docker compose -f /opt/agent-os/deploy/docker-compose.yml exec -T openclaw \
  head -n 150 /usr/local/lib/node_modules/openclaw/dist/plugin-sdk/tool-plugin.d.ts
