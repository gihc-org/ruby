FROM docker.io/library/node:25-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm test && npm run build

FROM docker.io/nginxinc/nginx-unprivileged:1.31-alpine

USER root
RUN apk upgrade --no-cache
USER 101

LABEL org.opencontainers.image.title="Ruby i browseren"
LABEL org.opencontainers.image.description="Browserbaseret Ruby-editor med interaktiv WASM-terminal"
LABEL org.opencontainers.image.source="https://github.com/gihc-org/ruby"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz >/dev/null || exit 1
