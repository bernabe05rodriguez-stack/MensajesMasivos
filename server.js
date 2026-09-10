// Servidor MAVERIX - Mensajes Masivos
// Node puro, sin dependencias. Sirve la pagina, recibe y guarda las opiniones.
//
// Variables de entorno (configurar en EasyPanel):
//   PORT       -> puerto (default 3000)
//   DATA_DIR   -> carpeta persistente para los datos (default /data) -> montar un VOLUMEN aca
//   ADMIN_KEY  -> clave para entrar al /admin (CAMBIAR si o si)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const ADMIN_KEY = process.env.ADMIN_KEY || 'cambiar-esta-clave';
const DATA_FILE = path.join(DATA_DIR, 'feedback.jsonl');
const USAGE_FILE = path.join(DATA_DIR, 'usage.jsonl');
const PUBLIC = __dirname;

// Asegurar carpeta de datos (si falla, igual seguimos sirviendo la pagina)
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {
    console.error('No se pudo crear DATA_DIR:', e.message);
}

// Ningun error inesperado tiene que tirar abajo el server. Loguear y seguir.
process.on('uncaughtException', (e) => console.error('uncaughtException:', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.stack || e));

function sendJSON(res, status, obj) {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
}

// ---- Rate limit simple en memoria: max 5 opiniones cada 10 minutos por IP ----
const RATE_MAX = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const rateMap = new Map(); // ip -> [timestamps]
// Eventos de uso (login/descarga): limite mas holgado porque muchos ejecutivos
// pueden salir a internet por el mismo IP de la oficina.
const USAGE_RATE_MAX = 120;
const usageRateMap = new Map();

function clientIP(req) {
    // Detras del proxy de EasyPanel la IP real viene en x-forwarded-for
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return req.socket.remoteAddress || 'desconocida';
}

