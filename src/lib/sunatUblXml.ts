import type { ComprobanteRecord, EmpresaEmisoraConfig } from '../types/sunat';
import { calculateComprobante, formatFixed } from './sunatMath';

function escapeXml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Construye la descripción final para SUNAT, agregando opcionalmente la fecha real de consumo y N° de nota.
 */
export function buildDescripcionSunat(itemDesc: string, rec: ComprobanteRecord): string {
  const base = (itemDesc || 'Consumo de Alimentos y Bebidas - Peña Show').trim();
  if (!rec.incluirRefFechaEnDesc) return base;
  const parts: string[] = [];
  if (rec.fechaConsumo) {
    const [y, m, d] = rec.fechaConsumo.split('-');
    if (y && m && d) parts.push(`Consumo ${d}/${m}/${y}`);
  }
  if (rec.notasConsolidadas && rec.notasConsolidadas.length > 1) {
    parts.push(`Notas ${rec.notasConsolidadas.join(', ')}`);
  } else if (rec.notaInterna) {
    parts.push(`Ref. Nota ${rec.notaInterna}`);
  }
  if (!parts.length) return base;
  const suffix = ` (${parts.join(' - ')})`;
  if (base.includes(parts[0])) return base;
  return `${base}${suffix}`;
}

/**
 * Genera el XML UBL 2.1 oficial de SUNAT Perú (sin firma digital, listo para revisión contable o firmado CDT/Greenter).
 */
