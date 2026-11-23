import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  ClienteFrecuente,
  ComprobanteRecord,
  EmpresaEmisoraConfig,
  EsquemaCarpetas,
  FechaBaseCarpeta,
} from '../types/sunat';
import { calculateComprobante, formatFixed, formatMoney, roundSunat } from './sunatMath';
import {
  buildCleanPdfFileName,
  getFechaJerarquia,
  getTipoNombreCorto,
  resolveFolderPaths,
} from './folderOrganizer';
import { buildDescripcionSunat, generateUbl21Xml } from './sunatUblXml';
import { getPdfBlob } from './storage';
import { validarComprobanteSunat } from './sunatValidators';

// =====================================================================
// 1. EXCEL CONTABLE MULTI-HOJA (.xlsx)
// =====================================================================
export function buildExcelWorkbookBuffer(
  records: ComprobanteRecord[],
  config: EmpresaEmisoraConfig,
  fechaBase: FechaBaseCarpeta
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const activos = records.filter((r) => r.estado !== 'ANULADO');

  // Hoja 1: Registro de Ventas SUNAT (SIRE/PLE friendly)
  const ventasRows = records.map((r, idx) => {
    const calc = calculateComprobante(r);
    const fechaRef = fechaBase === 'EMISION_SUNAT' ? r.fechaEmisionSunat : r.fechaConsumo;
    const jer = getFechaJerarquia(fechaRef);
    const carpetas = resolveFolderPaths(r, config.esquemaCarpetasDefecto, fechaBase);
    const pdfName = buildCleanPdfFileName(r, fechaBase);
    const alertas = validarComprobanteSunat(r, records);
    const errores = alertas.filter((a) => a.nivel === 'error').length;

    return {
      '#': idx + 1,
      Estado: r.estado,
      'Nota Interna': r.notaInterna,
      'Fecha Consumo/Nota': r.fechaConsumo,
      'Fecha Emisión SUNAT': r.fechaEmisionSunat,
      Semana: jer.semanaCarpeta,
      'Tipo Cod.': r.tipoComprobante,
      'Tipo Comprobante': getTipoNombreCorto(r.tipoComprobante),
      Serie: r.serieSunat || '-',
      Número: r.numeroSunat || '-',
      'Tipo Doc.': r.tipoDocCliente,
      'RUC / DNI': r.numeroDocCliente || '-',
      'Razón Social / Cliente': r.razonSocialCliente || 'CLIENTES VARIOS',
      Moneda: r.moneda,
      'Modo IGV': r.modoCalculo === 'INCLUYE_IGV' ? 'Mantener Total (Desglosar)' : 'Neto + IGV',
      'Tasa IGV (%)': calc.tasaIgvPorcentaje,
      'Valor Unitario SUNAT (1er ítem)': calc.items[0]?.valorUnitarioSunatStr || '0.00',
      'Op. Gravada (Subtotal)': calc.opGravada,
      'Op. Exonerada': calc.opExonerada,
      'Op. Inafecta': calc.opInafecta,
      IGV: calc.igvTotal,
      'Recargo Consumo': calc.recargoConsumoMonto,
      'Importe Total': calc.importeTotal,
      'Forma Pago': r.formaPago,
      'Descripción SUNAT': calc.items.map((it) => buildDescripcionSunat(it.descripcion, r)).join(' | '),
      'PDF Oficial': r.pdfAdjunto?.esOficialSunat ? 'SI' : 'NO',
      'Ruta Carpeta': `${carpetas[0]}/${pdfName}`,
      'Errores SUNAT': errores,
      Observaciones: r.observaciones || '',
    };
  });

  const wsVentas = XLSX.utils.json_to_sheet(
    ventasRows.length
      ? ventasRows
      : [{ Info: 'Sin comprobantes registrados todavía' }]
  );
  wsVentas['!cols'] = [
    { wch: 5 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
    { wch: 16 },
    { wch: 24 },
    { wch: 9 },
    { wch: 14 },
    { wch: 8 },
    { wch: 10 },
    { wch: 9 },
    { wch: 14 },
    { wch: 32 },
    { wch: 8 },
    { wch: 24 },
    { wch: 12 },
    { wch: 22 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 15 },
    { wch: 16 },
    { wch: 12 },
    { wch: 42 },
    { wch: 11 },
    { wch: 48 },
    { wch: 12 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, wsVentas, 'Registro_Ventas_SUNAT');

  // Helper de agregación por dimensión
  type Agg = {
    clave: string;
    comprobantes: number;
    facturas: number;
    boletas: number;
    opGravada: number;
    igv: number;
    recargo: number;
    total: number;
  };
  const aggregate = (keyFn: (r: ComprobanteRecord) => string): Agg[] => {
    const map = new Map<string, Agg>();
    for (const r of activos) {
      const k = keyFn(r);
      const c = calculateComprobante(r);
      const curr = map.get(k) || {
        clave: k,
        comprobantes: 0,
        facturas: 0,
        boletas: 0,
        opGravada: 0,
        igv: 0,
        recargo: 0,
        total: 0,
      };
      curr.comprobantes += 1;
      if (r.tipoComprobante === '01') curr.facturas += 1;
      if (r.tipoComprobante === '03') curr.boletas += 1;
      curr.opGravada = roundSunat(curr.opGravada + c.opGravada, 2);
      curr.igv = roundSunat(curr.igv + c.igvTotal, 2);
      curr.recargo = roundSunat(curr.recargo + c.recargoConsumoMonto, 2);
      curr.total = roundSunat(curr.total + c.importeTotal, 2);
      map.set(k, curr);
    }
    return Array.from(map.values()).sort((a, b) => a.clave.localeCompare(b.clave));
  };

  const toSheetRows = (list: Agg[], labelHeader: string) => {
    const rows = list.map((a) => ({
      [labelHeader]: a.clave,
      'Cant. Comprobantes': a.comprobantes,
      Facturas: a.facturas,
      Boletas: a.boletas,
      'Op. Gravada (Base)': a.opGravada,
      'IGV Total': a.igv,
      'Recargo Consumo': a.recargo,
      'Importe Total': a.total,
    }));
    const grand = list.reduce(
      (acc, a) => ({
        comprobantes: acc.comprobantes + a.comprobantes,
        facturas: acc.facturas + a.facturas,
        boletas: acc.boletas + a.boletas,
        opGravada: roundSunat(acc.opGravada + a.opGravada, 2),
        igv: roundSunat(acc.igv + a.igv, 2),
        recargo: roundSunat(acc.recargo + a.recargo, 2),
        total: roundSunat(acc.total + a.total, 2),
      }),
      { comprobantes: 0, facturas: 0, boletas: 0, opGravada: 0, igv: 0, recargo: 0, total: 0 }
    );
    rows.push({
      [labelHeader]: 'TOTAL GENERAL',
      'Cant. Comprobantes': grand.comprobantes,
      Facturas: grand.facturas,
      Boletas: grand.boletas,
      'Op. Gravada (Base)': grand.opGravada,
      'IGV Total': grand.igv,
      'Recargo Consumo': grand.recargo,
      'Importe Total': grand.total,
    });
    return rows;
  };

  const getFechaRef = (r: ComprobanteRecord) =>
    fechaBase === 'EMISION_SUNAT' ? r.fechaEmisionSunat : r.fechaConsumo;

  // Hoja 2: Resumen por Día
  const porDia = aggregate((r) => getFechaJerarquia(getFechaRef(r)).diaCarpeta);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toSheetRows(porDia, 'Día')), 'Resumen_Por_Dia');

  // Hoja 3: Resumen por Semana
  const porSemana = aggregate((r) => {
    const j = getFechaJerarquia(getFechaRef(r));
    return `${j.anio} / ${j.semanaCarpeta}`;
  });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(toSheetRows(porSemana, 'Semana ISO')),
    'Resumen_Por_Semana'
  );

  // Hoja 4: Resumen por Mes
  const porMes = aggregate((r) => {
    const j = getFechaJerarquia(getFechaRef(r));
    return `${j.anio} / ${j.mesCarpeta}`;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toSheetRows(porMes, 'Mes')), 'Resumen_Por_Mes');

  // Hoja 5: Resumen por Empresa / Cliente
  const porCliente = aggregate(
    (r) =>
      `${r.razonSocialCliente || 'CLIENTES VARIOS'}${
        r.numeroDocCliente && r.numeroDocCliente !== '-' ? ` (${r.numeroDocCliente})` : ''
      }`
  ).sort((a, b) => b.total - a.total);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(toSheetRows(porCliente, 'Cliente / Agencia')),
    'Resumen_Por_Empresa'
  );

  // Hoja 6: Auditoría y Cuadre Tributario
  const sumTot = activos.reduce(
    (acc, r) => {
      const c = calculateComprobante(r);
      return {
        gravada: roundSunat(acc.gravada + c.opGravada, 2),
        igv: roundSunat(acc.igv + c.igvTotal, 2),
        total: roundSunat(acc.total + c.importeTotal, 2),
      };
    },
    { gravada: 0, igv: 0, total: 0 }
  );
  const pendientes = activos.filter((r) => r.estado === 'PENDIENTE' || r.estado === 'EN_PROCESO').length;
  const emitidos = activos.filter((r) => r.estado === 'EMITIDO' || r.estado === 'ARCHIVADO').length;
  const conPdf = activos.filter((r) => r.pdfAdjunto?.esOficialSunat).length;

  const auditRows = [
    { Indicador: 'Empresa Emisora', Valor: `${config.razonSocial} (RUC: ${config.ruc || 'Sin configurar'})` },
    { Indicador: 'Fecha de Generación', Valor: new Date().toLocaleString('es-PE') },
    { Indicador: 'Total Comprobantes Activos', Valor: activos.length },
    { Indicador: 'Emitidos en SUNAT', Valor: emitidos },
    { Indicador: 'Pendientes de Emitir', Valor: pendientes },
    { Indicador: 'Con PDF Oficial SUNAT Archivado', Valor: conPdf },
    { Indicador: 'Base Imponible Total (Op. Gravada)', Valor: sumTot.gravada },
    { Indicador: 'IGV Total Calculado', Valor: sumTot.igv },
    { Indicador: 'Importe Total General', Valor: sumTot.total },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(auditRows), 'Auditoria_Cuadre');

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

