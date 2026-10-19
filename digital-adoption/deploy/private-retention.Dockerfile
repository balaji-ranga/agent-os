# Preserve parser dependencies and all installed runtimes from the captured
# live image. The standard Dockerfile also includes these source files.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /adoption
COPY --chown=1000:1000 src/opensearch.mjs src/private-task-search.mjs src/private-tasks.mjs src/runtime.mjs ./src/
COPY --chown=1000:1000 web/session-client.mjs web/task-panel.mjs web/widget.mjs ./web/
USER 1000:1000
