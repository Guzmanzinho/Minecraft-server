# Playit persistente

Usa el agente oficial Playit 1.0.10. La ruta persistente comprobada en la instalación de Windows es C:\ProgramData\playit_gg\playit.toml; el agente debe poder leerla. Nunca publiques su contenido.

El inicio utiliza siempre la misma ruta y reutiliza una instancia autenticada. Si falta la credencial, se detiene con un mensaje: no crea claims en cada arranque. Realiza setup y aprobación personalmente solo cuando falte una credencial válida.

Tras vincular, prueba un cierre completo del agente y un nuevo arranque: debe recuperar automáticamente <PLAYIT_AGENT_ID>, el túnel <PLAYIT_TUNNEL_ID>, dirección <PLAYIT_PUBLIC_ADDRESS> y destino 127.0.0.1:25565. Reutiliza el túnel existente y no crees duplicados. No expongas 127.0.0.1:3000.

La interfaz distingue estado de conexión y túnel. Un fallo de lectura no demuestra que falte la vinculación. El servicio de Windows y el daemon del proyecto son alternativas: el controlador detecta instancias existentes para evitar duplicarlas.
