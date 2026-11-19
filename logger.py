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
    return {
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
    }


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


def log_speeds(state, key):
    segs, values, feed_ts = [], {}, []
    for f in cdot_get("speed", key):
        p = f.get("properties") or f
        route = str(p.get("route_name", ""))
        coords = (f.get("geometry") or {}).get("coordinates") or []
        while coords and isinstance(coords[0], list) and coords[0] and isinstance(coords[0][0], list):
            coords = [pt for line in coords for pt in line]  # flatten MultiLineString
        if not route.startswith("I70") or not coords:
            continue
        (lon0, lat0), (lon1, lat1) = coords[0][:2], coords[-1][:2]
        if not (in_box(lon0, lat0) or in_box(lon1, lat1)):
            continue
        sid = p.get("segment_id")
        segs.append([sid, route, round(lon0, 4), round(lat0, 4), round(lon1, 4), round(lat1, 4)])
        conf, speed = p.get("confidence_level") or 0, p.get("speed")
        values[sid] = round(speed) if speed is not None and conf >= MIN_CONFIDENCE else ""
        if p.get("timestamp"):
            feed_ts.append(p["timestamp"])
    if not values:
        raise RuntimeError("no I-70 mountain speed segments found")
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

def main():
    state = load_state()
    jobs = [("snotel", log_snotel), ("forecast", log_forecast), ("afd", log_afd),
            ("events", log_events), ("cdot", log_cdot), ("resort_status", log_resort_status)]
    for name, fn in jobs:
        try:
            print(f"{name}: {fn(state)}")
        except Exception as e:
            log_error(name, f"{e} | {traceback.format_exc(limit=2)}")
    state["last_run"] = NOW_ISO
    save_state(state)


if __name__ == "__main__":
    main()
