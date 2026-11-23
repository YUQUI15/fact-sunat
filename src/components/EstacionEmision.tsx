import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CloudLightning,
  Code2,
  Copy,
  ExternalLink,
  FileUp,
  Play,
  ShieldCheck,
} from 'lucide-react';
import type { ComprobanteRecord, EmpresaEmisoraConfig } from '../types/sunat';
import { calculateComprobante, formatMoney } from '../lib/sunatMath';
import { validarComprobanteSunat } from '../lib/sunatValidators';
import { buildDescripcionSunat, buildNubefactPayload, generateUbl21Xml } from '../lib/sunatUblXml';
import { parseSunatPdfFile } from '../lib/sunatPdfParser';
import { savePdfBlob } from '../lib/storage';
import { getTipoNombreCorto } from '../lib/folderOrganizer';

interface EstacionEmisionProps {
  comprobantes: ComprobanteRecord[];
  config: EmpresaEmisoraConfig;
  initialFocusId: string | null;
  onUpdateComprobante: (rec: ComprobanteRecord) => void;
  onUpdateCorrelativo: (tipo: '01' | '03', nextNum: number) => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

export const EstacionEmision: React.FC<EstacionEmisionProps> = ({
  comprobantes,
  config,
  initialFocusId,
  onUpdateComprobante,
  onUpdateCorrelativo,
  onNotify,
}) => {
  const [modo, setModo] = useState<'PORTAL_SOL' | 'API_MASIVA'>('PORTAL_SOL');
  const [soloPendientes, setSoloPendientes] = useState<boolean>(true);
  const [copiedFields, setCopiedFields] = useState<Record<string, boolean>>({});
  const [serieInput, setSerieInput] = useState<string>('');
  const [numeroInput, setNumeroInput] = useState<string>('');
  const [showXml, setShowXml] = useState<boolean>(false);

  const [apiLogs, setApiLogs] = useState<string[]>([]);
  const [apiRunning, setApiRunning] = useState<boolean>(false);

  const cola = useMemo(() => {
    const base = comprobantes.filter((r) => r.estado !== 'ANULADO');
    const filtered = soloPendientes
      ? base.filter((r) => r.estado === 'PENDIENTE' || r.estado === 'EN_PROCESO')
      : base;
    return filtered.sort(
      (a, b) => a.fechaConsumo.localeCompare(b.fechaConsumo) || a.notaInterna.localeCompare(b.notaInterna)
    );
  }, [comprobantes, soloPendientes]);

  const [currentIndex, setCurrentIndex] = useState<number>(0);

  useEffect(() => {
    if (initialFocusId) {
      const idx = cola.findIndex((c) => c.id === initialFocusId);
      if (idx >= 0) setCurrentIndex(idx);
      else setSoloPendientes(false);
    }
  }, [initialFocusId, cola]);

  const safeIndex = Math.min(currentIndex, Math.max(0, cola.length - 1));
  const actual = cola[safeIndex] || null;

  useEffect(() => {
    if (!actual) return;
    setCopiedFields({});
    const defSerie =
      actual.serieSunat ||
      (actual.tipoComprobante === '01' ? config.serieFacturaSol : config.serieBoletaSol);
    const nextCorrel =
      actual.tipoComprobante === '01' ? config.correlativoFactura : config.correlativoBoleta;
    setSerieInput(defSerie);
    setNumeroInput(actual.numeroSunat || String(nextCorrel).padStart(6, '0'));
  }, [actual?.id, config.serieFacturaSol, config.serieBoletaSol, config.correlativoFactura, config.correlativoBoleta]);

  const calc = useMemo(() => (actual ? calculateComprobante(actual) : null), [actual]);
  const alertas = useMemo(
    () => (actual ? validarComprobanteSunat(actual, comprobantes) : []),
    [actual, comprobantes]
  );

  const copyField = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedFields((prev) => ({ ...prev, [key]: true }));
    } catch {
      onNotify('Error copiando al portapapeles.', 'error');
    }
  };

  const handleAttachPdfDirect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !actual) return;
    try {
      const parsed = await parseSunatPdfFile(file);
      const pdfId = `pdf_${actual.id}_${Date.now()}`;
      await savePdfBlob(pdfId, file, file.name);

      const detectedSerie = parsed.serie || serieInput;
      const detectedNum = parsed.numero ? parsed.numero.padStart(6, '0') : numeroInput;

      setSerieInput(detectedSerie);
      setNumeroInput(detectedNum);

      const updated: ComprobanteRecord = {
        ...actual,
        serieSunat: detectedSerie,
        numeroSunat: detectedNum,
        estado: 'ARCHIVADO',
        pdfAdjunto: {
          id: pdfId,
          fileName: file.name,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          esOficialSunat: true,
          parsedSummary: {
            serieNumero: parsed.serieNumero,
            fechaEmision: parsed.fechaEmision,
            rucCliente: parsed.docCliente,
            razonSocial: parsed.razonSocialCliente,
            total: parsed.total,
            igv: parsed.igv,
          },
        },
        actualizadoEn: new Date().toISOString(),
      };
      onUpdateComprobante(updated);
      const numInt = parseInt(detectedNum, 10);
      if (Number.isFinite(numInt) && (actual.tipoComprobante === '01' || actual.tipoComprobante === '03')) {
        onUpdateCorrelativo(actual.tipoComprobante, numInt + 1);
      }
      onNotify(`PDF "${file.name}" vinculado y archivado en ${detectedSerie}-${detectedNum}.`, 'success');
    } catch {
      onNotify('Error adjuntando el PDF.', 'error');
    }
    e.target.value = '';
  };

  const handleMarcarEmitido = () => {
    if (!actual) return;
    const cleanSerie = serieInput.trim().toUpperCase();
    const cleanNum = numeroInput.trim().padStart(6, '0');
    const updated: ComprobanteRecord = {
      ...actual,
      serieSunat: cleanSerie,
      numeroSunat: cleanNum,
      estado: actual.pdfAdjunto?.esOficialSunat ? 'ARCHIVADO' : 'EMITIDO',
      actualizadoEn: new Date().toISOString(),
    };
    onUpdateComprobante(updated);

    const parsedNum = parseInt(cleanNum, 10);
    if (Number.isFinite(parsedNum) && (actual.tipoComprobante === '01' || actual.tipoComprobante === '03')) {
      onUpdateCorrelativo(actual.tipoComprobante, parsedNum + 1);
    }
    onNotify(`Comprobante ${cleanSerie}-${cleanNum} marcado como EMITIDO.`, 'success');
    if (!soloPendientes && safeIndex < cola.length - 1) {
      setCurrentIndex(safeIndex + 1);
    }
  };

  const pendientesApi = useMemo(
    () => comprobantes.filter((c) => c.estado === 'PENDIENTE' || c.estado === 'EN_PROCESO'),
    [comprobantes]
  );

  const handleRunBatchApi = async () => {
    if (!pendientesApi.length) {
      onNotify('No hay comprobantes pendientes para emitir.', 'info');
      return;
    }
    const { apiConfig } = config;
    if (!apiConfig.modoSimulacion && (!apiConfig.endpointUrl || !apiConfig.token)) {
      onNotify('Configura la URL y Token del proveedor PSE/OSE en Configuración o usa Modo Simulación.', 'error');
      return;
    }

    setApiRunning(true);
    setApiLogs([
      `▶ Iniciando envío de ${pendientesApi.length} comprobante(s) en modo ${
        apiConfig.modoSimulacion ? 'SIMULACIÓN' : 'PRODUCCIÓN API'
      }...`,
    ]);

    let nextF = config.correlativoFactura;
    let nextB = config.correlativoBoleta;

    for (const rec of pendientesApi) {
      const esFactura = rec.tipoComprobante === '01';
      const correl = esFactura ? nextF++ : nextB++;
      const serie = esFactura
        ? apiConfig.serieFacturaApi || 'FFF1'
        : apiConfig.serieBoletaApi || 'BBB1';
      const payload = buildNubefactPayload(rec, config, correl);

      if (apiConfig.modoSimulacion) {
        await new Promise((r) => setTimeout(r, 250));
        const numStr = String(correl).padStart(6, '0');
        onUpdateComprobante({
          ...rec,
          serieSunat: serie,
          numeroSunat: numStr,
          estado: 'EMITIDO',
          apiResponse: {
            provider: `${apiConfig.provider} (SIMULACIÓN)`,
            codigoHash: `SIM-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
            aceptadaSunat: true,
            enviadoEn: new Date().toISOString(),
          },
          actualizadoEn: new Date().toISOString(),
        });
        setApiLogs((prev) => [
          ...prev,
          `✓ [SIMULADO] ${rec.notaInterna} → ${serie}-${numStr} (${rec.razonSocialCliente}) | Total S/ ${payload.total}`,
        ]);
      } else {
        try {
          const resp = await fetch('/api/emit-sunat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpointUrl: apiConfig.endpointUrl,
              token: apiConfig.token,
              authHeaderName: apiConfig.authHeaderName,
              authPrefix: apiConfig.authPrefix,
              payload,
            }),
          });
          const result = await resp.json();
          if (result.ok && result.data && !result.data.errors) {
            const numStr = String(correl).padStart(6, '0');
            onUpdateComprobante({
              ...rec,
              serieSunat: serie,
              numeroSunat: numStr,
              estado: 'EMITIDO',
              apiResponse: {
                provider: apiConfig.provider,
                enlacePdf: result.data.enlace_del_pdf,
                enlaceXml: result.data.enlace_del_xml,
                enlaceCdr: result.data.enlace_del_cdr,
                codigoHash: result.data.codigo_hash,
                aceptadaSunat: Boolean(result.data.aceptada_por_sunat ?? true),
                enviadoEn: new Date().toISOString(),
              },
              actualizadoEn: new Date().toISOString(),
            });
            setApiLogs((prev) => [...prev, `✓ [API] ${rec.notaInterna} → ${serie}-${numStr} Aceptada.`]);
          } else {
            setApiLogs((prev) => [
              ...prev,
              `✗ [ERROR] ${rec.notaInterna}: ${JSON.stringify(result.data?.errors || result.error || result)}`,
            ]);
          }
        } catch (err) {
          setApiLogs((prev) => [
            ...prev,
            `✗ [RED] ${rec.notaInterna}: ${err instanceof Error ? err.message : 'Fallo de conexión'}`,
          ]);
        }
      }
    }

    onUpdateCorrelativo('01', nextF);
    onUpdateCorrelativo('03', nextB);
    setApiLogs((prev) => [...prev, '✔ Lote finalizado.']);
    setApiRunning(false);
    onNotify('Proceso de emisión por lote finalizado.', 'success');
  };

  return (
    <div className="space-y-5">
      {/* Selector Portal SOL vs API Opcional */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-soft)] gap-1">
          <button
            type="button"
            onClick={() => setModo('PORTAL_SOL')}
            className={`cursor-pointer px-3.5 py-2 rounded-lg text-xs font-bold transition ${
              modo === 'PORTAL_SOL' ? 'fs-pill-sage' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            Portal SUNAT SEE-SOL (Directo sin API)
          </button>
          <button
            type="button"
            onClick={() => setModo('API_MASIVA')}
            className={`cursor-pointer px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              modo === 'API_MASIVA' ? 'fs-pill-sky' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <CloudLightning className="w-3.5 h-3.5" />
            API PSE/OSE (Opcional)
          </button>
        </div>

        <a
          href="https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
          target="_blank"
          rel="noreferrer"
          className="px-3.5 py-2 rounded-xl fs-pill-sky text-xs font-bold flex items-center gap-1.5"
        >
          Abrir Portal SUNAT SOL
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {modo === 'PORTAL_SOL' ? (
        <div className="space-y-4">
          {/* Navegación de Cola */}
          <div className="fs-card p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={safeIndex <= 0}
                onClick={() => setCurrentIndex(Math.max(0, safeIndex - 1))}
                className="fs-btn-soft p-2 disabled:opacity-35"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="text-xs sm:text-sm">
                <strong className="text-[var(--text-primary)]">
                  {cola.length ? `Documento ${safeIndex + 1} de ${cola.length}` : 'Sin documentos en cola'}
                </strong>
                <label className="ml-4 text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={soloPendientes}
                    onChange={(e) => {
                      setSoloPendientes(e.target.checked);
                      setCurrentIndex(0);
                    }}
                    className="accent-[var(--sage-bg)]"
                  />
                  Solo pendientes
                </label>
              </div>
              <button
                type="button"
                disabled={safeIndex >= cola.length - 1}
                onClick={() => setCurrentIndex(Math.min(cola.length - 1, safeIndex + 1))}
                className="fs-btn-soft p-2 disabled:opacity-35"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">
              Sugerencia: divida pantalla (Windows + ← / →) junto a SUNAT SOL
            </span>
          </div>

          {!actual || !calc ? (
            <div className="fs-card p-10 text-center space-y-2">
              <CheckCircle2 className="w-11 h-11 mx-auto" style={{ color: 'var(--sage-text)' }} />
              <h3 className="text-base font-bold text-[var(--text-primary)]">
                Cola de emisión completada
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Continúe al módulo <strong>05. Archivo y Carpetas</strong> para organizar sus PDFs descargados y generar reportes.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Campos para copiar en 1 clic */}
              <div className="lg:col-span-7 fs-card p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border-soft)]">
                  <div>
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg fs-pill-accent">
                      {getTipoNombreCorto(actual.tipoComprobante)} ELECTRÓNICA · Ref. {actual.notaInterna}
                    </span>
                    <h3 className="text-base font-bold text-[var(--text-primary)] mt-2">
                      {actual.razonSocialCliente}
                    </h3>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-[var(--text-muted)]">Tasa IGV</div>
                    <div className="text-lg font-extrabold font-mono-num" style={{ color: 'var(--sky-text)' }}>
                      {calc.tasaIgvPorcentaje}%
                    </div>
                  </div>
                </div>

                {alertas.length > 0 && (
                  <div className="space-y-1.5">
                    {alertas.map((a, idx) => (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl text-xs flex gap-2 ${
                          a.nivel === 'error' ? 'fs-pill-rose' : 'fs-pill-peach'
                        }`}
                      >
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <strong>{a.mensaje}</strong> {a.sugerencia}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2.5">
                  {[
                    {
                      key: 'doc',
                      step: 'Paso 1',
                      label: `Documento (${actual.tipoDocCliente === '6' ? 'RUC' : actual.tipoDocCliente === '1' ? 'DNI' : 'Doc'})`,
                      value: actual.numeroDocCliente || '-',
                    },
                    {
                      key: 'razon',
                      step: 'Paso 2',
                      label: 'Razón Social / Cliente',
                      value: actual.razonSocialCliente || 'CLIENTES VARIOS',
                    },
                    {
                      key: 'fecha',
                      step: 'Paso 3',
                      label: 'Fecha de Emisión SUNAT (DD/MM/AAAA)',
                      value: actual.fechaEmisionSunat.split('-').reverse().join('/'),
                    },
                  ].map((row) => (
                    <div
                      key={row.key}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                        copiedFields[row.key] ? 'fs-pill-sage' : 'bg-[var(--bg-inset)] border-[var(--border-soft)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] text-[var(--text-muted)]">
                          <span className="font-bold mr-1.5" style={{ color: 'var(--accent-text)' }}>
                            {row.step}:
                          </span>
                          {row.label}
                        </div>
                        <div className="font-mono-num text-sm font-bold text-[var(--text-primary)] truncate mt-0.5">
                          {row.value}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyField(row.key, row.value)}
                        className={`px-3 py-1.5 text-xs flex items-center gap-1 shrink-0 ${
                          copiedFields[row.key] ? 'fs-btn-sage' : 'fs-btn-soft'
                        }`}
                      >
                        {copiedFields[row.key] ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedFields[row.key] ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                  ))}

                  {calc.items.map((it, idx) => {
                    const descSunat = buildDescripcionSunat(it.descripcion, actual);
                    return (
                      <div key={it.id} className="p-3.5 rounded-xl fs-pill-accent space-y-2.5">
                        <div className="text-xs font-extrabold">
                          Paso 4.{idx + 1} — Ítem #{idx + 1} (Cant: {it.cantidad} {it.unidad})
                        </div>
                        <div className="fs-inset p-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[10px] text-[var(--text-muted)]">Descripción SUNAT</div>
                            <div className="text-xs font-medium text-[var(--text-primary)] break-words">
                              {descSunat}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyField(`desc_${idx}`, descSunat)}
                            className="fs-btn-soft px-2.5 py-1.5 text-xs shrink-0"
                          >
                            {copiedFields[`desc_${idx}`] ? '✓ Copiada' : 'Copiar'}
                          </button>
                        </div>

                        <div className="bg-[var(--bg-card)] border border-[var(--accent-border)] p-3 rounded-xl flex items-center justify-between gap-2">
                          <div>
                            <div className="text-[11px] font-bold" style={{ color: 'var(--accent-text)' }}>
                              VALOR UNITARIO EXACTO (sin IGV)
                            </div>
                            <div className="text-2xl font-extrabold font-mono-num text-[var(--text-primary)]">
                              {it.valorUnitarioSunatStr}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyField(`vu_${idx}`, it.valorUnitarioSunatStr)}
                            className="fs-btn-primary px-4 py-2 text-xs flex items-center gap-1.5"
                          >
                            {copiedFields[`vu_${idx}`] ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedFields[`vu_${idx}`] ? 'Copiado' : 'Copiar Valor'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Verificación Visual y Cierre */}
              <div className="lg:col-span-5 space-y-4">
                <div className="fs-card p-5 space-y-4">
                  <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider" style={{ color: 'var(--sage-text)' }}>
                    <ShieldCheck className="w-4 h-4" />
                    Paso 5: Verificación en Preliminar SUNAT
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="fs-inset p-3">
                      <div className="text-[10px] text-[var(--text-muted)]">Op. Gravada</div>
                      <div className="font-mono-num font-bold text-[var(--text-primary)] text-xs sm:text-sm mt-1">
                        {formatMoney(calc.opGravada, actual.moneda)}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl fs-pill-sky">
                      <div className="text-[10px] font-semibold">IGV ({calc.tasaIgvPorcentaje}%)</div>
                      <div className="font-mono-num font-bold text-xs sm:text-sm mt-1">
                        {formatMoney(calc.igvTotal, actual.moneda)}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl fs-pill-sage">
                      <div className="text-[10px] font-bold">TOTAL</div>
                      <div className="font-mono-num font-extrabold text-sm mt-1">
                        {formatMoney(calc.importeTotal, actual.moneda)}
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[var(--border-soft)] space-y-3">
                    <div className="text-xs font-bold text-[var(--text-primary)]">
                      Paso 6: Registrar Serie-Número y PDF Emitido
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-[var(--text-muted)] block mb-1">Serie SUNAT</label>
                        <input
                          type="text"
                          value={serieInput}
                          onChange={(e) => setSerieInput(e.target.value.toUpperCase())}
                          className="fs-input w-full px-3 py-2 font-mono-num text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-[var(--text-muted)] block mb-1">Correlativo</label>
                        <input
                          type="text"
                          value={numeroInput}
                          onChange={(e) => setNumeroInput(e.target.value)}
                          className="fs-input w-full px-3 py-2 font-mono-num text-sm"
                        />
                      </div>
                    </div>

                    <label className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-[var(--border-strong)] hover:border-[var(--accent-bg)] bg-[var(--bg-inset)] cursor-pointer transition text-center">
                      <FileUp className="w-5 h-5 mb-1" style={{ color: 'var(--accent-text)' }} />
                      <span className="text-xs font-bold text-[var(--text-primary)]">
                        {actual.pdfAdjunto
                          ? `✓ PDF adjunto: ${actual.pdfAdjunto.fileName}`
                          : 'Adjuntar PDF SUNAT (o cargar en lote en Archivo y Carpetas)'}
                      </span>
                      <input type="file" accept=".pdf" onChange={handleAttachPdfDirect} className="hidden" />
                    </label>

                    <button
                      type="button"
                      onClick={handleMarcarEmitido}
                      className="fs-btn-sage w-full py-3.5 text-sm flex items-center justify-center gap-2 shadow-sm"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Confirmar Emitido y Siguiente →
                    </button>
                  </div>
                </div>

                <div className="fs-card p-4">
                  <button
                    type="button"
                    onClick={() => setShowXml((s) => !s)}
                    className="cursor-pointer text-xs font-bold flex items-center gap-1.5"
                    style={{ color: 'var(--sky-text)' }}
                  >
                    <Code2 className="w-4 h-4" />
                    {showXml ? 'Ocultar XML UBL 2.1' : 'Ver XML UBL 2.1 SUNAT'}
                  </button>
                  {showXml && (
                    <pre className="mt-3 p-3 rounded-xl fs-inset text-[10px] text-[var(--text-secondary)] overflow-x-auto max-h-56 font-mono-num">
                      {generateUbl21Xml(actual, config)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="fs-card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <CloudLightning className="w-5 h-5" style={{ color: 'var(--sky-text)' }} />
                Emisión Masiva por API PSE/OSE ({config.apiConfig.provider})
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Opcional para empresas con proveedor externo contratado. Estado actual:{' '}
                <strong style={{ color: config.apiConfig.modoSimulacion ? 'var(--peach-text)' : 'var(--sage-text)' }}>
                  {config.apiConfig.modoSimulacion ? 'MODO SIMULACIÓN' : 'PRODUCCIÓN API'}
                </strong>
              </p>
            </div>

            <button
              type="button"
              disabled={apiRunning || !pendientesApi.length}
              onClick={handleRunBatchApi}
              className="fs-btn-primary px-5 py-2.5 text-xs flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              {apiRunning ? 'Procesando...' : `Enviar ${pendientesApi.length} Pendiente(s)`}
            </button>
          </div>

          {apiLogs.length > 0 && (
            <div className="fs-inset p-4 font-mono-num text-xs space-y-1 max-h-60 overflow-y-auto">
              {apiLogs.map((l, i) => (
                <div
                  key={i}
                  style={{
                    color: l.startsWith('✓')
                      ? 'var(--sage-text)'
                      : l.startsWith('✗')
                        ? 'var(--rose-text)'
                        : 'var(--text-secondary)',
                  }}
                >
                  {l}
                </div>
              ))}
            </div>
          )}

          {pendientesApi[0] && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[var(--text-muted)]">
                Payload JSON del próximo comprobante ({pendientesApi[0].notaInterna}):
              </div>
              <pre className="fs-inset p-4 text-[11px] text-[var(--text-secondary)] overflow-x-auto max-h-60 font-mono-num">
                {JSON.stringify(buildNubefactPayload(pendientesApi[0], config), null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
