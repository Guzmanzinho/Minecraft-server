$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
foreach($folder in @('server/plugins','panel/logs','client/mods','client/shaderpacks','tools/playit/private','config')) {New-Item -ItemType Directory -Path (Join-Path $projectRoot $folder) -Force | Out-Null}
foreach($pair in @(@('config/panel-config.example.json','config/panel-config.json'),@('server/server.properties.example','server/server.properties'))) {
  $destination=Join-Path $projectRoot $pair[1]
  if(-not(Test-Path -LiteralPath $destination)){Copy-Item -LiteralPath (Join-Path $projectRoot $pair[0]) -Destination $destination}
}
$eulaPath=Join-Path $projectRoot 'server/eula.txt'
if(-not(Test-Path -LiteralPath $eulaPath)) {'eula=false' | Set-Content -LiteralPath $eulaPath -Encoding ascii}
Write-Output 'Carpetas y plantillas preparadas. Archivos existentes conservados. EULA no aceptado; Paper no iniciado.'
