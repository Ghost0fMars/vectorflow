$qdrantDir = "$PSScriptRoot\qdrant-bin"
$qdrantExe = "$qdrantDir\qdrant.exe"

if (-not (Test-Path $qdrantExe)) {
    Write-Host "Telechargement de Qdrant..." -ForegroundColor Cyan

    $release = Invoke-RestMethod "https://api.github.com/repos/qdrant/qdrant/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -like "*x86_64*windows*msvc*.zip" } | Select-Object -First 1

    if (-not $asset) {
        Write-Error "Impossible de trouver le binaire Windows dans les releases Qdrant."
        exit 1
    }

    $zipPath = "$env:TEMP\qdrant.zip"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
    New-Item -ItemType Directory -Force -Path $qdrantDir | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $qdrantDir -Force
    Remove-Item $zipPath

    Write-Host "Qdrant installe dans $qdrantDir" -ForegroundColor Green
}

Write-Host "Demarrage de Qdrant sur http://localhost:6333 ..." -ForegroundColor Cyan
Write-Host "Appuyez sur Ctrl+C pour arreter." -ForegroundColor Yellow
& $qdrantExe
