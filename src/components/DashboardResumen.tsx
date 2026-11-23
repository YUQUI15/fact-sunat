import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
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

  const maxRowTotal = useMemo(() => Math.max(1, ...groupedRows.map((g) => g.total)), [groupedRows]);
  const pctEmitido = kpis.totalDocs ? Math.round((kpis.emitidos / kpis.totalDocs) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Acciones de Exportación */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={!activos.length}
          onClick={() => downloadExcelContable(comprobantes, config, usarFechaSunat ? 'EMISION_SUNAT' : 'CONSUMO')}
          className="fs-btn-sage px-4 py-2 text-xs flex items-center gap-1.5"
        >
          <FileSpreadsheet className="w-4 h-4" />
          Exportar Excel Contable (6 hojas)
        </button>
        <button
          type="button"
          disabled={!activos.length}
          onClick={() => {
            const blob = generateReporteEjecutivoPdfBlob(comprobantes, config);
            triggerDownload(blob, `Reporte_Ejecutivo_SUNAT_${new Date().toISOString().slice(0, 10)}.pdf`);
          }}
          className="cursor-pointer px-4 py-2 rounded-xl fs-pill-sky text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
        >
          <FileText className="w-4 h-4" />
          Reporte Ejecutivo PDF
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="fs-card p-5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] flex items-center justify-between">
            Total Facturado
            <TrendingUp className="w-4 h-4" style={{ color: 'var(--sage-text)' }} />
          </div>
          <div className="text-2xl font-extrabold font-mono-num mt-2" style={{ color: 'var(--sage-text)' }}>
            S/ {formatFixed(kpis.total)}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1">
            {kpis.facturas} Facturas · {kpis.boletas} Boletas ({kpis.totalDocs})
          </div>
        </div>

        <div className="fs-card p-5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] flex items-center justify-between">
            Base Imponible
            <Receipt className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
          </div>
          <div className="text-2xl font-extrabold font-mono-num text-[var(--text-primary)] mt-2">
            S/ {formatFixed(kpis.gravada)}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1">Operaciones gravadas sin IGV</div>
        </div>

        <div className="p-5 rounded-2xl fs-pill-sky">
          <div className="text-[11px] font-bold uppercase tracking-wide flex items-center justify-between">
            IGV Consolidado
            <Building2 className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold font-mono-num mt-2">S/ {formatFixed(kpis.igv)}</div>
          <div className="text-[11px] opacity-80 mt-1">Impuesto total del periodo</div>
        </div>

        <div className="fs-card p-5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] flex items-center justify-between">
            Avance de Emisión
            <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--sage-text)' }} />
          </div>
          <div className="text-2xl font-extrabold font-mono-num text-[var(--text-primary)] mt-2">
            {kpis.emitidos} / {kpis.totalDocs}{' '}
            <span className="text-sm font-semibold text-[var(--text-muted)]">({pctEmitido}%)</span>
          </div>
          <div className="w-full h-2 bg-[var(--bg-inset)] rounded-full overflow-hidden mt-2">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pctEmitido}%`, backgroundColor: 'var(--sage-bg)' }}
            />
          </div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1.5">
            {kpis.archivados} PDF oficial · {auditoriaList.length} observaciones
          </div>
        </div>
      </div>

      {/* Agrupaciones y Auditoría */}
      <div className="fs-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'DIA', label: 'Por Día' },
                { id: 'SEMANA', label: 'Por Semana' },
                { id: 'MES', label: 'Por Mes' },
                { id: 'EMPRESA', label: 'Por Cliente / Empresa' },
                { id: 'AUDITORIA', label: `Auditoría SUNAT (${auditoriaList.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setGroupTab(t.id)}
                className={`cursor-pointer px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                  groupTab === t.id ? 'fs-pill-accent' : 'fs-btn-soft'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {groupTab !== 'AUDITORIA' && groupTab !== 'EMPRESA' && (
            <label className="text-xs text-[var(--text-secondary)] flex items-center gap-2 cursor-pointer">
              <CalendarDays className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
              <input
                type="checkbox"
                checked={usarFechaSunat}
                onChange={(e) => setUsarFechaSunat(e.target.checked)}
                className="accent-[var(--accent-bg)]"
              />
              Agrupar por Fecha Emisión SUNAT
            </label>
          )}
        </div>

        {groupTab === 'AUDITORIA' ? (
          <div className="space-y-2.5">
            {auditoriaList.length === 0 ? (
              <div className="p-8 text-center rounded-xl fs-pill-sage">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
                <strong>Sin observaciones tributarias.</strong> Todos los comprobantes cumplen las validaciones SUNAT.
              </div>
            ) : (
              auditoriaList.map(({ rec, alertas }) => (
                <div
                  key={rec.id}
                  className="fs-inset p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" style={{ color: 'var(--peach-text)' }} />
                      {rec.notaInterna} — {rec.razonSocialCliente} ({rec.fechaConsumo})
                    </div>
                    {alertas.map((a, idx) => (
                      <div
                        key={idx}
                        className="text-xs"
                        style={{ color: a.nivel === 'error' ? 'var(--rose-text)' : 'var(--peach-text)' }}
                      >
                        • {a.mensaje} {a.sugerencia ? `(${a.sugerencia})` : ''}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => onJumpToEdit(rec)}
                    className="fs-btn-primary px-3.5 py-2 text-xs"
                  >
                    Corregir
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[var(--bg-inset)] text-[var(--text-muted)] uppercase border-b border-[var(--border-soft)]">
                <tr>
                  <th className="p-3">Agrupación</th>
                  <th className="p-3 text-center">Docs</th>
                  <th className="p-3 text-center">Fact / Bol</th>
                  <th className="p-3 text-right">Base Gravada</th>
                  <th className="p-3 text-right">IGV</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 w-36">Participación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-soft)]">
                {groupedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-[var(--text-muted)]">
                      Sin datos registrados todavía.
                    </td>
                  </tr>
                ) : (
                  groupedRows.map((row) => {
                    const widthPct = Math.max(4, Math.round((row.total / maxRowTotal) * 100));
                    return (
                      <tr key={row.label} className="hover:bg-[var(--bg-hover)]">
                        <td className="p-3 font-bold text-[var(--text-primary)]">{row.label}</td>
                        <td className="p-3 text-center font-mono-num">{row.count}</td>
                        <td className="p-3 text-center font-mono-num text-[var(--text-muted)]">
                          {row.facturas}F / {row.boletas}B
                        </td>
                        <td className="p-3 text-right font-mono-num">S/ {formatFixed(row.gravada)}</td>
                        <td className="p-3 text-right font-mono-num" style={{ color: 'var(--sky-text)' }}>
                          S/ {formatFixed(row.igv)}
                        </td>
                        <td className="p-3 text-right font-mono-num font-bold" style={{ color: 'var(--sage-text)' }}>
                          S/ {formatFixed(row.total)}
                        </td>
                        <td className="p-3">
                          <div className="w-full h-2 bg-[var(--bg-inset)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${widthPct}%`, backgroundColor: 'var(--accent-bg)' }}
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
