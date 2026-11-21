#!/usr/bin/env python3
"""
Ski dashboard data logger.

Runs every 15 minutes on GitHub Actions and appends snapshots to CSV files in data/.
Standard library only, so there is nothing to install.

Sources
  - SNOTEL (USDA NRCS): hourly snow depth, snow water equivalent, temperature near each resort
  - National Weather Service: 72-hour forecast summaries per resort, plus the Boulder office
    forecast discussion (the forecasters' written reasoning)
  - CDOT COtrip events (no key): closures, traction/chain laws, winter driving, incidents, road work
  - CDOT COtrip, with a free key in the CDOT_API_KEY secret: I-70 speeds from Copper to C-470
    (wide CSV, one column per segment), official road conditions when they change, and
    segment travel times when CDOT reports them

Each source is independent: if one fails, the others still log, and the failure goes to
data/errors.csv.
"""
import csv
import json
import os
import re
import sys
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

DENVER = ZoneInfo("America/Denver")
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("SKI_DATA_DIR", os.path.join(ROOT, "data"))
STATE_PATH = os.path.join(DATA, "state.json")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Forecast points sit roughly mid-mountain. SNOTEL stations are the nearest long-record
# sites: Grizzly Peak is the usual proxy for A-Basin, Berthoud Summit for Winter Park.
RESORTS = {
    "copper":     {"name": "Copper Mountain", "lat": 39.4800, "lon": -106.1600, "snotel": "415:CO:SNTL"},
    "abasin":     {"name": "Arapahoe Basin", "lat": 39.6350, "lon": -105.8710, "snotel": "505:CO:SNTL"},
    "winterpark": {"name": "Winter Park",    "lat": 39.8700, "lon": -105.7750, "snotel": "335:CO:SNTL"},
    "eldora":     {"name": "Eldora",         "lat": 39.9370, "lon": -105.5840, "snotel": "564:CO:SNTL"},
    # Overnight trips. Tower is above Steamboat; Chapman Tunnel is the closest station to Aspen.
    "steamboat":  {"name": "Steamboat",      "lat": 40.4570, "lon": -106.7950, "snotel": "825:CO:SNTL"},
    "aspen":      {"name": "Aspen Snowmass", "lat": 39.2000, "lon": -106.9550, "snotel": "1101:CO:SNTL"},
    # Epic Pass resorts
    "breck":       {"name": "Breckenridge",  "lat": 39.4750, "lon": -106.0800, "snotel": "531:CO:SNTL"},   # Hoosier Pass
    "keystone":    {"name": "Keystone",      "lat": 39.5900, "lon": -105.9450, "snotel": "505:CO:SNTL"},   # Grizzly Peak
    "vail":        {"name": "Vail",          "lat": 39.6150, "lon": -106.3700, "snotel": "842:CO:SNTL"},   # Vail Mountain
    "beavercreek": {"name": "Beaver Creek",  "lat": 39.5950, "lon": -106.5200, "snotel": "1041:CO:SNTL"},  # Beaver Ck Village
    "crestedbutte": {"name": "Crested Butte", "lat": 38.8900, "lon": -106.9550, "snotel": "380:CO:SNTL"},  # Butte
    "telluride":   {"name": "Telluride",     "lat": 37.9250, "lon": -107.8300, "snotel": "1344:CO:SNTL"},  # Alta Lakes
    # Independent resorts
    "loveland":    {"name": "Loveland",      "lat": 39.6750, "lon": -105.8950, "snotel": "602:CO:SNTL"},   # Loveland Basin
    "echo":        {"name": "Echo Mountain", "lat": 39.6850, "lon": -105.5200, "snotel": "936:CO:SNTL"},   # Echo Lake
    "cooper":      {"name": "Ski Cooper",    "lat": 39.3600, "lon": -106.3000, "snotel": "485:CO:SNTL"},   # Fremont Pass
    "granby":      {"name": "Granby Ranch",  "lat": 40.0400, "lon": -105.9100, "snotel": "1187:CO:SNTL"},  # High Lonesome
    "monarch":     {"name": "Monarch",       "lat": 38.5100, "lon": -106.3300, "snotel": "701:CO:SNTL"},   # Porphyry Creek
    "sunlight":    {"name": "Sunlight",      "lat": 39.3950, "lon": -107.3450, "snotel": "618:CO:SNTL"},   # McClure Pass
    "powderhorn":  {"name": "Powderhorn",    "lat": 39.0650, "lon": -108.1500, "snotel": "622:CO:SNTL"},   # Mesa Lakes
    "wolfcreek":   {"name": "Wolf Creek",    "lat": 37.4750, "lon": -106.7950, "snotel": "874:CO:SNTL"},   # Wolf Creek Summit
    "purgatory":   {"name": "Purgatory",     "lat": 37.6300, "lon": -107.8200, "snotel": "387:CO:SNTL"},   # Cascade #2
}

# Roads that matter: I-70, Berthoud and Rabbit Ears Passes (US 40), Loveland Pass and Keystone (US 6),
# Boulder Canyon / Nederland (CO 119), CO 9 (Breckenridge and Kremmling), Glenwood to Aspen (CO 82),
# Fremont and Tennessee Passes (CO 91, US 24), Squaw Pass (CO 103), Grand Mesa (CO 65),
# and the southern routes: US 285, US 50 over Monarch Pass, CO 135 to Crested Butte,
# US 160 over Wolf Creek Pass, US 550 to Purgatory, CO 62 and CO 145 to Telluride.
ROUTES = {"I70", "US40", "US6", "CO119", "CO9", "CO82", "CO91", "US24", "CO103", "CO65",
          "US285", "US50", "CO135", "US160", "US550", "CO62", "CO145"}
# Only keep I-70 events in the mountain corridor (Palisade, for Powderhorn, to C-470).
I70_MP_RANGE = (40.0, 262.0)

CARS_BASE = "https://api-511x-co.carsprogram.org/events/map-features"
CARS_CLASSES = ["roadClosures", "chainLaws", "winterDriving", "roadReports", "roadWork"]

NWS_BASE = "https://api.weather.gov"
NWS_OFFICE = "BOU"  # Boulder office: the Front Range and I-70 mountains
FORECAST_EVERY = timedelta(hours=3)


USER_AGENT = os.environ.get(
    "NWS_USER_AGENT", "ski-dashboard-logger (personal project; github actions)"
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NOW_UTC = datetime.now(timezone.utc).replace(microsecond=0)
NOW = NOW_UTC.astimezone(DENVER)
NOW_ISO = NOW.isoformat()
MONTH = NOW.strftime("%Y-%m")


def fetch(url, headers=None, timeout=25, retries=2):
    hdrs = {"User-Agent": USER_AGENT}
    hdrs.update(headers or {})
    last = None
    for _ in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
    raise RuntimeError(f"fetch failed: {redact(url)}: {last}")


def fetch_json(url, headers=None):
    return json.loads(fetch(url, headers))


def redact(url):
    return re.sub(r"(apiKey=)[^&]+", r"\1***", url)


def append_rows(subdir, header, rows):
    if not rows:
        return
    path = os.path.join(DATA, subdir, f"{MONTH}.csv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    new = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(header)
        w.writerows(rows)


def load_state():
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state):
    os.makedirs(DATA, exist_ok=True)
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=1, sort_keys=True)


def log_error(source, err):
    append_rows("errors", ["time", "source", "error"], [[NOW_ISO, source, str(err)[:500]]])
    print(f"[{source}] ERROR {err}", file=sys.stderr)


def norm_route(route):
    r = re.sub(r"[^A-Z0-9]", "", str(route or "").upper())
    return re.sub(r"^SH", "CO", r)


def epoch_to_local(v):
    """CARS times are epoch milliseconds; return Denver-local ISO or ''."""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return ""
    if v > 1e11:
        v /= 1000.0
    return datetime.fromtimestamp(v, timezone.utc).astimezone(DENVER).isoformat()


def parse_iso_duration(s):
    m = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?", s)
    if not m:
        raise ValueError(f"bad duration {s}")
    d, h, mi = (int(x) if x else 0 for x in m.groups())
    return timedelta(days=d, hours=h, minutes=mi)


def parse_valid_time(vt):
    start, dur = vt.split("/")
    s = datetime.fromisoformat(start)
    return s, s + parse_iso_duration(dur)


def r1(x):
    return "" if x is None else round(x, 1)


# ---------------------------------------------------------------------------
# SNOTEL
# ---------------------------------------------------------------------------

