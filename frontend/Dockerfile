FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# Dev stage to support vite dev server with HMR inside docker-compose (profiles: dev)
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
RUN npm install -g serve
CMD ["serve", "-s", "dist", "-l", "5173"]
