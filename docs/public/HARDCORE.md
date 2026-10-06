# Hardcore cooperativo

El plugin propio detecta PlayerDeathEvent y obtiene un bloqueo que evita resets concurrentes. El panel coordina cuenta atrás, archivo de la run, parada limpia, espera de la salida del proceso Java y sustitución conjunta de las dimensiones y los datos de jugadores.

No ejecutes REINICIAR RUN sobre producción sin autorización concreta y un backup manual completo verificado fuera de la rotación. La confirmación requerida es REINICIAR RUN. Reiniciar el servidor normalmente conserva el mundo.

Una nueva run no hereda playerdata, inventarios, ender chest, XP, avances ni estadísticas. Se conservan whitelist, OP y bans. El historial y los archivos de runs son privados y se excluyen de Git. Si hay un fallo, revisa el diario y usa la recuperación prevista; no borres el staging ni inicies resets concurrentes.

Las pruebas destructivas deben hacerse en una instancia aislada con puertos y mundos independientes. No publiques sus datos runtime. El build y la prueba de concurrencia están documentados en plugins-src/hardcore-reset/README.md.
