'use strict';

const http = require('node:http');
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

const config = loadConfig();
const app = createApp(config);
const server = http.createServer(app);

// Slowloris / resource-exhaustion protection.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;
server.maxRequestsPerSocket = 100;

server.listen(config.port, config.host, () => {
  console.info(`[server] Fiori no ar em http://${config.host}:${config.port}`);
  if (!config.siteUrl) console.warn('[server] SITE_URL não definido – usando o Host da requisição.');
});

function shutdown(signal) {
  console.info(`[server] ${signal} recebido, encerrando...`);
  app.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
