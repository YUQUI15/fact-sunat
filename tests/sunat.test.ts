import { describe, expect, it } from 'vitest';
import {
  calculateComprobante,
  evaluateSafeMathExpr,
  numeroALetrasSunat,
  roundSunat,
  simulateSunatDecimals,
} from '../src/lib/sunatMath';
import {
  validarComprobanteSunat,
  validarDniPeru,
  validarRucPeru,
} from '../src/lib/sunatValidators';
import { parseSunatText } from '../src/lib/sunatPdfParser';
import { auditSunatPdfBatch, buildCorrectedComprobanteFromAudit } from '../src/lib/pdfAuditor';
import {
  buildCleanPdfFileName,
  getFechaJerarquia,
  resolveFolderPaths,
} from '../src/lib/folderOrganizer';
import { parseBulkLines } from '../src/lib/bulkParser';
import { generateUbl21Xml } from '../src/lib/sunatUblXml';
import { DEFAULT_CONFIG } from '../src/lib/storage';
import type { ComprobanteRecord } from '../src/types/sunat';

function makeBaseRec(overrides: Partial<ComprobanteRecord> = {}): ComprobanteRecord {
  return {
    id: 'test-1',
    notaInterna: 'N-001',
    tipoComprobante: '01',
    fechaConsumo: '2026-11-18',
    fechaEmisionSunat: '2026-11-22',
    serieSunat: 'E001',
    numeroSunat: '000045',
    tipoDocCliente: '6',
    numeroDocCliente: '20100047218',
    razonSocialCliente: 'PERU TOURS S.A.C.',
    direccionCliente: 'Lima',
    emailCliente: '',
    moneda: 'PEN',
    tipoCambio: 3.75,
    modoCalculo: 'INCLUYE_IGV',
    tasaIgv: 18,
    recargoConsumoPct: 0,
    descuentoGlobal: 0,
    formaPago: 'CONTADO',
    incluirRefFechaEnDesc: true,
    observaciones: '',
    items: [
      {
        id: 'i1',
        unidad: 'ZZ',
        descripcion: 'Servicio Profesional',
        cantidad: 1,
        montoIngresado: 100,
        esTotalLinea: true,
        afectacion: '10',
      },
    ],
    estado: 'PENDIENTE',
    creadoEn: '2026-11-22T00:00:00Z',
    actualizadoEn: '2026-11-22T00:00:00Z',
    ...overrides,
  };
}

