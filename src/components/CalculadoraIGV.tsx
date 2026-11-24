import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  Check,
  CheckCircle2,
  Copy,
  HelpCircle,
  History,
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
  evaluateSafeMathExpr,
  formatFixed,
  formatMoney,
  roundSunat,
  simulateSunatDecimals,
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

interface HistorialEntry {
  id: string;
  hora: string;
  modo: ModoCalculoIGV;
  tasa: number;
  cantidad: number;
  total: number;
  baseExact: string;
  igvExact: string;
  vuSelected: string;
  decimales: number;
}

const DECIMAL_OPTIONS = [3, 4, 6, 8, 10] as const;

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
  const [decimales, setDecimales] = useState<number>(4); // 4 decimales por defecto para cuadre exacto SUNAT

  // Modo rápido (acepta expresiones como 120+85+45 o 3*80) + cantidad
  const [montoExpr, setMontoExpr] = useState<string>('250');
  const [cantidadUnica, setCantidadUnica] = useState<string>('1');
  const [esPrecioUnitarioUnico, setEsPrecioUnitarioUnico] = useState<boolean>(false);
  const [descuentoPct, setDescuentoPct] = useState<string>('0');
  const [recargoPct, setRecargoPct] = useState<string>('0');
  const [descUnica, setDescUnica] = useState<string>(
    config.conceptosRapidos[0] || 'Consumo de Alimentos y Bebidas'
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Sumador de múltiples ítems con edición en vivo
  const [lineas, setLineas] = useState<LineaCalc[]>([
    { id: 'l1', descripcion: 'Servicio Principal / Consumo', cantidad: 2, precioUnitario: 85 },
    { id: 'l2', descripcion: 'Adicional / Complemento', cantidad: 2, precioUnitario: 25 },
  ]);
  const [nuevaDesc, setNuevaDesc] = useState<string>('');
  const [nuevaCant, setNuevaCant] = useState<string>('1');
  const [nuevoPrecio, setNuevoPrecio] = useState<string>('');

  // Historial de cálculos de la sesión
  const [historial, setHistorial] = useState<HistorialEntry[]>([]);

  const montoEvaluado = useMemo(() => evaluateSafeMathExpr(montoExpr), [montoExpr]);
  const cantNum = useMemo(() => {
    const n = parseFloat(cantidadUnica);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [cantidadUnica]);
  const descPctNum = useMemo(() => Math.max(0, Math.min(99, parseFloat(descuentoPct) || 0)), [descuentoPct]);
  const recPctNum = useMemo(() => Math.max(0, Math.min(30, parseFloat(recargoPct) || 0)), [recargoPct]);

  const montoConDescuento = useMemo(() => {
    const bruto = esPrecioUnitarioUnico ? montoEvaluado * cantNum : montoEvaluado;
    return descPctNum > 0 ? bruto * (1 - descPctNum / 100) : bruto;
  }, [montoEvaluado, cantNum, esPrecioUnitarioUnico, descPctNum]);

  const itemsParaCalculo: ComprobanteItem[] = useMemo(() => {
    if (modoCalc === 'UN_TOTAL') {
      return [
        {
          id: 'single',
          unidad: 'ZZ',
          descripcion: descUnica || 'Prestación de servicios / Consumo',
          cantidad: cantNum,
          montoIngresado: roundSunat(montoConDescuento, 4),
          esTotalLinea: true,
          afectacion: tasaIgv > 0 ? '10' : '20',
        },
      ];
    }
    return lineas.map((l) => {
      const p = descPctNum > 0 ? l.precioUnitario * (1 - descPctNum / 100) : l.precioUnitario;
      return {
        id: l.id,
        unidad: 'ZZ',
        descripcion: l.descripcion || 'Ítem / Servicio',
        cantidad: l.cantidad > 0 ? l.cantidad : 1,
        montoIngresado: p > 0 ? p : 0,
        esTotalLinea: false,
        afectacion: tasaIgv > 0 ? '10' : '20',
      };
    });
  }, [modoCalc, descUnica, cantNum, montoConDescuento, lineas, tasaIgv, descPctNum]);

  const resultado = useMemo(
    () =>
      calculateComprobante({
        items: itemsParaCalculo,
        modoCalculo: modoIgv,
        tasaIgv,
        recargoConsumoPct: recPctNum,
        descuentoGlobal: 0,
        moneda: 'PEN',
      }),
    [itemsParaCalculo, modoIgv, tasaIgv, recPctNum]
  );

  // Precisión matemática exacta sin redondear a 2 decimales (para 3, 4, 6, 8, 10 decimales)
  const tasaDecimal = Math.max(0, tasaIgv) / 100;
  const exactStats = useMemo(() => {
    const totalObjetivo =
      modoCalc === 'UN_TOTAL'
        ? modoIgv === 'INCLUYE_IGV'
          ? roundSunat(montoConDescuento, 2)
          : roundSunat(montoConDescuento * (1 + tasaDecimal), 2)
        : resultado.importeTotal;

    const baseExactaTotal =
      modoIgv === 'INCLUYE_IGV'
        ? tasaDecimal > 0
          ? totalObjetivo / (1 + tasaDecimal)
          : totalObjetivo
        : modoCalc === 'UN_TOTAL'
          ? montoConDescuento
          : lineas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario * (1 - descPctNum / 100), 0);

    const igvExactoTotal = baseExactaTotal * tasaDecimal;
    const vuExactoSingle = baseExactaTotal / (modoCalc === 'UN_TOTAL' ? cantNum : 1);

    // Simulación SUNAT SOL en 2, 3, 4, 6 y 10 decimales
    const precisionChecks = [2, 3, 4, 6, 10].map((d) =>
      simulateSunatDecimals(
        vuExactoSingle,
        modoCalc === 'UN_TOTAL' ? cantNum : 1,
        tasaDecimal,
        totalObjetivo,
        d
      )
    );

    const selectedCheck = simulateSunatDecimals(
      vuExactoSingle,
      modoCalc === 'UN_TOTAL' ? cantNum : 1,
      tasaDecimal,
      totalObjetivo,
      decimales
    );

    return {
      totalObjetivo,
      baseExactaTotal,
      igvExactoTotal,
      vuExactoSingle,
      precisionChecks,
      selectedCheck,
    };
  }, [modoCalc, modoIgv, montoConDescuento, tasaDecimal, resultado.importeTotal, lineas, descPctNum, cantNum, decimales]);

  // Cálculo exacto por línea en modo Múltiples Ítems con los decimales elegidos
  const lineasDetalladas = useMemo(() => {
    return lineas.map((l) => {
      const precioEf = descPctNum > 0 ? l.precioUnitario * (1 - descPctNum / 100) : l.precioUnitario;
      const totalLineaObj =
        modoIgv === 'INCLUYE_IGV'
          ? roundSunat(precioEf * l.cantidad, 2)
          : roundSunat(precioEf * l.cantidad * (1 + tasaDecimal), 2);
      const vuExacto =
        modoIgv === 'INCLUYE_IGV'
          ? tasaDecimal > 0
            ? precioEf / (1 + tasaDecimal)
            : precioEf
          : precioEf;
      const check = simulateSunatDecimals(vuExacto, l.cantidad, tasaDecimal, totalLineaObj, decimales);
      return { ...l, precioEf, totalLineaObj, vuExacto, check };
    });
  }, [lineas, descPctNum, modoIgv, tasaDecimal, decimales]);

  const comparativaTasas = useMemo(() => {
    return [18, 10.5, 10, 15, 0].map((t) => {
      const td = t / 100;
      const totalBase =
        modoCalc === 'UN_TOTAL'
          ? montoConDescuento
          : lineas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario * (1 - descPctNum / 100), 0);
      const base = modoIgv === 'INCLUYE_IGV' ? totalBase / (1 + td) : totalBase;
      const igv = base * td;
      const total = base + igv;
      const vu = base / (modoCalc === 'UN_TOTAL' ? cantNum : 1);
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
        vuExact: vu.toFixed(decimales),
        baseExact: base.toFixed(decimales),
        igvExact: igv.toFixed(decimales),
        total2: roundSunat(total, 2),
      };
    });
  }, [modoCalc, montoConDescuento, lineas, descPctNum, modoIgv, cantNum, decimales]);

  const copyVal = async (key: string, val: string, saveToHistory = false) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);

      if (saveToHistory && exactStats.totalObjetivo > 0) {
        const entry: HistorialEntry = {
          id: crypto.randomUUID(),
          hora: new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          modo: modoIgv,
          tasa: tasaIgv,
          cantidad: modoCalc === 'UN_TOTAL' ? cantNum : lineas.length,
          total: exactStats.totalObjetivo,
          baseExact: exactStats.baseExactaTotal.toFixed(decimales),
          igvExact: exactStats.igvExactoTotal.toFixed(decimales),
          vuSelected: exactStats.selectedCheck.vuStr,
          decimales,
        };
        setHistorial((prev) => [entry, ...prev.slice(0, 14)]);
      }
    } catch {
      onNotify('No se pudo copiar al portapapeles.', 'error');
    }
  };

  const handleAddLinea = (e: React.FormEvent) => {
    e.preventDefault();
    const p = evaluateSafeMathExpr(nuevoPrecio);
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

  const updateLinea = (id: string, patch: Partial<LineaCalc>) => {
    setLineas((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const handleCopyResumenCompleto = () => {
    const lines = [
      `TOTAL: S/ ${formatFixed(exactStats.totalObjetivo)}`,
      `TASA IGV: ${tasaIgv}% (${modoIgv === 'INCLUYE_IGV' ? 'IGV Incluido' : 'Neto + IGV'})`,
      `VALOR UNITARIO (${decimales} dec): ${exactStats.selectedCheck.vuStr}`,
      `SUBTOTAL (${decimales} dec): ${exactStats.baseExactaTotal.toFixed(decimales)}  (2 dec: S/ ${formatFixed(resultado.opGravada)})`,
      `IGV (${decimales} dec): ${exactStats.igvExactoTotal.toFixed(decimales)}  (2 dec: S/ ${formatFixed(resultado.igvTotal)})`,
    ];
    copyVal('all_summary', lines.join('\n'), true);
    onNotify('Resumen exacto copiado al portapapeles.', 'success');
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
      recargoConsumoPct: recPctNum,
      descuentoGlobal: 0,
      formaPago: 'CONTADO',
      incluirRefFechaEnDesc: config.incluirRefFechaDefecto,
      observaciones: 'Generado desde Calculadora IGV Pro',
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
      {/* Barra Superior: Modo + Selector de Decimales (3, 4, 6, 8, 10) + Guía */}
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
            Calculadora Directa
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

        {/* Selector de Precisión Decimal */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-soft)]">
            <span className="text-[11px] font-bold text-[var(--text-muted)] px-2">Decimales:</span>
            {DECIMAL_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDecimales(d)}
                className={`cursor-pointer px-2.5 py-1 rounded-lg text-xs font-mono-num font-bold transition ${
                  decimales === d ? 'fs-pill-accent' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpenGuia}
            className="cursor-pointer px-3 py-2 rounded-xl fs-btn-soft text-xs flex items-center gap-1.5"
          >
            <HelpCircle className="w-3.5 h-3.5" style={{ color: 'var(--accent-text)' }} />
            Guía y S.O.S.
          </button>
        </div>
      </div>

      {/* Configuración IGV (Dentro vs Fuera + Tasa) */}
      <div className="fs-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setModoIgv('INCLUYE_IGV')}
            className={`cursor-pointer p-3.5 rounded-xl border text-left transition ${
              modoIgv === 'INCLUYE_IGV'
                ? 'fs-pill-sage'
                : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-xs sm:text-sm">IGV Incluido en el Total (Desglosar Base)</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-white/60 dark:bg-black/25">
                Mantiene Total
              </span>
            </div>
            <p className="text-[11px] opacity-85 mt-1">
              Extrae Base Imponible + IGV con <strong>{decimales} decimales</strong> manteniendo el total exacto.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setModoIgv('MAS_IGV')}
            className={`cursor-pointer p-3.5 rounded-xl border text-left transition ${
              modoIgv === 'MAS_IGV'
                ? 'fs-pill-sky'
                : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
            }`}
          >
            <div className="font-bold text-xs sm:text-sm">Importe Neto + IGV Adicional</div>
            <p className="text-[11px] opacity-85 mt-1">
              Aplica el porcentaje de IGV sobre la base neta ingresada.
            </p>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-xs font-bold text-[var(--text-secondary)] mr-1">Tasa IGV:</span>
          {TASAS_IGV_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => {
                setTasaIgv(p.value);
                setCustomTasa('');
              }}
              className={`cursor-pointer px-2.5 py-1.5 rounded-xl text-xs font-bold border transition ${
                tasaIgv === p.value && !customTasa
                  ? 'fs-pill-accent'
                  : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
              }`}
            >
              {p.value}% <span className="font-normal opacity-75">({p.badge})</span>
            </button>
          ))}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[var(--bg-inset)] border border-[var(--border-soft)]">
            <span className="text-xs text-[var(--text-muted)]">Otra %:</span>
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

      {/* Cuerpo 2 Columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* IZQUIERDA: ENTRADA + MULTI-ITEM + COMPARADOR */}
        <div className="lg:col-span-6 space-y-5">
          {modoCalc === 'UN_TOTAL' ? (
            <div className="fs-card p-5 space-y-4">
              <div className="grid grid-cols-12 gap-3 items-end">
                <div className="col-span-8 sm:col-span-9">
                  <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                    {modoIgv === 'INCLUYE_IGV'
                      ? esPrecioUnitarioUnico
                        ? 'Precio Unitario c/IGV (acepta sumas ej. 85+40)'
                        : 'Monto Total (acepta sumas ej. 120+85+45)'
                      : 'Monto Neto sin IGV (acepta expresiones)'}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-[var(--text-muted)] font-mono-num">
                      S/
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={montoExpr}
                      onChange={(e) => setMontoExpr(e.target.value)}
                      placeholder="Ej. 250 o 120+85+45"
                      className="fs-input w-full pl-11 pr-3 py-3 text-2xl font-extrabold font-mono-num"
                    />
                  </div>
                </div>
                <div className="col-span-4 sm:col-span-3">
                  <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                    Cantidad
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={cantidadUnica}
                    onChange={(e) => setCantidadUnica(e.target.value)}
                    className="fs-input w-full px-3 py-3 text-xl font-extrabold font-mono-num text-center"
                  />
                </div>
              </div>

              {/* Si el usuario ingresó una suma/operación, muestra el resultado evaluado */}
              {/[+\-*/xX×÷()]/.test(montoExpr) && (
                <div className="p-2.5 rounded-xl fs-pill-sky text-xs font-mono-num flex items-center justify-between">
                  <span>Expresión evaluada: <strong>{montoExpr}</strong></span>
                  <strong>= S/ {montoEvaluado.toFixed(4)}</strong>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={esPrecioUnitarioUnico}
                    onChange={(e) => setEsPrecioUnitarioUnico(e.target.checked)}
                    className="accent-[var(--accent-bg)]"
                  />
                  Multiplicar por cantidad ({cantNum} × S/ {formatFixed(montoEvaluado)})
                </label>

                <button
                  type="button"
                  onClick={() => {
                    setMontoExpr('');
                    setCantidadUnica('1');
                    setDescuentoPct('0');
                    setRecargoPct('0');
                  }}
                  className="cursor-pointer px-2.5 py-1 rounded-lg fs-pill-rose text-xs font-semibold flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Limpiar
                </button>
              </div>

              {/* Descuento y Recargo rápidos */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 border-t border-[var(--border-soft)]">
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">Descuento (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="99"
                    value={descuentoPct}
                    onChange={(e) => setDescuentoPct(e.target.value)}
                    className="fs-input w-full px-2.5 py-1.5 text-xs font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">Recargo Consumo (%)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="20"
                    value={recargoPct}
                    onChange={(e) => setRecargoPct(e.target.value)}
                    className="fs-input w-full px-2.5 py-1.5 text-xs font-mono-num"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">Concepto</label>
                  <input
                    type="text"
                    value={descUnica}
                    onChange={(e) => setDescUnica(e.target.value)}
                    className="fs-input w-full px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              {/* Botones de montos frecuentes */}
              <div className="flex flex-wrap items-center gap-1.5">
                {[50, 100, 150, 250, 380, 480, 750, 1200].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMontoExpr(String(v))}
                    className="cursor-pointer px-2.5 py-1 rounded-lg fs-btn-soft text-xs font-mono-num"
                  >
                    S/ {v}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* SUMADOR DE MÚLTIPLES ÍTEMS CON EDICIÓN EN VIVO */
            <div className="fs-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  Sumador Detallado ({decimales} decimales por ítem)
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
                    placeholder="Descripción"
                    className="fs-input w-full px-3 py-2 text-xs"
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <label className="block text-[11px] font-medium text-[var(--text-muted)] mb-1">Cant.</label>
                  <input
                    type="number"
                    min="0.01"
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
                    type="text"
                    inputMode="decimal"
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

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {lineasDetalladas.length === 0 ? (
                  <div className="fs-inset p-6 text-center text-xs text-[var(--text-muted)]">
                    Añade ítems para calcular su Valor Unitario exacto con {decimales} decimales.
                  </div>
                ) : (
                  lineasDetalladas.map((it, idx) => (
                    <div key={it.id} className="fs-inset p-3 space-y-2 text-xs">
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <input
                          type="text"
                          value={it.descripcion}
                          onChange={(e) => updateLinea(it.id, { descripcion: e.target.value })}
                          className="fs-input col-span-12 sm:col-span-6 px-2.5 py-1 text-xs font-semibold"
                        />
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          value={it.cantidad}
                          onChange={(e) =>
                            updateLinea(it.id, { cantidad: Math.max(0.01, parseFloat(e.target.value) || 1) })
                          }
                          className="fs-input col-span-4 sm:col-span-2 px-1.5 py-1 text-xs font-mono-num text-center"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={it.precioUnitario}
                          onChange={(e) =>
                            updateLinea(it.id, { precioUnitario: Math.max(0, parseFloat(e.target.value) || 0) })
                          }
                          className="fs-input col-span-6 sm:col-span-3 px-2 py-1 text-xs font-mono-num font-bold text-right"
                        />
                        <div className="col-span-2 sm:col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setLineas((prev) => prev.filter((x) => x.id !== it.id))}
                            className="cursor-pointer p-1 rounded hover:bg-[var(--rose-soft)]"
                            style={{ color: 'var(--rose-text)' }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border-soft)] font-mono-num text-[11px]">
                        <div className="text-[var(--text-secondary)]">
                          V.U. ({decimales} dec):{' '}
                          <strong style={{ color: 'var(--accent-text)' }}>{it.check.vuStr}</strong> · Base:{' '}
                          {it.check.valorVentaExact.toFixed(decimales)} · IGV: {it.check.igvExact.toFixed(decimales)}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold" style={{ color: 'var(--sage-text)' }}>
                            S/ {formatFixed(it.totalLineaObj)}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyVal(`item_${idx}`, it.check.vuStr)}
                            className="cursor-pointer px-2 py-0.5 rounded-lg fs-pill-accent text-[10px] font-bold font-sans"
                          >
                            {copiedKey === `item_${idx}` ? '✓ Copiado' : 'Copiar V.U.'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Comparativa Rápida por Tasa con los Decimales Elegidos */}
          <div className="fs-card p-5 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">
              Comparativa por Tasa de IGV ({decimales} decimales)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[11px] text-[var(--text-muted)] border-b border-[var(--border-soft)]">
                  <tr>
                    <th className="py-2">Tasa</th>
                    <th className="py-2 text-right">Valor Unit.</th>
                    <th className="py-2 text-right">Base Exacta</th>
                    <th className="py-2 text-right">IGV Exacto</th>
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
                        <td className="py-2 px-1.5 font-sans font-semibold text-[var(--text-primary)] whitespace-nowrap">
                          {row.etiqueta}
                        </td>
                        <td className="py-2 text-right font-bold" style={{ color: 'var(--accent-text)' }}>
                          {row.vuExact}
                        </td>
                        <td className="py-2 text-right text-[var(--text-secondary)]">{row.baseExact}</td>
                        <td className="py-2 text-right" style={{ color: 'var(--sky-text)' }}>
                          {row.igvExact}
                        </td>
                        <td className="py-2 px-1.5 text-right font-bold" style={{ color: 'var(--sage-text)' }}>
                          S/ {formatFixed(row.total2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* DERECHA: RESULTADO DE ALTA PRECISIÓN + SIMULADOR SUNAT 2/3/4/6/10 DECIMALES */}
        <div className="lg:col-span-6 space-y-5">
          <div className="fs-card p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-secondary)]">
                Resultado Exacto ({decimales} decimales)
              </span>
              {exactStats.selectedCheck.cuadraExacto ? (
                <span className="text-[11px] px-2.5 py-1 rounded-full fs-pill-sage font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Cuadra exacto en SUNAT (S/ {formatFixed(exactStats.selectedCheck.totalSunat)})
                </span>
              ) : (
                <span className="text-[11px] px-2.5 py-1 rounded-full fs-pill-peach font-bold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Con {decimales} dec. difiere {exactStats.selectedCheck.diferencia > 0 ? '+' : ''}
                  {formatFixed(exactStats.selectedCheck.diferencia)} — prueba {decimales < 6 ? '6' : '8'} dec.
                </span>
              )}
            </div>

            {/* CAJA PRINCIPAL: VALOR UNITARIO CON N DECIMALES */}
            <div className="p-5 rounded-2xl fs-pill-accent space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">
                  {modoCalc === 'UN_TOTAL'
                    ? `Valor Unitario SIN IGV (${decimales} decimales) — Copiar a SUNAT:`
                    : `Base Imponible Total SIN IGV (${decimales} decimales):`}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyVal(
                      'main_vu',
                      modoCalc === 'UN_TOTAL'
                        ? exactStats.selectedCheck.vuStr
                        : exactStats.baseExactaTotal.toFixed(decimales),
                      true
                    )
                  }
                  className="fs-btn-primary px-3.5 py-2 text-xs flex items-center gap-1.5 shadow-sm"
                >
                  {copiedKey === 'main_vu' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'main_vu' ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <div className="text-3xl sm:text-4xl font-extrabold font-mono-num tracking-tight break-all">
                {modoCalc === 'UN_TOTAL'
                  ? exactStats.selectedCheck.vuStr
                  : exactStats.baseExactaTotal.toFixed(decimales)}
              </div>
              <div className="text-[11px] opacity-85 font-mono-num">
                Comprobación SUNAT: {exactStats.selectedCheck.vuStr} × {modoCalc === 'UN_TOTAL' ? cantNum : 1} = Base S/{' '}
                {formatFixed(exactStats.selectedCheck.valorVenta2)} + IGV S/{' '}
                {formatFixed(exactStats.selectedCheck.igv2)} ={' '}
                <strong>S/ {formatFixed(exactStats.selectedCheck.totalSunat)}</strong>
              </div>
            </div>

            {/* 3 TARJETAS CON VALOR EXACTO (N DECIMALES) + REDONDEO CONTABLE (2 DEC) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="fs-inset p-3.5 space-y-1">
                <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase">
                  Subtotal ({decimales} dec)
                </div>
                <div className="text-lg font-extrabold font-mono-num text-[var(--text-primary)]">
                  {exactStats.baseExactaTotal.toFixed(decimales)}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--text-muted)] font-mono-num">
                    2 dec: S/ {formatFixed(resultado.opGravada + resultado.opExonerada)}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyVal('sub_exact', exactStats.baseExactaTotal.toFixed(decimales), true)}
                    className="cursor-pointer font-bold hover:underline"
                    style={{ color: 'var(--accent-text)' }}
                  >
                    {copiedKey === 'sub_exact' ? '✓' : 'Copiar'}
                  </button>
                </div>
              </div>

              <div className="p-3.5 rounded-xl fs-pill-sky space-y-1">
                <div className="text-[10px] font-bold uppercase">IGV {tasaIgv}% ({decimales} dec)</div>
                <div className="text-lg font-extrabold font-mono-num">
                  {exactStats.igvExactoTotal.toFixed(decimales)}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="opacity-80 font-mono-num">2 dec: S/ {formatFixed(resultado.igvTotal)}</span>
                  <button
                    type="button"
                    onClick={() => copyVal('igv_exact', exactStats.igvExactoTotal.toFixed(decimales), true)}
                    className="cursor-pointer font-bold hover:underline"
                  >
                    {copiedKey === 'igv_exact' ? '✓' : 'Copiar'}
                  </button>
                </div>
              </div>

              <div className="p-3.5 rounded-xl fs-pill-sage space-y-1">
                <div className="text-[10px] font-bold uppercase">Total Final SUNAT</div>
                <div className="text-lg font-extrabold font-mono-num">
                  S/ {formatFixed(resultado.importeTotal)}
                </div>
                <div className="text-[11px] opacity-80 font-mono-num">
                  {formatFixed(resultado.opGravada + resultado.opExonerada)} + {formatFixed(resultado.igvTotal)}
                </div>
              </div>
            </div>

            {/* SIMULADOR DE PRECISIÓN SUNAT: 2 vs 3 vs 4 vs 6 vs 10 DECIMALES */}
            <div className="fs-inset p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
                  Prueba de Cuadre Exacto por Cantidad de Decimales
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">Clic para copiar</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono-num">
                  <thead className="text-[var(--text-muted)] border-b border-[var(--border-soft)]">
                    <tr>
                      <th className="py-1.5 text-left font-sans">Precisión</th>
                      <th className="py-1.5 text-right">Valor Unit.</th>
                      <th className="py-1.5 text-right">Total SUNAT</th>
                      <th className="py-1.5 text-center font-sans">Cuadre</th>
                      <th className="py-1.5 text-right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-soft)]">
                    {exactStats.precisionChecks.map((chk) => (
                      <tr
                        key={chk.decimals}
                        style={chk.decimals === decimales ? { backgroundColor: 'var(--accent-soft)' } : undefined}
                      >
                        <td className="py-1.5 font-sans font-bold text-[var(--text-primary)]">
                          {chk.decimals} dec.
                        </td>
                        <td className="py-1.5 text-right font-bold text-[var(--text-primary)]">
                          {chk.vuStr}
                        </td>
                        <td className="py-1.5 text-right">S/ {formatFixed(chk.totalSunat)}</td>
                        <td className="py-1.5 text-center font-sans font-bold">
                          {chk.cuadraExacto ? (
                            <span style={{ color: 'var(--sage-text)' }}>✓ Exacto</span>
                          ) : (
                            <span style={{ color: 'var(--rose-text)' }}>
                              ✗ {chk.diferencia > 0 ? '+' : ''}
                              {formatFixed(chk.diferencia)}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setDecimales(chk.decimals >= 3 ? chk.decimals : 4);
                              copyVal(`prec_${chk.decimals}`, chk.vuStr, true);
                            }}
                            className="cursor-pointer px-2 py-0.5 rounded fs-btn-soft text-[10px] font-sans"
                          >
                            {copiedKey === `prec_${chk.decimals}` ? '✓' : 'Copiar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="fs-inset px-3.5 py-2 text-[11px] font-semibold text-[var(--text-secondary)]">
              {resultado.montoEnLetras}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleCopyResumenCompleto}
                className="fs-btn-soft py-3 px-4 text-xs flex items-center justify-center gap-1.5"
              >
                {copiedKey === 'all_summary' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                Copiar Desglose Completo
              </button>
              <button
                type="button"
                onClick={handleGuardarEnBandeja}
                disabled={resultado.importeTotal <= 0}
                className="fs-btn-sage py-3 px-4 text-xs flex items-center justify-center gap-1.5 shadow-sm"
              >
                Enviar a Bandeja
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Historial de cálculos de esta sesión */}
          {historial.length > 0 && (
            <div className="fs-card p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" style={{ color: 'var(--accent-text)' }} />
                  Últimos Cálculos Copiados ({historial.length})
                </span>
                <button
                  type="button"
                  onClick={() => setHistorial([])}
                  className="cursor-pointer text-[11px] text-[var(--text-muted)] hover:underline"
                >
                  Limpiar
                </button>
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {historial.map((h) => (
                  <div
                    key={h.id}
                    className="fs-inset px-3 py-2 text-[11px] font-mono-num flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <span className="text-[var(--text-muted)] mr-2">{h.hora}</span>
                      <strong style={{ color: 'var(--sage-text)' }}>S/ {formatFixed(h.total)}</strong>
                      <span className="text-[var(--text-muted)] mx-1.5">({h.tasa}%)</span>
                      <span>
                        V.U.: <strong style={{ color: 'var(--accent-text)' }}>{h.vuSelected}</strong>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyVal(`hist_${h.id}`, h.vuSelected)}
                      className="cursor-pointer text-[10px] font-sans font-bold hover:underline"
                      style={{ color: 'var(--accent-text)' }}
                    >
                      {copiedKey === `hist_${h.id}` ? '✓ Copiado' : 'Copiar V.U.'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
