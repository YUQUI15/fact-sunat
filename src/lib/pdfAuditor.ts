import * as XLSX from 'xlsx';
import type { ComprobanteRecord, EmpresaEmisoraConfig } from '../types/sunat';
import type { ParsedSunatItem, ParsedSunatPdf } from './sunatPdfParser';
import { formatFixed, roundSunat } from './sunatMath';
import { getHoyPeruISO, validarRucPeru } from './sunatValidators';
import { triggerDownload } from './exporters';

export type ModoReglaPrecio =
  | 'CERCANO_A' // Precio unitario igual o cercano a X (ej. 5.00 con/sin IGV)
  | 'MENOR_QUE' // Precio unitario menor que X (ej. < 20.00)
  | 'FUERA_DE_RANGO' // Menor que Mín o mayor que Máx
  | 'SOLO_ERRORES_SUNAT'; // Solo auditoría tributaria general

export interface AuditRuleConfig {
  modoPrecio: ModoReglaPrecio;
  precioErroneoObjetivo: number; // ej. 5.00
  tolerancia: number; // ej. 0.25
  precioMinimo: number; // ej. 15.00
  precioMaximo: number; // ej. 5000.00
  precioCorrectoReemplazo: number; // ej. 25.00 (0 si no se desea recalcular reemplazo)
  precioCorrectoIncluyeIgv: boolean; // true = S/ 25.00 es total con IGV incluido
  tasaIgvEsperada?: number; // ej. 18 o 10.5 (opcional)
  palabraClaveFiltro: string; // opcional: filtrar por texto en descripción/cliente
  verificarReglasSunat: boolean; // descuadre Base+IGV, Boleta>=700, RUC, duplicados
}

export interface AuditHallazgo {
  tipo: 'PRECIO_ERRONEO' | 'DESCUADRE_TOTAL' | 'TASA_IGV' | 'BOLETA_700' | 'RUC_INVALIDO' | 'DUPLICADO';
  severidad: 'CRITICO' | 'ADVERTENCIA';
  detalle: string;
  notaCreditoTipo: '01' | '02' | '03';
  notaCreditoTipoLabel: string;
  sustentoSugerido: string;
}

export interface AuditedPdfResult {
  id: string;
  parsed: ParsedSunatPdf;
  hallazgos: AuditHallazgo[];
  itemsObservados: ParsedSunatItem[];
  tieneError: boolean;
  /** Cálculos automáticos para la nueva factura/boleta corregida si el usuario indicó precioCorrectoReemplazo */
  correccion?: {
    cantidadTotalAfectada: number;
    precioErroneoDetectado: number;
    precioCorrectoObjetivo: number;
    tasaUsada: number;
    nuevoValorUnitarioExacto: string; // 4-6 decimales para SUNAT
    nuevaBase: number;
    nuevoIgv: number;
    nuevoTotal: number;
    diferenciaTotal: number;
  };
  /** Control de avance del usuario durante el saneamiento */
  ncEmitida: boolean;
  numeroNc: string;
  reemitida: boolean;
  numeroNueva: string;
}

/**
 * Audita un lote completo de PDFs de SUNAT buscando errores de precio unitario,
 * inconsistencias de cálculo, duplicados o incumplimientos normativos.
 */