export function downloadExcelContable(
  records: ComprobanteRecord[],
  config: EmpresaEmisoraConfig,
  fechaBase: FechaBaseCarpeta
): void {
  const buf = buildExcelWorkbookBuffer(records, config, fechaBase);
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `Registro_Ventas_SUNAT_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// =====================================================================
// 2. GENERADOR DE CONSTANCIA INTERNA PDF (BORRADOR / HOJA DE TRABAJO)
//    Y REPORTE EJECUTIVO PDF PARA EL DUEÑO
// =====================================================================
export function generateConstanciaInternaPdfBlob(
  rec: ComprobanteRecord,
  config: EmpresaEmisoraConfig
): Blob {
  const calc = calculateComprobante(rec);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Banner superior
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(248, 250, 252);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(config.nombreComercial || config.razonSocial || 'PEÑA SHOW', 14, 13);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`RUC Emisor: ${config.ruc || 'PENDIENTE'}  |  ${config.direccion || 'Perú'}`, 14, 20);
  doc.setTextColor(251, 191, 36);
  doc.text('HOJA DE TRABAJO / BORRADOR INTERNO (NO REEMPLAZA AL PDF OFICIAL DE SUNAT)', 14, 27);

  // Caja derecha tipo comprobante
  doc.setDrawColor(245, 158, 11);
  doc.setFillColor(30, 41, 59);
  doc.roundedRect(142, 6, 56, 20, 2, 2, 'FD');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(getTipoNombreCorto(rec.tipoComprobante) + ' ELECTRÓNICA', 170, 14, { align: 'center' });
  doc.setFontSize(11);
  doc.setTextColor(251, 191, 36);
  const serieNum = rec.serieSunat && rec.numeroSunat ? `${rec.serieSunat}-${rec.numeroSunat}` : `REF ${rec.notaInterna}`;
  doc.text(serieNum, 170, 22, { align: 'center' });

  // Datos cliente y fechas
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('DATOS DEL COMPROBANTE Y CLIENTE', 14, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Cliente / Razón Social: ${rec.razonSocialCliente || 'CLIENTES VARIOS'}`, 14, 49);
  doc.text(`Doc. Identidad (${rec.tipoDocCliente}): ${rec.numeroDocCliente || '-'}`, 14, 55);
  doc.text(`Dirección: ${rec.direccionCliente || '-'}`, 14, 61);

  doc.text(`Fecha Nota/Consumo: ${rec.fechaConsumo}`, 128, 49);
  doc.text(`Fecha Emisión SUNAT: ${rec.fechaEmisionSunat}`, 128, 55);
  doc.text(`Nota Interna: ${rec.notaInterna || '-'}  |  Pago: ${rec.formaPago}`, 128, 61);
  doc.text(
    `IGV Aplicado: ${calc.tasaIgvPorcentaje}%  |  Modo: ${
      rec.modoCalculo === 'INCLUYE_IGV' ? 'Total Incluye IGV' : 'Neto + IGV'
    }`,
    128,
    67
  );

  // Tabla de ítems
  autoTable(doc, {
    startY: 74,
    head: [['Cant.', 'Und', 'Descripción SUNAT', 'Val. Unit. Exacto', 'Base (Sin IGV)', 'IGV', 'Total']],
    body: calc.items.map((it) => [
      String(it.cantidad),
      it.unidad,
      buildDescripcionSunat(it.descripcion, rec),
      it.valorUnitarioSunatStr,
      formatFixed(it.valorVenta, 2),
      formatFixed(it.igvLinea, 2),
      formatFixed(it.totalLinea, 2),
    ]),
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8.5 },
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { halign: 'center', cellWidth: 12 },
      3: { halign: 'right', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 24 },
      5: { halign: 'right', cellWidth: 20 },
      6: { halign: 'right', cellWidth: 22 },
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 115;

  // Totales
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text(calc.montoEnLetras, 14, finalY + 10);

  const rx = 140;
  doc.setFont('helvetica', 'normal');
  doc.text('Op. Gravada (Subtotal):', rx, finalY + 10);
  doc.text(formatMoney(calc.opGravada, rec.moneda), 196, finalY + 10, { align: 'right' });

  doc.text(`IGV (${calc.tasaIgvPorcentaje}%):`, rx, finalY + 16);
  doc.text(formatMoney(calc.igvTotal, rec.moneda), 196, finalY + 16, { align: 'right' });

  if (calc.recargoConsumoMonto > 0) {
    doc.text(`Recargo Consumo (${calc.recargoConsumoPorcentaje}%):`, rx, finalY + 22);
    doc.text(formatMoney(calc.recargoConsumoMonto, rec.moneda), 196, finalY + 22, { align: 'right' });
  }

  const totalY = calc.recargoConsumoMonto > 0 ? finalY + 29 : finalY + 23;
  doc.setFillColor(241, 245, 249);
  doc.rect(rx - 2, totalY - 5, 60, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('IMPORTE TOTAL:', rx, totalY);
  doc.text(formatMoney(calc.importeTotal, rec.moneda), 196, totalY, { align: 'right' });

  if (rec.observaciones) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Observaciones: ${rec.observaciones}`, 14, totalY + 12);
  }

  return doc.output('blob');
}

export function generateReporteEjecutivoPdfBlob(
  records: ComprobanteRecord[],
  config: EmpresaEmisoraConfig
): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const activos = records.filter((r) => r.estado !== 'ANULADO');

  const totals = activos.reduce(
    (acc, r) => {
      const c = calculateComprobante(r);
      return {
        gravada: roundSunat(acc.gravada + c.opGravada, 2),
        igv: roundSunat(acc.igv + c.igvTotal, 2),
        total: roundSunat(acc.total + c.importeTotal, 2),
      };
    },
    { gravada: 0, igv: 0, total: 0 }
  );

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 297, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`REPORTE DE FACTURACIÓN SUNAT — ${config.nombreComercial || config.razonSocial}`, 14, 12);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(
    `RUC: ${config.ruc || 'Sin configurar'}  |  Generado: ${new Date().toLocaleString('es-PE')}  |  Comprobantes activos: ${activos.length}`,
    14,
    20
  );

  // KPI strip
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Op. Gravada Total: S/ ${formatFixed(totals.gravada)}    |    IGV Total: S/ ${formatFixed(totals.igv)}    |    IMPORTE TOTAL: S/ ${formatFixed(totals.total)}`,
    14,
    34
  );

  autoTable(doc, {
    startY: 39,
    head: [
      [
        'Nota',
        'F. Consumo',
        'F. SUNAT',
        'Tipo',
        'Serie-N°',
        'RUC/DNI',
        'Cliente / Empresa',
        'IGV %',
        'Base',
        'IGV',
        'Total',
        'Estado',
      ],
    ],
    body: activos.map((r) => {
      const c = calculateComprobante(r);
      return [
        r.notaInterna || '-',
        r.fechaConsumo,
        r.fechaEmisionSunat,
        getTipoNombreCorto(r.tipoComprobante),
        r.serieSunat && r.numeroSunat ? `${r.serieSunat}-${r.numeroSunat}` : 'Pendiente',
        r.numeroDocCliente || '-',
        (r.razonSocialCliente || 'CLIENTES VARIOS').slice(0, 32),
        `${c.tasaIgvPorcentaje}%`,
        formatFixed(c.opGravada, 2),
        formatFixed(c.igvTotal, 2),
        formatFixed(c.importeTotal, 2),
        r.estado,
      ];
    }),
    headStyles: { fillColor: [15, 23, 42], fontSize: 8 },
    styles: { fontSize: 7.5, cellPadding: 2 },
    columnStyles: {
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right', fontStyle: 'bold' },
    },
  });

  return doc.output('blob');
}

