# HUMOSRD

Análisis experimental de humo en Santo Domingo: clasificación operativa NOAA GOES-19 ADP, seguimiento entre escenas, fuentes candidatas NASA FIRMS, imágenes NASA GIBS y vigilancia hacia comunidades. Hasta 24 h de los últimos 8 días; hora America/Santo_Domingo (UTC−4). No requiere seleccionar un origen.

## Desarrollo

Node 22+ y Python 3.12+. Ejecutar `npm ci`, `pip install -r requirements.txt`, `npm test`, `python -m unittest discover -s tests -p 'test_*.py'`, `npm run build`. Frontend estático en dist; Leaflet se copia al compilar. Usar `vercel dev` para las API; un servidor solo estático no ejecuta el análisis.

## Vercel

Preset Other, build npm run build, salida dist. Las funciones Node conviven con api/smoke.py (60 s); Vercel instala requirements.txt. No cambiar el preset a FastAPI. Configurar FIRMS_MAP_KEY privada desde https://firms.modaps.eosdis.nasa.gov/api/map_key/ . NOAA y las imágenes no requieren clave. Sin FIRMS se analiza humo, pero se declara la limitación de procedencia. No hay datos simulados en producción.

## Flujo

- /api/imagery resuelve intervalos publicados en WMTS. VIIRS/MODIS .jpeg y GOES .png. Al abrir muestra la última escena con su hora real. Fondo Esri de archivo identificado y errores de teselas parciales.
- /api/smoke?time=ISO descarga ADPF GOES-19 de NOAA, aplica Smoke/Cloud/Dust/DQF, georreferencia y devuelve GeoJSON, componentes, huella km², cobertura y fuente original. Cada 10 min, máximo dos solicitudes simultáneas desde el navegador, cache CDN para escenas procesadas.
- smoke-core.js sigue regiones consecutivas sin conectar huecos. Cruza FIRMS previo y movimiento observado para candidatos de baja confianza; no llama origen a la primera huella.
- automatic.js aporta progreso/cancelación, reproducción sincronizada con GeoColor, comunidades bajo píxeles de humo y tres escenarios de viento a 80 m para hasta cinco plumas finales. Exportación JSON con fuentes.
- Herramientas manuales de viento/emisiones quedan en apartados secundarios.

## NASA ARSET y alcance

Referencia del usuario: https://www.youtube.com/watch?v=2Us91BGL3Q4 . ARSET aporta formación, no es una API o modelo instalado. Se integran FIRMS/GIBS de NASA y ADP de NOAA. No se afirma aval institucional ni entrenamiento de una IA propia. Fuentes y reglas en dist/methodology.html.

Las pruebas cubren calidad, huecos, candidatos, georreferenciación, hora RD, FIRMS parcial y unidades; no validan precisión científica local. ADP tiene resolución kilométrica y puede omitir quemas pequeñas, humo nocturno o nublado. Huella no equivale a PM2.5. Centroides cambian al crecer/dividirse una pluma.

Los escenarios son advección horizontal, no HYSPLIT ni AQI. No hay notificaciones automáticas. Para operación comunitaria hacen falta sensores de superficie, validación local y dispersión. Un intervalo de 24 h procesa hasta 144 archivos y puede tardar varios minutos; dimensionar cuotas de Vercel y proveedores para el tráfico.

Límites geoBoundaries DOM ADM1, revisión 9469f09, Natural Earth, dominio público, 2022. Duquesa está cartografiado por nombre; los demás sitios de residuos son referencias aproximadas, no usadas en atribución automática.
