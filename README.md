# HUMOSRD

Análisis experimental de humo en Santo Domingo: clasificación operativa NOAA GOES-19 ADP, seguimiento entre escenas, fuentes candidatas NASA FIRMS, imágenes NASA GIBS y vigilancia hacia comunidades. Hasta 24 h de los últimos 8 días; hora America/Santo_Domingo (UTC−4). No requiere seleccionar un origen.

## Desarrollo

Node 22+ y Python 3.12+. Ejecutar `npm ci`, `pip install -r requirements.txt`, `npm test`, `python -m unittest discover -s tests -p 'test_*.py'`, `npm run build`. Frontend estático en `dist`; Leaflet se copia al compilar. Usar `vercel dev` para las API; un servidor solo estático no ejecuta el análisis.

## Vercel

Preset Other, build `npm run build`, salida `dist`. Las funciones Node conviven con `api/smoke.py` (60 s); Vercel instala `requirements.txt`. No cambiar el preset a FastAPI. Configurar `FIRMS_MAP_KEY` como variable privada del servidor. NOAA y GIBS no requieren clave. Sin FIRMS se analiza humo, pero se declara la limitación de procedencia. No hay datos simulados en producción.

Las llamadas `fetch()` de la aplicación pasan por un limitador compartido de máximo dos solicitudes activas a la vez. Esto cubre las API de HumosRD y las consultas de viento iniciadas por JavaScript; las teselas administradas internamente por Leaflet no pasan por ese limitador.

## Flujo

- `/api/imagery` resuelve intervalos publicados en WMTS. VIIRS/MODIS `.jpeg` y GOES `.png`. Al abrir muestra la última escena con su hora real. Fondo Esri de archivo identificado y errores de teselas parciales.
- `/api/smoke?time=ISO` descarga ADPF GOES-19 de NOAA, georreferencia y devuelve GeoJSON, componentes, huella km², cobertura, diagnóstico por localidad y fuente original.
- La observabilidad ADP se calcula separada de la confianza de detección: Cloud/SnowIce, geometría SZA/VZA mediante `PQI1`, valores válidos de Smoke y estado bad/missing. `DQF` high/medium/low describe la confianza de una detección de humo; no se usa como máscara general de cobertura.
- La huella principal utiliza humo de confianza alta+media y excluye polvo simultáneo. El humo de baja confianza se conserva como diagnóstico secundario y nunca se mezcla silenciosamente con la huella principal.
- `smoke-core.js` sigue regiones consecutivas sin conectar huecos, usa posición esperada para estabilizar asociaciones y exige que candidatos FIRMS queden en un cono aguas arriba del movimiento observado.
- `automatic.js` aporta progreso/cancelación, reproducción sincronizada con GeoColor, comunidades bajo píxeles de humo y cinco escenarios de viento a 80 m para hasta cinco plumas finales. Exportación JSON con fuentes y modelo de calidad.
- Herramientas manuales de viento/emisiones quedan en apartados secundarios.

## Caso real: San Luis, 8 de septiembre de 2026

La versión anterior reprodujo el intervalo 06:00–12:10 RD con 37/37 escenas procesadas y reportó 0 % de cobertura regional útil. Esa cifra regional queda **invalidada como métrica de observabilidad** porque el decoder anterior exigía DQF high/medium a todos los píxeles, confundiendo confianza de detección de humo con capacidad de observar un píxel.

El hallazgo local es distinto y se mantiene: en el muestreo horario disponible, el entorno de San Luis no tuvo `Smoke=1`; de 07:00 a 12:00 RD los siete píxeles del radio diagnóstico aparecieron clasificados como nube. Relajar DQF no puede recuperar humo detrás de nube ni una pluma que NOAA no clasificó. La muestra de las 06:00 debe reinterpretarse con `PQI1`/SZA tras esta corrección en vez de llamarla genéricamente “calidad inválida”.

El registro histórico se conserva en `docs/validation/san-luis-2026-09-08.json` con la salida pre-fix claramente identificada. El caso demuestra una falta de observación/detección satelital local; no refuta el reporte comunitario ni identifica el origen.

## Métodos y alcance

Referencia del usuario: https://www.youtube.com/watch?v=2Us91BGL3Q4 . ARSET aporta formación, no es una API o modelo instalado. Se integran FIRMS/GIBS de NASA y ADP de NOAA. No se afirma aval institucional ni entrenamiento de una IA propia. Fuentes y reglas en `dist/methodology.html`.

GOES-19 ADP es cualitativo y de resolución kilométrica. Puede omitir humo pequeño, nocturno o cubierto por nubes; fuera de los rangos recomendados de SZA/VZA no se usa el píxel para una conclusión negativa. Huella no equivale a PM2.5. Centroides cambian al crecer/dividirse una pluma.

FIRMS no es una prueba de ausencia de combustión. VIIRS (~375 m) suele resolver fuentes menores que MODIS (~1 km), pero una quema pequeña, de combustión lenta, que ocupe una fracción insuficiente del píxel, esté obstruida o ocurra entre pasadas puede no generar una detección. La UI muestra `0 focos térmicos detectados`, nunca `no hay incendio`.

Los escenarios son advección horizontal, no HYSPLIT ni AQI. No hay notificaciones automáticas. Para operación comunitaria hacen falta sensores de superficie, validación local y dispersión. Un intervalo de 24 h procesa hasta 144 archivos; dimensionar cuotas de Vercel y proveedores para el tráfico.

Límites geoBoundaries DOM ADM1, revisión 9469f09, Natural Earth, dominio público, 2022. Duquesa está cartografiado por nombre; los demás sitios de residuos son referencias aproximadas, no usadas en atribución automática.
