@echo off
chcp 65001 >nul
echo === Build: Escala de Sobreaviso ===
echo.

echo [1/3] Instalando dependencias Python (pywebview + pyinstaller)...
pip install pywebview pyinstaller
if %errorlevel% neq 0 (
    echo ERRO ao instalar dependencias.
    pause
    exit /b 1
)
echo.

echo [2/3] Construindo executavel...
python -m PyInstaller ^
  --onefile ^
  --windowed ^
  --name EscalaSobreaviso ^
  --add-data "Escala-SA.html;." ^
  --add-data "libs;libs" ^
  --collect-all webview ^
  main.py
if %errorlevel% neq 0 (
    echo ERRO ao construir o executavel.
    pause
    exit /b 1
)
echo.

echo [3/3] Verificando resultado...
if exist dist\EscalaSobreaviso.exe (
    echo.
    echo  Executavel criado com sucesso!
    echo  Localizacao: %CD%\dist\EscalaSobreaviso.exe
    echo.
    echo  Obs: o app precisa de conexao com a internet na primeira execucao
    echo  para carregar React e Tailwind CSS via CDN.
) else (
    echo ERRO: executavel nao encontrado em dist\.
)
echo.
pause
