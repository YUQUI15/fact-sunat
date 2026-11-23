import type { AlertaTributaria, ComprobanteRecord } from '../types/sunat';
import { calculateComprobante, formatMoney } from './sunatMath';

/**
 * Validación oficial de RUC peruano (SUNAT Módulo 11).
 * Prefijos válidos: 10 (Persona Natural), 15, 16, 17, 20 (Persona Jurídica).
 */
export function validarRucPeru(rucRaw: string): { valido: boolean; motivo?: string; tipo?: string } {
  const ruc = (rucRaw || '').replace(/\D/g, '');
  if (ruc.length !== 11) {
    return { valido: false, motivo: `El RUC debe tener 11 dígitos (tiene ${ruc.length}).` };
  }
  const prefijo = ruc.slice(0, 2);
  const prefijosValidos: Record<string, string> = {
    '10': 'Persona Natural con Negocio',
    '15': 'Entidad / Otros',
    '16': 'Entidad / Otros',
    '17': 'Entidad / Otros',
    '20': 'Persona Jurídica (Empresa)',
  };
  if (!prefijosValidos[prefijo]) {
    return {
      valido: false,
      motivo: `Prefijo "${prefijo}" inválido. Un RUC peruano empieza con 10, 15, 16, 17 o 20.`,
    };
  }

  const factores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    suma += Number(ruc[i]) * factores[i];
  }
  const resto = suma % 11;
  let verificador = 11 - resto;
  if (verificador === 10) verificador = 0;
  if (verificador === 11) verificador = 1;

  if (verificador !== Number(ruc[10])) {
    return {
      valido: false,
      motivo: `Dígito verificador incorrecto (esperado ${verificador}, ingresado ${ruc[10]}). Revisa si hay un número mal copiado.`,
    };
  }

  return { valido: true, tipo: prefijosValidos[prefijo] };
}

export function validarDniPeru(dniRaw: string): { valido: boolean; motivo?: string } {
  const dni = (dniRaw || '').replace(/\D/g, '');
  if (dni.length !== 8) {
    return { valido: false, motivo: `El DNI debe tener exactamente 8 dígitos (tiene ${dni.length}).` };
  }
  if (/^0+$/.test(dni)) {
    return { valido: false, motivo: 'El DNI no puede ser todo ceros.' };
  }
  return { valido: true };
}

/**
 * Fecha actual en zona horaria Perú (America/Lima) en formato YYYY-MM-DD.
 */
