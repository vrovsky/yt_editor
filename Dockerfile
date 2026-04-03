# ── Stage 1: Build Rust NAPI binary ──────────────────────────────────
FROM rust:1.77-bookworm AS rust-builder

RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*

WORKDIR /app/rust-media-engine
COPY rust-media-engine/Cargo.toml rust-media-engine/Cargo.lock rust-media-engine/build.rs ./
COPY rust-media-engine/src ./src

# Install napi-cli and build
RUN npm install -g @napi-rs/cli
RUN cargo build --release
RUN napi build --release --platform

COPY rust-media-engine/package.json rust-media-engine/index.js rust-media-engine/index.d.ts ./

# ── Stage 2: Build TypeScript backend + frontend ─────────────────────
FROM node:20-bookworm-slim AS app-builder

WORKDIR /app

# Copy monorepo structure
COPY package.json package-lock.json* ./
COPY editor-backend/package.json editor-backend/
COPY web-editor-ui/package.json web-editor-ui/

# Copy Rust build output as a workspace package
COPY --from=rust-builder /app/rust-media-engine /app/rust-media-engine

# Install all dependencies
RUN npm install --ignore-scripts 2>/dev/null || npm install

# Copy source
COPY editor-backend/src editor-backend/src
COPY editor-backend/tsconfig.json editor-backend/
COPY editor-backend/vitest.config.ts editor-backend/
COPY web-editor-ui/src web-editor-ui/src
COPY web-editor-ui/tsconfig.json web-editor-ui/
COPY web-editor-ui/vite.config.ts web-editor-ui/
COPY web-editor-ui/index.html web-editor-ui/

# Build backend (TypeScript → JavaScript)
RUN npm --workspace=editor-backend run build

# Build frontend (Vite → static files)
RUN npm --workspace=web-editor-ui run build:app

# ── Stage 3: Production runtime ─────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artifacts
COPY --from=app-builder /app/package.json ./
COPY --from=app-builder /app/editor-backend/package.json editor-backend/
COPY --from=app-builder /app/editor-backend/dist editor-backend/dist
COPY --from=app-builder /app/web-editor-ui/dist web-editor-ui/dist
COPY --from=app-builder /app/rust-media-engine rust-media-engine
COPY --from=app-builder /app/node_modules node_modules
COPY --from=app-builder /app/editor-backend/node_modules editor-backend/node_modules

# Create data and public directories
RUN mkdir -p /app/data /app/public

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data

EXPOSE 3001

VOLUME ["/app/data", "/app/public"]

CMD ["node", "--max-old-space-size=4096", "editor-backend/dist/server.js"]
