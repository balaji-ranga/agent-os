FROM node:22-alpine
WORKDIR /app
COPY services/messaging-listener/package*.json ./
RUN npm ci --omit=dev
COPY services/messaging-listener/src ./src
USER node
EXPOSE 8090
CMD ["node", "src/index.js"]
