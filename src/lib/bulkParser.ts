import type { ComprobanteRecord, EmpresaEmisoraConfig, TipoComprobante, TipoDocIdentidad } from '../types/sunat';
import { getHoyPeruISO } from './sunatValidators';

export interface BulkParsedRow {
  lineNumber: number;
  fechaConsumo: string;
  notaInterna: string;
  tipoComprobante: TipoComprobante;
  tipoDocCliente: TipoDocIdentidad;
  numeroDocCliente: string;
  razonSocialCliente: string;
  descripcion: string;
  monto: number;
  tasaIgv: number;
  error?: string;
}

function normalizeDateInput(raw: string, fallbackISO: string): string {
  const s = (raw || '').trim();
  if (!s) return fallbackISO;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    let yyyy = dmy[3] || fallbackISO.slice(0, 4);
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  return fallbackISO;
}

function parseMonto(raw: string): number {
  const cleaned = (raw || '')
    .replace(/S\/\.?|US\$|\$/gi, '')
    .replace(/\s/g, '')
    .replace(/,(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const val = parseFloat(cleaned);
  return Number.isFinite(val) ? val : NaN;
}

/**
 * Parsea texto pegado desde WhatsApp, Bloc de notas o Excel (separado por | , tab o ;).
 * Formatos soportados:
 *  - Completo (6-7 cols): fecha | nota | tipo(F/B) | doc(RUC/DNI/VARIOS) | cliente | descripcion | monto
 *  - Rápido (3 cols): fecha | descripcion | monto
 *  - Ultra-rápido (2 cols): fecha | monto
 */
export function parseBulkLines(rawText: string, config: EmpresaEmisoraConfig): BulkParsedRow[] {
  const hoy = getHoyPeruISO();
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const results: BulkParsedRow[] = [];
  let autoNotaSeq = 1;

  lines.forEach((line, idx) => {
    const sep = line.includes('\t')
      ? '\t'
      : line.includes('|')
        ? '|'
        : line.includes(';')
          ? ';'
          : ',';
    const cols = line.split(sep).map((c) => c.trim());

    // Omitir encabezados típicos de Excel
    if (idx === 0 && /fecha/i.test(cols[0]) && /monto|total|importe/i.test(line)) {
      return;
    }

    let fechaConsumo = hoy;
    let notaInterna = `N-${String(autoNotaSeq++).padStart(3, '0')}`;
    let tipoComprobante: TipoComprobante = '03';
    let tipoDocCliente: TipoDocIdentidad = '0';
    let numeroDocCliente = '-';
    let razonSocialCliente = 'CLIENTES VARIOS';
    let descripcion = config.conceptosRapidos[0] || 'Consumo de Alimentos y Bebidas';
    let monto = NaN;
    const tasaIgv = config.tasaIgvDefecto;

    if (cols.length >= 6) {
      fechaConsumo = normalizeDateInput(cols[0], hoy);
      notaInterna = cols[1] || notaInterna;
      const tipoRaw = (cols[2] || '').toUpperCase();
      tipoComprobante = tipoRaw.startsWith('F') || tipoRaw === '01' ? '01' : '03';
      const docDigits = (cols[3] || '').replace(/\D/g, '');
      if (docDigits.length === 11) {
        tipoDocCliente = '6';
        numeroDocCliente = docDigits;
        if (!tipoRaw) tipoComprobante = '01';
      } else if (docDigits.length === 8) {
        tipoDocCliente = '1';
        numeroDocCliente = docDigits;
      } else if (cols[3] && !/varios|^-$/i.test(cols[3])) {
        tipoDocCliente = '7';
        numeroDocCliente = cols[3].toUpperCase();
      }
      razonSocialCliente = cols[4] || (tipoDocCliente === '0' ? 'CLIENTES VARIOS' : '');
      if (cols.length >= 7) {
        descripcion = cols[5] || descripcion;
        monto = parseMonto(cols[6]);
      } else {
        monto = parseMonto(cols[5]);
      }
    } else if (cols.length === 5) {
      // fecha | doc | cliente | descripcion | monto
      fechaConsumo = normalizeDateInput(cols[0], hoy);
      const docDigits = (cols[1] || '').replace(/\D/g, '');
      if (docDigits.length === 11) {
        tipoComprobante = '01';
        tipoDocCliente = '6';
        numeroDocCliente = docDigits;
      } else if (docDigits.length === 8) {
        tipoDocCliente = '1';
        numeroDocCliente = docDigits;
      }
      razonSocialCliente = cols[2] || 'CLIENTES VARIOS';
      descripcion = cols[3] || descripcion;
      monto = parseMonto(cols[4]);
    } else if (cols.length === 4) {
      // fecha | nota | descripcion | monto
      fechaConsumo = normalizeDateInput(cols[0], hoy);
      notaInterna = cols[1] || notaInterna;
      descripcion = cols[2] || descripcion;
      monto = parseMonto(cols[3]);
    } else if (cols.length === 3) {
      // fecha | descripcion | monto
      fechaConsumo = normalizeDateInput(cols[0], hoy);
      descripcion = cols[1] || descripcion;
      monto = parseMonto(cols[2]);
    } else if (cols.length === 2) {
      fechaConsumo = normalizeDateInput(cols[0], hoy);
      monto = parseMonto(cols[1]);
    } else {
      monto = parseMonto(cols[0]);
    }

    const error =
      !Number.isFinite(monto) || monto <= 0
        ? `No se detectó un monto numérico válido en la línea ${idx + 1}.`
        : undefined;

    results.push({
      lineNumber: idx + 1,
      fechaConsumo,
      notaInterna,
      tipoComprobante,
      tipoDocCliente,
      numeroDocCliente,
      razonSocialCliente,
      descripcion,
      monto: Number.isFinite(monto) ? monto : 0,
      tasaIgv,
      error,
    });
  });

  return results;
}

export function bulkRowToComprobante(
  row: BulkParsedRow,
  config: EmpresaEmisoraConfig
): ComprobanteRecord {
  const now = new Date().toISOString();
  const hoy = getHoyPeruISO();
  return {
    id: crypto.randomUUID(),
    notaInterna: row.notaInterna,
    tipoComprobante: row.tipoComprobante,
    fechaConsumo: row.fechaConsumo,
    fechaEmisionSunat: hoy,
    serieSunat: row.tipoComprobante === '01' ? config.serieFacturaSol : config.serieBoletaSol,
    numeroSunat: '',
    tipoDocCliente: row.tipoDocCliente,
    numeroDocCliente: row.numeroDocCliente,
    razonSocialCliente: row.razonSocialCliente,
    direccionCliente: '',
    emailCliente: '',
    moneda: 'PEN',
    tipoCambio: 3.75,
    modoCalculo: config.modoCalculoDefecto,
    tasaIgv: row.tasaIgv,
    recargoConsumoPct: config.recargoConsumoDefecto,
    descuentoGlobal: 0,
    formaPago: 'CONTADO',
    incluirRefFechaEnDesc: config.incluirRefFechaDefecto,
    observaciones: '',
    items: [
      {
        id: crypto.randomUUID(),
        unidad: 'ZZ',
        descripcion: row.descripcion,
        cantidad: 1,
        montoIngresado: row.monto,
        esTotalLinea: true,
        afectacion: row.tasaIgv > 0 ? '10' : '20',
      },
    ],
    estado: 'PENDIENTE',
    creadoEn: now,
    actualizadoEn: now,
  };
}
