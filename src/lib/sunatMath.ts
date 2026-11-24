import type {
  ComprobanteItem,
  ComprobanteRecord,
  ItemCalculado,
  ModoCalculoIGV,
  Moneda,
  ResumenCalculo,
} from '../types/sunat';

/**
 * Redondeo financiero Half-Up exacto (estándar SUNAT UBL 2.1) evitando errores de IEEE-754.
 */
export function roundSunat(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  // Pequeño épsilon para corregir representaciones binarias como 1.005 -> 1.0049999999999999
  const shifted = abs * factor + 1e-10;
  return (sign * Math.floor(shifted + 0.5)) / factor;
}

export function formatMoney(value: number, moneda: Moneda = 'PEN'): string {
  const symbol = moneda === 'USD' ? 'US$ ' : 'S/ ';
  return `${symbol}${roundSunat(value, 2).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatFixed(value: number, decimals = 2): string {
  return roundSunat(value, decimals).toFixed(decimals);
}

/**
 * Evalúa expresiones matemáticas básicas de calculadora (+, -, *, /, paréntesis) de forma segura sin eval().
 * Ejemplo: "120 + 85 + 45" -> 250, "3 * 80 + 25" -> 265.
 */
export function evaluateSafeMathExpr(raw: string): number {
  const normalized = (raw || '')
    .replace(/,/g, '.')
    .replace(/[xX×]/g, '*')
    .replace(/÷/g, '/')
    .replace(/\s+/g, '');
  if (!normalized) return 0;
  // Solo permitir dígitos, puntos, operadores básicos y paréntesis
  if (!/^[0-9+\-*/().]+$/.test(normalized)) {
    const fallback = parseFloat(normalized.replace(/[^0-9.]/g, ''));
    return Number.isFinite(fallback) ? fallback : 0;
  }

  // Tokenizador + parser descendente recursivo (shunting-yard / Pratt simple)
  const tokens = normalized.match(/\d*\.?\d+|[+\-*/()]/g);
  if (!tokens) return 0;
  let pos = 0;

  const parseExpr = (): number => {
    let val = parseTerm();
    while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
      const op = tokens[pos++];
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  };

  const parseTerm = (): number => {
    let val = parseFactor();
    while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/')) {
      const op = tokens[pos++];
      const rhs = parseFactor();
      val = op === '*' ? val * rhs : rhs !== 0 ? val / rhs : 0;
    }
    return val;
  };

  const parseFactor = (): number => {
    if (tokens[pos] === '+') {
      pos++;
      return parseFactor();
    }
    if (tokens[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    if (tokens[pos] === '(') {
      pos++;
      const val = parseExpr();
      if (tokens[pos] === ')') pos++;
      return val;
    }
    const num = parseFloat(tokens[pos++] || '0');
    return Number.isFinite(num) ? num : 0;
  };

  const result = parseExpr();
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

export interface DecimalPrecisionCheck {
  decimals: number;
  vu: number;
  vuStr: string;
  valorVentaExact: number;
  valorVenta2: number;
  igvExact: number;
  igv2: number;
  totalSunat: number;
  cuadraExacto: boolean;
  diferencia: number;
}

/**
 * Simula exactamente cómo calcula y redondea Portal SUNAT SEE-SOL para una precisión de N decimales.
 */
export function simulateSunatDecimals(
  exactValorUnitario: number,
  cantidad: number,
  tasaDecimal: number,
  targetTotalLinea: number,
  decimals: number
): DecimalPrecisionCheck {
  const safeQty = cantidad > 0 ? cantidad : 1;
  const vu = roundSunat(exactValorUnitario, decimals);
  const vuStr = vu.toFixed(decimals);
  const valorVentaExact = vu * safeQty;
  const valorVenta2 = roundSunat(valorVentaExact, 2);
  const igvExact = valorVentaExact * tasaDecimal;
  const igv2 = roundSunat(igvExact, 2);
  const totalSunat = roundSunat(valorVenta2 + igv2, 2);
  const diferencia = roundSunat(totalSunat - targetTotalLinea, 2);

  return {
    decimals,
    vu,
    vuStr,
    valorVentaExact,
    valorVenta2,
    igvExact,
    igv2,
    totalSunat,
    cuadraExacto: Math.abs(diferencia) < 0.001,
    diferencia,
  };
}

/**
 * Formatea el Valor Unitario para copiar y pegar en Portal SUNAT SOL.
 * Usa al menos 4 decimales (4, 6, 8 o 10) salvo cuando el valor exacto ya es entero/2 dec exactos,
 * garantizando cuadre exacto al céntimo en SUNAT SEE-SOL.
 */
export function findOptimalValorUnitarioForSunat(
  exactValorUnitario: number,
  cantidad: number,
  tasaDecimal: number,
  targetTotalLinea: number,
  minDecimals = 4
): {
  valorUnitarioOptimo: number;
  valorUnitarioStr: string;
  cuadraExacto: boolean;
  notaRedondeo?: string;
} {
  const safeQty = cantidad > 0 ? cantidad : 1;
  if (tasaDecimal <= 0) {
    const vu = roundSunat(exactValorUnitario, Math.max(minDecimals, 4));
    const simulated = roundSunat(vu * safeQty, 2);
    return {
      valorUnitarioOptimo: vu,
      valorUnitarioStr: vu.toFixed(minDecimals),
      cuadraExacto: Math.abs(simulated - targetTotalLinea) < 0.001,
    };
  }

  // Evaluamos precisiones desde minDecimals (por defecto 4) hacia arriba: [4, 6, 8, 10]
  const basePrecisions = [3, 4, 6, 8, 10].filter((d) => d >= minDecimals);
  const precisions = basePrecisions.length ? basePrecisions : [4, 6, 8, 10];
  let bestSolMatch: { vu: number; dec: number } | null = null;

  for (const dec of precisions) {
    const check = simulateSunatDecimals(
      exactValorUnitario,
      safeQty,
      tasaDecimal,
      targetTotalLinea,
      dec
    );
    if (check.cuadraExacto) {
      bestSolMatch = { vu: check.vu, dec };
      break;
    }
  }

  if (bestSolMatch) {
    const isExactAt2 = Math.abs(exactValorUnitario - roundSunat(exactValorUnitario, 2)) < 1e-8;
    const decToShow = isExactAt2 ? Math.min(2, minDecimals) : bestSolMatch.dec;
    return {
      valorUnitarioOptimo: bestSolMatch.vu,
      valorUnitarioStr: bestSolMatch.vu.toFixed(Math.max(decToShow, isExactAt2 ? 2 : minDecimals)),
      cuadraExacto: true,
      notaRedondeo:
        bestSolMatch.dec >= 4
          ? `Usa ${bestSolMatch.dec} decimales en Portal SUNAT SOL para evitar diferencias de ±S/ 0.01.`
          : undefined,
    };
  }

  const fallback = roundSunat(exactValorUnitario, 10);
  return {
    valorUnitarioOptimo: fallback,
    valorUnitarioStr: fallback.toFixed(6),
    cuadraExacto: false,
    notaRedondeo:
      'Verifica el total final en pantalla SUNAT; si difiere en S/ 0.01 por redondeo tributario, prueba con 6 u 8 decimales.',
  };
}

function trimTrailingZeros(num: number, minDecimals: number, maxDecimals: number): string {
  const fixed = num.toFixed(maxDecimals);
  const [intPart, decPart = ''] = fixed.split('.');
  let trimmed = decPart.replace(/0+$/, '');
  if (trimmed.length < minDecimals) {
    trimmed = trimmed.padEnd(minDecimals, '0');
  }
  return `${intPart}.${trimmed}`;
}

/**
 * Calcula una línea individual con máxima precisión SUNAT.
 */
export function calculateItem(
  item: ComprobanteItem,
  modoCalculo: ModoCalculoIGV,
  tasaIgvPorcentaje: number
): ItemCalculado {
  const cantidad = item.cantidad > 0 ? item.cantidad : 1;
  const monto = Number.isFinite(item.montoIngresado) && item.montoIngresado >= 0 ? item.montoIngresado : 0;
  const isGravado = item.afectacion === '10';
  const tasaDecimal = isGravado ? Math.max(0, tasaIgvPorcentaje) / 100 : 0;

  let valorVenta = 0;
  let igvLinea = 0;
  let totalLinea = 0;
  let valorUnitarioExacto = 0;
  let precioUnitarioConIgv = 0;
  let cuadreExactoSol = true;
  let notaRedondeo: string | undefined;

  if (modoCalculo === 'INCLUYE_IGV') {
    // El monto escrito se MANTIENE como Total Final con IGV incluido
    totalLinea = item.esTotalLinea ? roundSunat(monto, 2) : roundSunat(monto * cantidad, 2);
    precioUnitarioConIgv = roundSunat(totalLinea / cantidad, 6);

    if (tasaDecimal > 0) {
      const baseExactaTotal = totalLinea / (1 + tasaDecimal);
      valorUnitarioExacto = baseExactaTotal / cantidad;
      valorVenta = roundSunat(baseExactaTotal, 2);
      // En modo "Mantener Total", IGV = Total - ValorVenta garantiza suma exacta al céntimo
      igvLinea = roundSunat(totalLinea - valorVenta, 2);

      const opt = findOptimalValorUnitarioForSunat(
        valorUnitarioExacto,
        cantidad,
        tasaDecimal,
        totalLinea
      );
      valorUnitarioExacto = opt.valorUnitarioOptimo;
      cuadreExactoSol = opt.cuadraExacto;
      notaRedondeo = opt.notaRedondeo;

      return {
        ...item,
        cantidad,
        valorUnitarioExacto,
        valorUnitarioSunatStr: opt.valorUnitarioStr,
        precioUnitarioConIgv,
        valorVenta,
        igvLinea,
        totalLinea,
        cuadreExactoSol,
        notaRedondeo,
      };
    } else {
      valorVenta = totalLinea;
      igvLinea = 0;
      valorUnitarioExacto = roundSunat(totalLinea / cantidad, 6);
      return {
        ...item,
        cantidad,
        valorUnitarioExacto,
        valorUnitarioSunatStr: trimTrailingZeros(valorUnitarioExacto, 2, 6),
        precioUnitarioConIgv,
        valorVenta,
        igvLinea,
        totalLinea,
        cuadreExactoSol: true,
      };
    }
  } else {
    // MODO MAS_IGV: El monto ingresado es Valor Neto SIN IGV, se suma el IGV encima
    const baseTotal = item.esTotalLinea ? monto : monto * cantidad;
    valorVenta = roundSunat(baseTotal, 2);
    valorUnitarioExacto = roundSunat(baseTotal / cantidad, 6);
    igvLinea = roundSunat(valorVenta * tasaDecimal, 2);
    totalLinea = roundSunat(valorVenta + igvLinea, 2);
    precioUnitarioConIgv = roundSunat(valorUnitarioExacto * (1 + tasaDecimal), 6);

    return {
      ...item,
      cantidad,
      valorUnitarioExacto,
      valorUnitarioSunatStr: trimTrailingZeros(valorUnitarioExacto, 2, 6),
      precioUnitarioConIgv,
      valorVenta,
      igvLinea,
      totalLinea,
      cuadreExactoSol: true,
    };
  }
}

/**
 * Calcula todos los totales tributarios del comprobante completo.
 */
export function calculateComprobante(
  input: Pick<
    ComprobanteRecord,
    'items' | 'modoCalculo' | 'tasaIgv' | 'recargoConsumoPct' | 'descuentoGlobal' | 'moneda'
  >
): ResumenCalculo {
  const tasa = Math.max(0, Number.isFinite(input.tasaIgv) ? input.tasaIgv : 18);
  const tasaDecimal = tasa / 100;
  const calculatedItems = input.items.map((it) => calculateItem(it, input.modoCalculo, tasa));

  let opGravada = 0;
  let opExonerada = 0;
  let opInafecta = 0;
  let igvItems = 0;
  let sumaTotalesItems = 0;
  const advertenciasRedondeo: string[] = [];

  for (const it of calculatedItems) {
    if (it.afectacion === '10') opGravada += it.valorVenta;
    else if (it.afectacion === '20') opExonerada += it.valorVenta;
    else opInafecta += it.valorVenta;

    igvItems += it.igvLinea;
    sumaTotalesItems += it.totalLinea;
    if (it.notaRedondeo) {
      advertenciasRedondeo.push(`${it.descripcion || 'Ítem'}: ${it.notaRedondeo}`);
    }
  }

  opGravada = roundSunat(opGravada, 2);
  opExonerada = roundSunat(opExonerada, 2);
  opInafecta = roundSunat(opInafecta, 2);

  // Descuento global (afecta base gravada antes de IGV)
  const descuentoGlobal = roundSunat(Math.max(0, input.descuentoGlobal || 0), 2);
  let opGravadaFinal = opGravada;
  let igvTotal = roundSunat(igvItems, 2);

  if (descuentoGlobal > 0 && opGravada > 0) {
    opGravadaFinal = roundSunat(Math.max(0, opGravada - descuentoGlobal), 2);
    igvTotal = roundSunat(opGravadaFinal * tasaDecimal, 2);
  }

  // Recargo al Consumo (Ley 25988 — Restaurantes/Hoteles en Perú):
  // Se calcula sobre la base imponible / consumo y NO forma parte de la base del IGV.
  const recargoPct = Math.max(0, Number.isFinite(input.recargoConsumoPct) ? input.recargoConsumoPct : 0);
  const baseConsumo = roundSunat(opGravadaFinal + opExonerada + opInafecta, 2);
  const recargoConsumoMonto = recargoPct > 0 ? roundSunat(baseConsumo * (recargoPct / 100), 2) : 0;

  const importeTotal = roundSunat(
    opGravadaFinal + opExonerada + opInafecta + igvTotal + recargoConsumoMonto,
    2
  );

  // En modo INCLUYE_IGV sin descuento ni recargo, verificamos cuadre contra suma de montos objetivo
  let diferenciaCentimos = 0;
  if (input.modoCalculo === 'INCLUYE_IGV' && descuentoGlobal === 0 && recargoPct === 0) {
    diferenciaCentimos = roundSunat(importeTotal - roundSunat(sumaTotalesItems, 2), 2);
  }

  const cuadreExacto =
    Math.abs(diferenciaCentimos) < 0.001 && calculatedItems.every((i) => i.cuadreExactoSol);

  return {
    items: calculatedItems,
    opGravada: opGravadaFinal,
    opExonerada,
    opInafecta,
    descuentoGlobal,
    igvTotal,
    recargoConsumoPorcentaje: recargoPct,
    recargoConsumoMonto,
    importeTotal,
    tasaIgvPorcentaje: tasa,
    montoEnLetras: numeroALetrasSunat(importeTotal, input.moneda),
    cuadreExacto,
    diferenciaCentimos,
    advertenciasRedondeo: Array.from(new Set(advertenciasRedondeo)),
  };
}

/**
 * Convierte un monto numérico a letras en formato oficial SUNAT Perú.
 * Ejemplo: 250.50 PEN -> "SON: DOSCIENTOS CINCUENTA Y 50/100 SOLES"
 */
export function numeroALetrasSunat(amount: number, moneda: Moneda = 'PEN'): string {
  const safe = roundSunat(Math.max(0, amount), 2);
  const enteros = Math.floor(safe);
  const centimos = Math.round((safe - enteros) * 100)
    .toString()
    .padStart(2, '0');

  const textoEntero = convertirEnteroALetras(enteros);
  const nombreMoneda = moneda === 'USD' ? 'DÓLARES AMERICANOS' : 'SOLES';
  return `SON: ${textoEntero} Y ${centimos}/100 ${nombreMoneda}`;
}

function convertirEnteroALetras(num: number): string {
  if (num === 0) return 'CERO';
  if (num > 999_999_999) return String(num);

  const millones = Math.floor(num / 1_000_000);
  const restoMillones = num % 1_000_000;
  const miles = Math.floor(restoMillones / 1000);
  const cientos = restoMillones % 1000;

  const partes: string[] = [];

  if (millones > 0) {
    partes.push(millones === 1 ? 'UN MILLÓN' : `${convertirCentenas(millones, true)} MILLONES`);
  }
  if (miles > 0) {
    partes.push(miles === 1 ? 'MIL' : `${convertirCentenas(miles, true)} MIL`);
  }
  if (cientos > 0) {
    partes.push(convertirCentenas(cientos, false));
  }

  return partes.join(' ').trim();
}

function convertirCentenas(n: number, apocoparUno: boolean): string {
  const centenas = [
    '',
    'CIENTO',
    'DOSCIENTOS',
    'TRESCIENTOS',
    'CUATROCIENTOS',
    'QUINIENTOS',
    'SEISCIENTOS',
    'SETECIENTOS',
    'OCHOCIENTOS',
    'NOVECIENTOS',
  ];
  const decenas = [
    '',
    'DIEZ',
    'VEINTE',
    'TREINTA',
    'CUARENTA',
    'CINCUENTA',
    'SESENTA',
    'SETENTA',
    'OCHENTA',
    'NOVENTA',
  ];
  const especiales: Record<number, string> = {
    11: 'ONCE',
    12: 'DOCE',
    13: 'TRECE',
    14: 'CATORCE',
    15: 'QUINCE',
    16: 'DIECISÉIS',
    17: 'DIECISIETE',
    18: 'DIECIOCHO',
    19: 'DIECINUEVE',
    21: 'VEINTIUNO',
    22: 'VEINTIDÓS',
    23: 'VEINTITRÉS',
    24: 'VEINTICUATRO',
    25: 'VEINTICINCO',
    26: 'VEINTISÉIS',
    27: 'VEINTISIETE',
    28: 'VEINTIOCHO',
    29: 'VEINTINUEVE',
  };
  const unidades = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];

  if (n === 100) return 'CIEN';

  const c = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (c > 0) parts.push(centenas[c]);

  if (rest > 0) {
    if (especiales[rest]) {
      if (apocoparUno && rest === 21) parts.push('VEINTIÚN');
      else parts.push(especiales[rest]);
    } else if (rest < 10) {
      parts.push(apocoparUno && rest === 1 ? 'UN' : unidades[rest]);
    } else {
      const d = Math.floor(rest / 10);
      const u = rest % 10;
      if (u === 0) {
        parts.push(decenas[d]);
      } else {
        const uStr = apocoparUno && u === 1 ? 'UN' : unidades[u];
        parts.push(`${decenas[d]} Y ${uStr}`);
      }
    }
  }

  return parts.join(' ');
}

export const TASAS_IGV_PRESETS = [
  { value: 18, label: '18% — IGV General (Estándar Perú)', badge: 'General' },
  { value: 10.5, label: '10.5% — MYPE Restaurantes 2026 (Ley 31556: 8% + 2.5% IPM)', badge: 'MYPE 2026' },
  { value: 10, label: '10% — MYPE Restaurantes (Tasa anterior)', badge: 'MYPE Ant.' },
  { value: 15, label: '15% — MYPE Restaurantes 2027 (Proyectado)', badge: 'MYPE 2027' },
  { value: 0, label: '0% — Exonerado / Inafecto', badge: '0%' },
] as const;
