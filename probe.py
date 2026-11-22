import json, os, time, collections, urllib.request, urllib.error
TT = os.environ.get("TOMTOM_API_KEY", "").strip()
out = {}
def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": "ski-dashboard-probe", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, (e.read() or b"")[:300]
    except Exception as e:
        return 0, str(e).encode()[:300]
# sixth W variants
def route(pts):
    locs = ":".join(f"{a},{b}" for a, b in pts); time.sleep(0.4)
    s, b = get(f"https://api.tomtom.com/routing/1/calculateRoute/{locs}/json?key={TT}&traffic=true&routeType=fastest&travelMode=car&computeTravelTimeFor=all")
    try:
        sm = json.loads(b)["routes"][0]["summary"]; return {"km": round(sm["lengthInMeters"]/1000,1), "min": round(sm["travelTimeInSeconds"]/60,1), "free": round(sm["noTrafficTravelTimeInSeconds"]/60,1)}
    except Exception as e: return {"err": str(e)[:80], "s": s}
C = (39.7562, -104.9942)
out["sixthW"] = {
  "orig": route([C, (39.7254, -105.0800), (39.74245, -105.25436)]),
  "end_e1": route([C, (39.7254, -105.0800), (39.74453, -105.25156)]),
  "end_e2": route([C, (39.7254, -105.0800), (39.74939, -105.25135)]),
  "end_e3": route([C, (39.7254, -105.0800), (39.74854, -105.25146)]),
  "noend_via": route([C, (39.7254, -105.1500), (39.7430, -105.2400)]),
}
os.makedirs("probe_out", exist_ok=True)
json.dump(out, open("probe_out/result5.json", "w"), indent=1)
