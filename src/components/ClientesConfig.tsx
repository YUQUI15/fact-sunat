import React, { useState } from 'react';
import {
  Building2,
  CloudLightning,
  DatabaseBackup,
  Download,
  Plus,
  RotateCcw,
  Save,
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
    onNotify('Configuración fiscal guardada correctamente.', 'success');
  };

  const handleCreateCliente = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cRazon.trim()) {
      onNotify('Ingresa la Razón Social o nombres del cliente.', 'error');
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
    onNotify('Cliente agregado al directorio.', 'success');
  };

  const handleExportBackupJson = () => {
    const payload = {
      version: '1.0',
      app: 'FactSunat Pro',
      exportedAt: new Date().toISOString(),
      config: localCfg,
      clientes,
      comprobantes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `Respaldo_FactSunat_${new Date().toISOString().slice(0, 10)}.json`);
    onNotify('Respaldo portable .JSON descargado correctamente.', 'success');
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
      onNotify('Respaldo importado y restaurado con éxito.', 'success');
    } catch {
      onNotify('El archivo JSON seleccionado no es válido.', 'error');
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-5">
      {/* Respaldo y Portabilidad */}
      <div className="fs-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-xl">
          <div className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <DatabaseBackup className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
            Respaldo Portable y Transferencia entre Equipos
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Toda la información se almacena de forma privada en este navegador. Exporte un respaldo <code>.json</code> para continuar su trabajo en otro equipo o conservar una copia histórica.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExportBackupJson}
            className="fs-btn-primary px-3.5 py-2 text-xs flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar Respaldo
          </button>
          <label className="cursor-pointer px-3.5 py-2 rounded-xl fs-pill-sage text-xs font-bold flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" />
            Importar Respaldo
            <input type="file" accept=".json" onChange={handleImportBackupJson} className="hidden" />
          </label>
          <button type="button" onClick={onLoadDemo} className="fs-btn-soft px-3 py-2 text-xs flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--accent-text)' }} />
            Datos de Ejemplo
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('¿Deseas limpiar todos los comprobantes y archivos PDF almacenados?')) {
                onClearAll();
              }
            }}
            className="cursor-pointer px-3 py-2 rounded-xl fs-pill-rose text-xs font-bold flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Limpiar Todo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Datos de Empresa + API */}
        <form onSubmit={handleSaveEmpresa} className="lg:col-span-7 space-y-5">
          <div className="fs-card p-5 space-y-4">
            <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Building2 className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
              Datos Fiscales del Emisor y Parámetros IGV
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">RUC Emisor</label>
                <input
                  type="text"
                  value={localCfg.ruc}
                  onChange={(e) => setLocalCfg({ ...localCfg, ruc: e.target.value })}
                  placeholder="20XXXXXXXXX"
                  className="fs-input w-full px-3 py-2 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Nombre Comercial</label>
                <input
                  type="text"
                  value={localCfg.nombreComercial}
                  onChange={(e) => setLocalCfg({ ...localCfg, nombreComercial: e.target.value })}
                  className="fs-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Razón Social SUNAT</label>
                <input
                  type="text"
                  value={localCfg.razonSocial}
                  onChange={(e) => setLocalCfg({ ...localCfg, razonSocial: e.target.value })}
                  className="fs-input w-full px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Domicilio Fiscal</label>
                <input
                  type="text"
                  value={localCfg.direccion}
                  onChange={(e) => setLocalCfg({ ...localCfg, direccion: e.target.value })}
                  className="fs-input w-full px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-[var(--border-soft)]">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Serie Factura</label>
                <input
                  type="text"
                  value={localCfg.serieFacturaSol}
                  onChange={(e) => setLocalCfg({ ...localCfg, serieFacturaSol: e.target.value.toUpperCase() })}
                  className="fs-input w-full px-2.5 py-1.5 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Próx. N° Fact.</label>
                <input
                  type="number"
                  min="1"
                  value={localCfg.correlativoFactura}
                  onChange={(e) =>
                    setLocalCfg({ ...localCfg, correlativoFactura: Math.max(1, parseInt(e.target.value, 10) || 1) })
                  }
                  className="fs-input w-full px-2.5 py-1.5 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Serie Boleta</label>
                <input
                  type="text"
                  value={localCfg.serieBoletaSol}
                  onChange={(e) => setLocalCfg({ ...localCfg, serieBoletaSol: e.target.value.toUpperCase() })}
                  className="fs-input w-full px-2.5 py-1.5 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Próx. N° Bol.</label>
                <input
                  type="number"
                  min="1"
                  value={localCfg.correlativoBoleta}
                  onChange={(e) =>
                    setLocalCfg({ ...localCfg, correlativoBoleta: Math.max(1, parseInt(e.target.value, 10) || 1) })
                  }
                  className="fs-input w-full px-2.5 py-1.5 text-sm font-mono-num"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Tasa IGV por Defecto</label>
                <select
                  value={localCfg.tasaIgvDefecto}
                  onChange={(e) => setLocalCfg({ ...localCfg, tasaIgvDefecto: parseFloat(e.target.value) })}
                  className="fs-input w-full px-3 py-2 text-sm"
                >
                  <option value={18}>18% — Régimen General</option>
                  <option value={10.5}>10.5% — MYPE Ley 31556 (2026)</option>
                  <option value={10}>10% — MYPE Tasa Anterior</option>
                  <option value={15}>15% — MYPE 2027</option>
                  <option value={0}>0% — Exonerado / Inafecto</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Modo de Cálculo por Defecto</label>
                <select
                  value={localCfg.modoCalculoDefecto}
                  onChange={(e) =>
                    setLocalCfg({
                      ...localCfg,
                      modoCalculoDefecto: e.target.value as EmpresaEmisoraConfig['modoCalculoDefecto'],
                    })
                  }
                  className="fs-input w-full px-3 py-2 text-sm"
                >
                  <option value="INCLUYE_IGV">IGV Incluido (Desglosar Base)</option>
                  <option value="MAS_IGV">Importe Neto (+ IGV Adicional)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                Conceptos Frecuentes (uno por línea)
              </label>
              <textarea
                rows={4}
                value={conceptosText}
                onChange={(e) => setConceptosText(e.target.value)}
                className="fs-input w-full p-3 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                Token Opcional apis.net.pe v2 (para consultas RUC/DNI de alto volumen)
              </label>
              <input
                type="password"
                value={localCfg.tokenConsultaDoc}
                onChange={(e) => setLocalCfg({ ...localCfg, tokenConsultaDoc: e.target.value })}
                placeholder="Opcional — si queda vacío usa consulta pública v1"
                className="fs-input w-full px-3 py-2 text-xs font-mono-num"
              />
            </div>
          </div>

          {/* API Externa Opcional */}
          <div className="fs-card p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <CloudLightning className="w-4 h-4" style={{ color: 'var(--sky-text)' }} />
                Integración API PSE/OSE (Opcional)
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                No es necesario configurar esta sección si emite directamente en Portal SUNAT SEE-SOL.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Proveedor</label>
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
                  className="fs-input w-full px-3 py-2 text-sm"
                >
                  <option value="NUBEFACT">Nubefact API</option>
                  <option value="APISUNAT">Apisunat / Greenter</option>
                  <option value="CUSTOM">Endpoint REST Personalizado</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs fs-pill-peach px-3 py-2 rounded-xl w-full cursor-pointer font-semibold">
                  <input
                    type="checkbox"
                    checked={localCfg.apiConfig.modoSimulacion}
                    onChange={(e) =>
                      setLocalCfg({
                        ...localCfg,
                        apiConfig: { ...localCfg.apiConfig, modoSimulacion: e.target.checked },
                      })
                    }
                    className="accent-[var(--accent-bg)]"
                  />
                  Modo Simulación (Pruebas)
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Endpoint URL (HTTPS)</label>
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
                  className="fs-input w-full px-3 py-2 text-xs font-mono-num"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Token API</label>
                <input
                  type="password"
                  value={localCfg.apiConfig.token}
                  onChange={(e) =>
                    setLocalCfg({
                      ...localCfg,
                      apiConfig: { ...localCfg.apiConfig, token: e.target.value },
                    })
                  }
                  placeholder="Token de autorización (almacenado solo localmente)"
                  className="fs-input w-full px-3 py-2 text-xs font-mono-num"
                />
              </div>
            </div>

            <button
              type="submit"
              className="fs-btn-sage w-full py-3 text-sm flex items-center justify-center gap-2 shadow-sm"
            >
              <Save className="w-4 h-4" />
              Guardar Configuración
            </button>
          </div>
        </form>

        {/* Directorio de Clientes */}
        <div className="lg:col-span-5 fs-card p-5 space-y-4">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Users className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
            Directorio de Clientes Frecuentes ({clientes.length})
          </h3>

          <form onSubmit={handleCreateCliente} className="fs-inset p-3.5 space-y-2.5">
            <div className="grid grid-cols-3 gap-2">
              <select
                value={cTipo}
                onChange={(e) => setCTipo(e.target.value as TipoDocIdentidad)}
                className="fs-input px-2 py-1.5 text-xs"
              >
                <option value="6">RUC</option>
                <option value="1">DNI</option>
                <option value="7">Pasaporte</option>
              </select>
              <input
                type="text"
                value={cNum}
                onChange={(e) => setCNum(e.target.value)}
                placeholder="Número documento"
                className="fs-input col-span-2 px-2.5 py-1.5 text-xs font-mono-num"
              />
            </div>
            <input
              type="text"
              value={cRazon}
              onChange={(e) => setCRazon(e.target.value)}
              placeholder="Razón Social / Nombres completos"
              className="fs-input w-full px-2.5 py-1.5 text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={cAlias}
                onChange={(e) => setCAlias(e.target.value)}
                placeholder="Alias corto (opcional)"
                className="fs-input px-2.5 py-1.5 text-xs"
              />
              <input
                type="email"
                value={cEmail}
                onChange={(e) => setCEmail(e.target.value)}
                placeholder="Correo (opcional)"
                className="fs-input px-2.5 py-1.5 text-xs"
              />
            </div>
            <input
              type="text"
              value={cDir}
              onChange={(e) => setCDir(e.target.value)}
              placeholder="Dirección fiscal (opcional)"
              className="fs-input w-full px-2.5 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="fs-btn-primary w-full py-2 text-xs flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Añadir al Directorio
            </button>
          </form>

          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {clientes.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-6">
                Guarde aquí sus clientes y empresas habituales para autocompletar en 1 clic.
              </p>
            ) : (
              clientes.map((c) => (
                <div key={c.id} className="fs-inset p-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                      {c.razonSocial}{' '}
                      {c.alias && (
                        <span className="font-normal" style={{ color: 'var(--accent-text)' }}>
                          ({c.alias})
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono-num text-[var(--text-muted)]">{c.numeroDoc}</div>
                    {c.direccion && <div className="text-[10px] text-[var(--text-muted)] truncate">{c.direccion}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteCliente(c.id)}
                    className="cursor-pointer p-1.5 rounded-lg hover:bg-[var(--rose-soft)] shrink-0"
                    style={{ color: 'var(--rose-text)' }}
                    title="Eliminar"
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
