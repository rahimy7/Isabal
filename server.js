'use strict';
// Servidor estático sin dependencias para Railway.
// Carga public/ en memoria al arrancar y sirve solo tipos de archivo conocidos.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg']);

function cacheControl(ext) {
  if (ext === '.html') return 'no-cache';
  // Los archivos no llevan hash en el nombre: CSS y JS caducan antes para que los cambios lleguen pronto.
  if (ext === '.css' || ext === '.js') return 'public, max-age=3600';
  return 'public, max-age=604800';
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
  ].join('; '),
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function loadFiles(dir, files = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { loadFiles(full, files); continue; }
    const ext = path.extname(entry.name).toLowerCase();
    if (!TYPES[ext]) continue;
    const body = fs.readFileSync(full);
    const file = {
      body,
      ext,
      etag: `"${crypto.createHash('sha1').update(body).digest('base64url')}"`,
    };
    if (COMPRESSIBLE.has(ext)) {
      file.br = zlib.brotliCompressSync(body);
      file.gzip = zlib.gzipSync(body, { level: 9 });
    }
    files.set('/' + path.relative(ROOT, full).split(path.sep).join('/'), file);
  }
  return files;
}

const files = loadFiles(ROOT);
const notFound = Buffer.from('<!doctype html><meta charset="utf-8"><title>Página no encontrada</title><p>Página no encontrada. <a href="/">Volver al inicio</a></p>');

function send(req, res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(req, res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('Método no permitido'));
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(req, res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, Buffer.from('Solicitud no válida'));
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = files.get(pathname);
  if (!file) {
    return send(req, res, 404, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' }, notFound);
  }

  const headers = {
    'Content-Type': TYPES[file.ext],
    'Cache-Control': cacheControl(file.ext),
    ETag: file.etag,
  };
  if (file.gzip) headers.Vary = 'Accept-Encoding';

  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304, { ...SECURITY_HEADERS, ...headers });
    return res.end();
  }

  const accept = req.headers['accept-encoding'] || '';
  let body = file.body;
  if (file.br && /\bbr\b/.test(accept)) {
    body = file.br;
    headers['Content-Encoding'] = 'br';
  } else if (file.gzip && /\bgzip\b/.test(accept)) {
    body = file.gzip;
    headers['Content-Encoding'] = 'gzip';
  }
  send(req, res, 200, headers, body);
});

// El proxy de Railway cierra las conexiones inactivas a los 60 s. Node las cierra a los 5 s por defecto,
// y el proxy puede reutilizar una conexión ya cerrada (error 502). Se mantienen abiertas un poco más que el proxy.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.listen(PORT, () => {
  console.log(`Sirviendo ${files.size} archivos de public/ en el puerto ${PORT}`);
});

// Railway envía SIGTERM al reemplazar el despliegue: se dejan terminar las peticiones en curso.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
