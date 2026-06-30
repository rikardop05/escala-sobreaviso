@echo off
pip install pywebview --quiet >nul 2>&1
python "%~dp0main.py"
