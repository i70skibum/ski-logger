import os, re, json, urllib.request
OUT = "probe_out"; os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}
def get(u, binary=False):
    req = urllib.request.Request(u, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read(); return r.status, r.headers.get("content-type", ""), (b if binary else b.decode("utf-8", "replace"))
res = {}
def save(name, u):
    try:
        st, ct, body = get(u); open(f"{OUT}/{name}.txt", "w").write(body); res[name] = [st, ct, len(body)]
        return body
    except Exception as e:
        res[name] = ["ERR", str(e)[:150]]; return ""
def head(name, u):
    try:
        st, ct, body = get(u, True); res[name] = [st, ct, len(body), body[:4].hex()]
        if ct.startswith("image"): open(f"{OUT}/{name}.img", "wb").write(body)
    except Exception as e:
        res[name] = ["ERR", str(e)[:150]]
save("eldora_api", "https://api.eldora.com/api/v1/dor/agent-friendly/snow-reports")
save("copper_api", "https://api.coppercolorado.com/api/v1/dor/agent-friendly/snow-reports")
for site, home in [("copper", "https://www.coppercolorado.com/"), ("eldora", "https://www.eldora.com/"), ("wp", "https://www.winterparkresort.com/"), ("abasin", "https://www.arapahoebasin.com/")]:
    h = save(site + "_home", home)
    links = sorted(set(re.findall(r'href="([^"]*(?:cam|parking|lot|conditions)[^"]*)"', h, re.I)))
    res[site + "_links"] = links[:80]
# Copper hdrelay posters and A-Basin cams
head("copper_union_poster", "https://watch.hdrelay.io/api/public/poster/cam_copper_mountain___union_1790871057199")
head("abasin_cam5", "https://dirigo-resorts-f4e2bde5azc2cne6.z02.azurefd.net/arapahoe/images/medium/webcams/abasincam5.jpg")
for c in ["cam_arapahoe_basin_black_mountain_lodge_1790623952319", "cam_arapahoe_basin_pali_cam_1790623627806", "cam_arapahoe_basin_patrol_headquarters_1790624063379"]:
    head("abasin_poster_" + c.split("_basin_")[1][:20], "https://watch.hdrelay.io/api/public/poster/" + c)
head("wp_bestwestern", "https://cams.winterparkresort.com/best-western-cam.jpg")
for e in ["8v334V7UDYwodQScLzh63Y6BaqoAQNmj5qhEjsjF", "FkuQtJjEJaLOpalZiTsiVrZUw5IG3fCjMS3Vcc8h", "c909b9be0f94f0d/S-50783", "e6H5OSc0NDBQR7KCR0zZnKCV0qqX1YF1b8egwy8x", "mXhcYGDptt4PPiSEJVwxPNmUZjj1CNAjSkrBdj3s"]:
    save("wp_cs_" + e[:8], "https://camstreamer.com/embed/" + e)
json.dump(res, open(f"{OUT}/res2.json", "w"), indent=1)
print(json.dumps(res, indent=1)[:6000])
