# OpenConnector MCP mock (optional — profile optional-openconnector)
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY tools/openconnector-mcp-mock/server.js ./server.js

ENV OPENCONNECTOR_MOCK_PORT=3105
EXPOSE 3105

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:3105/health" || exit 1

CMD ["node", "server.js"]