describe('Motor Matemático SUNAT Perú (sunatMath)', () => {
  it('resuelve el clásico redondeo trampa de S/ 100.00 al 18% en Portal SUNAT SOL sin descuadre de S/ 0.01', () => {
    const calc = calculateComprobante(makeBaseRec({ tasaIgv: 18 }));
    expect(calc.opGravada).toBe(84.75);
    expect(calc.igvTotal).toBe(15.25);
    expect(calc.importeTotal).toBe(100.0);
    expect(calc.cuadreExacto).toBe(true);

    // Verificar que el Valor Unitario entregado para Portal SOL realmente da 100.00 y NO 100.01
    const vuNum = parseFloat(calc.items[0].valorUnitarioSunatStr);
    expect(roundSunat(vuNum, 2)).toBe(84.75);
    expect(roundSunat(vuNum * 0.18, 2)).toBe(15.25);
    expect(roundSunat(roundSunat(vuNum, 2) + roundSunat(vuNum * 0.18, 2), 2)).toBe(100.0);
  });

  it('calcula exactamente tasa MYPE Restaurantes 2026 (10.5% — Ley 31556) manteniendo el total de S/ 250.00', () => {
    const rec = makeBaseRec({
      tasaIgv: 10.5,
      modoCalculo: 'INCLUYE_IGV',
      items: [
        {
          id: 'i1',
          unidad: 'ZZ',
          descripcion: 'Consumo General',
          cantidad: 1,
          montoIngresado: 250,
          esTotalLinea: true,
          afectacion: '10',
        },
      ],
    });
    const calc = calculateComprobante(rec);
    expect(calc.opGravada).toBe(226.24);
    expect(calc.igvTotal).toBe(23.76);
    expect(calc.importeTotal).toBe(250.0);
    expect(calc.cuadreExacto).toBe(true);
  });

  it('soporta modo Monto Neto (+ Sumar 18% IGV encima)', () => {
    const rec = makeBaseRec({
      modoCalculo: 'MAS_IGV',
      tasaIgv: 18,
      items: [
        {
          id: 'i1',
          unidad: 'ZZ',
          descripcion: 'Reserva Privada',
          cantidad: 1,
          montoIngresado: 1200,
          esTotalLinea: true,
          afectacion: '10',
        },
      ],
    });
    const calc = calculateComprobante(rec);
    expect(calc.opGravada).toBe(1200.0);
    expect(calc.igvTotal).toBe(216.0);
    expect(calc.importeTotal).toBe(1416.0);
  });

  it('calcula Recargo al Consumo (Ley 25988) sin gravarlo con IGV', () => {
    const rec = makeBaseRec({
      modoCalculo: 'MAS_IGV',
      tasaIgv: 18,
      recargoConsumoPct: 10,
      items: [
        {
          id: 'i1',
          unidad: 'ZZ',
          descripcion: 'Cena',
          cantidad: 1,
          montoIngresado: 200,
          esTotalLinea: true,
          afectacion: '10',
        },
      ],
    });
    const calc = calculateComprobante(rec);
    expect(calc.opGravada).toBe(200);
    expect(calc.igvTotal).toBe(36);
    expect(calc.recargoConsumoMonto).toBe(20);
    expect(calc.importeTotal).toBe(256);
  });

  it('convierte montos a letras en formato SUNAT', () => {
    expect(numeroALetrasSunat(100, 'PEN')).toBe('SON: CIEN Y 00/100 SOLES');
    expect(numeroALetrasSunat(250.5, 'PEN')).toBe('SON: DOSCIENTOS CINCUENTA Y 50/100 SOLES');
    expect(numeroALetrasSunat(1000, 'USD')).toBe('SON: MIL Y 00/100 DÓLARES AMERICANOS');
  });

  it('evalúa expresiones matemáticas de calculadora y simula cuadre con 2, 3, 4 y 6 decimales', () => {
    expect(evaluateSafeMathExpr('120 + 85 + 45')).toBe(250);
    expect(evaluateSafeMathExpr('3 * 80 + 25')).toBe(265);
    expect(evaluateSafeMathExpr('(50 + 30) * 2')).toBe(160);

    const vu100 = 100 / 1.18;
    const chk2 = simulateSunatDecimals(vu100, 1, 0.18, 100, 2);
    const chk3 = simulateSunatDecimals(vu100, 1, 0.18, 100, 3);
    const chk4 = simulateSunatDecimals(vu100, 1, 0.18, 100, 4);
    const chk6 = simulateSunatDecimals(vu100, 1, 0.18, 100, 6);

    expect(chk2.cuadraExacto).toBe(false);
    expect(chk2.totalSunat).toBe(100.01);
    expect(chk3.vuStr).toBe('84.746');
    expect(chk3.cuadraExacto).toBe(true);
    expect(chk4.vuStr).toBe('84.7458');
    expect(chk4.cuadraExacto).toBe(true);
    expect(chk6.vuStr).toBe('84.745763');
    expect(chk6.cuadraExacto).toBe(true);
  });
});

