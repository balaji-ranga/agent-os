ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /adoption
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv tesseract-ocr tesseract-ocr-eng fonts-dejavu-core poppler-utils ffmpeg && rm -rf /var/lib/apt/lists/*
COPY deploy/requirements.txt /tmp/adoption-requirements.txt
RUN python3 -m venv /opt/adoption-python && /opt/adoption-python/bin/pip install --no-cache-dir -r /tmp/adoption-requirements.txt && rm /tmp/adoption-requirements.txt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY web ./web
COPY integrations ./integrations
USER 1000:1000
EXPOSE 4193
CMD ["node","src/runtime.mjs"]
