# =============================================================================
# ANT CLI Dockerfile
# Multi-stage build for Node.js 22 Alpine
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Stage
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

# Install build dependencies for native modules (better-sqlite3, sharp, etc.)
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./
COPY ui/package.json ui/package-lock.json* ./ui/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Install UI dependencies
WORKDIR /app/ui
RUN npm ci

# Copy source files
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
COPY ui ./ui

# Build TypeScript (backend)
RUN npm run build

# Build UI (frontend)
RUN npm run ui:build

# -----------------------------------------------------------------------------
# Stage 2: Production Stage
# -----------------------------------------------------------------------------
FROM node:22-alpine AS production

# Install runtime dependencies for native modules
RUN apk add --no-cache \
    # For better-sqlite3
    sqlite \
    # For sharp image processing
    vips-dev \
    # For Playwright/Chromium (if needed at runtime)
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    tini

# Set Playwright to use system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/ui/dist ./ui/dist

# Copy configuration files (if they exist in the build context)
COPY ant.config*.json ./
COPY .env.example ./.env.example

# Create non-root user for security
RUN addgroup -g 1001 -S antgroup && \
    adduser -S antuser -u 1001 -G antgroup

# Create necessary directories and set permissions
RUN mkdir -p /app/.ant /app/data && \
    chown -R antuser:antgroup /app

# Switch to non-root user
USER antuser

# Environment variables
ENV NODE_ENV=production
ENV ANT_CONFIG_PATH=/app/ant.config.json
ENV ANT_UI_HOST=0.0.0.0
ENV ANT_UI_PORT=5117
ENV ANT_GATEWAY_HOST=0.0.0.0
ENV ANT_GATEWAY_PORT=5117
ENV ANT_WHATSAPP_ENABLED=false
ENV ANT_DATA_DIR=/app/data

# Expose ports
EXPOSE 5117

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5117/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

# Entry point - run the CLI
ENTRYPOINT ["/sbin/tini", "--", "node", "dist/cli.js"]

# Default command (can be overridden)
CMD ["start"]
