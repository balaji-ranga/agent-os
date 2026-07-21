# Local MCP random SSE test server (optional dev / workflow testing)
FROM node:22-bookworm-slim

WORKDIR /app
COPY tools/local-mcp-random-sse/server.js ./server.js

ENV MCP_RANDOM_PORT=3099
EXPOSE 3099

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_RANDOM_PORT||3099)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
