@echo off
rem PL Composer: its own native window (Tauri) over the local Next server (S342, his ruling: desktop apps, local-first).
rem Build the window once or after editing src-tauri\ :  cd C:\dev\pl-composer && npx tauri build --debug --no-bundle
set EXE=C:\dev\pl-composer\src-tauri\target\debug\pl-composer.exe
cd /d C:\dev\pl-composer
powershell -NoProfile -Command "if (-not (Test-NetConnection 127.0.0.1 -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Process -WindowStyle Minimized cmd -ArgumentList '/c','npm run dev' }"
powershell -NoProfile -Command "$t=0; while ($t -lt 60 -and -not (Test-NetConnection 127.0.0.1 -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Sleep -Seconds 1; $t++ }"
if exist "%EXE%" (start "" "%EXE%") else (echo PL Composer window is not built yet. Run: cd C:\dev\pl-composer ^&^& npx tauri build --debug --no-bundle & pause)
