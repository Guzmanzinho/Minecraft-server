# Minecraft Server — panel local y Hardcore cooperativo

Código fuente para un servidor Paper con panel administrativo Express, backups seguros y reinicio cooperativo de runs Hardcore. Los binarios, mundos, datos de jugadores, credenciales, backups y registros son privados y no se distribuyen en este repositorio.

## Versiones fijadas

| Componente | Versión | Fuente oficial |
|---|---|---|
| Minecraft Java | 26.2 | https://www.minecraft.net/download |
| Paper | 26.2 build 129 STABLE | https://papermc.io/downloads/paper |
| Java | Eclipse Temurin 25.0.3+9 LTS | https://adoptium.net/temurin/releases/ |
| Node.js | 22.22.2 LTS | https://nodejs.org/ |
| Fabric Loader | 0.19.5 | https://fabricmc.net/use/installer/ |
| Fabric API | 0.161.0+26.2 | https://modrinth.com/mod/fabric-api |
| Sodium | 0.9.2 | https://modrinth.com/mod/sodium |
| Iris | 1.11.4 | https://modrinth.com/mod/iris |
| Xaero's Minimap | 26.5.1 | https://modrinth.com/mod/xaeros-minimap |
| Xaero's World Map | 1.46.1 | https://modrinth.com/mod/xaeros-world-map |
| Complementary Reimagined | r5.9.3 | https://modrinth.com/shader/complementary-reimagined |
| Playit Agent | 1.0.10 | https://github.com/playit-cloud/playit-agent/releases/tag/v1.0.10 |

`config/versions.json` fija URLs, versiones y checksums oficiales para Paper, mods y shaders. No equivale a una actualización automática a las versiones más recientes.

## Reconstruir en Windows

1. Instala el JDK Temurin y Node indicados. El código actual espera el JDK en `C:\Program Files\Eclipse Adoptium\jdk-25.0.3.9-hotspot`; revisa `panel/backend/manager.js` y el build del plugin si usas otra ruta.
2. Clona el repositorio, preferiblemente en `C:\MinecraftServer`, y ejecuta `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-source-checkout.ps1`. Solo crea archivos de configuración ausentes; nunca sobrescribe el runtime existente ni acepta el EULA.
3. Ejecuta `npm.cmd ci --prefix panel`.
4. En un checkout nuevo, ejecuta `scripts/download-assets.ps1` para obtener los binarios fijados con verificación de hashes. Se niega a sobrescribir archivos existentes. Obtén el instalador Fabric desde su fuente oficial; los mods del cliente son opcionales para conectar a Paper.
5. Para preparar las bibliotecas de compilación del plugin, ejecuta Paper desde `server` con `eula=false`. La preparación de Paper descarga sus bibliotecas oficiales y se detiene sin generar mundos mientras el EULA no esté aceptado. No automatices la aceptación del EULA.
6. Compila `plugins-src/hardcore-reset/build.ps1` y copia el JAR generado a `server/plugins` con Paper detenido. Consulta el README del plugin para sus requisitos y su prueba concurrente.
7. Lee personalmente https://www.minecraft.net/eula y acepta el EULA solo si estás de acuerdo. Abre `start-panel.bat`, inicia Paper desde el panel y añade los nombres reales a la whitelist.
8. Para Playit, instala el agente oficial, realiza `playit setup` personalmente y aprueba el claim en tu cuenta. En esta instalación se usa la credencial persistente oficial `C:\ProgramData\playit_gg\playit.toml`; no la copies al repositorio. Configura únicamente Minecraft Java hacia `127.0.0.1:25565`.
9. `start-all.bat` inicia el panel, Paper y el agente vinculado; nunca genera claims o túneles. `stop-all.bat` detiene Paper limpiamente antes de cerrar el panel y Playit.

El panel siempre escucha en `127.0.0.1:3000`. No se debe publicar, poner en `0.0.0.0` ni incluir en Playit. Minecraft usa TCP 25565, `online-mode=true`, whitelist activa y RCON desactivado.

## Código y pruebas

- `panel/backend` y `panel/frontend`: panel y gestión del proceso Paper.
- `plugins-src/hardcore-reset`: plugin propio, descriptor, build y prueba concurrente.
- `panel/tests`: validaciones unitarias; `npm.cmd test --prefix panel`.
- `config/*.example.*` y `server/server.properties.example`: plantillas sin datos privados.
- `docs/public`: guías públicas; los informes y documentos específicos de la instalación permanecen fuera de Git.

Las pruebas de integridad de binarios requieren haber descargado las dependencias; se omiten si no están instaladas. Las pruebas reales de reset son optativas y no deben ejecutarse sobre un mundo de producción sin autorización y backup previo.

## Hardcore y backups

La primera muerte termina la run de todo el grupo. El panel archiva la run, detiene Paper, espera la salida real de Java, reemplaza las dimensiones y los datos de jugadores conjuntamente, y verifica la nueva run antes de armarla. Whitelist, OP y bans se conservan. Ver `docs/public/HARDCORE.md`.

Los backups online desactivan temporalmente el guardado, fuerzan su vaciado, crean un ZIP y reactivan el guardado en un bloque de recuperación. La rotación aplica solo a backups automáticos: cada 180 minutos y máximo 24 por defecto. Los backups manuales y las copias permanentemente protegidas no se publican.

## Privacidad

`.gitignore` usa una selección restrictiva de fuentes. Excluye íntegramente mundos/runtime, migraciones, datos de jugadores, runs, backups, node_modules, ejecutables, JARs, ZIPs, screenshots, logs y credenciales. La configuración real se genera localmente desde valores seguros. No publiques archivos `.env`, `playit.toml`, secrets, tokens ni tus listas administrativas.
