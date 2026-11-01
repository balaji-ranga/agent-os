FROM node:22-bookworm-slim
WORKDIR /app/physical-edge
COPY physical-edge/package.json physical-edge/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY physical-edge/src ./src
COPY physical-edge/public ./public
COPY backend/src/services/physical/contracts.js /app/backend/src/services/physical/contracts.js
# The shared contract uses ESM without requiring the full backend installation.
RUN printf '{"type":"module"}\n' > /app/backend/package.json
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["node", "src/cli.js", "/config/gateway.json"]
