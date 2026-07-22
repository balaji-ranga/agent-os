# Agent OS frontend — Vite SPA (hPanel light shell, fullscreen workflow editor, OrgDesigner dashboard)
# Build context: repo root (see docker-compose.yml). No special build-args beyond VITE_API_URL.
# After rebuild, always recreate nginx so the reverse proxy picks up the new container IP.
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