export function auditSunatPdfBatch(
  pdfs: Array<{ id: string; parsed: ParsedSunatPdf; prev?: Partial<AuditedPdfResult> }>,
  rules: AuditRuleConfig
): AuditedPdfResult[] {
  // Conteo de series-números para detectar duplicados en el lote
  const serieCounts = new Map<string, number>();
  for (const entry of pdfs) {
    if (entry.parsed.serieNumero) {
      serieCounts.set(entry.parsed.serieNumero, (serieCounts.get(entry.parsed.serieNumero) || 0) + 1);
    }
  }

  const keyword = rules.palabraClaveFiltro.trim().toLowerCase();

  return pdfs.map(({ id, parsed, prev }) => {
    const hallazgos: AuditHallazgo[] = [];
    const itemsObservados: ParsedSunatItem[] = [];
    const tasa = parsed.tasaIgvDetectada ?? rules.tasaIgvEsperada ?? 18;
    const tasaDec = tasa / 100;

    // Filtro opcional por palabra clave (si se especificó y no coincide, omitimos chequeo de precio)
    const matchesKeyword =
      !keyword ||
      parsed.fullText.toLowerCase().includes(keyword) ||
      parsed.fileName.toLowerCase().includes(keyword);

    // 1. Auditoría de Precio Unitario en ítems extraídos
    if (matchesKeyword && rules.modoPrecio !== 'SOLO_ERRORES_SUNAT') {
      const tol = Math.max(0.01, rules.tolerancia || 0.2);

      // Si logramos extraer ítems detallados del PDF
      if (parsed.items.length > 0) {
        for (const item of parsed.items) {
          const pConIgv = item.precioUnitarioConIgv;
          const pSinIgv = item.valorUnitario;
          let isBad = false;
          let motivo = '';

          if (rules.modoPrecio === 'CERCANO_A' && rules.precioErroneoObjetivo > 0) {
            const target = rules.precioErroneoObjetivo;
            const targetSinIgv = tasaDec > 0 ? target / (1 + tasaDec) : target;
            const hitConIgv = Math.abs(pConIgv - target) <= tol;
            const hitSinIgvDirecto = Math.abs(pSinIgv - target) <= tol;
            const hitBaseDeTarget = Math.abs(pSinIgv - targetSinIgv) <= tol;

            if (hitConIgv || hitSinIgvDirecto || hitBaseDeTarget) {
              isBad = true;
              motivo = `Ítem "${item.descripcion.slice(0, 42)}" con precio unitario erróneo: Cant. ${item.cantidad} × V.U. ${formatFixed(pSinIgv, 4)} (c/IGV S/ ${formatFixed(pConIgv, 2)}).`;
            }
          } else if (rules.modoPrecio === 'MENOR_QUE' && rules.precioMinimo > 0) {
            if (pConIgv < rules.precioMinimo - 0.005) {
              isBad = true;
              motivo = `Ítem "${item.descripcion.slice(0, 42)}" por debajo del mínimo S/ ${formatFixed(rules.precioMinimo)}: detectado S/ ${formatFixed(pConIgv, 2)} c/IGV (V.U. ${formatFixed(pSinIgv, 4)}).`;
            }
          } else if (rules.modoPrecio === 'FUERA_DE_RANGO') {
            if (
              (rules.precioMinimo > 0 && pConIgv < rules.precioMinimo) ||
              (rules.precioMaximo > 0 && pConIgv > rules.precioMaximo)
            ) {
              isBad = true;
              motivo = `Ítem "${item.descripcion.slice(0, 42)}" fuera de rango [S/ ${formatFixed(rules.precioMinimo)} – S/ ${formatFixed(rules.precioMaximo)}]: detectado S/ ${formatFixed(pConIgv, 2)}.`;
            }
          }

          if (isBad) {
            itemsObservados.push(item);
            hallazgos.push({
              tipo: 'PRECIO_ERRONEO',
              severidad: 'CRITICO',
              detalle: motivo,
              notaCreditoTipo: '01',
              notaCreditoTipoLabel: 'Tipo 01 — Anulación de la operación',
              sustentoSugerido:
                rules.precioCorrectoReemplazo > 0
                  ? `Anulación por error en precio unitario consignado (S/ ${formatFixed(pConIgv)} en lugar de S/ ${formatFixed(rules.precioCorrectoReemplazo)}). Se emitirá nuevo comprobante correcto.`
                  : `Anulación de comprobante por error en precio unitario consignado (S/ ${formatFixed(pConIgv)}). Se emitirá nuevo comprobante.`,
            });
          }
        }
      } else if (parsed.total && parsed.total > 0 && rules.modoPrecio === 'CERCANO_A' && rules.precioErroneoObjetivo > 0) {
        // Fallback inteligente: si un PDF escaneado/atípico no devolvió tabla de ítems,
        // buscamos el valor unitario sin IGV (ej. 4.24 / 4.2373) o el total múltiplo exacto del precio erróneo
        const target = rules.precioErroneoObjetivo;
        const targetSinIgv = roundSunat(target / (1 + tasaDec), 2);
        const regexVu = new RegExp(`\\b(${targetSinIgv.toFixed(2)}|${target.toFixed(2)})\\b`);
        if (regexVu.test(parsed.fullText)) {
          hallazgos.push({
            tipo: 'PRECIO_ERRONEO',
            severidad: 'ADVERTENCIA',
            detalle: `Coincidencia en texto del PDF con valor unitario/precio cercano a S/ ${formatFixed(target)} (base ~${targetSinIgv.toFixed(2)}). Verifica visualmente el PDF.`,
            notaCreditoTipo: '01',
            notaCreditoTipoLabel: 'Tipo 01 — Anulación de la operación',
            sustentoSugerido:
              'Anulación por error en precio unitario consignado. Se emitirá nuevo comprobante con el precio correcto.',
          });
        }
      }
    }

    // 2. Auditoría Tributaria SUNAT Automática
    if (rules.verificarReglasSunat) {
      // 2a. Duplicado en el lote
      if (parsed.serieNumero && (serieCounts.get(parsed.serieNumero) || 0) > 1) {
        hallazgos.push({
          tipo: 'DUPLICADO',
          severidad: 'ADVERTENCIA',
          detalle: `Archivo duplicado en la carga: ${parsed.serieNumero} aparece más de una vez.`,
          notaCreditoTipo: '01',
          notaCreditoTipoLabel: 'Revisar archivo repetido',
          sustentoSugerido: 'Verificar si es el mismo PDF repetido o emisión duplicada.',
        });
      }

      // 2b. Descuadre Base + IGV vs Total
      if (parsed.opGravada !== undefined && parsed.igv !== undefined && parsed.total !== undefined) {
        const suma = roundSunat(parsed.opGravada + parsed.igv, 2);
        if (Math.abs(suma - parsed.total) > 0.05) {
          hallazgos.push({
            tipo: 'DESCUADRE_TOTAL',
            severidad: 'ADVERTENCIA',
            detalle: `Op. Gravada (S/ ${formatFixed(parsed.opGravada)}) + IGV (S/ ${formatFixed(parsed.igv)}) = S/ ${formatFixed(suma)} difiere del Total S/ ${formatFixed(parsed.total)} (puede incluir recargo o exonerado).`,
            notaCreditoTipo: '01',
            notaCreditoTipoLabel: 'Verificar montos / NC Tipo 01 si es error',
            sustentoSugerido: 'Anulación por inconsistencia en cálculo de importes.',
          });
        }
      }

      // 2c. Tasa IGV distinta a la esperada
      if (
        rules.tasaIgvEsperada !== undefined &&
        parsed.tasaIgvDetectada !== undefined &&
        Math.abs(parsed.tasaIgvDetectada - rules.tasaIgvEsperada) > 0.4
      ) {
        hallazgos.push({
          tipo: 'TASA_IGV',
          severidad: 'CRITICO',
          detalle: `Tasa IGV detectada en el PDF es ${parsed.tasaIgvDetectada}%, distinta a la tasa esperada (${rules.tasaIgvEsperada}%).`,
          notaCreditoTipo: '01',
          notaCreditoTipoLabel: 'Tipo 01 — Anulación de la operación',
          sustentoSugerido: `Anulación por aplicación de tasa de IGV incorrecta (${parsed.tasaIgvDetectada}% en lugar de ${rules.tasaIgvEsperada}%).`,
        });
      }

      // 2d. RUC inválido en Factura
      if (parsed.tipoComprobante === '01' && parsed.docCliente) {
        const vRuc = validarRucPeru(parsed.docCliente);
        if (!vRuc.valido) {
          hallazgos.push({
            tipo: 'RUC_INVALIDO',
            severidad: 'CRITICO',
            detalle: `RUC del cliente (${parsed.docCliente}) no pasa validación Módulo 11: ${vRuc.motivo}`,
            notaCreditoTipo: '02',
            notaCreditoTipoLabel: 'Tipo 02 — Anulación por error en el RUC',
            sustentoSugerido: 'Anulación por error en el número de RUC del adquirente.',
          });
        }
      }

      // 2e. Boleta >= 700 sin DNI
      if (
        parsed.tipoComprobante === '03' &&
        (parsed.total || 0) >= 700 &&
        (!parsed.docCliente || parsed.docCliente === '-')
      ) {
        hallazgos.push({
          tipo: 'BOLETA_700',
          severidad: 'CRITICO',
          detalle: `Boleta por S/ ${formatFixed(parsed.total || 0)} (≥ S/ 700) sin documento de identidad detectado.`,
          notaCreditoTipo: '01',
          notaCreditoTipoLabel: 'Tipo 01 — Anulación de la operación',
          sustentoSugerido: 'Anulación de boleta ≥ S/ 700 emitida sin identificación del adquirente.',
        });
      }
    }

    // 3. Cálculo automático de la Factura/Boleta Corregida (si se ingresó precio correcto de reemplazo)
    let correccion: AuditedPdfResult['correccion'];
    if (
      hallazgos.some((h) => h.tipo === 'PRECIO_ERRONEO') &&
      rules.precioCorrectoReemplazo > 0
    ) {
      const targetItems = itemsObservados.length > 0 ? itemsObservados : parsed.items;
      let cantidadTotal = targetItems.reduce((acc, it) => acc + it.cantidad, 0);
      if (cantidadTotal <= 0 && parsed.total && rules.precioErroneoObjetivo > 0) {
        cantidadTotal = Math.max(1, Math.round(parsed.total / rules.precioErroneoObjetivo));
      }
      if (cantidadTotal <= 0) cantidadTotal = 1;

      const precioErr = targetItems[0]?.precioUnitarioConIgv ?? rules.precioErroneoObjetivo;
      const pCorrecto = rules.precioCorrectoReemplazo;

      const nuevoVu = rules.precioCorrectoIncluyeIgv
        ? tasaDec > 0
          ? pCorrecto / (1 + tasaDec)
          : pCorrecto
        : pCorrecto;

      const nuevoTotal = rules.precioCorrectoIncluyeIgv
        ? roundSunat(pCorrecto * cantidadTotal, 2)
        : roundSunat(pCorrecto * cantidadTotal * (1 + tasaDec), 2);
      const nuevaBase = roundSunat(nuevoVu * cantidadTotal, 2);
      const nuevoIgv = roundSunat(nuevoTotal - nuevaBase, 2);
      const diferenciaTotal = roundSunat(nuevoTotal - (parsed.total || 0), 2);

      correccion = {
        cantidadTotalAfectada: cantidadTotal,
        precioErroneoDetectado: precioErr,
        precioCorrectoObjetivo: pCorrecto,
        tasaUsada: tasa,
        nuevoValorUnitarioExacto: nuevoVu.toFixed(4),
        nuevaBase,
        nuevoIgv,
        nuevoTotal,
        diferenciaTotal,
      };
    }

    return {
      id,
      parsed,
      hallazgos,
      itemsObservados,
      tieneError: hallazgos.length > 0,
      correccion,
      ncEmitida: prev?.ncEmitida ?? false,
      numeroNc: prev?.numeroNc ?? '',
      reemitida: prev?.reemitida ?? false,
      numeroNueva: prev?.numeroNueva ?? '',
    };
  });
}

