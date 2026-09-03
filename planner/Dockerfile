FROM python:3.14-slim

WORKDIR /app

# tini + curl for signal handling and health probing (mirrors backend/Dockerfile)
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Audit M-8 parity: no dev extras baked into the runtime image — requirements.txt
# is already prod-only (torch + geometric + scipy + fastapi + uvicorn + pydantic).
# Use --no-cache-dir to keep the layer small and deterministic.
RUN pip install --no-cache-dir -r requirements.txt

COPY qtrust_planner/ qtrust_planner/
COPY server.py .
COPY data/ data/
# Include only tracked checkpoints in the release image. The server's
# resolution chain prefers the v3 GPU model, then DDP, then the RL model.
COPY model_gpu_v3.pt model_ddp_v3.pt rl_agent.pt ./

# model.pt and real-data variants remain optional operator-provided overrides;
# the image is still functional with the tracked v3 checkpoint.
RUN if [ -f "model.pt" ]; then echo "model.pt present"; else echo "model.pt absent — serving v3 checkpoint"; fi

# For large experimental models (>500KB), publish as GitHub Release assets with SHA256 manifest
# (models.sha256 / registry/) rather than blobs; images fetch at build time via `curl -L`.

EXPOSE 8000

# Run as non-root for security (mirrors backend/Dockerfile)
RUN groupadd -r planner && useradd -r -g planner -m planner

RUN chown -R planner:planner /app
USER planner

# Audit D-7: orchestrators need a health signal for restarts/rollouts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]