$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'launch-panel.ps1')
$url='http://127.0.0.1:3000'
$state=Invoke-RestMethod "$url/api/status"
if ($state.state -eq 'offline') {
  if (-not $state.eulaAccepted) {throw 'Acepta personalmente el EULA antes de iniciar Paper.'}
  $token=(Invoke-RestMethod "$url/api/session").token
  Invoke-RestMethod "$url/api/server/start" -Method Post -Headers @{'x-panel-token'=$token} -ContentType 'application/json' -Body '{}' | Out-Null
}
for ($attempt=0;$attempt -lt 120;$attempt++) {
  $state=Invoke-RestMethod "$url/api/status"
  if ($state.state -eq 'online') {break}
  if ($state.state -notin 'starting','online') {throw 'Paper no alcanzó ONLINE; revisa la consola.'}
  Start-Sleep -Milliseconds 1000
}
if ($state.state -ne 'online') {throw 'Paper aún no está ONLINE; no se inicia Playit.'}
if ($state.properties.'server-port' -ne '25565' -or $state.properties.'online-mode' -ne 'true' -or $state.properties.'white-list' -ne 'true' -or $state.properties.'enable-rcon' -ne 'false') {
  throw 'La configuración de Minecraft no coincide con el destino seguro de Playit; revisa el panel.'
}
# El agente oficial reutiliza C:\ProgramData\playit_gg\playit.toml.
# Nunca crea claims ni túneles al arrancar y reutiliza una instancia existente.
for ($networkAttempt=0;$networkAttempt -lt 30;$networkAttempt++) {
  try { [System.Net.Dns]::GetHostAddresses('api.playit.gg') | Out-Null; break }
  catch { Start-Sleep -Seconds 2 }
}
if ($networkAttempt -eq 30) {throw 'La red/DNS de Playit no está disponible. No se crea otro agente ni claim; vuelve a ejecutar start-all cuando haya red.'}
& node.exe (Join-Path $PSScriptRoot 'playit-control.mjs') start
if ($LASTEXITCODE -ne 0) {throw 'No se pudo iniciar Playit.'}
