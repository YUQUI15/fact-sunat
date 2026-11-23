import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Calculator,
  Check,
  CheckCircle2,
  Copy,
  HelpCircle,
  ListPlus,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type {
  ComprobanteItem,
  ComprobanteRecord,
  EmpresaEmisoraConfig,
  ModoCalculoIGV,
} from '../types/sunat';
import {
  calculateComprobante,
  formatFixed,
  formatMoney,
  TASAS_IGV_PRESETS,
} from '../lib/sunatMath';
import { getHoyPeruISO } from '../lib/sunatValidators';

interface CalculadoraIGVProps {
  config: EmpresaEmisoraConfig;
  comprobantesCount: number;
  onSendToBandeja: (rec: ComprobanteRecord) => void;
  onOpenGuia: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

interface LineaCalc {
  id: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
}

export const CalculadoraIGV: React.FC<CalculadoraIGVProps> = ({
  config,
  comprobantesCount,
  onSendToBandeja,
  onOpenGuia,
  onNotify,
}) => {
  const [modoCalc, setModoCalc] = useState<'UN_TOTAL' | 'VARIOS_PRECIOS'>('UN_TOTAL');
  const [modoIgv, setModoIgv] = useState<ModoCalculoIGV>('INCLUYE_IGV');
  const [tasaIgv, setTasaIgv] = useState<number>(config.tasaIgvDefecto || 18);
  const [customTasa, setCustomTasa] = useState<string>('');
  const [montoUnico, setMontoUnico] = useState<string>('250');
  const [descUnica, setDescUnica] = useState<string>(
    config.conceptosRapidos[0] || 'Consumo de Alimentos y Bebidas'
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [lineas, setLineas] = useState<LineaCalc[]>([
    { id: 'l1', descripcion: 'Servicio Principal / Consumo', cantidad: 2, precioUnitario: 85 },
    { id: 'l2', descripcion: 'Adicional / Complemento', cantidad: 2, precioUnitario: 25 },
  ]);
  const [nuevaDesc, setNuevaDesc] = useState<string>('');
  const [nuevaCant, setNuevaCant] = useState<string>('1');
  const [nuevoPrecio, setNuevoPrecio] = useState<string>('');

  const itemsParaCalculo: ComprobanteItem[] = useMemo(() => {
    if (modoCalc === 'UN_TOTAL') {
      const m = parseFloat(montoUnico);
      return [
        {
          id: 'single',
          unidad: 'ZZ',
          descripcion: descUnica || 'Prestación de servicios / Consumo',
          cantidad: 1,
          montoIngresado: Number.isFinite(m) && m > 0 ? m : 0,
          esTotalLinea: true,
          afectacion: tasaIgv > 0 ? '10' : '20',
        },
      ];
    }
    return lineas.map((l) => ({
      id: l.id,
      unidad: 'ZZ',
      descripcion: l.descripcion || 'Ítem / Servicio',
      cantidad: l.cantidad > 0 ? l.cantidad : 1,
      montoIngresado: l.precioUnitario > 0 ? l.precioUnitario : 0,
      esTotalLinea: false,
      afectacion: tasaIgv > 0 ? '10' : '20',
    }));
  }, [modoCalc, montoUnico, descUnica, lineas, tasaIgv]);

  const resultado = useMemo(
    () =>
      calculateComprobante({
        items: itemsParaCalculo,
        modoCalculo: modoIgv,
        tasaIgv,
        recargoConsumoPct: 0,
        descuentoGlobal: 0,
        moneda: 'PEN',
      }),
    [itemsParaCalculo, modoIgv, tasaIgv]
  );

  const comparativaTasas = useMemo(() => {
    return [18, 10.5, 10, 15, 0].map((t) => {
      const c = calculateComprobante({
        items: itemsParaCalculo.map((it) => ({
          ...it,
          afectacion: t > 0 ? '10' : '20',
        })),
        modoCalculo: modoIgv,
        tasaIgv: t,
        recargoConsumoPct: 0,
        descuentoGlobal: 0,
        moneda: 'PEN',
      });
      return {
        tasa: t,
        etiqueta:
          t === 18
            ? '18% · General'
            : t === 10.5
              ? '10.5% · MYPE 2026'
              : t === 10
                ? '10% · MYPE Ant.'
                : t === 15
                  ? '15% · MYPE 2027'
                  : '0% · Exonerado',
        base: c.opGravada + c.opExonerada,
        igv: c.igvTotal,
        total: c.importeTotal,
      };
    });
  }, [itemsParaCalculo, modoIgv]);

  const copyVal = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      onNotify('No se pudo copiar al portapapeles.', 'error');
    }
  };

