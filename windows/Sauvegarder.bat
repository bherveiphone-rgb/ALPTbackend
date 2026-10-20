@echo off
chcp 65001 >nul
cd /d "%~dp0\.."
if not exist data mkdir data
if not exist uploads mkdir uploads
set "DEST=%USERPROFILE%\Documents\Sauvegardes-Atelier"
if not exist "%DEST%" mkdir "%DEST%"
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set "STAMP=%%d"
powershell -NoProfile -Command "Compress-Archive -Path 'data','uploads','.env' -DestinationPath '%DEST%\atelier-%STAMP%.zip' -Force"
if errorlevel 1 (
  echo  La sauvegarde a echoue.
) else (
  echo  Sauvegarde creee : %DEST%\atelier-%STAMP%.zip
  echo  Conseil : copiez ce dossier sur une cle USB ou Google Drive / OneDrive.
)
pause
