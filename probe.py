import json, os, re, urllib.request, urllib.error
out = {}
def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "ski-dashboard-probe", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {}, (e.read() or b"")[:300]
    except Exception as e:
        return 0, {}, str(e).encode()[:300]
s, h, b = get("https://api-511x-co.carsprogram.org/cameras/map-features")
j = json.loads(b); fs = j["features"]
out["count"] = len(fs)
out["headers"] = {k: v for k, v in dict(h).items() if k.lower() in ("access-control-allow-origin", "cache-control", "content-length")}
out["sample_full"] = fs[0]
near = [f for f in fs if f["properties"].get("route") in ("I-70", "US 6", "US 40", "US 36", "CO 119", "I-25")]
out["near_count"] = len(near)
out["near_sample"] = near[:2]
out["routes"] = sorted({f["properties"].get("route") for f in fs if f["properties"].get("route")})[:60]
# image check
def imgs(f):
    v = f["properties"].get("views") or []
    return v
if near:
    v = imgs(near[0])
    out["views"] = v[:3]
    for view in v[:1]:
        u = view.get("url") or view.get("imageUrl")
        if u:
            s2, h2, b2 = get(u)
            out["img_status"] = s2; out["img_type"] = str(h2.get("content-type", "")) if h2 else ""; out["img_len"] = len(b2)
            out["img_cors"] = str(h2.get("access-control-allow-origin", "")) if h2 else ""
s, h, b = get("https://511.cotrip.org/configs/main.json?v=1.10.1")
cfg = json.loads(b)
out["cfg_cameras"] = cfg.get("cameras")
out["cfg_apis"] = cfg.get("apis")
os.makedirs("probe_out", exist_ok=True)
json.dump(out, open("probe_out/result3.json", "w"), indent=1)
