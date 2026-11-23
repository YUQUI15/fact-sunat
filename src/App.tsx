import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Calculator,
  CheckCircle2,
  FolderOutput,
  Info,
  ListChecks,
  Menu,
  Moon,
  Rocket,
  Settings,
  Sparkles,
  Sun,
  X,
  Zap,
} from 'lucide-react';
import type { ClienteFrecuente, ComprobanteRecord, EmpresaEmisoraConfig } from './types/sunat';
import {
  clearAllPdfBlobs,
  createDemoWorkspace,
  loadClientes,
  loadComprobantes,
  loadConfig,
  loadTheme,
  saveClientes,
  saveComprobantes,
  saveConfig,
  saveTheme,
  type ThemeMode,
} from './lib/storage';
import { calculateComprobante, formatFixed, roundSunat } from './lib/sunatMath';
import { CalculadoraIGV } from './components/CalculadoraIGV';
import { GuiaExpertoSunat } from './components/GuiaExpertoSunat';
import { CapturaRapida } from './components/CapturaRapida';
import { BandejaComprobantes } from './components/BandejaComprobantes';
import { EstacionEmision } from './components/EstacionEmision';
import { OrganizadorCarpetas } from './components/OrganizadorCarpetas';
import { DashboardResumen } from './components/DashboardResumen';
import { ClientesConfig } from './components/ClientesConfig';

