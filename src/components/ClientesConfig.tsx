import React, { useState } from 'react';
import {
  Building2,
  CloudLightning,
  DatabaseBackup,
  Download,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import type {
  ClienteFrecuente,
  ComprobanteRecord,
  EmpresaEmisoraConfig,
  TipoDocIdentidad,
} from '../types/sunat';
import { validarRucPeru } from '../lib/sunatValidators';
import { triggerDownload } from '../lib/exporters';

interface ClientesConfigProps {
  config: EmpresaEmisoraConfig;
  clientes: ClienteFrecuente[];
  comprobantes: ComprobanteRecord[];
  onSaveConfig: (cfg: EmpresaEmisoraConfig) => void;
  onAddCliente: (cli: ClienteFrecuente) => void;
  onDeleteCliente: (id: string) => void;
  onImportFullBackup: (data: {
    config?: EmpresaEmisoraConfig;
    clientes?: ClienteFrecuente[];
    comprobantes?: ComprobanteRecord[];
  }) => void;
  onLoadDemo: () => void;
  onClearAll: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

export const ClientesConfig: React.FC<ClientesConfigProps> = ({
  config,
  clientes,
  comprobantes,
  onSaveConfig,
  onAddCliente,
  onDeleteCliente,
  onImportFullBackup,
  onLoadDemo,
  onClearAll,
  onNotify,
}) => {
  const [localCfg, setLocalCfg] = useState<EmpresaEmisoraConfig>(config);
  const [conceptosText, setConceptosText] = useState<string>(config.conceptosRapidos.join('\n'));

  // Nuevo cliente frecuente
  const [cTipo, setCTipo] = useState<TipoDocIdentidad>('6');
  const [cNum, setCNum] = useState('');
  const [cRazon, setCRazon] = useState('');
  const [cAlias, setCAlias] = useState('');
  const [cDir, setCDir] = useState('');
  const [cEmail, setCEmail] = useState('');

  const handleSaveEmpresa = (e: React.FormEvent) => {
    e.preventDefault();
    const conceptos = conceptosText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    onSaveConfig({
      ...localCfg,
      conceptosRapidos: conceptos.length ? conceptos : config.conceptosRapidos,
    });
    onNotify('Configuración de la Peña Show guardada en el navegador.', 'success');
  };

  const handleCreateCliente = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cRazon.trim()) {
      onNotify('Ingresa la Razón Social o nombre del cliente.', 'error');
      return;
    }
    if (cTipo === '6') {
      const v = validarRucPeru(cNum);
      if (!v.valido) {
        onNotify(v.motivo || 'RUC inválido', 'error');
        return;
      }
    }
    onAddCliente({
      id: crypto.randomUUID(),
      tipoDoc: cTipo,
      numeroDoc: cNum.trim() || '-',
      razonSocial: cRazon.trim(),
      alias: cAlias.trim() || undefined,
      direccion: cDir.trim() || undefined,
      email: cEmail.trim() || undefined,
      creadoEn: new Date().toISOString(),
    });
    setCNum('');
    setCRazon('');
    setCAlias('');
    setCDir('');
    setCEmail('');
    onNotify('Cliente/Agencia agregado a tu agenda frecuente.', 'success');
  };

  const handleExportBackupJson = () => {
    const payload = {
      version: '1.0',
      app: 'PeñaFact SUNAT PRO',
      exportedAt: new Date().toISOString(),
      config: localCfg,
      clientes,
      comprobantes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `Respaldo_PenaFact_${new Date().toISOString().slice(0, 10)}.json`);
    onNotify('Respaldo portable .JSON descargado. Puedes cargarlo mañana en la laptop del dueño.', 'success');
  };

  const handleImportBackupJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      onImportFullBackup({
        config: parsed.config,
        clientes: parsed.clientes,
        comprobantes: parsed.comprobantes,
      });
      if (parsed.config) {
        setLocalCfg(parsed.config);
        if (Array.isArray(parsed.config.conceptosRapidos)) {
          setConceptosText(parsed.config.conceptosRapidos.join('\n'));
        }
      }
      onNotify('Respaldo importado con éxito. Todo tu trabajo está restaurado.', 'success');
    } catch {
      onNotify('El archivo JSON de respaldo no es válido.', 'error');
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-amber-400" />
          Configuración de la Peña Show, Clientes Frecuentes y Portabilidad
        </h2>
        <p className="text-sm text-slate-400">
          Ajusta el RUC de la peña, la tasa de IGV por defecto, tu agenda de agencias turísticas, conexión API y respaldos portables entre laptops.
        </p>
      </div>

      {/* PORTABILIDAD ENTRE LAPTOPS */}
      <div className="bg-gradient-to-r from-amber-500/10 via-slate-900 to-emerald-500/10 border border-amber-500/30 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-xl">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <DatabaseBackup className="w-5 h-5 text-amber-400" />
            Portabilidad entre Laptops (Tu Laptop ↔ Laptop del Dueño)
          </div>
          <p className="text-xs text-slate-300">
            Todos tus datos se guardan localmente en el navegador por privacidad. Si avanzas trabajo en una laptop y luego abres el enlace en otra, exporta el <strong>Respaldo .JSON</strong> y cárgalo en 1 clic.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExportBackupJson}
            className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            Exportar Respaldo (.json)
          </button>
          <label className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-4 h-4" />
            Importar Respaldo (.json)
            <input type="file" accept=".json" onChange={handleImportBackupJson} className="hidden" />
          </label>
          <button
            type="button"
            onClick={onLoadDemo}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 font-semibold text-xs flex items-center gap-1.5"
          >
            <Sparkles className="w-4 h-4" />
            Cargar Datos Demo
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('¿Borrar todos los comprobantes y PDFs guardados para empezar limpio con las boletas reales?')) {
                onClearAll();
              }
            }}
            className="px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-semibold text-xs flex items-center gap-1.5"
          >
            <RotateCcw className="w-4 h-4" />
            Limpiar Todo (Empezar Real)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* DATOS DE LA PEÑA EMISORA + API */}
        <form onSubmit={handleSaveEmpresa} className="lg:col-span-7 space-y-5">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Datos de la Peña Show (Emisor) y Preferencias IGV
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">RUC de la Peña</label>
                <input
                  type="text"
                  value={localCfg.ruc}
                  onChange={(e) => setLocalCfg({ ...localCfg, ruc: e.target.value })}
                  placeholder="20XXXXXXXXX"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nombre Comercial</label>
                <input
                  type="text"
                  value={localCfg.nombreComercial}
                  onChange={(e) => setLocalCfg({ ...localCfg, nombreComercial: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Razón Social Oficial SUNAT</label>
                <input
                  type="text"
                  value={localCfg.razonSocial}
                  onChange={(e) => setLocalCfg({ ...localCfg, razonSocial: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Dirección Fiscal</label>
                <input
                  type="text"
                  value={localCfg.direccion}
                  onChange={(e) => setLocalCfg({ ...localCfg, direccion: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Serie Factura SOL</label>
                <input
                  type="text"
                  value={localCfg.serieFacturaSol}
                  onChange={(e) => setLocalCfg({ ...localCfg, serieFacturaSol: e.target.value.toUpperCase() })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Próx. N° Factura</label>
                <input
                  type="number"
                  min="1"
                  value={localCfg.correlativoFactura}
                  onChange={(e) =>
                    setLocalCfg({ ...localCfg, correlativoFactura: Math.max(1, parseInt(e.target.value, 10) || 1) })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Serie Boleta SOL</label>
                <input
                  type="text"
                  value={localCfg.serieBoletaSol}
                  onChange={(e) => setLocalCfg({ ...localCfg, serieBoletaSol: e.target.value.toUpperCase() })}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Próx. N° Boleta</label>
                <input
                  type="number"
                  min="1"
                  value={localCfg.correlativoBoleta}
                  onChange={(e) =>
                    setLocalCfg({ ...localCfg, correlativoBoleta: Math.max(1, parseInt(e.target.value, 10) || 1) })
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm font-mono-num"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Tasa IGV por Defecto (%)</label>
                <select
                  value={localCfg.tasaIgvDefecto}
                  onChange={(e) => setLocalCfg({ ...localCfg, tasaIgvDefecto: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm"
                >
                  <option value={18}>18% — General Perú</option>
                  <option value={10.5}>10.5% — MYPE Restaurantes 2026</option>
                  <option value={10}>10% — MYPE Restaurantes anterior</option>
                  <option value={15}>15% — MYPE Restaurantes 2027</option>
                  <option value={0}>0% — Exonerado</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Modo de Cálculo por Defecto</label>
                <select
                  value={localCfg.modoCalculoDefecto}
                  onChange={(e) =>
                    setLocalCfg({
                      ...localCfg,
                      modoCalculoDefecto: e.target.value as EmpresaEmisoraConfig['modoCalculoDefecto'],
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm"
                >
                  <option value="INCLUYE_IGV">Mantener Total (Desglosar Base + IGV)</option>
                  <option value="MAS_IGV">Monto Neto (+ Sumar IGV encima)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Conceptos Rápidos de la Peña Show (uno por línea)
              </label>
              <textarea
                rows={4}
                value={conceptosText}
                onChange={(e) => setConceptosText(e.target.value)}
                className="w-full p-3 rounded-xl bg-slate-950 border border-slate-700 text-slate-200 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Token Opcional apis.net.pe v2 (para consulta automática masiva de RUC/DNI)
              </label>
              <input
                type="password"
                value={localCfg.tokenConsultaDoc}
                onChange={(e) => setLocalCfg({ ...localCfg, tokenConsultaDoc: e.target.value })}
                placeholder="Opcional — si está vacío usa consulta pública v1"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono-num"
              />
            </div>
          </div>

          {/* CONEXION API DIRECTA (NUBEFACT / APISUNAT / PSE) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-sky-300 flex items-center gap-2">
              <CloudLightning className="w-4 h-4" />
              Conexión API Externa (Opcional — NO necesaria si usas el Portal SUNAT SOL del dueño)
            </h3>
            <p className="text-[11px] text-slate-400">
              Deja esto vacío si mañana emites desde la sesión de Portal SUNAT SOL ya abierta en la laptop del dueño. Solo se configura si la empresa contrata en el futuro un proveedor pagado (Nubefact / Apisunat).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Proveedor PSE/OSE</label>
                <select
                  value={localCfg.apiConfig.provider}
                  onChange={(e) =>
                    setLocalCfg({
                      ...localCfg,
                      apiConfig: {
                        ...localCfg.apiConfig,
                        provider: e.target.value as EmpresaEmisoraConfig['apiConfig']['provider'],
                      },
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm"
                >
                  <option value="NUBEFACT">Nubefact API (Estándar Perú)</option>
                  <option value="APISUNAT">Apisunat / Greenter</option>
                  <option value="CUSTOM">Endpoint REST Personalizado</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 px-3 py-2 rounded-xl w-full cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localCfg.apiConfig.modoSimulacion}
                    onChange={(e) =>
                      setLocalCfg({
                        ...localCfg,
                        apiConfig: { ...localCfg.apiConfig, modoSimulacion: e.target.checked },
                      })
                    }
                    className="accent-amber-500"
                  />
                  Modo Simulación (Seguro para pruebas)
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">URL del Endpoint API (HTTPS)</label>
                <input
                  type="url"
                  value={localCfg.apiConfig.endpointUrl}
                  onChange={(e) =>
                    setLocalCfg({
                      ...localCfg,
                      apiConfig: { ...localCfg.apiConfig, endpointUrl: e.target.value },
                    })
                  }
                  placeholder="https://api.nubefact.com/api/v1/..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono-num"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Token / Llave API (se guarda solo en tu navegador)</label>
                <input
                  type="password"
                  value={localCfg.apiConfig.token}
                  onChange={(e) =>
                    setLocalCfg({
                      ...localCfg,
                      apiConfig: { ...localCfg.apiConfig, token: e.target.value },
                    })
                  }
                  placeholder="Tu token secreto del proveedor"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono-num"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              Guardar Toda la Configuración
            </button>
          </div>
        </form>

        {/* DIRECTORIO DE CLIENTES / AGENCIAS DE TURISMO */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
            <Users className="w-4 h-4" />
            Agenda de Agencias de Turismo y Clientes Frecuentes ({clientes.length})
          </h3>

          <form onSubmit={handleCreateCliente} className="space-y-2.5 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="grid grid-cols-3 gap-2">
              <select
                value={cTipo}
                onChange={(e) => setCTipo(e.target.value as TipoDocIdentidad)}
                className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
              >
                <option value="6">RUC</option>
                <option value="1">DNI</option>
                <option value="7">Pasaporte</option>
              </select>
              <input
                type="text"
                value={cNum}
                onChange={(e) => setCNum(e.target.value)}
                placeholder="Número RUC / DNI"
                className="col-span-2 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono-num"
              />
            </div>
            <input
              type="text"
              value={cRazon}
              onChange={(e) => setCRazon(e.target.value)}
              placeholder="Razón Social / Nombre completo"
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={cAlias}
                onChange={(e) => setCAlias(e.target.value)}
                placeholder="Alias corto (ej. Inca Tours)"
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
              />
              <input
                type="email"
                value={cEmail}
                onChange={(e) => setCEmail(e.target.value)}
                placeholder="Email (opcional)"
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
              />
            </div>
            <input
              type="text"
              value={cDir}
              onChange={(e) => setCDir(e.target.value)}
              placeholder="Dirección fiscal (opcional)"
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
            />
            <button
              type="submit"
              className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Agregar a Agenda Frecuente
            </button>
          </form>

          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {clientes.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">
                Guarda aquí las agencias de viajes o empresas que siempre facturan en la peña para seleccionarlas en 1 clic.
              </p>
            ) : (
              clientes.map((c) => (
                <div
                  key={c.id}
                  className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">
                      {c.razonSocial}{' '}
                      {c.alias && <span className="text-amber-300 font-normal">({c.alias})</span>}
                    </div>
                    <div className="text-[11px] font-mono-num text-slate-400">{c.numeroDoc}</div>
                    {c.direccion && <div className="text-[10px] text-slate-500 truncate">{c.direccion}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteCliente(c.id)}
                    className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15 shrink-0"
                    title="Eliminar cliente"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