function rateLimited(ip, map, max) {
    map = map || rateMap; max = max || RATE_MAX;
    const now = Date.now();
    const hits = (map.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
    if (hits.length >= max) { map.set(ip, hits); return true; }
    hits.push(now);
    map.set(ip, hits);
    return false;
}

// Limpieza periodica para que los mapas no crezcan sin limite
setInterval(() => {
    const now = Date.now();
    [rateMap, usageRateMap].forEach(map => {
        for (const [ip, hits] of map) {
            const fresh = hits.filter(t => now - t < RATE_WINDOW_MS);
            if (fresh.length === 0) map.delete(ip); else map.set(ip, fresh);
        }
    });
}, RATE_WINDOW_MS).unref();

// Cache-Control: HTML siempre fresco (asi un deploy se ve enseguida), assets cacheables
function cacheHeaders(type) {
    if (type.startsWith('text/html')) return 'no-cache';
    if (type.startsWith('image/')) return 'public, max-age=86400';
    return 'public, max-age=3600';
}

function serveFile(res, file, type) {
    fs.readFile(path.join(PUBLIC, file), (err, data) => {
        if (err) {
            // Si ni siquiera el index.html esta, devolvemos un fallback minimo
            // para que el usuario vea algo y no un 404 pelado.
            if (res.headersSent) return;
            res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end('<!doctype html><meta charset=utf-8><title>MAVERIX</title><body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#eee"><h1>MAVERIX</h1><p>Volvé a intentar en unos segundos.</p>');
            return;
        }
        if (res.headersSent) return;
        res.writeHead(200, {
            'Content-Type': type + (type.startsWith('image/') ? '' : '; charset=utf-8'),
            'Cache-Control': cacheHeaders(type)
        });
        res.end(data);
    });
}

function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
    catch (e) { return serveFile(res, 'index.html', 'text/html'); }
    // Normalizar trailing slash (excepto la raiz)
    let pathname = url.pathname.replace(/\/+$/, '') || '/';

    // ---- Healthcheck ----
    if (req.method === 'GET' && pathname === '/healthz') {
        return sendJSON(res, 200, { ok: true });
    }

    // ---- Guardar una opinion ----
    if (req.method === 'POST' && pathname === '/api/feedback') {
        if (rateLimited(clientIP(req))) return sendJSON(res, 429, { error: 'demasiadas opiniones, proba mas tarde' });
        let body = '';
        let tooBig = false;
        req.on('data', c => {
            if (tooBig) return;
            body += c;
            if (body.length > 10000) {
                tooBig = true;
                sendJSON(res, 413, { error: 'cuerpo demasiado grande' });
                req.destroy();
            }
        });
        req.on('error', (e) => console.error('req error:', e.message));
        req.on('end', () => {
            if (tooBig) return;
            let data;
            try { data = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { error: 'JSON invalido' }); }
            const rating = parseInt(data.rating, 10);
            const text = String(data.text || '').slice(0, 2000);
            const user = String(data.user || '').trim().toLowerCase().slice(0, 40);
            // Las estrellas son opcionales desde que la encuesta que bloqueaba
            // la descarga se reemplazo por el apartado de sugerencias (texto
            // solo). Tiene que venir algo: rating 1-5 o un texto no vacio.
            const conRating = rating >= 1 && rating <= 5;
            if (!conRating && !text.trim()) return sendJSON(res, 400, { error: 'nada para guardar' });
            const entry = { ts: new Date().toISOString(), text: text, user: user };
            if (conRating) entry.rating = rating;
            fs.appendFile(DATA_FILE, JSON.stringify(entry) + '\n', err => {
                if (err) { console.error('Error guardando:', err.message); return sendJSON(res, 500, { error: 'no se pudo guardar' }); }
                sendJSON(res, 200, { ok: true });
            });
        });
        return;
    }

    // ---- Registrar uso: quien abre la pagina (login) y quien descarga (download) ----
    if (req.method === 'POST' && pathname === '/api/usage') {
        if (rateLimited(clientIP(req), usageRateMap, USAGE_RATE_MAX)) return sendJSON(res, 429, { error: 'demasiados eventos' });
        let body = '';
        let tooBig = false;
        req.on('data', c => {
            if (tooBig) return;
            body += c;
            if (body.length > 2000) {
                tooBig = true;
                sendJSON(res, 413, { error: 'cuerpo demasiado grande' });
                req.destroy();
            }
        });
        req.on('error', (e) => console.error('req error:', e.message));
        req.on('end', () => {
            if (tooBig) return;
            let data;
            try { data = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { error: 'JSON invalido' }); }
            const user = String(data.user || '').trim().toLowerCase().slice(0, 40);
            const event = String(data.event || '');
            if (!user || !/^[a-z]+$/.test(user)) return sendJSON(res, 400, { error: 'usuario invalido' });
            if (event !== 'login' && event !== 'download') return sendJSON(res, 400, { error: 'evento invalido' });
            const entry = { ts: new Date().toISOString(), user: user, event: event };
            const rows = parseInt(data.rows, 10);
            if (event === 'download' && rows >= 0) entry.rows = rows;
            fs.appendFile(USAGE_FILE, JSON.stringify(entry) + '\n', err => {
                if (err) { console.error('Error guardando uso:', err.message); return sendJSON(res, 500, { error: 'no se pudo guardar' }); }
                sendJSON(res, 200, { ok: true });
            });
        });
        return;
    }

    // ---- Leer usos (solo con clave) ----
    if (req.method === 'GET' && pathname === '/api/usage') {
        if (url.searchParams.get('key') !== ADMIN_KEY) return sendJSON(res, 401, { error: 'no autorizado' });
        fs.readFile(USAGE_FILE, 'utf8', (err, content) => {
            if (err) return sendJSON(res, 200, { events: [] }); // todavia no hay archivo
            const events = content.split('\n').filter(Boolean).map(l => {
                try { return JSON.parse(l); } catch (e) { return null; }
            }).filter(Boolean);
            sendJSON(res, 200, { events: events });
        });
        return;
    }

    // ---- Leer opiniones (solo con clave) ----
    if (req.method === 'GET' && pathname === '/api/feedback') {
        if (url.searchParams.get('key') !== ADMIN_KEY) return sendJSON(res, 401, { error: 'no autorizado' });
        fs.readFile(DATA_FILE, 'utf8', (err, content) => {
            if (err) return sendJSON(res, 200, { responses: [] }); // todavia no hay archivo
            const responses = content.split('\n').filter(Boolean).map(l => {
                try { return JSON.parse(l); } catch (e) { return null; }
            }).filter(Boolean);
            sendJSON(res, 200, { responses: responses });
        });
        return;
    }

    // ---- Iconos / imagenes ----
    if (pathname === '/favicon.svg') return serveFile(res, 'favicon.svg', 'image/svg+xml');
    if (pathname === '/favicon.ico' || pathname === '/favicon.png') return serveFile(res, 'favicon-256.png', 'image/png');
    if (pathname === '/apple-touch-icon.png' || pathname === '/apple-touch-icon-precomposed.png') return serveFile(res, 'favicon-256.png', 'image/png');
    if (pathname === '/og-image.png') return serveFile(res, 'og-image.png', 'image/png');
    if (pathname === '/rifa.jpeg') return serveFile(res, 'rifa.jpeg', 'image/jpeg');

    // ---- Paginas ----
    if (pathname === '/admin' || pathname === '/admin.html') return serveFile(res, 'admin.html', 'text/html');

    // Cualquier otra ruta GET cae al index (asi nunca aparece "pagina no existe"
    // si alguien comparte un link con sufijo raro o entra a una sub-ruta vieja).
    if (req.method === 'GET') return serveFile(res, 'index.html', 'text/html');

    sendJSON(res, 404, { error: 'no encontrado' });
}

const server = http.createServer((req, res) => {
    try { handle(req, res); }
    catch (e) {
        console.error('handler error:', e && e.stack || e);
        try { sendJSON(res, 500, { error: 'error interno' }); } catch (_) {}
    }
});

server.on('clientError', (err, socket) => {
    // No tirar el server por un cliente que manda basura
    try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) {}
});

server.listen(PORT, () => {
    console.log('MAVERIX server escuchando en puerto ' + PORT);
    console.log('Datos en: ' + DATA_FILE);
    if (ADMIN_KEY === 'cambiar-esta-clave') console.warn('!! ADMIN_KEY por defecto: cambiala en las env vars !!');
});

// Graceful shutdown (EasyPanel manda SIGTERM en restarts/deploys)
function shutdown(sig) {
    console.log('Recibido ' + sig + ', cerrando...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
