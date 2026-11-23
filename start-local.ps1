$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$mediaBin = $env:YS_FFMPEG_BIN
if (-not $mediaBin) {
    $portable = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '.data/tools/ffmpeg') -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/ffmpeg.exe') } |
        Select-Object -First 1
    if ($portable) { $mediaBin = Join-Path $portable.FullName 'bin' }
}
if ($mediaBin) { $env:PATH = "$mediaBin;$env:PATH" }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning 'FFmpeg is not on PATH. Studio can open, but install FFmpeg before rendering or set YS_FFMPEG_BIN to its bin folder.'
}
if ($args.Count -eq 0) { & pnpm studio } else { & pnpm @args }
