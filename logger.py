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
import time
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
ROUTES = {"I70", "US40", "US6", "CO119", "CO72", "CO93", "CO46", "CO9", "CO82", "CO91", "US24", "CO103", "CO65",
          "US285", "US50", "CO135", "US160", "US550", "CO62", "CO145"}
# Only keep I-70 events in the mountain corridor (Palisade, for Powderhorn, to C-470).
I70_MP_RANGE = (40.0, 276.0)

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
    """GET a URL. Retries only what can clear on its own (HTTP 429 and 5xx, timeouts, dropped
    connections), waiting a little longer each time. Other 4xx answers fail at once."""
    hdrs = {"User-Agent": USER_AGENT}
    hdrs.update(headers or {})
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            last = e
            if not (e.code == 429 or e.code >= 500):
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
        if attempt < retries:
            time.sleep((2, 5, 10)[min(attempt, 2)])
    raise RuntimeError(f"fetch failed: {redact(url)}: {last}")


def fetch_json(url, headers=None, retries=2):
    return json.loads(fetch(url, headers, retries=retries))


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


STATE_REF = {}  # set by main(), so repeated errors can be throttled across runs
ERROR_REPEAT_MINUTES = 60


def short_err(err):
    """Drop the long URL from a fetch error: 'host: HTTP Error 502: Bad Gateway'."""
    s = str(err)
    m = re.match(r"fetch failed: https?://([^/\s?]+)\S*: (.*)", s, re.S)
    return f"{m.group(1)}: {m.group(2)}" if m else s


def error_class(source, msg):
    m = re.search(r"HTTP Error \d+|timed out|refused|reset|unreachable|resolution", msg)
    return f"{source.split(':')[0]}|{m.group(0) if m else re.sub(r'[0-9]+', 'N', msg)[:40]}"


