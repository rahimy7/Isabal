'use strict';
// Servidor sin dependencias para Railway.
// Carga public/ en memoria al arrancar y sirve solo tipos de archivo conocidos.
// Además recibe el formulario en /api/leads y lo guarda en Decolor Pro.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, 'public');

// La clave viaja solo entre servidores: el navegador llama a /api/leads de este mismo dominio.
const DECOLOR_PRO_URL = (process.env.DECOLOR_PRO_URL || '').replace(/\/+$/, '');
const LEADS_API_KEY = process.env.LEADS_API_KEY || '';
const LEAD_SOURCE = 'landing-isaval-decolor';
const MAX_LEAD_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const UTM_VALUE = /^[\w .+%-]{1,100}$/;

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
// Las tiendas válidas son las <option> del formulario: añadir una tienda sigue siendo editar solo index.html.
const STORES = new Set([...files.get('/index.html').body.toString('utf8').matchAll(/<option>([^<]+)<\/option>/g)].map(match => match[1]));
const notFound = Buffer.from('<!doctype html><meta charset="utf-8"><title>Página no encontrada</title><p>Página no encontrada. <a href="/">Volver al inicio</a></p>');

function send(req, res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// El proxy de Railway indica la IP del visitante; sin él, todos parecerían la misma persona.
function clientIp(req) {
  return req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
}

const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  if (attempts.size > 10_000) attempts.clear();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  // Una línea por ventana y por IP, sin la IP: lo justo para saber que el límite se alcanzó.
  if (entry.count === RATE_MAX + 1) console.warn('Solicitud rechazada (429): una IP superó el límite de envíos.');
  return entry.count > RATE_MAX;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_LEAD_BYTES) return reject(new RangeError('Cuerpo demasiado grande'));
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Misma validación que el navegador, que se puede saltar. Devuelve null si la solicitud no es válida.
function cleanLead(data) {
  if (!data || typeof data !== 'object') return null;
  const text = (value, max) => (typeof value === 'string' && value.trim().length <= max ? value.trim() : '');
  const name = text(data.name, 100);
  const phone = text(data.phone, 25);
  const digits = phone.replace(/\D/g, '').length;
  if (name.length < 2 || digits < 7 || digits > 15 || !STORES.has(data.store)) return null;
  const utm = {};
  for (const key of UTM_KEYS) {
    const value = data.utm && data.utm[key];
    if (typeof value === 'string' && UTM_VALUE.test(value)) utm[key] = value;
  }
  return { name, phone, store: data.store, email: text(data.email, 150) || null, source: LEAD_SOURCE, utm };
}

async function handleLead(req, res) {
  const json = (status, data, headers = {}) => send(req, res, status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', ...headers }, Buffer.from(JSON.stringify(data)));

  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' }, { Allow: 'POST' });
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    console.warn('Solicitud rechazada (415): no es JSON.');
    return json(415, { error: 'Se espera JSON' });
  }
  if (rateLimited(clientIp(req))) return json(429, { error: 'Demasiadas solicitudes' }, { 'Retry-After': String(RATE_WINDOW_MS / 1000) });
  if (!DECOLOR_PRO_URL || !LEADS_API_KEY) {
    console.error('Solicitud rechazada: faltan DECOLOR_PRO_URL o LEADS_API_KEY.');
    return json(503, { error: 'No disponible' });
  }

  let lead;
  try {
    lead = cleanLead(JSON.parse(await readBody(req)));
  } catch (error) {
    if (error instanceof RangeError) {
      console.warn('Solicitud rechazada (413): demasiado grande.');
      return json(413, { error: 'Solicitud demasiado grande' }, { Connection: 'close' });
    }
    console.warn('Solicitud rechazada (400): no es un JSON válido.');
    return json(400, { error: 'Solicitud no válida' });
  }
  if (!lead) {
    // Sin los datos: solo el motivo, para distinguir un bot de un formulario que falla.
    console.warn('Solicitud rechazada (400): nombre, teléfono o tienda no válidos.');
    return json(400, { error: 'Solicitud no válida' });
  }

  try {
    const response = await fetch(`${DECOLOR_PRO_URL}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Leads-Key': LEADS_API_KEY },
      body: JSON.stringify(lead),
      // Una redirección convertiría el POST en GET y la portada respondería 200: parecería guardado sin estarlo.
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Decolor Pro respondió ${response.status}`);
    return json(201, { ok: true });
  } catch (error) {
    // Sin los datos del visitante en los registros: solo el motivo del fallo.
    console.error('No se pudo guardar la solicitud en Decolor Pro:', error.message);
    return json(502, { error: 'No se pudo guardar' });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/api/leads') {
    handleLead(req, res).catch(error => {
      console.error('Error al procesar la solicitud:', error.message);
      res.destroy();
    });
    return;
  }

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
  if (!DECOLOR_PRO_URL || !LEADS_API_KEY) {
    console.warn('Faltan DECOLOR_PRO_URL o LEADS_API_KEY: el formulario mostrará un error y no guardará nada.');
  }
});

// Railway envía SIGTERM al reemplazar el despliegue: se dejan terminar las peticiones en curso.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
