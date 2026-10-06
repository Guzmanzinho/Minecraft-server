$ErrorActionPreference='Stop'
$url='http://127.0.0.1:3000'
$session=Invoke-RestMethod "$url/api/session"
Invoke-RestMethod "$url/api/backups" -Method Post -ContentType 'application/json' -Headers @{'X-Panel-Token'=$session.token} -Body '{}' -TimeoutSec 3600
