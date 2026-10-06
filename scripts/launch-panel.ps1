$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$panelUrl='http://127.0.0.1:3000'
function Test-Panel {
  try { $response=Invoke-RestMethod "$panelUrl/api/status" -TimeoutSec 2; return ($null -ne $response.config -and $null -ne $response.properties) } catch {return $false}
}
if (-not (Test-Panel)) {
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'panel/node_modules/express'))) { throw 'Faltan dependencias. Ejecuta npm.cmd ci dentro de panel.' }
  Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $projectRoot 'panel/backend/app.js')+'"') -WorkingDirectory (Join-Path $projectRoot 'panel') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'panel/logs/service-out.log') -RedirectStandardError (Join-Path $projectRoot 'panel/logs/service-error.log') | Out-Null
  $ready=$false
  for ($attempt=0;$attempt -lt 30;$attempt++) { if (Test-Panel) {$ready=$true;break};Start-Sleep -Milliseconds 500 }
  if (-not $ready) {throw 'No se pudo abrir el panel. Comprueba panel/logs/service-error.log y el puerto 3000.'}
}
Start-Process $panelUrl
