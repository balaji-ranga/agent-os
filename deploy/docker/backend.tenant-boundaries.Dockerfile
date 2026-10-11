# Apply a reviewed scoped patch to captured production source, retaining parallel
# releases. A normal clean build uses backend.Dockerfile and includes the same files.
ARG BASE_IMAGE=agent-os-backend:latest
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.tenant-boundaries.revision=${RELEASE_REVISION}
WORKDIR /opt/agent-os/backend
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/package.json ./package.json
RUN npm run test:security:tenant-tools
