# ---- Stage 1: Build ----
FROM node:20-slim AS builder

WORKDIR /build

# Install build dependencies for native modules
# python3, make, g++: required by node-gyp for bcrypt, better-sqlite3
# libvips-dev: required by sharp for image processing
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first for Docker layer caching
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for Tailwind build)
RUN npm ci

# Copy application source
COPY . .

# Build Tailwind CSS (minified production output)
RUN npx tailwindcss -i ./public/css/input.css -o ./public/css/style.css --minify

# Prune devDependencies — native modules remain compiled and functional
RUN npm prune --omit=dev

# ---- Stage 2: Production ----
FROM node:20-slim AS runtime

WORKDIR /app

# Install runtime dependency for sharp (no -dev headers needed)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libvips42 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for container security
RUN groupadd --gid 1001 appuser && \
    useradd --uid 1001 --gid appuser --shell /bin/bash --create-home appuser

# Copy production artifacts from builder
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./
COPY --from=builder /build/server ./server
COPY --from=builder /build/public ./public
COPY --from=builder /build/tailwind.config.js ./

# Create data directory owned by appuser
# Subdirectories (files/, tmp/, avatars/) are auto-created by the app at startup
RUN mkdir -p /app/data && chown appuser:appuser /app/data

ENV NODE_ENV=production

EXPOSE 3000

# Health check: HTTP GET to /login (always accessible without auth)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); const options = { hostname: 'localhost', port: process.env.PORT || 3000, path: '/login', timeout: 3000 }; const req = http.get(options, (res) => { process.exit(res.statusCode < 400 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.on('timeout', () => { req.destroy(); process.exit(1); });"

USER appuser

CMD ["node", "server/index.js"]
