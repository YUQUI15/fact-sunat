import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  FileSpreadsheet,
  Info,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Zap,
} from 'lucide-react';
import type {
  AfectacionIGV,
  ClienteFrecuente,
  ComprobanteItem,
  ComprobanteRecord,
  EmpresaEmisoraConfig,
  FormaPago,
  ModoCalculoIGV,
  Moneda,
  TipoComprobante,
  TipoDocIdentidad,
} from '../types/sunat';
import {
  calculateComprobante,
  formatFixed,
  formatMoney,
  TASAS_IGV_PRESETS,
} from '../lib/sunatMath';
import {
  getHoyPeruISO,
  validarComprobanteSunat,
  validarDniPeru,
  validarRucPeru,
} from '../lib/sunatValidators';
import { bulkRowToComprobante, parseBulkLines } from '../lib/bulkParser';
import { buildDescripcionSunat } from '../lib/sunatUblXml';
import { readSpreadsheetToLines } from '../lib/exporters';

interface CapturaRapidaProps {
  config: EmpresaEmisoraConfig;
  comprobantes: ComprobanteRecord[];
  clientes: ClienteFrecuente[];
  editingRecord: ComprobanteRecord | null;
  onCancelEdit: () => void;
  onSaveComprobante: (rec: ComprobanteRecord, isEdit: boolean) => void;
  onImportBulk: (recs: ComprobanteRecord[]) => void;
  onSaveCliente: (cli: ClienteFrecuente) => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

function getNextNotaInterna(records: ComprobanteRecord[]): string {
  let maxNum = 0;
  for (const r of records) {
    const m = r.notaInterna.match(/(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return `N-${String(maxNum + 1).padStart(3, '0')}`;
}

export const CapturaRapida: React.FC<CapturaRapidaProps> = ({
  config,
  comprobantes,
  clientes,
  editingRecord,
  onCancelEdit,
  onSaveComprobante,
  onImportBulk,
  onSaveCliente,
  onNotify,
}) => {
  const [subMode, setSubMode] = useState<'INDIVIDUAL' | 'MASIVO'>('INDIVIDUAL');
  const hoy = useMemo(() => getHoyPeruISO(), []);

  // Estado del formulario individual
  const [tipoComprobante, setTipoComprobante] = useState<TipoComprobante>('03');
  const [notaInterna, setNotaInterna] = useState<string>(() => getNextNotaInterna(comprobantes));
  const [fechaConsumo, setFechaConsumo] = useState<string>(hoy);
  const [fechaEmisionSunat, setFechaEmisionSunat] = useState<string>(hoy);
  const [tipoDocCliente, setTipoDocCliente] = useState<TipoDocIdentidad>('0');
  const [numeroDocCliente, setNumeroDocCliente] = useState<string>('-');
  const [razonSocialCliente, setRazonSocialCliente] = useState<string>('CLIENTES VARIOS');
  const [direccionCliente, setDireccionCliente] = useState<string>('');
  const [emailCliente, setEmailCliente] = useState<string>('');
  const [moneda, setMoneda] = useState<Moneda>('PEN');
  const [tipoCambio, setTipoCambio] = useState<number>(3.75);
  const [modoCalculo, setModoCalculo] = useState<ModoCalculoIGV>(config.modoCalculoDefecto);
  const [tasaIgv, setTasaIgv] = useState<number>(config.tasaIgvDefecto);
  const [customTasa, setCustomTasa] = useState<string>('');
  const [recargoConsumoPct, setRecargoConsumoPct] = useState<number>(config.recargoConsumoDefecto);
  const [descuentoGlobal, setDescuentoGlobal] = useState<number>(0);
  const [formaPago, setFormaPago] = useState<FormaPago>('CONTADO');
  const [incluirRefFechaEnDesc, setIncluirRefFechaEnDesc] = useState<boolean>(config.incluirRefFechaDefecto);
  const [observaciones, setObservaciones] = useState<string>('');
  const [showAvanzado, setShowAvanzado] = useState<boolean>(false);
  const [items, setItems] = useState<ComprobanteItem[]>([
    {
      id: crypto.randomUUID(),
      unidad: 'ZZ',
      descripcion: config.conceptosRapidos[0] || 'Consumo de Alimentos y Bebidas - Peña Show',
      cantidad: 1,
      montoIngresado: 0,
      esTotalLinea: true,
      afectacion: config.tasaIgvDefecto > 0 ? '10' : '20',
    },
  ]);

  const [lookupLoading, setLookupLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState<string>('');

  const montoInputRef = useRef<HTMLInputElement | null>(null);

  // Cargar registro en edición si el usuario hizo clic en "Editar" desde la Bandeja
  useEffect(() => {
    if (!editingRecord) return;
    setSubMode('INDIVIDUAL');
    setTipoComprobante(editingRecord.tipoComprobante);
    setNotaInterna(editingRecord.notaInterna);
    setFechaConsumo(editingRecord.fechaConsumo);
    setFechaEmisionSunat(editingRecord.fechaEmisionSunat);
    setTipoDocCliente(editingRecord.tipoDocCliente);
    setNumeroDocCliente(editingRecord.numeroDocCliente);
    setRazonSocialCliente(editingRecord.razonSocialCliente);
    setDireccionCliente(editingRecord.direccionCliente);
    setEmailCliente(editingRecord.emailCliente);
    setMoneda(editingRecord.moneda);
    setTipoCambio(editingRecord.tipoCambio);
    setModoCalculo(editingRecord.modoCalculo);
    setTasaIgv(editingRecord.tasaIgv);
    setRecargoConsumoPct(editingRecord.recargoConsumoPct);
    setDescuentoGlobal(editingRecord.descuentoGlobal);
    setFormaPago(editingRecord.formaPago);
    setIncluirRefFechaEnDesc(editingRecord.incluirRefFechaEnDesc);
    setObservaciones(editingRecord.observaciones);
    setItems(editingRecord.items.map((i) => ({ ...i })));
    if (editingRecord.recargoConsumoPct > 0 || editingRecord.descuentoGlobal > 0 || editingRecord.moneda === 'USD') {
      setShowAvanzado(true);
    }
  }, [editingRecord]);

  // Borrador en vivo para cálculos y alertas instantáneas
  const draftRecord: ComprobanteRecord = useMemo(
    () => ({
      id: editingRecord?.id || 'draft',
      notaInterna,
      notasConsolidadas: editingRecord?.notasConsolidadas,
      tipoComprobante,
      fechaConsumo,
      fechaEmisionSunat,
      serieSunat:
        editingRecord?.serieSunat ||
        (tipoComprobante === '01' ? config.serieFacturaSol : config.serieBoletaSol),
      numeroSunat: editingRecord?.numeroSunat || '',
      tipoDocCliente,
      numeroDocCliente,
      razonSocialCliente,
      direccionCliente,
      emailCliente,
      moneda,
      tipoCambio,
      modoCalculo,
      tasaIgv,
      recargoConsumoPct,
      descuentoGlobal,
      formaPago,
      incluirRefFechaEnDesc,
      observaciones,
      items,
      estado: editingRecord?.estado || 'PENDIENTE',
      pdfAdjunto: editingRecord?.pdfAdjunto,
      apiResponse: editingRecord?.apiResponse,
      creadoEn: editingRecord?.creadoEn || new Date().toISOString(),
      actualizadoEn: new Date().toISOString(),
    }),
    [
      editingRecord,
      notaInterna,
      tipoComprobante,
      fechaConsumo,
      fechaEmisionSunat,
      config.serieFacturaSol,
      config.serieBoletaSol,
      tipoDocCliente,
      numeroDocCliente,
      razonSocialCliente,
      direccionCliente,
      emailCliente,
      moneda,
      tipoCambio,
      modoCalculo,
      tasaIgv,
      recargoConsumoPct,
      descuentoGlobal,
      formaPago,
      incluirRefFechaEnDesc,
      observaciones,
      items,
    ]
  );

  const calculo = useMemo(() => calculateComprobante(draftRecord), [draftRecord]);
  const alertas = useMemo(
    () => validarComprobanteSunat(draftRecord, comprobantes, hoy),
    [draftRecord, comprobantes, hoy]
  );

  const hasHardErrors = alertas.some((a) => a.nivel === 'error');

  const handleTipoChange = (nuevoTipo: TipoComprobante) => {
    setTipoComprobante(nuevoTipo);
    if (nuevoTipo === '01') {
      setTipoDocCliente('6');
      if (numeroDocCliente === '-') setNumeroDocCliente('');
      if (razonSocialCliente === 'CLIENTES VARIOS') setRazonSocialCliente('');
    } else if (nuevoTipo === '03' && tipoDocCliente === '6' && !numeroDocCliente.trim()) {
      setTipoDocCliente('0');
      setNumeroDocCliente('-');
      setRazonSocialCliente('CLIENTES VARIOS');
    }
  };

  const handleConsultarDoc = async () => {
    const clean = numeroDocCliente.replace(/\D/g, '');
    if (tipoDocCliente === '6') {
      const v = validarRucPeru(clean);
      if (!v.valido) {
        onNotify(v.motivo || 'RUC inválido', 'error');
        return;
      }
    } else if (tipoDocCliente === '1') {
      const v = validarDniPeru(clean);
      if (!v.valido) {
        onNotify(v.motivo || 'DNI inválido', 'error');
        return;
      }
    } else {
      onNotify('La consulta SUNAT/RENIEC aplica para RUC (11 dígitos) o DNI (8 dígitos).', 'info');
      return;
    }

    // 1. Buscar primero en Agenda local de Clientes Frecuentes
    const localMatch = clientes.find((c) => c.numeroDoc === clean);
    if (localMatch) {
      setRazonSocialCliente(localMatch.razonSocial);
      setDireccionCliente(localMatch.direccion || '');
      setEmailCliente(localMatch.email || '');
      onNotify(`Cliente cargado desde tu Agenda local: ${localMatch.razonSocial}`, 'success');
      return;
    }

    // 2. Consultar endpoint serverless /api/consulta-doc
    setLookupLoading(true);
    try {
      const tipoParam = tipoDocCliente === '6' ? 'ruc' : 'dni';
      const headers: Record<string, string> = {};
      if (config.tokenConsultaDoc) headers['x-api-token'] = config.tokenConsultaDoc;
      const resp = await fetch(`/api/consulta-doc?tipo=${tipoParam}&numero=${clean}`, { headers });
      const data = await resp.json();
      if (data.ok && data.razonSocial) {
        setRazonSocialCliente(data.razonSocial);
        if (data.direccion) setDireccionCliente(data.direccion);
        onNotify(`Encontrado (${data.source}): ${data.razonSocial}`, 'success');
      } else {
        onNotify(data.error || 'No se pudo consultar en línea. Escribe el nombre manualmente.', 'error');
      }
    } catch {
      onNotify(
        'Consulta en línea no disponible en modo local sin API. El RUC/DNI ya fue validado matemáticamente; escribe la razón social manualmente.',
        'info'
      );
    } finally {
      setLookupLoading(false);
    }
  };

  const handleApplyClienteFrecuente = (cli: ClienteFrecuente) => {
    setTipoDocCliente(cli.tipoDoc);
    setNumeroDocCliente(cli.numeroDoc);
    setRazonSocialCliente(cli.razonSocial);
    setDireccionCliente(cli.direccion || '');
    setEmailCliente(cli.email || '');
    if (cli.tipoDoc === '6') setTipoComprobante('01');
  };

  const handleSaveCurrentClientToAgenda = () => {
    if (!razonSocialCliente.trim() || razonSocialCliente.trim().toUpperCase() === 'CLIENTES VARIOS') {
      onNotify('Ingresa un nombre o razón social válido para guardar en la agenda.', 'error');
      return;
    }
    const existing = clientes.find((c) => c.numeroDoc === numeroDocCliente.trim() && numeroDocCliente.trim() !== '-');
    if (existing) {
      onNotify('Este cliente ya está guardado en tu agenda.', 'info');
      return;
    }
    onSaveCliente({
      id: crypto.randomUUID(),
      tipoDoc: tipoDocCliente,
      numeroDoc: numeroDocCliente.trim() || '-',
      razonSocial: razonSocialCliente.trim(),
      direccion: direccionCliente.trim(),
      email: emailCliente.trim(),
      creadoEn: new Date().toISOString(),
    });
    onNotify(`Cliente "${razonSocialCliente.trim()}" guardado en tu agenda frecuente.`, 'success');
  };

  const updateItem = (id: string, patch: Partial<ComprobanteItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        unidad: 'ZZ',
        descripcion: config.conceptosRapidos[0] || 'Consumo Peña Show',
        cantidad: 1,
        montoIngresado: 0,
        esTotalLinea: true,
        afectacion: tasaIgv > 0 ? '10' : '20',
      },
    ]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));
  };

  const resetForNextSlip = (savedRecordsCount: number) => {
    // Mantiene fechaConsumo, fechaEmisionSunat, tasaIgv y modoCalculo para volar ingresando un bloque del mismo día
    const simulatedList = [
      ...comprobantes,
      { notaInterna } as ComprobanteRecord,
    ];
    setNotaInterna(getNextNotaInterna(simulatedList));
    if (tipoComprobante === '03') {
      setTipoDocCliente('0');
      setNumeroDocCliente('-');
      setRazonSocialCliente('CLIENTES VARIOS');
      setDireccionCliente('');
      setEmailCliente('');
    }
    setObservaciones('');
    setDescuentoGlobal(0);
    setItems([
      {
        id: crypto.randomUUID(),
        unidad: 'ZZ',
        descripcion: items[0]?.descripcion || config.conceptosRapidos[0] || 'Consumo Peña Show',
        cantidad: 1,
        montoIngresado: 0,
        esTotalLinea: true,
        afectacion: tasaIgv > 0 ? '10' : '20',
      },
    ]);
    if (savedRecordsCount >= 0) {
      setTimeout(() => {
        montoInputRef.current?.focus();
        montoInputRef.current?.select();
      }, 40);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (calculo.importeTotal <= 0) {
      onNotify('Ingresa un monto mayor a S/ 0.00 antes de guardar.', 'error');
      return;
    }

    const recordToSave: ComprobanteRecord = {
      ...draftRecord,
      id: editingRecord ? editingRecord.id : crypto.randomUUID(),
      razonSocialCliente: razonSocialCliente.trim() || 'CLIENTES VARIOS',
      numeroDocCliente: numeroDocCliente.trim() || '-',
      actualizadoEn: new Date().toISOString(),
    };

    onSaveComprobante(recordToSave, Boolean(editingRecord));
    if (editingRecord) {
      onCancelEdit();
      onNotify(`Comprobante ${recordToSave.notaInterna} actualizado correctamente.`, 'success');
    } else {
      onNotify(
        `Nota ${recordToSave.notaInterna} (${formatMoney(calculo.importeTotal, moneda)}) agregada a la cola SUNAT.`,
        'success'
      );
      resetForNextSlip(comprobantes.length + 1);
    }
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      onNotify('No se pudo copiar al portapapeles.', 'error');
    }
  };

  // Importación masiva
  const bulkParsed = useMemo(() => parseBulkLines(bulkText, config), [bulkText, config]);
  const validBulkRows = useMemo(() => bulkParsed.filter((r) => !r.error), [bulkParsed]);

  const handleUploadSpreadsheet = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readSpreadsheetToLines(file);
      setBulkText(text);
      onNotify(`Archivo "${file.name}" leído. Revisa la vista previa e importa.`, 'success');
    } catch {
      onNotify('Error leyendo el archivo Excel/CSV. Verifica el formato.', 'error');
    }
    e.target.value = '';
  };

  const handleConfirmBulkImport = () => {
    if (!validBulkRows.length) {
      onNotify('No hay filas válidas para importar.', 'error');
      return;
    }
    const nuevos = validBulkRows.map((row) => bulkRowToComprobante(row, config));
    onImportBulk(nuevos);
    setBulkText('');
    onNotify(`Se importaron ${nuevos.length} comprobantes calculados listos para SUNAT.`, 'success');
  };

  const rucCheck = tipoDocCliente === '6' && numeroDocCliente.trim() ? validarRucPeru(numeroDocCliente) : null;
  const dniCheck = tipoDocCliente === '1' && numeroDocCliente.trim() ? validarDniPeru(numeroDocCliente) : null;

  return (
    <div className="space-y-6">
      {/* Selector superior Individual vs Pegado Masivo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            {editingRecord ? `Editando Nota ${editingRecord.notaInterna}` : 'Captura Relámpago de Boletas Escritas'}
          </h2>
          <p className="text-sm text-slate-400">
            Ingresa las notas físicas sin calculadora: el sistema calcula el Valor Unitario exacto SUNAT al céntimo y valida todas las reglas tributarias.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setSubMode('INDIVIDUAL')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${
              subMode === 'INDIVIDUAL'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Calculator className="w-4 h-4" />
            Ingreso Rápido (1 a 1)
          </button>
          <button
            type="button"
            onClick={() => setSubMode('MASIVO')}
            className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${
              subMode === 'MASIVO'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <ClipboardPaste className="w-4 h-4" />
            Carga Masiva / Excel
          </button>
        </div>
      </div>

      {subMode === 'INDIVIDUAL' ? (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* COLUMNA IZQUIERDA: FORMULARIO RAPIDO */}
          <div className="xl:col-span-7 space-y-5">
            {/* Tarjeta 1: Tipo, Fechas y Nota */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  1. Tipo de Comprobante y Fechas
                </span>
                {editingRecord && (
                  <button
                    type="button"
                    onClick={onCancelEdit}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                  >
                    Cancelar edición
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: '03', label: 'Boleta de Venta', sub: 'Turistas / DNI / Varios' },
                    { id: '01', label: 'Factura (RUC)', sub: 'Agencias / Empresas' },
                    { id: '07', label: 'Nota de Crédito', sub: 'Anulación / Ajuste' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleTipoChange(opt.id)}
                    className={`p-3 rounded-xl border text-left transition ${
                      tipoComprobante === opt.id
                        ? 'bg-amber-500/15 border-amber-400 text-white ring-1 ring-amber-400/50'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-bold text-sm">{opt.label}</div>
                    <div className="text-[11px] opacity-80">{opt.sub}</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    N° Nota Escrita (Papel)
                  </label>
                  <input
                    type="text"
                    value={notaInterna}
                    onChange={(e) => setNotaInterna(e.target.value)}
                    placeholder="Ej. N-001"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm font-mono-num focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-amber-300 mb-1">
                    Fecha de Consumo / Nota
                  </label>
                  <input
                    type="date"
                    value={fechaConsumo}
                    onChange={(e) => setFechaConsumo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-emerald-300">
                      Fecha Emisión SUNAT
                    </label>
                    <button
                      type="button"
                      onClick={() => setFechaEmisionSunat(hoy)}
                      className="text-[11px] text-emerald-400 hover:underline"
                    >
                      Poner hoy
                    </button>
                  </div>
                  <input
                    type="date"
                    value={fechaEmisionSunat}
                    onChange={(e) => setFechaEmisionSunat(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Tarjeta 2: Cliente / Agencia / Turista */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  2. Datos del Cliente / Agencia / Turista
                </span>
                {clientes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {clientes.slice(0, 4).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleApplyClienteFrecuente(c)}
                        className="text-[11px] px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-amber-200 border border-slate-700 transition"
                        title={`${c.numeroDoc} — ${c.razonSocial}`}
                      >
                        ★ {c.alias || c.razonSocial.slice(0, 18)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-4">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Tipo Documento
                  </label>
                  <select
                    value={tipoDocCliente}
                    onChange={(e) => {
                      const val = e.target.value as TipoDocIdentidad;
                      setTipoDocCliente(val);
                      if (val === '0') {
                        setNumeroDocCliente('-');
                        setRazonSocialCliente('CLIENTES VARIOS');
                      } else if (numeroDocCliente === '-') {
                        setNumeroDocCliente('');
                        if (razonSocialCliente === 'CLIENTES VARIOS') setRazonSocialCliente('');
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:border-amber-400 focus:outline-none"
                  >
                    <option value="0">Sin Doc. (Clientes Varios)</option>
                    <option value="6">RUC (11 dígitos)</option>
                    <option value="1">DNI (8 dígitos)</option>
                    <option value="7">Pasaporte (Turista Ext.)</option>
                    <option value="4">Carnet de Extranjería</option>
                  </select>
                </div>

                <div className="sm:col-span-5">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Número de RUC / DNI / Pasaporte
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={numeroDocCliente}
                      onChange={(e) => setNumeroDocCliente(e.target.value)}
                      placeholder={tipoDocCliente === '6' ? '20XXXXXXXXX' : tipoDocCliente === '1' ? '8 dígitos' : '-'}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm font-mono-num focus:border-amber-400 focus:outline-none"
                    />
                    {(tipoDocCliente === '6' || tipoDocCliente === '1') && (
                      <button
                        type="button"
                        onClick={handleConsultarDoc}
                        disabled={lookupLoading}
                        className="px-3 py-2 rounded-xl bg-sky-500/20 border border-sky-500/40 text-sky-300 hover:bg-sky-500/30 text-xs font-semibold flex items-center gap-1 shrink-0 disabled:opacity-50"
                        title="Consultar razón social en Agenda o SUNAT/RENIEC"
                      >
                        <Search className="w-3.5 h-3.5" />
                        {lookupLoading ? '...' : 'Buscar'}
                      </button>
                    )}
                  </div>
                  {rucCheck && (
                    <p
                      className={`text-[11px] mt-1 ${
                        rucCheck.valido ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {rucCheck.valido ? `✓ RUC válido (${rucCheck.tipo})` : `✗ ${rucCheck.motivo}`}
                    </p>
                  )}
                  {dniCheck && (
                    <p
                      className={`text-[11px] mt-1 ${
                        dniCheck.valido ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {dniCheck.valido ? '✓ Formato DNI válido' : `✗ ${dniCheck.motivo}`}
                    </p>
                  )}
                </div>

                <div className="sm:col-span-3 flex items-end">
                  <button
                    type="button"
                    onClick={handleSaveCurrentClientToAgenda}
                    className="w-full py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 border border-slate-700"
                    title="Guardar este cliente en tu Agenda Frecuente"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-amber-400" />
                    Guardar Cliente
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Razón Social / Nombre del Cliente
                  </label>
                  <input
                    type="text"
                    value={razonSocialCliente}
                    onChange={(e) => setRazonSocialCliente(e.target.value)}
                    placeholder="Ej. INCA TOURS S.A.C. o CLIENTES VARIOS"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Dirección (Opcional)
                  </label>
                  <input
                    type="text"
                    value={direccionCliente}
                    onChange={(e) => setDireccionCliente(e.target.value)}
                    placeholder="Av. / Calle / Distrito"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Tarjeta 3: Modo IGV, Tasa e Ítems / Montos */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block">
                3. Cálculo de IGV y Detalle del Consumo
              </span>

              {/* Selector de Modo IGV */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setModoCalculo('INCLUYE_IGV')}
                  className={`p-3 rounded-xl border text-left transition ${
                    modoCalculo === 'INCLUYE_IGV'
                      ? 'bg-emerald-500/15 border-emerald-400 text-white'
                      : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">Mantener Total (Desglosar IGV)</span>
                    {modoCalculo === 'INCLUYE_IGV' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                        PEÑA SHOW
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] opacity-80 mt-0.5">
                    Ej: Nota S/ 250 → Emitir por <strong>S/ 250.00 exactos</strong> sacando Base + IGV adentro.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setModoCalculo('MAS_IGV')}
                  className={`p-3 rounded-xl border text-left transition ${
                    modoCalculo === 'MAS_IGV'
                      ? 'bg-sky-500/15 border-sky-400 text-white'
                      : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="font-bold text-sm">Monto Neto (+ Sumar IGV)</div>
                  <p className="text-[11px] opacity-80 mt-0.5">
                    Ej: Nota S/ 250 neto → Se le agrega IGV encima (Total S/ 295.00 al 18%).
                  </p>
                </button>
              </div>

              {/* Selector de Tasa IGV */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 font-medium mr-1">Tasa IGV:</span>
                {TASAS_IGV_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setTasaIgv(preset.value);
                      setCustomTasa('');
                      setItems((prev) =>
                        prev.map((it) => ({
                          ...it,
                          afectacion: preset.value === 0 ? '20' : '10',
                        }))
                      );
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                      tasaIgv === preset.value && !customTasa
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-500'
                    }`}
                    title={preset.label}
                  >
                    {preset.value}% <span className="font-normal opacity-75">({preset.badge})</span>
                  </button>
                ))}
                <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">
                  <span className="text-[11px] text-slate-400">Otra %:</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="50"
                    value={customTasa}
                    onChange={(e) => {
                      setCustomTasa(e.target.value);
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v) && v >= 0) setTasaIgv(v);
                    }}
                    placeholder="ej. 12"
                    className="w-14 bg-transparent text-white text-xs font-mono-num focus:outline-none"
                  />
                </div>
              </div>

              {/* Chips de conceptos rápidos Peña Show */}
              <div className="flex flex-wrap gap-1.5">
                {config.conceptosRapidos.map((concepto) => (
                  <button
                    key={concepto}
                    type="button"
                    onClick={() => updateItem(items[0].id, { descripcion: concepto })}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-amber-500/20 hover:text-amber-200 text-slate-300 border border-slate-700/80 transition"
                  >
                    + {concepto}
                  </button>
                ))}
              </div>

              {/* Lista de ítems */}
              <div className="space-y-2.5">
                {items.map((item, idx) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5"
                  >
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-12 sm:col-span-6">
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Descripción del Servicio / Consumo {items.length > 1 ? `#${idx + 1}` : ''}
                        </label>
                        <input
                          type="text"
                          value={item.descripcion}
                          onChange={(e) => updateItem(item.id, { descripcion: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-amber-400 focus:outline-none"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <label className="block text-[11px] text-slate-400 mb-1">Cant.</label>
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          value={item.cantidad}
                          onChange={(e) =>
                            updateItem(item.id, { cantidad: Math.max(0.01, parseFloat(e.target.value) || 1) })
                          }
                          className="w-full px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm font-mono-num text-center focus:border-amber-400 focus:outline-none"
                        />
                      </div>
                      <div className="col-span-6 sm:col-span-3">
                        <label className="block text-[11px] text-amber-300 font-semibold mb-1">
                          {modoCalculo === 'INCLUYE_IGV'
                            ? item.esTotalLinea
                              ? `Total Línea (${moneda})`
                              : `P. Unit c/IGV (${moneda})`
                            : item.esTotalLinea
                              ? `Subtotal Neto (${moneda})`
                              : `Val. Unit Neto (${moneda})`}
                        </label>
                        <input
                          ref={idx === 0 ? montoInputRef : undefined}
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.montoIngresado || ''}
                          onChange={(e) =>
                            updateItem(item.id, { montoIngresado: parseFloat(e.target.value) || 0 })
                          }
                          placeholder="0.00"
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border-2 border-amber-500/60 text-amber-200 text-base font-bold font-mono-num text-right focus:border-amber-400 focus:outline-none"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1 flex justify-end">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/15"
                            title="Quitar ítem"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.esTotalLinea}
                          onChange={(e) => updateItem(item.id, { esTotalLinea: e.target.checked })}
                          className="accent-amber-500"
                        />
                        El monto es el total de toda la línea
                      </label>
                      <select
                        value={item.afectacion}
                        onChange={(e) => updateItem(item.id, { afectacion: e.target.value as AfectacionIGV })}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-200"
                      >
                        <option value="10">10 - Gravado IGV</option>
                        <option value="20">20 - Exonerado</option>
                        <option value="30">30 - Inafecto</option>
                      </select>
                      <select
                        value={item.unidad}
                        onChange={(e) => updateItem(item.id, { unidad: e.target.value })}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-200"
                      >
                        <option value="ZZ">ZZ - Servicio</option>
                        <option value="NIU">NIU - Unidad / Plato</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={addItem}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center gap-1.5 border border-slate-700"
                >
                  <Plus className="w-3.5 h-3.5 text-amber-400" />
                  Agregar otro ítem / plato / bebida
                </button>

                <button
                  type="button"
                  onClick={() => setShowAvanzado((s) => !s)}
                  className="text-xs text-slate-400 hover:text-amber-300 underline"
                >
                  {showAvanzado ? 'Ocultar opciones avanzadas' : '+ Opciones avanzadas (Recargo 10%, Descuento, USD, Obs.)'}
                </button>
              </div>

              {showAvanzado && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Recargo Consumo % (Ley 25988)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="13"
                      value={recargoConsumoPct}
                      onChange={(e) => setRecargoConsumoPct(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Descuento Global</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={descuentoGlobal}
                      onChange={(e) => setDescuentoGlobal(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Moneda</label>
                    <select
                      value={moneda}
                      onChange={(e) => setMoneda(e.target.value as Moneda)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm"
                    >
                      <option value="PEN">PEN - Soles (S/)</option>
                      <option value="USD">USD - Dólares (US$)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Forma de Pago</label>
                    <select
                      value={formaPago}
                      onChange={(e) => setFormaPago(e.target.value as FormaPago)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm"
                    >
                      <option value="CONTADO">Contado</option>
                      <option value="CREDITO">Crédito</option>
                    </select>
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] text-slate-400 mb-1">Observaciones Internas</label>
                    <input
                      type="text"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      placeholder="Mesa, guía turístico, forma de pago POS/Yape, etc."
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm"
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-300 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={incluirRefFechaEnDesc}
                  onChange={(e) => setIncluirRefFechaEnDesc(e.target.checked)}
                  className="accent-amber-500"
                />
                Agregar automáticamente <span className="text-amber-300 font-medium">(Consumo DD/MM/AAAA - Ref. Nota)</span> a la descripción para SUNAT
              </label>
            </div>
          </div>

          {/* COLUMNA DERECHA: PANEL DE CALCULO EXACTO SUNAT EN VIVO */}
          <div className="xl:col-span-5 space-y-4 xl:sticky xl:top-32">
            <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-amber-500/30 rounded-2xl p-5 shadow-xl shadow-black/40 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  Desglose Tributario Exacto SUNAT
                </span>
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${
                    calculo.cuadreExacto
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {calculo.cuadreExacto ? '✓ Cuadra al céntimo' : '⚠ Revisar decimales'}
                </span>
              </div>

              {/* Caja destacada: Valor Unitario para copiar en SUNAT SOL */}
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-amber-200">
                    Valor Unitario EXACTO para Portal SUNAT SOL (sin IGV):
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText('vu', calculo.items[0]?.valorUnitarioSunatStr || '0.00')}
                    className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1 transition"
                  >
                    {copiedKey === 'vu' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'vu' ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold font-mono-num text-amber-300 tracking-tight">
                  {calculo.items[0]?.valorUnitarioSunatStr || '0.00'}
                </div>
                <p className="text-[11px] text-amber-100/75 leading-relaxed">
                  Pega este valor exacto en el campo <strong>"Valor Unitario"</strong> de SUNAT SOL para que al sumar el{' '}
                  <strong>{calculo.tasaIgvPorcentaje}%</strong> de IGV salga exactamente{' '}
                  <strong>{formatMoney(calculo.importeTotal, moneda)}</strong> sin descuadres de ±S/ 0.01.
                </p>
              </div>

              {/* Resumen numérico */}
              <div className="space-y-2 text-sm bg-slate-950/70 rounded-xl p-4 border border-slate-800">
                <div className="flex justify-between text-slate-300">
                  <span>Op. Gravada (Subtotal sin IGV):</span>
                  <span className="font-mono-num font-semibold text-white">
                    {formatMoney(calculo.opGravada, moneda)}
                  </span>
                </div>
                {calculo.opExonerada > 0 && (
                  <div className="flex justify-between text-slate-300">
                    <span>Op. Exonerada:</span>
                    <span className="font-mono-num font-semibold text-white">
                      {formatMoney(calculo.opExonerada, moneda)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-300">
                  <span>IGV ({calculo.tasaIgvPorcentaje}%):</span>
                  <span className="font-mono-num font-semibold text-sky-300">
                    {formatMoney(calculo.igvTotal, moneda)}
                  </span>
                </div>
                {calculo.recargoConsumoMonto > 0 && (
                  <div className="flex justify-between text-slate-300">
                    <span>Recargo al Consumo ({calculo.recargoConsumoPorcentaje}%):</span>
                    <span className="font-mono-num font-semibold text-amber-200">
                      {formatMoney(calculo.recargoConsumoMonto, moneda)}
                    </span>
                  </div>
                )}
                <div className="pt-2.5 mt-2 border-t border-slate-800 flex justify-between items-baseline">
                  <span className="font-bold text-white">IMPORTE TOTAL SUNAT:</span>
                  <span className="text-2xl font-extrabold font-mono-num text-emerald-400">
                    {formatMoney(calculo.importeTotal, moneda)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 pt-1 font-medium">
                  {calculo.montoEnLetras}
                </div>
              </div>

              {/* Vista previa de descripción SUNAT */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
                <div className="flex items-center justify-between text-slate-400 mb-1">
                  <span>Descripción lista para SUNAT:</span>
                  <button
                    type="button"
                    onClick={() =>
                      copyText('desc', buildDescripcionSunat(items[0]?.descripcion || '', draftRecord))
                    }
                    className="text-amber-400 hover:underline flex items-center gap-1"
                  >
                    {copiedKey === 'desc' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedKey === 'desc' ? 'Copiada' : 'Copiar'}
                  </button>
                </div>
                <p className="text-slate-200 font-medium">
                  {buildDescripcionSunat(items[0]?.descripcion || '', draftRecord)}
                </p>
              </div>

              {/* Alertas Tributarias en Vivo */}
              {alertas.length > 0 && (
                <div className="space-y-2">
                  {alertas.map((al, i) => (
                    <div
                      key={`${al.codigo}-${i}`}
                      className={`p-3 rounded-xl border text-xs flex gap-2.5 ${
                        al.nivel === 'error'
                          ? 'bg-rose-500/10 border-rose-500/40 text-rose-200'
                          : al.nivel === 'warning'
                            ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
                            : 'bg-sky-500/10 border-sky-500/40 text-sky-200'
                      }`}
                    >
                      {al.nivel === 'info' ? (
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold">{al.mensaje}</div>
                        {al.sugerencia && <div className="opacity-85 mt-0.5">{al.sugerencia}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Botón principal Guardar */}
              <button
                type="submit"
                className={`w-full py-3.5 px-5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition shadow-lg ${
                  hasHardErrors
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                }`}
              >
                <CheckCircle2 className="w-5 h-5" />
                {editingRecord
                  ? 'Guardar Cambios del Comprobante'
                  : hasHardErrors
                    ? 'Guardar en Bandeja (Con Alerta a Revisar)'
                    : 'Guardar Nota y Seguir con la Siguiente (Enter)'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        /* SUB-MODO CARGA MASIVA / EXCEL / WHATSAPP */
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                Carga Masiva de Notas (Pegar de Excel / Texto Rápido / Subir .xlsx)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Formato flexible por línea (separado por <code>|</code>, coma o tabulación de Excel):{' '}
                <code className="text-amber-300">
                  Fecha | Nota | Tipo(F/B) | RUC/DNI/VARIOS | Cliente | Descripción | Monto
                </code>{' '}
                o rápido: <code className="text-emerald-300">Fecha | Descripción | Monto</code>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setBulkText(
                    `05/11/2026 | N-101 | B | VARIOS | CLIENTES VARIOS | Cena Show Turista | 180\n05/11/2026 | N-102 | F | 20100047218 | AGENCIA PERU TOURS SAC | Cena Show Grupo 5 pax | 650\n08/11/2026 | N-103 | B | 45891234 | MARIA LOPEZ | Consumo Alimentos y Bebidas | 320.50`
                  )
                }
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
              >
                Cargar ejemplo
              </button>
              <label className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                <Upload className="w-4 h-4" />
                Subir Excel / CSV
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt"
                  onChange={handleUploadSpreadsheet}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <textarea
            rows={7}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={`Pega aquí tus filas desde Excel o escribe rápido una nota por línea:\n12/11/2026 | N-020 | B | VARIOS | CLIENTES VARIOS | Cena Peña Show | 240\n12/11/2026 | N-021 | F | 20131312955 | INCA TRAILS SAC | Cena Grupo | 890`}
            className="w-full p-4 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-sm font-mono-num focus:border-amber-400 focus:outline-none"
          />

          {bulkParsed.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">
                  Vista Previa: {validBulkRows.length} válidas / {bulkParsed.length} filas detectadas (IGV {config.tasaIgvDefecto}%, Modo{' '}
                  {config.modoCalculoDefecto === 'INCLUYE_IGV' ? 'Mantener Total' : 'Neto + IGV'})
                </span>
                <button
                  type="button"
                  onClick={handleConfirmBulkImport}
                  disabled={!validBulkRows.length}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-40"
                >
                  Importar {validBulkRows.length} Comprobantes a la Bandeja
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950 text-slate-400 uppercase">
                    <tr>
                      <th className="p-2.5">Fecha</th>
                      <th className="p-2.5">Nota</th>
                      <th className="p-2.5">Tipo</th>
                      <th className="p-2.5">Doc / Cliente</th>
                      <th className="p-2.5">Descripción</th>
                      <th className="p-2.5 text-right">Monto</th>
                      <th className="p-2.5">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {bulkParsed.map((row) => (
                      <tr key={row.lineNumber} className="bg-slate-900/50">
                        <td className="p-2.5 font-mono-num">{row.fechaConsumo}</td>
                        <td className="p-2.5 font-mono-num text-amber-300">{row.notaInterna}</td>
                        <td className="p-2.5">{row.tipoComprobante === '01' ? 'FACTURA' : 'BOLETA'}</td>
                        <td className="p-2.5">
                          <span className="font-mono-num text-slate-400 mr-1.5">{row.numeroDocCliente}</span>
                          {row.razonSocialCliente}
                        </td>
                        <td className="p-2.5 text-slate-300">{row.descripcion}</td>
                        <td className="p-2.5 text-right font-mono-num font-bold text-emerald-300">
                          S/ {formatFixed(row.monto, 2)}
                        </td>
                        <td className="p-2.5">
                          {row.error ? (
                            <span className="text-rose-400">{row.error}</span>
                          ) : (
                            <span className="text-emerald-400 font-semibold">✓ Listo</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
