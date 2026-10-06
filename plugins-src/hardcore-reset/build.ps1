$ErrorActionPreference='Stop'
$projectRoot=Resolve-Path (Join-Path $PSScriptRoot '..\..')
$javaHome='C:\Program Files\Eclipse Adoptium\jdk-25.0.3.9-hotspot'
$libraries=Get-ChildItem (Join-Path $projectRoot 'server\libraries') -Recurse -Filter '*.jar' | Sort-Object FullName
if (-not ($libraries.FullName -match 'paper-api-26\.2\.build\.129-stable\.jar')) {throw 'Falta la API exacta de Paper 26.2 build 129 stable.'}
$output=Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path (Join-Path $output 'classes') -Force | Out-Null
$sources=Get-ChildItem (Join-Path $PSScriptRoot 'src\main\java') -Recurse -Filter '*.java' | Sort-Object FullName
$classpath='"'+(($libraries.FullName -join ';').Replace('\','/'))+'"'
$classes='"'+((Join-Path $output 'classes').Replace('\','/'))+'"'
$arguments=@('--release','25','-encoding','UTF-8','-classpath',$classpath,'-d',$classes)
$arguments+=$sources.FullName | ForEach-Object {'"'+($_.Replace('\','/'))+'"'}
$argfile=Join-Path $output 'javac.args'
[IO.File]::WriteAllLines($argfile,$arguments,[Text.UTF8Encoding]::new($false))
& (Join-Path $javaHome 'bin\javac.exe') ('@'+$argfile)
if ($LASTEXITCODE -ne 0) {throw 'Falló compilación de HardcoreReset.'}
Copy-Item (Join-Path $PSScriptRoot 'src\main\resources\plugin.yml') (Join-Path $output 'classes\plugin.yml')
$jar=Join-Path $output 'hardcore-reset-1.0.0.jar'
& (Join-Path $javaHome 'bin\jar.exe') --create --file $jar --date=2026-10-05T00:00:00Z -C (Join-Path $output 'classes') .
if ($LASTEXITCODE -ne 0) {throw 'Falló creación del JAR.'}
$manifest=@{plugin='HardcoreReset';version='1.0.0';paper='26.2.build.129-stable';java='25';sha256=(Get-FileHash $jar -Algorithm SHA256).Hash;dependencies=@($libraries | ForEach-Object {@{path=$_.FullName.Substring($projectRoot.Path.Length+1);sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash}})}
$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $output 'build-manifest.json')
Write-Output $jar
