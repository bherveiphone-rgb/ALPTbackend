@echo off
setlocal
chcp 65001 >nul
title Atelier - Devis, CRM, Production
cd /d "%~dp0\.."
set "SILENT=%~1"

rem ---- 1. Node.js -----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js n'est pas installe : installation automatique en cours...
  echo  ^(acceptez la fenetre Windows qui peut s'afficher^)
  echo.
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo  Installation automatique impossible.
    echo  Telechargez "Node.js LTS" sur la page qui va s'ouvrir, installez-le,
    echo  puis double-cliquez de nouveau sur ce fichier.
    start "" "https://nodejs.org/fr/download"
    pause
    exit /b 1
  )
  echo.
  echo  Node.js est installe. Fermez cette fenetre puis double-cliquez de nouveau sur ce fichier.
  pause
  exit /b 0
)

rem ---- 2. Composants ---------------------------------------------------------
if not exist "node_modules\express" (
  echo.
  echo  Premiere installation des composants ^(1 a 3 minutes^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  Erreur pendant l'installation. Verifiez votre connexion Internet et relancez.
    pause
    exit /b 1
  )
)

rem ---- 3. Mot de passe (cree une seule fois) ---------------------------------
if not exist ".env" (
  node -e "const c=require('crypto');require('fs').writeFileSync('.env','ADMIN_PASSWORD='+c.randomBytes(6).toString('base64url')+'\nPORT=4242\n')"
  set "FIRST=1"
)
for /f "tokens=1,* delims==" %%a in ('findstr /b "ADMIN_PASSWORD=" ".env"') do set "PW=%%b"

rem ---- 4. Deja lance ? -------------------------------------------------------
netstat -ano | findstr /r /c:":4242 .*LISTENING" >nul
if not errorlevel 1 (
  if /i not "%SILENT%"=="/silent" start "" "http://localhost:4242/devis/"
  exit /b 0
)

cls
echo.
echo  =============================================================
echo    ATELIER - Devis, CRM, Production
echo  =============================================================
echo.
echo    Adresse      : http://localhost:4242/devis/
echo    Mot de passe : %PW%
echo.
if defined FIRST echo    ^>^> Notez ce mot de passe ^(modifiable dans le fichier .env^).
echo.
echo    GARDEZ CETTE FENETRE OUVERTE ^(vous pouvez la reduire^).
echo    La fermer arrete le logiciel.
echo  =============================================================
echo.
rem Tunnel permanent (adresse fixe pour les clients) s'il a ete configure
if exist "%USERPROFILE%\.cloudflared\config.yml" (
  where cloudflared >nul 2>nul && start "Atelier - tunnel Internet" /min cloudflared tunnel run
  echo    Connexion Internet clients : active ^(fenetre "tunnel" reduite^)
  echo.
)
if /i not "%SILENT%"=="/silent" start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:4242/devis/"

:boucle
node server.js
echo.
echo  Le logiciel s'est arrete. Redemarrage dans 5 secondes ^(fermez la fenetre pour arreter^)...
timeout /t 5 /nobreak >nul
goto boucle
