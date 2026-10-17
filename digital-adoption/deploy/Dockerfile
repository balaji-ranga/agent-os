ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /adoption
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY web ./web
COPY integrations ./integrations
USER 1000:1000
EXPOSE 4193
CMD ["node","src/runtime.mjs"]
