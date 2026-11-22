import json, os, time, urllib.request, urllib.error
TT = os.environ.get("TOMTOM_API_KEY", "").strip()
CD = os.environ.get("CDOT_API_KEY", "").strip()
out = {"routes": {}, "flow": {}, "cdot": {}, "web": {}}

def get(url, timeout=25):
    t = url
    for k in (TT, CD):
        if k: t = t.replace(k, "KEY")
    req = urllib.request.Request(url, headers={"User-Agent": "ski-dashboard-probe", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("content-type", ""), r.read(), t
    except urllib.error.HTTPError as e:
        return e.code, "", (e.read() or b"")[:300], t
    except Exception as e:
        return 0, "", str(e).encode()[:300], t

# ---- routes
W = {"coors": (39.7562, -104.9942), "floyd": (39.74238, -105.43138)}
variants = {
    "plain": [W["coors"], W["floyd"]],
    "via_i70_golden": [W["coors"], (39.7800, -105.1400), W["floyd"]],
    "via_genesee": [W["coors"], (39.7010, -105.2840), W["floyd"]],
    "via_i25_i70": [W["coors"], (39.7835, -105.0662), (39.7794, -105.1392), W["floyd"]],
}
for name, pts in variants.items():
    locs = ":".join(f"{a},{b}" for a, b in pts)
    time.sleep(0.4)
    s, ct, body, _ = get(f"https://api.tomtom.com/routing/1/calculateRoute/{locs}/json?key={TT}&traffic=true&computeTravelTimeFor=all&routeType=fastest&travelMode=car")
    rec = {"status": s}
    try:
        j = json.loads(body)
        r = j["routes"][0]; sm = r["summary"]
        geo = [p for leg in r["legs"] for p in leg["points"]]
        rec.update(km=round(sm["lengthInMeters"] / 1000, 1), live_min=round(sm["travelTimeInSeconds"] / 60, 1),
                   free_min=round(sm["noTrafficTravelTimeInSeconds"] / 60, 1),
                   path=[[round(p["latitude"], 4), round(p["longitude"], 4)] for p in geo[::max(1, len(geo) // 25)]])
    except Exception as e:
        rec["err"] = str(e)[:100]; rec["body"] = body[:200].decode(errors="replace")
    out["routes"][name] = rec

# ---- flow
cands = {
    "i25_a": (39.8038, -104.9834), "i25_b": (39.8277, -104.9912),
    "us36_a": (39.854, -105.0513), "us36_b": (39.9134, -105.0902), "us36_c": (39.9469, -105.1486), "us36_d": (39.9801, -105.2206),
    "i70_a": (39.7835, -105.0662), "i70_b": (39.7794, -105.1392), "co58_a": (39.7733, -105.1729), "co58_b": (39.7664, -105.2104),
}
import math
def dist(lat, lon, pts):
    kx, ky = 111320 * math.cos(math.radians(lat)), 110540
    xy = [((p["longitude"] - lon) * kx, (p["latitude"] - lat) * ky) for p in pts]
    best = None
    for (x0, y0), (x1, y1) in zip(xy, xy[1:] or xy):
        dx, dy = x1 - x0, y1 - y0
        t = 0 if dx == dy == 0 else max(0, min(1, -(x0 * dx + y0 * dy) / (dx * dx + dy * dy)))
        d = math.hypot(x0 + t * dx, y0 + t * dy); best = d if best is None else min(best, d)
    return None if best is None else round(best)
for n, (la, lo) in cands.items():
    time.sleep(0.4)
    s, ct, body, _ = get(f"https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/12/json?point={la},{lo}&unit=MPH&key={TT}")
    rec = {"status": s, "pt": [la, lo]}
    try:
        d = json.loads(body)["flowSegmentData"]; pts = d["coordinates"]["coordinate"]
        rec.update(frc=d.get("frc"), cur=d.get("currentSpeed"), free=d.get("freeFlowSpeed"), conf=d.get("confidence"),
                   snap_m=dist(la, lo, pts), n=len(pts), seg=[[round(p["latitude"], 4), round(p["longitude"], 4)] for p in pts[:: max(1, len(pts)//4)]])
    except Exception as e:
        rec["err"] = str(e)[:100]
    out["flow"][n] = rec

# ---- CDOT keyed feeds
def sample(body):
    try:
        j = json.loads(body)
    except Exception:
        return {"raw": body[:300].decode(errors="replace")}
    feats = j.get("features", j) if isinstance(j, dict) else j
    if isinstance(feats, list) and feats:
        f = feats[0]
        return {"count": len(feats), "first": json.loads(json.dumps(f))}
    return {"keys": list(j)[:20] if isinstance(j, dict) else None}
for ep in ["cameras", "camera", "plows", "snowPlows", "snowplows", "plowTrucks", "avl", "maintenanceVehicles", "weatherStations"]:
    time.sleep(0.4)
    s, ct, body, _ = get(f"https://data.cotrip.org/api/v1/{ep}?apiKey={CD}&limit=3")
    out["cdot"][ep] = {"status": s, "ct": ct, **(sample(body) if s == 200 else {"raw": body[:200].decode(errors="replace")})}

# ---- public web (terms, camera feed)
for name, url in {
    "cars_cameras": "https://api-511x-co.carsprogram.org/cameras_v1/api/cameras",
    "cars_plows": "https://api-511x-co.carsprogram.org/events/map-features?eventClassifications=snowPlows",
    "cars_root": "https://api-511x-co.carsprogram.org/",
    "cotrip_terms": "https://www.cotrip.org/terms",
    "data_root": "https://data.cotrip.org/",
    "data_terms": "https://data.cotrip.org/terms",
}.items():
    s, ct, body, _ = get(url)
    out["web"][name] = {"status": s, "ct": ct, "len": len(body), "head": body[:700].decode(errors="replace")}

os.makedirs("probe_out", exist_ok=True)
json.dump(out, open("probe_out/result.json", "w"), indent=1)
print("done")
