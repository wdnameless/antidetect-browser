# =============================================================================
# Antidetect Browser - dedicated server bootstrap (Windows Server / Win10/11)
# One command:
#   irm https://raw.githubusercontent.com/wdnameless/antidetect-browser/main/deploy/bootstrap.ps1 -OutFile bootstrap.ps1
#   .\bootstrap.ps1 -Peers 3
# Installs: Node LTS, git, the app (built), WireGuard (10.8.0.1 + N peers),
# firewall rule, logon-start task for the service. Prints next steps.
# Run from an elevated PowerShell in the user's session.
# =============================================================================
param(
  [int]$Peers = 2,
  [string]$InstallDir = "C:\antidetect",
  [string]$Repo = "https://github.com/wdnameless/antidetect-browser.git"
)
$ErrorActionPreference = 'Stop'

function Info($m)  { Write-Host "[bootstrap] $m" -ForegroundColor Cyan }
function Ok($m)    { Write-Host "[bootstrap] OK: $m" -ForegroundColor Green }
function Warn($m)  { Write-Host "[bootstrap] WARN: $m" -ForegroundColor Yellow }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
      ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script from an elevated (Administrator) PowerShell."
}

# --- helpers -----------------------------------------------------------------
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Install-WingetApp($id, $name) {
  if (Have winget) {
    Info "Installing $name via winget..."
    winget install --id $id --accept-source-agreements --accept-package-agreements --silent | Out-Null
  } else {
    throw "winget is not available. Install $name manually, then re-run."
  }
}

# --- 1. Node.js ---------------------------------------------------------------
if (-not (Have node)) { Install-WingetApp 'OpenJS.NodeJS.LTS' 'Node.js LTS' }
else { Ok "Node found: $(node -v)" }
# refresh PATH for current session
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

# --- 2. Git -------------------------------------------------------------------
if (-not (Have git)) { Install-WingetApp 'Git.Git' 'Git' }

# --- 3. Source code -----------------------------------------------------------
if (Test-Path "$InstallDir\.git") {
  Info "Repo exists, pulling latest..."
  Push-Location $InstallDir; git pull --ff-only; Pop-Location
} else {
  Info "Cloning repository..."
  git clone $Repo $InstallDir
}
Push-Location $InstallDir
Info "npm ci (this may take a few minutes)..."
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
Info "Building main process..."
npm run build:main
if ($LASTEXITCODE -ne 0) { throw "build failed" }
Info "Ensuring kernel and chromedriver..."
npm run ensure-kernel
npm run ensure-chromedriver
Pop-Location

# --- 4. Service runner (must live in an interactive desktop session) ----------
$runScript = @'
$env:ANTIDETECT_SERVER_MODE = '1'
$env:ANTIDETECT_TRUSTED_HOSTS = '10.8.0.1'
$env:API_HOST = '127.0.0.1'
Set-Location "$PSScriptRoot"
& "C:\Program Files\nodejs\node.exe" "dist\src\main\index.js"
'@
Set-Content -LiteralPath "$InstallDir\service-run.ps1" -Value $runScript -Encoding UTF8

$user = $env:USERNAME
schtasks /Create /F /TN "AntidetectService" `
  /TR "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\service-run.ps1`"" `
  /SC ONLOGON /RU "$env:COMPUTERNAME\$user" /RL HIGHEST | Out-Null
Ok "Logon task 'AntidetectService' created (user: $user)."

# --- 5. WireGuard -------------------------------------------------------------
if (-not (Have wg)) {
  Install-WingetApp 'WireGuard.WireGuard' 'WireGuard'
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}
$wgExe  = 'C:\Program Files\WireGuard\wg.exe'
$wgMain = 'C:\Program Files\WireGuard\wireguard.exe'

New-Item -ItemType Directory -Force -Path 'C:\wg', "$InstallDir-clients" | Out-Null

if (-not (Test-Path 'C:\wg\server.key')) {
  Info "Generating WireGuard keys..."
  (& $wgExe genkey) | Set-Content C:\wg\server.key -NoNewline
  Get-Content C:\wg\server.key | & $wgExe pubkey | Set-Content C:\wg\server.pub -NoNewline
} else { Ok "WireGuard keys already exist." }

$srvPriv = Get-Content C:\wg\server.key -Raw
$srvPub  = Get-Content C:\wg\server.pub  -Raw

$conf = New-Object System.Text.StringBuilder
[void]$conf.AppendLine('[Interface]')
[void]$conf.AppendLine("PrivateKey = $srvPriv")
[void]$conf.AppendLine('Address = 10.8.0.1/24')
[void]$conf.AppendLine('ListenPort = 51820')
for ($i = 1; $i -le $Peers; $i++) {
  $ip = "10.8.0.$($i+1)"
  $cprivFile = "C:\wg\peer$i.key"
  if (-not (Test-Path $cprivFile)) {
    (& $wgExe genkey) | Set-Content $cprivFile -NoNewline
  }
  $cpriv = Get-Content $cprivFile -Raw
  $cpub  = Get-Content $cprivFile | & $wgExe pubkey
  [void]$conf.AppendLine('')
  [void]$conf.AppendLine('[Peer]')
  [void]$conf.AppendLine("PublicKey = $cpub")
  [void]$conf.AppendLine("AllowedIPs = $ip/32")
  # client config for the user's device
  $client = @"
[Interface]
PrivateKey = $cpriv
Address = $ip/32

[Peer]
PublicKey = $srvPub
Endpoint = <SERVER_PUBLIC_IP>:51820
AllowedIPs = 10.8.0.0/24
PersistentKeepalive = 25
"@
  Set-Content -LiteralPath "$InstallDir-clients\peer$i.conf" -Value $client -Encoding ASCII
}
Set-Content -LiteralPath 'C:\wg\server.conf' -Value $conf.ToString() -Encoding ASCII

if (-not (Have wg)) { } # silence
& $wgMain /installtunnelservice C:\wg\server.conf 2>$null
Start-Sleep -Seconds 2
Info ("Tunnel status: " + ((& $wg show) -join ' | '))

# --- 6. Firewall --------------------------------------------------------------
New-NetFirewallRule -DisplayName 'Antidetect WireGuard UDP 51820' -Direction Inbound `
  -Protocol UDP -LocalPort 51820 -Action Allow -ErrorAction SilentlyContinue | Out-Null
Ok "Firewall: inbound UDP 51820 allowed."

# --- 7. Summary ---------------------------------------------------------------
$apiKeyPath = Join-Path $env:USERPROFILE '.antidetect\data\api_key'
Write-Host ''
Write-Host '================ DEPLOYMENT SUMMARY ================' -ForegroundColor Magenta
Write-Host "Install dir : $InstallDir"
Write-Host "WG clients  : $InstallDir-clients\peer1..$Peers.conf (import into WireGuard on your devices)"
Write-Host "              -> replace <SERVER_PUBLIC_IP> inside each .conf!"
Write-Host "Panel       : http://10.8.0.1/ui   (after you import peer conf on a device)"
Write-Host "API key     : $apiKeyPath (printed by the service console too)"
Write-Host ''
Warn 'NEXT MANUAL STEPS:'
Write-Host ' 1. Enable auto-logon so Chromium keeps a desktop session:'
Write-Host '    Set-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon DefaultUserName '''$user''''
Write-Host '    Set-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon DefaultPassword ''<PASSWORD>'''
Write-Host '    Set-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon AutoAdminLogon ''1'''
Write-Host ' 2. Reboot once. The service starts automatically at logon.'
Write-Host ' 3. Optional reverse proxy: docker compose up -d in '$InstallDir'\deploy'
Write-Host '===================================================='
