# Flolah Business Core MCP — CRM/ERP proxy for agents & workflows
FROM node:22-bookworm-slim
WORKDIR /app
COPY tools/business-core-mcp/server.js ./server.js
ENV BUSINESS_CORE_MCP_PORT=8082
EXPOSE 8082
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8082/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]