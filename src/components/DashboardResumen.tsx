import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import type { ComprobanteRecord, EmpresaEmisoraConfig } from '../types/sunat';
import { calculateComprobante, formatFixed, roundSunat } from '../lib/sunatMath';
import { getFechaJerarquia } from '../lib/folderOrganizer';
import { validarComprobanteSunat } from '../lib/sunatValidators';
import {
  downloadExcelContable,
  generateReporteEjecutivoPdfBlob,
  triggerDownload,
} from '../lib/exporters';

interface DashboardResumenProps {
  comprobantes: ComprobanteRecord[];
  config: EmpresaEmisoraConfig;
  onJumpToEdit: (rec: ComprobanteRecord) => void;
}

type GroupTab = 'DIA' | 'SEMANA' | 'MES' | 'EMPRESA' | 'AUDITORIA';

interface GroupRow {
  label: string;
  count: number;
  facturas: number;
  boletas: number;
  gravada: number;
  igv: number;
  total: number;
}

export const DashboardResumen: React.FC<DashboardResumenProps> = ({
  comprobantes,
  config,
  onJumpToEdit,
}) => {
  const [groupTab, setGroupTab] = useState<GroupTab>('DIA');
  const [usarFechaSunat, setUsarFechaSunat] = useState<boolean>(false);

  const activos = useMemo(() => comprobantes.filter((c) => c.estado !== 'ANULADO'), [comprobantes]);

  const kpis = useMemo(() => {
    let total = 0;
    let gravada = 0;
    let igv = 0;
    let facturas = 0;
    let boletas = 0;
    let emitidos = 0;
    let archivados = 0;

    for (const r of activos) {
      const c = calculateComprobante(r);
      total = roundSunat(total + c.importeTotal, 2);
      gravada = roundSunat(gravada + c.opGravada, 2);
      igv = roundSunat(igv + c.igvTotal, 2);
      if (r.tipoComprobante === '01') facturas++;
      if (r.tipoComprobante === '03') boletas++;
      if (r.estado === 'EMITIDO' || r.estado === 'ARCHIVADO') emitidos++;
      if (r.pdfAdjunto?.esOficialSunat) archivados++;
    }
    return { total, gravada, igv, facturas, boletas, emitidos, archivados, totalDocs: activos.length };
  }, [activos]);

  const auditoriaList = useMemo(() => {
    return activos
      .map((rec) => ({
        rec,
        alertas: validarComprobanteSunat(rec, comprobantes),
      }))
      .filter((x) => x.alertas.some((a) => a.nivel === 'error' || a.nivel === 'warning'));
  }, [activos, comprobantes]);

  const groupedRows = useMemo<GroupRow[]>(() => {
    const map = new Map<string, GroupRow>();
    for (const r of activos) {
      const fecha = usarFechaSunat ? r.fechaEmisionSunat : r.fechaConsumo;
      const jer = getFechaJerarquia(fecha);
      let key = jer.diaCarpeta;
      if (groupTab === 'SEMANA') key = `${jer.anio} / ${jer.semanaCarpeta}`;
      else if (groupTab === 'MES') key = `${jer.anio} / ${jer.mesCarpeta}`;
      else if (groupTab === 'EMPRESA')
        key = `${r.razonSocialCliente || 'CLIENTES VARIOS'}${
          r.numeroDocCliente && r.numeroDocCliente !== '-' ? ` (${r.numeroDocCliente})` : ''
        }`;

      const calc = calculateComprobante(r);
      const curr = map.get(key) || {
        label: key,
        count: 0,
        facturas: 0,
        boletas: 0,
        gravada: 0,
        igv: 0,
        total: 0,
      };
      curr.count++;
      if (r.tipoComprobante === '01') curr.facturas++;
      if (r.tipoComprobante === '03') curr.boletas++;
      curr.gravada = roundSunat(curr.gravada + calc.opGravada, 2);
      curr.igv = roundSunat(curr.igv + calc.igvTotal, 2);
      curr.total = roundSunat(curr.total + calc.importeTotal, 2);
      map.set(key, curr);
    }
    const arr = Array.from(map.values());
    return groupTab === 'EMPRESA'
      ? arr.sort((a, b) => b.total - a.total)
      : arr.sort((a, b) => a.label.localeCompare(b.label));
  }, [activos, groupTab, usarFechaSunat]);

  const maxRowTotal = useMemo(
    () => Math.max(1, ...groupedRows.map((g) => g.total)),
    [groupedRows]
  );

  const pctEmitido = kpis.totalDocs ? Math.round((kpis.emitidos / kpis.totalDocs) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-400" />
            Dashboard Ejecutivo y Cierre Tributario Mensual
          </h2>
          <p className="text-sm text-slate-400">
            Control total del IGV a declarar en SUNAT, avance de emisión y resúmenes listos para entregar al dueño o contador.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!activos.length}
            onClick={() => downloadExcelContable(comprobantes, config, usarFechaSunat ? 'EMISION_SUNAT' : 'CONSUMO')}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 disabled:opacity-40"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Exportar Excel Contable (6 hojas)
          </button>
          <button
            type="button"
            disabled={!activos.length}
            onClick={() => {
              const blob = generateReporteEjecutivoPdfBlob(comprobantes, config);
              triggerDownload(blob, `Reporte_Ejecutivo_PenaShow_${new Date().toISOString().slice(0, 10)}.pdf`);
            }}
            className="px-4 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-bold text-xs flex items-center gap-1.5 disabled:opacity-40"
          >
            <FileText className="w-4 h-4" />
            Reporte Ejecutivo PDF
          </button>
        </div>
      </div>

      {/* KPIs Principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-medium flex items-center justify-between">
            IMPORTE TOTAL FACTURADO
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-extrabold font-mono-num text-emerald-400 mt-2">
            S/ {formatFixed(kpis.total)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {kpis.facturas} Facturas · {kpis.boletas} Boletas ({kpis.totalDocs} total)
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-medium flex items-center justify-between">
            BASE IMPONIBLE (OP. GRAVADA)
            <Receipt className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-extrabold font-mono-num text-white mt-2">
            S/ {formatFixed(kpis.gravada)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Ingreso neto real sin impuestos</div>
        </div>

        <div className="bg-slate-900/90 border border-sky-500/30 rounded-2xl p-5">
          <div className="text-xs text-sky-300 font-bold flex items-center justify-between">
            IGV TOTAL A DECLARAR SUNAT
            <Building2 className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-extrabold font-mono-num text-sky-300 mt-2">
            S/ {formatFixed(kpis.igv)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Calculado exacto al céntimo</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-medium flex items-center justify-between">
            AVANCE DE EMISIÓN Y PDFs
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-extrabold font-mono-num text-amber-300 mt-2">
            {kpis.emitidos} / {kpis.totalDocs}{' '}
            <span className="text-sm font-semibold text-slate-400">({pctEmitido}%)</span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all"
              style={{ width: `${pctEmitido}%` }}
            />
          </div>
          <div className="text-[11px] text-slate-400 mt-1.5">
            {kpis.archivados} con PDF oficial SUNAT · {auditoriaList.length} con avisos
          </div>
        </div>
      </div>

      {/* Selector de Agrupación */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'DIA', label: 'Por Día' },
                { id: 'SEMANA', label: 'Por Semana' },
                { id: 'MES', label: 'Por Mes' },
                { id: 'EMPRESA', label: 'Por Empresa / Agencia' },
                { id: 'AUDITORIA', label: `Auditoría SUNAT (${auditoriaList.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setGroupTab(t.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                  groupTab === t.id
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {groupTab !== 'AUDITORIA' && groupTab !== 'EMPRESA' && (
            <label className="text-xs text-slate-400 flex items-center gap-2 cursor-pointer">
              <CalendarDays className="w-4 h-4 text-amber-400" />
              <input
                type="checkbox"
                checked={usarFechaSunat}
                onChange={(e) => setUsarFechaSunat(e.target.checked)}
                className="accent-amber-500"
              />
              Agrupar por Fecha Emisión SUNAT (en vez de Fecha Consumo)
            </label>
          )}
        </div>

        {groupTab === 'AUDITORIA' ? (
          <div className="space-y-2.5">
            {auditoriaList.length === 0 ? (
              <div className="p-8 text-center text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
                <strong>¡Cero errores tributarios!</strong> Todos tus comprobantes cumplen las reglas SUNAT.
              </div>
            ) : (
              auditoriaList.map(({ rec, alertas }) => (
                <div
                  key={rec.id}
                  className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-white flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      Nota {rec.notaInterna} — {rec.razonSocialCliente} ({rec.fechaConsumo})
                    </div>
                    {alertas.map((a, idx) => (
                      <div
                        key={idx}
                        className={`text-xs ${a.nivel === 'error' ? 'text-rose-300' : 'text-amber-200'}`}
                      >
                        • {a.mensaje} {a.sugerencia ? `(${a.sugerencia})` : ''}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => onJumpToEdit(rec)}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
                  >
                    Corregir ahora
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-3">Agrupación</th>
                  <th className="p-3 text-center">Docs</th>
                  <th className="p-3 text-center">Fact / Bol</th>
                  <th className="p-3 text-right">Base Gravada</th>
                  <th className="p-3 text-right">IGV</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 w-40">Participación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {groupedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      Sin datos registrados todavía.
                    </td>
                  </tr>
                ) : (
                  groupedRows.map((row) => {
                    const widthPct = Math.max(4, Math.round((row.total / maxRowTotal) * 100));
                    return (
                      <tr key={row.label} className="hover:bg-slate-800/30">
                        <td className="p-3 font-semibold text-white">{row.label}</td>
                        <td className="p-3 text-center font-mono-num">{row.count}</td>
                        <td className="p-3 text-center font-mono-num text-slate-400">
                          {row.facturas}F / {row.boletas}B
                        </td>
                        <td className="p-3 text-right font-mono-num">S/ {formatFixed(row.gravada)}</td>
                        <td className="p-3 text-right font-mono-num text-sky-300">S/ {formatFixed(row.igv)}</td>
                        <td className="p-3 text-right font-mono-num font-bold text-emerald-400">
                          S/ {formatFixed(row.total)}
                        </td>
                        <td className="p-3">
                          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400 rounded-full"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
