# Västtrafik APR – Realtidsavgångar (lokal app)

Lokal Flask‑app som visar **realtidsavgångar** för *Volvo Torslanda PVH* (låst StopArea GID `9021014007488000`),
ritar **fordonspositioner** på karta och ger **detaljerad resa** via APR:s details‑endpoints.

## Förutsättningar
- Python 3.10+
- En appnyckel/secret från Västtrafiks utvecklarportal (APR v4). Du använder OAuth2 *client_credentials* mot `https://api.vasttrafik.se/token`.

## Kom igång
```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # fyll VASTTRAFIK_KEY/SECRET
python app.py               # http://localhost:5000
```

## Vad ingår
- **/api/vt/departures** – hämtar avgångar med realtid för PVH (filtrering: linje/destination)
- **/api/vt/departure-details** – details för en avgång (hållplatser, ev. geometri)
- **/api/vt/positions** – fordonspositioner inom kartans bounding box
- **UI**: lista över avgångar (klick → detaljer) + Leaflet‑karta med fordon (filtrerbart per linje)

## Bygg Windows .exe (frivilligt)
Skapa EXE via PyInstaller:
```bash
pip install pyinstaller
pyinstaller --noconfirm --clean \
  --name VTBordAPR \
  --add-data "templates;templates" \
  --add-data "static;static" \
  app.py
```
Kopiera `.env` till `dist/VTBordAPR/` och kör `VTBordAPR.exe`.

## Notiser
- StopArea GID är hårdkodat till `9021014007488000` (Volvo Torslanda PVH).
- Kart‑center är satt till lat 57.72794, lon 11.86621.
- Justera uppdateringsintervall i UI (30–60 s). Positions‑poll är 30 s.
- Om APR:s positions‑endpoint kräver andra parameternamn för bbox i din miljö: ändra i `/api/vt/positions`.
