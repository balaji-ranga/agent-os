# DeepSeek V3 OpenAI-compatible proxy (optional — profile optional-deepseek)
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY deploy/docker/deepseek-proxy.js ./deepseek-proxy.js

ENV DEEPSEEK_PROXY_PORT=8080
ENV DEEPSEEK_UPSTREAM_URL=https://api.deepseek.com/v1
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD curl -fsS "http://127.0.0.1:8080/health" || exit 1

CMD ["node", "deepseek-proxy.js"]
