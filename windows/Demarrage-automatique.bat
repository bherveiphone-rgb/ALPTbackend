@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Atelier.lnk"
if exist "%LNK%" (
  del "%LNK%"
  echo  Demarrage automatique DESACTIVE.
  pause
  exit /b 0
)
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath='%~dp0Demarrer-Atelier.bat'; $s.Arguments='/silent'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
echo.
echo  Demarrage automatique ACTIVE : le logiciel se lancera a chaque ouverture de Windows
echo  ^(fenetre reduite dans la barre des taches^).
echo  Relancez ce fichier pour le desactiver.
echo.
echo  Conseil : Parametres Windows ^> Systeme ^> Alimentation ^> Mise en veille : "Jamais"
echo  ^(sinon vos clients ne peuvent plus ouvrir leurs devis quand le PC dort^).
pause
