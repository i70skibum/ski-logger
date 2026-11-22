import json, os, re, urllib.request, urllib.error
CD = os.environ.get("CDOT_API_KEY", "").strip()
out = {}
def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "ski-dashboard-probe", "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("content-type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, "", (e.read() or b"")[:300]
    except Exception as e:
        return 0, "", str(e).encode()[:300]
s, ct, b = get("https://511.cotrip.org/configs/main.json?v=1.10.1")
out["config_status"] = s
try:
    cfg = json.loads(b)
    txt = json.dumps(cfg)
    out["config_urls"] = sorted(set(re.findall(r'https?://[^"\\ ]+', txt)))[:80]
    out["config_camera_keys"] = [k for k in cfg if re.search("camera|cctv|image", k, re.I)]
    out["config_keys"] = list(cfg)[:60]
except Exception as e:
    out["config_err"] = str(e)[:100]; out["config_head"] = b[:300].decode(errors="replace")
s, ct, b = get("https://www.cotrip.org/terms")
t = re.sub(r"<script.*?</script>|<style.*?</style>|<[^>]+>", " ", b.decode(errors="replace"), flags=re.S)
out["terms_text"] = re.sub(r"\s+", " ", t)[:1500]
for ep in ["cctv", "trafficCameras", "cameraViews", "roadCameras", "cameraImages", "camerasList", "cameraSites"]:
    s, ct, b = get(f"https://data.cotrip.org/api/v1/{ep}?apiKey={CD}&limit=2")
    out["ep_" + ep] = [s, b[:400].decode(errors="replace").replace(CD, "KEY")]
for u in ["https://api-511x-co.carsprogram.org/cameras_v1/api/cameras?limit=1",
          "https://api-511x-co.carsprogram.org/cameras_v1/api/v1/cameras",
          "https://api-511x-co.carsprogram.org/cameras/map-features",
          "https://api-511x-co.carsprogram.org/camerasv1/api/cameras",
          "https://api-511x-co.carsprogram.org/api/v1/cameras"]:
    s, ct, b = get(u)
    out[u] = [s, ct, b[:400].decode(errors="replace")]
os.makedirs("probe_out", exist_ok=True)
json.dump(out, open("probe_out/result2.json", "w"), indent=1)
