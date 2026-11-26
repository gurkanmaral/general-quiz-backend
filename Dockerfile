FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Local development (docker compose): tsx watch over the bind-mounted src/ and content/.
FROM deps AS dev
COPY . .
EXPOSE 8787
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

# Production image (the default target of `docker build .`).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/content ./content
COPY --from=build /app/package.json ./
EXPOSE 8787
CMD ["node", "--enable-source-maps", "dist/server.js"]
