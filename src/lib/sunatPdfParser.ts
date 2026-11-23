import type { TipoComprobante } from '../types/sunat';

export interface ParsedSunatPdf {
  fileName: string;
  tipoComprobante?: TipoComprobante;
  serie?: string;
  numero?: string;
  serieNumero?: string;
  fechaEmision?: string; // YYYY-MM-DD
  rucEmisor?: string;
  docCliente?: string;
  razonSocialCliente?: string;
  moneda?: 'PEN' | 'USD';
  opGravada?: number;
  igv?: number;
  total?: number;
  esOficialSunat: boolean;
  rawTextPreview: string;
}

/**
 * Extrae metadatos clave de un comprobante electrónico peruano (Portal SUNAT SOL, Nubefact, OSE/PSE)
 * a partir del texto plano del PDF y el nombre de archivo.
 */
export function parseSunatText(rawText: string, fileName: string): ParsedSunatPdf {
  const normalized = rawText.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ');
  const upper = normalized.toUpperCase();

  // 1. Tipo de comprobante
  let tipoComprobante: TipoComprobante | undefined;
  if (/NOTA\s+DE\s+CR[ÉE]DITO/.test(upper)) tipoComprobante = '07';
  else if (/NOTA\s+DE\s+D[ÉE]BITO/.test(upper)) tipoComprobante = '08';
  else if (/BOLETA\s+DE\s+VENTA/.test(upper) || /PDF-BOLETA|EB\d{2}|B\d{3}/i.test(fileName))
    tipoComprobante = '03';
  else if (/FACTURA\s+ELECTR[ÓO]NICA/.test(upper) || /PDF-FACTURA|E0\d{2}|F\d{3}/i.test(fileName))
    tipoComprobante = '01';

  // 2. Serie y Número (E001-123, EB01-456, F001-00000123, B001-000123, etc.)
  let serie: string | undefined;
  let numero: string | undefined;
  const serieRegex = /\b([EFB][A-Z0-9]{3})\s*[-–]\s*(\d{1,8})\b/i;
  const matchSerieText = normalized.match(serieRegex);
  const matchSerieFile = fileName.match(serieRegex);
  const chosenSerie = matchSerieText || matchSerieFile;
  if (chosenSerie) {
    serie = chosenSerie[1].toUpperCase();
    numero = chosenSerie[2].replace(/^0+/, '') || '0';
    if (!tipoComprobante) {
      if (serie.startsWith('EB') || serie.startsWith('B')) tipoComprobante = '03';
      else if (serie.startsWith('E') || serie.startsWith('F')) tipoComprobante = '01';
    }
  }
  const serieNumero = serie && numero ? `${serie}-${numero.padStart(6, '0')}` : undefined;

  // 3. Fecha de emisión (DD/MM/YYYY o YYYY-MM-DD)
  let fechaEmision: string | undefined;
  const fechaLabelMatch = normalized.match(
    /Fecha\s+de\s+Emisi[óo]n\s*[:\-]?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2})/i
  );
  const fechaAnyMatch = normalized.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
  const rawDate = fechaLabelMatch?.[1] || fechaAnyMatch?.[1];
  if (rawDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      fechaEmision = rawDate;
    } else {
      const [dd, mm, yyyy] = rawDate.split(/[\/\-]/);
      if (yyyy && mm && dd) fechaEmision = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
  }

  // 4. RUC Emisor y Documento Cliente
  const allRucs = Array.from(normalized.matchAll(/\b((?:10|15|16|17|20)\d{9})\b/g)).map((m) => m[1]);
  const rucEmisor = allRucs[0];

  let docCliente: string | undefined;
  const rucClienteMatch = normalized.match(
    /(?:Se[ñn]or(?:\(es\))?|Cliente|Adquirente)[\s\S]{0,120}?(?:RUC|DNI|DOC\.?\s*IDENTIDAD)\s*[:\-]?\s*(\d{8,11})/i
  );
  if (rucClienteMatch) {
    docCliente = rucClienteMatch[1];
  } else {
    const distinctRuc = allRucs.find((r) => r !== rucEmisor);
    if (distinctRuc) {
      docCliente = distinctRuc;
    } else {
      const dniMatch = normalized.match(/\bDNI\s*[:\-]?\s*(\d{8})\b/i);
      if (dniMatch) docCliente = dniMatch[1];
    }
  }

  // 5. Razón Social del Cliente
  let razonSocialCliente: string | undefined;
  const clientMatch = normalized.match(
    /(?:Se[ñn]or(?:\(es\))?|Adquirente|Cliente)\s*[:\-]\s*([^\n\r]{3,90})/i
  );
  if (clientMatch) {
    razonSocialCliente = clientMatch[1]
      .replace(/(?:RUC|DNI|Fecha|Direcci[óo]n|Tipo\s+de\s+Moneda).*$/i, '')
      .trim();
  }

  // 6. Moneda
  const moneda: 'PEN' | 'USD' = /D[ÓO]LARES|USD|\bUS\$/i.test(upper) ? 'USD' : 'PEN';

  // 7. Montos (Op. Gravada / Subtotal, IGV, Importe Total)
  const parseAmount = (str?: string): number | undefined => {
    if (!str) return undefined;
    const cleaned = str.replace(/[^\d.,]/g, '').replace(/,/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : undefined;
  };

  const totalMatch = normalized.match(
    /Importe\s+Total\s*[:\-]?\s*(?:S\/\.?|US\$|\$)?\s*([\d,]+\.\d{2})/i
  );
  const igvMatch = normalized.match(/\bI\.?G\.?V\.?(?:\s*\([\d.]+%?\))?\s*[:\-]?\s*(?:S\/\.?|US\$|\$)?\s*([\d,]+\.\d{2})/i);
  const subMatch = normalized.match(
    /(?:Sub\s*Total\s*Ventas|Op\.?\s*Gravada|Valor\s*Venta)\s*[:\-]?\s*(?:S\/\.?|US\$|\$)?\s*([\d,]+\.\d{2})/i
  );

  const total = parseAmount(totalMatch?.[1]);
  const igv = parseAmount(igvMatch?.[1]);
  const opGravada = parseAmount(subMatch?.[1]);

  const esOficialSunat =
    /SUNAT|FACTURA ELECTR[ÓO]NICA|BOLETA DE VENTA ELECTR[ÓO]NICA|REPRESENTACI[ÓO]N IMPRESA/i.test(
      upper
    ) || Boolean(serie && numero);

  return {
    fileName,
    tipoComprobante,
    serie,
    numero,
    serieNumero,
    fechaEmision,
    rucEmisor,
    docCliente,
    razonSocialCliente,
    moneda,
    opGravada,
    igv,
    total,
    esOficialSunat,
    rawTextPreview: normalized.slice(0, 600),
  };
}

let workerInitialized = false;

/**
 * Lee un archivo PDF real en el navegador con pdfjs-dist y extrae todos los datos SUNAT.
 */
export async function parseSunatPdfFile(file: File): Promise<ParsedSunatPdf> {
  try {
    const pdfjs = await import('pdfjs-dist');
    if (!workerInitialized) {
      const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
      workerInitialized = true;
    }

    const buffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    const maxPages = Math.min(pdf.numPages, 3);
    let fullText = '';

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const strings = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean);
      fullText += strings.join(' ') + '\n';
    }

    return parseSunatText(fullText, file.name);
  } catch {
    // Fallback por nombre de archivo si el PDF está protegido o es imagen escaneada
    return parseSunatText('', file.name);
  }
}
