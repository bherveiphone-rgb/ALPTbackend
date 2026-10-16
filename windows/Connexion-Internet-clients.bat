@echo off
setlocal
chcp 65001 >nul
title Atelier - Connexion Internet pour les clients
cd /d "%~dp0\.."

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Installation de Cloudflare Tunnel ^(gratuit^)...
  winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo  Installation impossible. Voir le guide : windows\LISEZ-MOI.txt
    pause
    exit /b 1
  )
  echo.
  echo  Installe. Fermez cette fenetre et double-cliquez de nouveau sur ce fichier.
  pause
  exit /b 0
)

rem Tunnel permanent (adresse fixe) si vous l'avez configure avec votre nom de domaine
if exist "%USERPROFILE%\.cloudflared\config.yml" (
  echo  Tunnel permanent configure : demarrage...
  cloudflared tunnel run
  pause
  exit /b 0
)

echo.
echo  =============================================================
echo   Connexion TEMPORAIRE (pour essayer)
echo  =============================================================
echo   Dans quelques secondes, une adresse du type
echo      https://xxxx-xxxx.trycloudflare.com
echo   va s'afficher ci-dessous. Copiez-la dans le logiciel :
echo      Parametres ^> Formulaire et portail ^> Adresse publique
echo.
echo   ATTENTION : cette adresse change a chaque lancement.
echo   Pour une adresse fixe, suivez windows\LISEZ-MOI.txt (etape 4).
echo   Gardez cette fenetre ouverte.
echo  =============================================================
echo.
cloudflared tunnel --url http://localhost:4242
pause
