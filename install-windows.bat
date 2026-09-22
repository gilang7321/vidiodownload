@echo off
setlocal
cd /d "%~dp0"
echo ========================================
echo   VideoDown Cyberpunk - Windows Setup
echo ========================================
echo.
python --version
if errorlevel 1 (
  echo [ERROR] Python tidak ditemukan di PATH.
  echo Install Python dari https://www.python.org/downloads/windows/
  pause
  exit /b 1
)
echo.
python -m pip install -U yt-dlp curl_cffi
if errorlevel 1 (
  echo [ERROR] Gagal memasang yt-dlp/curl_cffi.
  pause
  exit /b 1
)
echo.
npm install
if errorlevel 1 (
  echo [ERROR] npm install gagal.
  pause
  exit /b 1
)
echo.
echo Setup selesai. Jalankan npm start untuk membuka VideoDown.
pause