/**
 * Convierte un PDF observado en un nuevo ComprobanteRecord listo para emitir con los precios corregidos.
 */
export function buildCorrectedComprobanteFromAudit(
  audited: AuditedPdfResult,
  config: EmpresaEmisoraConfig,
  rules: AuditRuleConfig
): ComprobanteRecord {
  const hoy = getHoyPeruISO();
  const now = new Date().toISOString();
  const p = audited.parsed;
  const tipo = p.tipoComprobante === '03' ? '03' : '01';
  const doc = p.docCliente || '-';
  const tipoDoc = doc.length === 11 ? '6' : doc.length === 8 ? '1' : '0';
  const tasa = p.tasaIgvDetectada ?? config.tasaIgvDefecto;

  const sourceItems = p.items.length > 0 ? p.items : [];
  const obsSet = new Set(audited.itemsObservados.map((i) => i.rawLine));

  const newItems =
    sourceItems.length > 0
      ? sourceItems.map((it) => {
          const isWrong = obsSet.has(it.rawLine) && rules.precioCorrectoReemplazo > 0;
          const precioUnitFinal = isWrong ? rules.precioCorrectoReemplazo : it.precioUnitarioConIgv;
          return {
            id: crypto.randomUUID(),
            unidad: it.unidad === 'UNIDAD' ? 'NIU' : it.unidad.length <= 3 ? it.unidad : 'ZZ',
            descripcion: it.descripcion,
            cantidad: it.cantidad,
            montoIngresado: precioUnitFinal,
            esTotalLinea: false,
            afectacion: (tasa > 0 ? '10' : '20') as '10' | '20',
          };
        })
      : [
          {
            id: crypto.randomUUID(),
            unidad: 'ZZ',
            descripcion: config.conceptosRapidos[0] || 'Prestación de Servicios / Consumo',
            cantidad: audited.correccion?.cantidadTotalAfectada || 1,
            montoIngresado: rules.precioCorrectoReemplazo || p.total || 0,
            esTotalLinea: false,
            afectacion: (tasa > 0 ? '10' : '20') as '10' | '20',
          },
        ];

  return {
    id: crypto.randomUUID(),
    notaInterna: `REEM-${p.serieNumero || p.fileName.slice(0, 10)}`,
    tipoComprobante: tipo,
    fechaConsumo: p.fechaEmision || hoy,
    fechaEmisionSunat: hoy,
    serieSunat: tipo === '01' ? config.serieFacturaSol : config.serieBoletaSol,
    numeroSunat: '',
    tipoDocCliente: tipoDoc,
    numeroDocCliente: doc,
    razonSocialCliente: p.razonSocialCliente || 'CLIENTES VARIOS',
    direccionCliente: '',
    emailCliente: '',
    moneda: p.moneda || 'PEN',
    tipoCambio: 3.75,
    modoCalculo: rules.precioCorrectoIncluyeIgv ? 'INCLUYE_IGV' : 'MAS_IGV',
    tasaIgv: tasa,
    recargoConsumoPct: 0,
    descuentoGlobal: 0,
    formaPago: 'CONTADO',
    incluirRefFechaEnDesc: false,
    observaciones: `Reemplaza a ${p.serieNumero || p.fileName} (anulado con Nota de Crédito${
      audited.numeroNc ? ` ${audited.numeroNc}` : ''
    }).`,
    items: newItems,
    estado: 'PENDIENTE',
    creadoEn: now,
    actualizadoEn: now,
  };
}

