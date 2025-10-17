# Stage 1: Build the application
FROM node:20 AS builder

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies, including devDependencies for building
RUN npm install

# Install Playwright browsers
RUN npx playwright install --with-deps chromium

# Copy the rest of the application source code
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build


# Stage 2: Production image
FROM mcr.microsoft.com/playwright:v1.56.0-jammy

WORKDIR /app

# Copy production node_modules from the builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy the compiled JavaScript output from the builder stage
COPY --from=builder /app/dist ./dist

# Copy Playwright browser binaries from the builder stage
COPY --from=builder /root/.cache/ms-playwright /root/.cache/ms-playwright

# Copy package.json to the production image
COPY package.json .

# Command to run the application
CMD ["node", "dist/index.js"]
