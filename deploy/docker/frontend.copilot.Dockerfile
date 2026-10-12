ARG BASE_IMAGE
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
ENV VITE_API_URL=/api
RUN npm run test:chat && npm run build
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.copilot.revision=${RELEASE_REVISION}
COPY --from=build /app/dist /usr/share/nginx/html