describe('Validadores Tributarios SUNAT Perú (sunatValidators)', () => {
  it('valida RUC oficial Módulo 11 y rechaza dígitos alterados', () => {
    expect(validarRucPeru('20100047218').valido).toBe(true);
    expect(validarRucPeru('20131312955').valido).toBe(true);
    expect(validarRucPeru('20100047219').valido).toBe(false);
    expect(validarRucPeru('99100047218').valido).toBe(false);
    expect(validarDniPeru('45891234').valido).toBe(true);
    expect(validarDniPeru('1234').valido).toBe(false);
  });

  it('detecta Boleta >= S/ 700 sin identificación del cliente (Regla SUNAT)', () => {
    const boletaAltaSinDoc = makeBaseRec({
      tipoComprobante: '03',
      tipoDocCliente: '0',
      numeroDocCliente: '-',
      razonSocialCliente: 'CLIENTES VARIOS',
      items: [
        {
          id: 'i1',
          unidad: 'ZZ',
          descripcion: 'Cena',
          cantidad: 1,
          montoIngresado: 750,
          esTotalLinea: true,
          afectacion: '10',
        },
      ],
    });
    const alertas = validarComprobanteSunat(boletaAltaSinDoc, [boletaAltaSinDoc], '2026-11-22');
    expect(alertas.some((a) => a.codigo === 'BOLETA_MAYOR_700')).toBe(true);
  });

  it('advierte cuando la Fecha de Emisión SUNAT supera los 2 días calendario de Portal SOL', () => {
    const antigua = makeBaseRec({ fechaEmisionSunat: '2026-11-10' });
    const alertas = validarComprobanteSunat(antigua, [antigua], '2026-11-22');
    expect(alertas.some((a) => a.codigo === 'FECHA_SOL_FUERA_DE_PLAZO')).toBe(true);
  });
});

