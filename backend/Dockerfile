# =============================================================================
# Dockerfile - Sano MQTT Backend
# Node.js 18 Alpine
# =============================================================================

FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./

RUN npm install --omit=dev && npm cache clean --force

# Copy application source
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001 && \
    chown -R nodeuser:nodejs /app

USER nodeuser

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start application
CMD ["node", "server.js"]