export function getHoyPeruISO(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fallback
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Diferencia en días calendario entre dos fechas YYYY-MM-DD (a - b).
 */
export function diffDiasISO(fechaA: string, fechaB: string): number {
  const [ya, ma, da] = fechaA.split('-').map(Number);
  const [yb, mb, db] = fechaB.split('-').map(Number);
  if (!ya || !ma || !da || !yb || !mb || !db) return 0;
  const utcA = Date.UTC(ya, ma - 1, da);
  const utcB = Date.UTC(yb, mb - 1, db);
  return Math.round((utcA - utcB) / 86_400_000);
}

/**
 * Auditoría tributaria completa de un comprobante antes de emitir en SUNAT.
 */
export function validarComprobanteSunat(
  rec: ComprobanteRecord,
  todosLosComprobantes: ComprobanteRecord[] = [],
  hoyPeruISO: string = getHoyPeruISO()
): AlertaTributaria[] {
  const alertas: AlertaTributaria[] = [];
  const calc = calculateComprobante(rec);

  // 1. Validación de ítems y montos
  if (!rec.items.length || calc.importeTotal <= 0) {
    alertas.push({
      nivel: 'error',
      codigo: 'MONTO_CERO',
      mensaje: 'El comprobante tiene monto S/ 0.00 o no tiene ítems.',
      sugerencia: 'Ingresa el monto total de la nota antes de emitir.',
    });
  }

  // 2. Reglas de Factura Electrónica (01)
  if (rec.tipoComprobante === '01') {
    if (rec.tipoDocCliente !== '6') {
      alertas.push({
        nivel: 'error',
        codigo: 'FACTURA_REQUIERE_RUC',
        mensaje: 'Una Factura Electrónica solo puede emitirse con RUC (Tipo Doc. 6).',
        sugerencia: 'Cambia a RUC o cambia el comprobante a Boleta de Venta.',
      });
    } else {
      const vRuc = validarRucPeru(rec.numeroDocCliente);
      if (!vRuc.valido) {
        alertas.push({
          nivel: 'error',
          codigo: 'RUC_INVALIDO',
          mensaje: `RUC inválido: ${vRuc.motivo}`,
          sugerencia: 'Verifica el RUC en la nota física o consúltalo en SUNAT.',
        });
      }
    }
    if (!rec.razonSocialCliente.trim() || rec.razonSocialCliente.trim().toUpperCase() === 'CLIENTES VARIOS') {
      alertas.push({
        nivel: 'warning',
        codigo: 'FACTURA_SIN_RAZON_SOCIAL',
        mensaje: 'Falta la Razón Social de la empresa cliente.',
        sugerencia: 'Usa el botón "Consultar RUC" para obtener la razón social oficial.',
      });
    }
  }

  // 3. Reglas de Boleta de Venta Electrónica (03)
  if (rec.tipoComprobante === '03') {
    const montoPen = rec.moneda === 'USD' ? calc.importeTotal * (rec.tipoCambio || 3.75) : calc.importeTotal;

    if (rec.tipoDocCliente === '1') {
      const vDni = validarDniPeru(rec.numeroDocCliente);
      if (!vDni.valido) {
        alertas.push({
          nivel: 'error',
          codigo: 'DNI_INVALIDO',
          mensaje: `DNI inválido: ${vDni.motivo}`,
        });
      }
    } else if (rec.tipoDocCliente === '6') {
      const vRuc = validarRucPeru(rec.numeroDocCliente);
      if (!vRuc.valido) {
        alertas.push({
          nivel: 'error',
          codigo: 'RUC_EN_BOLETA_INVALIDO',
          mensaje: `RUC inválido: ${vRuc.motivo}`,
        });
      }
    }

    // Regla SUNAT obligatoria: Boletas >= S/ 700 requieren identificación del cliente
    if (montoPen >= 700) {
      const sinDoc = rec.tipoDocCliente === '0' || !rec.numeroDocCliente.trim() || rec.numeroDocCliente === '-';
      const sinNombre =
        !rec.razonSocialCliente.trim() ||
        rec.razonSocialCliente.trim().toUpperCase().includes('VARIOS');
      if (sinDoc || sinNombre) {
        alertas.push({
          nivel: 'error',
          codigo: 'BOLETA_MAYOR_700',
          mensaje: `Regla SUNAT: Boleta de ${formatMoney(calc.importeTotal, rec.moneda)} (≥ S/ 700.00) exige DNI, Pasaporte o Carnet de Extranjería y nombres del cliente.`,
          sugerencia:
            'Ingresa el DNI, Carnet de Extranjería o Pasaporte del cliente, o verifica si correspondía emitir comprobantes independientes por operaciones separadas.',
        });
      }
    }
  }

  // 4. Regla de fecha de emisión retroactiva en Portal SUNAT SOL (máximo 2 días calendario atrás)
  if (rec.estado === 'PENDIENTE' || rec.estado === 'EN_PROCESO') {
    const diasAtras = diffDiasISO(hoyPeruISO, rec.fechaEmisionSunat);
    if (diasAtras > 2) {
      alertas.push({
        nivel: 'warning',
        codigo: 'FECHA_SOL_FUERA_DE_PLAZO',
        mensaje: `Portal SUNAT SOL solo permite emitir hasta 2 días calendario atrás (esta fecha tiene ${diasAtras} días de antigüedad).`,
        sugerencia: `Mantén "${rec.fechaConsumo}" como Fecha de Nota/Consumo (para carpetas y observación) y cambia la "Fecha Emisión SUNAT" a hoy (${hoyPeruISO}) o hasta 2 días atrás.`,
      });
    } else if (diasAtras < 0) {
      alertas.push({
        nivel: 'error',
        codigo: 'FECHA_FUTURA',
        mensaje: 'La Fecha de Emisión SUNAT no puede ser futura.',
        sugerencia: `Ajústala a hoy (${hoyPeruISO}).`,
      });
    }
  }

  // 5. Bancarización Perú (Ley 28194: >= S/ 2,000 o US$ 500 requiere medio de pago bancarizado)
  const umbralBancarizacion = rec.moneda === 'USD' ? 500 : 2000;
  if (calc.importeTotal >= umbralBancarizacion) {
    alertas.push({
      nivel: 'info',
      codigo: 'BANCARIZACION_PERU',
      mensaje: `Monto ≥ ${formatMoney(umbralBancarizacion, rec.moneda)}: recuerda la Ley de Bancarización (conservar voucher POS/transferencia/Yape empresarial).`,
    });
  }

  // 6. Detección de posibles duplicados
  if (todosLosComprobantes.length > 1) {
    const dupNota =
      rec.notaInterna.trim() &&
      todosLosComprobantes.find(
        (other) =>
          other.id !== rec.id &&
          other.estado !== 'ANULADO' &&
          other.notaInterna.trim().toLowerCase() === rec.notaInterna.trim().toLowerCase()
      );
    if (dupNota) {
      alertas.push({
        nivel: 'warning',
        codigo: 'NOTA_DUPLICADA',
        mensaje: `El N° de Nota Interna "${rec.notaInterna}" ya aparece en otro registro.`,
        sugerencia: 'Verifica que no estés digitando la misma boleta física dos veces.',
      });
    }

    if (rec.serieSunat && rec.numeroSunat) {
      const dupSerie = todosLosComprobantes.find(
        (other) =>
          other.id !== rec.id &&
          other.estado !== 'ANULADO' &&
          other.serieSunat === rec.serieSunat &&
          other.numeroSunat === rec.numeroSunat
      );
      if (dupSerie) {
        alertas.push({
          nivel: 'error',
          codigo: 'SERIE_NUMERO_DUPLICADO',
          mensaje: `El comprobante SUNAT ${rec.serieSunat}-${rec.numeroSunat} ya existe en otro registro.`,
        });
      }
    }
  }

  // 7. Advertencia de cuadre exacto en SUNAT SOL
  if (!calc.cuadreExacto) {
    alertas.push({
      nivel: 'warning',
      codigo: 'REDONDEO_SUNAT',
      mensaje: 'Revisa el Valor Unitario con decimales completos para que el Total cuadre exacto al céntimo en SUNAT.',
    });
  }

  return alertas;
}
