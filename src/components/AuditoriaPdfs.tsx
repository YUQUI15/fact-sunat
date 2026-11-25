import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  FileSearch,
  FileSpreadsheet,
  Filter,
  ListChecks,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import type { ComprobanteRecord, EmpresaEmisoraConfig } from '../types/sunat';
import { parseSunatPdfFile, type ParsedSunatPdf } from '../lib/sunatPdfParser';
import {
  auditSunatPdfBatch,
  buildCorrectedComprobanteFromAudit,
  exportAuditExcel,
  type AuditedPdfResult,
  type AuditRuleConfig,
  type ModoReglaPrecio,
} from '../lib/pdfAuditor';
import { formatFixed, roundSunat } from '../lib/sunatMath';

interface AuditoriaPdfsProps {
  config: EmpresaEmisoraConfig;
  onSendCorrectedToBandeja: (nuevos: ComprobanteRecord[]) => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

interface RawUploadedPdf {
  id: string;
  parsed: ParsedSunatPdf;
}

interface ProgressState {
  ncEmitida: boolean;
  numeroNc: string;
  reemitida: boolean;
  numeroNueva: string;
}

export const AuditoriaPdfs: React.FC<AuditoriaPdfsProps> = ({
  config,
  onSendCorrectedToBandeja,
  onNotify,
}) => {
  const [rawPdfs, setRawPdfs] = useState<RawUploadedPdf[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, ProgressState>>({});
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState({ done: 0, total: 0 });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<'OBSERVADOS' | 'TODOS' | 'OK'>('OBSERVADOS');
  const [expandedTextId, setExpandedTextId] = useState<string | null>(null);

  // Reglas de detección configurables para cualquier negocio / error de precio
  const [rules, setRules] = useState<AuditRuleConfig>({
    modoPrecio: 'CERCANO_A',
    precioErroneoObjetivo: 5,
    tolerancia: 0.35,
    precioMinimo: 20,
    precioMaximo: 5000,
    precioCorrectoReemplazo: 25,
    precioCorrectoIncluyeIgv: true,
    tasaIgvEsperada: undefined,
    palabraClaveFiltro: '',
    verificarReglasSunat: true,
  });

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) {
      onNotify('Selecciona archivos en formato .PDF de comprobantes SUNAT.', 'error');
      return;
    }

    setScanning(true);
    setScanCount({ done: 0, total: files.length });

    const parsedList: RawUploadedPdf[] = [];
    for (let i = 0; i < files.length; i++) {
      const parsed = await parseSunatPdfFile(files[i]);
      parsedList.push({
        id: `aud_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        parsed,
      });
      setScanCount({ done: i + 1, total: files.length });
    }

    setRawPdfs((prev) => [...prev, ...parsedList]);
    setScanning(false);
    onNotify(`Se analizaron ${parsedList.length} archivo(s) PDF con extracción de ítems.`, 'success');
  };

  // Re-evaluación instantánea cada vez que el usuario cambia el precio erróneo, el precio correcto o las reglas
  const auditedResults: AuditedPdfResult[] = useMemo(() => {
    return auditSunatPdfBatch(
      rawPdfs.map((r) => ({ id: r.id, parsed: r.parsed, prev: progressMap[r.id] })),
      rules
    ).sort((a, b) => {
      if (a.tieneError !== b.tieneError) return a.tieneError ? -1 : 1;
      return (a.parsed.serieNumero || a.parsed.fileName).localeCompare(
        b.parsed.serieNumero || b.parsed.fileName
      );
    });
  }, [rawPdfs, rules, progressMap]);

  const observados = useMemo(() => auditedResults.filter((r) => r.tieneError), [auditedResults]);
  const correctos = useMemo(() => auditedResults.filter((r) => !r.tieneError), [auditedResults]);

  const displayedList = useMemo(() => {
    if (viewFilter === 'OBSERVADOS') return observados;
    if (viewFilter === 'OK') return correctos;
    return auditedResults;
  }, [viewFilter, observados, correctos, auditedResults]);

  const totals = useMemo(() => {
    let totalAnular = 0;
    let totalCorregido = 0;
    let ncListas = 0;
    let reemitidas = 0;
    for (const r of observados) {
      totalAnular = roundSunat(totalAnular + (r.parsed.total || 0), 2);
      totalCorregido = roundSunat(totalCorregido + (r.correccion?.nuevoTotal ?? r.parsed.total ?? 0), 2);
      if (r.ncEmitida) ncListas++;
      if (r.reemitida) reemitidas++;
    }
    return {
      totalAnular,
      totalCorregido,
      diferencia: roundSunat(totalCorregido - totalAnular, 2),
      ncListas,
      reemitidas,
    };
  }, [observados]);

  const updateProgress = (id: string, patch: Partial<ProgressState>) => {
    setProgressMap((prev) => {
      const curr = prev[id] || { ncEmitida: false, numeroNc: '', reemitida: false, numeroNueva: '' };
      return { ...prev, [id]: { ...curr, ...patch } };
    });
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      onNotify('No se pudo copiar al portapapeles.', 'error');
    }
  };

  const handleCopyListaCodigos = () => {
    if (!observados.length) return;
    const text = observados
      .map(
        (r, i) =>
          `${i + 1}. ${r.parsed.serieNumero || r.parsed.fileName} | Fecha: ${r.parsed.fechaEmision || '-'} | RUC/DNI: ${
            r.parsed.docCliente || '-'
          } | ${r.parsed.razonSocialCliente || '-'} | Actual: S/ ${formatFixed(r.parsed.total || 0)}${
            r.correccion ? ` → Corregido: S/ ${formatFixed(r.correccion.nuevoTotal)}` : ''
          }`
      )
      .join('\n');
    copyText('lista_codigos', text);
    onNotify(`Lista de ${observados.length} comprobante(s) observados copiada al portapapeles.`, 'success');
  };

  const handleGenerarFacturasCorregidas = () => {
    if (!observados.length) {
      onNotify('No hay comprobantes observados para generar reemplazos.', 'info');
      return;
    }
    const nuevos = observados.map((aud) => buildCorrectedComprobanteFromAudit(aud, config, rules));
    onSendCorrectedToBandeja(nuevos);
    onNotify(
      `Se generaron ${nuevos.length} comprobante(s) corregidos en Bandeja y Cuadre listos para emitir en SUNAT.`,
      'success'
    );
  };

  return (
    <div className="space-y-5">
      {/* Banner Explicativo Limpio */}
      <div className="fs-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-[var(--text-primary)] flex items-center gap-2">
              <FileSearch className="w-5 h-5" style={{ color: 'var(--accent-text)' }} />
              Auditoría Automática de PDFs Emitidos y Plan de Notas de Crédito
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Cargue en lote todos sus PDFs de SUNAT para detectar automáticamente comprobantes con precios unitarios erróneos, obtener sus Series/Números para anular con Nota de Crédito y generar los reemplazos corregidos.
            </p>
          </div>
          {rawPdfs.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setRawPdfs([]);
                setProgressMap({});
              }}
              className="cursor-pointer px-3 py-1.5 rounded-xl fs-pill-rose text-xs font-bold flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Nueva Auditoría
            </button>
          )}
        </div>

        {/* Reglas Configurables de Detección */}
        <div className="fs-inset p-4 space-y-3">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
            1. Configure el criterio de detección de error
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">
                Regla de Precio Unitario
              </label>
              <select
                value={rules.modoPrecio}
                onChange={(e) => setRules({ ...rules, modoPrecio: e.target.value as ModoReglaPrecio })}
                className="fs-input w-full px-3 py-2 text-xs font-semibold"
              >
                <option value="CERCANO_A">Precio unitario igual / cercano a un valor (ej. S/ 5)</option>
                <option value="MENOR_QUE">Precio unitario menor que un mínimo (ej. &lt; S/ 20)</option>
                <option value="FUERA_DE_RANGO">Precio unitario fuera de rango [Mín – Máx]</option>
                <option value="SOLO_ERRORES_SUNAT">Solo errores tributarios SUNAT (sin filtro de precio)</option>
              </select>
            </div>

            {rules.modoPrecio === 'CERCANO_A' && (
              <div>
                <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--rose-text)' }}>
                  Precio Erróneo a Buscar (S/)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={rules.precioErroneoObjetivo || ''}
                  onChange={(e) =>
                    setRules({ ...rules, precioErroneoObjetivo: parseFloat(e.target.value) || 0 })
                  }
                  placeholder="Ej. 5.00"
                  className="fs-input w-full px-3 py-2 text-xs font-mono-num font-bold"
                />
              </div>
            )}

            {(rules.modoPrecio === 'MENOR_QUE' || rules.modoPrecio === 'FUERA_DE_RANGO') && (
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">
                  Precio Mínimo (S/)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={rules.precioMinimo || ''}
                  onChange={(e) => setRules({ ...rules, precioMinimo: parseFloat(e.target.value) || 0 })}
                  className="fs-input w-full px-3 py-2 text-xs font-mono-num font-bold"
                />
              </div>
            )}

            {rules.modoPrecio === 'FUERA_DE_RANGO' && (
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">
                  Precio Máximo (S/)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={rules.precioMaximo || ''}
                  onChange={(e) => setRules({ ...rules, precioMaximo: parseFloat(e.target.value) || 0 })}
                  className="fs-input w-full px-3 py-2 text-xs font-mono-num font-bold"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--sage-text)' }}>
                Precio Unit. Correcto (S/)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={rules.precioCorrectoReemplazo || ''}
                onChange={(e) =>
                  setRules({ ...rules, precioCorrectoReemplazo: parseFloat(e.target.value) || 0 })
                }
                placeholder="Ej. 25.00"
                className="fs-input w-full px-3 py-2 text-xs font-mono-num font-bold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">
                Filtrar Texto (Opcional)
              </label>
              <input
                type="text"
                value={rules.palabraClaveFiltro}
                onChange={(e) => setRules({ ...rules, palabraClaveFiltro: e.target.value })}
                placeholder="Ej. producto / cliente"
                className="fs-input w-full px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-[var(--text-secondary)]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={rules.precioCorrectoIncluyeIgv}
                onChange={(e) => setRules({ ...rules, precioCorrectoIncluyeIgv: e.target.checked })}
                className="accent-[var(--sage-bg)]"
              />
              El precio correcto (S/ {formatFixed(rules.precioCorrectoReemplazo)}) ya incluye IGV
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={rules.verificarReglasSunat}
                onChange={(e) => setRules({ ...rules, verificarReglasSunat: e.target.checked })}
                className="accent-[var(--accent-bg)]"
              />
              Detectar también errores SUNAT (duplicados, RUC inválido, Boleta ≥ S/ 700, descuadres)
            </label>
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[11px] text-[var(--text-muted)]">Tolerancia (±S/):</span>
              <input
                type="number"
                step="0.05"
                min="0.01"
                max="5"
                value={rules.tolerancia}
                onChange={(e) => setRules({ ...rules, tolerancia: Math.max(0.01, parseFloat(e.target.value) || 0.2) })}
                className="fs-input w-16 px-2 py-0.5 text-xs font-mono-num text-center"
              />
            </div>
          </div>
        </div>

        {/* Dropzone de Carga Masiva de PDFs */}
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFilesSelected(e.dataTransfer.files);
          }}
          className="flex flex-col items-center justify-center p-7 rounded-2xl border-2 border-dashed border-[var(--border-strong)] hover:border-[var(--accent-bg)] bg-[var(--bg-inset)] cursor-pointer transition text-center"
        >
          <UploadCloud className="w-8 h-8 mb-2" style={{ color: 'var(--accent-text)' }} />
          <span className="text-sm font-bold text-[var(--text-primary)]">
            {scanning
              ? `Escaneando PDF ${scanCount.done} de ${scanCount.total}...`
              : 'Arrastre aquí TODOS sus archivos PDF de SUNAT (10, 50 o 200 archivos a la vez)'}
          </span>
          <span className="text-xs text-[var(--text-muted)] mt-1 max-w-xl">
            El auditor lee el contenido interno de cada PDF en segundos (cantidad, descripción y valor unitario con o sin IGV) para identificar exactamente cuáles deben anularse con Nota de Crédito.
          </span>
          <input
            type="file"
            multiple
            accept=".pdf"
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </label>
      </div>

      {/* Resultados de Auditoría */}
      {rawPdfs.length > 0 && (
        <>
          {/* KPIs de Auditoría */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="fs-card p-4">
              <div className="text-[11px] font-bold uppercase text-[var(--text-muted)]">PDFs Analizados</div>
              <div className="text-2xl font-extrabold font-mono-num text-[var(--text-primary)] mt-1">
                {auditedResults.length}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {correctos.length} correctos · {observados.length} con observación
              </div>
            </div>

            <div className="p-4 rounded-2xl fs-pill-rose">
              <div className="text-[11px] font-bold uppercase flex items-center justify-between">
                A Anular (Notas Crédito)
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div className="text-2xl font-extrabold font-mono-num mt-1">
                {observados.length} <span className="text-xs font-bold">docs</span>
              </div>
              <div className="text-[11px] font-mono-num mt-0.5">
                Monto anular: <strong>S/ {formatFixed(totals.totalAnular)}</strong>
              </div>
            </div>

            <div className="p-4 rounded-2xl fs-pill-sage">
              <div className="text-[11px] font-bold uppercase">Nuevo Total Corregido</div>
              <div className="text-2xl font-extrabold font-mono-num mt-1">
                S/ {formatFixed(totals.totalCorregido)}
              </div>
              <div className="text-[11px] font-mono-num mt-0.5">
                Diferencia: {totals.diferencia >= 0 ? '+' : ''}S/ {formatFixed(totals.diferencia)}
              </div>
            </div>

            <div className="fs-card p-4">
              <div className="text-[11px] font-bold uppercase text-[var(--text-muted)] flex items-center justify-between">
                Avance de Corrección
                <ListChecks className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
              </div>
              <div className="text-2xl font-extrabold font-mono-num text-[var(--text-primary)] mt-1">
                {totals.ncListas} / {observados.length}{' '}
                <span className="text-xs font-semibold text-[var(--text-muted)]">NC</span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {totals.reemitidas} / {observados.length} nuevas re-emitidas
              </div>
            </div>
          </div>

          {/* Barra de Acciones Masivas sobre Observados */}
          <div className="fs-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <Filter className="w-4 h-4 text-[var(--text-muted)] mr-1" />
              {(
                [
                  { id: 'OBSERVADOS', label: `Observados (${observados.length})` },
                  { id: 'OK', label: `Correctos (${correctos.length})` },
                  { id: 'TODOS', label: `Todos (${auditedResults.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewFilter(tab.id)}
                  className={`cursor-pointer px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    viewFilter === tab.id ? 'fs-pill-accent' : 'fs-btn-soft'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!observados.length}
                onClick={handleCopyListaCodigos}
                className="fs-btn-soft px-3 py-2 text-xs flex items-center gap-1.5 disabled:opacity-40"
              >
                {copiedKey === 'lista_codigos' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                Copiar Lista de Códigos
              </button>
              <button
                type="button"
                onClick={() => exportAuditExcel(auditedResults)}
                className="fs-btn-soft px-3 py-2 text-xs flex items-center gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" style={{ color: 'var(--sage-text)' }} />
                Exportar Excel Auditoría
              </button>
              <button
                type="button"
                disabled={!observados.length}
                onClick={handleGenerarFacturasCorregidas}
                className="fs-btn-sage px-4 py-2 text-xs flex items-center gap-1.5 shadow-sm"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Crear {observados.length} Facturas Corregidas en Bandeja
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Lista Detallada para Hacer Notas de Crédito sin Errores */}
          <div className="space-y-3">
            {displayedList.length === 0 ? (
              <div className="fs-card p-8 text-center">
                <CheckCircle2 className="w-9 h-9 mx-auto mb-2" style={{ color: 'var(--sage-text)' }} />
                <div className="text-sm font-bold text-[var(--text-primary)]">
                  {viewFilter === 'OBSERVADOS'
                    ? 'No se detectaron PDFs con errores bajo el criterio actual.'
                    : 'No hay archivos en esta vista.'}
                </div>
              </div>
            ) : (
              displayedList.map((item) => {
                const p = item.parsed;
                const mainFinding = item.hallazgos[0];
                const prog = progressMap[item.id] || {
                  ncEmitida: false,
                  numeroNc: '',
                  reemitida: false,
                  numeroNueva: '',
                };

                return (
                  <div
                    key={item.id}
                    className="fs-card p-4 sm:p-5 space-y-3"
                    style={item.tieneError ? { borderColor: 'var(--rose-border)' } : undefined}
                  >
                    {/* Cabecera de Comprobante */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${
                              item.tieneError ? 'fs-pill-rose' : 'fs-pill-sage'
                            }`}
                          >
                            {item.tieneError ? 'ANULAR / CORREGIR' : 'OK'}
                          </span>
                          <span className="text-base font-extrabold font-mono-num text-[var(--text-primary)]">
                            {p.serieNumero || 'Sin Serie-Número'}
                          </span>
                          {p.serie && (
                            <button
                              type="button"
                              onClick={() => copyText(`ser_${item.id}`, p.serie!)}
                              className="cursor-pointer px-2 py-0.5 rounded-lg fs-btn-soft text-[10px] font-mono-num"
                            >
                              {copiedKey === `ser_${item.id}` ? '✓ Serie' : `Copiar ${p.serie}`}
                            </button>
                          )}
                          {p.numero && (
                            <button
                              type="button"
                              onClick={() => copyText(`num_${item.id}`, p.numero!)}
                              className="cursor-pointer px-2 py-0.5 rounded-lg fs-pill-accent text-[10px] font-mono-num font-bold"
                            >
                              {copiedKey === `num_${item.id}` ? '✓ N° Copiado' : `Copiar N° ${p.numero}`}
                            </button>
                          )}
                          <span className="text-xs font-mono-num text-[var(--text-muted)]">
                            · Fecha: {p.fechaEmision || '-'}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          <strong className="text-[var(--text-primary)]">
                            {p.razonSocialCliente || 'Sin cliente detectado'}
                          </strong>{' '}
                          <span className="font-mono-num text-[var(--text-muted)]">
                            ({p.docCliente || '-'})
                          </span>{' '}
                          · Archivo: <span className="font-mono-num text-[var(--text-muted)]">{p.fileName}</span>
                        </div>
                      </div>

                      <div className="text-right font-mono-num">
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Total PDF actual ({p.tasaIgvDetectada ?? 18}% IGV)
                        </div>
                        <div
                          className="text-lg font-extrabold"
                          style={{ color: item.tieneError ? 'var(--rose-text)' : 'var(--sage-text)' }}
                        >
                          S/ {formatFixed(p.total || 0)}
                        </div>
                      </div>
                    </div>

                    {/* Ítems detectados dentro del PDF */}
                    {p.items.length > 0 && (
                      <div className="fs-inset p-3 space-y-1.5 text-xs">
                        <div className="text-[10px] font-bold uppercase text-[var(--text-muted)]">
                          Detalle extraído del PDF ({p.items.length} línea(s)):
                        </div>
                        {p.items.map((it, idx) => (
                          <div
                            key={idx}
                            className="flex flex-wrap items-center justify-between gap-2 font-mono-num text-[11px]"
                          >
                            <span className="font-sans text-[var(--text-primary)]">
                              <strong>{it.cantidad}</strong> {it.unidad} · {it.descripcion}
                            </span>
                            <span className="text-[var(--text-secondary)]">
                              V.U. sin IGV: <strong>{formatFixed(it.valorUnitario, 4)}</strong> · Precio c/IGV:{' '}
                              <strong
                                style={{
                                  color: item.itemsObservados.some((o) => o.rawLine === it.rawLine)
                                    ? 'var(--rose-text)'
                                    : 'var(--text-primary)',
                                }}
                              >
                                S/ {formatFixed(it.precioUnitarioConIgv, 2)}
                              </strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Hallazgos + Instrucciones de Nota de Crédito + Cálculo Corregido */}
                    {item.tieneError && (
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                        {/* Datos para Nota de Crédito */}
                        <div className="lg:col-span-7 p-3.5 rounded-xl fs-pill-rose space-y-2 text-xs">
                          <div className="font-bold flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            Hallazgo y Datos para Nota de Crédito en SUNAT SOL
                          </div>
                          {item.hallazgos.map((h, i) => (
                            <div key={i} className="text-[11px] leading-relaxed">
                              • {h.detalle}
                            </div>
                          ))}
                          {mainFinding && (
                            <div className="pt-2 border-t border-[var(--rose-border)] space-y-1.5">
                              <div className="text-[11px]">
                                <strong>Tipo NC SUNAT:</strong> {mainFinding.notaCreditoTipoLabel}
                              </div>
                              <div className="flex items-start justify-between gap-2 bg-[var(--bg-card)]/80 p-2 rounded-lg text-[11px] text-[var(--text-primary)]">
                                <span>
                                  <strong>Sustento:</strong> {mainFinding.sustentoSugerido}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => copyText(`sus_${item.id}`, mainFinding.sustentoSugerido)}
                                  className="cursor-pointer px-2 py-1 rounded fs-btn-soft text-[10px] shrink-0"
                                >
                                  {copiedKey === `sus_${item.id}` ? '✓ Copiado' : 'Copiar Sustento'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Nuevo Cálculo Corregido */}
                        <div className="lg:col-span-5 p-3.5 rounded-xl fs-pill-sage space-y-2 text-xs">
                          <div className="font-bold">Reemplazo Corregido (Nuevo Comprobante)</div>
                          {item.correccion ? (
                            <div className="space-y-1 font-mono-num text-[11px]">
                              <div>
                                Cant.: <strong>{item.correccion.cantidadTotalAfectada}</strong> × S/{' '}
                                {formatFixed(item.correccion.precioCorrectoObjetivo)} ({item.correccion.tasaUsada}%)
                              </div>
                              <div className="flex items-center justify-between gap-2 bg-[var(--bg-card)]/85 p-2 rounded-lg text-[var(--text-primary)]">
                                <span>
                                  Nuevo V.U. SUNAT:{' '}
                                  <strong style={{ color: 'var(--accent-text)' }}>
                                    {item.correccion.nuevoValorUnitarioExacto}
                                  </strong>
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    copyText(`newvu_${item.id}`, item.correccion!.nuevoValorUnitarioExacto)
                                  }
                                  className="cursor-pointer px-2 py-0.5 rounded fs-pill-accent text-[10px] font-sans font-bold"
                                >
                                  {copiedKey === `newvu_${item.id}` ? '✓' : 'Copiar V.U.'}
                                </button>
                              </div>
                              <div>
                                Base: S/ {formatFixed(item.correccion.nuevaBase)} · IGV: S/{' '}
                                {formatFixed(item.correccion.nuevoIgv)}
                              </div>
                              <div className="text-sm font-extrabold">
                                Nuevo Total: S/ {formatFixed(item.correccion.nuevoTotal)}{' '}
                                <span className="text-[11px] font-semibold">
                                  ({item.correccion.diferenciaTotal >= 0 ? '+' : ''}
                                  {formatFixed(item.correccion.diferenciaTotal)})
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px] opacity-85">
                              Ingresa el <strong>Precio Unit. Correcto</strong> arriba para calcular automáticamente el nuevo Valor Unitario y Total.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Control de Progreso por Comprobante (NC + Nueva Factura) */}
                    {item.tieneError && (
                      <div className="pt-2 border-t border-[var(--border-soft)] flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-1.5 cursor-pointer font-semibold">
                            <input
                              type="checkbox"
                              checked={prog.ncEmitida}
                              onChange={(e) => updateProgress(item.id, { ncEmitida: e.target.checked })}
                              className="accent-[var(--sage-bg)]"
                            />
                            Nota de Crédito emitida
                          </label>
                          <input
                            type="text"
                            value={prog.numeroNc}
                            onChange={(e) => updateProgress(item.id, { numeroNc: e.target.value.toUpperCase() })}
                            placeholder="N° NC (ej. E001-12)"
                            className="fs-input px-2.5 py-1 text-[11px] font-mono-num w-36"
                          />
                          <label className="flex items-center gap-1.5 cursor-pointer font-semibold">
                            <input
                              type="checkbox"
                              checked={prog.reemitida}
                              onChange={(e) => updateProgress(item.id, { reemitida: e.target.checked })}
                              className="accent-[var(--accent-bg)]"
                            />
                            Nueva factura emitida
                          </label>
                          <input
                            type="text"
                            value={prog.numeroNueva}
                            onChange={(e) => updateProgress(item.id, { numeroNueva: e.target.value.toUpperCase() })}
                            placeholder="N° Nueva (ej. E001-180)"
                            className="fs-input px-2.5 py-1 text-[11px] font-mono-num w-40"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => setExpandedTextId(expandedTextId === item.id ? null : item.id)}
                          className="cursor-pointer text-[11px] font-semibold hover:underline text-[var(--text-muted)]"
                        >
                          {expandedTextId === item.id ? 'Ocultar texto del PDF' : 'Ver texto extraído'}
                        </button>
                      </div>
                    )}

                    {expandedTextId === item.id && (
                      <pre className="fs-inset p-3 text-[10px] font-mono-num text-[var(--text-secondary)] whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {p.fullText || 'Sin texto extraíble en el PDF.'}
                      </pre>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};
