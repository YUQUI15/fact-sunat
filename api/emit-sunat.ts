import type { IncomingMessage, ServerResponse } from 'http';

interface Req extends IncomingMessage {
  body?: unknown;
}
interface Res extends ServerResponse {
  status?: (code: number) => Res;
  json?: (body: unknown) => void;
}

function sendJson(res: Res, status: number, payload: unknown) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const nextRes = res.status(status);
    if (typeof nextRes.json === 'function') {
      nextRes.json(payload);
      return;
    }
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readBody(req: Req): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('Payload demasiado grande'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function isAllowedPublicHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Método no permitido. Usa POST.' });
    return;
  }

  try {
    const body = await readBody(req);
    const endpointUrl = String(body.endpointUrl || '').trim();
    const token = String(body.token || '').trim();
    const authHeaderName = String(body.authHeaderName || 'Authorization').trim();
    const authPrefix = typeof body.authPrefix === 'string' ? body.authPrefix : 'Token token=';
    const payload = body.payload;

    if (!endpointUrl || !isAllowedPublicHttpsUrl(endpointUrl)) {
      sendJson(res, 400, {
        ok: false,
        error: 'URL de proveedor inválida. Debe ser una URL HTTPS pública válida (ej. Nubefact / Apisunat).',
      });
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) {
      headers[authHeaderName] = authPrefix ? `${authPrefix}${token}` : token;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    const upstream = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await upstream.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw text
    }

    sendJson(res, upstream.ok ? 200 : upstream.status, {
      ok: upstream.ok,
      status: upstream.status,
      data: parsed,
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Error interno al conectar con la API PSE/OSE.',
    });
  }
}
