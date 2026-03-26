# ============================================================
#  EEMessage Deploy Script
#  Kullanim:
#    .\deploy.ps1          -> Docker deploy (varsayilan)
#    .\deploy.ps1 -apk     -> APK build
#    .\deploy.ps1 -all     -> Hem Docker hem APK
# ============================================================

param(
    [switch]$apk,
    [switch]$all
)

$ErrorActionPreference = "Stop"
$ProjectDir = $PSScriptRoot

function Write-Step($msg) {
    Write-Host ""
    Write-Host ">>> $msg" -ForegroundColor Cyan
}

function Write-Success($msg) {
    Write-Host "✅ $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
    Write-Host "❌ $msg" -ForegroundColor Red
}

# --------------------------------------------------------
# DOCKER DEPLOY
# --------------------------------------------------------
function Deploy-Docker {
    Write-Step "Frontend build yapiliyor (npm run build)..."
    Set-Location $ProjectDir
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "Build basarisiz!"; exit 1 }
    Write-Success "Build tamamlandi."

    Write-Step "Docker servisleri yeniden baslatiliyor..."
    docker compose down --remove-orphans
    docker compose build --no-cache
    docker compose up -d
    if ($LASTEXITCODE -ne 0) { Write-Fail "Docker baslatma basarisiz!"; exit 1 }
    Write-Success "Docker deploy tamamlandi! Site: http://localhost:7010"
}

# --------------------------------------------------------
# APK BUILD
# --------------------------------------------------------
function Build-APK {
    Write-Step "Frontend build yapiliyor (npm run build)..."
    Set-Location $ProjectDir
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "Build basarisiz!"; exit 1 }
    Write-Success "Build tamamlandi."

    Write-Step "Capacitor sync yapiliyor..."
    npx cap sync android
    if ($LASTEXITCODE -ne 0) { Write-Fail "Cap sync basarisiz!"; exit 1 }
    Write-Success "Capacitor sync tamamlandi."

    Write-Step "Android APK derleniyor (release)..."
    Set-Location "$ProjectDir\android"
    .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) { Write-Fail "Gradle build basarisiz!"; exit 1 }

    $apkPath = "$ProjectDir\android\app\build\outputs\apk\release\app-release.apk"
    $destPath = "$ProjectDir\eemessage-release.apk"

    if (Test-Path $apkPath) {
        Copy-Item $apkPath $destPath -Force
        Write-Success "APK hazir: $destPath"
    } else {
        # unsigned APK fallback
        $apkPathUnsigned = "$ProjectDir\android\app\build\outputs\apk\release\app-release-unsigned.apk"
        if (Test-Path $apkPathUnsigned) {
            Copy-Item $apkPathUnsigned $destPath -Force
            Write-Success "APK hazir (imzasiz): $destPath"
        } else {
            Write-Fail "APK bulunamadi! android/app/build/outputs/apk/ klasorunu kontrol edin."
        }
    }
    Set-Location $ProjectDir
}

# --------------------------------------------------------
# ANA AKIS
# --------------------------------------------------------
if ($all) {
    Deploy-Docker
    Build-APK
} elseif ($apk) {
    Build-APK
} else {
    Deploy-Docker
}
