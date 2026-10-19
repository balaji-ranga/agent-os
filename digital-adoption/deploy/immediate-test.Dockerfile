# Disposable Linux regression image. Never deploy as the service.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /adoption
COPY --chown=1000:1000 test ./test
COPY --chown=1000:1000 deploy ./deploy
USER 1000:1000
CMD ["node", "--test", "--test-concurrency=2", "test/*.test.mjs"]
