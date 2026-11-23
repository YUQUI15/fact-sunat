# PeñaFact SUNAT PRO 🇵🇪

Plataforma web **100% portable (Vercel / Navegador)** diseñada para **Peñas Show, Restaurantes Turísticos y MYPES en Perú** que necesitan convertir boletas/notas escritas a mano en comprobantes electrónicos SUNAT **sin calculadora, sin descuadres de céntimos y con organización automática de carpetas PDF**.

## Funciones Principales

1. **Motor Tributario Exacto SUNAT (Cero Descuadres de ±S/ 0.01)**
   - **Modo Mantener Total (Desglosar IGV)**: Ideal para notas físicas donde se escribió el monto final pagado (ej. `S/ 100.00` → entrega `Valor Unitario Exacto: 84.745763` para Portal SUNAT SOL, garantizando `84.75 + 15.25 = 100.00` exactos).
   - **Modo Neto + IGV**: Para montos escritos sin impuesto donde se debe agregar IGV encima.
   - **Tasas configurables**: `18%` (General), `10.5%` (MYPE Restaurantes 2026 — Ley 31556 modif.), `10%`, `15%` (2027), `0%` (Exonerado/Inafecto) y tasa personalizada.
   - **Recargo al Consumo (Ley 25988)** no gravado con IGV, descuentos globales, Soles (`PEN`) y Dólares (`USD`).

2. **Validación Tributaria Automática en Vivo**
   - Algoritmo oficial **Módulo 11** de RUC peruano + DNI / Pasaporte / Carnet de Extranjería.
   - Alerta automática de **Boletas ≥ S/ 700.00** sin identificación del cliente.
   - Alerta de **Fecha de Emisión Retroactiva** en Portal SUNAT SOL (máximo 2 días calendario atrás), separando limpiamente **Fecha de Consumo/Nota** vs **Fecha de Emisión SUNAT**.
   - Detección de notas duplicadas y regla de Bancarización (≥ S/ 2,000 / US$ 500).

3. **Captura Relámpago + Carga Masiva + Consolidación**
   - Ingreso por teclado ultra-rápido con auto-incremento de notas, conceptos rápidos de Peña Show y consulta de RUC/DNI (`/api/consulta-doc`).
   - Pegado masivo desde Excel/WhatsApp o subida directa de `.xlsx` / `.csv`.
   - Consolidación de varias notas de la misma agencia en 1 sola Factura.
   - Verificador de cuadre físico contra el monto sumado de tus notas en papel.

4. **Estación de Emisión SUNAT (Portal SOL + API PSE/OSE + XML UBL 2.1)**
   - **Portal SUNAT SOL**: Cola paso a paso con botones de copiado 1-clic y verificación visual instantánea.
   - **Emisión Masiva API**: Compatible con Nubefact / Apisunat / REST personalizado (incluye Modo Simulación) y generador **XML UBL 2.1**.

5. **Organizador Inteligente de PDFs y Carpetas Multi-Nivel**
   - Arrastra 1 o 200 PDFs descargados de SUNAT: lee automáticamente el texto del PDF en tu navegador (`pdfjs-dist`), detecta Serie-Número, Fecha, Cliente y Total, los vincula y los renombra limpiamente.
   - **5 esquemas de carpetas**: incluyendo **Súper Archivo Completo** (`01_Por_Fecha/Año/Mes/Semana/Día` + `02_Por_Empresa/Cliente/Año/Mes` + `03_Por_Tipo/Facturas|Boletas` + `00_Reportes_Contables/`).
   - **Guardado Directo en Disco (Chrome/Edge)** sin descomprimir ZIP + descarga universal `.zip` + **Excel Contable de 6 hojas (`.xlsx`)** + **Reporte Ejecutivo PDF**.

## Desarrollo y Despliegue en Vercel

```bash
npm install
npm test
npm run dev
npm run build
```

Para desplegar en Vercel desde GitHub:
1. Sube este repositorio a tu cuenta de GitHub.
2. En [vercel.com](https://vercel.com), haz clic en **Add New → Project** e importa el repositorio.
3. Framework preset: **Vite** (detectado automáticamente desde `vercel.json`).
4. Abre tu enlace `https://tu-proyecto.vercel.app` desde la laptop del dueño sin instalar nada.
