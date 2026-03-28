# ============================================================
#  EEMessage Fast Deploy & APK Build Script (Local & VPS)
# ============================================================
$VPS_IP = "5.199.136.52"
$REMOTE_PATH = "/opt/eemessage"
$BASE_DIR = "C:\Users\ertu1\Desktop\eemessage"
$LOCAL_APK_DEST = "$BASE_DIR\eemessage.apk"
$VPS_APK_DEST = "/root/eemessage.apk"

Write-Host ">>> Islem baslatiliyor..." -ForegroundColor Cyan

# 1. GitHub Yedekleme
Write-Host ">>> 1/4: GitHub yedeklemesi yapiliyor..." -ForegroundColor Yellow
git add .
git commit -m "Auto-backup before deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push origin main

# 2. Yerel APK Build (Debug)
Write-Host ">>> 2/4: Frontend build ve Android Debug derleme basliyor..." -ForegroundColor Yellow
npm run build
npx cap sync android

Set-Location "$BASE_DIR\android"
.\gradlew.bat assembleDebug
Set-Location "$BASE_DIR"

# Buradaki yolu kesinlestirdik
$BUILT_APK = "$BASE_DIR\android\app\build\outputs\apk\debug\app-debug.apk"

# 3. Dosya Kopyalama ve SCP
if (Test-Path $BUILT_APK) {
    Write-Host ">>> 3/4: APK yerel klasore kopyalaniyor..." -ForegroundColor Yellow
    
    # Eskisini silip yenisini koyuyoruz ki degistiginden emin olalım
    if (Test-Path $LOCAL_APK_DEST) { Remove-Item $LOCAL_APK_DEST -Force }
    Copy-Item $BUILT_APK $LOCAL_APK_DEST -Force
    
    Write-Host "✅ APK Yerel Yol: $LOCAL_APK_DEST" -ForegroundColor Green

    Write-Host ">>> VPS'e gonderiliyor (/root)..." -ForegroundColor Yellow
    scp $BUILT_APK "root@${VPS_IP}:${VPS_APK_DEST}"
}
else {
    Write-Error "Build basarisiz! Android klasorunde APK bulunamadi: $BUILT_APK"
    exit 1
}

# 4. VPS Docker Güncelleme
Write-Host ">>> 4/4: VPS uzerinde Docker servisleri guncelleniyor..." -ForegroundColor Yellow
ssh root@$VPS_IP "cd $REMOTE_PATH && git pull origin main && docker compose down && docker compose build --no-cache && docker compose up -d"

Write-Host "✅ Tum islemler basariyla tamamlandi!" -ForegroundColor Green
