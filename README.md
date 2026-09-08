# HUMOSRD

Visor experimental de humo para Santo Domingo. Mapa Leaflet, límites de Santo Domingo y Distrito Nacional, localidades y sitios de residuos identificados, imágenes NASA GIBS GOES-East/VIIRS/MODIS, detecciones FIRMS, advección horaria exploratoria con intervalo y reproducción temporal, y calculadora condicional de PM2.5.

## Ejecutar y verificar

Node 22+ y npm. `npm ci`, `npm test`, `npm run build`. El resultado está en `dist/`. No hay framework de frontend ni proceso de compilación de JavaScript. Leaflet se sirve localmente después del build. Un servidor estático permite usar imágenes y análisis manual; `/api/fires` necesita un runtime de funciones Vercel. Para integración local completa: Vercel CLI y `vercel dev` con la variable de entorno configurada.

## Vercel (pendiente, no desplegado en esta entrega)

Importar este repositorio, preset Other. `vercel.json` define `npm run build` y `dist`. La carpeta `api/` contiene una función Node. Añadir `FIRMS_MAP_KEY` como variable privada del servidor. Solicitarla en https://firms.modaps.eosdis.nasa.gov/api/map_key/ . No usar prefijos públicos ni incrustar la clave en HTML. Sin clave, la función devuelve 503 explícito y el resto del visor funciona. No hay datos de demostración presentados como reales.

## Integraciones

- GOES-East ABI GeoColor: GIBS WMTS EPSG:3857, GoogleMapsCompatible_Level7, intervalo de 10 minutos.
- VIIRS Suomi-NPP/NOAA-20/NOAA-21 y MODIS Terra/Aqua: GIBS reflectancia verdadera, Level9, mosaicos diarios.
- FIRMS: consulta paralela a VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT y MODIS_NRT. Para un día local RD se consultan los dos días UTC que lo contienen y luego se filtran las detecciones; rectángulo [-70.4,18.1,-69.2,19.1]. Respuesta parcial identificada; errores no se convierten en cero incendios. Cache CDN 10 min. Se preservan detecciones por sensor/pasada sin sumar su FRP.
- Open-Meteo: viento horario 10/80/120/180 m, m/s, hora Unix UTC; API pública desde navegador. Todo input y resultado visible se interpreta en RD UTC-4, independientemente del equipo. El span Desde–Hasta admite hasta 24 h y el deslizador recorre la trayectoria cada 10 min.
- NOAA Fire Temperature/Dust RGB y CIRA son enlaces externos; no clasificación automática. Worldview comparte los datos GIBS ya integrados.
- Sitios de residuos: Duquesa, Cancino Adentro, San Luis–La Rusa y La Tumba, contrastados con documentación pública y geometrías OpenStreetMap. Estado y precisión se declaran en cada ficha; seleccionar un sitio crea una hipótesis de origen, no una atribución.

## Alcance científico

La trayectoria usa viento temporal en un solo punto, no transporte 3D. La búsqueda de candidatos es una coincidencia espacio-temporal heurística, no atribución ni probabilidad. La calculadora exige factores documentados y asume FRP constante; no mide emisiones. Ver `dist/methodology.html` para ecuaciones, umbrales, limitaciones y fuentes.

## Datos geográficos

`dist/provinces.geojson`: extracción de Santo Domingo y Distrito Nacional desde geoBoundaries DOM ADM1, revisión 9469f09, Natural Earth, dominio público, año representado 2022. Límites generalizados, no catastrales. Localidades aproximadas para navegación; base OSM con atribución. Los nombres no representan incidentes activos.

## Validación y límites operativos

`npm test` cubre dirección/unidades de transporte, fecha y parseo FIRMS, emisiones, ausencia de clave y fallos parciales del proveedor con mocks. Las pruebas no validan precisión científica. Debe completarse QA en navegador tras despliegue, probar la clave real, comprobar CORS/cobertura GIBS y verificar hora de observación. El servicio no está calibrado para emergencias. Para operación sostenida/comercial: proveedor de teselas y plan meteorológico adecuados, monitoreo, cuotas y almacenamiento histórico. No se incluye clasificación automática ni inferencia de masa por imagen.
