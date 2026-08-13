# Flolah Social Research MCP — proxies owner-scoped social/places content tools
FROM node:22-bookworm-slim
WORKDIR /app
COPY tools/social-research-mcp/server.js ./server.js
ENV SOCIAL_RESEARCH_MCP_PORT=8084
EXPOSE 8084
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8084/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
