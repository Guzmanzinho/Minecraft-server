# Cliente Fabric — Minecraft Java 26.2

Usa el launcher oficial y Fabric Loader 0.19.5. Define un directorio de juego independiente, por ejemplo `<PROJECT_ROOT>\client`.

Mods compatibles fijados: Fabric API 0.161.0+26.2, Sodium 0.9.2, Iris 1.11.4, Xaero's Minimap 26.5.1 y Xaero's World Map 1.46.1. Shader: Complementary Reimagined r5.9.3. Las URLs oficiales y los hashes están en `config/versions.json`; las fuentes y el procedimiento de descarga están en el README principal. Descarga el instalador Fabric únicamente desde https://fabricmc.net/use/installer/.

Coloca los JARs en `client/mods` y el shader ZIP en `client/shaderpacks`, sin descomprimirlo. Estos binarios, mapas, screenshots, logs y opciones personales se excluyen de Git.

Xaero puede mostrar jugadores y mobs mediante Y → Entity Radar Settings → Display Radar. Los puntos de última muerte se gestionan en Waypoint Settings → Deathpoints. El radar muestra entidades cargadas por el cliente; no descubre todos los jugadores remotos. Los mapas y waypoints locales pueden representar una run anterior: selecciona el submundo adecuado cuando el servidor cambie de run.

Conecta a `<PLAYIT_PUBLIC_ADDRESS>` o, desde el PC del servidor, a `localhost:25565`. Paper no requiere estos mods para conectar. La whitelist debe contener tu nombre real; no uses cuentas inventadas.
