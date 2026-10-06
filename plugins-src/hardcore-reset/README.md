# HardcoreReset 1.0.0

Plugin propio para Paper **26.2 build 129 STABLE**, Java 25. Usa la API y bibliotecas proporcionadas por Paper; no descarga plugins ni abre puertos. Fuentes en `src/main/java`, descriptor en `src/main/resources/plugin.yml`. Únicamente el JAR de producción se instala en `server/plugins`.

Desde `C:\MinecraftServer`, compilar mediante:

```powershell
./plugins-src/hardcore-reset/build.ps1
```

Requiere el JDK instalado y bibliotecas de `server/libraries`. Compila con `--release 25`, UTF-8, entradas ordenadas y fecha fija. `build/build-manifest.json` contiene hashes de dependencias y resultado. Dos builds producen SHA-256 **BE5538A2DDF0F80C09A2C2DCA25FFF0C38EBAEF49B7B1DC8CC5D105313C1D4D0**. Sustituir el JAR únicamente con Paper detenido; no usar `/reload`.

Prueba concurrente reproducible:

```powershell
$jdk='C:\Program Files\Eclipse Adoptium\jdk-25.0.3.9-hotspot\bin'
& "$jdk\javac.exe" --release 25 -encoding UTF-8 -cp plugins-src/hardcore-reset/build/classes -d plugins-src/hardcore-reset/build/test-classes plugins-src/hardcore-reset/src/test/java/local/overworld/hardcore/DeathLatchTest.java
& "$jdk\java.exe" -cp 'plugins-src/hardcore-reset/build/classes;plugins-src/hardcore-reset/build/test-classes' local.overworld.hardcore.DeathLatchTest
```

32 llamadas simultáneas aceptan un solo reset; las clases de test quedan fuera del JAR.

El panel gestiona Paper. Intercambio local en `server/plugins/HardcoreReset`: `control.json` (runId, armado, habilitación, segundos y preparación), `snapshot.json` (estado real API), `death.json` (muerte), `ready.json` (fin de cuenta atrás) y `manual.json` (petición administrativa). Escritura atómica, sin API de red ni comandos para fabricar muertes.

Un `PlayerDeathEvent` de un jugador conectado obtiene un bloqueo CAS inmediato. Guarda identidad, seed como string de 64 bits y mensaje Adventure cuando existe. Avisa, congela desplazamientos y rechaza nuevas entradas mientras termina la run. Si el fallecido reaparece durante ese intervalo queda en spectator. Las excepciones se registran SEVERE con stack trace. Consultar el diario del panel antes de recuperar un fallo.

Fuentes oficiales: [PlayerDeathEvent 26.2](https://jd.papermc.io/paper/26.2/org/bukkit/event/entity/PlayerDeathEvent.html), [World 26.2](https://jd.papermc.io/paper/26.2/org/bukkit/World.html), [propiedades Paper](https://docs.papermc.io/paper/reference/server-properties/).
