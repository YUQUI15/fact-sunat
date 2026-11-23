import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Code2,
  Copy,
  Edit3,
  FileDown,
  Filter,
  Layers,
  Paperclip,
  Rocket,
  Scale,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  ComprobanteRecord,
  EmpresaEmisoraConfig,
  EstadoComprobante,
  ModoCalculoIGV,
} from '../types/sunat';
import { calculateComprobante, formatFixed, formatMoney, roundSunat } from '../lib/sunatMath';
import { getHoyPeruISO, validarComprobanteSunat } from '../lib/sunatValidators';
import { getTipoNombreCorto } from '../lib/folderOrganizer';
import { generateUbl21Xml } from '../lib/sunatUblXml';
import { generateConstanciaInternaPdfBlob, triggerDownload } from '../lib/exporters';

interface BandejaComprobantesProps {
  comprobantes: ComprobanteRecord[];
  config: EmpresaEmisoraConfig;
  onEdit: (rec: ComprobanteRecord) => void;
  onEmitSingle: (id: string) => void;
  onDeleteMany: (ids: string[]) => void;
  onBulkUpdate: (ids: string[], updater: (rec: ComprobanteRecord) => ComprobanteRecord) => void;
  onConsolidate: (ids: string[]) => void;
  onDuplicate: (rec: ComprobanteRecord) => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const ESTADO_STYLE: Record<EstadoComprobante, string> = {
  PENDIENTE: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  EN_PROCESO: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  EMITIDO: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  ARCHIVADO: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  ANULADO: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export const BandejaComprobantes: React.FC<BandejaComprobantesProps> = ({
  comprobantes,
  config,
  onEdit,
  onEmitSingle,
  onDeleteMany,
  onBulkUpdate,
  onConsolidate,
  onDuplicate,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState<string>('ALL');
  const [filterEstado, setFilterEstado] = useState<string>('ALL');
  const [filterMes, setFilterMes] = useState<string>('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [totalFisicoPapel, setTotalFisicoPapel] = useState<string>('');

  const mesesDisponibles = useMemo(() => {
    const set = new Set<string>();
    comprobantes.forEach((c) => {
      if (c.fechaConsumo) set.add(c.fechaConsumo.slice(0, 7));
    });
    return Array.from(set).sort().reverse();
  }, [comprobantes]);

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    return comprobantes
      .filter((r) => {
        if (filterTipo !== 'ALL' && r.tipoComprobante !== filterTipo) return false;
        if (filterEstado !== 'ALL' && r.estado !== filterEstado) return false;
        if (filterMes !== 'ALL' && !r.fechaConsumo.startsWith(filterMes)) return false;
        if (!q) return true;
        return (
          r.notaInterna.toLowerCase().includes(q) ||
          r.razonSocialCliente.toLowerCase().includes(q) ||
          r.numeroDocCliente.toLowerCase().includes(q) ||
          `${r.serieSunat}-${r.numeroSunat}`.toLowerCase().includes(q) ||
          r.items.some((i) => i.descripcion.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => a.fechaConsumo.localeCompare(b.fechaConsumo) || a.notaInterna.localeCompare(b.notaInterna));
  }, [comprobantes, search, filterTipo, filterEstado, filterMes]);

  const totalesFiltrados = useMemo(() => {
    return filtrados
      .filter((r) => r.estado !== 'ANULADO')
      .reduce(
        (acc, r) => {
          const c = calculateComprobante(r);
          return {
            gravada: roundSunat(acc.gravada + c.opGravada, 2),
            igv: roundSunat(acc.igv + c.igvTotal, 2),
            total: roundSunat(acc.total + c.importeTotal, 2),
          };
        },
        { gravada: 0, igv: 0, total: 0 }
      );
  }, [filtrados]);

  const fisicoNum = parseFloat(totalFisicoPapel);
  const diffFisico = Number.isFinite(fisicoNum)
    ? roundSunat(totalesFiltrados.total - fisicoNum, 2)
    : null;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtrados.length && filtrados.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtrados.map((f) => f.id));
    }
  };

  const handleBulkTasa = (nuevaTasa: number) => {
    if (!selectedIds.length) return;
    onBulkUpdate(selectedIds, (r) => ({
      ...r,
      tasaIgv: nuevaTasa,
      items: r.items.map((it) => ({ ...it, afectacion: nuevaTasa === 0 ? '20' : '10' })),
      actualizadoEn: new Date().toISOString(),
    }));
    onNotify(`Tasa IGV cambiada a ${nuevaTasa}% en ${selectedIds.length} comprobantes.`, 'success');
  };

  const handleBulkModo = (modo: ModoCalculoIGV) => {
    if (!selectedIds.length) return;
    onBulkUpdate(selectedIds, (r) => ({
      ...r,
      modoCalculo: modo,
      actualizadoEn: new Date().toISOString(),
    }));
    onNotify(`Modo de cálculo actualizado en ${selectedIds.length} comprobantes.`, 'success');
  };

  const handleBulkFechaHoy = () => {
    if (!selectedIds.length) return;
    const hoy = getHoyPeruISO();
    onBulkUpdate(selectedIds, (r) => ({
      ...r,
      fechaEmisionSunat: hoy,
      actualizadoEn: new Date().toISOString(),
    }));
    onNotify(`Fecha de Emisión SUNAT ajustada a hoy (${hoy}) en ${selectedIds.length} registros.`, 'success');
  };

  const handleConsolidar = () => {
    if (selectedIds.length < 2) {
      onNotify('Selecciona al menos 2 notas para consolidarlas en 1 sola factura o boleta.', 'info');
      return;
    }
    onConsolidate(selectedIds);
    setSelectedIds([]);
  };

  const handleDownloadXml = (rec: ComprobanteRecord) => {
    const xml = generateUbl21Xml(rec, config);
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const name = `${rec.serieSunat || 'DOC'}-${rec.numeroSunat || rec.notaInterna}.xml`;
    triggerDownload(blob, name);
  };

  const handleDownloadDraftPdf = (rec: ComprobanteRecord) => {
    const blob = generateConstanciaInternaPdfBlob(rec, config);
    triggerDownload(blob, `BORRADOR_${rec.notaInterna || rec.id.slice(0, 6)}.pdf`);
  };

  return (
    <div className="space-y-5">
      {/* Cabecera + Verificador de Cuadre Físico vs Sistema */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nota, RUC, empresa, serie o concepto..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:border-amber-400 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500 hidden sm:block" />
            <select
              value={filterTipo}
              onChange={(e) => setFilterTipo(e.target.value)}
              className="px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200"
            >
              <option value="ALL">Todos los tipos</option>
              <option value="01">Solo Facturas</option>
              <option value="03">Solo Boletas</option>
              <option value="07">Notas Crédito</option>
            </select>

            <select
              value={filterEstado}
              onChange={(e) => setFilterEstado(e.target.value)}
              className="px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200"
            >
              <option value="ALL">Todos los estados</option>
              <option value="PENDIENTE">Pendientes</option>
              <option value="EMITIDO">Emitidos SUNAT</option>
              <option value="ARCHIVADO">Con PDF Archivado</option>
              <option value="ANULADO">Anulados</option>
            </select>

            <select
              value={filterMes}
              onChange={(e) => setFilterMes(e.target.value)}
              className="px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200"
            >
              <option value="ALL">Todos los meses</option>
              {mesesDisponibles.map((m) => (
                <option key={m} value={m}>
                  Mes {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cuadre Rápido contra las boletas físicas en papel */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <div className="text-xs font-bold text-white">Cuadre vs Boletas Físicas</div>
              <div className="text-[11px] text-slate-400">
                Sistema: <strong className="text-emerald-300 font-mono-num">S/ {formatFixed(totalesFiltrados.total)}</strong>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              value={totalFisicoPapel}
              onChange={(e) => setTotalFisicoPapel(e.target.value)}
              placeholder="Suma papel S/"
              className="w-32 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-sm font-mono-num text-white text-right focus:border-amber-400 focus:outline-none"
            />
            {diffFisico !== null && (
              <span
                className={`text-xs font-bold px-2.5 py-1.5 rounded-xl font-mono-num ${
                  Math.abs(diffFisico) < 0.005
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                }`}
              >
                {Math.abs(diffFisico) < 0.005
                  ? '✓ CUADRA 0.00'
                  : `Dif: ${diffFisico > 0 ? '+' : ''}${formatFixed(diffFisico)}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Barra de Acciones Masivas cuando hay seleccionados */}
      {selectedIds.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-bold text-amber-200">
            {selectedIds.length} comprobante(s) seleccionado(s):
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleConsolidar}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5" />
              Consolidar en 1 Comprobante
            </button>
            <button
              type="button"
              onClick={handleBulkFechaHoy}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1"
            >
              <CalendarCheck className="w-3.5 h-3.5" />
              F. Emisión = Hoy
            </button>
            <button
              type="button"
              onClick={() => handleBulkTasa(18)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
            >
              Pasar a 18%
            </button>
            <button
              type="button"
              onClick={() => handleBulkTasa(10.5)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
            >
              Pasar a 10.5%
            </button>
            <button
              type="button"
              onClick={() => handleBulkModo('INCLUYE_IGV')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
            >
              Mantener Total
            </button>
            <button
              type="button"
              onClick={() => handleBulkModo('MAS_IGV')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
            >
              Neto + IGV
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`¿Eliminar ${selectedIds.length} comprobante(s) seleccionado(s)?`)) {
                  onDeleteMany(selectedIds);
                  setSelectedIds([]);
                }
              }}
              className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Eliminar
            </button>
          </div>
        </div>
      )}

      {/* Tabla Maestra */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3 w-8">
                  <input
                    type="checkbox"
                    checked={filtrados.length > 0 && selectedIds.length === filtrados.length}
                    onChange={toggleSelectAll}
                    className="accent-amber-500"
                  />
                </th>
                <th className="p-2.5">Nota / Fechas</th>
                <th className="p-2.5">Tipo / Serie</th>
                <th className="p-2.5">Cliente / RUC-DNI</th>
                <th className="p-2.5 text-right">Val. Unit. SOL</th>
                <th className="p-2.5 text-right">Base / IGV</th>
                <th className="p-2.5 text-right">Total</th>
                <th className="p-2.5">Estado</th>
                <th className="p-2.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-slate-400">
                    No hay comprobantes que coincidan con los filtros. Ingresa notas en <strong>Captura Rápida</strong> o carga datos de ejemplo.
                  </td>
                </tr>
              ) : (
                filtrados.map((rec) => {
                  const calc = calculateComprobante(rec);
                  const alertas = validarComprobanteSunat(rec, comprobantes);
                  const errCount = alertas.filter((a) => a.nivel === 'error').length;
                  const warnCount = alertas.filter((a) => a.nivel === 'warning').length;
                  const isSel = selectedIds.includes(rec.id);

                  return (
                    <tr
                      key={rec.id}
                      className={`hover:bg-slate-800/40 transition ${isSel ? 'bg-amber-500/5' : ''}`}
                    >
                      <td className="p-2.5">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleSelect(rec.id)}
                          className="accent-amber-500"
                        />
                      </td>
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-bold text-amber-300 font-mono-num">
                          {rec.notaInterna || '-'}
                          {rec.notasConsolidadas && rec.notasConsolidadas.length > 1 && (
                            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                              ×{rec.notasConsolidadas.length}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-300 font-mono-num">
                          {rec.fechaConsumo}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono-num">
                          SOL: {rec.fechaEmisionSunat}
                        </div>
                      </td>
                      <td className="p-2.5 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            rec.tipoComprobante === '01'
                              ? 'bg-sky-500/20 text-sky-300'
                              : rec.tipoComprobante === '03'
                                ? 'bg-purple-500/20 text-purple-300'
                                : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {getTipoNombreCorto(rec.tipoComprobante)}
                        </span>
                        <div className="font-mono-num text-slate-200 mt-1 text-[11px]">
                          {rec.serieSunat && rec.numeroSunat
                            ? `${rec.serieSunat}-${rec.numeroSunat}`
                            : `${rec.serieSunat || 'E001'}-Pend.`}
                        </div>
                      </td>
                      <td className="p-2.5 max-w-[180px]">
                        <div className="font-semibold text-white truncate" title={rec.razonSocialCliente}>
                          {rec.razonSocialCliente || 'CLIENTES VARIOS'}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono-num">
                          {rec.numeroDocCliente || '-'}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate" title={rec.items[0]?.descripcion}>
                          {rec.items[0]?.descripcion} {rec.items.length > 1 ? `(+${rec.items.length - 1})` : ''}
                        </div>
                      </td>
                      <td className="p-2.5 text-right font-mono-num whitespace-nowrap">
                        <div className="text-amber-300 font-semibold">
                          {calc.items[0]?.valorUnitarioSunatStr}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {rec.modoCalculo === 'INCLUYE_IGV' ? 'Desgl.' : '+IGV'} {calc.tasaIgvPorcentaje}%
                        </div>
                      </td>
                      <td className="p-2.5 text-right font-mono-num whitespace-nowrap">
                        <div className="text-slate-200">B: {formatFixed(calc.opGravada)}</div>
                        <div className="text-[11px] text-sky-300">I: {formatFixed(calc.igvTotal)}</div>
                      </td>
                      <td className="p-2.5 text-right font-mono-num font-bold text-emerald-400 text-sm whitespace-nowrap">
                        {formatMoney(calc.importeTotal, rec.moneda)}
                      </td>
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${ESTADO_STYLE[rec.estado]}`}
                          >
                            {rec.estado}
                          </span>
                          {rec.pdfAdjunto?.esOficialSunat && (
                            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                              <Paperclip className="w-3 h-3" /> PDF
                            </span>
                          )}
                          {errCount > 0 ? (
                            <span
                              className="text-[10px] text-rose-400 flex items-center gap-1 font-semibold"
                              title={alertas.map((a) => a.mensaje).join('\n')}
                            >
                              <AlertTriangle className="w-3 h-3" /> {errCount} err.
                            </span>
                          ) : warnCount > 0 ? (
                            <span
                              className="text-[10px] text-amber-300 flex items-center gap-1"
                              title={alertas.map((a) => a.mensaje).join('\n')}
                            >
                              <AlertTriangle className="w-3 h-3" /> {warnCount} av.
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-400/80 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> OK
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-2.5 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEmitSingle(rec.id)}
                            className="p-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300"
                            title="Abrir en Estación de Emisión SUNAT"
                          >
                            <Rocket className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEdit(rec)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                            title="Editar comprobante"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDuplicate(rec)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                            title="Duplicar nota"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadDraftPdf(rec)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300"
                            title="Descargar Hoja de Trabajo PDF"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadXml(rec)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300"
                            title="Descargar XML UBL 2.1 SUNAT"
                          >
                            <Code2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filtrados.length > 0 && (
              <tfoot className="bg-slate-950 border-t border-slate-800 font-bold text-xs">
                <tr>
                  <td colSpan={5} className="p-2.5 text-slate-300">
                    TOTAL FILTRADO ({filtrados.filter((r) => r.estado !== 'ANULADO').length} activos)
                  </td>
                  <td className="p-2.5 text-right font-mono-num">
                    <div className="text-white">B: {formatFixed(totalesFiltrados.gravada)}</div>
                    <div className="text-sky-300 text-[11px]">I: {formatFixed(totalesFiltrados.igv)}</div>
                  </td>
                  <td className="p-2.5 text-right font-mono-num text-emerald-400 text-sm">
                    S/ {formatFixed(totalesFiltrados.total)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
