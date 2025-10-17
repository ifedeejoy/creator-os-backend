# Stage 1: Build the application
FROM node:20 AS builder

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies, including devDependencies for building
RUN npm install

# Copy the rest of the application source code
COPY . .

# Compile TypeScript to JavaScript
# We'll add a build script to package.json if it doesn't exist
# For now, we assume `tsc` will compile `src` to `dist`
RUN npx tsc --outDir dist

# Prune devDependencies for a clean production node_modules
RUN npm prune --production


# Stage 2: Production image
FROM node:20-slim

WORKDIR /app

# Copy production node_modules from the builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy the compiled JavaScript output from the builder stage
COPY --from=builder /app/dist ./dist

# Copy package.json to the production image
COPY package.json .

# Expose the port the app runs on (if any, good practice)
# ENV PORT 3001
# EXPOSE 3001

# Command to run the application
CMD ["node", "dist/index.js"]