def log_error(source, err):
    """Append one error row, short. The same kind of error from the same source group is written
    at most once an hour, with a count of the repeats it skipped, so an outage at a provider
    cannot fill the file."""
    msg = short_err(err)[:400]
    print(f"[{source}] ERROR {msg}", file=sys.stderr)
    seen = STATE_REF.setdefault("err_seen", {})
    key = error_class(source, msg)
    prev = seen.get(key)
    if prev:
        age = NOW_UTC - datetime.fromisoformat(prev["t"])
        if age < timedelta(minutes=ERROR_REPEAT_MINUTES):
            prev["n"] = prev.get("n", 0) + 1
            return
    if prev and prev.get("n"):
        msg += f" (+{prev['n']} more of this kind since the last row)"
    seen[key] = {"t": NOW_UTC.isoformat(), "n": 0}
    for k in [k for k, v in seen.items() if NOW_UTC - datetime.fromisoformat(v["t"]) > timedelta(days=2)]:
        del seen[k]
    append_rows("errors", ["time", "source", "error"], [[NOW_ISO, source, msg]])


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
    rows, cache, failed, skipped, err = [], {}, [], [], None
    consecutive = 0
    for key, r in RESORTS.items():
        st = r["snotel"]
        if st not in cache:  # two resorts can share a station: fetch it once
            if consecutive >= 3:  # the service is down: stop hammering it this run
                skipped.append(key)
                continue
            try:
                cache[st] = parse_snotel_csv(fetch(SNOTEL_URL.format(triplet=st)))
                consecutive = 0
            except Exception as e:
                cache[st] = None
                consecutive += 1
                err = err or e
        data = cache[st]
        if data is None:
            failed.append(key)
            continue
        for obs_time, swe, depth, prec, temp in data:
            if obs_time > last.get(key, ""):
                rows.append([key, st, obs_time, swe, depth, prec, temp])
                last[key] = obs_time
    if failed or skipped:
        log_error("snotel", f"{len(failed)} stations failed, {len(skipped)} not tried "
                            f"({', '.join(failed + skipped)}): {short_err(err)}")
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
SPEED_BOX = {"lon": (-107.36, -104.98), "lat": (39.45, 39.85)}   # east edge: I-25 downtown, so I-70 runs from Coors Field
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
    segs, values, feed_ts, geo = [], {}, [], {}
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
        geo[sid] = [[round(y, 5), round(x, 5)] for x, y in (c[:2] for c in coords[::max(1, -(-len(coords) // 60))])]
        if geo[sid][-1] != [round(lat1, 5), round(lon1, 5)]:
            geo[sid].append([round(lat1, 5), round(lon1, 5)])
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
    # The road shape of each segment, for the dashboard map (the CSV keeps only the ends).
    geo_path = os.path.join(DATA, "speed", "segments_geo.json")
    if not os.path.exists(geo_path) or state.get("speed_geo") != sorted(values):
        with open(geo_path, "w") as fh:
            json.dump(geo, fh, separators=(",", ":"))
        state["speed_geo"] = sorted(values)
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
# The junctions drawn as nodes on the dashboard's line map. Every TomTom route is split at the nodes it
# passes, so each stretch between two nodes gets its own time and delay (Nov 25: the 6th Ave route was one
# reading from Coors Field, so a jam on I-25 painted 6th Ave too). Coordinates sit on the roads, checked
# against TomTom's own route lines. A route's first and last nodes are always its two ends.
NODES = {
    "coors": (39.7562, -104.9942), "i25": (39.7258, -105.0150), "i25i70": (39.7800, -104.9810),
    "x261": (39.7800, -105.1400), "us6": (39.7252, -105.1980), "golden": (39.7555, -105.2211),
    "floyd": (39.7425, -105.4313), "empire": (39.7611, -105.6831), "winterpark": (39.8863, -105.7618),
    "x216": (39.6801, -105.8946), "abasin": (39.6420, -105.8710), "keystone": (39.6046, -105.9440),
    "silverthorne": (39.6284, -106.0653), "boulder": (40.0150, -105.2705), "coal": (39.8660, -105.2330),
    "blackhawk": (39.7969, -105.4939), "nederland": (39.9614, -105.5108), "eldora": (39.9375, -105.5830),
}
NODE_SNAP_M = 1200   # a middle node counts as passed when the route comes this close to it
# Each route's nodes in the ski direction (heading up). Heading home uses the same list reversed.
ROUTE_NODES = {
    "sixth": ["coors", "i25", "us6", "golden"],
    "canyon": ["coors", "i25i70", "x261", "golden", "floyd"],
    "pass": ["x216", "abasin", "keystone"],
    "berthoud": ["empire", "winterpark"],
    "dillon": ["silverthorne", "keystone"],
    "eldora_boulder": ["coors", "i25i70", "boulder", "nederland", "eldora"],
    "eldora_coal": ["coors", "i25i70", "x261", "golden", "coal", "nederland", "eldora"],
    "eldora_119": ["coors", "i25i70", "x261", "golden", "blackhawk", "nederland", "eldora"],
    "i25direct": ["coors", "i25i70", "x261", "us6", "floyd"],
}
TOMTOM_FLOW = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/12/json"
TOMTOM_CAPS = {"routing": 19000, "flow": 19000}
ROUTE_POINTS = {
    # Routing goes start, via, end (heading up; reversed for heading home). The via point keeps
    # it on the road: without it the router would take I-70 through the tunnel instead of
    # Loveland Pass. Flow points are spread along the road. All coordinates are vertices of
    # TomTom's own geometry for these roads (from the calibration output), so they sit on the road.
    # From Coors Field to Golden by whatever TomTom finds fastest (I-70 and US 6, usually), then the canyon.
    # Before Nov 21 it started at Golden (min_km drops those rows).
    "canyon":   {"name": "Clear Creek Canyon (Coors Field to Golden by US 6, then the canyon to I-70 exit 244)", "max_km": 60, "min_km": 35, "every": 30,
                 "route": [(39.7562, -104.9942), (39.75454, -105.23687), (39.74168, -105.33004), (39.74238, -105.43138)],
                 # Heading home, the Golden waypoint snaps to the westbound side and TomTom loops back up the canyon to turn around.
                 "route_e": [(39.74238, -105.43138), (39.74168, -105.33004), (39.7562, -104.9942)],
                 "points": [(39.74204, -105.26940), (39.74168, -105.33004), (39.72766, -105.42222)]},
    "pass":     {"name": "Loveland Pass (US 6, I-70 exit 216 to Keystone)", "max_km": 27, "every": 30,
                 "route": [(39.6800, -105.8950), (39.6636, -105.8794), (39.6050, -105.9440)],
                 "points": [(39.67160, -105.87765), (39.64683, -105.87023), (39.62030, -105.92400)]},
    "berthoud": {"name": "Berthoud Pass (US 40, Empire to Winter Park)", "max_km": 45,
                 "route": [(39.76107, -105.68312), (39.79586, -105.78069), (39.88623, -105.76259)],
                 "points": [(39.76389, -105.74095), (39.78414, -105.78464), (39.82553, -105.76544), (39.88738, -105.76063)]},
    # Routing only (no flow points): the map draws it from the route shape. Heading up is from I-70 toward Keystone.
    # Heading up starts on US 6 at the exit 205 ramp (a point on I-70 itself sends the router east to
    # Loveland to turn around); heading home ends at the eastbound on-ramp, which routes cleanly.
    # Every 30 minutes since Nov 21, to make room in the TomTom allowance for 6th Ave below. The ski direction
    # only since Nov 22.
    "dillon":   {"name": "US 6 through Dillon (I-70 exit 205 at Silverthorne to Keystone)", "max_km": 18, "every": 30, "ski_direction_only": True,
                 "route": [(39.62844, -106.05265), (39.63236, -106.04066), (39.6050, -105.9440)],
                 "route_e": [(39.6050, -105.9440), (39.63236, -106.04066), (39.6297, -106.0640)],
                 "points": []},
    # 6th Ave (US 6) from Coors Field past I-70 to the mouth of Clear Creek Canyon in Golden, in both directions
    # all day (since Nov 22; before that, the ski direction only). Over max_km means TomTom left 6th Ave or looped,
    # so those rows are dropped.
    "sixth":    {"name": "6th Ave (US 6) from Coors Field to Golden", "max_km": 32, "min_km": 18,
                 # Westbound ends just short of Golden: with the Golden waypoint the router looped (34.9 km against
                 # 29.6 eastbound) and every westbound row was dropped as a detour until Nov 22.
                 "route": [(39.7562, -104.9942), (39.7254, -105.1500), (39.7430, -105.2400)],
                 "route_e": [(39.74245, -105.25436), (39.7254, -105.0800), (39.7562, -104.9942)],
                 "points": []},
    # Eldora, timed door to door from Coors Field. To stay inside the free allowance these run only in the
    # ski direction (heading up before noon, home after) and two of them every 30 minutes.
    "eldora_boulder": {"name": "Coors Field to Eldora by Boulder Canyon (US 36, CO 119)", "max_km": 100,
                       "every": 15, "ski_direction_only": True,
                       "route": [(39.7562, -104.9942), (40.0006, -105.3990), (39.96189, -105.51019), (39.9375, -105.5830)],
                       "points": []},
    # Coal Creek the way Ian drives it: I-70 west, US 6 to Golden, CO 93 north, then up CO 72.
    "eldora_coal":    {"name": "Coors Field to Eldora by Coal Creek Canyon (I-70, US 6, CO 93, CO 72)", "max_km": 100,
                       "every": 30, "ski_direction_only": True,
                       "route": [(39.7562, -104.9942), (39.8130, -105.2268), (39.8984, -105.3505), (39.96189, -105.51019), (39.9375, -105.5830)],
                       "points": []},
    "eldora_119":     {"name": "Coors Field to Eldora by CO 119 through Black Hawk", "max_km": 110,
                       "every": 30, "ski_direction_only": True,
                       "route": [(39.7562, -104.9942), (39.7958, -105.4929), (39.96189, -105.51019), (39.9375, -105.5830)],
                       "points": []},
    # I-25 and I-70 straight out to Floyd Hill (exit 244), skipping 6th Ave and the canyon. Ski direction only
    # since Nov 22: 60 requests a day. The waypoints are vertices of TomTom's own geometry on I-70 through
    # Denver and Wheat Ridge; without them the router takes 6th Ave instead.
    "i25direct": {"name": "I-25 and I-70 direct (Coors Field to I-70 exit 244)", "max_km": 60, "min_km": 40,
                  "every": 15, "ski_direction_only": True,
                  "route": [(39.7562, -104.9942), (39.7835, -105.0662), (39.7794, -105.1392), (39.74238, -105.43138)],
                  "points": []},
}
# Flow only, no routing: the roads Ian drives to get to the mountains from the north and west of town.
# Points are vertices of TomTom's own geometry (checked Nov 22: all within 5 m of the road, FRC0 or FRC2).
FLOW_ONLY = {
    "corridor": {"name": "Front Range approaches (I-25 north, US 36 to Boulder, CO 58 Golden freeway)",
                 "points": [(39.8038, -104.9834), (39.8277, -104.9912),                      # I-25 north of downtown
                            (39.854, -105.0513), (39.9469, -105.1486), (39.9801, -105.2206),  # US 36 to Boulder
                            (39.7733, -105.1729)]},                                          # CO 58 Golden freeway
}
# Route times stop at 8 PM: evenings carry no ski traffic, and it leaves room for the Eldora routes.
# Routing a day, in requests: Berthoud 120, 6th Ave 120 (both ways), Clear Creek Canyon 60 and Loveland Pass 60
# (every 30 minutes), Dillon 30 (ski direction), Eldora 120, I-25 direct 60 = 570, about 17,700 in a 31-day month.
# Flow, since Nov 22: 16 points every 30 minutes, 480 a day, about 14,900 a month (was 10 points every 15 minutes).
FLOW_GAP_MIN = 25
TOMTOM_HOURS = {"routing": (5, 20), "flow": (5, 20)}


def route_jobs():
    """(route, direction, points) to time this run, honoring each route's cadence and direction."""
    jobs, slot = [], NOW.minute // 15
    for rk, R in ROUTE_POINTS.items():
        if not R.get("route"):
            continue
        if R.get("every") == 30 and slot % 2:
            continue
        for d, pts in (("W", R["route"]), ("E", R.get("route_e") or list(reversed(R["route"])))):
            if R.get("ski_direction_only") and d != ("W" if NOW.hour < 12 else "E"):
                continue
            jobs.append((rk, d, pts))
    return jobs


def tomtom_get(url, key, where):
    """One TomTom request, paced under its per-second limit. Retries a 429 or 5xx up to twice, with a
    pause. A routing 400 means TomTom found no way along the road, which is how it reports a closure."""
    for attempt in (1, 2, 3):
        time.sleep(0.35)
        try:
            return fetch_json(url, retries=0)
        except Exception as e:
            text = str(e)
            if attempt < 3 and re.search(r"HTTP Error (429|5\d\d)", text):
                time.sleep(2 * attempt)
                continue
            if "calculateRoute" in url and "HTTP Error 400" in text:
                return {"no_route": True}
            log_error(where, text.replace(key, "KEY"))
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


def tomtom_budget(state, kind, need, gap_min=12):
    """True if this run may spend `need` requests of `kind`; counts them per calendar month."""
    h0, h1 = TOMTOM_HOURS[kind]
    if not h0 <= NOW.hour < h1:
        return False
    last = state.get(f"tomtom_{kind}_last")
    if last and NOW_UTC - datetime.fromisoformat(last) < timedelta(minutes=gap_min):
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


def split_route(rk, d, route, geo):
    """Cut one TomTom route at the line-map nodes it passes. Returns one dict per stretch, in driving order:
    the two node ids, its key in ski-direction order ("coors>i25"), length, minutes with traffic, minutes on an
    empty road, delay, and its line. Minutes with traffic come from TomTom's turn-by-turn times (time from the
    start at each turn). The empty-road total is shared out along the route by the speed limits TomTom sends,
    so a 35 mph city street gets more of it than the freeway. Delay is the difference. TomTom's named jams on
    the stretch are kept too (jam_min); they miss slowness spread along a road, so they aren't the delay
    (Nov 25: 6th Ave ran 4 minutes slow with no jam listed)."""
    import math
    names = ROUTE_NODES.get(rk)
    if not names or len(geo) < 2:
        return []
    if d == "E":
        names = list(reversed(names))
    pts = [(p["latitude"], p["longitude"]) for p in geo]
    cum = [0.0]
    for (a, b), (c, e) in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot((c - a) * 110540, (e - b) * 111320 * math.cos(math.radians(a))))
    summ = route["summary"]
    scale = (summ.get("lengthInMeters") or cum[-1]) / (cum[-1] or 1)
    # Where each middle node falls on the line, kept only when it is in driving order.
    cuts, last = [(names[0], 0)], 0
    for n in names[1:-1]:
        lat, lon = NODES[n]
        kx = 111320 * math.cos(math.radians(lat))
        i, dist = min(((i, math.hypot((p[0] - lat) * 110540, (p[1] - lon) * kx)) for i, p in enumerate(pts)), key=lambda x: x[1])
        if dist <= NODE_SNAP_M and i > last:
            cuts.append((n, i))
            last = i
    cuts.append((names[-1], len(pts) - 1))
    # Live time at any point index, from the turn-by-turn instructions (time from the start at each turn).
    marks = sorted({(ins["pointIndex"], ins["travelTimeInSeconds"]) for ins in (route.get("guidance") or {}).get("instructions", [])
                    if isinstance(ins.get("pointIndex"), int) and isinstance(ins.get("travelTimeInSeconds"), (int, float))
                    and 0 <= ins["pointIndex"] < len(pts)})
    live_total, none_total = summ.get("travelTimeInSeconds"), summ.get("noTrafficTravelTimeInSeconds")
    if marks and live_total:
        marks = [(0, 0)] + [m for m in marks if m[0] > 0] + [(len(pts) - 1, live_total)]

    def live_at(i):
        for (i0, t0), (i1, t1) in zip(marks, marks[1:]):
            if i0 <= i <= i1:
                return t0 if cum[i1] == cum[i0] else t0 + (t1 - t0) * (cum[i] - cum[i0]) / (cum[i1] - cum[i0])
        return live_total
    secs = route.get("sections", [])
    jams = [x for x in secs if x.get("sectionType") == "TRAFFIC" and x.get("delayInSeconds")]
    # Empty-road weight of each piece of line: its length over its speed limit (60 km/h where none is given).
    limit = [None] * len(pts)
    for x in secs:
        if x.get("sectionType") == "SPEED_LIMIT" and x.get("maxSpeedLimitInKmh"):
            for i in range(max(0, x.get("startPointIndex", 0)), min(len(pts) - 1, x.get("endPointIndex", 0))):
                limit[i] = x["maxSpeedLimitInKmh"]
    wcum = [0.0]
    for i in range(len(pts) - 1):
        wcum.append(wcum[-1] + (cum[i + 1] - cum[i]) / (limit[i] or 60))
    out = []
    for (a, i0), (b, i1) in zip(cuts, cuts[1:]):
        if i1 <= i0:
            continue
        jam = 0.0
        for x in jams:
            s0, s1 = x.get("startPointIndex", 0), x.get("endPointIndex", 0)
            span = cum[min(s1, len(cum) - 1)] - cum[min(s0, len(cum) - 1)]
            lo, hi = max(s0, i0), min(s1, i1)
            if hi > lo and span > 0:
                jam += x["delayInSeconds"] * (cum[hi] - cum[lo]) / span
            elif s0 == s1 and i0 <= s0 < i1:
                jam += x["delayInSeconds"]
        free = (none_total or 0) * (wcum[i1] - wcum[i0]) / (wcum[-1] or 1)
        if len(marks) > 2:
            live = live_at(i1) - live_at(i0)
        else:
            live = free + jam
        key = f"{a}>{b}" if d == "W" else f"{b}>{a}"
        out.append({"from": a, "to": b, "key": key, "km": round((cum[i1] - cum[i0]) * scale / 1000, 1),
                    "minutes": round(live / 60, 1), "free_min": round(free / 60, 1),
                    "delay_min": round(max(0.0, live - free) / 60, 1), "jam_min": round(jam / 60, 1),
                    "line": simplify_line(pts[i0:i1 + 1], 120)})
    # The speed limits overstate an empty road on curvy roads (no one does the limit down Loveland Pass), so
    # the stretches never add up to more delay than TomTom gives the whole route: where the delay is still
    # comes from the stretches, how much from the route.
    total = max(0.0, (live_total or 0) - (none_total or 0)) / 60
    raw = sum(g["delay_min"] for g in out)
    if raw > total:
        for g in out:
            g["delay_min"] = round(g["delay_min"] * total / raw, 1) if raw else 0.0
            g["free_min"] = round(max(g["minutes"] - g["delay_min"], 0.1), 1)
    return out


def simplify_line(pts, max_pts=380):
    """Douglas-Peucker: keep the vertices where the road bends, drop the ones on straight stretches. Starts at
    10 m and loosens until the line fits in max_pts. (Every-nth thinning cut corners: Boulder Canyon showed as
    long straight chords.) Returns [[lat, lon], ...] rounded to 5 places."""
    import math
    if len(pts) <= 2:
        return [[round(a, 5), round(b, 5)] for a, b in pts]
    lat0 = pts[0][0]
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    xy = [(p[1] * kx, p[0] * ky) for p in pts]

    def dp(tol):
        keep, stack = {0, len(pts) - 1}, [(0, len(pts) - 1)]
        while stack:
            i, j = stack.pop()
            (x0, y0), (x1, y1) = xy[i], xy[j]
            dx, dy = x1 - x0, y1 - y0
            den = math.hypot(dx, dy)
            best, at = -1.0, None
            for k in range(i + 1, j):
                x, y = xy[k]
                d = math.hypot(x - x0, y - y0) if den == 0 else abs(dy * (x - x0) - dx * (y - y0)) / den
                if d > best:
                    best, at = d, k
            if at is not None and best > tol:
                keep.add(at)
                stack += [(i, at), (at, j)]
        return sorted(keep)
    tol, keep = 10.0, None
    while True:
        keep = dp(tol)
        if len(keep) <= max_pts or tol > 400:
            break
        tol *= 1.5
    return [[round(pts[k][0], 5), round(pts[k][1], 5)] for k in keep]


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

    jobs = route_jobs()
    if jobs and tomtom_budget(state, "routing", len(jobs)):
        rows, seg_rows = [], []
        for rk, R in ROUTE_POINTS.items():
            out = now["routes"].setdefault(rk, {"name": R["name"]})
            for d, pts in [(jd, jp) for jk, jd, jp in jobs if jk == rk]:
                locs = ":".join(f"{lat},{lon}" for lat, lon in pts)
                j = tomtom_get(TOMTOM_ROUTE.format(locs) + f"?key={key}&traffic=true&computeTravelTimeFor=all"
                               "&routeType=fastest&travelMode=car&sectionType=traffic&sectionType=speedLimit&instructionsType=coded",
                               key, f"routes:{rk}:{d}")
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
                    out[d]["line"] = simplify_line([(p["latitude"], p["longitude"]) for p in geo])
                    # Each stretch between line-map nodes, on its own.
                    try:
                        segs = split_route(rk, d, j["routes"][0], geo)
                    except Exception as e:
                        log_error(f"routes:{rk}:{d}:split", e)
                        segs = []
                    if segs:
                        out[d]["segs"] = segs
                        seg_rows += [[NOW_ISO, rk, d, g["key"], g["from"], g["to"], g["km"], g["minutes"], g["free_min"], g["delay_min"], g["jam_min"]] for g in segs]
                    else:
                        out[d].pop("segs", None)
        append_rows("routes", ["snapshot_time", "route", "dir", "length_m", "travel_s", "no_traffic_s",
                               "historic_s", "delay_s", "detour"], rows)
        # One row per stretch between line-map nodes (since Nov 25), so each road has its own history.
        append_rows("route_segments", ["snapshot_time", "route", "dir", "segment", "from", "to", "km",
                                       "minutes", "free_min", "delay_min", "jam_min"], seg_rows)
        did.append("routing")

    flow_sets = {**ROUTE_POINTS, **FLOW_ONLY}
    if tomtom_budget(state, "flow", sum(len(R["points"]) for R in flow_sets.values()), FLOW_GAP_MIN):
        rows = []
        for rk, R in flow_sets.items():
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

CORRIDOR_WEST_LON, CORRIDOR_EAST_LON = -106.145, -104.99   # Copper to I-25 downtown (C-470 before Nov 21)
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
                  "dillon": {5: {8: 2, 9: 3, 10: 2}, 6: {14: 2, 15: 3, 16: 3}},
                  "sixth": {5: {7: 2, 8: 3, 9: 2}, 6: {14: 2, 15: 4, 16: 4, 17: 2}},
                  "eldora_boulder": {5: {7: 3, 8: 5, 9: 5, 10: 3}, 6: {14: 4, 15: 7, 16: 7, 17: 4}},
                  "eldora_coal": {5: {7: 2, 8: 3, 9: 3, 10: 2}, 6: {14: 2, 15: 4, 16: 4, 17: 2}},
                  "eldora_119": {5: {7: 2, 8: 3, 9: 3, 10: 2}, 6: {14: 3, 15: 4, 16: 4, 17: 3}}}


def route_delays():
    """Yield (local time, route key, direction, delay minutes) from the logged TomTom routing times."""
    import glob
    for path in sorted(glob.glob(os.path.join(DATA, "routes", "20*.csv"))):
        with open(path) as f:
            for r in csv.DictReader(f):
                if r.get("route") not in ROUTE_POINTS or r.get("detour") == "True" or not r.get("travel_s") or not r.get("no_traffic_s"):
                    continue
                if (not r.get("length_m") or float(r["length_m"]) > ROUTE_POINTS[r["route"]]["max_km"] * 1000
                        or float(r["length_m"]) < ROUTE_POINTS[r["route"]].get("min_km", 0) * 1000):
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
                   and sum(1 for h in range(h0, h1) if snaps.get((rk, dr, d, h), 0) >= (2 if ROUTE_POINTS[rk].get("every") == 30 else 3)) >= 0.8 * (h1 - h0)]
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
    # Day by day (all seven days, not just weekends): what each logged day contributed.
    daily = []
    for x in dates:
        daily.append({"d": x.isoformat(), "snaps": sum(v for k, v in snaps.items() if k[0] == x),
                      "win": [int(covered(x, h0, h1, d)) for h0, h1, d in ((5, 10, "W"), (14, 20, "W"), (13, 19, "E"))],
                      "typical": bool(typical(x))})
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
    model = {"updated": NOW_ISO, "first_day": dates[0].isoformat() if dates else None, "days_logged": len(dates), "daily": daily,
             "slots": slots, "coverage": coverage, "key_windows": key_cov, "target": WINDOW_TARGET,
             "conditions_seen": seen, "holidays": hols, "days": days, "day_types": day_types,
             "pass_blackouts": calendar().get("pass_blackouts", []), "generic": GENERIC, "graded": graded,
             "routes": rinfo, "route_slots": rslots, "route_windows": ROUTE_WINDOWS}
    with open(os.path.join(DATA, "traffic_model.json"), "w") as f:
        json.dump(model, f, separators=(",", ":"))
    state["traffic_model_last"] = NOW_UTC.isoformat()
    return f"{len(dates)} days, {len(slots)} slots"

# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# COtrip plows (trial since Nov 22) and cameras (keyless feed, refreshed daily)
# ---------------------------------------------------------------------------

PLOW_BOX = {"lat": (39.4, 40.1), "lon": (-106.5, -105.0)}     # the ski corridor: Berthoud, Loveland, I-70, Boulder side
CAM_BOX = {"lat": (39.3, 40.15), "lon": (-106.6, -104.85)}
CAMERAS_URL = "https://api-511x-co.carsprogram.org/cameras/map-features"
CAMERAS_EVERY = timedelta(hours=20)


def log_plows(state):
    """One row a run: how many CDOT plows are out, statewide and in the ski corridor. A trial: it stays only
    if the counts turn out to help the model (check after a few storms)."""
    key = os.environ.get("CDOT_API_KEY", "").strip()
    if not key:
        return "no CDOT key"
    try:
        feats = cdot_get("snowPlows", key)
    except Exception as e:
        log_error("plows", str(e).replace(key, "KEY"))
        return "failed"
    now_s = NOW_UTC.timestamp()
    tot = mov = box = box_mov = 0
    for f in feats:
        a = f.get("avl_location") or {}
        pos = a.get("position") or {}
        lat, lon = pos.get("latitude"), pos.get("longitude")
        ts = (a.get("source") or {}).get("collection_timestamp")
        if lat is None or lon is None or not ts or now_s - float(ts) > 1800:
            continue    # no position, or a stale one
        moving = (pos.get("speed") or 0) > 1
        tot += 1
        mov += moving
        if PLOW_BOX["lat"][0] <= lat <= PLOW_BOX["lat"][1] and PLOW_BOX["lon"][0] <= lon <= PLOW_BOX["lon"][1]:
            box += 1
            box_mov += moving
    append_rows("plows", ["snapshot_time", "statewide", "statewide_moving", "corridor", "corridor_moving"],
                [[NOW_ISO, tot, mov, box, box_mov]])
    return f"{tot} plows fresh, {box} in the corridor"


def log_cameras(state):
    """data/cameras.json: the COtrip still cameras in the ski corridor, with their image links, for the dashboard."""
    last = state.get("cameras_last")
    if last and state.get("cameras_v") == 2 and NOW_UTC - datetime.fromisoformat(last) < CAMERAS_EVERY:
        return "not due"
    data = fetch_json(CAMERAS_URL, {"Accept": "application/json"})
    cams = []
    for f in data.get("features", []):
        p = f.get("properties") or {}
        lon, lat = (f.get("geometry") or {}).get("coordinates", [None, None])[:2]
        if lat is None or not p.get("public", True):
            continue
        if not (CAM_BOX["lat"][0] <= lat <= CAM_BOX["lat"][1] and CAM_BOX["lon"][0] <= lon <= CAM_BOX["lon"][1]):
            continue
        if not re.match(r"(I-|C-?470|US[ -]|CO[ -])", str(p.get("route") or "")):
            continue    # city streets and county roads
        views = []
        for v in p.get("views") or []:
            # Still cameras carry the picture itself; CDOT's video cameras carry a still preview of the stream.
            img = v.get("url") if v.get("type") == "STILL_IMAGE" else v.get("videoPreviewUrl")
            if img and not v.get("broken"):
                views.append([v.get("name", ""), img])
        if views:
            cams.append({"id": p.get("id"), "name": p.get("name"), "route": p.get("route"),
                         "lat": round(lat, 5), "lon": round(lon, 5), "views": views})
    cams.sort(key=lambda c: (c["route"] or "", c["id"] or 0))
    with open(os.path.join(DATA, "cameras.json"), "w") as f:
        json.dump({"updated": NOW_ISO, "source": "CDOT COtrip (cotrip.org)", "cameras": cams}, f, separators=(",", ":"))
    state["cameras_last"] = NOW_UTC.isoformat()
    state["cameras_v"] = 2
    return f"{len(cams)} cameras"


def log_recent(state):
    """What the roads actually did, hour by hour, for the dashboard's logged bars. Same delay math as the traffic
    model: I-70 from Copper to downtown, and each TomTom route. recent.json holds yesterday and today (Denver time);
    history/YYYY-MM.json holds every logged day of a month, for the date picker. Only this month and last month are
    rewritten each run, plus any month that has no file yet."""
    from collections import defaultdict
    i70 = defaultdict(lambda: defaultdict(list))      # day -> (dir, hour) -> delays
    rts = defaultdict(lambda: defaultdict(list))      # day -> (route, dir, hour) -> delays
    for t, w, e in corridor_delays():
        day = t.date().isoformat()
        for d, v in (("W", w), ("E", e)):
            if v is not None:
                i70[day][(d, t.hour)].append(v)
    for t, rk, d, v in route_delays():
        rts[t.date().isoformat()][(rk, d, t.hour)].append(v)
    cell = lambda v: {"mean": round(sum(v) / len(v), 1), "max": round(max(v), 1), "n": len(v)}

    def one(day):
        x = {"i70": {"W": {}, "E": {}}, "routes": {}}
        for (d, h), v in i70[day].items():
            x["i70"][d][str(h)] = cell(v)
        for (rk, d, h), v in rts[day].items():
            x["routes"].setdefault(rk, {"W": {}, "E": {}})[d][str(h)] = cell(v)
        return x
    recent = [(NOW - timedelta(days=i)).date().isoformat() for i in (1, 0)]
    with open(os.path.join(DATA, "recent.json"), "w") as f:
        json.dump({"updated": NOW_ISO, "days": {d: one(d) for d in recent}}, f, separators=(",", ":"))
    hdir = os.path.join(DATA, "history")
    os.makedirs(hdir, exist_ok=True)
    all_days = sorted(set(i70) | set(rts))
    months = sorted({d[:7] for d in all_days})
    fresh = {d[:7] for d in recent} | {(NOW.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")}
    wrote = 0
    for m in months:
        path = os.path.join(hdir, f"{m}.json")
        if m in fresh or not os.path.exists(path):
            with open(path, "w") as f:
                json.dump({"updated": NOW_ISO, "days": {d: one(d) for d in all_days if d.startswith(m)}}, f, separators=(",", ":"))
            wrote += 1
    with open(os.path.join(hdir, "index.json"), "w") as f:
        json.dump({"updated": NOW_ISO, "first_day": all_days[0] if all_days else None, "months": months}, f)
    return f"{len(all_days)} days, {wrote} month files"


# ---------------------------------------------------------------------------
# Daily forecasts and grades (2.0): a forecast for every day, not just weekend windows
# ---------------------------------------------------------------------------
# Each evening the logger saves tomorrow's expected I-70 delay to Copper, hour by hour, for the drive up
# (5 to 11 AM, westbound) and the drive home (11 AM to 7 PM, eastbound). A day that has passed is graded against
# what the speeds showed: mean absolute error over every hour with 3 or more snapshots, plus the two peaks.
DAILY_UP, DAILY_HOME = (5, 11, "W"), (11, 19, "E")


def daily_forecast(model, day):
    """Expected I-70 delay (minutes) by hour for one day, from the typical profile for its weekday, scaled for
    holidays and breaks by how far those days have run above typical. Falls back to the generic pattern."""
    slots, gen = model.get("slots", {}), model.get("generic", {})
    dow = day.weekday()
    kind = (model.get("days", {}).get(day.isoformat()) or {}).get("type", "typical")
    lift = ((model.get("day_types", {}).get(kind) or {}).get("lift") or (1.4 if kind in ("holiday", "break") else 1.0)) if kind != "typical" else 1.0
    out, src = {}, set()
    for h0, h1, d in (DAILY_UP, DAILY_HOME):
        out[d] = {}
        for h in range(h0, h1):
            got = [slots[k]["median"] for k in (f"{dow}-{h:02d}00-{d}", f"{dow}-{h:02d}30-{d}") if k in slots]
            if got:
                v = sum(got) / len(got)
                src.add("profile")
            else:
                g = (gen.get(d) or {}).get(str(dow)) or (gen.get(d) or {}).get(dow) or {}
                v = g.get(str(h), g.get(h, 0))
                src.add("estimate")
            out[d][str(h)] = round(v * lift, 1)
    return {"type": kind, "lift": lift, "source": "profile" if src == {"profile"} else "estimate" if src == {"estimate"} else "mixed", "by_hour": out}


def log_daily_predictions(state):
    path = os.path.join(DATA, "daily_predictions.json")
    try:
        with open(path) as f:
            preds = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        preds = {}
    try:
        with open(os.path.join(DATA, "traffic_model.json")) as f:
            model = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return "no traffic model yet"
    today, made = NOW.date(), 0
    # Tomorrow's forecast after 6 PM; today's too if somehow missing (marked late, still graded).
    want = [(today + timedelta(days=1), False)] if NOW.hour >= 18 else []
    want.append((today, NOW.hour >= 5))
    for day, late in want:
        k = day.isoformat()
        if k not in preds:
            preds[k] = {"made": NOW_ISO, "late": late, **daily_forecast(model, day)}
            made += 1
    # Grade every past day that has logged hours.
    hist = {}
    for m in sorted({k[:7] for k in preds}):
        try:
            with open(os.path.join(DATA, "history", f"{m}.json")) as f:
                hist.update(json.load(f).get("days", {}))
        except (FileNotFoundError, json.JSONDecodeError):
            pass
    graded = 0
    for k, pr in preds.items():
        if "graded" in pr or k >= today.isoformat() or k not in hist:
            continue
        res = {}
        for h0, h1, d in (DAILY_UP, DAILY_HOME):
            act = hist[k].get("i70", {}).get(d, {})
            pairs = [(pr["by_hour"][d][str(h)], act[str(h)]["mean"]) for h in range(h0, h1)
                     if str(h) in act and act[str(h)].get("n", 0) >= 3]
            if len(pairs) >= 0.8 * (h1 - h0):
                p_pk = max(range(h0, h1), key=lambda h: pr["by_hour"][d][str(h)])
                a_pk = max((h for h in range(h0, h1) if str(h) in act), key=lambda h: act[str(h)]["mean"])
                res[d] = {"error_min": round(sum(abs(a - b) for a, b in pairs) / len(pairs), 1),
                          "pred_peak": [p_pk, pr["by_hour"][d][str(p_pk)]], "logged_peak": [a_pk, round(act[str(a_pk)]["mean"], 1)]}
        pr["graded"], pr["result"] = NOW_ISO, res
        errs = [v["error_min"] for v in res.values()]
        pr["mean_error_min"] = round(sum(errs) / len(errs), 1) if errs else None
        graded += 1
    # Keep a season: drop anything older than 400 days.
    cut = (today - timedelta(days=400)).isoformat()
    preds = {k: v for k, v in sorted(preds.items()) if k >= cut}
    with open(path, "w") as f:
        json.dump(preds, f, separators=(",", ":"))
    return f"{made} made, {graded} graded"


# ---------------------------------------------------------------------------
# Crowd log (2.0)
# ---------------------------------------------------------------------------
# One row per mountain per source per run, plus a combined level 1 to 4. Live now: TomTom flow on the last
# stretch of road into each base area (trial: points are best guesses, the returned road is logged so they
# can be checked). Planned, not yet fetched: people counted in base-area webcams, lift waits from the Copper
# and Winter Park apps, parking lot status and reservations. Those show as "not yet" on the Data tab.
CROWD_POINTS = {
    "copper": {"name": "CO 91 into Copper", "point": (39.4990, -106.1445)},
    "winterpark": {"name": "US 40 at Winter Park base", "point": (39.8880, -105.7620)},
    "abasin": {"name": "US 6 at A-Basin", "point": (39.6425, -105.8717)},
    "eldora": {"name": "Eldora Ski Road", "point": (39.9440, -105.5520), "zoom": 10},
}
# Base-area webcams with a plain image URL (no signed stream). People are counted with YOLOv8n (crowd_count.py).
CROWD_CAMS = {
    "abasin": [("base", "Mountain Goat Plaza and Black Mountain Express",
                "https://dirigo-resorts-f4e2bde5azc2cne6.z02.azurefd.net/arapahoe/images/medium/webcams/abasincam1001m.jpg")],
}
CROWD_CAM_HOURS = (7, 17)   # lifts open about 8:30 to 4; count from 7 to see the line form
CROWD_SOURCES = [
    {"key": "last_mile", "name": "Traffic on the last mile into each base area (TomTom flow)", "status": "trial"},
    {"key": "cameras", "name": "People counted in base-area webcam lift lines", "status": "trial"},
    {"key": "app_waits", "name": "Lift waits in the Copper and Winter Park apps", "status": "skipped",
     "note": "App-only; reading it would mean a private API, likely against the apps' terms"},
    {"key": "parking", "name": "Parking lot status and reservations left", "status": "not yet"},
]
TOMTOM_HOURS["crowd"] = (6, 18)
TOMTOM_CAPS["crowd"] = 3000      # 4 points every 30 minutes, 6 AM to 6 PM: about 2,900 in a 31-day month


def crowd_level(ratio):
    """Slowdown on the last mile (travel time over free flow) as a 1 to 4 level."""
    if ratio is None:
        return None
    return 1 if ratio < 1.1 else 2 if ratio < 1.3 else 3 if ratio < 1.6 else 4


def log_crowd(state):
    key = os.environ.get("TOMTOM_API_KEY")
    if not key:
        return "no TomTom key"
    if not tomtom_budget(state, "crowd", len(CROWD_POINTS), gap_min=25):
        return "skipped (hours, cadence or budget)"
    rows = []
    for rk, P in CROWD_POINTS.items():
        lat, lon = P["point"]
        url = TOMTOM_FLOW.replace("/absolute/12/", f"/absolute/{P.get('zoom', 12)}/")
        j = tomtom_get(f"{url}?point={lat},{lon}&unit=mph&key={key}", key, f"crowd:{rk}")
        if not j or "flowSegmentData" not in j:
            continue
        d = j["flowSegmentData"]
        cur, free = d.get("currentTravelTime"), d.get("freeFlowTravelTime")
        ratio = round(cur / free, 2) if cur and free else None
        # Log the point on the matched road nearest the query, and how far it is, so a wrong road shows up.
        pts = d.get("coordinates", {}).get("coordinate") or []
        near = min(pts, key=lambda c: (c["latitude"] - lat) ** 2 + ((c["longitude"] - lon) * 0.77) ** 2) if pts else {}
        dist_m = round(((near.get("latitude", lat) - lat) ** 2 + ((near.get("longitude", lon) - lon) * 0.77) ** 2) ** 0.5 * 111000) if pts else ""
        detail = f"{d.get('frc', '')} nearest {near.get('latitude', '')},{near.get('longitude', '')} ({dist_m} m) speed {d.get('currentSpeed', '')}/{d.get('freeFlowSpeed', '')}"
        if d.get("roadClosure"):
            detail += " closed"
        rows.append([NOW_ISO, rk, "last_mile", ratio, "ratio", crowd_level(ratio), detail])
    append_rows("crowd", ["snapshot_time", "resort", "source", "value", "unit", "level", "detail"], rows)
    return f"{len(rows)} rows"


def log_crowd_cams(state):
    """Count people in each base-area webcam frame. Once a day (the 11 o'clock run) keep a small frame with the
    boxes drawn, so the counts can be checked by eye."""
    if not (CROWD_CAM_HOURS[0] <= NOW.hour < CROWD_CAM_HOURS[1]):
        return "outside camera hours"
    try:
        from PIL import Image, ImageDraw
        from crowd_count import count_people
    except ImportError as e:
        return f"counter not installed ({e.name})"
    import io
    import urllib.request
    model = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "yolov8n.onnx")
    rows = []
    for rk, cams in CROWD_CAMS.items():
        for key, name, url in cams:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "ski-logger (github.com/i70skibum/ski-logger)"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    img = Image.open(io.BytesIO(r.read())).convert("RGB")
                boxes = count_people(img, model)
            except Exception as e:
                log_error(f"crowd_cam:{rk}:{key}", str(e)[:300])
                continue
            rows.append([NOW_ISO, rk, f"camera:{key}", len(boxes), "people", "", f"{img.size[0]}x{img.size[1]} {name}"])
            if NOW.hour == 11 and NOW.minute < 15:
                os.makedirs(os.path.join(DATA, "crowd", "frames"), exist_ok=True)
                d = ImageDraw.Draw(img)
                for b in boxes:
                    d.rectangle(b[:4], outline=(127, 209, 255), width=2)
                img.thumbnail((960, 960))
                img.save(os.path.join(DATA, "crowd", "frames", f"{rk}-{key}-{NOW.date().isoformat()}.jpg"), quality=70)
    append_rows("crowd", ["snapshot_time", "resort", "source", "value", "unit", "level", "detail"], rows)
    return f"{len(rows)} frames counted"


# ---------------------------------------------------------------------------
# dashboard.json (2.0): everything the page shows, in one small file
# ---------------------------------------------------------------------------
def _read_json(rel, default=None):
    try:
        with open(os.path.join(DATA, rel)) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _read_csv_tail(rel, n=4000):
    import csv
    try:
        with open(os.path.join(DATA, rel), newline="") as f:
            rows = list(csv.DictReader(f))
        return rows[-n:]
    except FileNotFoundError:
        return []


I70_BANDS = [("i25_golden", -105.14, -104.98, 266, 276), ("golden_us6", -105.19, -105.14, 260, 266), ("us6_floyd", -105.43, -105.19, 244, 260),
             ("floyd_idaho", -105.51, -105.43, 240, 244), ("idaho_empire", -105.66, -105.51, 232, 240), ("empire_georgetown", -105.71, -105.66, 228, 232),
             ("georgetown_216", -105.88, -105.71, 216, 228), ("x216_silverthorne", -106.07, -105.88, 205, 216), ("silverthorne_copper", -106.16, -106.07, 195, 205)]


def i70_stretches():
    """Latest delay on each I-70 stretch, each way: extra minutes over its normal speed, and that as a share
    of the stretch's normal time. Normal is the 85th-percentile speed this month (same as the corridor math)."""
    segs = []
    with open(os.path.join(DATA, "speed", "segments.csv")) as f:
        for r in csv.DictReader(f):
            if not r["route"].startswith("I70"):
                continue
            lon0, lon1 = float(r["start_lon"]), float(r["end_lon"])
            segs.append((r["segment_id"], "W" if r["route"].endswith("W") else "E", (lon0 + lon1) / 2,
                         miles(lon0, float(r["start_lat"]), lon1, float(r["end_lat"]))))
    rows = _read_csv_tail(f"speed/{NOW.strftime('%Y-%m')}.csv", 3000)
    if not rows:
        return {}
    last, out = rows[-1], {"at": rows[-1].get("snapshot_time")}
    for key, w, e, mp0, mp1 in I70_BANDS:
        out[key] = {"mp": [mp0, mp1]}
        for d in "WE":
            tot = norm = 0.0
            n = 0
            for sid, sd, mid, ln in segs:
                if sd != d or not (w <= mid <= e) or not last.get(sid):
                    continue
                v = sorted(float(r[sid]) for r in rows if r.get(sid))
                ref = max(45, min(65, v[int(len(v) * 0.85)] if len(v) >= 48 else 58))
                n += 1
                tot += max(0, ln / max(float(last[sid]), 3) - ln / ref) * 60
                norm += ln / ref * 60
            out[key][d] = {"delay_min": round(tot, 1), "norm_min": round(norm, 1), "pct": round(tot / norm, 3) if norm else None} if n else None
    return out


def build_dashboard(state):
    month = NOW.strftime("%Y-%m")
    rn = _read_json("routes_now.json", {}) or {}
    roads = {}
    for rk, r in (rn.get("routes") or {}).items():
        x = {"name": r.get("name"), "closed": bool(r.get("closed"))}
        for d in ("W", "E"):
            v = r.get(d)
            if v:
                x[d] = {k: v.get(k) for k in ("minutes", "free_min", "delay_min", "detour", "at")}
                x[d]["segs"] = [{k: sg.get(k) for k in ("key", "name", "minutes", "free_min", "delay_min") if k in sg} for sg in (v.get("segs") or []) if isinstance(sg, dict)]
        roads[rk] = x
    # I-70: latest corridor delay each way (Copper to downtown), same math as the model.
    i70 = {}
    for t, w, e in corridor_delays():
        if t.date() == NOW.date():
            i70 = {"at": t.isoformat(), "W": None if w is None else round(w, 1), "E": None if e is None else round(e, 1)}
    # Snow: latest SNOTEL depth and the change over 24 hours; forecast: the newest 0-24 h NWS window.
    snow = {}
    for r in _read_csv_tail(f"snotel/{month}.csv", 6000):
        k = r["resort"]
        try:
            dep = float(r["depth_in"]) if r["depth_in"] else None
        except ValueError:
            dep = None
        s = snow.setdefault(k, {"series": []})
        s["series"].append((r["obs_time_mst"], dep, r.get("temp_f")))
    for k, s in snow.items():
        ser = [x for x in s.pop("series") if x[1] is not None]
        if ser:
            last = ser[-1]
            day_ago = [x for x in ser if x[0] <= (datetime.fromisoformat(last[0]) - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M")]
            s.update({"obs": last[0], "depth_in": last[1], "temp_f": last[2],
                      "new24_in": max(0, last[1] - day_ago[-1][1]) if day_ago else None})
    fc = {}
    for r in _read_csv_tail(f"forecast/{month}.csv", 3000):
        if r.get("window") == "0-24h":
            fc[r["resort"]] = {k: r.get(k) for k in ("snapshot_time", "snow_in", "temp_min_f", "temp_max_f", "gust_max_mph")}
    # Crowd: the latest reading per mountain and source.
    crowd = {}
    for r in _read_csv_tail(f"crowd/{month}.csv", 2000):
        crowd.setdefault(r["resort"], {})[r["source"]] = {k: r.get(k) for k in ("snapshot_time", "value", "unit", "level", "detail")}
    # Model: the parts the page needs, plus one confidence number.
    m = _read_json("traffic_model.json", {}) or {}
    cov = m.get("coverage") or {}
    conf = round(sum(min(1, (c.get("n") or 0) / 6) for c in cov.values()) / len(cov), 3) if cov else 0
    model = {k: m.get(k) for k in ("updated", "first_day", "days_logged", "daily", "coverage", "key_windows", "conditions_seen",
                                   "holidays", "days", "day_types", "pass_blackouts", "graded", "slots", "generic")}
    model["confidence"] = conf
    model["routes"] = {rk: {"first_day": r.get("first_day"), "coverage": r.get("coverage")} for rk, r in (m.get("routes") or {}).items()}
    daily = _read_json("daily_predictions.json", {}) or {}
    # Sources: when each last ran, and errors in the last 48 hours.
    cut = (NOW - timedelta(hours=48)).isoformat()
    errs = {}
    for r in _read_csv_tail(f"errors/{month}.csv", 3000):
        if r.get("time", "") >= cut:
            src = (r.get("source") or "").split(":")[0]
            errs[src] = errs.get(src, 0) + 1
    sources = {"last_run": NOW_ISO, "forecast": state.get("forecast_last"), "outlook": state.get("outlook_last"),
               "tomtom_flow": state.get("tomtom_flow_last"), "tomtom_routing": state.get("tomtom_routing_last"),
               "cameras": state.get("cameras_last"), "traffic_model": state.get("traffic_model_last"),
               "snotel": max((state.get("snotel_last") or {}).values(), default=None), "crowd": state.get("tomtom_crowd_last"),
               "tomtom_use": state.get("tomtom_use"), "tomtom_caps": TOMTOM_CAPS, "errors_48h": errs, "crowd_sources": CROWD_SOURCES}
    # Files: this month's size for each logged folder, plus the top-level JSON.
    files = []
    for name in sorted(os.listdir(DATA)):
        p = os.path.join(DATA, name)
        if os.path.isdir(p):
            cur = [f for f in os.listdir(p) if f.startswith(month) and os.path.isfile(os.path.join(p, f))]
            if cur:
                files.append({"path": f"{name}/{cur[0]}", "bytes": os.path.getsize(os.path.join(p, cur[0]))})
        elif name.endswith(".json") and name != "dashboard.json":
            files.append({"path": name, "bytes": os.path.getsize(p)})
    events = [e for e in (state.get("events") or {}).values()
              if e.get("class") in ("roadClosures", "chainLaws") or re.search(r"road closed", e.get("title", ""), re.I)]
    events = [{k: e.get(k) for k in ("class", "route", "title", "began", "mp_start", "mp_end", "lat", "lon", "type")} for e in events]
    # Road conditions: the latest CDOT report for each segment (the log only records changes, so read back two months).
    conds = {}
    prev_month = (NOW.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    for mo in (prev_month, month):
        for r in _read_csv_tail(f"road_conditions/{mo}.csv", 4000):
            conds[r["segment_id"]] = {"route": r["route"], "area": r["area"], "mp_start": r["start_mp"], "mp_end": r["end_mp"],
                                      "condition": r["condition"], "at": r["observed_at"]}
    try:
        stretches = i70_stretches()
    except Exception as e:
        log_error("dashboard:i70_stretches", str(e))
        stretches = {}
    dash = {"updated": NOW_ISO, "today": NOW.date().isoformat(), "roads": roads, "i70": i70, "i70_stretches": stretches,
            "status": _read_json("resort_status.json", {}), "snow": snow, "forecast24": fc, "outlook": _read_json("outlook.json", {}),
            "recent": _read_json("recent.json", {}), "crowd": crowd, "model": model, "daily_predictions": daily,
            "weekend_predictions": _read_json("traffic_predictions.json", {}), "events": events, "conditions": list(conds.values()), "sources": sources, "files": files}
    with open(os.path.join(DATA, "dashboard.json"), "w") as f:
        json.dump(dash, f, separators=(",", ":"))
    return f"{os.path.getsize(os.path.join(DATA, 'dashboard.json')) // 1024} KB"


def main():
    state = load_state()
    STATE_REF.clear()
    STATE_REF.update(state)
    state = STATE_REF
    jobs = [("snotel", log_snotel), ("forecast", log_forecast), ("afd", log_afd),
            ("events", log_events), ("cdot", log_cdot), ("resort_status", log_resort_status),
            ("routes", log_routes), ("plows", log_plows), ("cameras", log_cameras), ("outlook", log_outlook), ("traffic_model", log_traffic_model), ("recent", log_recent),
            ("crowd", log_crowd), ("crowd_cams", log_crowd_cams), ("daily_predictions", log_daily_predictions), ("dashboard", build_dashboard)]
    for name, fn in jobs:
        try:
            print(f"{name}: {fn(state)}")
        except Exception as e:
            log_error(name, f"{e} | {traceback.format_exc(limit=2)}")
    state["last_run"] = NOW_ISO
    save_state(state)


if __name__ == "__main__":
    main()
