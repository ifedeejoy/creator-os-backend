# Stage 1: Build the application
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci --only=production=false

# Copy source code
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build


# Stage 2: Production image with Playwright
FROM mcr.microsoft.com/playwright:v1.56.0-jammy

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# Copy package.json
COPY package.json ./

# Set environment variables for Cloud Run
ENV NODE_ENV=production
ENV SCRAPER_HEADLESS=true
ENV PORT=8080

# Expose port (Cloud Run uses PORT env var)
EXPOSE 8080

# Health check for local testing (Cloud Run uses HTTP probes)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1);})"

# Run the application
CMD ["node", "dist/index.js"]
