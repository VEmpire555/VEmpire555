import os, time, base64, urllib.parse
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
import requests

load_dotenv()

# --- Konfiguration / Konstanter ---
VT_KEY     = os.environ["VASTTRAFIK_KEY"]
VT_SECRET  = os.environ["VASTTRAFIK_SECRET"]
VT_BASE    = os.environ.get("VASTTRAFIK_BASE", "https://ext-api.vasttrafik.se/pr/v4")  # APR v4 bas-URL
TOKEN_URL  = os.environ.get("VASTTRAFIK_TOKEN_URL", "https://api.vasttrafik.se/token")   # OAuth2 token endpoint

# Låst StopArea GID + karta‑center för Volvo Torslanda PVH
PVH_GID = "9021014007488000"               # Hårdkodat StopArea GID
PVH_LAT, PVH_LON = 57.72794, 11.86621      # Kart‑center (PVH)

app = Flask(__name__)

# --- OAuth2 token-cache (client_credentials) ---
_token_cache = {"access_token": None, "exp": 0}

def get_access_token():
    now = time.time()
    if _token_cache["access_token"] and _token_cache["exp"] - now > 60:
        return _token_cache["access_token"]
    basic = base64.b64encode(f"{VT_KEY}:{VT_SECRET}".encode()).decode()
    data = {"grant_type": "client_credentials", "scope": "local-app"}
    headers = {"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"}
    r = requests.post(TOKEN_URL, data=data, headers=headers, timeout=12)
    r.raise_for_status()
    js = r.json()
    _token_cache["access_token"] = js["access_token"]
    _token_cache["exp"] = now + int(js.get("expires_in", 3600))
    return _token_cache["access_token"]

def vt_get(path, params=None):
    token = get_access_token()
    url = VT_BASE + path
    headers = {"Authorization": f"Bearer {token}"}
    r = requests.get(url, headers=headers, params=params or {}, timeout=12)
    if r.status_code == 401:
        _token_cache["access_token"], _token_cache["exp"] = None, 0
        headers["Authorization"] = f"Bearer {get_access_token()}"
        r = requests.get(url, headers=headers, params=params or {}, timeout=12)
    r.raise_for_status()
    return r.json()

@app.route("/")
def index():
    defaults = [
        {"label": "PVH → Mölndal (X90)", "from_gid": PVH_GID, "to_contains": "Mölndal Resecentrum", "lines": "X90"},
        {"label": "PVH → Göteborg C (X1)", "from_gid": PVH_GID, "to_contains": "Göteborg Central", "lines": "X1"},
        {"label": "PVH → Korsvägen (X6)", "from_gid": PVH_GID, "to_contains": "Korsvägen", "lines": "X6"},
    ]
    return render_template("index.html", defaults=defaults, pvh={"gid": PVH_GID, "lat": PVH_LAT, "lon": PVH_LON})

# --- (A) Realtidsavgångar för StopArea (APR 10.1) ---
@app.route("/api/vt/departures")
def departures():
    stop_area_gid = request.args.get("stop_area_gid") or PVH_GID
    wanted_lines = {s.strip().upper() for s in (request.args.get("lines") or "").split(",") if s.strip()}
    to_contains = (request.args.get("to_contains") or "").strip().lower()
    modes = {m.strip().lower() for m in (request.args.get("modes") or "").split(",") if m.strip()}

    raw = vt_get(f"/stop-areas/{urllib.parse.quote(stop_area_gid)}/departures")

    def pick_time(obj):
        return obj.get("estimatedOtherwisePlannedTime") or obj.get("estimatedTime") or obj.get("plannedTime")

    out = []
    for d in raw.get("departures", []):
        line = (d.get("line") or {})
        designation = (line.get("designation") or line.get("name") or "").upper()
        tm = (line.get("transportMode") or "").lower()

        dest = ""
        if isinstance(d.get("destination"), dict):
            dest = d["destination"].get("name") or d["destination"].get("text") or ""
        dest = dest or (d.get("direction") or {}).get("text") or ""

        if wanted_lines and designation not in wanted_lines: 
            continue
        if modes and tm and tm not in modes: 
            continue
        if to_contains and to_contains not in dest.lower(): 
            continue

        out.append({
            "time": pick_time(d),
            "plannedTime": d.get("plannedTime"),
            "isRealtime": bool(d.get("estimatedTime") or d.get("estimatedOtherwisePlannedTime")),
            "line": designation,
            "transportMode": tm.upper(),
            "destination": dest,
            "detailsReference": d.get("detailsReference"),
        })
    out.sort(key=lambda x: (x["time"] or ""))
    return jsonify({"stopAreaGid": stop_area_gid, "count": len(out), "departures": out})

# --- (B) Detaljer för en avgång (APR 10.3) ---
@app.route("/api/vt/departure-details")
def departure_details():
    stop_area_gid = request.args.get("stop_area_gid") or PVH_GID
    ref = request.args.get("detailsReference")
    if not ref:
        return jsonify({"error": "detailsReference saknas"}), 400
    params = {"includes": ",".join(["servicejourneycalls", "servicejourneycoordinates", "occupancy"]) }
    js = vt_get(f"/stop-areas/{urllib.parse.quote(stop_area_gid)}/departures/{urllib.parse.quote(ref)}/details", params=params)

    calls = []
    for c in js.get("serviceJourney", {}).get("calls", []):
        calls.append({
            "time": c.get("estimatedOtherwisePlannedTime") or c.get("estimatedTime") or c.get("plannedTime"),
            "stopName": (c.get("stopPoint") or {}).get("name"),
            "stopGid": (c.get("stopPoint") or {}).get("gid"),
            "platform": (c.get("platform") or {}).get("name"),
        })
    coords = js.get("serviceJourney", {}).get("coordinates") or []
    return jsonify({"calls": calls, "coordinates": coords})

# --- (C) Fordonspositioner (APR kapitel 9: Positions) ---
@app.route("/api/vt/positions")
def positions():
    swLat = request.args.get("swLat")
    swLon = request.args.get("swLon")
    neLat = request.args.get("neLat")
    neLon = request.args.get("neLon")
    lines = {s.strip().upper() for s in (request.args.get("lines") or "").split(",") if s.strip()}

    params = {}
    if swLat and swLon and neLat and neLon:
        params.update({
            "southWestLat": swLat, "southWestLon": swLon,
            "northEastLat": neLat, "northEastLon": neLon,
        })
    js = vt_get("/positions", params=params)

    vehicles = []
    for v in js.get("positions", []):
        line = ((v.get("line") or {}).get("designation") or "").upper()
        if lines and line not in lines: 
            continue
        pos = v.get("position") or {}
        vehicles.append({
            "lat": pos.get("latitude"), "lon": pos.get("longitude"),
            "bearing": pos.get("bearing"),
            "line": line, "vehicleId": v.get("vehicleId"),
            "destination": (v.get("destination") or {}).get("name") or "",
        })
    return jsonify({"vehicles": vehicles})

@app.route("/api/vt/pvh")
def pvh():
    return jsonify({"gid": PVH_GID, "lat": PVH_LAT, "lon": PVH_LON})

if __name__ == "__main__":
    app.run(debug=True)
