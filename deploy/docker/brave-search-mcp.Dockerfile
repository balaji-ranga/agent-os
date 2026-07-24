# Brave Search MCP — bring-your-own-key (workflow headers only; no BRAVE_API_KEY fallback).
FROM node:22-bookworm-slim
WORKDIR /app
COPY tools/brave-search-mcp-byok/server.js ./server.js
ENV BRAVE_MCP_PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