SNOTEL_URL = (
    "https://wcc.sc.egov.usda.gov/reportGenerator/view_csv/customSingleStationReport/"
    "hourly/{triplet}%7Cid=%22%22%7Cname/-12,0/"
    "WTEQ::value,SNWD::value,PREC::value,TOBS::value"
)


def parse_snotel_csv(text):
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
    rows = list(csv.reader(lines))
    out = []
    for row in rows[1:]:  # first row is the header
        if len(row) < 5 or not re.match(r"\d{4}-\d{2}-\d{2}", row[0]):
            continue
        out.append([c.strip() for c in row[:5]])
    return out


def log_snotel(state):
    last = state.setdefault("snotel_last", {})
    rows = []
    for key, r in RESORTS.items():
        try:
            data = parse_snotel_csv(fetch(SNOTEL_URL.format(triplet=r["snotel"])))
        except Exception as e:
            log_error(f"snotel:{key}", e)
            continue
        for obs_time, swe, depth, prec, temp in data:
            if obs_time > last.get(key, ""):
                rows.append([key, r["snotel"], obs_time, swe, depth, prec, temp])
                last[key] = obs_time
    append_rows(
        "snotel",
        ["resort", "station", "obs_time_mst", "swe_in", "depth_in", "precip_accum_in", "temp_f"],
        rows,
    )
    return len(rows)


# ---------------------------------------------------------------------------
# NWS forecast summaries
# ---------------------------------------------------------------------------

NWS_HEADERS = {"Accept": "application/geo+json"}
WINDOWS = [(0, 24), (24, 48), (48, 72)]


def to_unit(value, uom):
    if value is None:
        return None
    if uom.endswith("degC"):
        return value * 9 / 5 + 32
    if uom.endswith("mm"):
        return value / 25.4
    if uom.endswith("km_h-1"):
        return value * 0.621371
    return value


def summarize_grid(props, now_utc):
    """Return one dict per 24h window: snow total, temp min/max, wind/gust max, PoP max."""
    out = []
    for h0, h1 in WINDOWS:
        w0, w1 = now_utc + timedelta(hours=h0), now_utc + timedelta(hours=h1)
        res = {"window": f"{h0}-{h1}h", "start": w0.astimezone(DENVER).isoformat()}

        def overlaps(element):
            el = props.get(element) or {}
            uom = el.get("uom", "")
            for v in el.get("values", []):
                s, e = parse_valid_time(v["validTime"])
                ov = (min(e, w1) - max(s, w0)).total_seconds()
                if ov > 0 and v.get("value") is not None:
                    yield to_unit(v["value"], uom), ov / (e - s).total_seconds()

        snow = float(sum(val * frac for val, frac in overlaps("snowfallAmount")))
        temps = [v for v, _ in overlaps("temperature")]
        gusts = [v for v, _ in overlaps("windGust")]
        winds = [v for v, _ in overlaps("windSpeed")]
        pops = [v for v, _ in overlaps("probabilityOfPrecipitation")]
        res.update(
            snow_in=round(snow, 1),
            temp_min_f=r1(min(temps)) if temps else "",
            temp_max_f=r1(max(temps)) if temps else "",
            wind_max_mph=r1(max(winds)) if winds else "",
            gust_max_mph=r1(max(gusts)) if gusts else "",
            pop_max=r1(max(pops)) if pops else "",
        )
        out.append(res)
    return out


def nws_daily(props, days=7):
    """Snow total and max gust per local calendar day, for the 7-day outlook. Empty days are left out."""
    out = {}
    today = NOW.date()
    for i in range(days):
        d = today + timedelta(days=i)
        w0 = datetime(d.year, d.month, d.day, tzinfo=DENVER).astimezone(timezone.utc)
        w1 = w0 + timedelta(days=1)
        snow, gusts, seen = 0.0, [], False
        for element in ("snowfallAmount", "windGust"):
            el = props.get(element) or {}
            for v in el.get("values", []):
                st, en = parse_valid_time(v["validTime"])
                ov = (min(en, w1) - max(st, w0)).total_seconds()
                if ov <= 0 or v.get("value") is None:
                    continue
                val = to_unit(v["value"], el.get("uom", ""))
                if element == "snowfallAmount":
                    snow += val * ov / (en - st).total_seconds()
                    seen = True
                else:
                    gusts.append(val)
        if seen:
            out[d.isoformat()] = {"snow": round(snow, 1), "gust": r1(max(gusts)) if gusts else None}
    return out


def log_forecast(state):
    last = state.get("forecast_last")
    if last and NOW_UTC - datetime.fromisoformat(last) < FORECAST_EVERY:
        return 0
    points = state.setdefault("nws_points", {})
    rows = []
    for key, r in RESORTS.items():
        try:
            if key not in points:
                p = fetch_json(f"{NWS_BASE}/points/{r['lat']},{r['lon']}", NWS_HEADERS)
                points[key] = p["properties"]["forecastGridData"]
            props = fetch_json(points[key], NWS_HEADERS)["properties"]
            state.setdefault("nws_daily", {})[key] = nws_daily(props)
            for w in summarize_grid(props, NOW_UTC):
                rows.append([
                    NOW_ISO, key, props.get("updateTime", ""), w["window"], w["start"],
                    w["snow_in"], w["temp_min_f"], w["temp_max_f"],
                    w["wind_max_mph"], w["gust_max_mph"], w["pop_max"],
                ])
        except Exception as e:
            points.pop(key, None)  # re-resolve the grid next time
            log_error(f"forecast:{key}", e)
    append_rows(
        "forecast",
        ["snapshot_time", "resort", "nws_updated", "window", "window_start", "snow_in",
         "temp_min_f", "temp_max_f", "wind_max_mph", "gust_max_mph", "pop_max_pct"],
        rows,
    )
    if rows:
        state["forecast_last"] = NOW_UTC.isoformat()
    return len(rows)


def log_afd(state):
    """Save each new Area Forecast Discussion from the Boulder NWS office as a text file."""
    listing = fetch_json(f"{NWS_BASE}/products/types/AFD/locations/{NWS_OFFICE}", NWS_HEADERS)
    graph = listing.get("@graph", [])
    if not graph:
        return 0
    newest = graph[0]
    if newest["id"] == state.get("afd_last"):
        return 0
    prod = fetch_json(f"{NWS_BASE}/products/{newest['id']}", NWS_HEADERS)
    issued = datetime.fromisoformat(prod["issuanceTime"]).astimezone(DENVER)
    path = os.path.join(DATA, "afd", issued.strftime("%Y-%m"),
                        f"{NWS_OFFICE}_{issued.strftime('%Y%m%dT%H%M')}.txt")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(prod.get("productText", ""))
    state["afd_last"] = newest["id"]
    return 1


# ---------------------------------------------------------------------------
# CDOT events (no key): logged as start/end changes, not every snapshot
# ---------------------------------------------------------------------------