/**
 * Exporta un reporte Excel (.xlsx) dedicado de Auditoría y Plan de Notas de Crédito.
 */
export function exportAuditExcel(results: AuditedPdfResult[]): void {
  const wb = XLSX.utils.book_new();
  const observados = results.filter((r) => r.tieneError);

  const rowsObs = observados.map((r, i) => ({
    '#': i + 1,
    'Serie-Número': r.parsed.serieNumero || 'Sin detectar',
    Serie: r.parsed.serie || '-',
    Número: r.parsed.numero || '-',
    'Fecha Emisión': r.parsed.fechaEmision || '-',
    'RUC / DNI Cliente': r.parsed.docCliente || '-',
    'Razón Social / Cliente': r.parsed.razonSocialCliente || '-',
    'Tasa IGV PDF (%)': r.parsed.tasaIgvDetectada ?? '-',
    'Total Erróneo (Anular)': r.parsed.total ?? 0,
    'Cant. Afectada': r.correccion?.cantidadTotalAfectada ?? r.parsed.items[0]?.cantidad ?? '-',
    'Precio Unit. Erróneo': r.correccion?.precioErroneoDetectado ?? r.parsed.items[0]?.precioUnitarioConIgv ?? '-',
    'Precio Unit. Correcto': r.correccion?.precioCorrectoObjetivo ?? '-',
    'Nuevo V.U. SUNAT (4 dec)': r.correccion?.nuevoValorUnitarioExacto ?? '-',
    'Nuevo Total Corregido': r.correccion?.nuevoTotal ?? '-',
    Diferencia: r.correccion?.diferenciaTotal ?? '-',
    'Tipo Nota Crédito SUNAT': r.hallazgos[0]?.notaCreditoTipoLabel || '-',
    'Sustento Sugerido': r.hallazgos[0]?.sustentoSugerido || '-',
    'Detalle Hallazgos': r.hallazgos.map((h) => h.detalle).join(' | '),
    'NC Emitida': r.ncEmitida ? 'SI' : 'PENDIENTE',
    'N° Nota Crédito': r.numeroNc || '-',
    'Nuevo Comprobante': r.numeroNueva || '-',
    'Archivo PDF': r.parsed.fileName,
  }));

  const wsObs = XLSX.utils.json_to_sheet(
    rowsObs.length ? rowsObs : [{ Info: 'No se encontraron comprobantes observados con las reglas actuales.' }]
  );
  XLSX.utils.book_append_sheet(wb, wsObs, 'Observados_Notas_Credito');

  const rowsAll = results.map((r, i) => ({
    '#': i + 1,
    Estado: r.tieneError ? 'OBSERVADO (ANULAR/REVISAR)' : 'OK',
    'Serie-Número': r.parsed.serieNumero || '-',
    'Fecha Emisión': r.parsed.fechaEmision || '-',
    'RUC / DNI': r.parsed.docCliente || '-',
    Cliente: r.parsed.razonSocialCliente || '-',
    'Ítems Detectados': r.parsed.items
      .map((it) => `${it.cantidad}× ${it.descripcion} (VU ${formatFixed(it.valorUnitario, 4)} / cIGV ${formatFixed(it.precioUnitarioConIgv, 2)})`)
      .join(' ; '),
    'Base PDF': r.parsed.opGravada ?? '-',
    'IGV PDF': r.parsed.igv ?? '-',
    'Total PDF': r.parsed.total ?? '-',
    Archivo: r.parsed.fileName,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsAll), 'Todos_Los_PDFs_Analizados');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `Auditoria_PDFs_Notas_Credito_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
