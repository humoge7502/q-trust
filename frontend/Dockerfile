# Q-Trust frontend image - Next.js 16 production build.
#
# Build from the repository root so the context stays consistent with the
# backend/planner images:
#   docker build -f frontend/Dockerfile -t qtrust-frontend:2.2.0 ./frontend
#
# NEXT_PUBLIC_* values are baked into the browser bundle at build time. Pass
# them as build args (or let Vercel inject them for the Vercel deployment).
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# ---- deps ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- prod deps ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- build ----
FROM deps AS build
COPY . .

ARG NEXT_PUBLIC_QTRUST_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_QTRUST_CHAIN_ID=84532
ARG NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC=https://sepolia.base.org
ARG NEXT_PUBLIC_QTRUST_USE_MAINNET=false
ARG NEXT_PUBLIC_QTRUST_ASSET_REGISTRY_ADDRESS=0x0000000000000000000000000000000000000000
ARG NEXT_PUBLIC_QTRUST_VENDOR_REGISTRY_ADDRESS=0x0000000000000000000000000000000000000000
ARG NEXT_PUBLIC_QTRUST_MIGRATION_REGISTRY_ADDRESS=0x0000000000000000000000000000000000000000
ARG NEXT_PUBLIC_QTRUST_AUDIT_REGISTRY_ADDRESS=0x0000000000000000000000000000000000000000
ARG NEXT_PUBLIC_IPFS_GATEWAY=https://ipfs.io/ipfs/
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=00000000000000000000000000000000
ARG NEXT_PUBLIC_QTRUST_SITE_URL=http://localhost:3000

ENV NEXT_PUBLIC_QTRUST_API_URL=$NEXT_PUBLIC_QTRUST_API_URL \
    NEXT_PUBLIC_QTRUST_CHAIN_ID=$NEXT_PUBLIC_QTRUST_CHAIN_ID \
    NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC=$NEXT_PUBLIC_QTRUST_BASE_SEPOLIA_RPC \
    NEXT_PUBLIC_QTRUST_USE_MAINNET=$NEXT_PUBLIC_QTRUST_USE_MAINNET \
    NEXT_PUBLIC_QTRUST_ASSET_REGISTRY_ADDRESS=$NEXT_PUBLIC_QTRUST_ASSET_REGISTRY_ADDRESS \
    NEXT_PUBLIC_QTRUST_VENDOR_REGISTRY_ADDRESS=$NEXT_PUBLIC_QTRUST_VENDOR_REGISTRY_ADDRESS \
    NEXT_PUBLIC_QTRUST_MIGRATION_REGISTRY_ADDRESS=$NEXT_PUBLIC_QTRUST_MIGRATION_REGISTRY_ADDRESS \
    NEXT_PUBLIC_QTRUST_AUDIT_REGISTRY_ADDRESS=$NEXT_PUBLIC_QTRUST_AUDIT_REGISTRY_ADDRESS \
    NEXT_PUBLIC_IPFS_GATEWAY=$NEXT_PUBLIC_IPFS_GATEWAY \
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID \
    NEXT_PUBLIC_QTRUST_SITE_URL=$NEXT_PUBLIC_QTRUST_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Run as a non-root user.
RUN addgroup -S qtrust && adduser -S -G qtrust qtrust

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs

RUN chown -R qtrust:qtrust /app
USER qtrust

EXPOSE 3000

# Next.js reads HOSTNAME for binding; the default (0.0.0.0 in the standalone
# server, localhost otherwise) is not suitable inside a container.
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:3000/ || exit 1

CMD ["npm", "start"]
