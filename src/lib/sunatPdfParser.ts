import type { TipoComprobante } from '../types/sunat';
import { roundSunat } from './sunatMath';

export interface ParsedSunatItem {
  cantidad: number;
  unidad: string;
  descripcion: string;
  valorUnitario: number; // Sin IGV tal como imprime SUNAT SEE-SOL
  precioUnitarioConIgv: number; // Calculado con la tasa detectada del PDF
  totalLineaEstimado: number;
  rawLine: string;
}

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
  tasaIgvDetectada?: number; // ej. 18, 10.5, 10, 0
  items: ParsedSunatItem[];
  esOficialSunat: boolean;
  rawTextPreview: string;
  fullText: string;
}

function parseLocalizedNumber(str?: string): number | undefined {
  if (!str) return undefined;
  const cleaned = str.replace(/[^\d.,]/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '').replace(/,/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Extrae líneas de detalle (Cantidad, Unidad, Descripción, Valor Unitario) de texto SUNAT SEE-SOL y OSE/PSE.
 */
function extractSunatItems(lines: string[], tasaDecimal: number): ParsedSunatItem[] {
  const items: ParsedSunatItem[] = [];
  const skipHeaderRegex =
    /^(?:CANTIDAD|CANT\.?|UNIDAD|U\.M\.|DESCRIPCI[ÓO]N|VALOR\s+UNITARIO|SUB\s*TOTAL|OP\.?\s*GRAVADA|I\.?G\.?V\.?|IMPORTE\s+TOTAL|SON:|FECHA|SE[ÑN]OR|RUC|DNI|TIPO\s+DE\s+MONEDA|FORMA\s+DE\s+PAGO|REPRESENTACI[ÓO]N)/i;

  // Patrón 1 (SUNAT Portal SEE-SOL clásico):
  // "10.00 UNIDAD SERVICIO DE ATENCION 4.24" o "5.00 NIU PRODUCTO X 4.2373 0.00"
  const solLineRegex =
    /^(\d+(?:[.,]\d{1,4})?)\s+([A-ZÁÉÍÓÚÑ0-9./]{2,16})\s+(.+?)\s+(\d{1,3}(?:,\d{3})*\.\d{2,10}|\d+\.\d{2,10})(?:\s+(\d{1,3}(?:,\d{3})*\.\d{2,10}|\d+\.\d{2,10}))?(?:\s+(\d{1,3}(?:,\d{3})*\.\d{2,10}|\d+\.\d{2,10}))?\s*$/i;

  // Patrón 2 (algunos PSE/Nubefact donde primero viene código/ítem):
  // "1 10.00 ZZ DESCRIPCION 4.2373 42.37"
  const indexedLineRegex =
    /^\d{1,3}\s+(\d+(?:[.,]\d{1,4})?)\s+([A-ZÁÉÍÓÚÑ0-9./]{2,16})\s+(.+?)\s+(\d{1,3}(?:,\d{3})*\.\d{2,10}|\d+\.\d{2,10})(?:\s+(\d{1,3}(?:,\d{3})*\.\d{2,10}|\d+\.\d{2,10}))?\s*$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length < 8 || skipHeaderRegex.test(line)) continue;
    if (/(?:SUB\s*TOTAL|OP\.?\s*GRAVADA|IMPORTE\s+TOTAL|TOTAL\s+VENTA|DESCUENTOS\s+TOTALES|ANTICIPOS|OTROS\s+CARGOS|ICBPER\s*:)/i.test(line)) {
      continue;
    }

    const m1 = line.match(solLineRegex);
    const m2 = !m1 ? line.match(indexedLineRegex) : null;
    const m = m1 || m2;
    if (!m) continue;

    const cantidad = parseLocalizedNumber(m[1]);
    const unidad = (m[2] || 'ZZ').toUpperCase();
    const descripcion = (m[3] || '').trim();
    const n1 = parseLocalizedNumber(m[4]);
    const n2 = parseLocalizedNumber(m[5]);
    const n3 = parseLocalizedNumber(m[6]);

    if (!cantidad || cantidad <= 0 || !n1 || n1 <= 0 || descripcion.length < 2) continue;
    // Evitar confundir una fecha "18/11/2026" o número de RUC con cantidad
    if (cantidad > 100_000 || /^\d{2}\/\d{2}\/\d{4}/.test(line)) continue;

    // En Portal SUNAT SOL la columna derecha del ítem suele ser:
    //  - Solo Valor Unitario (n1)
    //  - O Valor Unitario (n1) + ICBPER (n2 = 0.00)
    //  - O Valor Unitario (n1) + Descuento (n2) + Importe/Valor Venta (n3)
    const valorUnitario = n1;
    const precioUnitarioConIgv = roundSunat(valorUnitario * (1 + tasaDecimal), 4);
    const totalLineaEstimado =
      n3 && n3 > 0 && Math.abs(n3 - valorUnitario * cantidad) < Math.max(2, n3 * 0.25)
        ? roundSunat(n3 * (1 + tasaDecimal), 2)
        : n2 && n2 > 0 && Math.abs(n2 - valorUnitario * cantidad) < Math.max(1, n2 * 0.25)
          ? roundSunat(n2 * (1 + tasaDecimal), 2)
          : roundSunat(valorUnitario * cantidad * (1 + tasaDecimal), 2);

    items.push({
      cantidad,
      unidad,
      descripcion,
      valorUnitario,
      precioUnitarioConIgv,
      totalLineaEstimado,
      rawLine: line,
    });
  }

  return items;
}

