# Agent OS frontend — Vite SPA (hPanel shell + light/dark theme, ThemeToggle,
# Agent Workspaces Add agent, Tools nav (/content-tools), fullscreen workflow editor,
# Scheduled goals (/scheduled-goals — create/edit/pause, hourly|daily|weekdays|weekly),
# Company setup (/company-setup),
# IBKR Summary (/ibkr-summary — portfolio + planned vs executed + Clear transactional data),
# OrgDesigner dashboard, Efficiency Agent View, Add-to-org for external/A2A leaf members,
# department purpose/budget UI, Master Data Purge all uploads + protected help/guide badges).
# Build context: repo root (see docker-compose.yml). No special build-args beyond VITE_API_URL.
# Sources must be UTF-8 (not UTF-16) or vite build fails with "Expected ; but found \\x00"
# (`frontend/scripts/check-utf8.mjs` runs as part of npm run build).
# After rebuild, always recreate nginx so the reverse proxy picks up the new container IP.
# Stale UI after sync: rebuild with NO_CACHE=1 / sync-to-vps.ps1 -NoCache.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/nginx/frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
