export type TipoComprobante = '01' | '03' | '07' | '08'; // 01 Factura, 03 Boleta, 07 Nota Crédito, 08 Nota Débito

export type TipoDocIdentidad =
  | '6' // RUC
  | '1' // DNI
  | '4' // Carnet de Extranjería
  | '7' // Pasaporte
  | '0'; // Sin documento / Clientes Varios

export type Moneda = 'PEN' | 'USD';

export type ModoCalculoIGV =
  | 'INCLUYE_IGV' // El monto anotado en la boleta física SE MANTIENE como Total Final (se desglosa Base + IGV)
  | 'MAS_IGV'; // El monto anotado en la boleta física es Neto sin IGV y se le SUMA el IGV

export type AfectacionIGV =
  | '10' // Gravado - Operación Onerosa
  | '20' // Exonerado - Operación Onerosa
  | '30'; // Inafecto - Operación Onerosa

export type FormaPago = 'CONTADO' | 'CREDITO';

export type EstadoComprobante =
  | 'PENDIENTE' // Anotado de la boleta física, listo para emitir
  | 'EN_PROCESO' // Siendo llenado en Portal SUNAT SOL
  | 'EMITIDO' // Ya emitido en SUNAT (con Serie-Número)
  | 'ARCHIVADO' // Emitido + PDF oficial de SUNAT adjuntado y verificado
  | 'ANULADO'; // Dado de baja / Nota de crédito

export interface ComprobanteItem {
  id: string;
  codigo?: string;
  unidad: string; // 'ZZ' Servicio, 'NIU' Unidad
  descripcion: string;
  cantidad: number;
  /** Monto ingresado por el usuario para esta línea según modoCalculo (Total de línea si INCLUYE_IGV, o Valor unitario/subtotal si MAS_IGV). */
  montoIngresado: number;
  /** Si el montoIngresado corresponde al total de la línea (true) o precio unitario (false). */
  esTotalLinea: boolean;
  afectacion: AfectacionIGV;
}

export interface ItemCalculado extends ComprobanteItem {
  valorUnitarioExacto: number; // Hasta 10 decimales exactos para Portal SUNAT SOL
  valorUnitarioSunatStr: string; // String formateado óptimo para copiar y pegar en SUNAT SOL
  precioUnitarioConIgv: number;
  valorVenta: number; // Base imponible de la línea (2 dec)
  igvLinea: number; // IGV de la línea (2 dec)
  totalLinea: number; // Total final de la línea (2 dec)
  cuadreExactoSol: boolean;
  notaRedondeo?: string;
}

export interface ResumenCalculo {
  items: ItemCalculado[];
  opGravada: number;
  opExonerada: number;
  opInafecta: number;
  descuentoGlobal: number;
  igvTotal: number;
  recargoConsumoPorcentaje: number;
  recargoConsumoMonto: number;
  importeTotal: number;
  tasaIgvPorcentaje: number;
  montoEnLetras: string;
  cuadreExacto: boolean;
  diferenciaCentimos: number;
  advertenciasRedondeo: string[];
}

export interface ClienteFrecuente {
  id: string;
  tipoDoc: TipoDocIdentidad;
  numeroDoc: string;
  razonSocial: string;
  alias?: string;
  direccion?: string;
  email?: string;
  telefono?: string;
  notas?: string;
  creadoEn: string;
}

export interface PdfAdjuntoMeta {
  id: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  esOficialSunat: boolean;
  parsedSummary?: {
    serieNumero?: string;
    fechaEmision?: string;
    rucCliente?: string;
    razonSocial?: string;
    total?: number;
    igv?: number;
  };
}

export interface ComprobanteRecord {
  id: string;
  /** Número de la nota/boleta informal escrita en papel (ej. "N-001", "0145") */
  notaInterna: string;
  /** Notas consolidadas si se agruparon varias boletas escritas en 1 comprobante */
  notasConsolidadas?: string[];
  tipoComprobante: TipoComprobante;
  /** Fecha de operación / consumo registrada en el documento interno (YYYY-MM-DD) */
  fechaConsumo: string;
  /** Fecha legal de emisión en SUNAT (YYYY-MM-DD) */
  fechaEmisionSunat: string;
  serieSunat: string; // ej. E001, EB01, F001, B001
  numeroSunat: string; // ej. 00000142
  tipoDocCliente: TipoDocIdentidad;
  numeroDocCliente: string;
  razonSocialCliente: string;
  direccionCliente: string;
  emailCliente: string;
  moneda: Moneda;
  tipoCambio: number;
  modoCalculo: ModoCalculoIGV;
  tasaIgv: number; // ej. 18, 10.5, 10, 15, 0 o personalizada
  recargoConsumoPct: number; // ej. 0 o 10 (Ley 25988, no gravado IGV)
  descuentoGlobal: number;
  formaPago: FormaPago;
  incluirRefFechaEnDesc: boolean;
  observaciones: string;
  items: ComprobanteItem[];
  estado: EstadoComprobante;
  pdfAdjunto?: PdfAdjuntoMeta;
  apiResponse?: {
    provider: string;
    enlacePdf?: string;
    enlaceXml?: string;
    enlaceCdr?: string;
    codigoHash?: string;
    aceptadaSunat?: boolean;
    enviadoEn: string;
  };
  creadoEn: string;
  actualizadoEn: string;
}

export type EsquemaCarpetas =
  | 'COMPLETO_TEMPORAL' // Año / Mes / Semana / Día
  | 'ANIO_MES_DIA' // Año / Mes / Día
  | 'ANIO_MES_TIPO' // Año / Mes / Facturas|Boletas
  | 'POR_EMPRESA' // Por_Empresa / Empresa / Año / Mes
  | 'SUPER_DUAL'; // 01_Por_Fecha (Año/Mes/Semana/Día) + 02_Por_Empresa + 03_Por_Tipo + 00_Reportes

export type FechaBaseCarpeta = 'CONSUMO' | 'EMISION_SUNAT';

export interface ApiProviderConfig {
  provider: 'NUBEFACT' | 'APISUNAT' | 'CUSTOM';
  endpointUrl: string;
  token: string;
  authHeaderName: string;
  authPrefix: string;
  modoSimulacion: boolean;
  serieFacturaApi: string;
  serieBoletaApi: string;
}

export interface EmpresaEmisoraConfig {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccion: string;
  distrito: string;
  serieFacturaSol: string; // Default E001
  serieBoletaSol: string; // Default EB01
  serieNcSol: string; // Default E001
  correlativoFactura: number;
  correlativoBoleta: number;
  tasaIgvDefecto: number; // 18 o 10.5
  modoCalculoDefecto: ModoCalculoIGV;
  recargoConsumoDefecto: number;
  incluirRefFechaDefecto: boolean;
  conceptosRapidos: string[];
  tokenConsultaDoc: string; // Opcional apis.net.pe v2
  esquemaCarpetasDefecto: EsquemaCarpetas;
  fechaBaseCarpeta: FechaBaseCarpeta;
  apiConfig: ApiProviderConfig;
}

export interface AlertaTributaria {
  nivel: 'error' | 'warning' | 'info';
  codigo: string;
  mensaje: string;
  sugerencia?: string;
}
