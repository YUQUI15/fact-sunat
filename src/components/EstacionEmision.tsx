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
  Sparkles,
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

  // Estado de emisión masiva API
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
      if (idx >= 0) {
        setCurrentIndex(idx);
      } else {
        setSoloPendientes(false);
      }
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
      onNotify(`PDF oficial "${file.name}" verificado y archivado en ${detectedSerie}-${detectedNum}.`, 'success');
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

  // Emisión Masiva API (Nubefact / Apisunat / Simulación)
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
      onNotify('Configura la URL y Token de tu proveedor API (Nubefact / Apisunat) en Configuración o activa el Modo Simulación.', 'error');
      return;
    }

    setApiRunning(true);
    setApiLogs([`▶ Iniciando lote de ${pendientesApi.length} comprobante(s) en modo ${apiConfig.modoSimulacion ? 'SIMULACIÓN SEGURA' : 'PRODUCCIÓN API'}...`]);

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
          `✓ [SIMULADO] Nota ${rec.notaInterna} → ${serie}-${numStr} (${rec.razonSocialCliente}) | Total S/ ${payload.total}`,
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
            setApiLogs((prev) => [
              ...prev,
              `✓ [SUNAT API] Nota ${rec.notaInterna} → ${serie}-${numStr} Aceptada.`,
            ]);
          } else {
            setApiLogs((prev) => [
              ...prev,
              `✗ [ERROR] Nota ${rec.notaInterna}: ${JSON.stringify(result.data?.errors || result.error || result)}`,
            ]);
          }
        } catch (err) {
          setApiLogs((prev) => [
            ...prev,
            `✗ [RED] Nota ${rec.notaInterna}: ${err instanceof Error ? err.message : 'Fallo de conexión'}`,
          ]);
        }
      }
    }

    onUpdateCorrelativo('01', nextF);
    onUpdateCorrelativo('03', nextB);
    setApiLogs((prev) => [...prev, '✔ Proceso por lote finalizado.']);
    setApiRunning(false);
    onNotify('Proceso de emisión por lote finalizado.', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Cabecera de modos */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            Estación de Emisión SUNAT (Cero Errores)
          </h2>
          <p className="text-sm text-slate-400">
            Emite uno por uno en Portal SUNAT SOL copiando en 1 clic sin descuadres, o dispara emisión masiva directa por API.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setModo('PORTAL_SOL')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition ${
              modo === 'PORTAL_SOL' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            Portal SUNAT SOL (Clave SOL)
          </button>
          <button
            type="button"
            onClick={() => setModo('API_MASIVA')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${
              modo === 'API_MASIVA' ? 'bg-sky-500 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            <CloudLightning className="w-4 h-4" />
            API Directa / XML UBL 2.1
          </button>
        </div>
      </div>

      {modo === 'PORTAL_SOL' ? (
        <div className="space-y-4">
          {/* Barra de navegación de la cola */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={safeIndex <= 0}
                onClick={() => setCurrentIndex(Math.max(0, safeIndex - 1))}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="text-sm">
                <span className="font-bold text-white">
                  {cola.length ? `Comprobante ${safeIndex + 1} de ${cola.length}` : 'Cola vacía'}
                </span>
                <label className="ml-4 text-xs text-slate-400 inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={soloPendientes}
                    onChange={(e) => {
                      setSoloPendientes(e.target.checked);
                      setCurrentIndex(0);
                    }}
                    className="accent-emerald-500"
                  />
                  Mostrar solo pendientes
                </label>
              </div>
              <button
                type="button"
                disabled={safeIndex >= cola.length - 1}
                onClick={() => setCurrentIndex(Math.min(cola.length - 1, safeIndex + 1))}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <a
              href="https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition"
            >
              Abrir Portal SUNAT SOL
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {!actual || !calc ? (
            <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-10 text-center space-y-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
              <h3 className="text-lg font-bold text-white">¡Todos los comprobantes de la cola están emitidos!</h3>
              <p className="text-sm text-slate-400">
                Pasa a la pestaña <strong>Organizador PDFs</strong> para ordenar tus archivos en carpetas por Año/Mes/Semana/Día y descargar tu Excel contable.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Izquierda: Campos listos para Copiar en 1 clic a SUNAT SOL */}
              <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                  <div>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300">
                      {getTipoNombreCorto(actual.tipoComprobante)} ELECTRÓNICA — Nota {actual.notaInterna}
                    </span>
                    <h3 className="text-lg font-bold text-white mt-2">{actual.razonSocialCliente}</h3>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-400">Tasa IGV</div>
                    <div className="text-lg font-extrabold text-sky-300 font-mono-num">
                      {calc.tasaIgvPorcentaje}%
                    </div>
                  </div>
                </div>

                {alertas.length > 0 && (
                  <div className="space-y-1.5">
                    {alertas.map((a, idx) => (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-xl text-xs border flex gap-2 ${
                          a.nivel === 'error'
                            ? 'bg-rose-500/10 border-rose-500/40 text-rose-200'
                            : 'bg-amber-500/10 border-amber-500/40 text-amber-200'
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

                {/* Botones de copiado paso a paso */}
                <div className="space-y-2.5">
                  {[
                    {
                      key: 'doc',
                      step: 'Paso 1',
                      label: `Documento Cliente (${actual.tipoDocCliente === '6' ? 'RUC' : actual.tipoDocCliente === '1' ? 'DNI' : 'Doc'})`,
                      value: actual.numeroDocCliente || '-',
                      highlight: false,
                    },
                    {
                      key: 'razon',
                      step: 'Paso 2',
                      label: 'Razón Social / Nombre',
                      value: actual.razonSocialCliente || 'CLIENTES VARIOS',
                      highlight: false,
                    },
                    {
                      key: 'fecha',
                      step: 'Paso 3',
                      label: 'Fecha de Emisión SUNAT (DD/MM/YYYY)',
                      value: actual.fechaEmisionSunat.split('-').reverse().join('/'),
                      highlight: false,
                    },
                  ].map((row) => (
                    <div
                      key={row.key}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                        copiedFields[row.key]
                          ? 'bg-emerald-500/10 border-emerald-500/40'
                          : 'bg-slate-950/70 border-slate-800'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] text-slate-400">
                          <span className="font-bold text-amber-400 mr-1.5">{row.step}:</span>
                          {row.label}
                        </div>
                        <div className="font-mono-num text-sm font-bold text-white truncate mt-0.5">
                          {row.value}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyField(row.key, row.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 transition ${
                          copiedFields[row.key]
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-slate-800 hover:bg-slate-700 text-white'
                        }`}
                      >
                        {copiedFields[row.key] ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedFields[row.key] ? 'Listo' : 'Copiar'}
                      </button>
                    </div>
                  ))}

                  {/* Ítems del comprobante */}
                  {calc.items.map((it, idx) => {
                    const descSunat = buildDescripcionSunat(it.descripcion, actual);
                    return (
                      <div
                        key={it.id}
                        className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 space-y-2.5"
                      >
                        <div className="text-xs font-bold text-amber-300">
                          Paso 4.{idx + 1} — Ítem #{idx + 1} (Cant: {it.cantidad} {it.unidad})
                        </div>
                        <div className="flex items-center justify-between gap-2 bg-slate-950/70 p-2.5 rounded-lg">
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-400">Descripción SUNAT</div>
                            <div className="text-xs font-medium text-white break-words">{descSunat}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyField(`desc_${idx}`, descSunat)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold shrink-0"
                          >
                            {copiedFields[`desc_${idx}`] ? '✓ Copiado' : 'Copiar Desc.'}
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-2 bg-slate-950 p-3 rounded-lg border border-amber-500/50">
                          <div>
                            <div className="text-[11px] text-amber-300 font-semibold">
                              VALOR UNITARIO EXACTO (Pegar en SUNAT SOL)
                            </div>
                            <div className="text-2xl font-extrabold font-mono-num text-amber-300">
                              {it.valorUnitarioSunatStr}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyField(`vu_${idx}`, it.valorUnitarioSunatStr)}
                            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5"
                          >
                            {copiedFields[`vu_${idx}`] ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copiedFields[`vu_${idx}`] ? 'Copiado' : 'Copiar Valor'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Derecha: Verificación Visual SUNAT + Cierre + Subida de PDF */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                    <ShieldCheck className="w-4 h-4" />
                    Paso 5: Confirma que en pantalla SUNAT diga:
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">Op. Gravada</div>
                      <div className="font-mono-num font-bold text-white text-sm mt-1">
                        {formatMoney(calc.opGravada, actual.moneda)}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[10px] text-slate-400">IGV ({calc.tasaIgvPorcentaje}%)</div>
                      <div className="font-mono-num font-bold text-sky-300 text-sm mt-1">
                        {formatMoney(calc.igvTotal, actual.moneda)}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40">
                      <div className="text-[10px] text-emerald-300 font-bold">TOTAL FINAL</div>
                      <div className="font-mono-num font-extrabold text-emerald-300 text-base mt-1">
                        {formatMoney(calc.importeTotal, actual.moneda)}
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800 space-y-3">
                    <div className="text-xs font-bold text-white">
                      Paso 6: Registra la Serie y Número emitido por SUNAT
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Serie SUNAT</label>
                        <input
                          type="text"
                          value={serieInput}
                          onChange={(e) => setSerieInput(e.target.value.toUpperCase())}
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono-num text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Correlativo N°</label>
                        <input
                          type="text"
                          value={numeroInput}
                          onChange={(e) => setNumeroInput(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono-num text-sm"
                        />
                      </div>
                    </div>

                    {/* Adjuntar PDF recién descargado de SUNAT */}
                    <label className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed border-slate-700 hover:border-amber-400 bg-slate-950/60 cursor-pointer transition text-center">
                      <FileUp className="w-5 h-5 text-amber-400 mb-1" />
                      <span className="text-xs font-semibold text-white">
                        {actual.pdfAdjunto
                          ? `✓ PDF adjunto: ${actual.pdfAdjunto.fileName}`
                          : 'Adjuntar PDF descargado de SUNAT (Opcional aquí o en lote después)'}
                      </span>
                      <span className="text-[11px] text-slate-400 mt-0.5">
                        Detecta Serie-Número automáticamente y archiva en tu carpeta
                      </span>
                      <input type="file" accept=".pdf" onChange={handleAttachPdfDirect} className="hidden" />
                    </label>

                    <button
                      type="button"
                      onClick={handleMarcarEmitido}
                      className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg transition"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                      Guardar como EMITIDO y Siguiente →
                    </button>
                  </div>
                </div>

                {/* Vista rápida XML UBL 2.1 */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
                  <button
                    type="button"
                    onClick={() => setShowXml((s) => !s)}
                    className="text-xs font-semibold text-sky-300 flex items-center gap-1.5"
                  >
                    <Code2 className="w-4 h-4" />
                    {showXml ? 'Ocultar XML UBL 2.1 SUNAT' : 'Ver XML UBL 2.1 generado para este comprobante'}
                  </button>
                  {showXml && (
                    <pre className="mt-3 p-3 rounded-xl bg-slate-950 text-[10px] text-slate-300 overflow-x-auto max-h-60 font-mono-num">
                      {generateUbl21Xml(actual, config)}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* SUB-MODO B: EMISION MASIVA API (NUBEFACT / APISUNAT / SIMULACION) */
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <CloudLightning className="w-5 h-5 text-sky-400" />
                Emisión Masiva Directa por API ({config.apiConfig.provider})
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Conecta tu token de <strong>Nubefact, Apisunat o PSE/OSE</strong> en la pestaña Configuración para emitir cientos de comprobantes en segundos.
                Actualmente:{' '}
                <strong className={config.apiConfig.modoSimulacion ? 'text-amber-300' : 'text-emerald-300'}>
                  {config.apiConfig.modoSimulacion ? 'MODO SIMULACIÓN (Pruebas sin tocar SUNAT)' : 'PRODUCCIÓN REAL'}
                </strong>
              </p>
            </div>

            <button
              type="button"
              disabled={apiRunning || !pendientesApi.length}
              onClick={handleRunBatchApi}
              className="px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold text-sm flex items-center gap-2 disabled:opacity-40 transition"
            >
              <Play className="w-4 h-4" />
              {apiRunning
                ? 'Emitiendo lote...'
                : `Emitir ${pendientesApi.length} Pendiente(s) (${config.apiConfig.modoSimulacion ? 'Simulación' : 'API Real'})`}
            </button>
          </div>

          {apiLogs.length > 0 && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono-num text-xs space-y-1 max-h-64 overflow-y-auto">
              {apiLogs.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.startsWith('✓')
                      ? 'text-emerald-300'
                      : l.startsWith('✗')
                        ? 'text-rose-400'
                        : 'text-slate-300'
                  }
                >
                  {l}
                </div>
              ))}
            </div>
          )}

          {pendientesApi[0] && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-400">
                Vista previa del Payload JSON ({config.apiConfig.provider}) del próximo pendiente ({pendientesApi[0].notaInterna}):
              </div>
              <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-sky-200 overflow-x-auto max-h-64 font-mono-num">
                {JSON.stringify(buildNubefactPayload(pendientesApi[0], config), null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
