# Brave Search MCP (HTTP) — Agent OS cannot use stdio MCP yet.
# Docs: https://github.com/brave/brave-search-mcp-server
FROM node:22-bookworm-slim

WORKDIR /app
RUN npm install --omit=dev @brave/brave-search-mcp-server@latest \
  && npm cache clean --force

ENV BRAVE_MCP_TRANSPORT=http \
    BRAVE_MCP_HOST=0.0.0.0 \
    BRAVE_MCP_PORT=8080 \
    BRAVE_MCP_LOG_LEVEL=info \
    BRAVE_MCP_STATELESS=true \
    BRAVE_MCP_ENABLED_TOOLS="brave_web_search brave_news_search brave_llm_context"

EXPOSE 8080

# Package bin is typically `brave-search-mcp-server`
CMD ["npx", "--no-install", "brave-search-mcp-server", "--transport", "http", "--host", "0.0.0.0", "--port", "8080"]
