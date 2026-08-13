# Instagram Instaloader sidecar. Optional sessionid is passed per request (never logged).
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir instaloader flask
COPY tools/instaloader-sidecar/server.py ./server.py
ENV INSTALOADER_PORT=8083
EXPOSE 8083
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8083/health')"
CMD ["python", "server.py"]
