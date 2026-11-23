# FactSunat Pro — Gestión Tributaria y Facturación SUNAT (Perú)

Plataforma web **100% portable y privada** diseñada para cualquier empresa, comercio, restaurante o MYPE en el Perú que requiera calcular IGV exacto al céntimo, emitir comprobantes electrónicos en Portal SUNAT SEE-SOL (o vía API PSE/OSE opcional) y archivar automáticamente sus PDFs en estructuras de carpetas organizadas por fecha y cliente.

## Módulos Principales (Flujo 01 → 06)

1. **01 · Calculadora IGV Exacta**: Desglose de IGV incluido en el total o IGV adicional, sumador de múltiples ítems, comparativa simultánea de tasas (`18%`, `10.5% MYPE 2026`, `10%`, `15%`, `0%` y tasa personalizada) y copiado en 1 clic del Valor Unitario Exacto para SUNAT SEE-SOL.
2. **02 · Registro de Notas**: Captura individual rápida por teclado, validación RUC Módulo 11, consulta RUC/DNI (`/api/consulta-doc`) e importación masiva desde Excel/CSV o texto.
3. **03 · Bandeja y Cuadre**: Control maestro, verificador de cuadre contra documentos físicos (`Dif: S/ 0.00`), consolidación de múltiples notas en 1 comprobante y actualizaciones masivas.
4. **04 · Emisión SUNAT**: Asistente paso a paso para Portal SUNAT SEE-SOL sin necesidad de API ni credenciales, más soporte opcional para integración API (Nubefact / Apisunat / REST) y generación de XML UBL 2.1.
5. **05 · Archivo y Carpetas**: Lectura automática de PDFs oficiales de SUNAT en el navegador (`pdfjs-dist`), renombrado limpio y exportación directa a disco local (Chrome/Edge) o `.zip` en 5 esquemas jerárquicos (`Año / Mes / Semana / Día`, `Por Empresa`, `Por Tipo` y `Archivo Maestro Completo`).
6. **06 · Reportes y Cierre**: KPIs consolidados, resúmenes por día, semana, mes y cliente, auditoría de reglas SUNAT, Excel contable multi-hoja (`.xlsx`) y Reporte Ejecutivo PDF.
7. **Guía Operativa y S.O.S. + Configuración**: Checklist secuencial de emisión, protocolo de 10 casos frecuentes de errores SUNAT (Notas de Crédito, fechas retroactivas, boletas ≥ S/ 700), tema **Claro Pastel** y **Oscuro Pastel**, y respaldo portable `.json`.

## Comandos

```bash
npm install
npm test
npm run dev
npm run build
```