export function generateUbl21Xml(rec: ComprobanteRecord, emisor: EmpresaEmisoraConfig): string {
  const calc = calculateComprobante(rec);
  const serie = rec.serieSunat || (rec.tipoComprobante === '01' ? emisor.serieFacturaSol : emisor.serieBoletaSol);
  const numero = (rec.numeroSunat || '1').padStart(8, '0');
  const idDoc = `${serie}-${numero}`;
  const currency = rec.moneda;
  const tasaPct = formatFixed(calc.tasaIgvPorcentaje, 2);

  const linesXml = calc.items
    .map((it, idx) => {
      const desc = escapeXml(buildDescripcionSunat(it.descripcion, rec));
      const isGravado = it.afectacion === '10';
      const taxId = isGravado ? '1000' : it.afectacion === '20' ? '9997' : '9998';
      const taxName = isGravado ? 'IGV' : it.afectacion === '20' ? 'EXO' : 'INA';
      const taxCode = isGravado ? 'VAT' : it.afectacion === '20' ? 'VAT' : 'FRE';
      const catId = isGravado ? 'S' : it.afectacion === '20' ? 'E' : 'O';
      const percent = isGravado ? tasaPct : '0.00';

      return `  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${escapeXml(it.unidad || 'ZZ')}">${it.cantidad}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${formatFixed(it.valorVenta, 2)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount currencyID="${currency}">${formatFixed(it.precioUnitarioConIgv, 6)}</cbc:PriceAmount>
        <cbc:PriceTypeCode>01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${currency}">${formatFixed(it.igvLinea, 2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${currency}">${formatFixed(it.valorVenta, 2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${currency}">${formatFixed(it.igvLinea, 2)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID>${catId}</cbc:ID>
          <cbc:Percent>${percent}</cbc:Percent>
          <cbc:TaxExemptionReasonCode>${it.afectacion}</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme>
            <cbc:ID>${taxId}</cbc:ID>
            <cbc:Name>${taxName}</cbc:Name>
            <cbc:TaxTypeCode>${taxCode}</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description><![CDATA[${desc}]]></cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${it.valorUnitarioSunatStr}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join('\n');

  const recargoXml =
    calc.recargoConsumoMonto > 0
      ? `  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>true</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReasonCode>46</cbc:AllowanceChargeReasonCode>
    <cbc:MultiplierFactorNumeric>${formatFixed(calc.recargoConsumoPorcentaje / 100, 4)}</cbc:MultiplierFactorNumeric>
    <cbc:Amount currencyID="${currency}">${formatFixed(calc.recargoConsumoMonto, 2)}</cbc:Amount>
    <cbc:BaseAmount currencyID="${currency}">${formatFixed(calc.opGravada, 2)}</cbc:BaseAmount>
  </cac:AllowanceCharge>\n`
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${escapeXml(idDoc)}</cbc:ID>
  <cbc:IssueDate>${escapeXml(rec.fechaEmisionSunat)}</cbc:IssueDate>
  <cbc:InvoiceTypeCode listID="0101">${rec.tipoComprobante}</cbc:InvoiceTypeCode>
  <cbc:Note languageLocaleID="1000"><![CDATA[${calc.montoEnLetras}]]></cbc:Note>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6">${escapeXml(emisor.ruc || '20000000001')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${emisor.razonSocial || 'PEÑA SHOW TURÍSTICA'}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${rec.tipoDocCliente}">${escapeXml(rec.numeroDocCliente || '-')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${rec.razonSocialCliente || 'CLIENTES VARIOS'}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>${rec.formaPago === 'CREDITO' ? 'Credito' : 'Contado'}</cbc:PaymentMeansID>
  </cac:PaymentTerms>
${recargoXml}  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${formatFixed(calc.igvTotal, 2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${formatFixed(calc.opGravada, 2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${formatFixed(calc.igvTotal, 2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>1000</cbc:ID>
          <cbc:Name>IGV</cbc:Name>
          <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${formatFixed(calc.opGravada + calc.opExonerada + calc.opInafecta, 2)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${formatFixed(calc.importeTotal, 2)}</cbc:TaxInclusiveAmount>
    <cbc:ChargeTotalAmount currencyID="${currency}">${formatFixed(calc.recargoConsumoMonto, 2)}</cbc:ChargeTotalAmount>
    <cbc:PayableAmount currencyID="${currency}">${formatFixed(calc.importeTotal, 2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${linesXml}
</Invoice>
`;
}

/**
 * Genera el payload JSON oficial compatible con Nubefact / PSE Perú para emisión masiva por API.
 */
export function buildNubefactPayload(
  rec: ComprobanteRecord,
  emisor: EmpresaEmisoraConfig,
  numeroCorrelativo?: number
): Record<string, unknown> {
  const calc = calculateComprobante(rec);
  const tipoNubefact =
    rec.tipoComprobante === '01' ? 1 : rec.tipoComprobante === '03' ? 2 : rec.tipoComprobante === '07' ? 3 : 4;
  const serie =
    rec.serieSunat ||
    (rec.tipoComprobante === '01'
      ? emisor.apiConfig.serieFacturaApi || 'FFF1'
      : emisor.apiConfig.serieBoletaApi || 'BBB1');
  const numero = numeroCorrelativo ?? (Number(rec.numeroSunat) || 1);

  const [y, m, d] = rec.fechaEmisionSunat.split('-');
  const fechaDMY = y && m && d ? `${d}-${m}-${y}` : rec.fechaEmisionSunat;

  return {
    operacion: 'generar_comprobante',
    tipo_de_comprobante: tipoNubefact,
    serie,
    numero,
    sunat_transaction: 1,
    cliente_tipo_de_documento: rec.tipoDocCliente === '0' ? '-' : Number(rec.tipoDocCliente),
    cliente_numero_de_documento: rec.numeroDocCliente || '-',
    cliente_denominacion: rec.razonSocialCliente || 'CLIENTES VARIOS',
    cliente_direccion: rec.direccionCliente || '',
    cliente_email: rec.emailCliente || '',
    fecha_de_emision: fechaDMY,
    moneda: rec.moneda === 'USD' ? 2 : 1,
    tipo_de_cambio: rec.moneda === 'USD' ? rec.tipoCambio : '',
    porcentaje_de_igv: calc.tasaIgvPorcentaje,
    descuento_global: calc.descuentoGlobal || '',
    total_descuento: calc.descuentoGlobal || '',
    total_gravada: calc.opGravada,
    total_inafecta: calc.opInafecta,
    total_exonerada: calc.opExonerada,
    total_igv: calc.igvTotal,
    total_otros_cargos: calc.recargoConsumoMonto || '',
    total: calc.importeTotal,
    observaciones: [
      rec.observaciones,
      rec.fechaConsumo ? `Fecha consumo: ${rec.fechaConsumo}` : '',
      rec.notaInterna ? `Ref. Nota interna: ${rec.notaInterna}` : '',
    ]
      .filter(Boolean)
      .join(' | '),
    enviar_automaticamente_a_la_sunat: true,
    enviar_automaticamente_al_cliente: Boolean(rec.emailCliente),
    items: calc.items.map((it) => ({
      unidad_de_medida: it.unidad || 'ZZ',
      codigo: it.codigo || 'SERV-PENA',
      descripcion: buildDescripcionSunat(it.descripcion, rec),
      cantidad: it.cantidad,
      valor_unitario: Number(it.valorUnitarioSunatStr),
      precio_unitario: it.precioUnitarioConIgv,
      subtotal: it.valorVenta,
      tipo_de_igv: it.afectacion === '10' ? 1 : it.afectacion === '20' ? 8 : 9,
      igv: it.igvLinea,
      total: it.totalLinea,
    })),
  };
}
