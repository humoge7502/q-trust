# syntax=docker/dockerfile:1.6
# Q-Trust backend image — runs the API server, indexer, and webhook fan-out.
#
# IMPORTANT: build context must be the repository root (the image bundles the
# Python inspector package):
#   docker build -f backend/Dockerfile -t qtrust-backend .
#   docker run -p 3001:3001 --env-file .env qtrust-backend
#
# Webhook fan-out is owned by the API indexer process; there is no separate
# webhook worker entrypoint in this image.

FROM node:20-bookworm-slim AS base
WORKDIR /app

# Install tini and curl for signal handling and healthchecks.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---- deps ----
# Audit M-8: two dep trees — full (with devDependencies) for the build stage,
# production-only for the runtime image so dev-only binaries (tsx/esbuild,
# vitest workers) are not shipped to production.
FROM base AS deps
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# ---- prod-deps ----
FROM base AS prod-deps
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ---- build ----
FROM deps AS build
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/
# Type-check + emit JS to dist/ — fail hard on build errors
RUN npm run build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3001

# python3 runs the cryptographic inspector shelled out to by /v1/scan/* routes;
# wget is a dependency-free healthcheck fallback alongside curl.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv wget \
    && rm -rf /var/lib/apt/lists/*

# Install the inspector into a dedicated venv so `QTRUST_INSPECTOR_PYTHON`
# resolves for any user (including the non-root runtime user below) without
# violating PEP 668 via --break-system-packages.
#
# The optional ML extras (numpy + CPU-only torch) power the GPU-bridge
# side-channel and anomaly models. CPU wheels run the sub-MB model files fine
# and avoid the multi-GB CUDA wheel set. Model weights are copied to
# /opt/qtrust-models before the source tree is discarded.
COPY inspector/ /inspector/
RUN python3 -m venv /opt/inspector-venv \
    && /opt/inspector-venv/bin/pip install --no-cache-dir /inspector \
    && /opt/inspector-venv/bin/pip install --no-cache-dir numpy \
    && /opt/inspector-venv/bin/pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && mkdir -p /opt/qtrust-models \
    && cp /inspector/anomaly_model.pt /inspector/side_channel_model.pt /inspector/side_channel_model_real.pt /opt/qtrust-models/ \
    && rm -rf /inspector

EXPOSE 3001

ENV QTRUST_INSPECTOR_PYTHON=/opt/inspector-venv/bin/python3
ENV QTRUST_SIDE_CHANNEL_MODEL=/opt/qtrust-models/side_channel_model.pt
ENV QTRUST_ANOMALY_MODEL=/opt/qtrust-models/anomaly_model.pt

# Run as non-root for security
RUN groupadd -r qtrust && useradd -r -g qtrust -m qtrust

# Audit L-9: create + chown the default evidence-chain directory so the
# non-root runtime user can persist /var/lib/qtrust/evidence_chain.jsonl
# (previously mkdir failed with EACCES and the chain silently degraded to
# in-memory only, losing all evidence on restart).
# The scan root exists even when no host volume is mounted (Render deploys).
RUN mkdir -p /var/lib/qtrust /workspace/projects \
    && chown -R qtrust:qtrust /var/lib/qtrust /workspace/projects

# Copy PRODUCTION node_modules and built JS only — no devDependencies in the
# runtime image (audit M-8), no source code.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# tsc only emits .js; the indexer reads schema.sql at runtime from dist/db.
COPY backend/src/db/schema.sql ./dist/db/schema.sql
COPY --from=build /app/package.json ./package.json
COPY backend/scripts/run_inspector.py backend/scripts/gpu_bridge.py ./scripts/
# Python-side planner utility package (quantum resource estimator) consumed by
# the GPU bridge's `quantum-estimate` subcommand. The bridge resolves it from a
# /planner directory at the container root, so it must be copied there.
COPY planner/qtrust_planner /planner/qtrust_planner

RUN chown -R qtrust:qtrust /app
USER qtrust

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:3001/v1/health || exit 1

# tini reaps zombies and forwards signals correctly to Node.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
