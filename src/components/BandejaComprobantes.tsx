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

const ESTADO_CLASS: Record<EstadoComprobante, string> = {
  PENDIENTE: 'fs-pill-peach',
  EN_PROCESO: 'fs-pill-sky',
  EMITIDO: 'fs-pill-accent',
  ARCHIVADO: 'fs-pill-sage',
  ANULADO: 'fs-pill-rose',
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
    onNotify(`Tasa IGV actualizada a ${nuevaTasa}% en ${selectedIds.length} comprobante(s).`, 'success');
  };

  const handleBulkModo = (modo: ModoCalculoIGV) => {
    if (!selectedIds.length) return;
    onBulkUpdate(selectedIds, (r) => ({
      ...r,
      modoCalculo: modo,
      actualizadoEn: new Date().toISOString(),
    }));
    onNotify(`Modo de cálculo actualizado en ${selectedIds.length} comprobante(s).`, 'success');
  };

  const handleBulkFechaHoy = () => {
    if (!selectedIds.length) return;
    const hoy = getHoyPeruISO();
    onBulkUpdate(selectedIds, (r) => ({
      ...r,
      fechaEmisionSunat: hoy,
      actualizadoEn: new Date().toISOString(),
    }));
    onNotify(`Fecha de Emisión SUNAT ajustada a ${hoy} en ${selectedIds.length} registro(s).`, 'success');
  };

  const handleConsolidar = () => {
    if (selectedIds.length < 2) {
      onNotify('Selecciona al menos 2 registros para consolidarlos en 1 comprobante.', 'info');
      return;
    }
    onConsolidate(selectedIds);
    setSelectedIds([]);
  };

  const handleDownloadXml = (rec: ComprobanteRecord) => {
    const xml = generateUbl21Xml(rec, config);
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    triggerDownload(blob, `${rec.serieSunat || 'DOC'}-${rec.numeroSunat || rec.notaInterna}.xml`);
  };

  const handleDownloadDraftPdf = (rec: ComprobanteRecord) => {
    const blob = generateConstanciaInternaPdfBlob(rec, config);
    triggerDownload(blob, `BORRADOR_${rec.notaInterna || rec.id.slice(0, 6)}.pdf`);
  };

  return (
    <div className="space-y-5">
      {/* Filtros + Verificador de Cuadre */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-7 fs-card p-4 flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[190px]">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nota, RUC, cliente, serie..."
              className="fs-input w-full pl-9 pr-3 py-2 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--text-muted)] hidden sm:block" />
            <select
              value={filterTipo}
              onChange={(e) => setFilterTipo(e.target.value)}
              className="fs-input px-2.5 py-2 text-xs"
            >
              <option value="ALL">Todos los tipos</option>
              <option value="01">Facturas</option>
              <option value="03">Boletas</option>
              <option value="07">Notas Crédito</option>
            </select>

            <select
              value={filterEstado}
              onChange={(e) => setFilterEstado(e.target.value)}
              className="fs-input px-2.5 py-2 text-xs"
            >
              <option value="ALL">Todos los estados</option>
              <option value="PENDIENTE">Pendientes</option>
              <option value="EMITIDO">Emitidos</option>
              <option value="ARCHIVADO">Con PDF</option>
              <option value="ANULADO">Anulados</option>
            </select>

            <select
              value={filterMes}
              onChange={(e) => setFilterMes(e.target.value)}
              className="fs-input px-2.5 py-2 text-xs"
            >
              <option value="ALL">Todos los meses</option>
              {mesesDisponibles.map((m) => (
                <option key={m} value={m}>
                  Periodo {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="lg:col-span-5 fs-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Scale className="w-5 h-5 shrink-0" style={{ color: 'var(--accent-text)' }} />
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)]">Cuadre vs Documentos Físicos</div>
              <div className="text-[11px] text-[var(--text-muted)]">
                Sistema:{' '}
                <strong className="font-mono-num" style={{ color: 'var(--sage-text)' }}>
                  S/ {formatFixed(totalesFiltrados.total)}
                </strong>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              value={totalFisicoPapel}
              onChange={(e) => setTotalFisicoPapel(e.target.value)}
              placeholder="Total físico S/"
              className="fs-input w-32 px-3 py-1.5 text-xs font-mono-num text-right"
            />
            {diffFisico !== null && (
              <span
                className={`text-xs font-bold px-2.5 py-1.5 rounded-xl font-mono-num ${
                  Math.abs(diffFisico) < 0.005 ? 'fs-pill-sage' : 'fs-pill-rose'
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

      {/* Acciones en Lote */}
      {selectedIds.length > 0 && (
        <div className="p-3.5 rounded-2xl fs-pill-accent flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-extrabold">{selectedIds.length} comprobante(s) seleccionado(s):</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleConsolidar}
              className="fs-btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5" />
              Consolidar en 1
            </button>
            <button
              type="button"
              onClick={handleBulkFechaHoy}
              className="cursor-pointer px-3 py-1.5 rounded-lg fs-pill-sage text-xs font-bold flex items-center gap-1"
            >
              <CalendarCheck className="w-3.5 h-3.5" />
              F. Emisión = Hoy
            </button>
            <button type="button" onClick={() => handleBulkTasa(18)} className="fs-btn-soft px-2.5 py-1.5 text-xs">
              IGV 18%
            </button>
            <button type="button" onClick={() => handleBulkTasa(10.5)} className="fs-btn-soft px-2.5 py-1.5 text-xs">
              IGV 10.5%
            </button>
            <button
              type="button"
              onClick={() => handleBulkModo('INCLUYE_IGV')}
              className="fs-btn-soft px-2.5 py-1.5 text-xs"
            >
              IGV Incluido
            </button>
            <button
              type="button"
              onClick={() => handleBulkModo('MAS_IGV')}
              className="fs-btn-soft px-2.5 py-1.5 text-xs"
            >
              Neto + IGV
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`¿Eliminar ${selectedIds.length} registro(s) seleccionado(s)?`)) {
                  onDeleteMany(selectedIds);
                  setSelectedIds([]);
                }
              }}
              className="cursor-pointer px-2.5 py-1.5 rounded-lg fs-pill-rose text-xs font-bold flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Eliminar
            </button>
          </div>
        </div>
      )}

      {/* Tabla Maestra */}
      <div className="fs-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--bg-inset)] text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-soft)]">
              <tr>
                <th className="p-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={filtrados.length > 0 && selectedIds.length === filtrados.length}
                    onChange={toggleSelectAll}
                    className="accent-[var(--accent-bg)]"
                  />
                </th>
                <th className="p-2.5">Ref / Fechas</th>
                <th className="p-2.5">Tipo / Serie</th>
                <th className="p-2.5">Cliente / Documento</th>
                <th className="p-2.5 text-right">V.U. SUNAT</th>
                <th className="p-2.5 text-right">Base / IGV</th>
                <th className="p-2.5 text-right">Total</th>
                <th className="p-2.5">Estado</th>
                <th className="p-2.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-soft)]">
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-[var(--text-muted)]">
                    No hay comprobantes registrados. Agrega notas en <strong>Registro de Notas</strong> o desde <strong>Calculadora IGV</strong>.
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
                      className="hover:bg-[var(--bg-hover)] transition"
                      style={isSel ? { backgroundColor: 'var(--accent-soft)' } : undefined}
                    >
                      <td className="p-2.5">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleSelect(rec.id)}
                          className="accent-[var(--accent-bg)]"
                        />
                      </td>
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-bold font-mono-num" style={{ color: 'var(--accent-text)' }}>
                          {rec.notaInterna || '-'}
                          {rec.notasConsolidadas && rec.notasConsolidadas.length > 1 && (
                            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded fs-pill-sky">
                              ×{rec.notasConsolidadas.length}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] font-mono-num">
                          {rec.fechaConsumo}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono-num">
                          SOL: {rec.fechaEmisionSunat}
                        </div>
                      </td>
                      <td className="p-2.5 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            rec.tipoComprobante === '01'
                              ? 'fs-pill-sky'
                              : rec.tipoComprobante === '03'
                                ? 'fs-pill-accent'
                                : 'fs-pill-rose'
                          }`}
                        >
                          {getTipoNombreCorto(rec.tipoComprobante)}
                        </span>
                        <div className="font-mono-num text-[var(--text-primary)] mt-1 text-[11px]">
                          {rec.serieSunat && rec.numeroSunat
                            ? `${rec.serieSunat}-${rec.numeroSunat}`
                            : `${rec.serieSunat || 'E001'}-Pend.`}
                        </div>
                      </td>
                      <td className="p-2.5 max-w-[180px]">
                        <div className="font-bold text-[var(--text-primary)] truncate" title={rec.razonSocialCliente}>
                          {rec.razonSocialCliente || 'CLIENTES VARIOS'}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] font-mono-num">
                          {rec.numeroDocCliente || '-'}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] truncate">
                          {rec.items[0]?.descripcion} {rec.items.length > 1 ? `(+${rec.items.length - 1})` : ''}
                        </div>
                      </td>
                      <td className="p-2.5 text-right font-mono-num whitespace-nowrap">
                        <div className="font-bold" style={{ color: 'var(--accent-text)' }}>
                          {calc.items[0]?.valorUnitarioSunatStr}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {rec.modoCalculo === 'INCLUYE_IGV' ? 'Incl.' : '+IGV'} {calc.tasaIgvPorcentaje}%
                        </div>
                      </td>
                      <td className="p-2.5 text-right font-mono-num whitespace-nowrap">
                        <div className="text-[var(--text-primary)]">B: {formatFixed(calc.opGravada)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--sky-text)' }}>
                          I: {formatFixed(calc.igvTotal)}
                        </div>
                      </td>
                      <td
                        className="p-2.5 text-right font-mono-num font-extrabold text-sm whitespace-nowrap"
                        style={{ color: 'var(--sage-text)' }}
                      >
                        {formatMoney(calc.importeTotal, rec.moneda)}
                      </td>
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ESTADO_CLASS[rec.estado]}`}>
                            {rec.estado}
                          </span>
                          {rec.pdfAdjunto?.esOficialSunat && (
                            <span className="text-[10px] font-semibold flex items-center gap-1" style={{ color: 'var(--sage-text)' }}>
                              <Paperclip className="w-3 h-3" /> PDF
                            </span>
                          )}
                          {errCount > 0 ? (
                            <span
                              className="text-[10px] flex items-center gap-1 font-bold"
                              style={{ color: 'var(--rose-text)' }}
                              title={alertas.map((a) => a.mensaje).join('\n')}
                            >
                              <AlertTriangle className="w-3 h-3" /> {errCount} err.
                            </span>
                          ) : warnCount > 0 ? (
                            <span
                              className="text-[10px] flex items-center gap-1 font-semibold"
                              style={{ color: 'var(--peach-text)' }}
                              title={alertas.map((a) => a.mensaje).join('\n')}
                            >
                              <AlertTriangle className="w-3 h-3" /> {warnCount} av.
                            </span>
                          ) : (
                            <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--sage-text)' }}>
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
                            className="cursor-pointer p-1.5 rounded-lg fs-pill-sage"
                            title="Emitir en SUNAT"
                          >
                            <Rocket className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEdit(rec)}
                            className="fs-btn-soft p-1.5"
                            title="Editar"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDuplicate(rec)}
                            className="fs-btn-soft p-1.5"
                            title="Duplicar"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadDraftPdf(rec)}
                            className="cursor-pointer p-1.5 rounded-lg fs-pill-peach"
                            title="Hoja de trabajo PDF"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadXml(rec)}
                            className="cursor-pointer p-1.5 rounded-lg fs-pill-sky"
                            title="XML UBL 2.1"
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
              <tfoot className="bg-[var(--bg-inset)] border-t border-[var(--border-soft)] font-bold text-xs">
                <tr>
                  <td colSpan={5} className="p-3 text-[var(--text-secondary)]">
                    TOTAL FILTRADO ({filtrados.filter((r) => r.estado !== 'ANULADO').length} activos)
                  </td>
                  <td className="p-3 text-right font-mono-num">
                    <div className="text-[var(--text-primary)]">B: {formatFixed(totalesFiltrados.gravada)}</div>
                    <div className="text-[11px]" style={{ color: 'var(--sky-text)' }}>
                      I: {formatFixed(totalesFiltrados.igv)}
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono-num text-sm" style={{ color: 'var(--sage-text)' }}>
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
