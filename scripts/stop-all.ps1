$ErrorActionPreference='Stop'
$url='http://127.0.0.1:3000'
try {$state=Invoke-RestMethod "$url/api/status"} catch {throw 'Panel no disponible: verifica Paper antes de cerrar Playit.'}
$token=(Invoke-RestMethod "$url/api/session").token
while ($state.busy -or $state.state -in 'starting','stopping') {
  Start-Sleep -Seconds 1
  $state=Invoke-RestMethod "$url/api/status"
}
if ($state.state -eq 'online') {
  Invoke-RestMethod "$url/api/server/stop" -Method Post -Headers @{'x-panel-token'=$token} -ContentType 'application/json' -Body '{"confirm":true}' | Out-Null
}
$state=Invoke-RestMethod "$url/api/status"
if ($state.state -ne 'offline') {throw 'Paper sigue activo; no se cierra el panel ni se fuerza Java.'}
Invoke-RestMethod "$url/api/server/shutdown" -Method Post -Headers @{'x-panel-token'=$token} -ContentType 'application/json' -Body '{}' | Out-Null
for ($attempt=0;$attempt -lt 60;$attempt++) {
  try {Invoke-RestMethod "$url/api/status" -TimeoutSec 1 | Out-Null}
  catch {break}
  Start-Sleep -Milliseconds 250
}
if ($attempt -eq 60) {throw 'El panel no ha finalizado; espera antes de volver a iniciar todo.'}
& node.exe (Join-Path $PSScriptRoot 'playit-control.mjs') stop
if ($LASTEXITCODE -ne 0) {throw 'Revisa el estado de Playit.'}
