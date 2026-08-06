# Meta Graph MCP — Bearer token per request (Agent OS MCP OAuth).
FROM node:22-bookworm-slim
WORKDIR /app
COPY tools/meta-graph-mcp/server.js ./server.js
ENV META_GRAPH_MCP_PORT=8081
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8081/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
