$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
# Preparación inicial con versiones fijadas; nunca sobrescribe una instalación existente.
$manifest = Get-Content -Raw -LiteralPath 'config/versions.json' | ConvertFrom-Json
if ($manifest.minecraft -ne '26.2' -or $manifest.paperChannel -ne 'STABLE') { throw 'Inventario estable 26.2 requerido.' }
$assets = @([pscustomobject]@{url=$manifest.paperURL;file='server/server.jar';hash=$manifest.paperSHA256;algorithm='SHA256'})
foreach($mod in $manifest.mods){
  if($mod.type -ne 'release' -or '26.2' -notin $mod.gameVersions -or $mod.filename -notmatch '^[A-Za-z0-9_+(). -]+\.jar$'){throw 'Mod no válido para 26.2.'}
  $assets += [pscustomobject]@{url=$mod.url;file=('client/mods/'+$mod.filename);hash=$mod.sha512;algorithm='SHA512'}
}
$shader=$manifest.shader
if($shader.type -ne 'release' -or '26.2' -notin $shader.gameVersions -or $shader.filename -notmatch '^[A-Za-z0-9_+(). -]+\.zip$'){throw 'Shader no válido.'}
$assets += [pscustomobject]@{url=$shader.url;file=('client/shaderpacks/'+$shader.filename);hash=$shader.sha512;algorithm='SHA512'}
foreach($asset in $assets){
  $target=[IO.Path]::GetFullPath((Join-Path $projectRoot $asset.file))
  if(-not $target.StartsWith($projectRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Ruta fuera del proyecto.'}
  if(Test-Path -LiteralPath $target){throw "Archivo existente; no se sobrescribe: $target"}
}
foreach($asset in $assets){
  New-Item -ItemType Directory -Path (Split-Path $asset.file -Parent) -Force | Out-Null
  Invoke-WebRequest -Uri $asset.url -OutFile $asset.file
  if((Get-FileHash -LiteralPath $asset.file -Algorithm $asset.algorithm).Hash.ToLower() -ne $asset.hash){throw 'Checksum incorrecto.'}
}
Write-Output 'Binarios fijados verificados. Instalador Fabric inventariado por separado. No se inició Paper.'
