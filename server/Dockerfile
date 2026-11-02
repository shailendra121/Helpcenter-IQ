FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY dashboard/package.json dashboard/
RUN npm ci --workspace=server --include-workspace-root
COPY server server
RUN npm run build --workspace=server

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY dashboard/package.json dashboard/
RUN npm ci --workspace=server --include-workspace-root --omit=dev
COPY --from=build /app/server/dist server/dist
COPY server/src/db/migrations server/src/db/migrations
WORKDIR /app/server
CMD ["node", "dist/index.js"]