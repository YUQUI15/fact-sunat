import type {
  ClienteFrecuente,
  ComprobanteRecord,
  EmpresaEmisoraConfig,
} from '../types/sunat';
import { getHoyPeruISO } from './sunatValidators';

const KEYS = {
  COMPROBANTES: 'penafact_comprobantes_v1',
  CLIENTES: 'penafact_clientes_v1',
  CONFIG: 'penafact_config_v1',
} as const;

export const DEFAULT_CONFIG: EmpresaEmisoraConfig = {
  ruc: '',
  razonSocial: 'PEÑA SHOW TURÍSTICA S.A.C.',
  nombreComercial: 'La Peña Show',
  direccion: 'Lima / Cusco, Perú',
  distrito: 'LIMA',
  serieFacturaSol: 'E001',
  serieBoletaSol: 'EB01',
  serieNcSol: 'E001',
  correlativoFactura: 1,
  correlativoBoleta: 1,
  tasaIgvDefecto: 18,
  modoCalculoDefecto: 'INCLUYE_IGV',
  recargoConsumoDefecto: 0,
  incluirRefFechaDefecto: true,
  conceptosRapidos: [
    'Consumo de Alimentos y Bebidas - Peña Show',
    'Cena Show Folklórico Turístico',
    'Servicio de Restaurante y Espectáculo',
    'Entradas Peña Show Turístico',
    'Consumo de Bebidas y Coctelería',
    'Almuerzo Turístico Grupal',
  ],
  tokenConsultaDoc: '',
  esquemaCarpetasDefecto: 'SUPER_DUAL',
  fechaBaseCarpeta: 'CONSUMO',
  apiConfig: {
    provider: 'NUBEFACT',
    endpointUrl: '',
    token: '',
    authHeaderName: 'Authorization',
    authPrefix: 'Token token=',
    modoSimulacion: true,
    serieFacturaApi: 'FFF1',
    serieBoletaApi: 'BBB1',
  },
};

