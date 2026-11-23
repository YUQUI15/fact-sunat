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
import { buildFolderTreePreview, type FolderTreeNode } from '../lib/folderOrganizer';
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
    titulo: 'Archivo Maestro Completo (Fecha + Empresa + Tipo + Reportes)',
    ejemplo: '01_Por_Fecha/Año/Mes/Semana/Día + 02_Por_Empresa/Cliente + 03_Por_Tipo + 00_Reportes_Contables',
    badge: 'Recomendado',
  },
  {
    id: 'COMPLETO_TEMPORAL',
    titulo: 'Jerarquía Cronológica Completa (Año / Mes / Semana / Día / Tipo)',
    ejemplo: '2026 / 11_Noviembre / Semana_47_(16Nov-22Nov) / 2026-11-18_Miercoles / Facturas /',
  },
  {
    id: 'ANIO_MES_DIA',
    titulo: 'Estructura Diaria (Año / Mes / Día)',
    ejemplo: '2026 / 11_Noviembre / 2026-11-18_Miercoles /',
  },
  {
    id: 'POR_EMPRESA',
    titulo: 'Agrupado por Cliente / Empresa → Año / Mes',
    ejemplo: 'Por_Empresa / CORPORACION_COMERCIAL_(20100047218) / 2026 / 11_Noviembre /',
  },
  {
    id: 'ANIO_MES_TIPO',
    titulo: 'Mensual por Tipo de Comprobante (Facturas / Boletas)',
    ejemplo: '2026 / 11_Noviembre / Facturas / y Boletas /',
  },
];

function countNodeFiles(n: FolderTreeNode): number {
  return n.files.length + n.children.reduce((acc, c) => acc + countNodeFiles(c), 0);
}

