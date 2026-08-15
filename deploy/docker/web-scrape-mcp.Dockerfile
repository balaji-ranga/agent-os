# Generic web-scrape MCP (Crawlee Cheerio + optional Playwright Chromium)
FROM node:22-bookworm
WORKDIR /app
COPY tools/web-scrape-mcp/package.json ./
RUN npm install --omit=dev \
  && npx playwright install --with-deps chromium
COPY tools/web-scrape-mcp/ ./
ENV WEB_SCRAPE_MCP_PORT=8085
ENV CRAWLEE_PURGE_ON_START=1
EXPOSE 8085
HEALTHCHECK --interval=30s --timeout=8s --retries=5 --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:8085/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
