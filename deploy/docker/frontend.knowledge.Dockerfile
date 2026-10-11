ARG BASE_IMAGE
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run test:chat && npm run build
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.knowledge.revision=${RELEASE_REVISION}
COPY --from=build /app/dist /usr/share/nginx/html
