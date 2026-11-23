import type { IncomingMessage, ServerResponse } from 'http';

interface Req extends IncomingMessage {
  query?: Record<string, string | string[] | undefined>;
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

export default async function handler(req: Req, res: Res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-token');

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const urlObj = new URL(req.url || '/', 'http://localhost');
  const tipo = (urlObj.searchParams.get('tipo') || '').toLowerCase();
  const numero = (urlObj.searchParams.get('numero') || '').replace(/\D/g, '');

  if (tipo !== 'ruc' && tipo !== 'dni') {
    sendJson(res, 400, { ok: false, error: 'Parámetro tipo debe ser "ruc" o "dni".' });
    return;
  }

  if (tipo === 'ruc' && numero.length !== 11) {
    sendJson(res, 400, { ok: false, error: 'El RUC debe tener exactamente 11 dígitos.' });
    return;
  }
  if (tipo === 'dni' && numero.length !== 8) {
    sendJson(res, 400, { ok: false, error: 'El DNI debe tener exactamente 8 dígitos.' });
    return;
  }

  const userToken = (req.headers['x-api-token'] as string) || process.env.APIS_NET_PE_TOKEN || '';

  const endpoints: Array<{ url: string; headers: Record<string, string>; source: string }> = [];

  if (userToken) {
    endpoints.push({
      url:
        tipo === 'ruc'
          ? `https://api.apis.net.pe/v2/sunat/ruc?numero=${numero}`
          : `https://api.apis.net.pe/v2/reniec/dni?numero=${numero}`,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      source: 'apis.net.pe v2',
    });
  }

  endpoints.push({
    url:
      tipo === 'ruc'
        ? `https://api.apis.net.pe/v1/ruc?numero=${numero}`
        : `https://api.apis.net.pe/v1/dni?numero=${numero}`,
    headers: { Accept: 'application/json' },
    source: 'apis.net.pe v1 (público)',
  });

  let lastError = 'No se pudo consultar el servicio externo en este momento.';

  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const response = await fetch(ep.url, {
        headers: ep.headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        lastError = `Servicio ${ep.source} respondió HTTP ${response.status}.`;
        continue;
      }

      const data = (await response.json()) as Record<string, unknown>;
      const razonSocial =
        (data.razonSocial as string) ||
        (data.nombre as string) ||
        [data.nombres, data.apellidoPaterno, data.apellidoMaterno].filter(Boolean).join(' ').trim();

      if (!razonSocial) {
        lastError = 'No se encontró razón social o nombre para este documento.';
        continue;
      }

      sendJson(res, 200, {
        ok: true,
        source: ep.source,
        tipo,
        numero,
        razonSocial,
        direccion: (data.direccion as string) || '',
        estado: (data.estado as string) || '',
        condicion: (data.condicion as string) || '',
        distrito: (data.distrito as string) || '',
        provincia: (data.provincia as string) || '',
        departamento: (data.departamento as string) || '',
      });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Error de red consultando SUNAT/RENIEC.';
    }
  }

  sendJson(res, 502, {
    ok: false,
    error: `${lastError} Puedes escribir el nombre manualmente o agregar tu token gratuito de apis.net.pe en Configuración.`,
  });
}
