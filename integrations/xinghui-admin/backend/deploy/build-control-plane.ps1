param([string]$Maven='mvn',[string]$OutputDirectory=(Join-Path $PSScriptRoot 'out/control-plane'))
$ErrorActionPreference='Stop'
$backend=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if(Test-Path -LiteralPath $OutputDirectory){throw 'Output already exists; select a new directory. Nothing was overwritten.'}
& $Maven -s (Join-Path $backend 'build-settings.xml') -f (Join-Path $backend 'pom.xml') -DskipTests package
if($LASTEXITCODE -ne 0){throw 'Maven package failed'}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $backend 'system-admin/target/system-admin.jar') -Destination (Join-Path $OutputDirectory 'system-admin.jar')
foreach($name in @('start-control-plane.ps1','control-plane.env.example','README.md','flymind-control-plane.service')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $OutputDirectory $name)}
$files=Get-ChildItem -LiteralPath $OutputDirectory -File | Sort-Object Name | ForEach-Object { @{path=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} }
@{schemaVersion=1;java=17;application='FlyMind Java control plane';files=@($files)} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'manifest.json') -Encoding utf8
Write-Output "Java deployment bundle: $([IO.Path]::GetFullPath($OutputDirectory))"
