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
 * Formatea el Valor Unitario para copiar y pegar en Portal SUNAT SOL.
 * Encuentra el menor número de decimales (2, 4, 6, 8 o 10) que al aplicarse la fórmula de SUNAT
 * reproduce EXACTAMENTE el total objetivo al céntimo.
 */
export function findOptimalValorUnitarioForSunat(
  exactValorUnitario: number,
  cantidad: number,
  tasaDecimal: number,
  targetTotalLinea: number
): {
  valorUnitarioOptimo: number;
  valorUnitarioStr: string;
  cuadraExacto: boolean;
  notaRedondeo?: string;
} {
  const safeQty = cantidad > 0 ? cantidad : 1;
  if (tasaDecimal <= 0) {
    const vu = roundSunat(exactValorUnitario, 6);
    const trimmed = trimTrailingZeros(vu, 2, 6);
    const simulated = roundSunat(vu * safeQty, 2);
    return {
      valorUnitarioOptimo: vu,
      valorUnitarioStr: trimmed,
      cuadraExacto: Math.abs(simulated - targetTotalLinea) < 0.001,
    };
  }

  // Probamos de menor a mayor precisión (2, 4, 6, 8, 10 decimales).
  // Portal SUNAT SOL calcula:
  //   ValorVenta = round(VU * cant, 2)
  //   IGV        = round(VU * cant * tasa, 2)  (y algunas pantallas usan round(ValorVenta * tasa, 2))
  //   Total      = ValorVenta + IGV
  const precisions = [2, 4, 6, 8, 10];
  let bestStrictMatch: { vu: number; dec: number } | null = null;
  let bestSolMatch: { vu: number; dec: number } | null = null;

  for (const dec of precisions) {
    const candidate = roundSunat(exactValorUnitario, dec);
    const subExact = candidate * safeQty;
    const valorVenta2 = roundSunat(subExact, 2);
    const igvFromExact = roundSunat(subExact * tasaDecimal, 2);
    const igvFromBase = roundSunat(valorVenta2 * tasaDecimal, 2);

    const totalExact = roundSunat(valorVenta2 + igvFromExact, 2);
    const totalFromBase = roundSunat(valorVenta2 + igvFromBase, 2);

    if (
      Math.abs(totalExact - targetTotalLinea) < 0.001 &&
      Math.abs(totalFromBase - targetTotalLinea) < 0.001
    ) {
      bestStrictMatch = { vu: candidate, dec };
      break;
    }

    if (!bestSolMatch && Math.abs(totalExact - targetTotalLinea) < 0.001) {
      bestSolMatch = { vu: candidate, dec };
    }
  }

  if (bestStrictMatch) {
    return {
      valorUnitarioOptimo: bestStrictMatch.vu,
      valorUnitarioStr: trimTrailingZeros(bestStrictMatch.vu, 2, bestStrictMatch.dec),
      cuadraExacto: true,
    };
  }

  if (bestSolMatch) {
    // Ej. S/ 100.00 al 18%: con 2 dec (84.75) -> 84.75*0.18=15.255 -> 15.26 -> 100.01!
    // Pero con 10 dec (84.7457627119) -> subExact*0.18 = 15.2542 -> 15.25 -> 84.75 + 15.25 = 100.00!
    const dec = Math.max(bestSolMatch.dec, 6);
    const vu = roundSunat(exactValorUnitario, dec);
    return {
      valorUnitarioOptimo: vu,
      valorUnitarioStr: trimTrailingZeros(vu, 2, dec),
      cuadraExacto: true,
      notaRedondeo:
        'Usa este Valor Unitario con todos sus decimales en Portal SUNAT SOL para evitar el clásico descuadre de ±S/ 0.01.',
    };
  }

  const fallback = roundSunat(exactValorUnitario, 10);
  return {
    valorUnitarioOptimo: fallback,
    valorUnitarioStr: trimTrailingZeros(fallback, 2, 10),
    cuadraExacto: false,
    notaRedondeo:
      'Verifica el total final en pantalla SUNAT; si difiere en S/ 0.01 por redondeo tributario, ajusta 0.0001 en el valor unitario.',
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