export function loadConfig(): EmpresaEmisoraConfig {
  try {
    const raw = localStorage.getItem(KEYS.CONFIG);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<EmpresaEmisoraConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      apiConfig: {
        ...DEFAULT_CONFIG.apiConfig,
        ...(parsed.apiConfig || {}),
      },
      conceptosRapidos:
        Array.isArray(parsed.conceptosRapidos) && parsed.conceptosRapidos.length
          ? parsed.conceptosRapidos
          : DEFAULT_CONFIG.conceptosRapidos,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: EmpresaEmisoraConfig): void {
  localStorage.setItem(KEYS.CONFIG, JSON.stringify(cfg));
}

export function loadComprobantes(): ComprobanteRecord[] {
  try {
    const raw = localStorage.getItem(KEYS.COMPROBANTES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ComprobanteRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveComprobantes(records: ComprobanteRecord[]): void {
  localStorage.setItem(KEYS.COMPROBANTES, JSON.stringify(records));
}

export function loadClientes(): ClienteFrecuente[] {
  try {
    const raw = localStorage.getItem(KEYS.CLIENTES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClienteFrecuente[]) : [];
  } catch {
    return [];
  }
}

export function saveClientes(clientes: ClienteFrecuente[]): void {
  localStorage.setItem(KEYS.CLIENTES, JSON.stringify(clientes));
}

// ============================================================
// IndexedDB para almacenar binarios de PDFs oficiales SUNAT
// ============================================================
const DB_NAME = 'penafact_pdf_vault_v1';
const STORE_NAME = 'pdfs';

function openPdfDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePdfBlob(id: string, blob: Blob, fileName: string): Promise<void> {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, blob, fileName, savedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPdfBlob(id: string): Promise<{ blob: Blob; fileName: string } | null> {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => {
      const res = req.result as { blob: Blob; fileName: string } | undefined;
      resolve(res ? { blob: res.blob, fileName: res.fileName } : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deletePdfBlob(id: string): Promise<void> {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllPdfBlobs(): Promise<void> {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================
// Datos de demostración realistas para probar en 5 segundos
// ============================================================
export function createDemoWorkspace(): {
  comprobantes: ComprobanteRecord[];
  clientes: ClienteFrecuente[];
} {
  const hoy = getHoyPeruISO();
  const now = new Date().toISOString();

  const clientes: ClienteFrecuente[] = [
    {
      id: 'cli-1',
      tipoDoc: '6',
      numeroDoc: '20100047218',
      razonSocial: 'BANCO DE CREDITO DEL PERU (EJEMPLO AGENCIA CORPORATIVA)',
      alias: 'BCP Corp',
      direccion: 'Calle Centenario 156, La Molina, Lima',
      email: 'facturacion@ejemplo-turismo.pe',
      creadoEn: now,
    },
    {
      id: 'cli-2',
      tipoDoc: '6',
      numeroDoc: '20131312955',
      razonSocial: 'INCA TRAILS & FOLKLORE TOURS S.A.C. (DEMO)',
      alias: 'Inca Trails',
      direccion: 'Av. Pardo 540, Miraflores, Lima',
      email: 'contabilidad@incatrails-demo.pe',
      creadoEn: now,
    },
    {
      id: 'cli-3',
      tipoDoc: '6',
      numeroDoc: '20100128056',
      razonSocial: 'ANDES EXPERIENCE TRAVEL E.I.R.L. (DEMO)',
      alias: 'Andes Travel',
      direccion: 'Av. El Sol 812, Cusco',
      email: 'pagos@andestravel-demo.pe',
      creadoEn: now,
    },
  ];

  const comprobantes: ComprobanteRecord[] = [
    {
      id: 'demo-1',
      notaInterna: 'N-001',
      tipoComprobante: '01',
      fechaConsumo: '2026-11-05',
      fechaEmisionSunat: hoy,
      serieSunat: 'E001',
      numeroSunat: '',
      tipoDocCliente: '6',
      numeroDocCliente: '20100047218',
      razonSocialCliente: 'BANCO DE CREDITO DEL PERU (EJEMPLO AGENCIA CORPORATIVA)',
      direccionCliente: 'Calle Centenario 156, La Molina, Lima',
      emailCliente: 'facturacion@ejemplo-turismo.pe',
      moneda: 'PEN',
      tipoCambio: 3.75,
      modoCalculo: 'INCLUYE_IGV',
      tasaIgv: 18,
      recargoConsumoPct: 0,
      descuentoGlobal: 0,
      formaPago: 'CONTADO',
      incluirRefFechaEnDesc: true,
      observaciones: 'Grupo de 4 turistas - Mesa 12',
      items: [
        {
          id: 'it-1',
          unidad: 'ZZ',
          descripcion: 'Cena Show Folklórico Turístico (4 personas)',
          cantidad: 4,
          montoIngresado: 480,
          esTotalLinea: true,
          afectacion: '10',
        },
      ],
      estado: 'PENDIENTE',
      creadoEn: now,
      actualizadoEn: now,
    },
    {
      id: 'demo-2',
      notaInterna: 'N-002',
      tipoComprobante: '03',
      fechaConsumo: '2026-11-08',
      fechaEmisionSunat: hoy,
      serieSunat: 'EB01',
      numeroSunat: '',
      tipoDocCliente: '0',
      numeroDocCliente: '-',
      razonSocialCliente: 'CLIENTES VARIOS',
      direccionCliente: '',
      emailCliente: '',
      moneda: 'PEN',
      tipoCambio: 3.75,
      modoCalculo: 'INCLUYE_IGV',
      tasaIgv: 18,
      recargoConsumoPct: 0,
      descuentoGlobal: 0,
      formaPago: 'CONTADO',
      incluirRefFechaEnDesc: true,
      observaciones: 'Caso clásico S/ 100.00 (redondeo exacto SUNAT SOL)',
      items: [
        {
          id: 'it-2',
          unidad: 'ZZ',
          descripcion: 'Consumo de Alimentos y Bebidas - Peña Show',
          cantidad: 1,
          montoIngresado: 100,
          esTotalLinea: true,
          afectacion: '10',
        },
      ],
      estado: 'PENDIENTE',
      creadoEn: now,
      actualizadoEn: now,
    },
    {
      id: 'demo-3',
      notaInterna: 'N-003',
      tipoComprobante: '01',
      fechaConsumo: '2026-11-14',
      fechaEmisionSunat: hoy,
      serieSunat: 'E001',
      numeroSunat: '000041',
      tipoDocCliente: '6',
      numeroDocCliente: '20131312955',
      razonSocialCliente: 'INCA TRAILS & FOLKLORE TOURS S.A.C. (DEMO)',
      direccionCliente: 'Av. Pardo 540, Miraflores, Lima',
      emailCliente: 'contabilidad@incatrails-demo.pe',
      moneda: 'PEN',
      tipoCambio: 3.75,
      modoCalculo: 'INCLUYE_IGV',
      tasaIgv: 10.5,
      recargoConsumoPct: 0,
      descuentoGlobal: 0,
      formaPago: 'CONTADO',
      incluirRefFechaEnDesc: true,
      observaciones: 'Ejemplo con tasa especial MYPE Restaurantes 10.5% (2026)',
      items: [
        {
          id: 'it-3a',
          unidad: 'ZZ',
          descripcion: 'Cena Show Folklórico Turístico (Grupo 8 pax)',
          cantidad: 8,
          montoIngresado: 960,
          esTotalLinea: true,
          afectacion: '10',
        },
        {
          id: 'it-3b',
          unidad: 'ZZ',
          descripcion: 'Consumo de Bebidas y Coctelería (Pisco Sour)',
          cantidad: 6,
          montoIngresado: 180,
          esTotalLinea: true,
          afectacion: '10',
        },
      ],
      estado: 'EMITIDO',
      creadoEn: now,
      actualizadoEn: now,
    },
    {
      id: 'demo-4',
      notaInterna: 'N-004',
      tipoComprobante: '03',
      fechaConsumo: '2026-11-19',
      fechaEmisionSunat: hoy,
      serieSunat: 'EB01',
      numeroSunat: '',
      tipoDocCliente: '7',
      numeroDocCliente: 'US8942105',
      razonSocialCliente: 'JOHNATHAN MILLER (TURISTA USA)',
      direccionCliente: '',
      emailCliente: '',
      moneda: 'PEN',
      tipoCambio: 3.75,
      modoCalculo: 'INCLUYE_IGV',
      tasaIgv: 18,
      recargoConsumoPct: 0,
      descuentoGlobal: 0,
      formaPago: 'CONTADO',
      incluirRefFechaEnDesc: true,
      observaciones: 'Boleta >= S/ 700 con Pasaporte (cumple regla SUNAT)',
      items: [
        {
          id: 'it-4',
          unidad: 'ZZ',
          descripcion: 'Cena VIP Peña Show + Botella Pisco Quebranta',
          cantidad: 1,
          montoIngresado: 750,
          esTotalLinea: true,
          afectacion: '10',
        },
      ],
      estado: 'PENDIENTE',
      creadoEn: now,
      actualizadoEn: now,
    },
    {
      id: 'demo-5',
      notaInterna: 'N-005',
      tipoComprobante: '01',
      fechaConsumo: '2026-11-21',
      fechaEmisionSunat: hoy,
      serieSunat: 'E001',
      numeroSunat: '',
      tipoDocCliente: '6',
      numeroDocCliente: '20100128056',
      razonSocialCliente: 'ANDES EXPERIENCE TRAVEL E.I.R.L. (DEMO)',
      direccionCliente: 'Av. El Sol 812, Cusco',
      emailCliente: 'pagos@andestravel-demo.pe',
      moneda: 'PEN',
      tipoCambio: 3.75,
      modoCalculo: 'MAS_IGV',
      tasaIgv: 18,
      recargoConsumoPct: 0,
      descuentoGlobal: 0,
      formaPago: 'CONTADO',
      incluirRefFechaEnDesc: true,
      observaciones: 'Ejemplo de modo "Monto Neto + 18% IGV adicional"',
      items: [
        {
          id: 'it-5',
          unidad: 'ZZ',
          descripcion: 'Reserva Privada Peña Show Grupo Europeo',
          cantidad: 1,
          montoIngresado: 1200,
          esTotalLinea: true,
          afectacion: '10',
        },
      ],
      estado: 'PENDIENTE',
      creadoEn: now,
      actualizadoEn: now,
    },
  ];

  return { comprobantes, clientes };
}
