import React, { useState } from 'react';
import {
  AlertOctagon,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Layers,
  LifeBuoy,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

interface GuiaExpertoSunatProps {
  onGoToTab: (tab: 'CALC' | 'CAPTURA' | 'BANDEJA' | 'EMISION' | 'CARPETAS' | 'DASHBOARD' | 'CONFIG') => void;
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
    titulo: '1. Me di cuenta de un error ANTES de presionar el botón final "Emitir" en SUNAT',
    gravedad: 'TIP',
    resumen: 'Estás en la pantalla de "Preliminar" revisando la vista previa de la Factura o Boleta.',
    pasos: [
      'NO hagas clic en "Emitir". Haz clic en "Retroceder" (o simplemente cierra esa pestaña del Portal SOL).',
      'Mientras no presiones "Emitir", NO se genera ningún número ni se informa nada a SUNAT.',
      'Corrige el dato (RUC, fecha, descripción o valor unitario) y vuelve a generar el preliminar.',
    ],
    reglaOro: 'Acostúmbrate a verificar SIEMPRE 3 cosas en el Preliminar antes de dar Emitir: ① RUC/Cliente, ② Importe Total exacto y ③ Tasa de IGV.',
  },
  {
    id: 'err-factura-emitida',
    titulo: '2. YA EMITÍ una FACTURA y me equivoqué en el RUC, el monto, el IGV o la emití doble',
    gravedad: 'ALTA',
    resumen: 'En SUNAT una factura ya emitida NUNCA se puede borrar ni editar. Se anula legalmente con una Nota de Crédito Electrónica.',
    pasos: [
      'En el Portal SUNAT SOL (ya abierto en la laptop del dueño) ve a: Empresas → Comprobantes de Pago → SEE - SOL → Factura Electrónica → Emitir Nota de Crédito.',
      'Elige el Tipo de Nota de Crédito correcto según tu error:',
      '  • Si el RUC del cliente estuvo mal: elige "Anulación por error en el RUC" (Tipo 02).',
      '  • Si el monto, el IGV estuvieron mal o emitiste la factura dos veces: elige "Anulación de la operación" (Tipo 01).',
      'Ingresa la Serie y Número de la factura equivocada (ej. E001 - 145) y haz clic en "Ver Factura" para confirmar que es esa.',
      'En Motivo o Sustento escribe claro: "Error en digitación de monto / RUC / duplicidad". Presiona Continuar → Emitir.',
      'Descarga el PDF de la Nota de Crédito. Guarda TANTO el PDF de la factura anulada como el PDF de su Nota de Crédito en una subcarpeta "ANULADAS" o márcala como ANULADO en PeñaFact.',
      'Finalmente, vuelve a emitir una NUEVA Factura correcta con los datos buenos.',
    ],
    reglaOro: 'Jamás borres el PDF de una factura anulada ni de su Nota de Crédito: el contador necesita ambos para declarar S/ 0.00 en esa operación.',
  },
  {
    id: 'err-solo-texto',
    titulo: '3. Ya emití la Factura: el RUC y el Monto están BIEN, solo me equivoqué en una palabra de la descripción',
    gravedad: 'MEDIA',
    resumen: 'No necesitas anular todo el monto ni volver a emitir una factura nueva.',
    pasos: [
      'Ve en Portal SUNAT SOL a: Factura Electrónica → Emitir Nota de Crédito.',
      'Selecciona Tipo 03: "Corrección por error en la descripción".',
      'Ingresa el número de la factura, escribe la descripción correcta y emite la Nota de Crédito (sale por monto S/ 0.00, solo corrige el texto legalmente).',
      'Descarga el PDF de esa Nota de Crédito y guárdalo junto a la factura original.',
    ],
    reglaOro: 'Si el error es mínimo y el cliente no pide cambio, consulta primero con el dueño antes de emitir una Nota de Crédito innecesaria.',
  },
  {
    id: 'err-boleta-emitida',
    titulo: '4. YA EMITÍ una BOLETA DE VENTA y me equivoqué en el monto o la emití dos veces',
    gravedad: 'ALTA',
    resumen: 'Igual que la factura, en Portal SOL se anula emitiendo una Nota de Crédito de Boleta.',
    pasos: [
      'En Portal SUNAT SOL entra a: Empresas → Comprobantes de Pago → SEE - SOL → Boleta de Venta Electrónica → Emitir Nota de Crédito.',
      'Selecciona "Anulación de la operación" (Tipo 01).',
      'Digita la Serie y Número de la boleta equivocada (ej. EB01 - 210), escribe el motivo ("Error de digitación / duplicado") y presiona Emitir.',
      'Descarga el PDF de la Nota de Crédito, guárdalo junto con la boleta anulada y luego emite la Boleta correcta.',
    ],
    reglaOro: 'Anota en la boleta física de papel el número de la boleta correcta emitida (ej. "EB01-211 ✓") con lapicero o lápiz para no volver a procesarla.',
  },
  {
    id: 'err-fecha-antigua',
    titulo: '5. La boleta de papel es del 05 de noviembre, pero SUNAT NO me deja poner fecha 05/11',
    gravedad: 'MEDIA',
    resumen: 'Regla obligatoria de SUNAT Portal SOL: solo permite fechas de HOY y hasta 2 días calendario atrás.',
    pasos: [
      'NO es una falla de la página ni de la laptop: SUNAT bloquea fechas con más de 2 días de antigüedad.',
      'En el campo "Fecha de Emisión" de SUNAT SOL deja la fecha de HOY (o máximo anteayer).',
      'En la "Descripción" del servicio coloca la fecha real del consumo (PeñaFact lo añade automáticamente: "Cena Show Turístico (Consumo 05/11/2026 - Ref. Nota N-001)").',
      'En PeñaFact guardas ambas fechas: "Fecha Consumo" (05/11) y "Fecha Emisión SUNAT" (hoy). Al organizar tus carpetas PDF eliges si ordenarlas por el día real del consumo o por el día de emisión.',
    ],
    reglaOro: 'Confirma con el dueño o contador antes de emitir notas de semanas anteriores: se emiten con fecha de hoy dentro del mismo mes (antes del 30 de noviembre) referenciando la fecha real en la descripción.',
  },
  {
    id: 'err-boleta-700',
    titulo: '6. SUNAT me bloquea una Boleta de S/ 700.00 o más porque dice "Clientes Varios"',
    gravedad: 'ALTA',
    resumen: 'Por ley tributaria peruana, toda Boleta de Venta desde S/ 700.00 exige identificar al cliente.',
    pasos: [
      'Si el monto es S/ 700.00 o mayor, SUNAT exige elegir DNI, Pasaporte o Carnet de Extranjería y escribir el nombre completo.',
      'Pregunta al dueño si tienen el DNI/Pasaporte del turista o del guía turístico de esa mesa.',
      'OJO: verifica en la boleta de papel si realmente fue 1 sola cuenta o si juntaron 2 mesas/consumos distintos en un solo papel.',
      'PeñaFact te avisa en ROJO antes de ir a SUNAT si detecta cualquier boleta ≥ S/ 700 sin documento.',
    ],
    reglaOro: 'Nunca inventes números de DNI al azar (es falta tributaria). Siempre pide el dato al dueño o consulta cómo proceder.',
  },
  {
    id: 'err-centimo-sol',
    titulo: '7. En SUNAT el Total sale S/ 100.01 o S/ 99.99 en vez de S/ 100.00 exactos',
    gravedad: 'MEDIA',
    resumen: 'Pasa cuando pegas un Valor Unitario redondeado a 2 decimales (ej. 84.75 × 1.18 = 100.005 → 100.01).',
    pasos: [
      'Vuelve a la pestaña "Calculadora IGV" o "Emitir SOL" de PeñaFact.',
      'Presiona el botón amarillo "COPIAR" del campo "Valor Unitario EXACTO" (viene con 6 a 10 decimales, ej. 84.745763).',
      'Pégalo completo en SUNAT SOL: verás que SUNAT redondea automáticamente a Base S/ 84.75 + IGV S/ 15.25 = S/ 100.00 EXACTO.',
    ],
    reglaOro: 'Copia siempre el Valor Unitario EXACTO desde PeñaFact; nunca lo redondees a mano a 2 decimales.',
  },
  {
    id: 'err-ruc-invalido',
    titulo: '8. El RUC anotado en la boleta sale "Inválido", "Baja de Oficio" o "No Habido"',
    gravedad: 'MEDIA',
    resumen: 'Puede haber un número mal copiado a mano o la empresa ya dio de baja su RUC.',
    pasos: [
      'Si PeñaFact marca "Dígito verificador incorrecto": revisa la caligrafía de la nota (a veces un 3 parece 8, o un 1 parece 7).',
      'Si en SUNAT el RUC aparece en estado "BAJA": NO se puede emitir factura a ese RUC. Avisa al dueño para pedir otro RUC vigente o emitir Boleta.',
      'Si aparece "ACTIVO" pero "NO HABIDO": consúltalo con el dueño antes de emitir.',
    ],
    reglaOro: 'Solo emite facturas con tranquilidad cuando SUNAT muestre el RUC como ACTIVO y HABIDO.',
  },
  {
    id: 'err-pdf-perdido',
    titulo: '9. Emití una factura/boleta pero cerré la ventana sin descargar el PDF (o se fue el internet)',
    gravedad: 'TIP',
    resumen: 'En SUNAT nunca se pierde un comprobante emitido y puedes volver a bajar el PDF las veces que quieras.',
    pasos: [
      'En Portal SUNAT SOL entra a: Empresas → Comprobantes de Pago → SEE - SOL → Factura Electrónica (o Boleta) → Consultar Factura y Nota.',
      'Coloca la fecha de hoy (Desde / Hasta) y presiona "Aceptar" (también te sirve para verificar si llegó a emitirse cuando se fue la luz/internet, evitando duplicados!).',
      'Haz clic en el ícono de PDF de cada comprobante faltante para descargarlo de nuevo.',
      'Luego arrástralo al "Organizador PDFs" de PeñaFact para que quede en su carpeta correspondiente.',
    ],
    reglaOro: 'Si se corta el internet justo al hacer clic en "Emitir", SIEMPRE consulta primero "Comprobantes Emitidos" antes de volver a emitir para no duplicar.',
  },
  {
    id: 'err-necesito-api',
    titulo: '10. ¿Qué es eso de "API / Nubefact" que vi en la app? ¿Necesito pedirle contraseñas al dueño?',
    gravedad: 'TIP',
    resumen: 'NO necesitas ninguna API, ni token, ni Clave SOL, ni contraseñas para trabajar mañana.',
    pasos: [
      'Como el dueño te deja su laptop con el Portal SUNAT SOL ya iniciado, tú trabajas 100% en modo Portal SOL.',
      'El módulo "API Directa" es solo una función extra opcional por si más adelante el dueño decide contratar un proveedor pagado (como Nubefact o Apisunat) para emitir sin entrar al Portal SUNAT.',
      'Mañana simplemente ignora la sección API y usa: Calculadora IGV → Captura / Bandeja → Emitir SOL → Carpetas PDF.',
    ],
    reglaOro: 'Tu trabajo de mañana funciona al 100% abriendo este enlace en Chrome/Edge al costado de la pestaña de SUNAT del dueño.',
  },
];

