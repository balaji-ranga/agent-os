FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer libreoffice-calc poppler-utils tesseract-ocr \
    tesseract-ocr-eng tesseract-ocr-spa tesseract-ocr-fra tesseract-ocr-deu fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY tools/content-converter/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY tools/content-converter/converter.py tools/content-converter/server.py tools/content-converter/test_converter.py ./
RUN useradd --uid 10001 --no-create-home converter
USER 10001:10001
ENV HOME=/tmp PYTHONUNBUFFERED=1 OMP_THREAD_LIMIT=1
EXPOSE 8123
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8123/health',timeout=3)"
CMD ["python", "server.py"]