  const handleAddLinea = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseFloat(nuevoPrecio);
    const c = parseFloat(nuevaCant);
    if (!Number.isFinite(p) || p <= 0) {
      onNotify('Ingresa un precio unitario mayor a S/ 0.00.', 'error');
      return;
    }
    setLineas((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        descripcion: nuevaDesc.trim() || `Concepto #${prev.length + 1}`,
        cantidad: Number.isFinite(c) && c > 0 ? c : 1,
        precioUnitario: p,
      },
    ]);
    setNuevaDesc('');
    setNuevaCant('1');
    setNuevoPrecio('');
  };

  const handleGuardarEnBandeja = () => {
    if (resultado.importeTotal <= 0) {
      onNotify('Ingresa un monto mayor a S/ 0.00 antes de registrar.', 'error');
      return;
    }
    const hoy = getHoyPeruISO();
    const now = new Date().toISOString();
    const rec: ComprobanteRecord = {
      id: crypto.randomUUID(),
      notaInterna: `N-${String(comprobantesCount + 1).padStart(3, '0')}`,
      tipoComprobante: '03',
      fechaConsumo: hoy,
      fechaEmisionSunat: hoy,
      serieSunat: config.serieBoletaSol,
      numeroSunat: '',
      tipoDocCliente: '0',
      numeroDocCliente: '-',
      razonSocialCliente: 'CLIENTES VARIOS',
      direccionCliente: '',
      emailCliente: '',
      moneda: 'PEN',
      tipoCambio: 3.75,
      modoCalculo: modoIgv,
      tasaIgv,
      recargoConsumoPct: 0,
      descuentoGlobal: 0,
      formaPago: 'CONTADO',
      incluirRefFechaEnDesc: config.incluirRefFechaDefecto,
      observaciones: 'Generado desde Calculadora IGV',
      items: itemsParaCalculo.map((it) => ({ ...it, id: crypto.randomUUID() })),
      estado: 'PENDIENTE',
      creadoEn: now,
      actualizadoEn: now,
    };
    onSendToBandeja(rec);
    onNotify(`Comprobante por ${formatMoney(resultado.importeTotal)} agregado a la Bandeja.`, 'success');
  };

  return (
    <div className="space-y-5">
      {/* Barra Superior de Modo + Acceso a Guía */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-soft)] gap-1">
          <button
            type="button"
            onClick={() => setModoCalc('UN_TOTAL')}
            className={`cursor-pointer px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              modoCalc === 'UN_TOTAL' ? 'fs-pill-accent' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            Cálculo por Monto Total
          </button>
          <button
            type="button"
            onClick={() => setModoCalc('VARIOS_PRECIOS')}
            className={`cursor-pointer px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              modoCalc === 'VARIOS_PRECIOS' ? 'fs-pill-accent' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <ListPlus className="w-3.5 h-3.5" />
            Sumador de Múltiples Ítems
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenGuia}
          className="cursor-pointer px-3.5 py-2 rounded-xl fs-btn-soft text-xs flex items-center gap-1.5"
        >
          <HelpCircle className="w-3.5 h-3.5" style={{ color: 'var(--accent-text)' }} />
          Guía Operativa y Resolución de Errores SUNAT
        </button>
      </div>

      {/* Configuración de Base del Impuesto y Tasa */}
      <div className="fs-card p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setModoIgv('INCLUYE_IGV')}
            className={`cursor-pointer p-4 rounded-xl border text-left transition ${
              modoIgv === 'INCLUYE_IGV'
                ? 'fs-pill-sage'
                : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-sm">IGV Incluido en el Total (Desglosar Base)</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-white/60 dark:bg-black/25">
                Mantiene Total
              </span>
            </div>
            <p className="text-xs opacity-85 mt-1">
              El importe ingresado es el total final (ej. S/ 100.00 → Subtotal S/ 84.75 + IGV S/ 15.25 = S/ 100.00).
            </p>
          </button>

          <button
            type="button"
            onClick={() => setModoIgv('MAS_IGV')}
            className={`cursor-pointer p-4 rounded-xl border text-left transition ${
              modoIgv === 'MAS_IGV'
                ? 'fs-pill-sky'
                : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
            }`}
          >
            <div className="font-bold text-sm">Importe Neto + IGV Adicional</div>
            <p className="text-xs opacity-85 mt-1">
              El monto ingresado es base imponible y se agrega el IGV encima (ej. S/ 100.00 + 18% = S/ 118.00).
            </p>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs font-bold text-[var(--text-secondary)] mr-1">Tasa IGV:</span>
          {TASAS_IGV_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                setTasaIgv(p.value);
                setCustomTasa('');
              }}
              className={`cursor-pointer px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                tasaIgv === p.value && !customTasa
                  ? 'fs-pill-accent'
                  : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
              }`}
            >
              {p.value}% <span className="font-normal opacity-75">({p.badge})</span>
            </button>
          ))}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[var(--bg-inset)] border border-[var(--border-soft)]">
            <span className="text-xs text-[var(--text-muted)]">Personalizada %:</span>
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
              placeholder="0.0"
              className="w-14 bg-transparent text-[var(--text-primary)] text-xs font-mono-num font-bold focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Área Principal de 2 Columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Columna Izquierda: Ingreso */}
        <div className="lg:col-span-6 space-y-5">
          {modoCalc === 'UN_TOTAL' ? (
            <div className="fs-card p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)] mb-2">
                  {modoIgv === 'INCLUYE_IGV'
                    ? 'Importe Total del Comprobante (PEN)'
                    : 'Valor Neto sin Impuestos (PEN)'}
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-bold text-[var(--text-muted)] font-mono-num">
                    S/
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={montoUnico}
                    onChange={(e) => setMontoUnico(e.target.value)}
                    placeholder="0.00"
                    className="fs-input w-full pl-12 pr-4 py-3.5 text-3xl font-extrabold font-mono-num"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  {[50, 100, 150, 250, 480, 750, 1200].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setMontoUnico(String(v))}
                      className="cursor-pointer px-2.5 py-1 rounded-lg fs-btn-soft text-xs font-mono-num"
                    >
                      S/ {v}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setMontoUnico('')}
                    className="cursor-pointer px-2.5 py-1 rounded-lg fs-pill-rose text-xs font-semibold flex items-center gap-1 ml-auto"
                  >
                    <RotateCcw className="w-3 h-3" /> Limpiar
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                  Descripción / Concepto
                </label>
                <input
                  type="text"
                  value={descUnica}
                  onChange={(e) => setDescUnica(e.target.value)}
                  className="fs-input w-full px-3.5 py-2.5 text-sm"
                />
              </div>

              <div className="fs-inset p-3.5 text-xs text-[var(--text-secondary)] space-y-1">
                <div className="font-bold text-[var(--text-primary)]">Fórmula Tributaria Aplicada</div>
                {modoIgv === 'INCLUYE_IGV' ? (
                  <p className="font-mono-num">
                    Base = {formatFixed(resultado.importeTotal)} ÷ {(1 + tasaIgv / 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} ={' '}
                    <strong className="text-[var(--text-primary)]">S/ {formatFixed(resultado.opGravada)}</strong> · IGV ({tasaIgv}%) ={' '}
                    <strong style={{ color: 'var(--sky-text)' }}>S/ {formatFixed(resultado.igvTotal)}</strong>
                  </p>
                ) : (
                  <p className="font-mono-num">
                    IGV = {formatFixed(resultado.opGravada)} × {tasaIgv}% ={' '}
                    <strong style={{ color: 'var(--sky-text)' }}>S/ {formatFixed(resultado.igvTotal)}</strong> · Total ={' '}
                    <strong style={{ color: 'var(--sage-text)' }}>S/ {formatFixed(resultado.importeTotal)}</strong>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="fs-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  Detalle de Ítems y Precios
                </h3>
                {lineas.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setLineas([])}
                    className="cursor-pointer text-xs font-semibold flex items-center gap-1"
                    style={{ color: 'var(--rose-text)' }}
                  >
                    <RotateCcw className="w-3 h-3" /> Vaciar
                  </button>
                )}
              </div>

              <form onSubmit={handleAddLinea} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-12 sm:col-span-5">
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">Concepto</label>
                  <input
                    type="text"
                    value={nuevaDesc}
                    onChange={(e) => setNuevaDesc(e.target.value)}
                    placeholder="Descripción del bien o servicio"
                    className="fs-input w-full px-3 py-2 text-xs"
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">Cant.</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={nuevaCant}
                    onChange={(e) => setNuevaCant(e.target.value)}
                    className="fs-input w-full px-2 py-2 text-xs font-mono-num text-center"
                  />
                </div>
                <div className="col-span-5 sm:col-span-3">
                  <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                    Precio c/u (S/)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={nuevoPrecio}
                    onChange={(e) => setNuevoPrecio(e.target.value)}
                    placeholder="0.00"
                    className="fs-input w-full px-2.5 py-2 text-xs font-mono-num font-bold text-right"
                  />
                </div>
                <div className="col-span-3 sm:col-span-2">
                  <button
                    type="submit"
                    className="fs-btn-primary w-full py-2 text-xs flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Añadir
                  </button>
                </div>
              </form>

              <div className="space-y-2 max-h-72 overflow-y-auto">
                {resultado.items.length === 0 ? (
                  <div className="fs-inset p-6 text-center text-xs text-[var(--text-muted)]">
                    Agrega ítems arriba para obtener el total acumulado y el desglose exacto por línea.
                  </div>
                ) : (
                  resultado.items.map((it, idx) => (
                    <div
                      key={it.id}
                      className="fs-inset p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-[var(--text-primary)] truncate">
                          {it.cantidad} × {it.descripcion}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] font-mono-num mt-0.5">
                          V.U. SUNAT: <strong style={{ color: 'var(--accent-text)' }}>{it.valorUnitarioSunatStr}</strong> · Base S/ {formatFixed(it.valorVenta)} · IGV S/ {formatFixed(it.igvLinea)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono-num font-bold" style={{ color: 'var(--sage-text)' }}>
                          S/ {formatFixed(it.totalLinea)}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyVal(`item_${idx}`, it.valorUnitarioSunatStr)}
                          className="cursor-pointer px-2 py-1 rounded-lg fs-pill-accent text-[11px] font-bold"
                        >
                          {copiedKey === `item_${idx}` ? '✓' : 'Copiar VU'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setLineas((prev) => prev.filter((x) => x.id !== it.id))}
                          className="cursor-pointer p-1 rounded-lg hover:bg-[var(--rose-soft)]"
                          style={{ color: 'var(--rose-text)' }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Comparador de Tasas */}
          <div className="fs-card p-5 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">
              Comparativa Rápida por Tasa de IGV
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[11px] text-[var(--text-muted)] border-b border-[var(--border-soft)]">
                  <tr>
                    <th className="py-2">Régimen / Tasa</th>
                    <th className="py-2 text-right">Base Imponible</th>
                    <th className="py-2 text-right">IGV</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-soft)] font-mono-num">
                  {comparativaTasas.map((row) => {
                    const isSel = row.tasa === tasaIgv;
                    return (
                      <tr
                        key={row.tasa}
                        onClick={() => {
                          setTasaIgv(row.tasa);
                          setCustomTasa('');
                        }}
                        className="cursor-pointer transition hover:bg-[var(--bg-hover)]"
                        style={isSel ? { backgroundColor: 'var(--accent-soft)' } : undefined}
                      >
                        <td className="py-2.5 px-1.5 font-sans font-semibold text-[var(--text-primary)]">
                          {row.etiqueta}
                        </td>
                        <td className="py-2.5 text-right text-[var(--text-secondary)]">
                          S/ {formatFixed(row.base)}
                        </td>
                        <td className="py-2.5 text-right" style={{ color: 'var(--sky-text)' }}>
                          S/ {formatFixed(row.igv)}
                        </td>
                        <td className="py-2.5 px-1.5 text-right font-bold" style={{ color: 'var(--sage-text)' }}>
                          S/ {formatFixed(row.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Columna Derecha: Desglose Tributario Exacto */}
        <div className="lg:col-span-6 space-y-4">
          <div className="fs-card p-6 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
                Resultado Tributario SUNAT
              </span>
              <span className="text-[11px] px-2.5 py-1 rounded-full fs-pill-sage font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Cuadre exacto al céntimo
              </span>
            </div>

            {/* Caja Principal: Valor Unitario Exacto */}
            <div className="p-5 rounded-2xl fs-pill-accent space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">
                  {modoCalc === 'UN_TOTAL'
                    ? 'Valor Unitario Exacto para SUNAT SEE-SOL (sin IGV)'
                    : 'Base Imponible Total (sin IGV)'}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyVal(
                      'main_vu',
                      modoCalc === 'UN_TOTAL'
                        ? resultado.items[0]?.valorUnitarioSunatStr || '0.00'
                        : formatFixed(resultado.opGravada)
                    )
                  }
                  className="fs-btn-primary px-3.5 py-2 text-xs flex items-center gap-1.5 shadow-sm"
                >
                  {copiedKey === 'main_vu' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'main_vu' ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <div className="text-4xl font-extrabold font-mono-num tracking-tight">
                {modoCalc === 'UN_TOTAL'
                  ? resultado.items[0]?.valorUnitarioSunatStr || '0.00'
                  : formatFixed(resultado.opGravada)}
              </div>
              <p className="text-xs opacity-85 leading-relaxed">
                Copia este valor completo en el campo <strong>Valor Unitario</strong> del Portal SUNAT para que al aplicar el <strong>{tasaIgv}%</strong> el total resulte exactamente <strong>{formatMoney(resultado.importeTotal)}</strong> sin diferencias de redondeo.
              </p>
            </div>

            {/* Tarjetas de Desglose */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="fs-inset p-4 space-y-1">
                <div className="text-[11px] font-semibold text-[var(--text-muted)]">SUBTOTAL (BASE)</div>
                <div className="text-xl font-extrabold font-mono-num text-[var(--text-primary)]">
                  S/ {formatFixed(resultado.opGravada + resultado.opExonerada)}
                </div>
                <button
                  type="button"
                  onClick={() => copyVal('sub', formatFixed(resultado.opGravada + resultado.opExonerada))}
                  className="cursor-pointer text-[11px] font-semibold hover:underline"
                  style={{ color: 'var(--accent-text)' }}
                >
                  {copiedKey === 'sub' ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>

              <div className="p-4 rounded-xl fs-pill-sky space-y-1">
                <div className="text-[11px] font-bold">IGV ({tasaIgv}%)</div>
                <div className="text-xl font-extrabold font-mono-num">
                  S/ {formatFixed(resultado.igvTotal)}
                </div>
                <button
                  type="button"
                  onClick={() => copyVal('igv', formatFixed(resultado.igvTotal))}
                  className="cursor-pointer text-[11px] font-semibold hover:underline"
                >
                  {copiedKey === 'igv' ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>

              <div className="p-4 rounded-xl fs-pill-sage space-y-1">
                <div className="text-[11px] font-bold">IMPORTE TOTAL</div>
                <div className="text-xl font-extrabold font-mono-num">
                  S/ {formatFixed(resultado.importeTotal)}
                </div>
                <div className="text-[10px] opacity-80 font-mono-num">
                  {formatFixed(resultado.opGravada + resultado.opExonerada)} + {formatFixed(resultado.igvTotal)}
                </div>
              </div>
            </div>

            <div className="fs-inset px-3.5 py-2.5 text-xs font-semibold text-[var(--text-secondary)]">
              {resultado.montoEnLetras}
            </div>

            <button
              type="button"
              onClick={handleGuardarEnBandeja}
              disabled={resultado.importeTotal <= 0}
              className="fs-btn-sage w-full py-3.5 px-5 text-sm flex items-center justify-center gap-2 shadow-sm"
            >
              Registrar en Bandeja de Comprobantes
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
