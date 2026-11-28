import os, re, json, urllib.request
OUT = "probe_img"; os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}
def get(u, binary=False):
    req = urllib.request.Request(u, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read(); return r.headers.get("content-type", ""), (b if binary else b.decode("utf-8", "replace"))
def text(u):
    try: return get(u)[1]
    except Exception as e: print("ERR", u, e); return ""
def img(name, u):
    try:
        ct, b = get(u, True)
        if ct.startswith("image"): open(f"{OUT}/{name}.jpg", "wb").write(b); print("IMG", name, len(b), u)
        else: print("NOTIMG", name, ct, u)
    except Exception as e: print("ERR", name, u, e)
clean = lambda h: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", h, flags=re.S)))
print("=== ELDORA API"); print(text("https://api.eldora.com/api/v1/dor/agent-friendly/snow-reports")[:5200])
print("=== COPPER API"); print(text("https://api.coppercolorado.com/api/v1/dor/agent-friendly/snow-reports")[:1200])
for site, u in [("copper", "https://www.coppercolorado.com/the-mountain/webcams/"), ("eldora", "https://www.eldora.com/the-mountain/current-conditions/webcams/"), ("abasin", "https://www.arapahoebasin.com/mountain-cams/"), ("wp", "https://www.winterparkresort.com/the-mountain/mountain-cams")]:
    h = text(u).replace("\\/", "/").replace("\\u002F", "/")
    print("===", site, "cams", len(h))
    cams = sorted(set(re.findall(r"cam_[a-z0-9_]+_\d{10,}", h)))
    print("HDRELAY", cams)
    for c in cams: img(f"{site}_{c[:60]}", "https://watch.hdrelay.io/api/public/poster/" + c)
    for m in sorted(set(re.findall(r"https?://[^\"'\s<>]+?\.(?:jpe?g|png)(?:\?[^\"'\s<>]*)?", h))):
        if re.search(r"cam|webcam|snapshot", m, re.I): print("JPG", m)
    for m in sorted(set(re.findall(r"https?://[^\"'\s<>]*(?:camstreamer|ipcamlive|brownrice|roundshot|youtube\.com/embed)[^\"'\s<>]*", h))): print("EMBED", m)
    t = clean(h); 
    for kw in ["Cam", "cam"]:
        pass
    print("TEXT", t[:1500])
for e in ["8v334V7UDYwodQScLzh63Y6BaqoAQNmj5qhEjsjF", "FkuQtJjEJaLOpalZiTsiVrZUw5IG3fCjMS3Vcc8h", "c909b9be0f94f0d/S-50783", "e6H5OSc0NDBQR7KCR0zZnKCV0qqX1YF1b8egwy8x", "mXhcYGDptt4PPiSEJVwxPNmUZjj1CNAjSkrBdj3s"]:
    h = text("https://camstreamer.com/embed/" + e).replace("\\/", "/")
    t = re.search(r"<title>(.*?)</title>", h, re.S)
    print("CS", e[:8], t.group(1).strip() if t else "", sorted(set(re.findall(r"https?://[^\"'\s<>]+?(?:\.jpe?g|snapshot|thumb|poster|preview)[^\"'\s<>]*", h)))[:8])
h = text("https://www.arapahoebasin.com/parking/")
print("=== ABASIN PARKING"); t = clean(h); i = t.lower().find("parking"); print(t[:3000])
print("PARKURLS", sorted(set(re.findall(r"https?://[^\"'\s<>]*(?:api|status|lot|park)[^\"'\s<>]*", h, re.I)))[:60])
print("SCRIPTS", re.findall(r'<script[^>]+src="([^"]+)"', h)[:40])
print("INLINE", [s[:400] for s in re.findall(r"<script[^>]*>(.*?)</script>", h, re.S) if re.search(r"lot|park|full|filling", s, re.I)][:6])
img("wp_bestwestern", "https://cams.winterparkresort.com/best-western-cam.jpg")
img("abasin_cam5", "https://dirigo-resorts-f4e2bde5azc2cne6.z02.azurefd.net/arapahoe/images/medium/webcams/abasincam5.jpg")
img("abasin_cam1001m", "https://dirigo-resorts-f4e2bde5azc2cne6.z02.azurefd.net/arapahoe/images/medium/webcams/abasincam1001m.jpg")
