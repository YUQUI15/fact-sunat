import React, { useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Info,
  Layers,
  LifeBuoy,
  ShieldAlert,
} from 'lucide-react';
import type { NavTab } from '../App';

interface GuiaExpertoSunatProps {
  onGoToTab: (tab: NavTab) => void;
}

interface EmergencyCase {
  id: string;
  titulo: string;
  gravedad: 'ALTA' | 'MEDIA' | 'TIP';
  resumen: string;
  pasos: string[];
  reglaOro: string;
}

const EMERGENCY_CASES: EmergencyCase[] = [
  {
    id: 'err-antes-emitir',
    titulo: '1. Error detectado ANTES de presionar "Emitir" (pantalla Preliminar)',
    gravedad: 'TIP',
    resumen: 'Durante la vista preliminar en SUNAT SEE-SOL el documento todavía no ha sido registrado.',
    pasos: [
      'Presione "Retroceder" o cierre la vista sin confirmar la emisión.',
      'Mientras no se confirme el botón final "Emitir", no se genera correlativo ni obligación tributaria.',
      'Corrija el RUC, fecha, concepto o valor unitario y vuelva a generar el preliminar.',
    ],
    reglaOro: 'Verifique siempre tres campos en el preliminar: ① Documento/Razón Social, ② Importe Total y ③ Tasa de IGV.',
  },
  {
    id: 'err-factura-emitida',
    titulo: '2. Factura Electrónica YA EMITIDA con error en RUC, importe, tasa de IGV o emisión duplicada',
    gravedad: 'ALTA',
    resumen: 'Un comprobante emitido en SUNAT no puede eliminarse ni editarse. Debe anularse formalmente mediante una Nota de Crédito Electrónica.',
    pasos: [
      'En Portal SUNAT Operaciones en Línea ingrese a: Empresas → Comprobantes de Pago → SEE - SOL → Factura Electrónica → Emitir Nota de Crédito.',
      'Seleccione el Tipo de Nota de Crédito correspondiente:',
      '  • Error en RUC del adquirente: Tipo 02 — "Anulación por error en el RUC".',
      '  • Error en monto, IGV o comprobante duplicado: Tipo 01 — "Anulación de la operación".',
      'Ingrese la Serie y Número de la factura observada (ej. E001 - 145) y verifique el documento con "Ver Factura".',
      'Consigne un sustento claro (ej. "Error en registro de importe / duplicidad de emisión") y confirme Emitir.',
      'Descargue el PDF de la Nota de Crédito y conserve ambos archivos (Factura original + Nota de Crédito) para el registro contable.',
      'Emita posteriormente una nueva Factura Electrónica con los datos correctos.',
    ],
    reglaOro: 'Conserve siempre el PDF del comprobante anulado junto a su Nota de Crédito; ambos son exigidos en la declaración mensual.',
  },
  {
    id: 'err-solo-texto',
    titulo: '3. Factura YA EMITIDA con RUC y monto correctos, pero con error en la descripción',
    gravedad: 'MEDIA',
    resumen: 'Es posible rectificar únicamente el texto sin anular el monto ni emitir una nueva factura.',
    pasos: [
      'Ingrese en Portal SUNAT SOL a: Factura Electrónica → Emitir Nota de Crédito.',
      'Seleccione el Tipo 03 — "Corrección por error en la descripción".',
      'Indique el comprobante afectado, consigne la redacción correcta y emita la Nota de Crédito (importe S/ 0.00).',
      'Descargue el PDF de sustento y archívelo junto a la factura original.',
    ],
    reglaOro: 'Evalúe con el área administrativa si la corrección textual es indispensable antes de emitir una Nota de Crédito.',
  },
  {
    id: 'err-boleta-emitida',
    titulo: '4. Boleta de Venta Electrónica YA EMITIDA con error de importe o duplicada',
    gravedad: 'ALTA',
    resumen: 'En Portal SEE-SOL la anulación de boletas emitidas también se gestiona mediante Nota de Crédito de Boleta.',
    pasos: [
      'Ingrese en Portal SUNAT SOL a: Empresas → Comprobantes de Pago → SEE - SOL → Boleta de Venta Electrónica → Emitir Nota de Crédito.',
      'Elija Tipo 01 — "Anulación de la operación".',
      'Ingrese la Serie y Número (ej. EB01 - 210), registre el motivo y confirme la emisión.',
      'Descargue el PDF de la Nota de Crédito, archívelo junto a la boleta anulada y emita la boleta correcta.',
    ],
    reglaOro: 'Anote el número de comprobante emitido en el documento físico de respaldo para prevenir emisiones repetidas.',
  },
  {
    id: 'err-fecha-antigua',
    titulo: '5. Documentos de días anteriores del mes y límite de fecha retroactiva en SUNAT SOL',
    gravedad: 'MEDIA',
    resumen: 'Portal SEE-SOL permite emitir comprobantes únicamente con fecha actual o hasta 2 días calendario anteriores.',
    pasos: [
      'El rechazo de fechas con más de 2 días de antigüedad es una validación nativa del sistema SUNAT.',
      'Consigne en "Fecha de Emisión" la fecha vigente permitida dentro del periodo tributario mensual.',
      'Incluya la fecha real de la operación dentro de la descripción del ítem (FactSunat Pro la agrega automáticamente).',
      'En el módulo Archivo y Carpetas puede seleccionar si las carpetas se clasifican por Fecha de Operación/Nota o por Fecha de Emisión SUNAT.',
    ],
    reglaOro: 'Confirme el criterio de fechas con el área contable antes de regularizar documentos acumulados al cierre de mes.',
  },
  {
    id: 'err-boleta-700',
    titulo: '6. Boleta de Venta igual o superior a S/ 700.00 rechazada sin documento de identidad',
    gravedad: 'ALTA',
    resumen: 'Según normativa SUNAT, toda Boleta de Venta desde S/ 700.00 requiere obligatoriamente identificar al cliente.',
    pasos: [
      'Seleccione DNI (8 dígitos), Carnet de Extranjería o Pasaporte e ingrese los nombres y apellidos completos.',
      'Verifique si el documento de origen corresponde a una sola operación o a consumos separados agrupados manualmente.',
      'FactSunat Pro marca en rojo cualquier boleta ≥ S/ 700.00 incompleta antes de pasar a emisión.',
    ],
    reglaOro: 'Nunca consigne documentos de identidad ficticios; solicite siempre el dato formal o consulte con contabilidad.',
  },
  {
    id: 'err-centimo-sol',
    titulo: '7. Diferencia de ±S/ 0.01 en el Importe Total al ingresar datos en SUNAT SOL',
    gravedad: 'MEDIA',
    resumen: 'Ocurre cuando se redondea el Valor Unitario a 2 decimales (ej. 84.75 × 1.18 = 100.005 → S/ 100.01).',
    pasos: [
      'Utilice el botón "Copiar" del campo "Valor Unitario Exacto" en la Calculadora IGV o en Emisión SUNAT.',
      'Pegue el valor completo con todos sus decimales (ej. 84.745763) en Portal SUNAT SOL.',
      'SUNAT redondeará automáticamente la Base (S/ 84.75) y el IGV (S/ 15.25) para obtener S/ 100.00 exactos.',
    ],
    reglaOro: 'Copie siempre el Valor Unitario Exacto calculado por el sistema sin recortar decimales manualmente.',
  },
  {
    id: 'err-ruc-invalido',
    titulo: '8. RUC rechazado, con estado "Baja de Oficio" o condición "No Habido"',
    gravedad: 'MEDIA',
    resumen: 'Puede tratarse de un error de transcripción de dígitos o de un contribuyente inhabilitado en SUNAT.',
    pasos: [
      'Si FactSunat Pro indica dígito verificador incorrecto, revise los 11 dígitos en el comprobante físico o constancia del cliente.',
      'Si en SUNAT figura en estado "BAJA", no es procedente emitir Factura a ese RUC; solicite un RUC activo o emita Boleta según corresponda.',
      'Si figura "ACTIVO" pero "NO HABIDO", consulte con administración antes de confirmar la emisión.',
    ],
    reglaOro: 'Verifique que el contribuyente figure como ACTIVO y HABIDO antes de emitir facturas corporativas.',
  },
  {
    id: 'err-pdf-perdido',
    titulo: '9. Recuperación de PDF no descargado o verificación ante corte de internet',
    gravedad: 'TIP',
    resumen: 'Todos los comprobantes emitidos permanecen almacenados en SUNAT y pueden descargarse nuevamente.',
    pasos: [
      'En Portal SUNAT SOL ingrese a: SEE - SOL → Factura/Boleta Electrónica → Consultar Factura y Nota (o Boleta y Nota).',
      'Filtre por el rango de fechas de emisión para confirmar qué comprobantes fueron aceptados y evitar duplicados.',
      'Descargue nuevamente los archivos PDF faltantes y cárguelos en el módulo Archivo y Carpetas.',
    ],
    reglaOro: 'Ante una interrupción de red durante la emisión, consulte siempre los comprobantes emitidos antes de reintentar.',
  },
  {
    id: 'err-api-opcional',
    titulo: '10. Modo Portal SEE-SOL frente a Conexión API PSE/OSE (Opcional)',
    gravedad: 'TIP',
    resumen: 'La plataforma opera al 100% sin necesidad de claves, credenciales ni servicios API externos.',
    pasos: [
      'En operación estándar con Portal SUNAT SEE-SOL, basta mantener abierta la sesión oficial de SUNAT en paralelo a FactSunat Pro.',
      'El módulo de API Externa (Nubefact / Apisunat / REST) es completamente opcional para empresas que contraten un proveedor PSE/OSE.',
    ],
    reglaOro: 'Ninguna credencial de SUNAT se solicita ni almacena en esta plataforma.',
  },
];

