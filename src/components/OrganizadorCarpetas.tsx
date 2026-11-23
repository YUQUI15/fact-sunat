import React, { useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  FolderOutput,
  HardDriveDownload,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import type {
  ClienteFrecuente,
  ComprobanteRecord,
  EmpresaEmisoraConfig,
  EsquemaCarpetas,
  FechaBaseCarpeta,
} from '../types/sunat';
import {
  buildFolderTreePreview,
  type FolderTreeNode,
} from '../lib/folderOrganizer';
import { parseSunatPdfFile, type ParsedSunatPdf } from '../lib/sunatPdfParser';
import { savePdfBlob } from '../lib/storage';
import { calculateComprobante, formatFixed } from '../lib/sunatMath';
import {
  downloadExcelContable,
  exportDirectToDiskFolder,
  exportStructuredZip,
  generateReporteEjecutivoPdfBlob,
  supportsDirectDiskExport,
  triggerDownload,
} from '../lib/exporters';
import { getHoyPeruISO } from '../lib/sunatValidators';

interface OrganizadorCarpetasProps {
  comprobantes: ComprobanteRecord[];
  clientes: ClienteFrecuente[];
  config: EmpresaEmisoraConfig;
  onUpdateConfig: (patch: Partial<EmpresaEmisoraConfig>) => void;
  onAttachPdfsAndImport: (
    updatedRecords: ComprobanteRecord[],
    newlyCreatedRecords: ComprobanteRecord[]
  ) => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

interface PdfMatchItem {
  file: File;
  parsed: ParsedSunatPdf;
  matchedRecordId: string | null;
  matchReason: string;
}

const ESQUEMAS: Array<{ id: EsquemaCarpetas; titulo: string; ejemplo: string; badge?: string }> = [
  {
    id: 'SUPER_DUAL',
    titulo: 'Súper Archivo Completo (Fecha + Empresa + Tipo + Reportes)',
    ejemplo: '01_Por_Fecha/2026/11_Noviembre/Semana_47/2026-11-18/ + 02_Por_Empresa/ + 03_Por_Tipo/ + 00_Reportes/',
    badge: 'Recomendado',
  },
  {
    id: 'COMPLETO_TEMPORAL',
    titulo: 'Jerarquía Temporal Completa (Año / Mes / Semana / Día / Tipo)',
    ejemplo: '2026 / 11_Noviembre / Semana_47_(16Nov-22Nov) / 2026-11-18_Miercoles / Facturas /',
  },
  {
    id: 'ANIO_MES_DIA',
    titulo: 'Clásica por Fecha (Año / Mes / Día)',
    ejemplo: '2026 / 11_Noviembre / 2026-11-18_Miercoles /',
  },
  {
    id: 'POR_EMPRESA',
    titulo: 'Organizado por Empresa / Agencia → Año / Mes',
    ejemplo: 'Por_Empresa / INCA_TRAILS_SAC_(20131312955) / 2026 / 11_Noviembre /',
  },
  {
    id: 'ANIO_MES_TIPO',
    titulo: 'Mensual por Tipo (Año / Mes / Facturas y Boletas)',
    ejemplo: '2026 / 11_Noviembre / Facturas /  y  Boletas /',
  },
];

const TreeFolderView: React.FC<{ node: FolderTreeNode; depth?: number }> = ({ node, depth = 0 }) => {
  const [open, setOpen] = useState(depth < 3);
  return (
    <div className={depth > 0 ? 'ml-4 border-l border-slate-800 pl-3' : ''}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 py-1 text-xs text-slate-200 hover:text-amber-300 font-medium text-left"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
        {open ? <FolderOpen className="w-4 h-4 text-amber-400" /> : <Folder className="w-4 h-4 text-amber-400" />}
        <span className="font-mono-num">{node.name}</span>
        <span className="text-[10px] text-slate-500 ml-1">
          ({node.files.length + node.children.reduce((acc, c) => acc + countNodeFiles(c), 0)} archivos)
        </span>
      </button>
      {open && (
        <div className="space-y-0.5">
          {node.children.map((ch) => (
            <TreeFolderView key={ch.path} node={ch} depth={depth + 1} />
          ))}
          {node.files.map((f, i) => (
            <div
              key={`${f.comprobanteId}-${i}`}
              className="ml-6 flex items-center gap-1.5 py-0.5 text-[11px] font-mono-num"
            >
              <FileText
                className={`w-3.5 h-3.5 shrink-0 ${f.hasOfficialPdf ? 'text-emerald-400' : 'text-slate-500'}`}
              />
              <span className={f.hasOfficialPdf ? 'text-emerald-200' : 'text-slate-400'}>
                {f.hasOfficialPdf ? f.name : `BORRADOR_${f.name}`}
              </span>
              {f.hasOfficialPdf && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300">
                  PDF SUNAT
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function countNodeFiles(n: FolderTreeNode): number {
  return n.files.length + n.children.reduce((acc, c) => acc + countNodeFiles(c), 0);
}

export const OrganizadorCarpetas: React.FC<OrganizadorCarpetasProps> = ({
  comprobantes,
  clientes,
  config,
  onUpdateConfig,
  onAttachPdfsAndImport,
  onNotify,
}) => {
  const [esquema, setEsquema] = useState<EsquemaCarpetas>(config.esquemaCarpetasDefecto);
  const [fechaBase, setFechaBase] = useState<FechaBaseCarpeta>(config.fechaBaseCarpeta);
  const [incluirBorradores, setIncluirBorradores] = useState<boolean>(true);
  const [incluirXmlUbl, setIncluirXmlUbl] = useState<boolean>(false);
  const [incluirReportes, setIncluirReportes] = useState<boolean>(true);

  const [scanningPdfs, setScanningPdfs] = useState<boolean>(false);
  const [scannedQueue, setScannedQueue] = useState<PdfMatchItem[]>([]);
  const [exporting, setExporting] = useState<boolean>(false);

  const diskSupported = useMemo(() => supportsDirectDiskExport(), []);

  const treePreview = useMemo(
    () => buildFolderTreePreview(comprobantes, esquema, fechaBase),
    [comprobantes, esquema, fechaBase]
  );

  const stats = useMemo(() => {
    const activos = comprobantes.filter((c) => c.estado !== 'ANULADO');
    const oficiales = activos.filter((c) => c.pdfAdjunto?.esOficialSunat).length;
    return { activos: activos.length, oficiales, sinPdf: activos.length - oficiales };
  }, [comprobantes]);

  const handleSelectEsquema = (id: EsquemaCarpetas) => {
    setEsquema(id);
    onUpdateConfig({ esquemaCarpetasDefecto: id });
  };

  const handleSelectFechaBase = (fb: FechaBaseCarpeta) => {
    setFechaBase(fb);
    onUpdateConfig({ fechaBaseCarpeta: fb });
  };

  // Analizar PDFs de SUNAT arrastrados o seleccionados en lote
  const handleDropOrPickPdfs = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) {
      onNotify('Selecciona archivos en formato .PDF descargados de SUNAT.', 'error');
      return;
    }

    setScanningPdfs(true);
    const items: PdfMatchItem[] = [];
    const usedIds = new Set<string>();

    for (const file of files) {
      const parsed = await parseSunatPdfFile(file);

      // Emparejamiento inteligente con la bandeja:
      // 1) Coincidencia exacta de Serie y Número
      let matched = comprobantes.find(
        (c) =>
          !usedIds.has(c.id) &&
          parsed.serie &&
          parsed.numero &&
          c.serieSunat.toUpperCase() === parsed.serie &&
          Number(c.numeroSunat) === Number(parsed.numero)
      );
      let reason = matched ? 'Serie y Número exactos' : '';

      // 2) Coincidencia por RUC/DNI + Total exacto
      if (!matched && parsed.docCliente && parsed.total !== undefined) {
        matched = comprobantes.find((c) => {
          if (usedIds.has(c.id) || c.pdfAdjunto?.esOficialSunat) return false;
          const calc = calculateComprobante(c);
          return (
            c.numeroDocCliente === parsed.docCliente &&
            Math.abs(calc.importeTotal - parsed.total!) < 0.02
          );
        });
        if (matched) reason = 'RUC/DNI + Total exacto';
      }

      // 3) Coincidencia por Tipo + Total exacto (para Boletas Clientes Varios)
      if (!matched && parsed.total !== undefined) {
        matched = comprobantes.find((c) => {
          if (usedIds.has(c.id) || c.pdfAdjunto?.esOficialSunat) return false;
          const calc = calculateComprobante(c);
          const sameTipo = !parsed.tipoComprobante || c.tipoComprobante === parsed.tipoComprobante;
          return sameTipo && Math.abs(calc.importeTotal - parsed.total!) < 0.02;
        });
        if (matched) reason = 'Tipo + Monto Total coincidente';
      }

      if (matched) usedIds.add(matched.id);

      items.push({
        file,
        parsed,
        matchedRecordId: matched?.id || null,
        matchReason: reason || 'Nuevo PDF (se importará automáticamente como comprobante archivado)',
      });
    }

    setScannedQueue(items);
    setScanningPdfs(false);
    onNotify(`Se analizaron ${items.length} PDF(s) de SUNAT. Confirma para vincularlos y archivarlos.`, 'success');
  };

  const handleConfirmProcessPdfs = async () => {
    if (!scannedQueue.length) return;
    const updatedMap = new Map<string, ComprobanteRecord>();
    const newlyCreated: ComprobanteRecord[] = [];
    const hoy = getHoyPeruISO();

    for (const item of scannedQueue) {
      const pdfId = `pdf_batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await savePdfBlob(pdfId, item.file, item.file.name);

      const meta = {
        id: pdfId,
        fileName: item.file.name,
        size: item.file.size,
        uploadedAt: new Date().toISOString(),
        esOficialSunat: true,
        parsedSummary: {
          serieNumero: item.parsed.serieNumero,
          fechaEmision: item.parsed.fechaEmision,
          rucCliente: item.parsed.docCliente,
          razonSocial: item.parsed.razonSocialCliente,
          total: item.parsed.total,
          igv: item.parsed.igv,
        },
      };

      if (item.matchedRecordId) {
        const existing = comprobantes.find((c) => c.id === item.matchedRecordId);
        if (existing) {
          updatedMap.set(existing.id, {
            ...existing,
            serieSunat: item.parsed.serie || existing.serieSunat,
            numeroSunat: item.parsed.numero ? item.parsed.numero.padStart(6, '0') : existing.numeroSunat,
            fechaEmisionSunat: item.parsed.fechaEmision || existing.fechaEmisionSunat,
            estado: 'ARCHIVADO',
            pdfAdjunto: meta,
            actualizadoEn: new Date().toISOString(),
          });
        }
      } else {
        // Importar automáticamente un PDF histórico de SUNAT (ej. emitido días atrás por el chico anterior!)
        const tipo = item.parsed.tipoComprobante || '01';
        const doc = item.parsed.docCliente || '-';
        const tipoDoc = doc.length === 11 ? '6' : doc.length === 8 ? '1' : '0';
        const total = item.parsed.total || 0;
        const fecha = item.parsed.fechaEmision || hoy;
        const tasaEstimada =
          item.parsed.opGravada && item.parsed.igv && item.parsed.opGravada > 0
            ? Math.round((item.parsed.igv / item.parsed.opGravada) * 1000) / 10
            : config.tasaIgvDefecto;

        newlyCreated.push({
          id: crypto.randomUUID(),
          notaInterna: item.parsed.serieNumero || `PDF-${newlyCreated.length + 1}`,
          tipoComprobante: tipo,
          fechaConsumo: fecha,
          fechaEmisionSunat: fecha,
          serieSunat: item.parsed.serie || (tipo === '01' ? 'E001' : 'EB01'),
          numeroSunat: item.parsed.numero ? item.parsed.numero.padStart(6, '0') : '',
          tipoDocCliente: tipoDoc,
          numeroDocCliente: doc,
          razonSocialCliente: item.parsed.razonSocialCliente || 'CLIENTES VARIOS',
          direccionCliente: '',
          emailCliente: '',
          moneda: item.parsed.moneda || 'PEN',
          tipoCambio: 3.75,
          modoCalculo: 'INCLUYE_IGV',
          tasaIgv: tasaEstimada,
          recargoConsumoPct: 0,
          descuentoGlobal: 0,
          formaPago: 'CONTADO',
          incluirRefFechaEnDesc: false,
          observaciones: `Importado automáticamente desde PDF oficial SUNAT (${item.file.name})`,
          items: [
            {
              id: crypto.randomUUID(),
              unidad: 'ZZ',
              descripcion: 'Comprobante importado desde PDF SUNAT',
              cantidad: 1,
              montoIngresado: total,
              esTotalLinea: true,
              afectacion: tasaEstimada > 0 ? '10' : '20',
            },
          ],
          estado: 'ARCHIVADO',
          pdfAdjunto: meta,
          creadoEn: new Date().toISOString(),
          actualizadoEn: new Date().toISOString(),
        });
      }
    }

    onAttachPdfsAndImport(Array.from(updatedMap.values()), newlyCreated);
    setScannedQueue([]);
    onNotify(
      `¡Listo! ${updatedMap.size} PDF(s) vinculados y ${newlyCreated.length} importado(s) directo al archivo.`,
      'success'
    );
  };

  const handleExportZip = async () => {
    if (!stats.activos) {
      onNotify('No hay comprobantes activos para exportar.', 'error');
      return;
    }
    setExporting(true);
    try {
      const res = await exportStructuredZip(comprobantes, config, {
        esquema,
        fechaBase,
        incluirBorradoresSinPdf: incluirBorradores,
        incluirXmlUbl,
        incluirReportes,
        clientes,
      });
      onNotify(
        `ZIP generado con éxito (${res.totalFiles} archivos: ${res.officialPdfs} PDFs SUNAT, ${res.draftPdfs} borradores + reportes).`,
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error generando el ZIP.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleExportDirectDisk = async () => {
    if (!stats.activos) {
      onNotify('No hay comprobantes activos para guardar.', 'error');
      return;
    }
    setExporting(true);
    try {
      const res = await exportDirectToDiskFolder(comprobantes, config, {
        esquema,
        fechaBase,
        incluirBorradoresSinPdf: incluirBorradores,
        incluirXmlUbl,
        incluirReportes,
        clientes,
      });
      onNotify(
        `¡Carpetas creadas directamente en "${res.folderName}" con ${res.totalFiles} archivos organizados!`,
        'success'
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        onNotify('Selección de carpeta cancelada.', 'info');
      } else {
        onNotify(err instanceof Error ? err.message : 'Error escribiendo en disco.', 'error');
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <FolderOutput className="w-5 h-5 text-amber-400" />
          Organizador Inteligente de PDFs SUNAT y Carpetas Multi-Nivel
        </h2>
        <p className="text-sm text-slate-400">
          Sube los PDFs descargados de SUNAT (uno o cientos a la vez): el sistema los lee automáticamente, los renombra limpiamente y crea todas tus carpetas por Año, Mes, Semana, Día y Empresa directo en la laptop del dueño o en ZIP.
        </p>
      </div>

      {/* ZONA 1: INGESTA INTELIGENTE DE PDFS DE SUNAT */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Paso 1: Cargar PDFs Oficiales descargados de SUNAT (Lectura Automática)
          </h3>
          <span className="text-xs text-slate-400">
            Archivados actualmente:{' '}
            <strong className="text-emerald-400">
              {stats.oficiales} / {stats.activos}
            </strong>
          </span>
        </div>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleDropOrPickPdfs(e.dataTransfer.files);
          }}
          className="flex flex-col items-center justify-center p-7 rounded-2xl border-2 border-dashed border-slate-700 hover:border-amber-400 bg-slate-950/60 cursor-pointer transition text-center"
        >
          <UploadCloud className="w-9 h-9 text-amber-400 mb-2" />
          <span className="text-sm font-bold text-white">
            {scanningPdfs
              ? 'Leyendo contenido de los PDFs de SUNAT...'
              : 'Arrastra aquí tus PDFs de SUNAT o haz clic para seleccionarlos en bloque'}
          </span>
          <span className="text-xs text-slate-400 mt-1 max-w-xl">
            Extrae Serie-Número (E001/EB01), Fecha de Emisión, RUC/DNI, Cliente y Total. Empareja con tus notas registradas e incluso importa PDFs emitidos antes en el mes.
          </span>
          <input
            type="file"
            multiple
            accept=".pdf"
            onChange={(e) => {
              handleDropOrPickPdfs(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </label>

        {scannedQueue.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-white">
                {scannedQueue.length} PDF(s) analizado(s) — listos para archivar:
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScannedQueue([])}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmProcessPdfs}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Vincular y Archivar los {scannedQueue.length} PDF(s)
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950 text-slate-400">
                  <tr>
                    <th className="p-2.5">Archivo Original</th>
                    <th className="p-2.5">Serie-N° Detectado</th>
                    <th className="p-2.5">Fecha</th>
                    <th className="p-2.5">Cliente / Doc</th>
                    <th className="p-2.5 text-right">Total</th>
                    <th className="p-2.5">Destino / Emparejamiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {scannedQueue.map((item, idx) => (
                    <tr key={idx} className="bg-slate-900/60">
                      <td className="p-2.5 font-mono-num text-slate-300">{item.file.name}</td>
                      <td className="p-2.5 font-mono-num text-amber-300 font-bold">
                        {item.parsed.serieNumero || 'Sin detectar'}
                      </td>
                      <td className="p-2.5 font-mono-num">{item.parsed.fechaEmision || '-'}</td>
                      <td className="p-2.5">
                        <div>{item.parsed.razonSocialCliente || '-'}</div>
                        <div className="text-[10px] text-slate-500 font-mono-num">
                          {item.parsed.docCliente || '-'}
                        </div>
                      </td>
                      <td className="p-2.5 text-right font-mono-num text-emerald-300 font-bold">
                        {item.parsed.total !== undefined ? `S/ ${formatFixed(item.parsed.total)}` : '-'}
                      </td>
                      <td className="p-2.5">
                        <select
                          value={item.matchedRecordId || '__NEW__'}
                          onChange={(e) => {
                            const val = e.target.value === '__NEW__' ? null : e.target.value;
                            setScannedQueue((prev) =>
                              prev.map((x, i) =>
                                i === idx
                                  ? {
                                      ...x,
                                      matchedRecordId: val,
                                      matchReason: val ? 'Vinculado manualmente' : 'Crear nuevo comprobante',
                                    }
                                  : x
                              )
                            );
                          }}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200"
                        >
                          <option value="__NEW__">+ Crear nuevo comprobante desde este PDF</option>
                          {comprobantes.map((c) => (
                            <option key={c.id} value={c.id}>
                              Nota {c.notaInterna} | {c.fechaConsumo} | {c.razonSocialCliente.slice(0, 22)}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] text-emerald-400 mt-0.5">{item.matchReason}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ZONA 2: ESQUEMA DE CARPETAS + VISTA PREVIA EN VIVO + BOTONES DE EXPORTACION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-amber-300">
            Paso 2: Elige cómo estructurar tus carpetas
          </h3>

          <div className="space-y-2">
            {ESQUEMAS.map((es) => (
              <button
                key={es.id}
                type="button"
                onClick={() => handleSelectEsquema(es.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition ${
                  esquema === es.id
                    ? 'bg-amber-500/15 border-amber-400 text-white'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-xs sm:text-sm">{es.titulo}</span>
                  {es.badge && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                      {es.badge}
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono-num text-slate-400 mt-1 break-all">{es.ejemplo}</div>
              </button>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-300">Fecha para ordenar las carpetas:</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSelectFechaBase('CONSUMO')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    fechaBase === 'CONSUMO'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Fecha de Consumo/Nota
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectFechaBase('EMISION_SUNAT')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    fechaBase === 'EMISION_SUNAT'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Fecha Emisión SUNAT
                </button>
              </div>
            </div>

            <div className="space-y-2 text-xs text-slate-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={incluirBorradores}
                  onChange={(e) => setIncluirBorradores(e.target.checked)}
                  className="accent-amber-500"
                />
                Generar hoja de trabajo PDF (<code>BORRADOR_...</code>) para comprobantes que aún no tienen PDF oficial SUNAT
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={incluirXmlUbl}
                  onChange={(e) => setIncluirXmlUbl(e.target.checked)}
                  className="accent-amber-500"
                />
                Incluir archivo XML UBL 2.1 junto a cada PDF
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={incluirReportes}
                  onChange={(e) => setIncluirReportes(e.target.checked)}
                  className="accent-amber-500"
                />
                Incluir carpeta <code>00_Reportes_Contables/</code> (Excel 6 hojas + Reporte PDF + Respaldo JSON)
              </label>
            </div>
          </div>

          {/* Botones de Acción Principal */}
          <div className="pt-3 border-t border-slate-800 space-y-2.5">
            {diskSupported && (
              <button
                type="button"
                disabled={exporting || !stats.activos}
                onClick={handleExportDirectDisk}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg disabled:opacity-40 transition"
              >
                <HardDriveDownload className="w-5 h-5" />
                {exporting
                  ? 'Creando carpetas y guardando...'
                  : 'Guardar Carpetas Directo en la Laptop del Dueño (Sin ZIP)'}
              </button>
            )}

            <button
              type="button"
              disabled={exporting || !stats.activos}
              onClick={handleExportZip}
              className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40 transition"
            >
              <Archive className="w-4 h-4" />
              Descargar Todo en ZIP Organizado (.zip)
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!stats.activos}
                onClick={() => downloadExcelContable(comprobantes, config, fechaBase)}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Solo Excel 6 Hojas
              </button>
              <button
                type="button"
                disabled={!stats.activos}
                onClick={() => {
                  const blob = generateReporteEjecutivoPdfBlob(comprobantes, config);
                  triggerDownload(blob, `Reporte_Ejecutivo_PenaShow_${new Date().toISOString().slice(0, 10)}.pdf`);
                }}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-40"
              >
                <FileText className="w-4 h-4" />
                Reporte PDF Dueño
              </button>
            </div>
          </div>
        </div>

        {/* Vista Previa del Árbol de Carpetas en Tiempo Real */}
        <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Vista Previa del Árbol de Carpetas Generado
            </h3>
            <span className="text-[11px] text-slate-400">
              {stats.activos} comprobante(s)
            </span>
          </div>
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 max-h-[540px] overflow-y-auto">
            {stats.activos === 0 ? (
              <div className="text-xs text-slate-500 text-center py-8">
                Aún no hay comprobantes registrados para previsualizar carpetas.
              </div>
            ) : (
              <TreeFolderView node={treePreview} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
