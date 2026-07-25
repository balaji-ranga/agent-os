#!/usr/bin/env bash
# Report which UI markers exist in the served frontend bundle (nginx container).
set -u
cd /opt/agent-os/deploy || exit 1
BUNDLE=$(docker compose exec -T frontend sh -c 'ls /usr/share/nginx/html/assets/*.js' | tr -d '\r')
echo "bundle: $BUNDLE"
for marker in created_at_display server_timezone timeZoneName kanban-task-tooltip-meta "Times in " "From the agent chat" "No activity recorded for this task" "Run status checker" "Storage (MB)" "Data persistence"; do
  n=$(docker compose exec -T frontend sh -c "grep -c '$marker' $BUNDLE" | tr -d '\r')
  printf '  %-28s %s\n' "$marker" "$n"
done
