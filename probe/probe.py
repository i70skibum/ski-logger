"""One-time probe: fetch resort webcam and parking pages so we can find plain image URLs and parking signals."""
import os, re, json, urllib.request, urllib.parse
OUT = "probe_out"; os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}
PAGES = {
  "copper_cams": "https://www.coppercolorado.com/the-mountain/conditions-weather/webcams",
  "copper_parking": "https://www.coppercolorado.com/plan-your-trip/getting-here/parking",
  "wp_cams": "https://www.winterparkresort.com/the-mountain/mountain-cams",
  "wp_cams2": "https://www.winterparkresort.com/the-mountain/webcams",
  "wp_parking": "https://www.winterparkresort.com/plan-your-trip/getting-here/parking",
  "eldora_cams": "https://www.eldora.com/the-mountain/conditions-weather/webcams",
  "eldora_parking": "https://www.eldora.com/plan-your-trip/getting-here/parking",
  "eldora_api": "https://api.eldora.com/api/v1/dor/agent-friendly/snow-reports",
  "abasin_parking": "https://www.arapahoebasin.com/plan-your-trip/getting-here/parking/",
  "abasin_cams": "https://www.arapahoebasin.com/the-mountain/webcams/",
}
PAT = re.compile(r"""https?:[^"'\s<>()\\]+?(?:hdrelay|camstreamer|webcam|\.jpe?g|\.m3u8|parking|lot|api\.|status|ipcamlive|youtube\.com/embed|brownrice|roundshot|prismcam|wetmet)[^"'\s<>()\\]*""", re.I)
summary = {}
def get(u):
    req = urllib.request.Request(u, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode("utf-8", "replace")
for name, u in PAGES.items():
    try:
        st, html = get(u)
    except Exception as e:
        summary[name] = {"error": str(e)[:200]}; print("ERR", name, e); continue
    open(f"{OUT}/{name}.html", "w").write(html)
    found = sorted(set(m.group(0).replace("\\u002F", "/") for m in PAT.finditer(html.replace("\\/", "/").replace("\\u002F", "/"))))
    scripts = re.findall(r'<script[^>]+src="([^"]+)"', html)
    kw = {k: len(re.findall(k, html, re.I)) for k in ["parking", "lot full", "filling", "hdrelay", "camstreamer", "webcam", "__NEXT_DATA__", "frames/"]}
    summary[name] = {"status": st, "bytes": len(html), "kw": kw, "urls": found[:200], "scripts": scripts[:40]}
    print("==", name, st, len(html), kw); [print("  ", x) for x in found[:120]]
# hdrelay frame UUIDs anywhere
for name in list(summary):
    p = f"{OUT}/{name}.html"
    if os.path.exists(p):
        ids = sorted(set(re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", open(p).read())))
        summary[name]["uuids"] = ids[:80]; print("UUIDS", name, ids[:80])
# Eldora last-mile: try several points and zooms
key = os.environ.get("TOMTOM_API_KEY", "")
if key:
    for lat, lon in [(39.9440, -105.5520), (39.9387, -105.5717), (39.9506, -105.5390), (39.9580, -105.5150)]:
        for z in (10, 12, 14):
            u = f"https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/{z}/json?point={lat},{lon}&unit=mph&key={key}"
            try:
                j = json.loads(urllib.request.urlopen(u, timeout=20).read()); d = j["flowSegmentData"]; c = d["coordinates"]["coordinate"]
                print("ELDORA", lat, lon, z, d.get("frc"), d.get("currentSpeed"), d.get("freeFlowSpeed"), c[0], c[-1], len(c))
            except Exception as e:
                print("ELDORA", lat, lon, z, "ERR", str(e)[:80])
json.dump(summary, open(f"{OUT}/summary.json", "w"), indent=1)