const CHECKLIST_MANANA = [
  'Preguntar al dueño 3 cosas antes de empezar: ① ¿La tasa de IGV es 18% o 10.5% MYPE? ② ¿Las notas de días pasados se emiten con fecha de hoy poniendo la fecha real en la descripción? ③ ¿En qué carpeta de su laptop quiere que queden guardados los PDFs?',
  'Abrir PeñaFact SUNAT PRO en una ventana (izquierda: tecla Windows + ←) y el Portal SUNAT SOL ya iniciado por el dueño en otra ventana (derecha: tecla Windows + →).',
  'Configurar una sola vez en la pestaña "Configuración": tasa de IGV por defecto (18% o 10.5%) y nombre de la Peña.',
  'Registrar las boletas escritas en "Captura Rápida" (o probar montos en "Calculadora IGV") y verificar en "Bandeja" con "Cuadre vs Boletas Físicas" que la diferencia sea S/ 0.00.',
  'Ir a "Emitir SOL" e ir emitiendo uno por uno copiando con 1 clic el RUC, Descripción y Valor Unitario Exacto. Verificar el Preliminar en SUNAT, presionar Emitir y descargar el PDF.',
  'Ir marcando cada boleta física de papel con un check (✓) y su Serie-Número apenas se emite para no duplicar ninguna.',
  'Al terminar, abrir "Carpetas PDF", arrastrar TODOS los PDFs descargados de la carpeta Descargas y presionar "Guardar Carpetas Directo en la Laptop del Dueño".',
  'Entregar al dueño: las carpetas ordenadas por Año/Mes/Semana/Día y por Empresa + el Excel Contable de 6 hojas + el Reporte Ejecutivo PDF.',
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
      {/* Cabecera */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/30 border border-amber-500/30 rounded-2xl p-6 space-y-2">
        <div className="text-xs font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
          <BookOpen className="w-4 h-4" />
          Manual Operativo Completo · Sin API ni Contraseñas · Nivel Contador Experto Perú
        </div>
        <h2 className="text-2xl font-extrabold text-white">
          Guía Exacta Paso a Paso y Protocolo S.O.S. ante Cualquier Error en SUNAT
        </h2>
        <p className="text-sm text-slate-300 max-w-3xl">
          Diseñada específicamente para trabajar mañana en la <strong>laptop del dueño (con SUNAT SOL ya iniciado)</strong>: qué hacer en orden exacto, cómo funciona cada pestaña de esta plataforma y qué hacer paso a paso si ocurre cualquier equivocación.
        </p>
      </div>

      {/* SECCIÓN 1: MAPA SIMPLE DE QUÉ HACE CADA PESTAÑA */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Layers className="w-5 h-5 text-amber-400" />
          1. ¿Cómo funciona esta plataforma? (Resumen de cada pestaña en 10 segundos)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            {
              step: 'Paso A (Rápido)',
              title: 'Calculadora IGV',
              desc: 'Reemplaza la calculadora física. Pones 1 total (o sumas varios precios de la boleta) y te saca el Valor Unitario exacto sin IGV con el IGV adentro del total.',
              tab: 'CALC' as const,
              accent: 'border-amber-500/40 bg-amber-500/5',
            },
            {
              step: 'Paso B (Registro)',
              title: 'Captura Rápida',
              desc: 'Transcribes rápido tus boletas escritas (Fecha, RUC/DNI/Varios, Total). El sistema calcula todo y te avisa si falta algún dato SUNAT.',
              tab: 'CAPTURA' as const,
              accent: 'border-slate-700 bg-slate-950/60',
            },
            {
              step: 'Paso C (Control)',
              title: 'Bandeja',
              desc: 'Ves todas tus notas juntas, verificas que la suma cuadre S/ 0.00 con las boletas físicas y puedes consolidar varias notas en 1 factura o cambiar % en lote.',
              tab: 'BANDEJA' as const,
              accent: 'border-slate-700 bg-slate-950/60',
            },
            {
              step: 'Paso D (En SUNAT)',
              title: 'Emitir SOL',
              desc: 'Te guía boleta por boleta al costado del Portal SUNAT SOL del dueño: solo presionas "Copiar" → pegas en SUNAT → emites → bajas el PDF.',
              tab: 'EMISION' as const,
              accent: 'border-emerald-500/40 bg-emerald-500/5',
            },
            {
              step: 'Paso E (Carpetas)',
              title: 'Carpetas PDF',
              desc: 'Arrastras TODOS los PDFs que bajaste de SUNAT: los lee solos, los renombra y crea las carpetas Año/Mes/Semana/Día + Por Empresa directo en la laptop del dueño.',
              tab: 'CARPETAS' as const,
              accent: 'border-sky-500/40 bg-sky-500/5',
            },
            {
              step: 'Paso F (Entrega)',
              title: 'Reportes & Config',
              desc: 'Descargas el Excel Contable de 6 hojas y el Reporte Ejecutivo PDF para entregarle el trabajo impecable al dueño.',
              tab: 'DASHBOARD' as const,
              accent: 'border-slate-700 bg-slate-950/60',
            },
          ].map((card) => (
            <div key={card.title} className={`p-4 rounded-xl border ${card.accent} flex flex-col justify-between gap-3`}>
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                  {card.step}
                </div>
                <div className="text-sm font-bold text-white mt-0.5">{card.title}</div>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">{card.desc}</p>
              </div>
              <button
                type="button"
                onClick={() => onGoToTab(card.tab)}
                className="cursor-pointer self-start text-xs font-bold text-amber-300 hover:text-amber-200 underline"
              >
                Abrir {card.title} →
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* SECCIÓN 2: CHECKLIST INTERACTIVO EN ORDEN EXACTO PARA MAÑANA */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            2. Proceso Exacto en Orden para Mañana (Marca cada paso conforme avanzas)
          </h3>
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono-num">
            {completedCount} / {CHECKLIST_MANANA.length} completados
          </span>
        </div>

        <div className="space-y-2">
          {CHECKLIST_MANANA.map((texto, idx) => {
            const done = Boolean(checkedSteps[idx]);
            return (
              <label
                key={idx}
                className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                  done
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-100'
                    : 'bg-slate-950/70 border-slate-800 text-slate-200 hover:border-slate-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => toggleCheck(idx)}
                  className="accent-emerald-500 mt-1 shrink-0 w-4 h-4"
                />
                <div className="text-xs sm:text-sm leading-relaxed">
                  <span className="font-extrabold text-amber-400 mr-2">Paso {idx + 1}:</span>
                  <span className={done ? 'line-through opacity-75' : ''}>{texto}</span>
                </div>
              </label>
            );
          })}
        </div>

        {/* Ruta Exacta dentro del Portal SUNAT SOL */}
        <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/30 text-xs text-sky-100 space-y-2">
          <div className="font-extrabold text-sky-300 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            Rutas exactas dentro del Portal SUNAT SOL (cuando ya está abierta la sesión del dueño):
          </div>
          <ul className="space-y-1 list-disc list-inside text-slate-200">
            <li>
              <strong>Emitir Factura (con RUC):</strong> Menú izquierdo → <code>Empresas</code> → <code>Comprobantes de Pago</code> → <code>SEE - SOL</code> → <code>Factura Electrónica</code> → <code>Emitir Factura</code>.
            </li>
            <li>
              <strong>Emitir Boleta (DNI / Pasaporte / Varios):</strong> <code>Empresas</code> → <code>Comprobantes de Pago</code> → <code>SEE - SOL</code> → <code>Boleta de Venta Electrónica</code> → <code>Emitir Boleta de Venta</code>.
            </li>
            <li>
              <strong>Consultar o volver a bajar un PDF ya emitido:</strong> Dentro de <code>Factura Electrónica</code> o <code>Boleta de Venta Electrónica</code> → <code>Consultar Factura y Nota</code> / <code>Consultar Boleta de Venta y Nota</code>.
            </li>
            <li>
              <strong>Anular un comprobante equivocado:</strong> Dentro de <code>Factura Electrónica</code> o <code>Boleta de Venta Electrónica</code> → <code>Emitir Nota de Crédito</code>.
            </li>
          </ul>
        </div>
      </div>

      {/* SECCIÓN 3: MANUAL S.O.S. — QUÉ HACER SI ME EQUIVOCO EN CADA SITUACIÓN */}
      <div className="bg-slate-900/90 border border-rose-500/30 rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-rose-400" />
            3. Manual S.O.S. — ¿Qué Hacer Si Me Equivoco o Pasa un Problema? (10 Casos Reales)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Haz clic en cualquier situación para ver las instrucciones exactas sin pánico ni fallas. Todo en SUNAT tiene solución legal ordenada.
          </p>
        </div>

        <div className="space-y-2.5">
          {EMERGENCY_CASES.map((caso) => {
            const isOpen = openCaseId === caso.id;
            return (
              <div
                key={caso.id}
                className={`rounded-xl border transition overflow-hidden ${
                  isOpen
                    ? 'border-amber-500/50 bg-slate-950'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpenCaseId(isOpen ? '' : caso.id)}
                  className="cursor-pointer w-full p-4 text-left flex items-center justify-between gap-3"
                >
                  <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full shrink-0 ${
                        caso.gravedad === 'ALTA'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : caso.gravedad === 'MEDIA'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      }`}
                    >
                      {caso.gravedad === 'ALTA' ? 'S.O.S.' : caso.gravedad === 'MEDIA' ? 'CUIDADO' : 'GUÍA'}
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-white">{caso.titulo}</span>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-slate-800/80 space-y-3 text-xs">
                    <p className="text-slate-300 italic">{caso.resumen}</p>
                    <ol className="space-y-1.5 text-slate-200 leading-relaxed">
                      {caso.pasos.map((p, i) => (
                        <li key={i} className={p.startsWith('  •') ? 'pl-5 text-amber-200' : 'flex gap-2'}>
                          {!p.startsWith('  •') && (
                            <span className="font-mono-num font-bold text-amber-400 shrink-0">
                              {i + 1}.
                            </span>
                          )}
                          <span>{p}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 flex gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                      <div>
                        <strong>Regla de oro:</strong> {caso.reglaOro}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* SECCIÓN 4: GLOSARIO SÚPER SIMPLE EN ESPAÑOL NORMAL */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-sky-400" />
          4. Diccionario Rápido SUNAT (Para Entender Cada Campo sin Dudas)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {[
            {
              term: 'Valor Unitario (en SUNAT SOL)',
              def: 'Es el precio de 1 unidad SIN IGV. Es lo que te pide escribir SUNAT cuando agregas un ítem. PeñaFact te lo calcula exacto con decimales para que al sumarle IGV salga igual a tu boleta escrita.',
            },
            {
              term: 'Op. Gravada (Subtotal)',
              def: 'Es la suma de todos los ítems SIN IGV. Es el ingreso neto real antes del impuesto.',
            },
            {
              term: 'IGV (18% o 10.5% MYPE 2026)',
              def: 'Impuesto General a las Ventas. En Perú la tasa normal es 18%, y para restaurantes MYPE acogidos a la Ley 31556 en 2026 es 10.5% (8% IGV + 2.5% IPM).',
            },
            {
              term: 'Importe Total',
              def: 'Monto final que pagó el turista/agencia (Op. Gravada + IGV). Debe coincidir exactamente con el total de tu boleta física de papel.',
            },
            {
              term: 'Serie E001 vs EB01',
              def: 'En Portal SUNAT SOL, las Facturas electrónicas llevan serie E001 y las Boletas de Venta llevan serie EB01.',
            },
            {
              term: 'Contado vs Crédito',
              def: 'Si el turista o agencia ya pagó ese día (efectivo, Yape, POS, transferencia), es CONTADO. Solo se pone CRÉDITO si pagarán en días/semanas posteriores (SUNAT pedirá fecha de vencimiento y cuota).',
            },
          ].map((g) => (
            <div key={g.term} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="font-bold text-amber-300">{g.term}</div>
              <p className="text-slate-300 mt-1 leading-relaxed">{g.def}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recordatorio final de tranquilidad */}
      <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3 text-xs text-emerald-200">
        <AlertOctagon className="w-5 h-5 text-emerald-400 shrink-0" />
        <div>
          <strong>Consejo de experto para avanzar al doble de velocidad:</strong> primero transcribe un grupo de 10 o 15 boletas escritas (ej. una semana entera), cuadra la suma en <strong>Bandeja</strong>, luego emítelas seguidas en <strong>Emitir SOL</strong> y al final arrastra esos 15 PDFs de golpe a <strong>Carpetas PDF</strong>. Así nunca te mareas ni pierdes la cuenta.
        </div>
      </div>
    </div>
  );
};
