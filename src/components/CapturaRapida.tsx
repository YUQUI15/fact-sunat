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
      descripcion: config.conceptosRapidos[0] || 'Consumo de Alimentos y Bebidas',
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

    const localMatch = clientes.find((c) => c.numeroDoc === clean);
    if (localMatch) {
      setRazonSocialCliente(localMatch.razonSocial);
      setDireccionCliente(localMatch.direccion || '');
      setEmailCliente(localMatch.email || '');
      onNotify(`Cliente cargado desde Directorio local: ${localMatch.razonSocial}`, 'success');
      return;
    }

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
        onNotify(data.error || 'No se pudo consultar en línea. Ingresa la razón social manualmente.', 'error');
      }
    } catch {
      onNotify('Consulta en línea no disponible. El documento fue validado localmente; ingresa el nombre manualmente.', 'info');
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
      onNotify('Ingresa un nombre o razón social válido para guardar en el directorio.', 'error');
      return;
    }
    const existing = clientes.find((c) => c.numeroDoc === numeroDocCliente.trim() && numeroDocCliente.trim() !== '-');
    if (existing) {
      onNotify('Este cliente ya existe en el directorio.', 'info');
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
    onNotify(`Cliente "${razonSocialCliente.trim()}" guardado en el directorio.`, 'success');
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
        descripcion: config.conceptosRapidos[0] || 'Prestación de servicios',
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

  const resetForNextSlip = () => {
    const simulatedList = [...comprobantes, { notaInterna } as ComprobanteRecord];
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
        descripcion: items[0]?.descripcion || config.conceptosRapidos[0] || 'Prestación de servicios',
        cantidad: 1,
        montoIngresado: 0,
        esTotalLinea: true,
        afectacion: tasaIgv > 0 ? '10' : '20',
      },
    ]);
    setTimeout(() => {
      montoInputRef.current?.focus();
      montoInputRef.current?.select();
    }, 40);
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
      onNotify(`Comprobante ${recordToSave.notaInterna} actualizado.`, 'success');
    } else {
      onNotify(`Nota ${recordToSave.notaInterna} (${formatMoney(calculo.importeTotal, moneda)}) guardada en Bandeja.`, 'success');
      resetForNextSlip();
    }
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

  const bulkParsed = useMemo(() => parseBulkLines(bulkText, config), [bulkText, config]);
  const validBulkRows = useMemo(() => bulkParsed.filter((r) => !r.error), [bulkParsed]);

  const handleUploadSpreadsheet = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readSpreadsheetToLines(file);
      setBulkText(text);
      onNotify(`Archivo "${file.name}" cargado. Revisa la vista previa e importa.`, 'success');
    } catch {
      onNotify('Error leyendo el archivo Excel/CSV.', 'error');
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
    onNotify(`Se importaron ${nuevos.length} comprobante(s) a la Bandeja.`, 'success');
  };

  const rucCheck = tipoDocCliente === '6' && numeroDocCliente.trim() ? validarRucPeru(numeroDocCliente) : null;
  const dniCheck = tipoDocCliente === '1' && numeroDocCliente.trim() ? validarDniPeru(numeroDocCliente) : null;

  return (
    <div className="space-y-5">
      {/* Switcher Individual vs Masivo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-soft)] gap-1">
          <button
            type="button"
            onClick={() => setSubMode('INDIVIDUAL')}
            className={`cursor-pointer px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              subMode === 'INDIVIDUAL' ? 'fs-pill-accent' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            {editingRecord ? `Editando ${editingRecord.notaInterna}` : 'Registro Individual'}
          </button>
          <button
            type="button"
            onClick={() => setSubMode('MASIVO')}
            className={`cursor-pointer px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              subMode === 'MASIVO' ? 'fs-pill-accent' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            Importación Masiva / Excel
          </button>
        </div>

        {editingRecord && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="cursor-pointer px-3 py-1.5 rounded-xl fs-pill-rose text-xs font-bold"
          >
            Cancelar edición
          </button>
        )}
      </div>

      {subMode === 'INDIVIDUAL' ? (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Columna Izquierda */}
          <div className="xl:col-span-7 space-y-5">
            {/* 1. Tipo y Fechas */}
            <div className="fs-card p-5 space-y-4">
              <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
                1. Tipo de Comprobante y Fechas
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {(
                  [
                    { id: '03', label: 'Boleta de Venta', sub: 'DNI / Pasaporte / Varios' },
                    { id: '01', label: 'Factura (RUC)', sub: 'Empresas / Negocios' },
                    { id: '07', label: 'Nota de Crédito', sub: 'Anulación / Ajuste' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleTipoChange(opt.id)}
                    className={`cursor-pointer p-3 rounded-xl border text-left transition ${
                      tipoComprobante === opt.id
                        ? 'fs-pill-accent'
                        : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    <div className="font-bold text-xs sm:text-sm">{opt.label}</div>
                    <div className="text-[11px] opacity-80">{opt.sub}</div>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    N° Referencia / Nota
                  </label>
                  <input
                    type="text"
                    value={notaInterna}
                    onChange={(e) => setNotaInterna(e.target.value)}
                    placeholder="N-001"
                    className="fs-input w-full px-3 py-2 text-sm font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Fecha de Operación
                  </label>
                  <input
                    type="date"
                    value={fechaConsumo}
                    onChange={(e) => setFechaConsumo(e.target.value)}
                    className="fs-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold" style={{ color: 'var(--sage-text)' }}>
                      Fecha Emisión SUNAT
                    </label>
                    <button
                      type="button"
                      onClick={() => setFechaEmisionSunat(hoy)}
                      className="cursor-pointer text-[11px] font-semibold hover:underline"
                      style={{ color: 'var(--accent-text)' }}
                    >
                      Hoy
                    </button>
                  </div>
                  <input
                    type="date"
                    value={fechaEmisionSunat}
                    onChange={(e) => setFechaEmisionSunat(e.target.value)}
                    className="fs-input w-full px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* 2. Cliente */}
            <div className="fs-card p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
                  2. Datos del Cliente / Adquirente
                </span>
                {clientes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {clientes.slice(0, 4).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleApplyClienteFrecuente(c)}
                        className="cursor-pointer text-[11px] px-2.5 py-1 rounded-full fs-pill-peach font-semibold transition hover:opacity-85"
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
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
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
                    className="fs-input w-full px-3 py-2 text-sm"
                  >
                    <option value="0">Sin Doc. (Clientes Varios)</option>
                    <option value="6">RUC (11 dígitos)</option>
                    <option value="1">DNI (8 dígitos)</option>
                    <option value="7">Pasaporte</option>
                    <option value="4">Carnet de Extranjería</option>
                  </select>
                </div>

                <div className="sm:col-span-5">
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Número de Documento
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={numeroDocCliente}
                      onChange={(e) => setNumeroDocCliente(e.target.value)}
                      placeholder={tipoDocCliente === '6' ? '20XXXXXXXXX' : tipoDocCliente === '1' ? '8 dígitos' : '-'}
                      className="fs-input w-full px-3 py-2 text-sm font-mono-num"
                    />
                    {(tipoDocCliente === '6' || tipoDocCliente === '1') && (
                      <button
                        type="button"
                        onClick={handleConsultarDoc}
                        disabled={lookupLoading}
                        className="cursor-pointer px-3 py-2 rounded-xl fs-pill-sky text-xs font-bold flex items-center gap-1 shrink-0 disabled:opacity-50"
                      >
                        <Search className="w-3.5 h-3.5" />
                        {lookupLoading ? '...' : 'Buscar'}
                      </button>
                    )}
                  </div>
                  {rucCheck && (
                    <p
                      className="text-[11px] mt-1 font-medium"
                      style={{ color: rucCheck.valido ? 'var(--sage-text)' : 'var(--rose-text)' }}
                    >
                      {rucCheck.valido ? `✓ RUC válido (${rucCheck.tipo})` : `✗ ${rucCheck.motivo}`}
                    </p>
                  )}
                  {dniCheck && (
                    <p
                      className="text-[11px] mt-1 font-medium"
                      style={{ color: dniCheck.valido ? 'var(--sage-text)' : 'var(--rose-text)' }}
                    >
                      {dniCheck.valido ? '✓ DNI válido' : `✗ ${dniCheck.motivo}`}
                    </p>
                  )}
                </div>

                <div className="sm:col-span-3 flex items-end">
                  <button
                    type="button"
                    onClick={handleSaveCurrentClientToAgenda}
                    className="fs-btn-soft w-full py-2 px-2.5 text-xs flex items-center justify-center gap-1.5"
                  >
                    <UserPlus className="w-3.5 h-3.5" style={{ color: 'var(--accent-text)' }} />
                    Guardar
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Razón Social / Nombres
                  </label>
                  <input
                    type="text"
                    value={razonSocialCliente}
                    onChange={(e) => setRazonSocialCliente(e.target.value)}
                    placeholder="Razón social o CLIENTES VARIOS"
                    className="fs-input w-full px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Dirección (Opcional)
                  </label>
                  <input
                    type="text"
                    value={direccionCliente}
                    onChange={(e) => setDireccionCliente(e.target.value)}
                    placeholder="Dirección fiscal o comercial"
                    className="fs-input w-full px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* 3. Cálculo e Ítems */}
            <div className="fs-card p-5 space-y-4">
              <div className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
                3. Cálculo IGV y Detalle del Comprobante
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setModoCalculo('INCLUYE_IGV')}
                  className={`cursor-pointer p-3 rounded-xl border text-left transition ${
                    modoCalculo === 'INCLUYE_IGV'
                      ? 'fs-pill-sage'
                      : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="font-bold text-xs sm:text-sm">IGV Incluido (Mantener Total)</div>
                  <div className="text-[11px] opacity-80">Extrae Base e IGV conservando el total.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setModoCalculo('MAS_IGV')}
                  className={`cursor-pointer p-3 rounded-xl border text-left transition ${
                    modoCalculo === 'MAS_IGV'
                      ? 'fs-pill-sky'
                      : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="font-bold text-xs sm:text-sm">Neto + IGV Adicional</div>
                  <div className="text-[11px] opacity-80">Suma el porcentaje de IGV sobre la base.</div>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {TASAS_IGV_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setTasaIgv(preset.value);
                      setCustomTasa('');
                      setItems((prev) =>
                        prev.map((it) => ({ ...it, afectacion: preset.value === 0 ? '20' : '10' }))
                      );
                    }}
                    className={`cursor-pointer px-2.5 py-1.5 rounded-lg text-xs font-bold border transition ${
                      tasaIgv === preset.value && !customTasa
                        ? 'fs-pill-accent'
                        : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {preset.value}% ({preset.badge})
                  </button>
                ))}
                <div className="flex items-center gap-1 bg-[var(--bg-inset)] border border-[var(--border-soft)] rounded-lg px-2 py-1">
                  <span className="text-[11px] text-[var(--text-muted)]">Otro %:</span>
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
                    placeholder="%"
                    className="w-12 bg-transparent text-xs font-mono-num text-[var(--text-primary)] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {config.conceptosRapidos.map((concepto) => (
                  <button
                    key={concepto}
                    type="button"
                    onClick={() => updateItem(items[0].id, { descripcion: concepto })}
                    className="cursor-pointer text-[11px] px-2.5 py-1 rounded-lg fs-btn-soft"
                  >
                    + {concepto}
                  </button>
                ))}
              </div>

              <div className="space-y-2.5">
                {items.map((item, idx) => (
                  <div key={item.id} className="fs-inset p-3.5 space-y-2.5">
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-12 sm:col-span-6">
                        <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                          Descripción {items.length > 1 ? `#${idx + 1}` : ''}
                        </label>
                        <input
                          type="text"
                          value={item.descripcion}
                          onChange={(e) => updateItem(item.id, { descripcion: e.target.value })}
                          className="fs-input w-full px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <label className="block text-[11px] text-[var(--text-muted)] mb-1">Cant.</label>
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          value={item.cantidad}
                          onChange={(e) =>
                            updateItem(item.id, { cantidad: Math.max(0.01, parseFloat(e.target.value) || 1) })
                          }
                          className="fs-input w-full px-2 py-2 text-sm font-mono-num text-center"
                        />
                      </div>
                      <div className="col-span-6 sm:col-span-3">
                        <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--accent-text)' }}>
                          {modoCalculo === 'INCLUYE_IGV'
                            ? item.esTotalLinea
                              ? `Total (${moneda})`
                              : `P. Unit (${moneda})`
                            : item.esTotalLinea
                              ? `Subtotal (${moneda})`
                              : `V. Unit (${moneda})`}
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
                          className="fs-input w-full px-3 py-2 text-base font-extrabold font-mono-num text-right"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1 flex justify-end">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="cursor-pointer p-2 rounded-lg hover:bg-[var(--rose-soft)]"
                            style={{ color: 'var(--rose-text)' }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-muted)]">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={item.esTotalLinea}
                          onChange={(e) => updateItem(item.id, { esTotalLinea: e.target.checked })}
                          className="accent-[var(--accent-bg)]"
                        />
                        Monto corresponde al total de la línea
                      </label>
                      <select
                        value={item.afectacion}
                        onChange={(e) => updateItem(item.id, { afectacion: e.target.value as AfectacionIGV })}
                        className="fs-input px-2 py-0.5 text-[11px]"
                      >
                        <option value="10">10 - Gravado IGV</option>
                        <option value="20">20 - Exonerado</option>
                        <option value="30">30 - Inafecto</option>
                      </select>
                      <select
                        value={item.unidad}
                        onChange={(e) => updateItem(item.id, { unidad: e.target.value })}
                        className="fs-input px-2 py-0.5 text-[11px]"
                      >
                        <option value="ZZ">ZZ - Servicio</option>
                        <option value="NIU">NIU - Unidad</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={addItem}
                  className="fs-btn-soft px-3 py-1.5 text-xs flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" style={{ color: 'var(--accent-text)' }} />
                  Añadir otro ítem
                </button>
                <button
                  type="button"
                  onClick={() => setShowAvanzado((s) => !s)}
                  className="cursor-pointer text-xs font-semibold hover:underline"
                  style={{ color: 'var(--accent-text)' }}
                >
                  {showAvanzado ? 'Ocultar opciones adicionales' : '+ Opciones adicionales (Recargo, Descuento, USD)'}
                </button>
              </div>

              {showAvanzado && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[var(--border-soft)]">
                  <div>
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">Recargo Consumo %</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="13"
                      value={recargoConsumoPct}
                      onChange={(e) => setRecargoConsumoPct(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="fs-input w-full px-2.5 py-1.5 text-sm font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">Descuento Global</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={descuentoGlobal}
                      onChange={(e) => setDescuentoGlobal(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="fs-input w-full px-2.5 py-1.5 text-sm font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">Moneda</label>
                    <select
                      value={moneda}
                      onChange={(e) => setMoneda(e.target.value as Moneda)}
                      className="fs-input w-full px-2.5 py-1.5 text-sm"
                    >
                      <option value="PEN">PEN - Soles</option>
                      <option value="USD">USD - Dólares</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">Forma de Pago</label>
                    <select
                      value={formaPago}
                      onChange={(e) => setFormaPago(e.target.value as FormaPago)}
                      className="fs-input w-full px-2.5 py-1.5 text-sm"
                    >
                      <option value="CONTADO">Contado</option>
                      <option value="CREDITO">Crédito</option>
                    </select>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">Observaciones Internas</label>
                    <input
                      type="text"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      placeholder="Medio de pago, referencia interna, orden de servicio..."
                      className="fs-input w-full px-3 py-1.5 text-sm"
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={incluirRefFechaEnDesc}
                  onChange={(e) => setIncluirRefFechaEnDesc(e.target.checked)}
                  className="accent-[var(--accent-bg)]"
                />
                Incluir automáticamente fecha de operación y referencia en la descripción para SUNAT
              </label>
            </div>
          </div>

          {/* Columna Derecha: Panel de Cálculo Sticky */}
          <div className="xl:col-span-5 xl:sticky xl:top-20">
            <div className="fs-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
                  Desglose Tributario
                </span>
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${
                    calculo.cuadreExacto ? 'fs-pill-sage' : 'fs-pill-peach'
                  }`}
                >
                  {calculo.cuadreExacto ? '✓ Cuadra exacto' : 'Revisar decimales'}
                </span>
              </div>

              <div className="p-4 rounded-xl fs-pill-accent space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold">Valor Unitario Exacto SUNAT (sin IGV):</span>
                  <button
                    type="button"
                    onClick={() => copyText('vu', calculo.items[0]?.valorUnitarioSunatStr || '0.00')}
                    className="fs-btn-primary px-2.5 py-1 text-xs flex items-center gap-1"
                  >
                    {copiedKey === 'vu' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'vu' ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <div className="text-3xl font-extrabold font-mono-num tracking-tight">
                  {calculo.items[0]?.valorUnitarioSunatStr || '0.00'}
                </div>
              </div>

              <div className="fs-inset p-4 space-y-2 text-sm">
                <div className="flex justify-between text-[var(--text-secondary)]">
                  <span>Op. Gravada (Subtotal):</span>
                  <span className="font-mono-num font-bold text-[var(--text-primary)]">
                    {formatMoney(calculo.opGravada, moneda)}
                  </span>
                </div>
                <div className="flex justify-between text-[var(--text-secondary)]">
                  <span>IGV ({calculo.tasaIgvPorcentaje}%):</span>
                  <span className="font-mono-num font-bold" style={{ color: 'var(--sky-text)' }}>
                    {formatMoney(calculo.igvTotal, moneda)}
                  </span>
                </div>
                {calculo.recargoConsumoMonto > 0 && (
                  <div className="flex justify-between text-[var(--text-secondary)]">
                    <span>Recargo Consumo ({calculo.recargoConsumoPorcentaje}%):</span>
                    <span className="font-mono-num font-bold" style={{ color: 'var(--peach-text)' }}>
                      {formatMoney(calculo.recargoConsumoMonto, moneda)}
                    </span>
                  </div>
                )}
                <div className="pt-2.5 mt-2 border-t border-[var(--border-soft)] flex justify-between items-baseline">
                  <span className="font-bold text-[var(--text-primary)]">IMPORTE TOTAL:</span>
                  <span className="text-2xl font-extrabold font-mono-num" style={{ color: 'var(--sage-text)' }}>
                    {formatMoney(calculo.importeTotal, moneda)}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--text-muted)] pt-1 font-medium">
                  {calculo.montoEnLetras}
                </div>
              </div>

              <div className="fs-inset p-3 text-xs">
                <div className="flex items-center justify-between text-[var(--text-muted)] mb-1">
                  <span>Descripción lista para SUNAT:</span>
                  <button
                    type="button"
                    onClick={() =>
                      copyText('desc', buildDescripcionSunat(items[0]?.descripcion || '', draftRecord))
                    }
                    className="cursor-pointer font-semibold hover:underline flex items-center gap-1"
                    style={{ color: 'var(--accent-text)' }}
                  >
                    {copiedKey === 'desc' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedKey === 'desc' ? 'Copiada' : 'Copiar'}
                  </button>
                </div>
                <p className="text-[var(--text-primary)] font-medium">
                  {buildDescripcionSunat(items[0]?.descripcion || '', draftRecord)}
                </p>
              </div>

              {alertas.length > 0 && (
                <div className="space-y-2">
                  {alertas.map((al, i) => (
                    <div
                      key={`${al.codigo}-${i}`}
                      className={`p-3 rounded-xl text-xs flex gap-2 ${
                        al.nivel === 'error'
                          ? 'fs-pill-rose'
                          : al.nivel === 'warning'
                            ? 'fs-pill-peach'
                            : 'fs-pill-sky'
                      }`}
                    >
                      {al.nivel === 'info' ? (
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-bold">{al.mensaje}</div>
                        {al.sugerencia && <div className="opacity-90 mt-0.5">{al.sugerencia}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="submit"
                className={`${hasHardErrors ? 'fs-btn-primary' : 'fs-btn-sage'} w-full py-3.5 px-5 text-sm flex items-center justify-center gap-2 shadow-sm`}
              >
                <CheckCircle2 className="w-4 h-4" />
                {editingRecord
                  ? 'Guardar Cambios'
                  : hasHardErrors
                    ? 'Guardar en Bandeja (Con Observación)'
                    : 'Guardar y Continuar con el Siguiente'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="fs-card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" style={{ color: 'var(--sage-text)' }} />
                Importación Masiva (Pegar de Excel / Texto / Subir .xlsx)
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Formato por línea: <code className="font-mono-num">Fecha | Nota | Tipo(F/B) | RUC/DNI/VARIOS | Cliente | Descripción | Monto</code>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setBulkText(
                    `05/11/2026 | N-101 | B | VARIOS | CLIENTES VARIOS | Consumo Alimentos y Bebidas | 180\n05/11/2026 | N-102 | F | 20100047218 | CORPORACION COMERCIAL DEL PERU SAC | Prestación de Servicios | 650\n08/11/2026 | N-103 | B | 45891234 | MARIA LOPEZ PEREZ | Venta de Productos | 320.50`
                  )
                }
                className="fs-btn-soft px-3 py-2 text-xs"
              >
                Cargar ejemplo
              </button>
              <label className="cursor-pointer px-3.5 py-2 rounded-xl fs-pill-sage text-xs font-bold flex items-center gap-1.5">
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
            placeholder="Pega aquí las filas desde Excel o ingresa una línea por comprobante..."
            className="fs-input w-full p-4 text-xs font-mono-num"
          />

          {bulkParsed.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[var(--text-primary)]">
                  Vista previa: {validBulkRows.length} válidas de {bulkParsed.length} filas (IGV {config.tasaIgvDefecto}%)
                </span>
                <button
                  type="button"
                  onClick={handleConfirmBulkImport}
                  disabled={!validBulkRows.length}
                  className="fs-btn-sage px-4 py-2 text-xs"
                >
                  Importar {validBulkRows.length} Comprobantes
                </button>
              </div>

              <div className="overflow-x-auto border border-[var(--border-soft)] rounded-xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[var(--bg-inset)] text-[var(--text-muted)] uppercase">
                    <tr>
                      <th className="p-2.5">Fecha</th>
                      <th className="p-2.5">Nota</th>
                      <th className="p-2.5">Tipo</th>
                      <th className="p-2.5">Cliente</th>
                      <th className="p-2.5">Descripción</th>
                      <th className="p-2.5 text-right">Monto</th>
                      <th className="p-2.5">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-soft)]">
                    {bulkParsed.map((row) => (
                      <tr key={row.lineNumber}>
                        <td className="p-2.5 font-mono-num">{row.fechaConsumo}</td>
                        <td className="p-2.5 font-mono-num font-bold" style={{ color: 'var(--accent-text)' }}>
                          {row.notaInterna}
                        </td>
                        <td className="p-2.5">{row.tipoComprobante === '01' ? 'FACTURA' : 'BOLETA'}</td>
                        <td className="p-2.5">
                          <span className="font-mono-num text-[var(--text-muted)] mr-1.5">{row.numeroDocCliente}</span>
                          {row.razonSocialCliente}
                        </td>
                        <td className="p-2.5 text-[var(--text-secondary)]">{row.descripcion}</td>
                        <td className="p-2.5 text-right font-mono-num font-bold" style={{ color: 'var(--sage-text)' }}>
                          S/ {formatFixed(row.monto, 2)}
                        </td>
                        <td className="p-2.5">
                          {row.error ? (
                            <span style={{ color: 'var(--rose-text)' }}>{row.error}</span>
                          ) : (
                            <span className="font-bold" style={{ color: 'var(--sage-text)' }}>
                              ✓ Válido
                            </span>
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