describe('Lector de PDFs SUNAT, Carpetas Multi-Nivel, Bulk y UBL XML', () => {
  it('extrae Serie, Fecha, RUC, Cliente y Totales desde texto de PDF Portal SUNAT SOL', () => {
    const samplePdfText = `
      CORPORACION COMERCIAL DEMO S.A.C.
      RUC: 20601234561
      FACTURA ELECTRÓNICA
      E001-000142
      Fecha de Emisión : 18/11/2026
      Señor(es) : SERVICIOS LOGISTICOS ANDINOS S.A.C.
      RUC : 20131312955
      Tipo de Moneda : SOLES
      Sub Total Ventas : S/ 381.36
      IGV : S/ 68.64
      Importe Total : S/ 450.00
    `;
    const parsed = parseSunatText(samplePdfText, 'PDF-FACTURA-E001-142.pdf');
    expect(parsed.tipoComprobante).toBe('01');
    expect(parsed.serie).toBe('E001');
    expect(parsed.numero).toBe('142');
    expect(parsed.fechaEmision).toBe('2026-11-18');
    expect(parsed.docCliente).toBe('20131312955');
    expect(parsed.razonSocialCliente).toBe('SERVICIOS LOGISTICOS ANDINOS S.A.C.');
    expect(parsed.total).toBe(450);
    expect(parsed.igv).toBe(68.64);
    expect(parsed.esOficialSunat).toBe(true);
  });

  it('genera jerarquías completas Año/Mes/Semana/Día, Por Empresa y Súper Archivo Dual', () => {
    const rec = makeBaseRec({ fechaConsumo: '2026-11-18' });
    const jer = getFechaJerarquia('2026-11-18');
    expect(jer.anio).toBe('2026');
    expect(jer.mesCarpeta).toBe('11_Noviembre');
    expect(jer.semanaNumero).toBe(47);
    expect(jer.diaCarpeta).toBe('2026-11-18_Miercoles');

    const dualPaths = resolveFolderPaths(rec, 'SUPER_DUAL', 'CONSUMO');
    expect(dualPaths).toHaveLength(3);
    expect(dualPaths[0]).toContain('01_Por_Fecha/2026/11_Noviembre/Semana_47_');
    expect(dualPaths[1]).toContain('02_Por_Empresa/PERU_TOURS_S.A.C_(20100047218)/2026/11_Noviembre');
    expect(dualPaths[2]).toBe('03_Por_Tipo/Facturas/2026/11_Noviembre');

    const cleanName = buildCleanPdfFileName(rec, 'CONSUMO');
    expect(cleanName).toBe('E001-000045_2026-11-18_PERU_TOURS_S.A.C_S100.00.pdf');
  });

  it('parsea pegado masivo y genera XML UBL 2.1 válido', () => {
    const rows = parseBulkLines(
      '05/11/2026 | N-10 | B | VARIOS | CLIENTES VARIOS | Cena Show | 180\n06/11/2026 | N-11 | F | 20100047218 | BCP CORP | Evento | 500',
      DEFAULT_CONFIG
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].monto).toBe(180);
    expect(rows[1].tipoComprobante).toBe('01');

    const xml = generateUbl21Xml(makeBaseRec(), DEFAULT_CONFIG);
    expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="PEN">100.00</cbc:PayableAmount>');
  });

  it('audita PDFs SUNAT para detectar facturas a S/ 5.00/und vs S/ 25.00/und y genera reemplazos corregidos', () => {
    const pdfMaloText = `
      MI EMPRESA S.A.C.
      RUC: 20601234561
      FACTURA ELECTRÓNICA
      E001-145
      Fecha de Emisión : 22/11/2026
      Señor(es) : CORPORACION COMERCIAL DEL PERU S.A.C.
      RUC : 20100047218
      Tipo de Moneda : SOLES
      Cantidad Unidad Medida Descripción Valor Unitario
      10.00 UNIDAD SERVICIO DE ATENCION GENERAL 4.2373
      Sub Total Ventas : S/ 42.37
      IGV : S/ 7.63
      Importe Total : S/ 50.00
    `;
    const pdfBuenoText = `
      MI EMPRESA S.A.C.
      RUC: 20601234561
      FACTURA ELECTRÓNICA
      E001-146
      Fecha de Emisión : 22/11/2026
      Señor(es) : SERVICIOS LOGISTICOS ANDINOS S.A.C.
      RUC : 20131312955
      Tipo de Moneda : SOLES
      Cantidad Unidad Medida Descripción Valor Unitario
      10.00 UNIDAD SERVICIO DE ATENCION GENERAL 21.1864
      Sub Total Ventas : S/ 211.86
      IGV : S/ 38.14
      Importe Total : S/ 250.00
    `;

    const parsedMalo = parseSunatText(pdfMaloText, 'PDF-FACTURA-E001-145.pdf');
    const parsedBueno = parseSunatText(pdfBuenoText, 'PDF-FACTURA-E001-146.pdf');

    expect(parsedMalo.items).toHaveLength(1);
    expect(parsedMalo.items[0].cantidad).toBe(10);
    expect(parsedMalo.items[0].precioUnitarioConIgv).toBeCloseTo(5.0, 2);

    const rules = {
      modoPrecio: 'CERCANO_A' as const,
      precioErroneoObjetivo: 5,
      tolerancia: 0.35,
      precioMinimo: 20,
      precioMaximo: 5000,
      precioCorrectoReemplazo: 25,
      precioCorrectoIncluyeIgv: true,
      palabraClaveFiltro: '',
      verificarReglasSunat: true,
    };

    const audit = auditSunatPdfBatch(
      [
        { id: '1', parsed: parsedMalo },
        { id: '2', parsed: parsedBueno },
      ],
      rules
    );

    expect(audit[0].tieneError).toBe(true);
    expect(audit[0].parsed.serieNumero).toBe('E001-000145');
    expect(audit[0].correccion?.nuevoValorUnitarioExacto).toBe('21.1864');
    expect(audit[0].correccion?.nuevoTotal).toBe(250);
    expect(audit[0].correccion?.diferenciaTotal).toBe(200);
    expect(audit[1].tieneError).toBe(false);

    const replacement = buildCorrectedComprobanteFromAudit(audit[0], DEFAULT_CONFIG, rules);
    expect(replacement.numeroDocCliente).toBe('20100047218');
    expect(replacement.items[0].cantidad).toBe(10);
    expect(replacement.items[0].montoIngresado).toBe(25);
  });
});
