import type {
  ComprobanteRecord,
  EsquemaCarpetas,
  FechaBaseCarpeta,
  TipoComprobante,
} from '../types/sunat';
import { calculateComprobante, formatFixed } from './sunatMath';

const MESES_ES = [
  '01_Enero',
  '02_Febrero',
  '03_Marzo',
  '04_Abril',
  '05_Mayo',
  '06_Junio',
  '07_Julio',
  '08_Agosto',
  '09_Septiembre',
  '10_Octubre',
  '11_Noviembre',
  '12_Diciembre',
];

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const DIAS_ES = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

export function sanitizeFolderSegment(raw: string, maxLen = 44): string {
  const cleaned = (raw || 'SIN_DATO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.\-]+|[_.\-]+$/g, '');
  return (cleaned || 'SIN_DATO').slice(0, maxLen);
}

/**
 * Calcula información completa de Año, Mes, Semana ISO y Día para una fecha YYYY-MM-DD.
 */
export function getFechaJerarquia(fechaISO: string): {
  anio: string;
  mesCarpeta: string;
  semanaNumero: number;
  semanaCarpeta: string;
  diaCarpeta: string;
  fechaLimpia: string;
} {
  const [y, m, d] = (fechaISO || '2026-11-01').split('-').map(Number);
  const year = y || 2026;
  const month = Math.min(12, Math.max(1, m || 1));
  const day = Math.min(31, Math.max(1, d || 1));

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utcDate.getUTCDay(); // 0 dom .. 6 sab

  // Cálculo Semana ISO-8601 (Lunes a Domingo)
  const tmp = new Date(utcDate.getTime());
  const isoDay = (dayOfWeek + 6) % 7; // 0 lun .. 6 dom
  tmp.setUTCDate(tmp.getUTCDate() - isoDay + 3);
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const semanaNumero =
    1 + Math.round(((tmp.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);

  // Rango Lunes - Domingo de la semana
  const monday = new Date(utcDate.getTime());
  monday.setUTCDate(utcDate.getUTCDate() - isoDay);
  const sunday = new Date(monday.getTime());
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const monStr = `${String(monday.getUTCDate()).padStart(2, '0')}${MESES_CORTOS[monday.getUTCMonth()]}`;
  const sunStr = `${String(sunday.getUTCDate()).padStart(2, '0')}${MESES_CORTOS[sunday.getUTCMonth()]}`;

  const fechaLimpia = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const nombreDia = DIAS_ES[dayOfWeek] || 'Dia';

  return {
    anio: String(year),
    mesCarpeta: MESES_ES[month - 1] || `${String(month).padStart(2, '0')}_Mes`,
    semanaNumero,
    semanaCarpeta: `Semana_${String(semanaNumero).padStart(2, '0')}_(${monStr}-${sunStr})`,
    diaCarpeta: `${fechaLimpia}_${nombreDia}`,
    fechaLimpia,
  };
}

export function getTipoCarpeta(tipo: TipoComprobante): string {
  switch (tipo) {
    case '01':
      return 'Facturas';
    case '03':
      return 'Boletas';
    case '07':
      return 'Notas_Credito';
    case '08':
      return 'Notas_Debito';
  }
}

export function getTipoNombreCorto(tipo: TipoComprobante): string {
  switch (tipo) {
    case '01':
      return 'FACTURA';
    case '03':
      return 'BOLETA';
    case '07':
      return 'NC';
    case '08':
      return 'ND';
  }
}

/**
 * Genera el nombre de archivo PDF estandarizado y limpio para Windows/macOS.
 * Ejemplo: E001-000045_2026-11-18_PERU_TOURS_SAC_S450.00.pdf
 */
export function buildCleanPdfFileName(rec: ComprobanteRecord, fechaBase: FechaBaseCarpeta): string {
  const calc = calculateComprobante(rec);
  const fecha = fechaBase === 'EMISION_SUNAT' ? rec.fechaEmisionSunat : rec.fechaConsumo;
  const serieNum =
    rec.serieSunat && rec.numeroSunat
      ? `${rec.serieSunat}-${rec.numeroSunat.padStart(6, '0')}`
      : `${getTipoNombreCorto(rec.tipoComprobante)}_${sanitizeFolderSegment(rec.notaInterna || rec.id.slice(0, 6), 16)}`;
  const cliente = sanitizeFolderSegment(rec.razonSocialCliente || 'CLIENTES_VARIOS', 28);
  const currPrefix = rec.moneda === 'USD' ? 'USD' : 'S';
  const monto = formatFixed(calc.importeTotal, 2);
  return `${serieNum}_${fecha}_${cliente}_${currPrefix}${monto}.pdf`;
}

export function getEmpresaCarpeta(rec: ComprobanteRecord): string {
  const nombre = sanitizeFolderSegment(rec.razonSocialCliente || 'CLIENTES_VARIOS', 36);
  const doc = rec.numeroDocCliente && rec.numeroDocCliente !== '-' ? `_(${rec.numeroDocCliente})` : '';
  return `${nombre}${doc}`;
}

/**
 * Devuelve una o más rutas relativas de carpeta (según esquema elegido) donde debe guardarse el PDF.
 * En esquema SUPER_DUAL devuelve múltiples rutas (Por Fecha + Por Empresa + Por Tipo).
 */
export function resolveFolderPaths(
  rec: ComprobanteRecord,
  esquema: EsquemaCarpetas,
  fechaBase: FechaBaseCarpeta
): string[] {
  const fechaStr = fechaBase === 'EMISION_SUNAT' ? rec.fechaEmisionSunat : rec.fechaConsumo;
  const f = getFechaJerarquia(fechaStr);
  const tipoDir = getTipoCarpeta(rec.tipoComprobante);
  const empresaDir = getEmpresaCarpeta(rec);

  switch (esquema) {
    case 'COMPLETO_TEMPORAL':
      return [`${f.anio}/${f.mesCarpeta}/${f.semanaCarpeta}/${f.diaCarpeta}/${tipoDir}`];
    case 'ANIO_MES_DIA':
      return [`${f.anio}/${f.mesCarpeta}/${f.diaCarpeta}`];
    case 'ANIO_MES_TIPO':
      return [`${f.anio}/${f.mesCarpeta}/${tipoDir}`];
    case 'POR_EMPRESA':
      return [`Por_Empresa/${empresaDir}/${f.anio}/${f.mesCarpeta}`];
    case 'SUPER_DUAL':
      return [
        `01_Por_Fecha/${f.anio}/${f.mesCarpeta}/${f.semanaCarpeta}/${f.diaCarpeta}`,
        `02_Por_Empresa/${empresaDir}/${f.anio}/${f.mesCarpeta}`,
        `03_Por_Tipo/${tipoDir}/${f.anio}/${f.mesCarpeta}`,
      ];
  }
}

export interface FolderTreeNode {
  name: string;
  path: string;
  children: FolderTreeNode[];
  files: Array<{ name: string; comprobanteId: string; hasOfficialPdf: boolean }>;
}

/**
 * Construye un árbol visual de carpetas para vista previa en vivo antes de exportar a disco o ZIP.
 */
export function buildFolderTreePreview(
  records: ComprobanteRecord[],
  esquema: EsquemaCarpetas,
  fechaBase: FechaBaseCarpeta
): FolderTreeNode {
  const root: FolderTreeNode = {
    name: 'Facturacion_PenaShow_SUNAT',
    path: '',
    children: [],
    files: [],
  };

  const ensureDir = (parent: FolderTreeNode, segments: string[]): FolderTreeNode => {
    let curr = parent;
    let builtPath = parent.path;
    for (const seg of segments) {
      builtPath = builtPath ? `${builtPath}/${seg}` : seg;
      let child = curr.children.find((c) => c.name === seg);
      if (!child) {
        child = { name: seg, path: builtPath, children: [], files: [] };
        curr.children.push(child);
      }
      curr = child;
    }
    return curr;
  };

  for (const rec of records) {
    if (rec.estado === 'ANULADO') continue;
    const dirs = resolveFolderPaths(rec, esquema, fechaBase);
    const fileName = buildCleanPdfFileName(rec, fechaBase);
    for (const dir of dirs) {
      const node = ensureDir(root, dir.split('/').filter(Boolean));
      node.files.push({
        name: fileName,
        comprobanteId: rec.id,
        hasOfficialPdf: Boolean(rec.pdfAdjunto?.esOficialSunat),
      });
    }
  }

  const sortNode = (node: FolderTreeNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sortNode);
  };
  sortNode(root);

  return root;
}
