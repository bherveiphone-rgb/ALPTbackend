@echo off
setlocal
chcp 65001 >nul
title Atelier - Adresse Internet fixe
cd /d "%~dp0\.."
echo.
echo  =============================================================
echo   ADRESSE FIXE POUR VOS CLIENTS (ex. https://devis.mon-atelier.fr)
echo  =============================================================
echo   Prerequis : un nom de domaine gere par Cloudflare (compte gratuit).
echo   Voir windows\LISEZ-MOI.txt, etape 4.
echo.
where cloudflared >nul 2>nul
if errorlevel 1 (
  winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
  echo  Cloudflare Tunnel installe. Fermez cette fenetre et relancez ce fichier.
  pause
  exit /b 0
)
set /p HOST=" Adresse souhaitee (ex. devis.mon-atelier.fr) : "
if "%HOST%"=="" exit /b 1

echo.
echo  1/4 Connexion a votre compte Cloudflare (une page va s'ouvrir : choisissez votre domaine)...
if not exist "%USERPROFILE%\.cloudflared\cert.pem" cloudflared tunnel login
echo  2/4 Creation du tunnel "atelier"...
cloudflared tunnel create atelier
echo  3/4 Creation de l'adresse %HOST%...
cloudflared tunnel route dns atelier %HOST%

echo  4/4 Configuration...
set "CRED="
for /f "delims=" %%f in ('dir /b /o-d "%USERPROFILE%\.cloudflared\*.json" 2^>nul') do if not defined CRED set "CRED=%USERPROFILE%\.cloudflared\%%f"
if not defined CRED (
  echo  Erreur : identifiants du tunnel introuvables. Voir LISEZ-MOI.txt.
  pause
  exit /b 1
)
(
  echo tunnel: atelier
  echo credentials-file: %CRED%
  echo ingress:
  echo   - hostname: %HOST%
  echo     service: http://localhost:4242
  echo   - service: http_status:404
) > "%USERPROFILE%\.cloudflared\config.yml"

rem Enregistre l'adresse publique dans le logiciel
node -e "const fs=require('fs'),f='data/devis-settings.json';if(fs.existsSync(f)){const s=JSON.parse(fs.readFileSync(f,'utf8'));s.publicUrl='https://%HOST%';fs.writeFileSync(f,JSON.stringify(s,null,2));}"

echo.
echo  Termine ! Vos clients utiliseront : https://%HOST%
echo  Fermez puis relancez "Demarrer-Atelier" : le tunnel demarrera automatiquement.
echo  ^(Si l'adresse n'apparait pas dans Parametres, collez-la dans Formulaire et portail ^> Adresse publique.^)
pause
