FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 10001 relay \
  && useradd --system --uid 10001 --gid relay --home-dir /app --shell /usr/sbin/nologin relay \
  && chown relay:relay /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=relay:relay /app/dist ./dist
COPY --from=build --chown=relay:relay /app/packages/storage/migrations ./dist/packages/storage/migrations
COPY --chown=relay:relay scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh
USER relay
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