def parse_cars_feature(feat, classification):
    p = feat.get("properties") or {}
    rep = p.get("eventReport") or {}
    loc = rep.get("location") or {}
    desc = rep.get("eventDescription") or {}
    mp1 = (loc.get("primaryPoint") or {}).get("linearReference")
    mp2 = (loc.get("secondaryPoint") or {}).get("linearReference")
    begin = (rep.get("beginTime") or p.get("startTime") or {}).get("time")
    pp = loc.get("primaryPoint") or {}
    geom = feat.get("geometry") or {}
    # Where it is, for the dashboard map (not in the CSV): the primary point, and for closures the closed stretch.
    where = {"lat": round(pp["lat"], 5) if isinstance(pp.get("lat"), (int, float)) else None,
             "lon": round(pp["lon"], 5) if isinstance(pp.get("lon"), (int, float)) else None}
    if classification == "roadClosures" and geom.get("type") == "LineString" and len(geom.get("coordinates") or []) > 1:
        c = geom["coordinates"]
        where["line"] = [[round(y, 5), round(x, 5)] for x, y in c[::max(1, -(-len(c) // 40))]] + [[round(c[-1][1], 5), round(c[-1][0], 5)]]
    return dict(where, **{
        "id": str(p.get("id") or rep.get("id") or ""),
        "class": classification,
        "type": p.get("eventType", ""),
        "route": p.get("route") or loc.get("routeDesignator") or "",
        "direction": loc.get("linkDirection", ""),
        "pos_bearing": loc.get("routePositiveBearing", ""),
        "mp_start": mp1 if mp1 is not None else "",
        "mp_end": mp2 if mp2 is not None else "",
        "title": (p.get("title") or desc.get("descriptionHeader") or "")[:200],
        "began": epoch_to_local(begin),
    })


def relevant_event(ev):
    route = norm_route(ev["route"])
    if route not in ROUTES:
        return False
    if route == "I70":
        mps = [m for m in (ev["mp_start"], ev["mp_end"]) if isinstance(m, (int, float))]
        if mps and not any(I70_MP_RANGE[0] <= m <= I70_MP_RANGE[1] for m in mps):
            return False
    return True


EVENT_FIELDS = ["class", "type", "route", "direction", "pos_bearing", "mp_start", "mp_end",
                "title", "began"]


def log_events(state):
    active = state.setdefault("events", {})
    fetched_classes, current = set(), {}
    for cls in CARS_CLASSES:
        try:
            data = fetch_json(f"{CARS_BASE}?eventClassifications={cls}",
                              {"Accept": "application/json", "content-language": "en"})
        except Exception as e:
            log_error(f"events:{cls}", e)
            continue
        fetched_classes.add(cls)
        for feat in data.get("features", []):
            ev = parse_cars_feature(feat, cls)
            if ev["id"] and relevant_event(ev):
                current[f"{cls}:{ev['id']}"] = ev
    rows = []
    for k, ev in current.items():
        if k not in active:
            rows.append([NOW_ISO, "start", ev["id"]] + [ev[f] for f in EVENT_FIELDS])
            active[k] = ev
        else:
            for f in ("lat", "lon", "line"):     # location can be refined while an event runs
                if ev.get(f) is not None:
                    active[k][f] = ev[f]
    for k in list(active):
        ev = active[k]
        if ev["class"] in fetched_classes and k not in current:
            rows.append([NOW_ISO, "end", ev["id"]] + [ev[f] for f in EVENT_FIELDS])
            del active[k]
    append_rows("events", ["observed_at", "change", "id"] + EVENT_FIELDS, rows)
    return len(rows)


# ---------------------------------------------------------------------------
# CDOT keyed feeds (free key in the CDOT_API_KEY secret)
# ---------------------------------------------------------------------------

CDOT_API = "https://data.cotrip.org/api/v1/{ep}?apiKey={key}&limit=10000"
# I-70 speed segments are numbered sequentially, so pick the mountain corridor by location:
# from Glenwood Springs (west) to C-470 (east).
SPEED_BOX = {"lon": (-107.36, -105.19), "lat": (39.45, 39.85)}
MIN_CONFIDENCE = 50  # CDOT confidence score; below this the speed is left blank


def cdot_get(ep, key):
    resp = fetch_json(CDOT_API.format(ep=ep, key=key), {"Accept": "application/json"})
    return resp.get("features", []) if isinstance(resp, dict) else resp


def in_box(lon, lat):
    return (SPEED_BOX["lon"][0] <= lon <= SPEED_BOX["lon"][1]
            and SPEED_BOX["lat"][0] <= lat <= SPEED_BOX["lat"][1])


def append_wide(subdir, fixed_cols, values_by_col):
    """Append one row to a wide CSV whose columns are fixed when the month's file is created."""
    path = os.path.join(DATA, subdir, f"{MONTH}.csv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        with open(path, newline="") as f:
            rows = list(csv.reader(f))
        header = rows[0]
        added = sorted(k for k in values_by_col if k not in header)
        if added:  # new columns mid-month: rewrite the file with them, older rows left blank
            header = header + added
            with open(path, "w", newline="") as f:
                w = csv.writer(f)
                w.writerow(header)
                w.writerows(r + [""] * (len(header) - len(r)) for r in rows[1:])
    else:
        header = list(fixed_cols) + sorted(k for k in values_by_col if k not in fixed_cols)
        with open(path, "w", newline="") as f:
            csv.writer(f).writerow(header)
    with open(path, "a", newline="") as f:
        csv.writer(f).writerow([values_by_col.get(c, "") for c in header])


# Speeds beyond I-70: US 6 over Loveland Pass and through Clear Creek Canyon (Golden to exit 244),
# and US 40 from Empire over Berthoud Pass to Winter Park and Granby.
US6_ROUTE = re.compile(r"US0*6(?!\d)")
US6_WEST_LON = -106.08
US40_ROUTE = re.compile(r"US0*40(?!\d)")
US40_BOX = (-105.95, -105.60, 39.74, 40.10)   # lon min, lon max, lat min, lat max


def log_speeds(state, key):
    segs, values, feed_ts = [], {}, []
    for f in cdot_get("speed", key):
        p = f.get("properties") or f
        route = str(p.get("route_name", ""))
        coords = (f.get("geometry") or {}).get("coordinates") or []
        while coords and isinstance(coords[0], list) and coords[0] and isinstance(coords[0][0], list):
            coords = [pt for line in coords for pt in line]  # flatten MultiLineString
        us6, us40 = US6_ROUTE.match(route), US40_ROUTE.match(route)
        if not (route.startswith("I70") or us6 or us40) or not coords:
            continue
        (lon0, lat0), (lon1, lat1) = coords[0][:2], coords[-1][:2]
        if us40:
            if not all(US40_BOX[0] <= x <= US40_BOX[1] and US40_BOX[2] <= y <= US40_BOX[3] for x, y in ((lon0, lat0), (lon1, lat1))):
                continue  # US 40 only from I-70 at Empire over Berthoud Pass to Granby
        elif not (in_box(lon0, lat0) or in_box(lon1, lat1)):
            continue
        if us6 and min(lon0, lon1) < US6_WEST_LON:
            continue  # US 6 only from Silverthorne east: Keystone, Loveland Pass, Clear Creek Canyon
        sid = p.get("segment_id")
        segs.append([sid, route, round(lon0, 4), round(lat0, 4), round(lon1, 4), round(lat1, 4)])
        conf, speed = p.get("confidence_level") or 0, p.get("speed")
        values[sid] = round(speed) if speed is not None and conf >= MIN_CONFIDENCE else ""
        if p.get("timestamp"):
            feed_ts.append(p["timestamp"])
    if not values:
        raise RuntimeError("no mountain speed segments found")
    meta = os.path.join(DATA, "speed", "segments.csv")
    os.makedirs(os.path.dirname(meta), exist_ok=True)
    if not os.path.exists(meta) or state.get("speed_segments") != sorted(values):
        with open(meta, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["segment_id", "route", "start_lon", "start_lat", "end_lon", "end_lat"])
            w.writerows(sorted(segs))
        state["speed_segments"] = sorted(values)
    values["snapshot_time"] = NOW_ISO
    values["feed_time"] = epoch_to_local(max(feed_ts)) if feed_ts else ""
    append_wide("speed", ["snapshot_time", "feed_time"], values)
    return len(segs)


def corridor_markers_ok(route, mps):
    if norm_route(route).startswith("I70"):
        return any(I70_MP_RANGE[0] <= m <= I70_MP_RANGE[1] for m in mps if isinstance(m, (int, float)))
    return True


def log_travel_times(state, key):
    """CDOT travel times. Currently reports 0 most of the time, so only nonzero values are kept."""
    rows = []
    for f in cdot_get("destinations", key):
        p = f.get("properties") or f
        parts = p.get("segmentParts") or [{}]
        route = parts[0].get("route", "")
        mps = [parts[0].get("startMarker"), parts[-1].get("endMarker")]
        if not norm_route(route).startswith("I70") or not corridor_markers_ok(route, mps):
            continue
        if p.get("travelTime"):
            rows.append([NOW_ISO, p.get("id", ""), p.get("name", ""), route, mps[0], mps[1],
                         p["travelTime"], p.get("lastUpdated", "")])
    append_rows("travel", ["snapshot_time", "id", "name", "route", "start_mp", "end_mp",
                           "travel_time", "cdot_updated"], rows)
    return len(rows)


def log_road_conditions(state, key):
    """Official road condition reports, logged when a segment's condition changes."""
    last = state.setdefault("road_conditions", {})
    rows = []
    for f in cdot_get("roadConditions", key):
        p = f.get("properties") or f
        route = p.get("routeName", "")
        if norm_route(route) not in ROUTES:
            continue
        mps = [p.get("primaryMP"), p.get("secondaryMP")]
        if not corridor_markers_ok(route, mps):
            continue
        conds = sorted(c.get("conditionDescription", "") for c in p.get("currentConditions") or []
                       if c.get("sourceType") != "NDFD")
        cond = "; ".join(conds) or "none reported"
        sid = str(p.get("id"))
        if last.get(sid) != cond:
            rows.append([NOW_ISO, sid, route, p.get("nameId", ""), r1(mps[0]), r1(mps[1]), cond,
                         p.get("name", "")])
            last[sid] = cond
    append_rows("road_conditions", ["observed_at", "segment_id", "route", "area", "start_mp",
                                    "end_mp", "condition", "description"], rows)
    return len(rows)


def log_cdot(state):
    key = os.environ.get("CDOT_API_KEY", "").strip()
    if not key:
        return "skipped (no CDOT_API_KEY yet)"
    results = {}
    for name, fn in [("speed", log_speeds), ("travel", log_travel_times),
                     ("road_conditions", log_road_conditions)]:
        try:
            results[name] = fn(state, key)
        except Exception as e:
            log_error(f"cdot:{name}", e)
    return results


# ---------------------------------------------------------------------------
# Resort status (lifts, trails, opening day), read by the Cloudflare Worker
# ---------------------------------------------------------------------------

MONTH_DAY = re.compile(r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b", re.I)


def log_resort_status(state):
    """The Worker reads each resort's conditions page twice a day and passes the result here."""
    raw = os.environ.get("RESORT_STATUS", "").strip()
    if not raw:
        return "no update this run"
    new = json.loads(raw)
    path = os.path.join(DATA, "resort_status.json")
    try:
        with open(path) as f:
            cur = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        cur = {}
    res = cur.setdefault("resorts", {})
    rows = []
    for key, v in new.items():
        if key not in RESORTS or not isinstance(v, dict) or not v.get("lifts"):
            continue  # resort page could not be read: keep what we had
        r = res.setdefault(key, {})
        r["open"], r["lifts"], r["trails"] = bool(v.get("open")), str(v["lifts"]), str(v.get("trails", ""))
        if r["open"]:
            r.pop("note", None)
        elif MONTH_DAY.search(str(v.get("note", ""))):  # keep only notes that carry a date
            r["note"] = str(v["note"])[:120]
        elif not MONTH_DAY.search(r.get("note", "")):
            r.pop("note", None)
        rows.append([NOW_ISO, key, r["open"], r["lifts"], r["trails"], r.get("note", "")])
    if rows:
        cur["checked"] = NOW.strftime("%b %d, %I:%M %p").replace(" 0", " ")
        cur["auto"] = True
        with open(path, "w") as f:
            json.dump(cur, f, indent=2)
            f.write("\n")
    append_rows("resort_status", ["checked_at", "resort", "open", "lifts", "trails", "note"], rows)
    return len(rows)



# ---------------------------------------------------------------------------
# 7-day outlook: NWS plus several global models through Open-Meteo (free, no key).
# Model agreement is what tells the dashboard how far to trust a day.

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
OUTLOOK_MODELS = {"gfs_seamless": "American", "ecmwf_ifs025": "European",
                  "gem_seamless": "Canadian", "icon_seamless": "German"}


def log_outlook(state):
    last = state.get("outlook_last")
    if last and NOW_UTC - datetime.fromisoformat(last) < FORECAST_EVERY:
        return 0
    keys = list(RESORTS)
    q = {
        "latitude": ",".join(str(RESORTS[k]["lat"]) for k in keys),
        "longitude": ",".join(str(RESORTS[k]["lon"]) for k in keys),
        "daily": "snowfall_sum,wind_gusts_10m_max,temperature_2m_max,temperature_2m_min",
        "models": ",".join(OUTLOOK_MODELS),
        "timezone": "America/Denver", "forecast_days": 7,
        "precipitation_unit": "inch", "wind_speed_unit": "mph", "temperature_unit": "fahrenheit",
    }
    url = OPEN_METEO + "?" + "&".join(f"{k}={v}" for k, v in q.items())
    data = fetch_json(url)
    if isinstance(data, dict):
        data = [data]
    if len(data) != len(keys):
        raise ValueError(f"Open-Meteo returned {len(data)} locations for {len(keys)} resorts")
    nws = state.get("nws_daily", {})
    resorts, rows = {}, []
    days = []
    for key, loc in zip(keys, data):
        daily, units = loc.get("daily", {}), loc.get("daily_units", {})
        days = daily.get("time", [])
        out = []
        for i, d in enumerate(days):
            models = {}
            for m in OUTLOOK_MODELS:
                v = (daily.get(f"snowfall_sum_{m}") or [None] * len(days))[i]
                if v is None:
                    continue
                if units.get(f"snowfall_sum_{m}", "") == "cm":
                    v = v / 2.54
                models[m] = round(v, 1)
            n = nws.get(key, {}).get(d)
            if n:
                models["nws"] = n["snow"]
            vals = sorted(models.values())
            gusts = [x for x in ((daily.get(f"wind_gusts_10m_max_{m}") or [None] * len(days))[i] for m in OUTLOOK_MODELS) if x is not None]
            if n and n.get("gust") is not None:
                gusts.append(n["gust"])
            tmax = [x for x in ((daily.get(f"temperature_2m_max_{m}") or [None] * len(days))[i] for m in OUTLOOK_MODELS) if x is not None]
            tmin = [x for x in ((daily.get(f"temperature_2m_min_{m}") or [None] * len(days))[i] for m in OUTLOOK_MODELS) if x is not None]
            mid = vals[len(vals) // 2] if len(vals) % 2 else (sum(vals[len(vals) // 2 - 1:len(vals) // 2 + 1]) / 2 if vals else None)
            out.append({
                "date": d, "snow": None if mid is None else round(mid, 1),
                "lo": vals[0] if vals else None, "hi": vals[-1] if vals else None, "n": len(vals),
                "models": models,
                "gust": round(sorted(gusts)[len(gusts) // 2]) if gusts else None,
                "tmax": round(sorted(tmax)[len(tmax) // 2]) if tmax else None,
                "tmin": round(sorted(tmin)[len(tmin) // 2]) if tmin else None,
            })
            for m, v in models.items():
                rows.append([NOW_ISO, key, d, m, v])
        resorts[key] = out
    with open(os.path.join(DATA, "outlook.json"), "w") as f:
        json.dump({"updated": NOW_ISO, "days": days, "sources": {**OUTLOOK_MODELS, "nws": "National Weather Service"},
                   "resorts": resorts}, f, indent=1)
        f.write("\n")
    append_rows("outlook", ["snapshot_time", "resort", "date", "source", "snow_in"], rows)
    state["outlook_last"] = NOW_UTC.isoformat()
    return len(rows)


# ---------------------------------------------------------------------------
# Passes and alternates: CDOT has no speed sensors off the interstates, so these come from
# TomTom (free key in the TOMTOM_API_KEY secret), two ways, each on its own free allowance
# of 20,000 requests a month:
#   Routing: times each road end to end, in each direction, with live traffic and with none.
#     The difference is the delay. 3 roads x 2 directions = 6 requests, every 15 minutes
#     from 5 AM to 10 PM: about 12,600 a month. This is what the model and scores use.
#   Flow: the speed at 10 points along the roads, which shows where a slowdown is and flags
#     closures. Every 15 minutes from 5 AM to 8 PM: about 18,600 a month.
# Each has a monthly cap below 20,000, and runs closer than 12 minutes apart are skipped.

TOMTOM_ROUTE = "https://api.tomtom.com/routing/1/calculateRoute/{}/json"
TOMTOM_FLOW = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/12/json"
TOMTOM_CAPS = {"routing": 19000, "flow": 19000}
ROUTE_POINTS = {
    # Routing goes start, via, end (heading up; reversed for heading home). The via point keeps
    # it on the road: without it the router would take I-70 through the tunnel instead of
    # Loveland Pass. Flow points are spread along the road. All coordinates are vertices of
    # TomTom's own geometry for these roads (from the calibration output), so they sit on the road.
    "canyon":   {"name": "Clear Creek Canyon (US 6, Golden to I-70 exit 244)", "max_km": 30,
                 "route": [(39.75454, -105.23687), (39.74168, -105.33004), (39.74238, -105.43138)],
                 "points": [(39.74204, -105.26940), (39.74168, -105.33004), (39.72766, -105.42222)]},
    "pass":     {"name": "Loveland Pass (US 6, I-70 exit 216 to Keystone)", "max_km": 27,
                 "route": [(39.6800, -105.8950), (39.6636, -105.8794), (39.6050, -105.9440)],
                 "points": [(39.67160, -105.87765), (39.64683, -105.87023), (39.62030, -105.92400)]},
    "berthoud": {"name": "Berthoud Pass (US 40, Empire to Winter Park)", "max_km": 45,
                 "route": [(39.76107, -105.68312), (39.79586, -105.78069), (39.88623, -105.76259)],
                 "points": [(39.76389, -105.74095), (39.78414, -105.78464), (39.82553, -105.76544), (39.88738, -105.76063)]},
    # Routing only (no flow points): the map draws it from the route shape. Heading up is from I-70 toward Keystone.
    # Heading up starts on US 6 at the exit 205 ramp (a point on I-70 itself sends the router east to
    # Loveland to turn around); heading home ends at the eastbound on-ramp, which routes cleanly.
    "dillon":   {"name": "US 6 through Dillon (I-70 exit 205 at Silverthorne to Keystone)", "max_km": 18,
                 "route": [(39.62844, -106.05265), (39.63236, -106.04066), (39.6050, -105.9440)],
                 "route_e": [(39.6050, -105.9440), (39.63236, -106.04066), (39.6297, -106.0640)],
                 "points": []},
}
TOMTOM_HOURS = {"routing": (5, 22), "flow": (5, 20)}


def tomtom_get(url, key, where):
    """One TomTom request, paced under its per-second limit, with one retry if it says too many.
    A routing 400 means TomTom found no way along the road, which is how it reports a closure."""
    import time
    for attempt in (1, 2):
        time.sleep(0.35)
        try:
            return fetch_json(url)
        except Exception as e:
            if attempt == 1 and "429" in str(e):
                time.sleep(2)
                continue
            if "calculateRoute" in url and "400" in str(e):
                return {"no_route": True}
            log_error(where, str(e).replace(key, "KEY"))
            return None


def line_dist_m(lat, lon, pts):
    """Distance in meters from a point to a polyline of TomTom coordinates."""
    import math
    kx, ky = 111320 * math.cos(math.radians(lat)), 110540
    best = None
    xy = [((p["longitude"] - lon) * kx, (p["latitude"] - lat) * ky) for p in pts]
    for (x0, y0), (x1, y1) in zip(xy, xy[1:] or xy):
        dx, dy = x1 - x0, y1 - y0
        t = 0 if dx == dy == 0 else max(0, min(1, -(x0 * dx + y0 * dy) / (dx * dx + dy * dy)))
        d = math.hypot(x0 + t * dx, y0 + t * dy)
        best = d if best is None else min(best, d)
    return None if best is None else round(best)


def tomtom_budget(state, kind, need):
    """True if this run may spend `need` requests of `kind`; counts them per calendar month."""
    h0, h1 = TOMTOM_HOURS[kind]
    if not h0 <= NOW.hour < h1:
        return False
    last = state.get(f"tomtom_{kind}_last")
    if last and NOW_UTC - datetime.fromisoformat(last) < timedelta(minutes=12):
        return False
    use = state.setdefault("tomtom_use", {}).setdefault(kind, {})
    month = NOW.strftime("%Y-%m")
    for m in [m for m in use if m < month]:
        del use[m]
    if use.get(month, 0) + need > TOMTOM_CAPS[kind]:
        return False
    use[month] = use.get(month, 0) + need
    state[f"tomtom_{kind}_last"] = NOW_UTC.isoformat()
    return True


def log_routes(state):
    key = os.environ.get("TOMTOM_API_KEY", "").strip()
    if not key:
        return "no TomTom key yet"
    path = os.path.join(DATA, "routes_now.json")
    try:
        with open(path) as f:
            now = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        now = {"routes": {}}
    did = []
    state.pop("route_shortest_m", None)
    calib = now.setdefault("calibration", {})

    if tomtom_budget(state, "routing", 2 * len(ROUTE_POINTS)):
        rows = []
        for rk, R in ROUTE_POINTS.items():
            out = now["routes"].setdefault(rk, {"name": R["name"]})
            for d, pts in (("W", R["route"]), ("E", R.get("route_e") or list(reversed(R["route"])))):
                locs = ":".join(f"{lat},{lon}" for lat, lon in pts)
                j = tomtom_get(TOMTOM_ROUTE.format(locs) + f"?key={key}&traffic=true&computeTravelTimeFor=all"
                               "&routeType=fastest&travelMode=car", key, f"routes:{rk}:{d}")
                if j and j.get("no_route"):
                    rows.append([NOW_ISO, rk, d, "", "", "", "", "", True])
                    out[d] = {"delay_min": None, "minutes": None, "free_min": None, "detour": True, "no_route": True, "at": NOW_ISO}
                    continue
                if not j or not j.get("routes"):
                    out[d] = None
                    continue
                r = j["routes"][0]["summary"]
                geo = [p for leg in j["routes"][0].get("legs", []) for p in leg.get("points", [])]
                calib[f"{rk}-{d}"] = {"km": round((r.get("lengthInMeters") or 0) / 1000, 1),
                                      "path": [[round(p["latitude"], 5), round(p["longitude"], 5)] for p in geo[::max(1, len(geo) // 12)]]}
                length, live, none = r.get("lengthInMeters"), r.get("travelTimeInSeconds"), r.get("noTrafficTravelTimeInSeconds")
                # Longer than the road itself means the router went another way: closed, blocked or a bad waypoint.
                detour = bool(length and length > R["max_km"] * 1000)
                rows.append([NOW_ISO, rk, d, length, live, none, r.get("historicTrafficTravelTimeInSeconds"),
                             r.get("trafficDelayInSeconds"), detour])
                out[d] = {"delay_min": None if detour or not (live and none) else round(max(0, live - none) / 60, 1),
                          "minutes": round(live / 60, 1) if live else None, "free_min": round(none / 60, 1) if none else None,
                          "detour": detour, "at": NOW_ISO}
                if not detour and geo:
                    # The whole road, end to end, for the dashboard map (thinned to about 150 points).
                    out[d]["line"] = [[round(p["latitude"], 5), round(p["longitude"], 5)] for p in geo[::max(1, -(-len(geo) // 150))]]
                    if out[d]["line"][-1] != [round(geo[-1]["latitude"], 5), round(geo[-1]["longitude"], 5)]:
                        out[d]["line"].append([round(geo[-1]["latitude"], 5), round(geo[-1]["longitude"], 5)])
        append_rows("routes", ["snapshot_time", "route", "dir", "length_m", "travel_s", "no_traffic_s",
                               "historic_s", "delay_s", "detour"], rows)
        did.append("routing")

    if tomtom_budget(state, "flow", sum(len(R["points"]) for R in ROUTE_POINTS.values())):
        rows = []
        for rk, R in ROUTE_POINTS.items():
            out = now["routes"].setdefault(rk, {"name": R["name"]})
            closed, slow = False, []
            for i, (lat, lon) in enumerate(R["points"]):
                j = tomtom_get(f"{TOMTOM_FLOW}?point={lat},{lon}&unit=MPH&key={key}", key, f"routes:{rk}:point{i}")
                if not j or "flowSegmentData" not in j:
                    continue
                d = j["flowSegmentData"]
                pts = (d.get("coordinates") or {}).get("coordinate") or []
                snap_m = line_dist_m(lat, lon, pts)
                calib[f"{rk}-p{i}"] = {"snap_m": snap_m, "frc": d.get("frc"),
                                       "segment": [[round(p["latitude"], 5), round(p["longitude"], 5)] for p in pts[::max(1, len(pts) // 6)]]}
                rows.append([NOW_ISO, rk, i, d.get("frc"), d.get("currentSpeed"), d.get("freeFlowSpeed"),
                             d.get("currentTravelTime"), d.get("freeFlowTravelTime"), d.get("confidence"),
                             bool(d.get("roadClosure")), snap_m])
                if snap_m is not None and snap_m > 400:
                    continue   # landed on some other road
                closed = closed or bool(d.get("roadClosure"))
                if d.get("currentSpeed") and d.get("freeFlowSpeed"):
                    # The road stretch this reading covers, thinned to 80 points, for the dashboard map.
                    line = [[round(p["latitude"], 5), round(p["longitude"], 5)] for p in pts[::max(1, -(-len(pts) // 80))]]
                    if pts and line[-1] != [round(pts[-1]["latitude"], 5), round(pts[-1]["longitude"], 5)]:
                        line.append([round(pts[-1]["latitude"], 5), round(pts[-1]["longitude"], 5)])
                    slow.append({"point": i, "mph": d["currentSpeed"], "normal_mph": d["freeFlowSpeed"],
                                 "closed": bool(d.get("roadClosure")), "line": line})
            out["closed"] = closed
            out["points"] = slow
            out["points_at"] = NOW_ISO
        append_rows("route_points", ["snapshot_time", "route", "point", "frc", "current_mph", "freeflow_mph",
                                     "current_tt_s", "freeflow_tt_s", "confidence", "closed", "snap_m"], rows)
        did.append("flow")

    if not did:
        return "not due"
    now["updated"] = NOW_ISO
    now["tomtom_use"] = {k: v.get(NOW.strftime("%Y-%m"), 0) for k, v in state.get("tomtom_use", {}).items()}
    now["tomtom_caps"] = TOMTOM_CAPS
    with open(path, "w") as f:
        json.dump(now, f, indent=1)
        f.write("\n")
    return {rk: {d: (v.get(d) or {}).get("delay_min") for d in "WE"} for rk, v in now["routes"].items()}


# ---------------------------------------------------------------------------
# Traffic model: the typical I-70 delay, C-470 to Copper, by weekday and half hour, in each
# direction. Built from the logged speeds with the same math as the dashboard. It also tracks
# how much data it has (weekends logged per window), which kinds of weekends it has seen,
# and how far off its predictions were. Predictions are saved on Friday and graded on Monday.

CORRIDOR_WEST_LON, CORRIDOR_EAST_LON = -106.145, -105.185   # Copper to C-470
# Day types. Only "typical" days build the normal profile. Holidays, school-break weeks and
# disrupted days (a closure or a flagged storm during ski hours) are kept and labeled, and
# each type gets its own measure of how far it runs above typical once there is data.
# Holidays that move each year are worked out by rule; data/calendar.json holds pass
# blackouts, school breaks and hand-flagged days, and is updated each season.


def nth_weekday(y, m, wd, n):
    """The nth weekday (Mon=0) of a month; n=-1 for the last."""
    from datetime import date
    if n > 0:
        d = date(y, m, 1)
        return d + timedelta(days=(wd - d.weekday()) % 7 + 7 * (n - 1))
    d = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - wd) % 7)


def easter(y):
    from datetime import date
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    return date(y, (h + l - 7 * m + 114) // 31, (h + l - 7 * m + 114) % 31 + 1)


def holiday_periods(y):
    """Holiday periods for the ski season starting in the fall of year y: (first day, last day, name)."""
    from datetime import date
    tg = nth_weekday(y, 11, 3, 4)
    xmas0 = date(y, 12, 21) - timedelta(days=(date(y, 12, 21).weekday() - 5) % 7)    # Saturday on or before Dec 21
    xmas1 = date(y + 1, 1, 1) + timedelta(days=(6 - date(y + 1, 1, 1).weekday()) % 7)  # Sunday on or after Jan 1
    mlk, pres, eas, mem = nth_weekday(y + 1, 1, 0, 3), nth_weekday(y + 1, 2, 0, 3), easter(y + 1), nth_weekday(y + 1, 5, 0, -1)
    return [(tg - timedelta(days=5), tg - timedelta(days=4), "Weekend before Thanksgiving"),
            (tg - timedelta(days=1), tg + timedelta(days=3), "Thanksgiving"),
            (xmas0, xmas1, "Christmas and New Year"),
            (mlk - timedelta(days=2), mlk, "MLK weekend"), (pres - timedelta(days=2), pres, "Presidents Day weekend"),
            (eas - timedelta(days=2), eas, "Easter weekend"), (mem - timedelta(days=2), mem, "Memorial Day weekend")]


def holiday_of(d):
    for a, b, name in holiday_periods(d.year if d.month >= 7 else d.year - 1):
        if a <= d <= b:
            return name
    return None


_CAL = None


def calendar():
    global _CAL
    if _CAL is None:
        try:
            with open(os.path.join(DATA, "calendar.json")) as f:
                _CAL = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            _CAL = {}
    return _CAL


def in_ranges(iso, ranges, weekends=False):
    """Is the date in any [first, last] range? With weekends, a range also covers the weekend on each side."""
    for a, b in ranges:
        if weekends:
            a = (datetime.fromisoformat(a) - timedelta(days=2)).date().isoformat()
            b = (datetime.fromisoformat(b) + timedelta(days=2)).date().isoformat()
        if a <= iso <= b:
            return True
    return False


# A full closure in the ski direction counts as a disruption: heading up (westbound) 5 to 11 AM,
# or heading home (eastbound) noon to 7 PM. Roads: I-70 from Silverthorne to C-470, US 6 in the canyon.
# Weekday-morning eastbound work closures at Floyd Hill don't count: that's the commute direction.
DISRUPT_ROADS = (("I-70", 205, 262), ("US 6", 257, 272))
DISRUPT_MIN = 45     # minutes of closure inside the window


def disruptions():
    """Dates with a long full closure during ski hours, from the logged CDOT events: date -> description."""
    import glob
    spans = {}
    for path in sorted(glob.glob(os.path.join(DATA, "events", "20*.csv"))):
        with open(path) as f:
            for r in csv.DictReader(f):
                if r.get("class") != "roadClosures" or r.get("type") != "critical":
                    continue
                try:
                    mp = float(r["mp_start"])
                except (TypeError, ValueError):
                    continue
                if not any(r["route"] == rd and lo <= mp <= hi for rd, lo, hi in DISRUPT_ROADS):
                    continue
                s = spans.setdefault(r["id"], {"route": r["route"], "title": r["title"], "start": None, "end": None})
                t = datetime.fromisoformat(r["observed_at"])
                if r["change"] == "start":
                    began = datetime.fromisoformat(r["began"]) if r.get("began") else t
                    s["start"] = max(began, t - timedelta(minutes=20))   # not before it was first seen, give or take a run
                elif r["change"] == "end":
                    s["end"] = t
    out = {}
    for s in spans.values():
        if not s["start"]:
            continue
        a, b = s["start"].astimezone(DENVER), (s["end"] or NOW).astimezone(DENVER)
        title = s["title"].lower()
        hours = [h for word, h in (("westbound", (5, 11)), ("eastbound", (12, 19))) if word in title or "both" in title]
        day = a.date()
        while day <= b.date():
            for h0, h1 in hours:
                lo = datetime(day.year, day.month, day.day, h0, tzinfo=DENVER)
                hi = datetime(day.year, day.month, day.day, h1, tzinfo=DENVER)
                if (min(b, hi) - max(a, lo)).total_seconds() / 60 >= DISRUPT_MIN:
                    out.setdefault(day.isoformat(), set()).add(s["title"].split(":")[0])
            day += timedelta(days=1)
    return {k: "Closed in the ski direction: " + ", ".join(sorted(v)) for k, v in out.items()}


def day_info(d, dis):
    """Type and labels for one date. Types: disrupted, holiday, break or typical."""
    iso, cal = d.isoformat(), calendar()
    tags = []
    hol = holiday_of(d)
    if hol:
        tags.append(hol)
    for b in cal.get("pass_blackouts", []):
        if in_ranges(iso, b["dates"]):
            tags.append(f"{b['pass']} blackout")
    areas = {}
    for s in cal.get("school_breaks", []):
        if in_ranges(iso, s["dates"], weekends=True):
            areas.setdefault(s["area"], []).append(s["who"])
    if areas:
        tags.append("School break: " + "; ".join(f"{a} ({', '.join(w)})" for a, w in areas.items()))
    note = (cal.get("flags") or {}).get(iso) or dis.get(iso)
    kind = "disrupted" if note else "holiday" if hol else "break" if areas else "typical"
    out = {"type": kind, "tags": tags}
    if note:
        out["note"] = note
    return out
# The windows that matter for ski days: (weekday 0=Mon, start hour, end hour, direction).
KEY_WINDOWS = {"fri_pm_W": (4, 14, 20, "W"), "sat_am_W": (5, 5, 10, "W"), "sun_am_W": (6, 5, 10, "W"),
               "sat_pm_E": (5, 13, 19, "E"), "sun_pm_E": (6, 13, 19, "E")}
WINDOW_TARGET = 6      # weekends per window for "Solid"
# The well-known I-70 pattern, minutes of delay by hour, used until a window has real data.
GENERIC = {"W": {4: {14: 5, 15: 10, 16: 15, 17: 15, 18: 10, 19: 5},
                 5: {5: 2, 6: 6, 7: 15, 8: 20, 9: 15, 10: 8, 11: 4},
                 6: {6: 3, 7: 10, 8: 12, 9: 10, 10: 5}},
           "E": {5: {12: 3, 13: 8, 14: 15, 15: 20, 16: 20, 17: 15, 18: 8, 19: 3},
                 6: {12: 5, 13: 15, 14: 30, 15: 40, 16: 40, 17: 30, 18: 15, 19: 5}}}
POWDER_STATIONS = ("copper", "abasin", "winterpark", "loveland", "keystone", "vail")


def miles(lon0, lat0, lon1, lat1):
    import math
    r = math.pi / 180
    a = math.sin((lat1 - lat0) * r / 2) ** 2 + math.cos(lat0 * r) * math.cos(lat1 * r) * math.sin((lon1 - lon0) * r / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(a)) * 1.12


def corridor_delays():
    """Yield (local time, westbound delay, eastbound delay) for every logged speed snapshot."""
    import glob
    segs = []
    with open(os.path.join(DATA, "speed", "segments.csv")) as f:
        for r in csv.DictReader(f):
            lon0, lon1 = float(r["start_lon"]), float(r["end_lon"])
            mid = (lon0 + lon1) / 2
            if r["route"].startswith("I70") and CORRIDOR_WEST_LON <= mid <= CORRIDOR_EAST_LON:
                segs.append((r["segment_id"], "W" if r["route"].endswith("W") else "E",
                             miles(lon0, float(r["start_lat"]), lon1, float(r["end_lat"]))))
    rows = []
    for path in sorted(glob.glob(os.path.join(DATA, "speed", "20*.csv"))):
        with open(path) as f:
            rows.extend(csv.DictReader(f))
    refs = {}
    for sid, _, _ in segs:
        v = sorted(float(r[sid]) for r in rows if r.get(sid))
        ref = v[int(len(v) * 0.85)] if len(v) >= 48 else 58
        refs[sid] = max(45, min(65, ref))
    for r in rows:
        out = {}
        for d in "WE":
            tot, n = 0.0, 0
            for sid, sd, ln in segs:
                if sd != d or not r.get(sid):
                    continue
                n += 1
                tot += max(0, ln / max(float(r[sid]), 3) - ln / refs[sid]) * 60
            out[d] = tot if n else None
        yield datetime.fromisoformat(r["snapshot_time"]).astimezone(DENVER), out["W"], out["E"]


def snow_weekends():
    """Saturdays whose weekend had 4 inches or more of new snow at an I-70 station (Friday noon to Sunday noon)."""
    import glob
    depth = {}
    for path in glob.glob(os.path.join(DATA, "snotel", "20*.csv")):
        with open(path) as f:
            for r in csv.DictReader(f):
                if r["resort"] in POWDER_STATIONS and r["depth_in"]:
                    t = datetime.strptime(r["obs_time_mst"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone(timedelta(hours=-7)))
                    depth.setdefault(r["resort"], []).append((t, float(r["depth_in"])))
    out = set()
    for pts in depth.values():
        pts.sort()
        for t, _ in pts:
            if t.weekday() != 4 or t.hour != 12:
                continue
            start = [dp for tt, dp in pts if tt == t][0]
            peak = max((dp for tt, dp in pts if t <= tt <= t + timedelta(hours=48)), default=start)
            if peak - start >= 4:
                out.add((t + timedelta(days=1)).date().isoformat())
    return out


def window_mean(slots, dow, h0, h1, d):
    """Average delay by hour for a weekday window, from the profile's half-hour slots."""
    out = {}
    for h in range(h0, h1):
        v = [slots.get(f"{dow}-{h:02d}{m}-{d}", {}).get("median") for m in ("00", "30")]
        v = [x for x in v if x is not None]
        if v:
            out[h] = round(sum(v) / len(v), 1)
    return out


# Route windows for the passes and alternates: (weekday, start hour, end hour, direction).
ROUTE_WINDOWS = {"sat_am": (5, 5, 10, "W"), "sun_am": (6, 5, 10, "W"), "sat_pm": (5, 13, 19, "E"), "sun_pm": (6, 13, 19, "E")}
# Rough guesses, minutes of delay by hour, used until a window has real data.
GENERIC_ROUTES = {"canyon": {5: {7: 2, 8: 3, 9: 2}, 6: {13: 3, 14: 6, 15: 8, 16: 8, 17: 5}},
                  "pass": {5: {8: 2, 9: 3, 10: 2}, 6: {13: 2, 14: 3, 15: 3}},
                  "berthoud": {5: {7: 3, 8: 5, 9: 5, 10: 3}, 6: {13: 4, 14: 6, 15: 7, 16: 6, 17: 3}},
                  "dillon": {5: {8: 2, 9: 3, 10: 2}, 6: {14: 2, 15: 3, 16: 3}}}


def route_delays():
    """Yield (local time, route key, direction, delay minutes) from the logged TomTom routing times."""
    import glob
    for path in sorted(glob.glob(os.path.join(DATA, "routes", "20*.csv"))):
        with open(path) as f:
            for r in csv.DictReader(f):
                if r.get("route") not in ROUTE_POINTS or r.get("detour") == "True" or not r.get("travel_s") or not r.get("no_traffic_s"):
                    continue
                if not r.get("length_m") or float(r["length_m"]) > ROUTE_POINTS[r["route"]]["max_km"] * 1000:
                    continue   # went the long way: a detour or a bad waypoint
                yield (datetime.fromisoformat(r["snapshot_time"]).astimezone(DENVER), r["route"], r["dir"],
                       max(0.0, float(r["travel_s"]) - float(r["no_traffic_s"])) / 60)


def route_model(today, typical):
    """Profiles, coverage and actuals for the passes and alternates, same rules as I-70."""
    from collections import defaultdict
    per_slot = defaultdict(lambda: defaultdict(list))
    snaps = defaultdict(int)
    actual = defaultdict(lambda: defaultdict(list))
    for t, rk, d, v in route_delays():
        day = t.date()
        snaps[(rk, d, day, t.hour)] += 1
        actual[(rk, d, day.isoformat())][t.hour].append(v)
        if typical(day):
            per_slot[f"{rk}-{d}-{t.weekday()}-{t.hour:02d}{'00' if t.minute < 30 else '30'}"][day].append(v)
    slots = {}
    for k, by_day in per_slot.items():
        means = sorted(sum(v) / len(v) for v in by_day.values())
        slots[k] = {"median": round(means[len(means) // 2], 1), "n": len(means)}
    out = {}
    for rk, R in ROUTE_POINTS.items():
        days = sorted({x for (r, _, x, h) in snaps if r == rk})
        cov = {}
        for w, (dow, h0, h1, dr) in ROUTE_WINDOWS.items():
            got = [d.isoformat() for d in days if d.weekday() == dow and typical(d)
                   and sum(1 for h in range(h0, h1) if snaps.get((rk, dr, d, h), 0) >= 3) >= 0.8 * (h1 - h0)]
            cov[w] = {"n": len(got), "last": got[-1] if got else None}
        out[rk] = {"name": R["name"], "first_day": days[0].isoformat() if days else None,
                   "coverage": cov, "generic": GENERIC_ROUTES.get(rk, {})}
    return out, slots, actual


def route_window(slots, rk, dow, h0, h1, d):
    out = {}
    for h in range(h0, h1):
        v = [slots.get(f"{rk}-{d}-{dow}-{h:02d}{m}", {}).get("median") for m in ("00", "30")]
        v = [x for x in v if x is not None]
        if v:
            out[h] = round(sum(v) / len(v), 1)
    return out


def log_traffic_model(state):
    last = state.get("traffic_model_last")
    if last and NOW_UTC - datetime.fromisoformat(last) < FORECAST_EVERY:
        return 0
    from collections import defaultdict
    dis, infos = disruptions(), {}

    def info(day):
        if day not in infos:
            infos[day] = day_info(day, dis)
        return infos[day]

    def typical(day):
        return info(day)["type"] == "typical"
    per_slot = defaultdict(lambda: defaultdict(list))     # slot -> date -> delays
    snaps = defaultdict(int)                               # (date, hour, dir) -> snapshots
    actual = defaultdict(lambda: defaultdict(list))         # date -> (dir, hour) -> delays
    for t, w, e in corridor_delays():
        day = t.date()
        for d, v in (("W", w), ("E", e)):
            if v is None:
                continue
            snaps[(day, t.hour, d)] += 1
            actual[day.isoformat()][(d, t.hour)].append(v)
            if not typical(day):
                continue
            per_slot[f"{t.weekday()}-{t.hour:02d}{'00' if t.minute < 30 else '30'}-{d}"][day].append(v)
    slots = {}
    for k, by_day in per_slot.items():
        means = sorted(sum(v) / len(v) for v in by_day.values())
        slots[k] = {"median": round(means[len(means) // 2], 1), "n": len(means),
                    "p75": round(means[min(len(means) - 1, int(len(means) * 0.75))], 1)}

    # Coverage: a window counts for a date when at least 80% of its hours have 3 or more snapshots.
    def covered(day, h0, h1, d):
        full = sum(1 for h in range(h0, h1) if snaps.get((day, h, d), 0) >= 3)
        return full >= 0.8 * (h1 - h0)
    dates = sorted({k[0] for k in snaps})
    coverage = {}
    for dow in range(7):
        for name, (h0, h1, d) in (("amW", (5, 10, "W")), ("pmE", (13, 19, "E")), ("pmW", (14, 20, "W"))):
            got = [x.isoformat() for x in dates if x.weekday() == dow and typical(x) and covered(x, h0, h1, d)]
            coverage[f"{dow}-{name}"] = {"n": len(got), "dates": got[-8:]}
    key_cov = {}
    for k, (dow, h0, h1, d) in KEY_WINDOWS.items():
        got = [x.isoformat() for x in dates if x.weekday() == dow and typical(x) and covered(x, h0, h1, d)]
        key_cov[k] = {"n": len(got), "target": WINDOW_TARGET, "last": got[-1] if got else None}

    # Conditions seen: each weekend with at least one key window logged, sorted into dry, powder,
    # holiday, school break or disrupted (either day).
    powder = snow_weekends()
    seen = {"dry": [], "powder": [], "holiday": [], "break": [], "disrupted": []}
    for x in dates:
        if x.weekday() != 5:
            continue
        sun = x + timedelta(days=1)
        if not (covered(x, 5, 10, "W") or covered(x, 13, 19, "E") or covered(sun, 13, 19, "E")):
            continue
        types = {info(x)["type"], info(sun)["type"]}
        kind = next((k for k in ("disrupted", "holiday", "break") if k in types), None) or ("powder" if x.isoformat() in powder else "dry")
        seen[kind].append(x.isoformat())

    # Save a prediction for the coming weekend on Friday, the profile's best guess for each key window.
    path = os.path.join(DATA, "traffic_predictions.json")
    try:
        with open(path) as f:
            preds = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        preds = {}
    today = NOW.date()
    rinfo, rslots, ractual = route_model(today, typical)
    if today.weekday() == 4:
        sat = (today + timedelta(days=1)).isoformat()
        if sat not in preds:
            win = {}
            for k, (dow, h0, h1, d) in KEY_WINDOWS.items():
                prof = window_mean(slots, dow, h0, h1, d) if key_cov[k]["n"] else {}
                gen = GENERIC.get(d, {}).get(dow, {})
                win[k] = {"source": "profile" if prof else "estimate",
                          "by_hour": {str(h): prof.get(h, gen.get(h, 0)) for h in range(h0, h1)}}
            for rk in ROUTE_POINTS:
                for w, (dow, h0, h1, dr) in ROUTE_WINDOWS.items():
                    prof = route_window(rslots, rk, dow, h0, h1, dr) if rinfo[rk]["coverage"][w]["n"] else {}
                    gen = GENERIC_ROUTES.get(rk, {}).get(dow, {})
                    win[f"{rk}:{w}"] = {"source": "profile" if prof else "estimate",
                                        "by_hour": {str(h): prof.get(h, gen.get(h, 0)) for h in range(h0, h1)}}
            preds[sat] = {"made": NOW_ISO, "holiday": holiday_of(today + timedelta(days=1)),
                          "day": {k: info(today + timedelta(days=k)) for k in (0, 1, 2)}, "windows": win}
    # Grade any weekend that has finished: compare with what the speeds showed, hour by hour.
    for sat, pr in preds.items():
        if "graded" in pr:
            continue
        sat_d = datetime.fromisoformat(sat).date()
        if today <= sat_d + timedelta(days=1):
            continue
        errs = {}
        for k, (dow, h0, h1, d) in KEY_WINDOWS.items():
            day = (sat_d + timedelta(days=dow - 5)).isoformat()
            diffs = []
            for h in range(h0, h1):
                vals = actual.get(day, {}).get((d, h), [])
                if len(vals) >= 3:
                    diffs.append(abs(sum(vals) / len(vals) - pr["windows"][k]["by_hour"][str(h)]))
            if len(diffs) >= 0.8 * (h1 - h0):
                errs[k] = round(sum(diffs) / len(diffs), 1)
        for k, wpred in pr["windows"].items():
            if ":" not in k:
                continue
            rk, w = k.split(":")
            dow, h0, h1, dr = ROUTE_WINDOWS[w]
            day = (sat_d + timedelta(days=dow - 5)).isoformat()
            diffs = [abs(sum(v) / len(v) - wpred["by_hour"][str(h)]) for h in range(h0, h1)
                     for v in [ractual.get((rk, dr, day), {}).get(h, [])] if len(v) >= 3]
            if len(diffs) >= 0.8 * (h1 - h0):
                errs[k] = round(sum(diffs) / len(diffs), 1)
        pr["graded"] = NOW_ISO
        pr["error_min"] = errs
        pr["day_types"] = sorted({info(sat_d + timedelta(days=k))["type"] for k in (-1, 0, 1)})
        i70 = [v for k, v in errs.items() if ":" not in k]
        pr["mean_error_min"] = round(sum(i70) / len(i70), 1) if i70 else None
    with open(path, "w") as f:
        json.dump(preds, f, indent=1)
        f.write("\n")

    # How far each kind of day ran above typical: actual window delay against the typical profile,
    # as a multiplier (with 2 minutes added to both so near-empty roads don't blow it up).
    ratios = defaultdict(list)
    for x in dates:
        kind = info(x)["type"]
        if kind == "typical":
            continue
        for k, (dow, h0, h1, d) in KEY_WINDOWS.items():
            if x.weekday() != dow or not covered(x, h0, h1, d):
                continue
            prof = window_mean(slots, dow, h0, h1, d)
            act = [sum(v) / len(v) for h in range(h0, h1) for v in [actual.get(x.isoformat(), {}).get((d, h), [])] if v]
            if len(prof) >= 0.8 * (h1 - h0) and act:
                ratios[kind].append((sum(act) / len(act) + 2) / (sum(prof.values()) / len(prof) + 2))
    day_types = {}
    for kind in ("holiday", "break", "disrupted"):
        xs = sorted(ratios[kind])
        day_types[kind] = {"days": [x.isoformat() for x in dates if info(x)["type"] == kind],
                           "lift": round(xs[len(xs) // 2], 2) if len(xs) >= 2 else None, "windows": len(xs)}
    # Labels for every logged day and the next two weeks, for the dashboard.
    span = [dates[0] + timedelta(days=i) for i in range((today - dates[0]).days + 15)] if dates else []
    days = {x.isoformat(): info(x) for x in span if info(x)["type"] != "typical" or info(x)["tags"]}
    season = today.year if today.month >= 7 else today.year - 1
    hols = [[a.isoformat(), b.isoformat(), n] for a, b, n in holiday_periods(season) + holiday_periods(season + 1)]

    graded = [{"weekend": k, "mean_error_min": v.get("mean_error_min"), "error_min": v.get("error_min"),
               "day_types": v.get("day_types"), "source": sorted({w["source"] for w in v["windows"].values()})}
              for k, v in sorted(preds.items()) if "graded" in v]
    model = {"updated": NOW_ISO, "first_day": dates[0].isoformat() if dates else None, "days_logged": len(dates),
             "slots": slots, "coverage": coverage, "key_windows": key_cov, "target": WINDOW_TARGET,
             "conditions_seen": seen, "holidays": hols, "days": days, "day_types": day_types,
             "pass_blackouts": calendar().get("pass_blackouts", []), "generic": GENERIC, "graded": graded,
             "routes": rinfo, "route_slots": rslots, "route_windows": ROUTE_WINDOWS}
    with open(os.path.join(DATA, "traffic_model.json"), "w") as f:
        json.dump(model, f, separators=(",", ":"))
    state["traffic_model_last"] = NOW_UTC.isoformat()
    return f"{len(dates)} days, {len(slots)} slots"

# ---------------------------------------------------------------------------

def main():
    state = load_state()
    jobs = [("snotel", log_snotel), ("forecast", log_forecast), ("afd", log_afd),
            ("events", log_events), ("cdot", log_cdot), ("resort_status", log_resort_status),
            ("routes", log_routes), ("outlook", log_outlook), ("traffic_model", log_traffic_model)]
    for name, fn in jobs:
        try:
            print(f"{name}: {fn(state)}")
        except Exception as e:
            log_error(name, f"{e} | {traceback.format_exc(limit=2)}")
    state["last_run"] = NOW_ISO
    save_state(state)


if __name__ == "__main__":
    main()
