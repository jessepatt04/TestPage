# Small, fast Node base image
FROM node:20-alpine

# Workdir inside the container
WORKDIR /usr/src/app

# Install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy the app code
COPY ../package.json ../package-lock.json* ./
COPY ../server.js ./

# API port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]