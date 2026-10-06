FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public

# Run as the unprivileged "node" user; only the data dir is writable.
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
