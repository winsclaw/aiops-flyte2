FROM docker.fzyun.io/library/node:23.11.1-alpine3.22 AS builder

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG NO_PROXY
ARG no_proxy

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY package.json ./
RUN corepack enable \
  && corepack prepare pnpm@10.20.0 --activate \
  && pnpm config set registry https://registry.npmmirror.com \
  && pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm run build:prod

FROM docker.fzyun.io/library/node:23.11.1-alpine3.22 AS runner

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
ENV NEXT_PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/proxy-server.js ./proxy-server.js
COPY --from=builder /app/.env ./.env

EXPOSE 8080
CMD ["node", "proxy-server.js"]