// =====================================================================
// 3. EXPORTAR TODO EN ZIP ORGANIZADO POR CARPETAS
// =====================================================================
export interface ExportArchiveOptions {
  esquema: EsquemaCarpetas;
  fechaBase: FechaBaseCarpeta;
  incluirBorradoresSinPdf: boolean;
  incluirXmlUbl: boolean;
  incluirReportes: boolean;
  clientes: ClienteFrecuente[];
}

export async function exportStructuredZip(
  records: ComprobanteRecord[],
  config: EmpresaEmisoraConfig,
  opts: ExportArchiveOptions
): Promise<{ totalFiles: number; officialPdfs: number; draftPdfs: number }> {
  const zip = new JSZip();
  const rootName = 'Facturacion_PenaShow_SUNAT';
  const root = zip.folder(rootName)!;

  let totalFiles = 0;
  let officialPdfs = 0;
  let draftPdfs = 0;

  for (const rec of records) {
    if (rec.estado === 'ANULADO') continue;

    let pdfData: Blob | null = null;
    if (rec.pdfAdjunto) {
      const stored = await getPdfBlob(rec.pdfAdjunto.id);
      if (stored) {
        pdfData = stored.blob;
        officialPdfs++;
      }
    }

    if (!pdfData && opts.incluirBorradoresSinPdf) {
      pdfData = generateConstanciaInternaPdfBlob(rec, config);
      draftPdfs++;
    }

    const dirs = resolveFolderPaths(rec, opts.esquema, opts.fechaBase);
    const cleanPdfName = buildCleanPdfFileName(rec, opts.fechaBase);
    const finalPdfName = rec.pdfAdjunto?.esOficialSunat ? cleanPdfName : `BORRADOR_${cleanPdfName}`;

    for (const dir of dirs) {
      if (pdfData) {
        root.file(`${dir}/${finalPdfName}`, pdfData);
        totalFiles++;
      }
      if (opts.incluirXmlUbl) {
        const xmlStr = generateUbl21Xml(rec, config);
        const xmlName = cleanPdfName.replace(/\.pdf$/i, '.xml');
        root.file(`${dir}/${xmlName}`, xmlStr);
        totalFiles++;
      }
    }
  }

  if (opts.incluirReportes) {
    const excelBuf = buildExcelWorkbookBuffer(records, config, opts.fechaBase);
    const dateStamp = new Date().toISOString().slice(0, 10);
    root.file(`00_Reportes_Contables/Registro_Ventas_SUNAT_${dateStamp}.xlsx`, excelBuf);
    const execPdf = generateReporteEjecutivoPdfBlob(records, config);
    root.file(`00_Reportes_Contables/Reporte_Ejecutivo_${dateStamp}.pdf`, execPdf);
    const backupJson = JSON.stringify(
      { version: '1.0', exportedAt: new Date().toISOString(), config, clientes: opts.clientes, comprobantes: records },
      null,
      2
    );
    root.file(`00_Reportes_Contables/Respaldo_Portable_PenaFact_${dateStamp}.json`, backupJson);
    totalFiles += 3;
  }

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerDownload(zipBlob, `Facturacion_PenaShow_${new Date().toISOString().slice(0, 10)}.zip`);

  return { totalFiles, officialPdfs, draftPdfs };
}

