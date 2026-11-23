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
  Sparkles,
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
    config.conceptosRapidos[0] || 'Consumo de Alimentos y Bebidas - Peña Show'
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Modo Sumador de Varios Precios de una Boleta Escrita
  const [lineas, setLineas] = useState<LineaCalc[]>([
    { id: 'l1', descripcion: 'Cena Show Turístico', cantidad: 2, precioUnitario: 85 },
    { id: 'l2', descripcion: 'Pisco Sour / Bebidas', cantidad: 2, precioUnitario: 25 },
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
          descripcion: descUnica || 'Consumo Peña Show',
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
      descripcion: l.descripcion || 'Consumo Peña Show',
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

  // Comparador instantáneo con 18%, 10.5% (MYPE 2026) y 10%
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
            ? '18% (General)'
            : t === 10.5
              ? '10.5% (MYPE 2026)'
              : t === 10
                ? '10% (MYPE Ant.)'
                : t === 15
                  ? '15% (MYPE 2027)'
                  : '0% (Exonerado)',
        base: c.opGravada + c.opExonerada,
        igv: c.igvTotal,
        total: c.importeTotal,
        vuExacto: c.items[0]?.valorUnitarioSunatStr || '0.00',
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
      onNotify('Escribe un precio mayor a 0.', 'error');
      return;
    }
    setLineas((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        descripcion: nuevaDesc.trim() || `Consumo / Plato #${prev.length + 1}`,
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
      onNotify('Ingresa al menos un monto mayor a S/ 0.00.', 'error');
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
      observaciones: 'Enviado desde Calculadora IGV',
      items: itemsParaCalculo.map((it) => ({ ...it, id: crypto.randomUUID() })),
      estado: 'PENDIENTE',
      creadoEn: now,
      actualizadoEn: now,
    };
    onSendToBandeja(rec);
    onNotify(
      `Boleta de ${formatMoney(resultado.importeTotal)} enviada a tu Bandeja (puedes editar fecha/RUC o emitirla directo).`,
      'success'
    );
  };

  return (
    <div className="space-y-6">
      {/* Banner de Orientación Clara para la Laptop del Dueño */}
      <div className="bg-gradient-to-r from-amber-500/15 via-slate-900 to-emerald-500/15 border border-amber-500/35 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs font-extrabold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            NO NECESITAS API NI CONTRASEÑAS — Trabajas directo con el Portal SUNAT ya abierto en la laptop del dueño
          </div>
          <p className="text-xs text-slate-300">
            Orden recomendado mañana: <strong>① Calcula aquí (o guarda en Captura)</strong> →{' '}
            <strong>② Pega el Valor Unitario en Portal SUNAT SOL y descarga el PDF</strong> →{' '}
            <strong>③ Arrastra los PDFs a Carpetas PDF para ordenarlos solos por Fecha/Empresa</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenGuia}
          className="cursor-pointer px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shrink-0 shadow"
        >
          <HelpCircle className="w-4 h-4" />
          Ver Guía Paso a Paso y Qué Hacer si me Equivoco
        </button>
      </div>

      {/* Selector de Sub-Modo de Calculadora */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Calculator className="w-5 h-5 text-amber-400" />
            Calculadora Exacta de IGV SUNAT (Reemplaza la Calculadora Manual)
          </h2>
          <p className="text-sm text-slate-400">
            Pon el monto total de la boleta escrita (o suma varios precios) y obtén al instante el <strong>Valor Unitario exacto sin IGV</strong> para pegar en SUNAT sin errores de céntimos.
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setModoCalc('UN_TOTAL')}
            className={`cursor-pointer px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              modoCalc === 'UN_TOTAL'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Calculator className="w-3.5 h-3.5" />
            1 Monto Total (Súper Rápido)
          </button>
          <button
            type="button"
            onClick={() => setModoCalc('VARIOS_PRECIOS')}
            className={`cursor-pointer px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              modoCalc === 'VARIOS_PRECIOS'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <ListPlus className="w-3.5 h-3.5" />
            Sumar Varios Precios de una Boleta
          </button>
        </div>
      </div>

      {/* Controles Globales: Posición del IGV (Dentro vs Fuera) y Tasa (%) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setModoIgv('INCLUYE_IGV')}
            className={`cursor-pointer p-3.5 rounded-xl border text-left transition ${
              modoIgv === 'INCLUYE_IGV'
                ? 'bg-emerald-500/15 border-emerald-400 text-white ring-1 ring-emerald-400/40'
                : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-sm">✓ El IGV va DENTRO del Total (Recomendado Peña Show)</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                MANTIENE EL TOTAL
              </span>
            </div>
            <p className="text-xs opacity-80 mt-1">
              Si la boleta escrita dice <strong>S/ 100.00</strong>, en SUNAT seguirá saliendo <strong>S/ 100.00 exactos</strong> (Base S/ 84.75 + IGV S/ 15.25 adentro).
            </p>
          </button>

          <button
            type="button"
            onClick={() => setModoIgv('MAS_IGV')}
            className={`cursor-pointer p-3.5 rounded-xl border text-left transition ${
              modoIgv === 'MAS_IGV'
                ? 'bg-sky-500/15 border-sky-400 text-white ring-1 ring-sky-400/40'
                : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <div className="font-bold text-sm">El IGV se SUMA FUERA del Total (+IGV adicional)</div>
            <p className="text-xs opacity-80 mt-1">
              Solo úsalo si el dueño te indica agregar IGV encima del precio escrito (ej. S/ 100 + 18% = S/ 118.00).
            </p>
          </button>
        </div>

        {/* Selector de Porcentaje */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs font-bold text-slate-300 mr-1">Porcentaje IGV:</span>
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
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow'
                  : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-500'
              }`}
            >
              {p.value}% <span className="font-normal opacity-80">({p.badge})</span>
            </button>
          ))}
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5">
            <span className="text-xs text-slate-400">Otro %:</span>
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
      </div>

      {/* Cuerpo Principal: Entrada Izquierda + Resultado Gigante Derecha */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* IZQUIERDA: ENTRADA DE PRECIOS */}
        <div className="lg:col-span-6 space-y-4">
          {modoCalc === 'UN_TOTAL' ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
              <div>
                <label className="block text-sm font-bold text-amber-300 mb-2">
                  {modoIgv === 'INCLUYE_IGV'
                    ? 'Escribe el MONTO TOTAL anotado en la boleta escrita (S/):'
                    : 'Escribe el MONTO NETO sin IGV (S/):'}
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-slate-500 font-mono-num">
                    S/
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={montoUnico}
                    onChange={(e) => setMontoUnico(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-14 pr-4 py-4 rounded-2xl bg-slate-950 border-2 border-amber-500/60 text-3xl font-extrabold font-mono-num text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
                {/* Botones rápidos de montos típicos */}
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  <span className="text-[11px] text-slate-400 mr-1">Prueba rápida:</span>
                  {[50, 100, 150, 250, 480, 750, 1200].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setMontoUnico(String(v))}
                      className="cursor-pointer px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono-num font-semibold"
                    >
                      S/ {v}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setMontoUnico('')}
                    className="cursor-pointer px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold flex items-center gap-1 ml-auto"
                  >
                    <RotateCcw className="w-3 h-3" /> Borrar
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Concepto / Descripción (para cuando quieras guardarla en Bandeja):
                </label>
                <input
                  type="text"
                  value={descUnica}
                  onChange={(e) => setDescUnica(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:border-amber-400 focus:outline-none"
                />
              </div>

              {/* Fórmula explicada en español simple */}
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 space-y-1.5">
                <div className="font-bold text-amber-300">¿Qué operación hace exactamente el sistema?</div>
                {modoIgv === 'INCLUYE_IGV' ? (
                  <>
                    <p>
                      Como el IGV de <strong>{tasaIgv}%</strong> va <strong>dentro</strong> del total, se divide entre{' '}
                      <code className="text-emerald-300 font-bold">{(1 + tasaIgv / 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}</code>:
                    </p>
                    <p className="font-mono-num text-slate-200">
                      Base = {formatFixed(resultado.importeTotal)} ÷ {(1 + tasaIgv / 100).toFixed(3).replace(/0+$/, '')} ={' '}
                      <strong className="text-white">S/ {formatFixed(resultado.opGravada)}</strong>
                    </p>
                    <p className="font-mono-num text-slate-200">
                      IGV ({tasaIgv}%) = {formatFixed(resultado.importeTotal)} − {formatFixed(resultado.opGravada)} ={' '}
                      <strong className="text-sky-300">S/ {formatFixed(resultado.igvTotal)}</strong>
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Como el IGV de <strong>{tasaIgv}%</strong> se suma <strong>fuera</strong> del monto neto:
                    </p>
                    <p className="font-mono-num text-slate-200">
                      IGV = {formatFixed(resultado.opGravada)} × {tasaIgv}% = <strong className="text-sky-300">S/ {formatFixed(resultado.igvTotal)}</strong>
                    </p>
                    <p className="font-mono-num text-slate-200">
                      Total Final = {formatFixed(resultado.opGravada)} + {formatFixed(resultado.igvTotal)} ={' '}
                      <strong className="text-emerald-400">S/ {formatFixed(resultado.importeTotal)}</strong>
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* MODO SUMADOR DE VARIOS PRECIOS */
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-amber-300">
                  Agrega cada precio anotado en la boleta física:
                </h3>
                {lineas.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setLineas([])}
                    className="text-xs text-rose-400 hover:underline flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Vaciar lista
                  </button>
                )}
              </div>

              <form onSubmit={handleAddLinea} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-12 sm:col-span-5">
                  <label className="block text-[11px] text-slate-400 mb-1">Plato / Bebida / Concepto</label>
                  <input
                    type="text"
                    value={nuevaDesc}
                    onChange={(e) => setNuevaDesc(e.target.value)}
                    placeholder="Ej. Cena Show, Pisco Sour..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <label className="block text-[11px] text-slate-400 mb-1">Cant.</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={nuevaCant}
                    onChange={(e) => setNuevaCant(e.target.value)}
                    className="w-full px-2 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-mono-num text-center"
                  />
                </div>
                <div className="col-span-5 sm:col-span-3">
                  <label className="block text-[11px] text-amber-300 font-semibold mb-1">
                    Precio c/u (S/)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={nuevoPrecio}
                    onChange={(e) => setNuevoPrecio(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-2.5 py-2 rounded-xl bg-slate-950 border border-amber-500/60 text-xs text-amber-200 font-mono-num font-bold text-right focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div className="col-span-3 sm:col-span-2">
                  <button
                    type="submit"
                    className="cursor-pointer w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Sumar
                  </button>
                </div>
              </form>

              {/* Lista detallada con Valor Unitario SUNAT por cada ítem */}
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {resultado.items.length === 0 ? (
                  <div className="text-center text-xs text-slate-500 py-8 border border-dashed border-slate-800 rounded-xl">
                    Agrega precios arriba para sumarlos y ver el desglose exacto de cada línea.
                  </div>
                ) : (
                  resultado.items.map((it, idx) => (
                    <div
                      key={it.id}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-white truncate">
                          {it.cantidad} × {it.descripcion}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono-num mt-0.5">
                          Val. Unit. SUNAT (sin IGV):{' '}
                          <strong className="text-amber-300">{it.valorUnitarioSunatStr}</strong> · Base:{' '}
                          S/ {formatFixed(it.valorVenta)} · IGV: S/ {formatFixed(it.igvLinea)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono-num font-bold text-emerald-400">
                          S/ {formatFixed(it.totalLinea)}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyVal(`item_${idx}`, it.valorUnitarioSunatStr)}
                          className="cursor-pointer px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-bold"
                          title="Copiar Valor Unitario sin IGV para SUNAT SOL"
                        >
                          {copiedKey === `item_${idx}` ? '✓' : 'Copiar VU'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setLineas((prev) => prev.filter((x) => x.id !== it.id))}
                          className="p-1 text-rose-400 hover:bg-rose-500/15 rounded"
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

          {/* Tabla Comparativa Instantánea de Todos los Porcentajes */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2.5">
            <div className="text-xs font-bold text-slate-300">
              Comparativa Instantánea (si el dueño cambia de porcentaje en el momento):
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[11px] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-1.5">Tasa</th>
                    <th className="py-1.5 text-right">Base (Sin IGV)</th>
                    <th className="py-1.5 text-right">IGV</th>
                    <th className="py-1.5 text-right">Total Final</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono-num">
                  {comparativaTasas.map((row) => (
                    <tr
                      key={row.tasa}
                      onClick={() => {
                        setTasaIgv(row.tasa);
                        setCustomTasa('');
                      }}
                      className={`cursor-pointer transition ${
                        row.tasa === tasaIgv
                          ? 'bg-amber-500/15 text-white font-bold'
                          : 'hover:bg-slate-800/40 text-slate-300'
                      }`}
                    >
                      <td className="py-2 font-sans">{row.etiqueta}</td>
                      <td className="py-2 text-right">S/ {formatFixed(row.base)}</td>
                      <td className="py-2 text-right text-sky-300">S/ {formatFixed(row.igv)}</td>
                      <td className="py-2 text-right text-emerald-400">S/ {formatFixed(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* DERECHA: RESULTADOS GIGANTES LISTOS PARA COPIAR A SUNAT */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-amber-500/40 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                Resultado Exacto Listo para Portal SUNAT SOL
              </span>
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Cuadra Exacto al Céntimo
              </span>
            </div>

            {/* CAJA #1: LO QUE SE PEGA EN SUNAT SOL */}
            <div className="p-5 rounded-2xl bg-amber-500/15 border border-amber-400/60 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-amber-200">
                  {modoCalc === 'UN_TOTAL'
                    ? 'PEGA ESTE NÚMERO EN "VALOR UNITARIO" EN SUNAT SOL:'
                    : 'VALOR TOTAL SIN IGV (O COPIA CADA ÍTEM A LA IZQUIERDA):'}
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
                  className="cursor-pointer px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5 shadow"
                >
                  {copiedKey === 'main_vu' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copiedKey === 'main_vu' ? '¡Copiado!' : 'COPIAR'}
                </button>
              </div>
              <div className="text-4xl font-black font-mono-num text-amber-300 tracking-tight">
                {modoCalc === 'UN_TOTAL'
                  ? resultado.items[0]?.valorUnitarioSunatStr || '0.00'
                  : formatFixed(resultado.opGravada)}
              </div>
              <p className="text-xs text-amber-100/80">
                En Portal SUNAT SOL, cuando agregues el ítem, pega exactamente este número en{' '}
                <strong>Valor Unitario</strong>. SUNAT le aplicará automáticamente el{' '}
                <strong>{tasaIgv}%</strong> y te mostrará el Total Final exacto de{' '}
                <strong>{formatMoney(resultado.importeTotal)}</strong>.
              </p>
            </div>

            {/* 3 TARJETAS CLARAS: SUBTOTAL, IGV, TOTAL */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="text-[11px] text-slate-400 font-semibold">SUBTOTAL (SIN IGV)</div>
                <div className="text-xl font-extrabold font-mono-num text-white">
                  S/ {formatFixed(resultado.opGravada + resultado.opExonerada)}
                </div>
                <button
                  type="button"
                  onClick={() => copyVal('sub', formatFixed(resultado.opGravada + resultado.opExonerada))}
                  className="text-[11px] text-amber-400 hover:underline"
                >
                  {copiedKey === 'sub' ? '✓ Copiado' : 'Copiar subtotal'}
                </button>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-sky-500/30 space-y-1">
                <div className="text-[11px] text-sky-300 font-bold">IGV ({tasaIgv}%) INCLUIDO</div>
                <div className="text-xl font-extrabold font-mono-num text-sky-300">
                  S/ {formatFixed(resultado.igvTotal)}
                </div>
                <button
                  type="button"
                  onClick={() => copyVal('igv', formatFixed(resultado.igvTotal))}
                  className="text-[11px] text-sky-400 hover:underline"
                >
                  {copiedKey === 'igv' ? '✓ Copiado' : 'Copiar IGV'}
                </button>
              </div>

              <div className="p-4 rounded-xl bg-emerald-500/15 border border-emerald-500/40 space-y-1">
                <div className="text-[11px] text-emerald-300 font-bold">TOTAL FINAL SUNAT</div>
                <div className="text-xl font-extrabold font-mono-num text-emerald-400">
                  S/ {formatFixed(resultado.importeTotal)}
                </div>
                <div className="text-[10px] text-emerald-200/80">
                  {formatFixed(resultado.opGravada + resultado.opExonerada)} + {formatFixed(resultado.igvTotal)}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 font-semibold">
              {resultado.montoEnLetras}
            </div>

            <button
              type="button"
              onClick={handleGuardarEnBandeja}
              disabled={resultado.importeTotal <= 0}
              className="cursor-pointer w-full py-3.5 px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg disabled:opacity-40 transition"
            >
              Guardar este Cálculo en mi Bandeja de Emisión
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
