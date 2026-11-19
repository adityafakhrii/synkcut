param(
    [string]$TargetTriple = ""
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BinDir = Join-Path $ProjectRoot "src-tauri\binaries"
$TempDir = Join-Path $env:TEMP "synkcut-ffmpeg-setup"
$ZipPath = Join-Path $TempDir "ffmpeg-lgpl.zip"
$DownloadUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip"

if (-not $TargetTriple) {
    $RustInfo = rustc -vV 2>$null
    $HostLine = $RustInfo | Where-Object { $_ -like "host:*" } | Select-Object -First 1
    if ($HostLine) {
        $TargetTriple = ($HostLine -replace "^host:\s*", "").Trim()
    } else {
        $TargetTriple = "x86_64-pc-windows-msvc"
    }
}

Write-Host "[Synkcut] Target triple: $TargetTriple" -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$FfmpegDest = Join-Path $BinDir "ffmpeg-$TargetTriple.exe"
$FfprobeDest = Join-Path $BinDir "ffprobe-$TargetTriple.exe"

if ((Test-Path $FfmpegDest) -and (Test-Path $FfprobeDest)) {
    Write-Host "[Synkcut] FFmpeg & FFprobe LGPL sidecar sudah tersedia di $BinDir" -ForegroundColor Green
    exit 0
}

Write-Host "[Synkcut] Mengunduh FFmpeg LGPL build (win64) dari BtbN/FFmpeg-Builds..." -ForegroundColor Yellow
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing

Write-Host "[Synkcut] Mengekstrak binary ffmpeg.exe & ffprobe.exe..." -ForegroundColor Yellow
$ExtractDir = Join-Path $TempDir "extracted"
if (Test-Path $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir }
Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force

$FfmpegSrc = Get-ChildItem -Path $ExtractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
$FfprobeSrc = Get-ChildItem -Path $ExtractDir -Recurse -Filter "ffprobe.exe" | Select-Object -First 1

if (-not $FfmpegSrc -or -not $FfprobeSrc) {
    throw "Gagal menemukan ffmpeg.exe atau ffprobe.exe di dalam arsip."
}

Copy-Item -Path $FfmpegSrc.FullName -Destination $FfmpegDest -Force
Copy-Item -Path $FfprobeSrc.FullName -Destination $FfprobeDest -Force

Remove-Item -Recurse -Force $TempDir

Write-Host "[Synkcut] Selesai! Sidecar siap:" -ForegroundColor Green
Write-Host "  - $FfmpegDest"
Write-Host "  - $FfprobeDest"

& $FfmpegDest -version | Select-Object -First 2