export type NavTab =
  | 'CALC'
  | 'CAPTURA'
  | 'BANDEJA'
  | 'EMISION'
  | 'CARPETAS'
  | 'DASHBOARD'
  | 'GUIA'
  | 'CONFIG';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('CALC');
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [config, setConfig] = useState<EmpresaEmisoraConfig>(() => loadConfig());
  const [comprobantes, setComprobantes] = useState<ComprobanteRecord[]>(() => loadComprobantes());
  const [clientes, setClientes] = useState<ClienteFrecuente[]>(() => loadClientes());
  const [editingRecord, setEditingRecord] = useState<ComprobanteRecord | null>(null);
  const [emitFocusId, setEmitFocusId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    saveTheme(theme);
  }, [theme]);

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
    window.clearTimeout((window as unknown as { __fsToast?: number }).__fsToast);
    (window as unknown as { __fsToast?: number }).__fsToast = window.setTimeout(() => setToast(null), 4200);
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
        descripcion: `${it.descripcion} [Ref. ${c.notaInterna} - ${c.fechaConsumo}]`,
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
    notify(`Se consolidaron ${chosen.length} documentos en 1 comprobante (${consolidated.notaInterna}).`, 'success');
  };

  const handleLoadDemo = () => {
    const demo = createDemoWorkspace();
    setComprobantes(demo.comprobantes);
    setClientes(demo.clientes);
    notify('Datos de ejemplo empresariales cargados correctamente.', 'success');
  };

  const handleClearAll = async () => {
    setComprobantes([]);
    await clearAllPdfBlobs();
    setEditingRecord(null);
    notify('Registros y archivos PDF limpiados. Listo para operación real.', 'info');
  };

  const workflowNav: Array<{
    id: NavTab;
    num: string;
    label: string;
    sub: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: 'CALC',
      num: '01',
      label: 'Calculadora IGV',
      sub: 'Desglose y sumador exacto',
      icon: <Calculator className="w-4 h-4" />,
    },
    {
      id: 'CAPTURA',
      num: '02',
      label: 'Registro de Notas',
      sub: 'Ingreso rápido y Excel',
      icon: <Zap className="w-4 h-4" />,
    },
    {
      id: 'BANDEJA',
      num: '03',
      label: 'Bandeja y Cuadre',
      sub: 'Control y consolidación',
      icon: <ListChecks className="w-4 h-4" />,
      badge: quickStats.totalDocs,
    },
    {
      id: 'EMISION',
      num: '04',
      label: 'Emisión SUNAT',
      sub: 'Asistente SEE-SOL / API',
      icon: <Rocket className="w-4 h-4" />,
      badge: quickStats.pendientes,
    },
    {
      id: 'CARPETAS',
      num: '05',
      label: 'Archivo y Carpetas',
      sub: 'PDFs por fecha y empresa',
      icon: <FolderOutput className="w-4 h-4" />,
    },
    {
      id: 'DASHBOARD',
      num: '06',
      label: 'Reportes y Cierre',
      sub: 'KPIs, IGV y auditoría',
      icon: <BarChart3 className="w-4 h-4" />,
    },
  ];

  const supportNav: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
    { id: 'GUIA', label: 'Guía Operativa y S.O.S.', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'CONFIG', label: 'Configuración y Empresa', icon: <Settings className="w-4 h-4" /> },
  ];

  const activeMeta =
    workflowNav.find((n) => n.id === activeTab) ||
    (activeTab === 'GUIA'
      ? { label: 'Guía Operativa y S.O.S.', sub: 'Procedimiento oficial paso a paso y resolución de incidencias SUNAT' }
      : { label: 'Configuración y Empresa', sub: 'Parámetros fiscales, directorio de clientes y respaldos portables' });

  const selectTab = (tab: NavTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Identidad de Marca Corporativa */}
      <div className="px-5 py-5 border-b border-[var(--border-soft)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-sm tracking-tight shadow-sm"
            style={{ backgroundColor: 'var(--accent-bg)', color: theme === 'dark' ? '#111420' : '#ffffff' }}
          >
            FS
          </div>
          <div>
            <div className="text-sm font-extrabold tracking-tight text-[var(--text-primary)] leading-none">
              FactSunat <span style={{ color: 'var(--accent-text)' }}>Pro</span>
            </div>
            <div className="text-[11px] text-[var(--text-muted)] mt-1">
              Gestión Tributaria · Perú
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Flujo Ordenado 01 → 06 */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <div className="space-y-1">
          <div className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Flujo de Trabajo (En Orden)
          </div>
          {workflowNav.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={`w-full cursor-pointer text-left px-3 py-2.5 rounded-xl flex items-center gap-3 transition ${
                  active
                    ? 'fs-pill-accent shadow-xs'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                <div className="shrink-0 opacity-90">{item.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono-num font-bold opacity-65">{item.num}</span>
                    <span className="text-xs font-bold truncate">{item.label}</span>
                  </div>
                  <div className="text-[10px] opacity-75 truncate">{item.sub}</div>
                </div>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono-num font-bold ${
                      active ? 'bg-[var(--accent-bg)] text-white dark:text-slate-950' : 'fs-pill-peach'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-1 pt-2 border-t border-[var(--border-soft)]">
          <div className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Soporte y Sistema
          </div>
          {supportNav.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={`w-full cursor-pointer text-left px-3 py-2.5 rounded-xl flex items-center gap-3 text-xs font-bold transition ${
                  active
                    ? 'fs-pill-accent shadow-xs'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pie de Sidebar: Perfil de Empresa Activo */}
      <div className="p-3.5 border-t border-[var(--border-soft)] space-y-2.5">
        <div className="fs-inset px-3 py-2.5 text-[11px]">
          <div className="font-bold text-[var(--text-primary)] truncate">
            {config.nombreComercial || config.razonSocial}
          </div>
          <div className="text-[var(--text-muted)] mt-0.5 font-mono-num">
            IGV {config.tasaIgvDefecto}% · {config.modoCalculoDefecto === 'INCLUYE_IGV' ? 'IGV Incluido' : 'Neto + IGV'}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Sidebar Fijo Escritorio */}
      <aside className="hidden lg:block w-64 shrink-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-soft)] sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Drawer Móvil */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[85vw] bg-[var(--bg-sidebar)] border-r border-[var(--border-soft)] h-full shadow-2xl">
            {renderSidebarContent()}
          </div>
          <div
            className="flex-1 bg-black/40 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Área Principal */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Cabecera Superior Minimalista y Ordenada */}
        <header className="sticky top-0 z-30 bg-[var(--bg-canvas)]/90 backdrop-blur-md border-b border-[var(--border-soft)]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 rounded-xl fs-btn-soft"
                aria-label="Abrir menú"
              >
                <Menu className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-[var(--text-primary)] truncate">
                  {activeMeta.label}
                </h1>
                <p className="text-xs text-[var(--text-muted)] truncate hidden sm:block">
                  {activeMeta.sub}
                </p>
              </div>
            </div>

            {/* Indicadores Rápidos + Switch Tema Claro/Oscuro Pastel */}
            <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
              <div className="hidden md:flex items-center gap-3 px-3.5 py-1.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-soft)] text-xs">
                <div>
                  <span className="text-[var(--text-muted)] mr-1.5">Acumulado:</span>
                  <strong className="font-mono-num" style={{ color: 'var(--sage-text)' }}>
                    S/ {formatFixed(quickStats.total)}
                  </strong>
                </div>
                <div className="h-3.5 w-px bg-[var(--border-soft)]" />
                <div>
                  <span className="text-[var(--text-muted)] mr-1.5">Pendientes:</span>
                  <strong className="font-mono-num" style={{ color: 'var(--peach-text)' }}>
                    {quickStats.pendientes}
                  </strong>
                </div>
              </div>

              {comprobantes.length === 0 && (
                <button
                  type="button"
                  onClick={handleLoadDemo}
                  className="cursor-pointer px-3 py-1.5 rounded-xl fs-pill-peach text-xs font-bold flex items-center gap-1.5 transition hover:opacity-90"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Cargar Ejemplo</span>
                  <span className="sm:hidden">Demo</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                className="cursor-pointer px-3 py-1.5 rounded-xl fs-btn-soft text-xs flex items-center gap-1.5"
                title={theme === 'light' ? 'Cambiar a tema oscuro pastel' : 'Cambiar a tema claro pastel'}
              >
                {theme === 'light' ? (
                  <>
                    <Moon className="w-3.5 h-3.5" style={{ color: 'var(--accent-text)' }} />
                    <span className="hidden sm:inline">Oscuro</span>
                  </>
                ) : (
                  <>
                    <Sun className="w-3.5 h-3.5" style={{ color: 'var(--peach-text)' }} />
                    <span className="hidden sm:inline">Claro</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Notificación Toast */}
        {toast && (
          <div className="fixed bottom-5 right-5 z-50 max-w-md">
            <div
              className={`px-4 py-3 rounded-2xl shadow-xl text-xs sm:text-sm font-semibold flex items-center gap-2.5 ${
                toast.tone === 'success'
                  ? 'fs-pill-sage'
                  : toast.tone === 'error'
                    ? 'fs-pill-rose'
                    : 'fs-pill-sky'
              }`}
              style={{ backdropFilter: 'blur(12px)' }}
            >
              {toast.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <Info className="w-4 h-4 shrink-0" />
              )}
              <span>{toast.msg}</span>
            </div>
          </div>
        )}

        {/* Espacio de Trabajo Principal */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
          {activeTab === 'CALC' && (
            <CalculadoraIGV
              config={config}
              comprobantesCount={comprobantes.length}
              onSendToBandeja={(rec) => {
                setComprobantes((prev) => [rec, ...prev]);
                setActiveTab('BANDEJA');
              }}
              onOpenGuia={() => setActiveTab('GUIA')}
              onNotify={notify}
            />
          )}

          {activeTab === 'GUIA' && (
            <GuiaExpertoSunat onGoToTab={(tab) => setActiveTab(tab)} />
          )}

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
                notify(`Se eliminaron ${ids.length} registro(s).`, 'info');
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
                notify(`Comprobante ${rec.notaInterna} duplicado.`, 'success');
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

        {/* Pie de página discreto y profesional */}
        <footer className="border-t border-[var(--border-soft)] py-3.5 px-6 text-center text-[11px] text-[var(--text-muted)]">
          FactSunat Pro · Almacenamiento local privado en el navegador · Compatible con SUNAT SEE-SOL (IGV 18% / 10.5% MYPE) y API PSE/OSE.
        </footer>
      </div>
    </div>
  );
}
