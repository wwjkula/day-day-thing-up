FROM node:22-alpine AS build
WORKDIR /app

# Install server dependencies
COPY package.json ./
RUN npm install

# Install and build frontend
COPY web/package.json web/package.json
RUN npm install --prefix web

# Copy source
COPY server ./server
COPY shared ./shared
COPY tsconfig.base.json ./tsconfig.base.json
COPY web ./web

RUN npm run build --prefix web
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/web/dist ./web/dist

# Default data directories (bind mount in compose/runtime)
COPY data ./data
COPY exports ./exports
COPY logs ./logs

EXPOSE 8080

CMD ["node", "server/index.js"]
