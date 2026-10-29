@echo off
REM VTC Counter Sales - start on the counter PC (the one with the ATPOS printer).
REM First start: sets itself up, asks which folder to save every day, then opens the counter.
cd /d "%~dp0"
title VTC Counter - starting

if not exist .venv (
  echo First start: setting up. This needs internet once and takes about 2 minutes...
  python -m venv .venv || (echo Python 3.10 or newer is needed: https://www.python.org/downloads/  - tick "Add Python to PATH" & pause & exit /b 1)
  call "%~dp0make_desktop_icon.bat" quiet
)
REM installs only when requirements.txt changed (first start or after an update), so daily starts work without internet
fc /b requirements.txt .venv\installed.txt >nul 2>&1
if errorlevel 1 (
  .venv\Scripts\python -m pip install --disable-pip-version-check -q -r requirements.txt || (echo Setup could not download what it needs. Check the internet and run again. & pause & exit /b 1)
  copy /y requirements.txt .venv\installed.txt >nul
)
if not exist data mkdir data

REM ---- the daily save folder: asked once, owner can change it later in Setup -> Shop & saving
if not exist data\save_folder.txt (
  echo.
  echo Choose the folder where the counter saves every day ^(a backup, the bills in Excel and a day summary PDF^).
  echo Tip: a second drive or a synced folder ^(Google Drive / OneDrive^) is safest.
  powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose the folder where VTC Counter saves every day'; $d.ShowNewFolderButton = $true; if ($d.ShowDialog() -eq 'OK') { [IO.File]::WriteAllText('data\save_folder.txt', $d.SelectedPath) }"
)
if not exist data\save_folder.txt (
  echo No folder chosen. Using Documents\VTC Counter Saves for now. Change it any time in Setup -^> Shop ^& saving.
  powershell -NoProfile -Command "[IO.File]::WriteAllText('data\save_folder.txt', [Environment]::GetFolderPath('MyDocuments') + '\VTC Counter Saves')"
)
set /p VTC_SAVE_DIR=<data\save_folder.txt
echo Daily saves go to: %VTC_SAVE_DIR%

REM ---- the counter server (keep its window open; closing it stops billing on every device)
REM already running (icon pressed again)? then just open the window
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/ -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 start "VTC Counter server - keep open" /min .venv\Scripts\python -m uvicorn counter.main:app --host 0.0.0.0 --port 8000
powershell -NoProfile -Command "for ($i=0; $i -lt 40; $i++) { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/ -TimeoutSec 1 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1" || (echo The counter server did not start. Look at the "VTC Counter server" window for the reason. & pause & exit /b 1)

REM ---- open the counter in Chrome (or Edge) with direct printing: one press = one bill to the default printer
set "BROWSER="
for %%B in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
  if not defined BROWSER if exist %%B set "BROWSER=%%~B"
)
if not defined BROWSER (
  echo Chrome or Edge not found. Open http://127.0.0.1:8000/?station=1 in your browser.
  pause & exit /b 0
)
start "" "%BROWSER%" --kiosk-printing --no-first-run --user-data-dir="%~dp0data\browser" --app=http://127.0.0.1:8000/?station=1
echo.
echo VTC Counter is open.
echo   Tablet on the shop Wi-Fi: open  http://THIS-PC-IP:8000   (find the IP with: ipconfig, "IPv4 Address")
echo   Bills print straight to the ATPOS printer (Windows default printer, or the one chosen in Setup - Printer).
timeout /t 8 >nul