const TreeFolderView: React.FC<{ node: FolderTreeNode; depth?: number }> = ({ node, depth = 0 }) => {
  const [open, setOpen] = useState(depth < 3);
  return (
    <div className={depth > 0 ? 'ml-4 border-l border-[var(--border-soft)] pl-3' : ''}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer flex items-center gap-1.5 py-1 text-xs text-[var(--text-primary)] hover:opacity-80 font-semibold text-left"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        )}
        {open ? (
          <FolderOpen className="w-4 h-4" style={{ color: 'var(--peach-text)' }} />
        ) : (
          <Folder className="w-4 h-4" style={{ color: 'var(--peach-text)' }} />
        )}
        <span className="font-mono-num">{node.name}</span>
        <span className="text-[10px] text-[var(--text-muted)] ml-1">
          ({countNodeFiles(node)})
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
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: f.hasOfficialPdf ? 'var(--sage-text)' : 'var(--text-muted)' }}
              />
              <span className={f.hasOfficialPdf ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'}>
                {f.hasOfficialPdf ? f.name : `BORRADOR_${f.name}`}
              </span>
              {f.hasOfficialPdf && (
                <span className="text-[9px] px-1.5 rounded fs-pill-sage font-sans font-bold">
                  SUNAT
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

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

  const handleDropOrPickPdfs = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) {
      onNotify('Selecciona archivos en formato .PDF.', 'error');
      return;
    }

    setScanningPdfs(true);
    const items: PdfMatchItem[] = [];
    const usedIds = new Set<string>();

    for (const file of files) {
      const parsed = await parseSunatPdfFile(file);

      let matched = comprobantes.find(
        (c) =>
          !usedIds.has(c.id) &&
          parsed.serie &&
          parsed.numero &&
          c.serieSunat.toUpperCase() === parsed.serie &&
          Number(c.numeroSunat) === Number(parsed.numero)
      );
      let reason = matched ? 'Serie y Número exactos' : '';

      if (!matched && parsed.docCliente && parsed.total !== undefined) {
        matched = comprobantes.find((c) => {
          if (usedIds.has(c.id) || c.pdfAdjunto?.esOficialSunat) return false;
          const calc = calculateComprobante(c);
          return (
            c.numeroDocCliente === parsed.docCliente &&
            Math.abs(calc.importeTotal - parsed.total!) < 0.02
          );
        });
        if (matched) reason = 'RUC/DNI + Total coincidente';
      }

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
        matchReason: reason || 'Se importará como comprobante archivado',
      });
    }

    setScannedQueue(items);
    setScanningPdfs(false);
    onNotify(`${items.length} archivo(s) PDF analizados. Confirma para archivar.`, 'success');
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
    onNotify(`${updatedMap.size} PDF(s) vinculados y ${newlyCreated.length} importado(s) al archivo.`, 'success');
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
      onNotify(`ZIP generado (${res.totalFiles} archivos: ${res.officialPdfs} PDFs SUNAT + reportes).`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error generando ZIP.', 'error');
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
      onNotify(`Carpetas creadas en "${res.folderName}" (${res.totalFiles} archivos).`, 'success');
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
    <div className="space-y-5">
      {/* Paso 1: Carga Inteligente de PDFs SUNAT */}
      <div className="fs-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
            1. Carga y Lectura Automática de PDFs Oficiales SUNAT
          </h3>
          <span className="text-xs font-semibold text-[var(--text-secondary)]">
            Archivados:{' '}
            <strong className="font-mono-num" style={{ color: 'var(--sage-text)' }}>
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
          className="flex flex-col items-center justify-center p-7 rounded-2xl border-2 border-dashed border-[var(--border-strong)] hover:border-[var(--accent-bg)] bg-[var(--bg-inset)] cursor-pointer transition text-center"
        >
          <UploadCloud className="w-8 h-8 mb-2" style={{ color: 'var(--accent-text)' }} />
          <span className="text-sm font-bold text-[var(--text-primary)]">
            {scanningPdfs
              ? 'Analizando contenido de los PDFs...'
              : 'Arrastre aquí los PDFs descargados de SUNAT o haga clic para seleccionar en lote'}
          </span>
          <span className="text-xs text-[var(--text-muted)] mt-1 max-w-xl">
            Extrae automáticamente Serie-Número, Fecha de Emisión, RUC/DNI, Cliente e Importe Total; vincula registros existentes e importa comprobantes previos.
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
              <span className="text-xs font-bold text-[var(--text-primary)]">
                {scannedQueue.length} archivo(s) listos para vincular:
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setScannedQueue([])} className="fs-btn-soft px-3 py-1.5 text-xs">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmProcessPdfs}
                  className="fs-btn-sage px-4 py-1.5 text-xs flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Vincular y Archivar ({scannedQueue.length})
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-[var(--border-soft)] rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-[var(--bg-inset)] text-[var(--text-muted)]">
                  <tr>
                    <th className="p-2.5">Archivo</th>
                    <th className="p-2.5">Serie-N°</th>
                    <th className="p-2.5">Fecha</th>
                    <th className="p-2.5">Cliente</th>
                    <th className="p-2.5 text-right">Total</th>
                    <th className="p-2.5">Emparejamiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-soft)]">
                  {scannedQueue.map((item, idx) => (
                    <tr key={idx}>
                      <td className="p-2.5 font-mono-num text-[var(--text-secondary)]">{item.file.name}</td>
                      <td className="p-2.5 font-mono-num font-bold" style={{ color: 'var(--accent-text)' }}>
                        {item.parsed.serieNumero || 'Sin detectar'}
                      </td>
                      <td className="p-2.5 font-mono-num">{item.parsed.fechaEmision || '-'}</td>
                      <td className="p-2.5">
                        <div className="font-semibold text-[var(--text-primary)]">
                          {item.parsed.razonSocialCliente || '-'}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono-num">
                          {item.parsed.docCliente || '-'}
                        </div>
                      </td>
                      <td className="p-2.5 text-right font-mono-num font-bold" style={{ color: 'var(--sage-text)' }}>
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
                                      matchReason: val ? 'Vinculado manualmente' : 'Crear nuevo registro',
                                    }
                                  : x
                              )
                            );
                          }}
                          className="fs-input w-full px-2 py-1 text-[11px]"
                        >
                          <option value="__NEW__">+ Importar como nuevo registro</option>
                          {comprobantes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.notaInterna} | {c.fechaConsumo} | {c.razonSocialCliente.slice(0, 22)}
                            </option>
                          ))}
                        </select>
                        <div className="text-[10px] mt-0.5 font-medium" style={{ color: 'var(--sage-text)' }}>
                          {item.matchReason}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Paso 2: Estructura de Carpetas + Vista Previa + Exportación */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-6 fs-card p-5 space-y-4">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">
            2. Esquema de Clasificación y Exportación
          </h3>

          <div className="space-y-2">
            {ESQUEMAS.map((es) => (
              <button
                key={es.id}
                type="button"
                onClick={() => handleSelectEsquema(es.id)}
                className={`cursor-pointer w-full text-left p-3.5 rounded-xl border transition ${
                  esquema === es.id
                    ? 'fs-pill-accent'
                    : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-xs">{es.titulo}</span>
                  {es.badge && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full fs-pill-sage font-bold">
                      {es.badge}
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono-num opacity-75 mt-1 break-all">{es.ejemplo}</div>
              </button>
            ))}
          </div>

          <div className="pt-3 border-t border-[var(--border-soft)] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[var(--text-secondary)]">Fecha de clasificación:</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSelectFechaBase('CONSUMO')}
                  className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-bold ${
                    fechaBase === 'CONSUMO' ? 'fs-pill-accent' : 'fs-btn-soft'
                  }`}
                >
                  Fecha de Operación
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectFechaBase('EMISION_SUNAT')}
                  className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-bold ${
                    fechaBase === 'EMISION_SUNAT' ? 'fs-pill-accent' : 'fs-btn-soft'
                  }`}
                >
                  Fecha Emisión SUNAT
                </button>
              </div>
            </div>

            <div className="space-y-2 text-xs text-[var(--text-secondary)]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={incluirBorradores}
                  onChange={(e) => setIncluirBorradores(e.target.checked)}
                  className="accent-[var(--accent-bg)]"
                />
                Generar constancia borrador PDF para registros pendientes de PDF oficial
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={incluirXmlUbl}
                  onChange={(e) => setIncluirXmlUbl(e.target.checked)}
                  className="accent-[var(--accent-bg)]"
                />
                Incluir XML UBL 2.1 junto a cada comprobante
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={incluirReportes}
                  onChange={(e) => setIncluirReportes(e.target.checked)}
                  className="accent-[var(--accent-bg)]"
                />
                Incluir carpeta <code>00_Reportes_Contables/</code> (Excel 6 hojas + PDF Ejecutivo + JSON)
              </label>
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--border-soft)] space-y-2.5">
            {diskSupported && (
              <button
                type="button"
                disabled={exporting || !stats.activos}
                onClick={handleExportDirectDisk}
                className="fs-btn-sage w-full py-3.5 px-4 text-sm flex items-center justify-center gap-2 shadow-sm"
              >
                <HardDriveDownload className="w-4 h-4" />
                {exporting ? 'Creando estructura...' : 'Guardar Carpetas en Equipo Local (Directo)'}
              </button>
            )}

            <button
              type="button"
              disabled={exporting || !stats.activos}
              onClick={handleExportZip}
              className="fs-btn-primary w-full py-3 px-4 text-xs sm:text-sm flex items-center justify-center gap-2"
            >
              <Archive className="w-4 h-4" />
              Descargar Archivo Comprimido (.zip)
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!stats.activos}
                onClick={() => downloadExcelContable(comprobantes, config, fechaBase)}
                className="fs-btn-soft py-2.5 px-3 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
              >
                <FileSpreadsheet className="w-4 h-4" style={{ color: 'var(--sage-text)' }} />
                Excel Contable (6 hojas)
              </button>
              <button
                type="button"
                disabled={!stats.activos}
                onClick={() => {
                  const blob = generateReporteEjecutivoPdfBlob(comprobantes, config);
                  triggerDownload(blob, `Reporte_Ejecutivo_SUNAT_${new Date().toISOString().slice(0, 10)}.pdf`);
                }}
                className="fs-btn-soft py-2.5 px-3 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
              >
                <FileText className="w-4 h-4" style={{ color: 'var(--sky-text)' }} />
                Reporte Ejecutivo PDF
              </button>
            </div>
          </div>
        </div>

        {/* Vista Previa del Árbol */}
        <div className="lg:col-span-6 fs-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              Vista Previa del Árbol de Directorios
            </h3>
            <span className="text-xs text-[var(--text-muted)] font-mono-num">
              {stats.activos} comprobante(s)
            </span>
          </div>
          <div className="fs-inset p-4 max-h-[520px] overflow-y-auto">
            {stats.activos === 0 ? (
              <div className="text-xs text-[var(--text-muted)] text-center py-8">
                Sin comprobantes registrados para generar vista previa.
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
