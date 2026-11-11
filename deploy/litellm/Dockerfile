ARG LITELLM_BASE_IMAGE=docker.litellm.ai/berriai/litellm:main-latest
FROM ${LITELLM_BASE_IMAGE}
COPY deploy/scripts/install-litellm-realtime-route.py /tmp/flolah-realtime.py
COPY deploy/scripts/install-litellm-ollama-limits.py /tmp/flolah-ollama.py
RUN /app/.venv/bin/python -c "import litellm,pathlib,subprocess; p=pathlib.Path(litellm.__file__).parent; subprocess.run(['/app/.venv/bin/python','/tmp/flolah-realtime.py',str(p/'proxy/realtime_endpoints/endpoints.py')],check=True); subprocess.run(['/app/.venv/bin/python','/tmp/flolah-ollama.py',str(p/'llms/ollama/chat/transformation.py')],check=True)"