const CHECKLIST_OPERATIVO = [
  'Confirmar parámetros tributarios del periodo con administración/contabilidad: tasa de IGV vigente (18% general o 10.5% MYPE Ley 31556), criterio de fecha de emisión y carpeta destino de archivo.',
  'Organizar el espacio de trabajo en pantalla dividida: FactSunat Pro a la izquierda (Windows + ←) y Portal SUNAT SEE-SOL a la derecha (Windows + →).',
  'Configurar los datos de la empresa emisora y tasa por defecto en el módulo Configuración.',
  'Registrar el lote de notas internas en Registro de Notas (o calcular individualmente en Calculadora IGV) y verificar en Bandeja y Cuadre que la diferencia contra el total físico sea S/ 0.00.',
  'Procesar la cola de emisión en Emisión SUNAT copiando en 1 clic documento, descripción y Valor Unitario Exacto, validando el Preliminar en SUNAT antes de confirmar y descargar el PDF.',
  'Registrar la Serie y Número emitidos en cada documento físico de respaldo para garantizar trazabilidad sin duplicados.',
  'Cargar todos los PDFs descargados en Archivo y Carpetas y generar la estructura ordenada en disco local o ZIP junto con el Excel contable y el Reporte Ejecutivo PDF.',
];

export const GuiaExpertoSunat: React.FC<GuiaExpertoSunatProps> = ({ onGoToTab }) => {
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});
  const [openCaseId, setOpenCaseId] = useState<string>('err-factura-emitida');

  const toggleCheck = (idx: number) => {
    setCheckedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const completedCount = Object.values(checkedSteps).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Encabezado Ejecutivo */}
      <div className="fs-card p-6 space-y-2">
        <div className="text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent-text)' }}>
          <BookOpen className="w-4 h-4" />
          Procedimiento Estándar · Normativa SUNAT Perú (SEE-SOL y PSE/OSE)
        </div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-[var(--text-primary)]">
          Guía Operativa Paso a Paso y Protocolo de Incidencias
        </h2>
        <p className="text-sm text-[var(--text-secondary)] max-w-3xl">
          Referencia práctica para ejecutar el ciclo completo de cálculo de IGV, emisión en Portal SUNAT Operaciones en Línea y archivo documental estructurado sin errores.
        </p>
      </div>

      {/* 1. Mapa de Módulos */}
      <div className="fs-card p-5 space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Layers className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
          1. Arquitectura del Flujo de Trabajo
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            {
              step: '01 · Cálculo',
              title: 'Calculadora IGV',
              desc: 'Desglose instantáneo de IGV incluido o adicional, sumador de múltiples ítems y comparador de tasas.',
              tab: 'CALC' as NavTab,
            },
            {
              step: '02 · Captura',
              title: 'Registro de Notas',
              desc: 'Transcripción rápida por teclado con validación RUC/DNI o carga masiva desde Excel y texto.',
              tab: 'CAPTURA' as NavTab,
            },
            {
              step: '03 · Control',
              title: 'Bandeja y Cuadre',
              desc: 'Revisión global, cuadre físico exacto, consolidación de notas y actualización masiva de parámetros.',
              tab: 'BANDEJA' as NavTab,
            },
            {
              step: '04 · SUNAT',
              title: 'Emisión SUNAT',
              desc: 'Asistente paso a paso para Portal SEE-SOL con copiado en 1 clic, más soporte opcional para API y XML UBL 2.1.',
              tab: 'EMISION' as NavTab,
            },
            {
              step: '05 · Archivo',
              title: 'Archivo y Carpetas',
              desc: 'Lectura automática de PDFs SUNAT, renombrado limpio y creación directa de carpetas por fecha y cliente.',
              tab: 'CARPETAS' as NavTab,
            },
            {
              step: '06 · Cierre',
              title: 'Reportes y Cierre',
              desc: 'Consolidado tributario de Base e IGV por día, semana, mes y cliente + Excel contable de 6 hojas.',
              tab: 'DASHBOARD' as NavTab,
            },
          ].map((card) => (
            <div key={card.title} className="fs-inset p-4 flex flex-col justify-between gap-3">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--accent-text)' }}>
                  {card.step}
                </div>
                <div className="text-sm font-bold text-[var(--text-primary)] mt-0.5">{card.title}</div>
                <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{card.desc}</p>
              </div>
              <button
                type="button"
                onClick={() => onGoToTab(card.tab)}
                className="cursor-pointer self-start text-xs font-bold hover:underline"
                style={{ color: 'var(--accent-text)' }}
              >
                Ir al módulo →
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Checklist Operativo Estándar */}
      <div className="fs-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--sage-text)' }} />
            2. Procedimiento Secuencial de Emisión y Archivo
          </h3>
          <span className="text-xs font-bold px-3 py-1 rounded-full fs-pill-sage font-mono-num">
            {completedCount} / {CHECKLIST_OPERATIVO.length} completados
          </span>
        </div>

        <div className="space-y-2">
          {CHECKLIST_OPERATIVO.map((texto, idx) => {
            const done = Boolean(checkedSteps[idx]);
            return (
              <label
                key={idx}
                className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                  done
                    ? 'fs-pill-sage'
                    : 'bg-[var(--bg-inset)] border-[var(--border-soft)] text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => toggleCheck(idx)}
                  className="mt-1 shrink-0 w-4 h-4 accent-[var(--sage-bg)]"
                />
                <div className="text-xs sm:text-sm leading-relaxed">
                  <span className="font-extrabold mr-2" style={{ color: 'var(--accent-text)' }}>
                    Paso {idx + 1}:
                  </span>
                  <span className={done ? 'line-through opacity-75' : ''}>{texto}</span>
                </div>
              </label>
            );
          })}
        </div>

        <div className="p-4 rounded-xl fs-pill-sky text-xs space-y-1.5">
          <div className="font-extrabold flex items-center gap-1.5">
            <Info className="w-4 h-4" />
            Rutas oficiales dentro del Portal SUNAT SEE-SOL:
          </div>
          <ul className="space-y-1 list-disc list-inside opacity-90">
            <li>
              <strong>Factura Electrónica:</strong> Empresas → Comprobantes de Pago → SEE - SOL → Factura Electrónica → Emitir Factura.
            </li>
            <li>
              <strong>Boleta de Venta Electrónica:</strong> Empresas → Comprobantes de Pago → SEE - SOL → Boleta de Venta Electrónica → Emitir Boleta de Venta.
            </li>
            <li>
              <strong>Reimpresión / Consulta de PDFs:</strong> Consultar Factura y Nota / Consultar Boleta de Venta y Nota.
            </li>
            <li>
              <strong>Anulación / Corrección:</strong> Emitir Nota de Crédito (dentro de Factura Electrónica o Boleta de Venta).
            </li>
          </ul>
        </div>
      </div>

      {/* 3. Protocolo de Resolución de Incidencias */}
      <div className="fs-card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <LifeBuoy className="w-4 h-4" style={{ color: 'var(--rose-text)' }} />
            3. Protocolo S.O.S. — Resolución de Errores e Incidencias Frecuentes (10 Casos)
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Seleccione cualquier escenario para consultar el procedimiento tributario correcto paso a paso.
          </p>
        </div>

        <div className="space-y-2">
          {EMERGENCY_CASES.map((caso) => {
            const isOpen = openCaseId === caso.id;
            return (
              <div
                key={caso.id}
                className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-inset)] overflow-hidden transition"
              >
                <button
                  type="button"
                  onClick={() => setOpenCaseId(isOpen ? '' : caso.id)}
                  className="cursor-pointer w-full p-4 text-left flex items-center justify-between gap-3 hover:bg-[var(--bg-hover)] transition"
                >
                  <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full shrink-0 ${
                        caso.gravedad === 'ALTA'
                          ? 'fs-pill-rose'
                          : caso.gravedad === 'MEDIA'
                            ? 'fs-pill-peach'
                            : 'fs-pill-sky'
                      }`}
                    >
                      {caso.gravedad === 'ALTA' ? 'CRÍTICO' : caso.gravedad === 'MEDIA' ? 'ATENCIÓN' : 'GUÍA'}
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-[var(--text-primary)]">
                      {caso.titulo}
                    </span>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                  )}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-3 border-t border-[var(--border-soft)] bg-[var(--bg-card)] space-y-3 text-xs">
                    <p className="text-[var(--text-secondary)] italic">{caso.resumen}</p>
                    <ol className="space-y-1.5 text-[var(--text-primary)] leading-relaxed">
                      {caso.pasos.map((p, i) => (
                        <li
                          key={i}
                          className={p.startsWith('  •') ? 'pl-5 font-medium text-[var(--text-secondary)]' : 'flex gap-2'}
                        >
                          {!p.startsWith('  •') && (
                            <span className="font-mono-num font-bold shrink-0" style={{ color: 'var(--accent-text)' }}>
                              {i + 1}.
                            </span>
                          )}
                          <span>{p}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="p-3 rounded-xl fs-pill-peach flex gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <strong>Criterio clave:</strong> {caso.reglaOro}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Glosario Tributario */}
      <div className="fs-card p-5 space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <HelpCircle className="w-4 h-4" style={{ color: 'var(--sky-text)' }} />
          4. Glosario Rápido de Campos SUNAT
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {[
            {
              term: 'Valor Unitario (sin IGV)',
              def: 'Precio base por unidad antes de impuestos. Es el valor requerido al agregar cada línea en Portal SUNAT SEE-SOL.',
            },
            {
              term: 'Op. Gravada (Subtotal)',
              def: 'Sumatoria de la base imponible afecta a IGV antes de aplicar el porcentaje tributario.',
            },
            {
              term: 'IGV (18% / 10.5% MYPE 2026)',
              def: 'Impuesto General a las Ventas vigente en Perú: tasa general 18% o tasa especial MYPE Ley 31556 (10.5% durante 2026).',
            },
            {
              term: 'Importe Total',
              def: 'Monto final de la operación (Base Imponible + IGV + Otros cargos no gravados si correspondiera).',
            },
            {
              term: 'Series E001 y EB01',
              def: 'Series asignadas por SUNAT en el Sistema de Emisión Electrónica SOL: E001 para Facturas y EB01 para Boletas de Venta.',
            },
            {
              term: 'Forma de Pago (Contado vs Crédito)',
              def: 'Contado cuando la cancelación se realiza al momento de emisión; Crédito cuando existen cuotas y fechas de vencimiento futuras.',
            },
          ].map((g) => (
            <div key={g.term} className="fs-inset p-3.5">
              <div className="font-bold text-[var(--text-primary)]">{g.term}</div>
              <p className="text-[var(--text-secondary)] mt-1 leading-relaxed">{g.def}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
