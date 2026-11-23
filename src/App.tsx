import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  FolderOutput,
  Info,
  ListChecks,
  Rocket,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { ClienteFrecuente, ComprobanteRecord, EmpresaEmisoraConfig } from './types/sunat';
import {
  clearAllPdfBlobs,
  createDemoWorkspace,
  loadClientes,
  loadComprobantes,
  loadConfig,
  saveClientes,
  saveComprobantes,
  saveConfig,
} from './lib/storage';
import { calculateComprobante, formatFixed, roundSunat } from './lib/sunatMath';
import { CapturaRapida } from './components/CapturaRapida';
import { BandejaComprobantes } from './components/BandejaComprobantes';
import { EstacionEmision } from './components/EstacionEmision';
import { OrganizadorCarpetas } from './components/OrganizadorCarpetas';
import { DashboardResumen } from './components/DashboardResumen';
import { ClientesConfig } from './components/ClientesConfig';

type NavTab = 'CAPTURA' | 'BANDEJA' | 'EMISION' | 'CARPETAS' | 'DASHBOARD' | 'CONFIG';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('CAPTURA');
  const [config, setConfig] = useState<EmpresaEmisoraConfig>(() => loadConfig());
  const [comprobantes, setComprobantes] = useState<ComprobanteRecord[]>(() => loadComprobantes());
  const [clientes, setClientes] = useState<ClienteFrecuente[]>(() => loadClientes());
  const [editingRecord, setEditingRecord] = useState<ComprobanteRecord | null>(null);
  const [emitFocusId, setEmitFocusId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  useEffect(() => {
    saveComprobantes(comprobantes);
  }, [comprobantes]);

  useEffect(() => {
    saveClientes(clientes);
  }, [clientes]);

  const notify = (msg: string, tone: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, tone });
    window.clearTimeout((window as unknown as { __pfToast?: number }).__pfToast);
    (window as unknown as { __pfToast?: number }).__pfToast = window.setTimeout(() => setToast(null), 4200);
  };

  const quickStats = useMemo(() => {
    const activos = comprobantes.filter((c) => c.estado !== 'ANULADO');
    const pendientes = activos.filter((c) => c.estado === 'PENDIENTE' || c.estado === 'EN_PROCESO').length;
    const total = activos.reduce((acc, r) => roundSunat(acc + calculateComprobante(r).importeTotal, 2), 0);
    return { totalDocs: activos.length, pendientes, total };
  }, [comprobantes]);

  const handleSaveComprobante = (rec: ComprobanteRecord, isEdit: boolean) => {
    setComprobantes((prev) =>
      isEdit ? prev.map((c) => (c.id === rec.id ? rec : c)) : [rec, ...prev]
    );
  };

  const handleConsolidate = (ids: string[]) => {
    const chosen = comprobantes.filter((c) => ids.includes(c.id));
    if (chosen.length < 2) return;
    const base = chosen[0];
    const allItems = chosen.flatMap((c) =>
      c.items.map((it) => ({
        ...it,
        id: crypto.randomUUID(),
        descripcion: `${it.descripcion} [Nota ${c.notaInterna} - ${c.fechaConsumo}]`,
      }))
    );
    const notasList = chosen.map((c) => c.notaInterna).filter(Boolean);
    const consolidated: ComprobanteRecord = {
      ...base,
      id: crypto.randomUUID(),
      notaInterna: `CONS-${notasList.length}`,
      notasConsolidadas: notasList,
      incluirRefFechaEnDesc: false,
      items: allItems,
      estado: 'PENDIENTE',
      pdfAdjunto: undefined,
      observaciones: `Consolidado de notas: ${notasList.join(', ')}`,
      creadoEn: new Date().toISOString(),
      actualizadoEn: new Date().toISOString(),
    };
    setComprobantes((prev) => [consolidated, ...prev.filter((c) => !ids.includes(c.id))]);
    notify(`Se consolidaron ${chosen.length} notas en 1 comprobante (${consolidated.notaInterna}).`, 'success');
  };

  const handleLoadDemo = () => {
    const demo = createDemoWorkspace();
    setComprobantes(demo.comprobantes);
    setClientes(demo.clientes);
    notify('Datos de demostración de Peña Show cargados (incluye caso S/ 100, tasa 10.5% MYPE y Pasaporte).', 'success');
  };

  const handleClearAll = async () => {
    setComprobantes([]);
    await clearAllPdfBlobs();
    setEditingRecord(null);
    notify('Bandeja y PDFs limpiados. ¡Listo para iniciar con tus boletas reales!', 'info');
  };

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'CAPTURA', label: 'Captura Rápida', icon: <Zap className="w-3.5 h-3.5" /> },
    { id: 'BANDEJA', label: 'Bandeja', icon: <ListChecks className="w-3.5 h-3.5" />, badge: quickStats.totalDocs },
    { id: 'EMISION', label: 'Emitir SUNAT', icon: <Rocket className="w-3.5 h-3.5" />, badge: quickStats.pendientes },
    { id: 'CARPETAS', label: 'Organizador PDFs', icon: <FolderOutput className="w-3.5 h-3.5" /> },
    { id: 'DASHBOARD', label: 'Reportes', icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: 'CONFIG', label: 'Configuración', icon: <Settings className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Barra Superior Fija */}
      <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/90">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-orange-600 flex items-center justify-center text-slate-950 font-black text-base shadow-lg shadow-amber-500/20">
              PF
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight text-white">
                  PeñaFact <span className="text-amber-400">SUNAT PRO</span>
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                  PERÚ · PORTABLE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                {config.nombreComercial || config.razonSocial} · IGV por defecto: {config.tasaIgvDefecto}% · Modo:{' '}
                {config.modoCalculoDefecto === 'INCLUYE_IGV' ? 'Mantener Total' : 'Neto + IGV'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden md:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
              <div>
                <span className="text-slate-400 mr-1">Total:</span>
                <strong className="font-mono-num text-emerald-400">S/ {formatFixed(quickStats.total)}</strong>
              </div>
              <div className="h-3.5 w-px bg-slate-800" />
              <div>
                <span className="text-slate-400 mr-1">Pendientes:</span>
                <strong className="font-mono-num text-amber-300">{quickStats.pendientes}</strong>
              </div>
            </div>

            {comprobantes.length === 0 && (
              <button
                type="button"
                onClick={handleLoadDemo}
                className="cursor-pointer px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 text-xs font-bold flex items-center gap-1.5 transition"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Probar con Demo
              </button>
            )}
          </div>
        </div>

        {/* Navegación por Pestañas (sin desborde horizontal en laptops) */}
        <div className="max-w-7xl mx-auto px-4 pb-2 flex flex-wrap items-center gap-1">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`cursor-pointer px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition ${
                  active
                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                {item.icon}
                {item.label}
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono-num font-bold ${
                      active ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-amber-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Notificación Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md animate-fade-in">
          <div
            className={`px-4 py-3 rounded-2xl shadow-2xl border text-xs sm:text-sm font-semibold flex items-center gap-2.5 ${
              toast.tone === 'success'
                ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200'
                : toast.tone === 'error'
                  ? 'bg-rose-950/95 border-rose-500/50 text-rose-200'
                  : 'bg-slate-900/95 border-sky-500/50 text-sky-200'
            }`}
          >
            {toast.tone === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <Info className="w-4 h-4 shrink-0" />
            )}
            <span>{toast.msg}</span>
          </div>
        </div>
      )}

      {/* Contenido Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        {activeTab === 'CAPTURA' && (
          <CapturaRapida
            config={config}
            comprobantes={comprobantes}
            clientes={clientes}
            editingRecord={editingRecord}
            onCancelEdit={() => setEditingRecord(null)}
            onSaveComprobante={handleSaveComprobante}
            onImportBulk={(nuevos) => {
              setComprobantes((prev) => [...nuevos, ...prev]);
              setActiveTab('BANDEJA');
            }}
            onSaveCliente={(cli) => setClientes((prev) => [cli, ...prev])}
            onNotify={notify}
          />
        )}

        {activeTab === 'BANDEJA' && (
          <BandejaComprobantes
            comprobantes={comprobantes}
            config={config}
            onEdit={(rec) => {
              setEditingRecord(rec);
              setActiveTab('CAPTURA');
            }}
            onEmitSingle={(id) => {
              setEmitFocusId(id);
              setActiveTab('EMISION');
            }}
            onDeleteMany={(ids) => {
              setComprobantes((prev) => prev.filter((c) => !ids.includes(c.id)));
              notify(`Se eliminaron ${ids.length} comprobante(s).`, 'info');
            }}
            onBulkUpdate={(ids, updater) => {
              setComprobantes((prev) => prev.map((c) => (ids.includes(c.id) ? updater(c) : c)));
            }}
            onConsolidate={handleConsolidate}
            onDuplicate={(rec) => {
              const dup: ComprobanteRecord = {
                ...rec,
                id: crypto.randomUUID(),
                notaInterna: `${rec.notaInterna}-COPIA`,
                numeroSunat: '',
                estado: 'PENDIENTE',
                pdfAdjunto: undefined,
                creadoEn: new Date().toISOString(),
                actualizadoEn: new Date().toISOString(),
              };
              setComprobantes((prev) => [dup, ...prev]);
              notify(`Nota ${rec.notaInterna} duplicada.`, 'success');
            }}
            onNotify={notify}
          />
        )}

        {activeTab === 'EMISION' && (
          <EstacionEmision
            comprobantes={comprobantes}
            config={config}
            initialFocusId={emitFocusId}
            onUpdateComprobante={(updated) => {
              setComprobantes((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            }}
            onUpdateCorrelativo={(tipo, nextNum) => {
              setConfig((prev) =>
                tipo === '01'
                  ? { ...prev, correlativoFactura: Math.max(prev.correlativoFactura, nextNum) }
                  : { ...prev, correlativoBoleta: Math.max(prev.correlativoBoleta, nextNum) }
              );
            }}
            onNotify={notify}
          />
        )}

        {activeTab === 'CARPETAS' && (
          <OrganizadorCarpetas
            comprobantes={comprobantes}
            clientes={clientes}
            config={config}
            onUpdateConfig={(patch) => setConfig((prev) => ({ ...prev, ...patch }))}
            onAttachPdfsAndImport={(updatedList, createdList) => {
              setComprobantes((prev) => {
                const map = new Map(updatedList.map((u) => [u.id, u]));
                const merged = prev.map((c) => map.get(c.id) || c);
                return [...createdList, ...merged];
              });
            }}
            onNotify={notify}
          />
        )}

        {activeTab === 'DASHBOARD' && (
          <DashboardResumen
            comprobantes={comprobantes}
            config={config}
            onJumpToEdit={(rec) => {
              setEditingRecord(rec);
              setActiveTab('CAPTURA');
            }}
          />
        )}

        {activeTab === 'CONFIG' && (
          <ClientesConfig
            config={config}
            clientes={clientes}
            comprobantes={comprobantes}
            onSaveConfig={(cfg) => setConfig(cfg)}
            onAddCliente={(cli) => setClientes((prev) => [cli, ...prev])}
            onDeleteCliente={(id) => setClientes((prev) => prev.filter((c) => c.id !== id))}
            onImportFullBackup={(data) => {
              if (data.config) setConfig((prev) => ({ ...prev, ...data.config }));
              if (Array.isArray(data.clientes)) setClientes(data.clientes);
              if (Array.isArray(data.comprobantes)) setComprobantes(data.comprobantes);
            }}
            onLoadDemo={handleLoadDemo}
            onClearAll={handleClearAll}
            onNotify={notify}
          />
        )}
      </main>

      {/* Pie de página informativo */}
      <footer className="border-t border-slate-900 py-4 px-4 text-center text-[11px] text-slate-500">
        PeñaFact SUNAT PRO · 100% Privado en tu navegador (IndexedDB + LocalStorage) · Compatible con IGV 18%, MYPE Restaurantes 10.5% (2026), Portal SUNAT SOL y API PSE/OSE.
      </footer>
    </div>
  );
}