// =====================================================================
// 4. GUARDAR CARPETAS DIRECTAMENTE EN EL DISCO DURO (Chrome/Edge API)
// =====================================================================
interface FileSystemWritableLike {
  write(data: Blob | ArrayBuffer | string): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableLike>;
}
interface FileSystemDirectoryHandleLike {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
}

export function supportsDirectDiskExport(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

async function ensureNestedDir(
  rootHandle: FileSystemDirectoryHandleLike,
  relativePath: string
): Promise<FileSystemDirectoryHandleLike> {
  let curr = rootHandle;
  const parts = relativePath.split('/').filter(Boolean);
  for (const part of parts) {
    curr = await curr.getDirectoryHandle(part, { create: true });
  }
  return curr;
}

async function writeFileToDir(
  dirHandle: FileSystemDirectoryHandleLike,
  fileName: string,
  data: Blob | ArrayBuffer | string
): Promise<void> {
  const fh = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function exportDirectToDiskFolder(
  records: ComprobanteRecord[],
  config: EmpresaEmisoraConfig,
  opts: ExportArchiveOptions
): Promise<{ folderName: string; totalFiles: number; officialPdfs: number; draftPdfs: number }> {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandleLike> })
    .showDirectoryPicker;
  if (!picker) {
    throw new Error('Tu navegador no soporta escritura directa en disco. Usa "Descargar ZIP Organizado".');
  }

  const chosenDir = await picker({ mode: 'readwrite' });
  const rootDir = await chosenDir.getDirectoryHandle('Facturacion_PenaShow_SUNAT', { create: true });

  let totalFiles = 0;
  let officialPdfs = 0;
  let draftPdfs = 0;

  for (const rec of records) {
    if (rec.estado === 'ANULADO') continue;

    let pdfData: Blob | null = null;
    if (rec.pdfAdjunto) {
      const stored = await getPdfBlob(rec.pdfAdjunto.id);
      if (stored) {
        pdfData = stored.blob;
        officialPdfs++;
      }
    }
    if (!pdfData && opts.incluirBorradoresSinPdf) {
      pdfData = generateConstanciaInternaPdfBlob(rec, config);
      draftPdfs++;
    }

    const dirs = resolveFolderPaths(rec, opts.esquema, opts.fechaBase);
    const cleanPdfName = buildCleanPdfFileName(rec, opts.fechaBase);
    const finalPdfName = rec.pdfAdjunto?.esOficialSunat ? cleanPdfName : `BORRADOR_${cleanPdfName}`;

    for (const dir of dirs) {
      const targetHandle = await ensureNestedDir(rootDir, dir);
      if (pdfData) {
        await writeFileToDir(targetHandle, finalPdfName, pdfData);
        totalFiles++;
      }
      if (opts.incluirXmlUbl) {
        const xmlStr = generateUbl21Xml(rec, config);
        await writeFileToDir(targetHandle, cleanPdfName.replace(/\.pdf$/i, '.xml'), xmlStr);
        totalFiles++;
      }
    }
  }

  if (opts.incluirReportes) {
    const repDir = await ensureNestedDir(rootDir, '00_Reportes_Contables');
    const dateStamp = new Date().toISOString().slice(0, 10);
    const excelBuf = buildExcelWorkbookBuffer(records, config, opts.fechaBase);
    await writeFileToDir(repDir, `Registro_Ventas_SUNAT_${dateStamp}.xlsx`, excelBuf);
    const execPdf = generateReporteEjecutivoPdfBlob(records, config);
    await writeFileToDir(repDir, `Reporte_Ejecutivo_${dateStamp}.pdf`, execPdf);
    const backupJson = JSON.stringify(
      { version: '1.0', exportedAt: new Date().toISOString(), config, clientes: opts.clientes, comprobantes: records },
      null,
      2
    );
    await writeFileToDir(repDir, `Respaldo_Portable_PenaFact_${dateStamp}.json`, backupJson);
    totalFiles += 3;
  }

  return { folderName: `${chosenDir.name}/Facturacion_PenaShow_SUNAT`, totalFiles, officialPdfs, draftPdfs };
}

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Importa filas desde un archivo Excel (.xlsx / .csv) subido por el usuario.
 */
export async function readSpreadsheetToLines(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '' });
  return rows
    .filter((r) => Array.isArray(r) && r.some((cell) => String(cell).trim() !== ''))
    .map((r) => r.map((c) => String(c ?? '').trim()).join('\t'))
    .join('\n');
}
