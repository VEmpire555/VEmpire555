@echo off
setlocal
py -m venv .venv
call .venv\Scripts\activate
py -m pip install --upgrade pip
py -m pip install -r requirements.txt pyinstaller
py -m PyInstaller --noconfirm --clean ^
  --name VTBordAPR ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  app.py

echo.
echo Byggt! Exe finns i .\dist\VTBordAPR\VTBordAPR.exe
echo Kopiera .env till .\dist\VTBordAPR\ och starta EXE.
