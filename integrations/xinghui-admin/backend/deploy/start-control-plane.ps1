param([string]$JarPath=(Join-Path $PSScriptRoot '../system-admin/target/system-admin.jar'))
$ErrorActionPreference='Stop'
foreach($name in @('ADMIN_DB_JDBC_URL','ADMIN_DB_USER','ADMIN_DB_PASSWORD','ADMIN_REDIS_HOST','ADMIN_REDIS_PASSWORD','FLYMIND_APP_TENANT_ID','JWT_SECRET','FLYMIND_GATEWAY_KEY','FLYMIND_CLOUD_PUBLIC_ORIGIN')){
 if([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))){throw "$name must be explicitly configured"}
}
foreach($name in @('JWT_SECRET','FLYMIND_GATEWAY_KEY')){if([Text.Encoding]::UTF8.GetByteCount([Environment]::GetEnvironmentVariable($name)) -lt 32){throw "$name must contain at least 32 UTF-8 bytes"}}
if($env:ADMIN_DB_JDBC_URL -notmatch '^jdbc:mysql://[^/]+/[^?\s]+'){throw 'Use an explicit MySQL database URL, never an unreviewed source configuration'}
if($env:FLYMIND_APP_TENANT_ID -notmatch '^[a-zA-Z0-9_-]{1,20}$'){throw 'Invalid controlled application tenant'}
$publicOrigin=[Uri]$env:FLYMIND_CLOUD_PUBLIC_ORIGIN
if(-not $publicOrigin.IsAbsoluteUri -or $publicOrigin.UserInfo -or $publicOrigin.Query -or $publicOrigin.Fragment -or $publicOrigin.AbsolutePath -ne '/' -or $env:FLYMIND_CLOUD_PUBLIC_ORIGIN.EndsWith('/') -or ($publicOrigin.Scheme -ne 'https' -and -not($publicOrigin.Scheme -eq 'http' -and $publicOrigin.IsLoopback))){throw 'Public origin must be an exact HTTPS origin (loopback HTTP for isolated testing only)'}
$resolvedJar=(Resolve-Path -LiteralPath $JarPath).Path
if(-not(Test-Path -LiteralPath $resolvedJar -PathType Leaf)){throw 'Build system-admin.jar first'}
$java=(Get-Command java -ErrorAction Stop).Source
& $java '-Dfile.encoding=UTF-8' -jar $resolvedJar
exit $LASTEXITCODE