/**
 * Extrae metadatos e ítems de un comprobante electrónico peruano (Portal SUNAT SOL, Nubefact, OSE/PSE)
 * a partir del texto plano del PDF y el nombre de archivo.
 */
export function parseSunatText(rawText: string, fileName: string): ParsedSunatPdf {
  const rawLines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
  const normalized = rawLines.join('\n');
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
    /(?:Se[ñn]or(?:\(es\))?|Cliente|Adquirente)[\s\S]{0,140}?(?:RUC|DNI|DOC\.?\s*IDENTIDAD)\s*[:\-]?\s*(\d{8,11})/i
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
  const totalMatch = normalized.match(
    /Importe\s+Total\s*[:\-]?\s*(?:S\/\.?|US\$|\$)?\s*([\d,]+\.\d{2})/i
  );
  const igvMatch = normalized.match(
    /\bI\.?G\.?V\.?(?:\s*\([\d.]+%?\))?\s*[:\-]?\s*(?:S\/\.?|US\$|\$)?\s*([\d,]+\.\d{2})/i
  );
  const subMatch = normalized.match(
    /(?:Sub\s*Total\s*Ventas|Op\.?\s*Gravada|Valor\s*Venta)\s*[:\-]?\s*(?:S\/\.?|US\$|\$)?\s*([\d,]+\.\d{2})/i
  );

  const total = parseLocalizedNumber(totalMatch?.[1]);
  const igv = parseLocalizedNumber(igvMatch?.[1]);
  const opGravada = parseLocalizedNumber(subMatch?.[1]);

  // 8. Tasa IGV real detectada del PDF
  let tasaIgvDetectada: number | undefined;
  if (opGravada && opGravada > 0 && igv !== undefined) {
    const rawPct = (igv / opGravada) * 100;
    if (Math.abs(rawPct - 18) < 0.6) tasaIgvDetectada = 18;
    else if (Math.abs(rawPct - 10.5) < 0.5) tasaIgvDetectada = 10.5;
    else if (Math.abs(rawPct - 10) < 0.4) tasaIgvDetectada = 10;
    else if (Math.abs(rawPct - 15) < 0.5) tasaIgvDetectada = 15;
    else if (rawPct < 0.2) tasaIgvDetectada = 0;
    else tasaIgvDetectada = roundSunat(rawPct, 2);
  } else if (total !== undefined && igv !== undefined && total > igv) {
    const baseEst = total - igv;
    const rawPct = baseEst > 0 ? (igv / baseEst) * 100 : 18;
    if (Math.abs(rawPct - 18) < 0.6) tasaIgvDetectada = 18;
    else if (Math.abs(rawPct - 10.5) < 0.5) tasaIgvDetectada = 10.5;
    else tasaIgvDetectada = roundSunat(rawPct, 2);
  }

  const tasaDecimal = (tasaIgvDetectada ?? 18) / 100;

  // 9. Extracción de ítems / líneas de detalle con cantidad y valor unitario
  const items = extractSunatItems(rawLines, tasaDecimal);

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
    tasaIgvDetectada,
    items,
    esOficialSunat,
    rawTextPreview: normalized.slice(0, 600),
    fullText: normalized,
  };
}

let workerInitialized = false;

interface PdfTextItemLike {
  str: string;
  transform: number[]; // [a, b, c, d, x, y]
}

/**
 * Lee un archivo PDF real en el navegador con pdfjs-dist, reconstruyendo las filas visuales
 * mediante coordenadas (Y, X) para extraer con precisión los ítems y valores unitarios de SUNAT.
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
    const allLines: string[] = [];

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const positioned: Array<{ str: string; x: number; y: number }> = [];
      for (const item of content.items) {
        if ('str' in item && 'transform' in item) {
          const it = item as unknown as PdfTextItemLike;
          const text = (it.str || '').trim();
          if (!text) continue;
          const x = it.transform?.[4] ?? 0;
          const y = it.transform?.[5] ?? 0;
          positioned.push({ str: text, x, y });
        }
      }

      // Agrupar tokens por fila visual (misma coordenada Y con tolerancia de ±3.5 pt)
      positioned.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows: Array<{ y: number; cells: Array<{ x: number; str: string }> }> = [];

      for (const tok of positioned) {
        const existingRow = rows.find((r) => Math.abs(r.y - tok.y) <= 3.5);
        if (existingRow) {
          existingRow.cells.push({ x: tok.x, str: tok.str });
        } else {
          rows.push({ y: tok.y, cells: [{ x: tok.x, str: tok.str }] });
        }
      }

      for (const row of rows) {
        row.cells.sort((a, b) => a.x - b.x);
        allLines.push(row.cells.map((c) => c.str).join(' '));
      }
    }

    return parseSunatText(allLines.join('\n'), file.name);
  } catch {
    return parseSunatText('', file.name);
  }
}
