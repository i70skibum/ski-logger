(() => {
"use strict";
// ---- Where the data lives ---------------------------------------------------------------------------
const host = location.hostname, owner = host.endsWith(".github.io") ? host.split(".")[0] : "i70skibum";
const repo = (host.endsWith(".github.io") && location.pathname.split("/")[1]) || "ski-logger";
const BASE = `https://raw.githubusercontent.com/${owner}/${repo}/main/data/`;
const REPO_URL = `https://github.com/${owner}/${repo}`;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => v == null || v === "" || isNaN(+v) ? null : +v;
const r1 = v => Math.round(v * 10) / 10;
const store = { get(k, d) { try { const v = localStorage.getItem("v2-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("v2-" + k, JSON.stringify(v)); } catch (e) {} } };

// ---- Settings ---------------------------------------------------------------------------------------
const S = Object.assign({ flip: 11, season: "auto", passes: { ikon: true, epic: false, indy: false, overnight: false },
  alerts: { powder: true, powderIn: 6, home: true, closures: true, morning: false, channel: "push" } }, store.get("settings", {}));
const saveSettings = () => store.set("settings", S);

// ---- Time in Denver -----------------------------------------------------------------------------------
const TZ = "America/Denver";
const parts = d => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
  .formatToParts(d).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
const nowParts = () => { const p = parts(new Date()); return { iso: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24, minute: +p.minute }; };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pyDow = iso => (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7;     // Monday 0, like the logger
const dayShort = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", day: "numeric" });
const dayLong = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
const dayMed = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const clock = h => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), m = Math.round((h - hh) * 60); return `${hh % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${hh < 12 ? "AM" : "PM"}`; };
const clockS = h => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
const hm = m => { m = Math.max(1, Math.round(m)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) : "";
const fmtDayTime = iso => iso ? new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" }) : "";

// ---- One system: colors -----------------------------------------------------------------------------
// Traffic: share of the trip lost to traffic. Under 12% green, 12 to 30% amber, over 30% red.
const tone = p => p == null ? "n" : p < 0.12 ? "g" : p <= 0.30 ? "a" : "r";
const TONE = { g: "#3DD68C", a: "#F5B841", r: "#E8584A", n: "#3A5266" };
const TONE_T = { g: "#5BE3A1", a: "#FFC566", r: "#FF8A7F", n: "#9FB2C1" };
const WORD = { g: "Light", a: "Busy", r: "Heavy", n: "No data" };
const snowBg = n => n >= 6 ? "#3D8FCC" : n >= 3 ? "#2A6A99" : n >= 1 ? "#1F4A6B" : "#1A2A38";
const meter = (lvl, est) => `<span class="meter" title="${lvl ? "Crowd " + lvl + " of 4" + (est ? " (estimate)" : "") : "No crowd reading"}">${[1, 2, 3, 4].map(i => `<i class="${lvl && i <= lvl ? "on" : ""}"></i>`).join("")}</span>`;
const CROWD_WORD = ["No reading", "Light", "Busy", "Packed", "Slammed"];

// ---- Mountains --------------------------------------------------------------------------------------
const BAND_KEYS = ["i25_golden", "golden_us6", "us6_floyd", "floyd_idaho", "idaho_empire", "empire_georgetown", "georgetown_216", "x216_silverthorne", "silverthorne_copper"];
const MTS = {
  copper: { name: "Copper", short: "Copper", route: "I-70", way: "I-70", base: 90, bands: 9, seg: null, lat: 39.5022, lon: -106.1497, open: [9, 9], close: 16, events: [["I70", 195, 262]] },
  abasin: { name: "A-Basin", short: "A-Basin", route: "Loveland Pass", way: "Loveland Pass", base: 90, bands: 7, seg: ["pass", "x216>abasin"], lat: 39.6423, lon: -105.8717, open: [9, 8.5], close: 16, events: [["I70", 216, 262], ["US6", 216, 230]] },
  winterpark: { name: "Winter Park", short: "W. Park", route: "Berthoud", way: "Berthoud Pass", base: 96, bands: 5, seg: ["berthoud", "empire>winterpark"], lat: 39.8868, lon: -105.7625, open: [8.5, 8.5], close: 16, events: [["I70", 232, 262], ["US40", 231, 259]] },
  eldora: { name: "Eldora", short: "Eldora", route: "Nederland", way: "Boulder Canyon", base: 66, bands: 0, seg: null, eldora: true, lat: 39.9372, lon: -105.5827, open: [8.5, 8.5], close: 16, events: [["CO119", 25, 42]] },
};
const MKEYS = Object.keys(MTS);
// Winter Park opens at 8 on weekends from Dec 5 to Apr 4 this season.
const liftOpen = (k, iso) => { const M = MTS[k], we = pyDow(iso) >= 5 || isOffDay(iso); if (k === "winterpark" && we && iso >= "2026-12-05" && iso <= "2027-04-04") return 8; return M.open[we ? 1 : 0]; };

let D = null, MAP = null;
const PREV = { snap: store.get("snap", null), data: store.get("dataSnap", null) };
const UI = { dest: null, win: null, compare: false, mapMode: store.get("mapMode", "line"), tab: "today", dir: null, selHour: null, openM: store.get("openM", "copper"), weekDay: null, weekDir: "W", crowdM: null, histDay: null, histDir: "W", histM: "copper",
  closed: new Set(store.get("closed", [])) };

// ---- Model helpers ----------------------------------------------------------------------------------
const dayInfo = iso => ((D.model.days || {})[iso]) || { type: "typical", tags: [] };
const isOffDay = iso => D && ["holiday", "break"].includes(dayInfo(iso).type);
const dayTags = iso => dayInfo(iso).tags || [];
function liftFor(iso) {
  const t = dayInfo(iso).type; if (t === "typical") return 1;
  const dt = (D.model.day_types || {})[t] || {}; return dt.lift || (t === "holiday" || t === "break" ? 1.4 : 1);
}
// Expected I-70 delay to Copper (minutes) at one hour: the typical profile for the weekday, else the generic pattern, scaled for special days.
function expected(iso, dir, h) {
  const slots = D.model.slots || {}, dow = pyDow(iso), hh = String(h).padStart(2, "0");
  const got = [`${dow}-${hh}00-${dir}`, `${dow}-${hh}30-${dir}`].map(k => slots[k]).filter(Boolean);
  const gen = (((D.model.generic || {})[dir] || {})[dow] || {});
  const v = got.length ? got.reduce((a, x) => a + x.median, 0) / got.length : (gen[h] || 0);
  return r1(v * liftFor(iso));
}
const loggedDay = iso => ((D.recent || {}).days || {})[iso] || null;
function loggedAt(day, dir, h, rk) {
  if (!day) return null;
  const c = rk ? (((day.routes || {})[rk] || {})[dir] || {})[h] : ((day.i70 || {})[dir] || {})[h];
  return c && c.n >= 2 ? c.mean : null;
}
// Best time to leave: the latest hour before the road gets more than halfway from the quietest hour to the worst.
function bestLeave(byHour) {
  const hs = Object.keys(byHour).map(Number).sort((a, b) => a - b); if (!hs.length) return null;
  const vs = hs.map(h => byHour[h]), q = Math.min(...vs), w = Math.max(...vs);
  if (w - q < 2) return hs[vs.indexOf(q)];
  const first = hs.find(h => byHour[h] > q + (w - q) / 2); return Math.max(hs[0], first - 1);
}
function dayProfile(iso) {
  const up = {}, home = {}; for (let h = 5; h < 11; h++) up[h] = expected(iso, "W", h); for (let h = 11; h < 19; h++) home[h] = expected(iso, "E", h);
  const upPeak = Math.max(...Object.values(up)), homePeak = Math.max(...Object.values(home));
  const homeBad = Object.keys(home).map(Number).filter(h => home[h] >= 15);
  return { up, home, upPeak, homePeak, leaveH: upPeak >= 10 ? bestLeave(up) : null,
    leave: upPeak >= 10 ? `Leave by ${clock(bestLeave(up))}` : "No rush going up",
    homeLine: homeBad.length ? `Home by ${clock(homeBad[0])} or after ${clock(homeBad[homeBad.length - 1] + 1)}` : "No rush coming home" };
}

// ---- Roads now ----------------------------------------------------------------------------------------
const band = (key, dir) => ((D.i70_stretches || {})[key] || {})[dir] || null;
const segOf = (rk, key, dir) => { const r = (D.roads || {})[rk]; const x = r && r[dir]; return x ? (x.segs || []).find(s => s.key === key) || null : null; };
const stub = dir => segOf("canyon", "coors>i25i70", dir) || segOf("eldora_boulder", "coors>i25i70", dir);
function tripNow(k, dir) {
  const M = MTS[k];
  if (M.eldora) { const r = ((D.roads || {}).eldora_boulder || {})[dir] || ((D.roads || {}).eldora_boulder || {}).W; if (!r) return { minutes: M.base, delay: 0, pct: 0, nodata: true };
    return { minutes: r.minutes, delay: Math.max(0, r.delay_min || 0), pct: (r.delay_min || 0) / (r.free_min || M.base) }; }
  let delay = 0, have = 0; const st = stub(dir); if (st) delay += Math.max(0, st.delay_min || 0);
  BAND_KEYS.slice(0, M.bands).forEach(b => { const x = band(b, dir); if (x) { delay += x.delay_min || 0; have++; } });
  if (M.seg) { const s = segOf(M.seg[0], M.seg[1], dir); if (s) delay += Math.max(0, s.delay_min || 0); }
  return { minutes: M.base + delay, delay: r1(delay), pct: delay / M.base, nodata: !have };
}
const EV_ROUTE = r => String(r || "").replace(/[\s-]/g, "").toUpperCase();
const overlaps = (a, b, c, d) => a != null && b != null && Math.max(Math.min(a, b), c) <= Math.min(Math.max(a, b), d);
const started = e => !e.began || Date.parse(e.began) <= Date.now();
const closures = () => (D.events || []).filter(e => started(e) && (e.class === "roadClosures" || /road closed/i.test(e.title || "")));
const plannedClosures = () => { const seen = new Set(); return (D.events || []).filter(e => !started(e) && (e.class === "roadClosures" || /road closed/i.test(e.title || ""))).filter(e => { const k = e.title + e.began; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => Date.parse(a.began) - Date.parse(b.began)); };
function closedFor(k, dir) {
  const want = dir === "W" ? /westbound|both/i : /eastbound|both/i;
  return closures().filter(e => MTS[k].events.some(([rt, a, b]) => EV_ROUTE(e.route) === rt && overlaps(num(e.mp_start), num(e.mp_end), a, b)) && (EV_ROUTE(e.route) !== "I70" || want.test(e.title || "")));
}
const tractionFor = k => (D.events || []).filter(e => started(e) && e.class === "chainLaws" && !/commercial/i.test(e.title || "") && MTS[k].events.some(([rt, a, b]) => EV_ROUTE(e.route) === rt && overlaps(num(e.mp_start), num(e.mp_end), a, b)));

// ---- Snow and status ------------------------------------------------------------------------------------
const snowOf = k => { const s = (D.snow || {})[k] || {}, f = (D.forecast24 || {})[k] || {};
  return { new24: num(s.new24_in) || 0, depth: num(s.depth_in), temp: num(s.temp_f), fc24: num(f.snow_in) || 0, gust: num(f.gust_max_mph), tmin: num(f.temp_min_f), tmax: num(f.temp_max_f) }; };
// People counted in a base-area webcam frame (latest, if from the last 2 hours).
const CAMS_FOR_CROWD = ["abasin"];
const camOf = k => { const c = ((D.crowd || {})[k] || {})["camera:base"]; if (!c) return null; return (Date.now() - Date.parse(c.snapshot_time)) / 36e5 > 2 ? null : { n: num(c.value), at: c.snapshot_time }; };
const statusOf = k => (((D.status || {}).resorts) || {})[k] || {};
const isOpen = k => statusOf(k).open !== false;
const crowdOf = k => { const c = ((D.crowd || {})[k] || {}).last_mile; if (!c) return null; const age = (Date.now() - Date.parse(c.snapshot_time)) / 36e5;
  return age > 3 ? null : { level: num(c.level), ratio: num(c.value), at: c.snapshot_time }; };
function quality(s) {
  if (s.new24 + s.fc24 < 1) return "Old snow";
  const cold = s.tmax != null && s.tmax <= 30 ? "cold and light" : s.tmax != null && s.tmax >= 36 ? "warm and heavy" : "medium density";
  return `${cold[0].toUpperCase() + cold.slice(1)}${s.tmin != null ? `, ${Math.round(s.tmin)} to ${Math.round(s.tmax)}°F` : ""}${s.gust >= 40 ? `; gusts ${Math.round(s.gust)} may scour` : ""}`;
}

// ---- Scoring: one set of weights, shown factor by factor ---------------------------------------------------
function scoreNow(k, dir) {
  const s = snowOf(k), t = tripNow(k, "W"), cl = closedFor(k, "W").length > 0, cr = crowdOf(k);
  const f = { snow: Math.min(40, (s.new24 + 0.5 * s.fc24) >= 1 ? 6 * (s.new24 + 0.5 * s.fc24) : 0), drive: -Math.min(15, t.delay * 0.5),
    wind: -Math.min(20, Math.max(0, (s.gust || 0) - 35)), roads: -(s.fc24 >= 6 ? 6 : s.fc24 >= 3 ? 3 : 0) - (tractionFor(k).length ? 3 : 0),
    closure: cl ? -40 : 0, crowd: cr && cr.level ? -(cr.level - 1) * 3 : 0 };
  const score = Math.max(0, Math.min(100, Math.round(50 + Object.values(f).reduce((a, b) => a + b, 0))));
  return { k, score, f, s, t, closed: cl, crowd: cr };
}
const ranked = () => MKEYS.filter(isOpen).map(k => scoreNow(k)).sort((a, b) => b.score - a.score || a.t.minutes - b.t.minutes);

// ---- The verdict ---------------------------------------------------------------------------------------
function verdictNow() {
  const { iso, hour } = nowParts(), dow = pyDow(iso), morning = hour < S.flip, info = dayInfo(iso);
  const weekend = dow >= 5 || (dow === 4 && hour >= 12), offDay = isOffDay(iso), busy = weekend || offDay, R = ranked(), top = R[0];
  if (!top) return { level: "n", line: "Nothing's open yet.", why: "None of your mountains are open.", top: null };
  const up = tripNow("copper", "W").delay, home = tripNow("copper", "E").delay, prof = dayProfile(iso);
  const shutW = closedFor("copper", "W"), shutE = closedFor("copper", "E"), canyon = !!((D.roads || {}).canyon || {}).closed;
  const tags = info.tags || [], texas = tags.some(t => /Texas/.test(t));
  const easeAfter = (byHour, from, lim) => Object.keys(byHour).map(Number).filter(h => h > from && byHour[h] < lim)[0];
  const out = (level, line, why) => ({ level, line, why, top, prof });
  if (morning && shutW.length && canyon) return out("r", "Keep your ass at home.", "I-70 westbound is closed and so is Clear Creek Canyon. There's no way up right now.");
  if (morning && shutW.length) return out("r", "Canyon or couch.", "I-70 westbound is closed. Clear Creek Canyon is open, so it's US 6 or nothing.");
  if (!morning && busy && shutE.length) return out("r", "Order another round.", "I-70 eastbound is closed. Nobody's getting back to Denver for a while.");
  if (morning && up >= 40) return out("r", `Keep your ass at home until traffic breaks around ${clock(Math.max(hour + 2, easeAfter(prof.up, hour, 10) || 12))}.`, `I-70 westbound is already ${Math.round(up)} minutes slow to Copper.`);
  if (!morning && busy && home >= 30) return out("a", `Après until ${clock(easeAfter(prof.home, hour, 15) || 19)} or sit in it.`, `I-70 eastbound is ${Math.round(home)} minutes slow and it usually loosens up around then.`);
  if (morning && up >= 20) return out("a", "Go now or go after lunch.", `I-70 westbound is ${Math.round(up)} minutes slow and it's still building.`);
  const snowyRoads = tractionFor(top.k).length > 0;
  if (top.s.new24 >= 6 && snowyRoads) return out("g", "Powder day. Drive like your skis depend on it.", `${top.s.new24}" new at ${MTS[top.k].name}, but the roads are snowy.`);
  if (top.s.new24 >= 6) return out("g", "Clear roads, deep snow. Full send.", `${top.s.new24}" new at ${MTS[top.k].name} and I-70 is moving.`);
  if (top.s.fc24 >= 6) return out("a", "It's about to dump. Plan to leave early.", `${top.s.fc24}" forecast at ${MTS[top.k].name} in the next 24 hours.`);
  if (morning && offDay && hour >= 7 && up < 12) return out("g", "Roads are empty. Go now.", tags.join(". "));
  if (morning && offDay) return out("a", prof.leave === "No rush going up" ? "Everybody's off, but the roads should be fine." : `${texas ? "Half of Texas is on I-70" : "Everybody's off this week"}. ${prof.leave} or keep your ass at home.`, tags.join(". "));
  if (!busy && top.s.new24 >= 3) return out("g", "Fresh snow on a weekday. Call in sick.", `${top.s.new24}" new at ${MTS[top.k].name} and nobody else is up there.`);
  if (!busy) return out("g", "Empty roads, empty lifts.", "A regular weekday. Nothing to fight through.");
  return out("g", top.s.new24 >= 1 ? "Roads are fine. Go get it." : "Clear roads, old snow. Groomer day.", `${MTS[top.k].name} is the pick.` + (morning ? ` ${prof.leave === "No rush going up" ? "No rush heading up." : prof.leave + " to beat the usual rush."}` : ""));
}

// ---- Week: score each mountain each day ---------------------------------------------------------------------
function weekDays() { const o = D.outlook || {}, { iso, hour } = nowParts(); return (o.days || []).filter(d => d > iso || (d === iso && hour < S.flip)).slice(0, 7); }
function dayScore(k, iso) {
  const days = ((D.outlook || {}).resorts || {})[k] || [], i = days.findIndex(d => d.date === iso), d = days[i], prev = days[i - 1];
  if (!d) return null;
  const before = prev ? prev.snow || 0 : snowOf(k).new24, during = d.snow || 0, fresh = before + 0.5 * during, prof = dayProfile(iso);
  const drivePeak = MTS[k].eldora ? 0 : prof.upPeak;
  const f = { snow: Math.min(40, fresh >= 1 ? 6 * fresh : 0), drive: -Math.min(15, drivePeak * 0.5), wind: -Math.min(20, Math.max(0, (d.gust || 0) - 35)),
    roads: -(before + during >= 6 ? 6 : before + during >= 3 ? 3 : 0), closure: 0, crowd: -(crowdEst(iso) - 1) * 3 };
  const score = Math.max(0, Math.min(100, Math.round(50 + Object.values(f).reduce((a, b) => a + b, 0))));
  const src = prev && before > during ? prev : d;
  return { k, iso, score, f, snow: before + during, during, before, gust: d.gust, lo: src.lo, hi: src.hi, mid: src.snow, rangeDay: src.date, n: src.n, agree: d.n >= 3 && d.hi - d.lo <= Math.max(2, 0.6 * (d.snow || 0)), drivePeak, tmin: d.tmin, tmax: d.tmax };
}
// Crowd forecast until the crowd log has a season: an estimate from how busy the drive up is expected to be.
const crowdEst = iso => { const p = dayProfile(iso).upPeak; return Math.min(4, 1 + (p >= 8) + (p >= 18) + (p >= 28)); };

// ---- Collapsible modules ------------------------------------------------------------------------------------
function mod(id, title, summary, body, opts = {}) {
  const closed = UI.closed.has(id);
  const head = opts.call
    ? `<button class="mhead" data-tog="${id}" aria-expanded="${!closed}"><span class="ttl" style="display:flex;flex-direction:column;gap:10px">${opts.kick}${title}</span><span class="pip k"></span></button>`
    : isPhone() ? `<button class="mhead" data-tog="${id}" aria-expanded="${!closed}"><span class="ttl"><span class="sg" style="display:block;font-size:20px;font-weight:600">${title}</span>${summary ? `<span class="sum">${summary}</span>` : ""}</span>${opts.right || ""}<span class="pip"></span></button>`
    : `<div class="mhead" style="align-items:center"><span class="ttl"><span class="sg" style="display:block;font-size:20px;font-weight:600">${title}</span></span>${opts.right || ""}</div>`;
  return `<section class="card${opts.cls ? " " + opts.cls : ""}${closed ? " closed" : ""}" id="m-${id}" aria-label="${esc(opts.label || id)}">${head}<div class="mbody">${body}</div></section>`;
}

// ---- Bars --------------------------------------------------------------------------------------------------
function barsHTML(vals, { H = 90, base = 90, nowH = -1, sel = -1, logged = () => false, scale = 30, ticks } = {}) {
  const cells = vals.map((v, h) => { if (v == null) return `<i style="height:2px;background:#22364A" title="${clock(h)}: no data"></i>`;
    const t = tone(v / base), lg = logged(h); const ht = Math.max(3, Math.min(H, Math.round(v / scale * (H - 26))));
    return `<i data-h="${h}" class="${lg ? "" : "hatch"}" style="height:${ht}px;background:${TONE[t]};color:${TONE[t]};${h === sel ? "outline:2px solid #EAF1F6;outline-offset:1px;" : ""}" title="${clock(h)}: +${Math.round(v)} min${lg ? " (logged)" : " (forecast)"}"></i>`; }).join("");
  const now = nowH >= 0 ? `<span class="nowline" style="left:${(nowH + 0.5) / 24 * 100}%"></span><span class="nowtag" style="left:${(nowH + 0.5) / 24 * 100}%">Now</span>` : "";
  const ax = `<div class="axis"><span style="left:0">12a</span><span style="left:25%">6a</span><span style="left:50%">12p</span><span style="left:75%">6p</span><span style="left:100%">12a</span>${ticks || ""}</div>`;
  return `<div class="bars" style="height:${H}px;padding-top:20px">${cells}${now}</div>${ax}`;
}

// ---- The line map ---------------------------------------------------------------------------------------------
function lineMap(phone, dir) {
  const M = MAP, P = new Set(M.primary);
  const tfD = (x, y) => [x, y - 96], tfP = (x, y) => [10 + (y - 110) * 0.70, 40 + (1215 - x) * 0.50];
  const tf = phone ? tfP : tfD, k = phone ? 0.9 : 1, W = phone ? 340 : 1300, H = phone ? 672 : 480;
  const segTone = (rk, key) => { if (((D.roads || {})[rk] || {}).closed) return ["r", "closed"]; const s = segOf(rk, key, dir) || (rk.startsWith("eldora") ? segOf(rk, key, "W") : null);
    if (!s) return ["n", "no reading"]; const p = (s.delay_min || 0) / Math.max(1, s.free_min || 1); return [tone(p), (s.delay_min || 0) < 1 ? "normal" : `+${r1(s.delay_min)} min`]; };
  const bandTone = key => { const b = band(key, dir); if (!b) return ["n", "no reading"]; return [tone(b.pct), (b.delay_min || 0) < 1 ? "normal" : `+${r1(b.delay_min)} min`]; };
  const shutI70 = closures().filter(e => EV_ROUTE(e.route) === "I70" && (dir === "W" ? /westbound|both/i : /eastbound|both/i).test(e.title || ""));
  const out = [`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Line map of every route from Coors Field, ${dir === "W" ? "westbound" : "eastbound"}" style="display:block"><g fill="none" stroke-linecap="round" stroke-linejoin="round">`];
  const path = (x1, y1, x2, y2, name, t, w) => { const a = tf(x1, y1), b = tf(x2, y2);
    out.push(`<path d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}" stroke="${TONE[t[0]]}" stroke-width="${(w * k).toFixed(1)}"><title>${esc(name)}: ${esc(t[1])}</title></path>`); };
  M.alts.forEach(([x1, y1, x2, y2, name, rk, key]) => path(x1, y1, x2, y2, name, segTone(rk, key), P.has(name) ? 9 : 5));
  const mpOf = { i25_golden: [266, 276], golden_us6: [260, 266], us6_floyd: [244, 260], floyd_idaho: [240, 244], idaho_empire: [232, 240], empire_georgetown: [228, 232], georgetown_216: [216, 228], x216_silverthorne: [205, 216], silverthorne_copper: [195, 205] };
  M.i70.forEach(([x1, y1, x2, y2, name, key]) => { const sh = shutI70.some(e => overlaps(num(e.mp_start), num(e.mp_end), ...mpOf[key])); path(x1, y1, x2, y2, name, sh ? ["r", "closed"] : bandTone(key), P.has(name) ? 9 : 5); });
  out.push(`</g><g fill="#0E1A24" stroke="#EAF1F6">`);
  M.stops.forEach(([x, y, t]) => { const p = tf(x, y), r = (t === 1 ? 8 : t === 2 ? 6 : 3.6) * k; out.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${r.toFixed(1)}" stroke-width="${2 * k}"></circle>`); });
  out.push(`</g><g>`);
  const fs = { 0: 13, 1: 11.5, 2: 11.5, 3: 11 }, fill = { 0: "#EAF1F6", 1: "#9FB2C1", 2: "#C9D6E0", 3: "#9FB2C1" };
  const txt = (x, y, t, tier, an, rot) => out.push(`<text x="${x.toFixed ? x.toFixed(1) : x}" y="${y.toFixed ? y.toFixed(1) : y}" text-anchor="${an}" font-size="${phone && tier === 3 ? 10.5 : fs[tier]}" fill="${fill[tier]}"${tier === 0 ? ' font-weight="600"' : tier === 3 ? ' font-style="italic"' : ""}${rot ? ` transform="rotate(-90 ${x} ${y})"` : ""}>${esc(t)}</text>`);
  if (phone) M.phoneLabels.forEach(([x, y, t, tier, an, rot]) => txt(x, y, t, tier, an, rot));
  else M.labels.forEach(([x, y, t, tier, dx, dy, an]) => { const q = tfD(x + dx, y + dy); txt(q[0], q[1], t, tier, an, 0); });
  out.push(`</g>`);
  const best = dest();
  (phone ? Object.entries(M.phoneDest).map(([kk, p]) => [kk, p[0], p[1]]) : M.dest.map(([kk, x, y]) => [kk, ...tfD(x, y)])).forEach(([kk, cx, cy]) => {
    const t = tripNow(kk, dir), lab = MTS[kk].name, tm = hm(t.minutes), wbox = 26 + 7.4 * lab.length + 8 * tm.length, on = kk === best;
    out.push(`<g><rect x="${(cx - wbox / 2).toFixed(1)}" y="${(cy - 14).toFixed(1)}" width="${wbox.toFixed(1)}" height="28" rx="14" fill="#15232F" stroke="${on ? "#7FD1FF" : "#3A5266"}" stroke-width="${on ? 2 : 1}"></rect>` +
      `<text x="${(cx - wbox / 2 + 12).toFixed(1)}" y="${(cy + 4.5).toFixed(1)}" font-size="13" font-weight="600" fill="#EAF1F6">${esc(lab)} <tspan fill="${TONE_T[tone(t.pct)]}" font-weight="500">${tm}</tspan></text></g>`);
  });
  out.push(`</svg>`);
  return out.join("");
}

// ---- The real map: the same stretches and the same colors as the line map, on a street map ----------------------
let LMAP = null, LEAFLET = null;
function loadLeaflet() {
  if (LEAFLET) return LEAFLET;
  LEAFLET = new Promise((ok, no) => { const c = document.createElement("link"); c.rel = "stylesheet"; c.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css"; document.head.append(c);
    const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"; s.onload = ok; s.onerror = no; document.head.append(s); });
  return LEAFLET;
}
async function drawRealMap() {
  const box = $("realmap"); if (LMAP) { LMAP.remove(); LMAP = null; } if (!box) return;
  try { await loadLeaflet(); } catch (e) { box.innerHTML = `<p class="small muted" style="padding:16px">The map couldn't load. The line map has the same information.</p>`; return; }
  if (!$("realmap")) return;
  const dir = curDir(), G = GEO, touchy = matchMedia("(pointer: coarse)").matches;
  LMAP = L.map("realmap", { scrollWheelZoom: false, dragging: !touchy, tap: false, zoomControl: true, attributionControl: true });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 13, className: "darktiles", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(LMAP);
  if (touchy) { const c = LMAP.getContainer(); c.addEventListener("touchstart", ev => { ev.touches.length > 1 ? LMAP.dragging.enable() : LMAP.dragging.disable(); }, { passive: true }); }
  const shutI70 = closures().filter(e => EV_ROUTE(e.route) === "I70" && (dir === "W" ? /westbound|both/i : /eastbound|both/i).test(e.title || ""));
  const mpOf = { i25_golden: [266, 276], golden_us6: [260, 266], us6_floyd: [244, 260], floyd_idaho: [240, 244], idaho_empire: [232, 240], empire_georgetown: [228, 232], georgetown_216: [216, 228], x216_silverthorne: [205, 216], silverthorne_copper: [195, 205] };
  const line = (pts, t, tip, w) => L.polyline(pts, { color: TONE[t], weight: w, opacity: 0.95 }).bindTooltip(tip, { sticky: true }).addTo(LMAP);
  Object.entries(G.alts).forEach(([k, pts]) => { const [rk, key] = k.split("|"); const s = segOf(rk, key, dir) || (rk.startsWith("eldora") ? segOf(rk, key, "W") : null), closed = ((D.roads || {})[rk] || {}).closed;
    const t = closed ? "r" : s ? tone((s.delay_min || 0) / Math.max(1, s.free_min || 1)) : "n"; line(pts, t, `${esc(((D.roads || {})[rk] || {}).name || rk)}: ${closed ? "closed" : s ? ((s.delay_min || 0) < 1 ? "normal" : "+" + r1(s.delay_min) + " min") : "no reading"}`, 4); });
  Object.entries(G.bands).forEach(([key, lines]) => { const b = band(key, dir), sh = shutI70.some(e => overlaps(num(e.mp_start), num(e.mp_end), ...mpOf[key])), t = sh ? "r" : b ? tone(b.pct) : "n";
    lines.forEach(pts => line(pts, t, `I-70 ${dir === "W" ? "westbound" : "eastbound"}: ${sh ? "closed" : b ? ((b.delay_min || 0) < 1 ? "normal" : "+" + r1(b.delay_min) + " min") : "no reading"}`, 6)); });
  const best = dest();
  Object.entries(G.pins).forEach(([k, p]) => { const nm = k === "coors" ? "Coors Field" : MTS[k].name, t = k === "coors" ? null : tripNow(k, dir);
    L.circleMarker(p, { radius: k === "coors" ? 6 : 7, color: k === best ? "#7FD1FF" : "#EAF1F6", weight: 2, fillColor: "#0E1A24", fillOpacity: 1 }).addTo(LMAP)
      .bindTooltip(t ? `${nm} ${hm(t.minutes)}` : nm, { permanent: true, direction: k === "coors" ? "right" : "top", className: "pinlab" }); });
  LMAP.fitBounds(L.latLngBounds(Object.values(G.pins)).pad(0.06));
}

// ---- Today ---------------------------------------------------------------------------------------------------
// Built from the approved boards (Today · Phone, Today · Desktop). Markup and spacing follow the mockups.
const isPhone = () => matchMedia("(max-width: 899px)").matches;
const curDir = () => UI.dir || (nowParts().hour < S.flip ? "W" : "E");
// Your destination: what you picked this visit, else the page's best pick.
const dest = () => { const R = ranked(); return UI.dest && isOpen(UI.dest) ? UI.dest : (R[0] || {}).k || "copper"; };
const passLabel = () => [["ikon", "Ikon"], ["epic", "Epic"], ["indy", "Indy"]].filter(([k]) => S.passes[k]).map(x => x[1]).join(", ") || "No pass";
const seasonWord = iso => { const m = +iso.slice(5, 7), d = +iso.slice(8, 10); return m >= 5 && m <= 10 ? "off-season" : (m === 11 || (m === 12 && d < 15)) ? "early season" : m >= 3 && m <= 4 ? "spring" : "midwinter"; };
const PIP = (cls = "") => `<span class="pip${cls ? " " + cls : ""}" aria-hidden="true"></span>`;
const HEADBTN = `display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:0;border:0;background:none;color:#EAF1F6;font:inherit;text-align:left;cursor:pointer`;
const TXT_T = t => TONE_T[t] || "#9FB2C1";
const plusMin = d => d < 1 ? "+0" : "+" + Math.round(d);

// Road surface along a mountain's route, from CDOT's latest reports.
function roadCond(k) {
  const rows = (D.conditions || []).filter(c => MTS[k].events.some(([rt, a, b]) => EV_ROUTE(c.route) === rt && overlaps(num(c.mp_start), num(c.mp_end), a, b)));
  if (!rows.length) return null;
  const txt = rows.map(c => (c.condition || "").toLowerCase()).join(" ");
  return /snow/.test(txt) ? "Snowy" : /ic[ey]/.test(txt) ? "Icy" : /wet|rain/.test(txt) ? "Wet" : /dry/.test(txt) ? "Dry" : null;
}
const liftsDelta = k => { const a = ((PREV.snap || {}).lifts || {})[k], b = statusOf(k).lifts; if (!a || !b) return 0; return (parseInt(b) || 0) - (parseInt(a) || 0); };
// Flags for one mountain, in the mockup's chip styles.
function flagChips(r, { crowd = true, short = false } = {}) {
  const k = r.k, s = r.s, out = [], cr = r.crowd, { iso } = nowParts();
  if (crowd) out.push(`<span class="chip" style="border-color:#4A4682;color:#C1B6FF">Crowd ${cr && cr.level ? CROWD_WORD[cr.level].toLowerCase() : "no reading"}</span>`);
  if (s.gust >= 35) out.push(`<span class="chip" style="${s.gust >= 50 ? "border-color:#7A3A35;color:#FF8A7F" : "border-color:#7A6A35;color:#FFC566"}">Gusts ${Math.round(s.gust)}${short ? "" : " mph"}</span>`);
  const rc = roadCond(k); if (rc) out.push(`<span class="chip"${rc === "Snowy" || rc === "Icy" ? ' style="border-color:#7A6A35;color:#FFC566"' : ""}>${rc}${short ? "" : " roads"}</span>`);
  if (tractionFor(k).length) out.push(`<span class="chip" style="border-color:#7A6A35;color:#FFC566">Traction law</span>`);
  if (r.closed) out.push(`<span class="chip" style="border-color:#7A3A35;color:#FF8A7F">Closure on the way</span>`);
  if (k === "abasin") out.push(`<span class="chip">${iso >= "2027-01-02" && iso <= "2027-05-02" ? (pyDow(iso) >= 5 ? "Parking reservation required" : "No reservation needed today") : "No parking reservation until Jan 2"}</span>`);
  return out.join(" ");
}
const meterBig = (lvl, w = 10, h = 16) => `<span style="display:inline-flex;gap:2px;vertical-align:middle" aria-hidden="true">${[1, 2, 3, 4].map(i => `<span style="width:${w}px;height:${h}px;border-radius:2px;background:${lvl && i <= lvl ? "#8C7FE0" : "#2C3554"}"></span>`).join("")}</span>`;

// Drive by departure hour to one mountain: logged so far today, then the forecast.
function hourly(k, iso, dir, hour) {
  const M = MTS[k], day = loggedDay(iso), share = M.eldora ? 0 : M.bands / 9, vals = [], logged = [];
  const nowDelay = tripNow(k, dir).delay;
  for (let h = 0; h < 24; h++) {
    if (M.eldora) { const l = loggedAt(day, dir, h, "eldora_boulder"); logged.push(h < hour && l != null); vals.push(h < hour && l != null ? l : nowDelay); continue; }
    const l = loggedAt(day, dir, h); logged.push(h < hour && l != null); vals.push(r1((h < hour && l != null ? l : expected(iso, dir, h)) * share));
  }
  return { vals, logged, base: M.base };
}
// Hours ahead that sit within 2 minutes of the best (or worst), as one contiguous range from the best (or worst) hour.
function rangeAt(vals, hrs, pick, hour) {
  if (!hrs.length) return null;
  const target = pick === "min" ? Math.min(...hrs.map(h => vals[h])) : Math.max(...hrs.map(h => vals[h]));
  const near = h => Math.abs(vals[h] - target) <= 2;
  const start = hrs.find(near); let end = start; while (hrs.includes(end + 1) && near(end + 1)) end++;
  const a = start === hour ? "Now" : clock(start).replace(" AM", start < 12 && end >= 12 ? " AM" : "").replace(" PM", "");
  const lbl = start === end ? (start === hour ? "Now" : clock(start)) : end >= 23 ? `After ${start === hour ? "now" : clock(start).replace("12 PM", "noon")}` : `${start === hour ? "Now" : a}–${clock(end + 1)}`;
  return { start, end, val: target, lbl: lbl.replace(/^(\d+)–(\d+) (AM|PM)$/, "$1–$2 $3") };
}
const WINS = [["Early", 5, 8], ["Morning", 8, 11], ["Midday", 11, 14], ["Afternoon", 14, 17], ["Evening", 17, 20]];
const winOf = h => { const i = WINS.findIndex(([, a, b]) => h >= a && h < b); return i < 0 ? (h < 5 ? 0 : 4) : i; };
const winLbl = (w, full) => `${w[0]}${full ? ` ${w[1] % 12 || 12}–${w[2] % 12 || 12}` : ""}`;

function renderToday() {
  const { iso, hour } = nowParts(), v = verdictNow(), dir = curDir(), R = ranked(), phone = isPhone();
  const offSeason = S.season === "off" || (S.season === "auto" && !MKEYS.some(isOpen));
  if (offSeason) return `<section class="card" style="background:#13283A;border-color:#2B5573"><span class="kick" style="color:#7FD1FF">Off-season</span><h1 class="sg" style="margin:0;font-size:28px;line-height:1.1;font-weight:700">The lifts are closed. See you next winter.</h1><p style="margin:0;color:#9FB2C1">The logger keeps running, so the traffic model keeps learning. Switch modes in settings.</p></section>`;
  const call = renderCall(iso, hour, v, dir, phone), news = renderNews(phone), roads = renderRoads(dir, phone), plan = renderPlanner(iso, dir, hour, phone), mts = renderMountains(R, dir, phone);
  const foot = `<footer style="font-size:12px;color:#9FB2C1;padding:4px 4px 0">Updated ${fmtTime(D.updated)}, next about ${fmtTime(new Date(Date.parse(D.updated) + 15 * 6e4).toISOString())}. Sources: CDOT COtrip, TomTom, USDA SNOTEL, NWS and 4 models, resort lift reports. <a href="#data">About this dashboard</a></footer>`;
  if (phone) return `${call}${news}${roads}${plan}${mts}${foot}`;
  return `<div style="display:grid;grid-template-columns:minmax(0,1.29fr) minmax(0,1fr);gap:20px;align-items:stretch">${call}${news}</div>${roads}${plan}${mts}${foot}`;
}

function renderCall(iso, hour, v, dir, phone) {
  const info = dayInfo(iso), k = dest(), M = MTS[k], t = tripNow(k, dir), cr = crowdOf(k);
  const kickTxt = `${info.type !== "typical" ? (info.tags[0] || info.type).replace(/[:;(].*$/, "") + " " : ""}${dayLong(iso)} · ${dir === "W" ? "Going up" : "Heading home"}`;
  // Leave: now, or the best hour ahead in this direction's window; the line under it says how long it stays clear.
  const H = hourly(k, iso, dir, hour), win = [...Array(24).keys()].filter(h => h >= hour && (dir === "W" ? h < S.flip : h < 20));
  const green = h => tone(H.vals[h] / H.base) === "g";
  let leave = "Now", leaveSub = "";
  if (v.prof && dir === "W" && v.prof.leaveH != null && v.prof.leaveH > hour) { leave = clock(v.prof.leaveH); leaveSub = "before the rush"; }
  else if (win.length && green(hour)) { const bad = win.find(h => !green(h)); leaveSub = bad != null ? `clear until ${clock(bad)}` : dir === "W" ? "clear all morning" : "clear all evening"; }
  else if (win.length) { const ok = win.find(h => green(h)); if (ok != null) { leave = clock(ok); leaveSub = `${plusMin(t.delay)} min if you go now`; } else leaveSub = `${plusMin(t.delay)} min now`; }
  // What the road has done so far in this direction today (logged).
  const day = loggedDay(iso), from = dir === "W" ? 5 : S.flip, seen = [];
  for (let h = from; h < hour; h++) { const l = loggedAt(day, dir, h); if (l != null) seen.push([h, l]); }
  let recap = "";
  if (seen.length) { const w = seen.reduce((a, b) => b[1] > a[1] ? b : a); let calm = seen.length; while (calm > 0 && seen[calm - 1][1] < 3) calm--;
    recap = `${dir === "W" ? "This morning" : "This afternoon"} (logged): worst ${plusMin(w[1])} min at ${clock(w[0])}${calm < seen.length ? `, near an empty road since ${clock(seen[calm][0]).replace(/:00/, "").replace(" AM", "").replace(" PM", "")}` : ""}.`; }
  const stat = (kick, big, sub, subc, btn) => `<div>${btn ? `<button data-pick style="padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer" aria-label="Change destination">` : ""}<div class="kick">${kick}</div><div class="sg" style="font-size:${phone ? 20 : 24}px;font-weight:600">${big}${btn ? ` <span style="font-size:13px;color:#7FD1FF">▾</span>` : ""}</div><div style="font-size:12px;color:${subc}">${sub}</div>${btn ? "</button>" : ""}</div>`;
  const stats = `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:12px 0;border-top:1px solid #22364A;border-bottom:1px solid #22364A">
    ${stat("Go to", esc(phone ? M.short.replace("W. Park", "W. Park") : M.name), cr && cr.level ? `crowd ${CROWD_WORD[cr.level].toLowerCase()}` : "crowd: no reading", "#C1B6FF", true)}
    ${stat("Leave", leave, leaveSub, "#9FB2C1")}
    ${stat("Drive", hm(t.minutes), `${plusMin(t.delay)} min`, TXT_T(tone(t.pct)))}</div>`;
  const sw = (d, n) => `<button data-dir="${d}" style="height:38px;${phone ? "" : "padding:0 28px;"}border:0;border-radius:999px;background:${dir === d ? "#EAF1F6" : "transparent"};color:${dir === d ? "#0E1A24" : "#C9D6E0"};font:${dir === d ? 600 : 500} 14px Inter;cursor:pointer">${n}</button>`;
  const switcher = `<div role="group" aria-label="Direction" style="display:${phone ? "grid" : "inline-grid"};grid-template-columns:repeat(2,minmax(0,1fr));background:#0E1A24;border:1px solid #22364A;border-radius:999px;padding:3px">${sw("W", "Going up")}${sw("E", "Heading home")}</div>`;
  const recapP = recap ? `<p style="margin:0;font-size:12px;color:#9FB2C1">${esc(recap)}</p>` : "";
  const why = `<p style="margin:0;color:#C9D6E0">${esc(v.why)}</p>`;
  if (!phone) return `<section class="card" style="background:#13283A;border-color:#2B5573;display:flex;flex-direction:column;gap:12px;padding:24px" aria-label="Today's call">
    <span class="kick" style="color:#7FD1FF">${esc(kickTxt)}</span><h1 class="sg" style="margin:0;font-size:40px;line-height:1.1;font-weight:700">${esc(v.line)}</h1>${why}${stats}
    <div class="row" style="gap:16px">${switcher}${recapP}</div></section>`;
  const closed = UI.closed.has("call");
  return `<section class="card${closed ? " closed" : ""}" id="m-call" style="background:#13283A;border-color:#2B5573;display:flex;flex-direction:column;gap:10px;padding:16px" aria-label="Today's call">
    <button data-tog="call" aria-expanded="${!closed}" style="display:flex;align-items:flex-start;gap:12px;width:100%;min-height:44px;padding:0;border:0;background:none;color:#EAF1F6;font:inherit;text-align:left;cursor:pointer"><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px"><span class="kick" style="color:#7FD1FF">${esc(kickTxt)}</span><h1 class="sg" style="margin:0;font-size:28px;line-height:1.1;font-weight:700">${esc(v.line)}</h1></span>${PIP("k")}</button>
    <div class="mbody" style="display:flex;flex-direction:column;gap:10px">${why}${stats}${switcher}${recapP}</div></section>`;
}

// One collapsible phone module in the mockup's header style.
function pmod(id, title, sum, body, label, gap = 12) {
  const closed = UI.closed.has(id);
  return `<section class="card${closed ? " closed" : ""}" id="m-${id}" style="display:flex;flex-direction:column;gap:${gap}px;padding:16px" aria-label="${esc(label)}"><button data-tog="${id}" aria-expanded="${!closed}" style="${HEADBTN}"><span style="flex:1;min-width:0"><span class="sg" style="display:block;font-size:20px;font-weight:600">${title}</span><span style="display:block;font-size:12px;color:#9FB2C1;margin-top:2px">${sum}</span></span>${PIP()}</button><div class="mbody" style="display:flex;flex-direction:column;gap:${gap}px">${body}</div></section>`;
}

function powderPick() {
  const thr = S.alerts.powderIn || 6, days = weekDays().slice(0, 3); let best = null;
  MKEYS.filter(isOpen).forEach(k => days.forEach(iso => { const d = dayScore(k, iso); if (d && d.snow >= thr * 0.7 && (!best || d.snow > best.snow)) best = d; }));
  return best;
}
function renderNews(phone) {
  const best = powderPick(), parts = [];
  if (best) {
    const q = [best.tmax != null && best.tmax <= 30 ? "Cold and light" : best.tmax != null && best.tmax >= 36 ? "Warm and heavy" : "Medium density", best.tmin != null && best.tmax != null ? `, ${Math.round(best.tmin)} to ${Math.round(best.tmax)}°F` : "", best.gust >= 35 ? `; gusts to ${Math.round(best.gust)} mph` : ""].join("");
    const body = `${esc(MTS[best.k].name)} ${r1(best.snow)} in (models ${r1(best.lo || 0)} to ${r1(best.hi || 0)}). ${q}. ${esc(dayProfile(best.iso).leave)}.`;
    const link = `<a href="#week" data-goweek="${best.iso}" style="font-size:14px;font-weight:600${phone ? ";margin-top:4px" : ""}">Plan ${dayLong(best.iso)} ›</a>`;
    parts.push(`<div class="row" style="align-items:flex-start;gap:12px;padding:12px${phone ? "" : " 16px"};border-radius:14px;background:#17324A;border:1px solid #2B5573"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7FD1FF" stroke-width="1.8" aria-hidden="true" style="flex:none;margin-top:2px"><path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"></path></svg>
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">${phone ? "" : `<div class="row" style="justify-content:space-between;align-items:baseline">`}<span style="font-weight:600">Powder alert · ${dayLong(best.iso)}</span>${phone ? "" : `${link}</div>`}<span style="font-size:14px;color:#C9D6E0">${body}</span>${phone ? link : ""}</div></div>`);
  }
  // Since you last looked: lift counts and snow forecasts that moved.
  const prev = PREV.snap, ch = [];
  if (prev && prev.at) {
    MKEYS.forEach(k => weekDays().slice(0, 3).forEach(iso => { const a = ((prev.snow || {})[k] || {})[iso], d = dayScore(k, iso); if (a != null && d && Math.abs(d.during - a) >= 1) ch.push([`${dayLong(iso)} at ${MTS[k].name}`, `${Math.round(a)} → ${Math.round(d.during)} in`, "#7FD1FF"]); }));
    MKEYS.forEach(k => { const a = (prev.lifts || {})[k], b = statusOf(k).lifts; if (a && b && a !== b) { const x = parseInt(a) || 0, y = parseInt(b) || 0; ch.push([`Lifts${phone ? " open" : ""}, ${MTS[k].name}`, `${x} → ${y}`, y >= x ? "#5BE3A1" : "#FF8A7F"]); } });
  }
  const since = prev && prev.at ? `Since ${fmtSince(prev.at)}` : "Since your last visit";
  parts.push(`<div class="row" style="justify-content:space-between"><span class="kick">${esc(since)}</span>${ch.length ? `<button data-dismiss style="height:32px;border:0;background:none;color:#9FB2C1;font:500 12px Inter;cursor:pointer">Dismiss</button>` : ""}</div>`);
  parts.push(ch.length ? `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;${phone ? "gap:8px" : ""};font-size:14px">${ch.slice(0, 6).map(([a, b, c]) => `<li class="row" style="justify-content:space-between;${phone ? "" : "padding:8px 0;border-top:1px solid #22364A"}"><span>${esc(a)}</span><span style="color:${c};font-weight:600">${esc(b)}</span></li>`).join("")}</ul>`
    : `<p style="margin:0;font-size:14px;color:#9FB2C1">${prev ? "No changes in lifts or snow forecasts." : "Changes in lifts and snow forecasts show here next time."}</p>`);
  const sum = `${best ? `Powder alert for ${dayLong(best.iso)} · ` : ""}${ch.length ? `${ch.length} change${ch.length > 1 ? "s" : ""} ${prev ? since.toLowerCase().replace(/^since /, "since ") : ""}` : "no changes"}`;
  if (phone) return pmod("new", "What's new", esc(sum), parts.join(""), "What's new");
  return `<section class="card" style="display:flex;flex-direction:column;gap:12px;padding:16px 16px 12px" aria-label="What's new">${parts.join("")}</section>`;
}
const fmtSince = iso => { const d = new Date(iso), today = nowParts().iso, p = parts(d), di = `${p.year}-${p.month}-${p.day}`;
  return `${fmtTime(iso)}${di === today ? " today" : di === addDays(today, -1) ? " yesterday" : " " + dayMed(di)}`; };

function renderRoads(dir, phone) {
  const ways = [["copper", "I-70", "to Copper"], ["winterpark", "Berthoud Pass", "to Winter Park"], ["abasin", "Loveland Pass", "to A-Basin"], ["eldora", "Nederland", "to Eldora"]]
    .map(([k, nm, to]) => { const t = tripNow(k, dir), cl = closedFor(k, dir); return { k, nm, to, t, cl, c: cl.length ? "r" : tone(t.pct) }; });
  const allClear = ways.every(w => w.c === "g");
  const mode = UI.mapMode, mt = (m, n) => `<button data-mapmode="${m}" style="height:${phone ? 30 : 32}px;padding:0 ${phone ? 12 : 14}px;border:0;border-radius:999px;background:${mode === m ? "#22364A" : "none"};color:${mode === m ? "#EAF1F6" : "#9FB2C1"};font:${mode === m ? 600 : 500} 12px Inter;cursor:pointer">${n}</button>`;
  const toggle = `<div role="group" aria-label="Map type" style="display:flex;border:1px solid #22364A;border-radius:999px;padding:2px">${mt("line", "Line")}${mt("real", "Map")}</div>`;
  const map = mode === "real" ? `<div id="realmap" style="height:${phone ? 460 : 520}px;border-radius:14px;overflow:hidden;background:#0B1520"></div>` : lineMap(phone, dir);
  const time = w => w.cl.length ? "Closed" : hm(w.t.minutes), dl = w => w.cl.length ? "" : plusMin(w.t.delay);
  const list = phone
    ? `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column">${ways.map(w => `<li class="row" style="padding:10px 0;border-top:1px solid #22364A"><span style="width:10px;height:10px;border-radius:50%;background:${TONE[w.c]};flex:none"></span><div style="flex:1"><div style="font-weight:600">${esc(w.nm)}</div><div style="font-size:12px;color:#9FB2C1">${esc(w.to)}</div></div><div style="text-align:right"><div class="sg" style="font-size:16px;font-weight:600">${time(w)}</div><div style="font-size:12px;color:${TXT_T(w.c)}">${dl(w)}</div></div></li>`).join("")}</ul>`
    : `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px">${ways.map(w => `<div class="row" style="gap:10px;padding:8px 12px;border:1px solid #22364A;border-radius:12px"><span style="width:10px;height:10px;border-radius:50%;background:${TONE[w.c]};flex:none"></span><div style="flex:1;min-width:0;line-height:1.25"><div style="font-weight:600">${esc(w.nm.replace(" Pass", ""))}</div><div style="font-size:12px;color:#9FB2C1">${esc(w.to)}</div></div><div class="sg" style="font-size:18px;font-weight:600;white-space:nowrap">${time(w)} <span style="font-size:13px;color:${TXT_T(w.c)}">${dl(w)}</span></div></div>`).join("")}</div>`;
  // Footer: closures, traction laws, road surface, planned closures.
  const tr = (D.events || []).filter(e => started(e) && e.class === "chainLaws" && !/commercial/i.test(e.title || "")).length;
  const shut = closures().filter(e => /I70|US6|US40|CO119|CO72|US36|I25|CO58|CO93/.test(EV_ROUTE(e.route))).length, plan = plannedClosures().filter(e => EV_ROUTE(e.route) === "I70");
  const byCond = {}; ways.forEach(w => { const c = roadCond(w.k); if (c && c !== "Dry") (byCond[c] = byCond[c] || []).push(MTS[w.k].name); });
  const list3 = a => a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0];
  const condTxt = Object.entries(byCond).map(([c, a]) => `${c} roads toward ${list3(a)}.`).join(" ");
  const first = shut || tr ? `${shut ? `${shut} closure${shut > 1 ? "s" : ""}` : "No closures"}${tr ? `, ${tr} traction law${tr > 1 ? "s" : ""}` : ""} (COtrip).` : "No closures or traction laws (COtrip).";
  const planTxt = plan.length ? ` Planned: ${esc(plan[0].title.replace(/\.$/, ""))} from ${esc(fmtDayTime(plan[0].began))}${plan.length > 1 ? ` (+${plan.length - 1} more nights)` : ""}.` : "";
  const foot = `<p style="margin:0;font-size:12px;color:#9FB2C1">${first} ${esc(condTxt)}${planTxt} <a href="https://www.cotrip.org/travelAlerts" target="_blank" rel="noopener">All conditions ›</a></p>`;
  const title = dir === "W" ? "Ways up" : "Ways home";
  if (phone) {
    const sum = `${allClear ? `<span style="color:#5BE3A1;font-weight:600">All clear</span> · ` : ""}${ways.map(w => `${w.nm.replace(" Pass", "")} ${time(w)}`).join(" · ")}`;
    return pmod("roads", title, sum, `<div class="row" style="justify-content:flex-end">${toggle}</div>${map}${list}${foot}`, "Roads", 10);
  }
  return `<section class="card" style="display:flex;flex-direction:column;gap:14px;padding:24px" aria-label="Roads"><div class="row" style="justify-content:space-between"><h2 class="sg" style="margin:0;font-size:20px;font-weight:600">${title}</h2>${toggle}</div>${map}${list}${foot}</section>`;
}

function renderPlanner(iso, dir, hour, phone) {
  const k = dest(), M = MTS[k], H = hourly(k, iso, dir, hour), vals = H.vals, base = H.base;
  const w = UI.win != null ? UI.win : winOf(hour), [wn, wa, wb] = WINS[w];
  const inWin = [...Array(24).keys()].filter(h => h >= Math.max(wa, hour) && h < wb);
  const sel = UI.selHour != null ? UI.selHour : inWin.length ? (UI.win != null ? inWin.reduce((a, h) => vals[h] < vals[a] - 0.5 ? h : a, inWin[0]) : inWin[0]) : Math.max(hour, wa);
  // Best and worst ahead stay inside this direction's window (up: until the switch hour; home: until 8 PM). Best follows the Best-time rule.
  const cur = vals[sel] || 0, ahead = [...Array(24).keys()].filter(h => h >= hour && (dir === "W" ? h >= 5 && h < Math.max(S.flip, hour + 1) : h >= S.flip && h < 20));
  const byH = Object.fromEntries(ahead.map(h => [h, vals[h]])), bh = !ahead.length ? null : dir === "W" ? bestLeave(byH) : ahead.reduce((a, h) => vals[h] < vals[a] - 0.5 ? h : a, ahead[0]);
  const best = bh == null ? null : { start: bh, end: bh, val: vals[bh], lbl: bh === hour ? "Now" : clock(bh) };
  const worst = rangeAt(vals, ahead, "max", hour), flat = !best || !worst || worst.val - Math.min(...ahead.map(h => vals[h])) < 2;
  const from = dir === "W" ? "Coors" : M.name;
  const pick = `<button data-pick style="padding:0;border:0;background:none;font:inherit;color:#9FB2C1;cursor:pointer" aria-label="Change destination">${dir === "W" ? "for" : "from"} ${esc(M.name)} <span style="color:#7FD1FF">▾</span></button>`;
  const chip = (i, full) => { const on = i === w; return `<button class="chip" data-win="${i}" style="height:${phone ? 32 : 36}px;${phone ? "padding:0;justify-content:center;" : "padding:0 14px;"}${on ? "background:#EAF1F6;color:#0E1A24;border-color:#EAF1F6;font-weight:600" : "background:none"};cursor:pointer">${winLbl(WINS[i], full)}</button>`; };
  const cmpOn = !!UI.compare;
  const stat = (kick, big, sub, c) => `<div><div class="kick">${kick}</div><div class="sg" style="font-size:${phone ? 20 : 28}px;font-weight:600">${big}</div><div style="font-size:12px;color:${c}">${sub}</div></div>`;
  const stats = [stat(`At ${clock(sel)}`, hm(base + cur), `${plusMin(cur)} min`, TXT_T(tone(cur / base))),
    stat("Best ahead", best ? best.lbl : "n/a", best ? `${plusMin(best.val)} min` : "", TXT_T(tone((best || {}).val / base))),
    stat("Worst ahead", flat ? "None" : worst.lbl, flat ? "every hour about the same" : `${plusMin(worst.val)} min`, flat ? "#9FB2C1" : TXT_T(tone(worst.val / base)))];
  const Hpx = phone ? 64 : 110, mx = Math.max(20, ...vals);
  const bars = vals.map((m, h) => { const p = m / base, c = TONE[tone(p)], fut = !H.logged[h], ring = h === sel ? "outline:2px solid #EAF1F6;outline-offset:" + (phone ? 1 : 2) + "px;" : "";
    return `<div data-ph="${h}" class="${fut ? "hatch" : ""}" title="${clock(h)}: ${plusMin(m)} min${fut ? " (forecast)" : " (logged)"}" style="flex:1;height:${Math.max(4, Math.round(m / mx * Hpx))}px;border-radius:${phone ? 3 : 4}px ${phone ? 3 : 4}px 0 0;color:${c};background-color:${fut ? "transparent" : c};opacity:${h < 5 && !M.eldora ? 0.55 : 1};${ring}cursor:pointer"></div>`; }).join("");
  const { minute } = nowParts(), nowX = ((hour + minute / 60) / 24 * 100).toFixed(1);
  const chart = `<div style="position:relative;height:${phone ? 96 : 150}px;display:flex;align-items:flex-end;gap:${phone ? 3 : 4}px;border-bottom:1px solid #3A5266;padding-top:${phone ? 20 : 24}px">${bars}<div style="position:absolute;left:${nowX}%;top:0;bottom:0;width:2px;background:#7FD1FF;pointer-events:none"></div><span style="position:absolute;left:${nowX}%;top:-2px;transform:translateX(-50%);font-size:${phone ? 11 : 12}px;font-weight:600;color:#0E1A24;background:#7FD1FF;border-radius:6px;padding:0 ${phone ? 6 : 8}px;white-space:nowrap">${phone ? "Now" : "Now " + clock(hour + minute / 60).replace(/ (AM|PM)$/, "")}</span></div>
    <div class="row" style="justify-content:space-between;font-size:12px;color:#9FB2C1;margin-top:${phone ? -6 : 6}px">${phone ? "<span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>" : "<span>12 AM</span><span>6 AM</span><span>Noon</span><span>6 PM</span><span>12 AM</span>"}</div>`;
  // Compare mountains: the same hour to each mountain, and each one's best hour in the window.
  const cmp = cmpOn ? `<div style="display:grid;grid-template-columns:repeat(${phone ? 2 : 4},minmax(0,1fr));gap:8px">${MKEYS.filter(isOpen).map(kk => { const h2 = hourly(kk, iso, dir, hour), v2 = h2.vals[sel] || 0, b2 = inWin.length ? inWin.reduce((a, h) => h2.vals[h] < h2.vals[a] - 0.5 ? h : a, inWin[0]) : sel;
      return `<button data-dest="${kk}" style="display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:12px;border:1px solid ${kk === k ? "#7FD1FF" : "#22364A"};background:${kk === k ? "#13283A" : "none"};color:#EAF1F6;text-align:left;cursor:pointer;font:inherit"><span style="font-weight:600">${esc(MTS[kk].name)}</span><span class="sg" style="font-size:18px;font-weight:600">${hm(h2.base + v2)} <span style="font-size:12px;color:${TXT_T(tone(v2 / h2.base))}">${plusMin(v2)}</span></span><span style="font-size:12px;color:#9FB2C1">best in ${wn.toLowerCase()}: ${clock(b2)}</span></button>`; }).join("")}</div>` : "";
  const noteP = `Solid bars are logged, striped are forecast. Height is minutes over an empty road; green under 12%, amber 12 to 30%, red over 30%.${M.eldora ? " Eldora has no hourly forecast yet, so striped hours repeat the drive right now." : " Before 5 AM is I-70 sensors only."}`;
  const note = phone ? `<p style="margin:0;font-size:12px;color:#9FB2C1">Solid = logged, striped = forecast. Height = minutes over an empty road. <span class="ki kr" tabindex="0" style="color:#7FD1FF" aria-label="About the colors">ⓘ<span class="tt">${esc(noteP)}</span></span></p>` : `<p style="margin:0;font-size:12px;color:#9FB2C1">${noteP}</p>`;
  const titleTxt = dir === "W" ? `Leave Coors at <span style="color:#7FD1FF">${clock(sel)}</span>` : `Head home at <span style="color:#7FD1FF">${clock(sel)}</span>`;
  if (phone) {
    const sum = `${hm(base + cur)}, ${plusMin(cur)} min · best ${best ? (best.lbl === "Now" ? "now" : best.lbl.replace("–", " to ")) : "n/a"} · ${flat ? "no slow hour ahead" : `worst ${worst.lbl.replace(/^Now/, "now").replace("–", " to ")}, ${plusMin(worst.val)}`}`;
    const body = `<div class="row" style="justify-content:space-between">${pick}<button data-compare style="padding:0;border:0;background:none;font:600 12px Inter;color:#7FD1FF;cursor:pointer">${cmpOn ? "Hide compare" : "Compare"}</button></div>
      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px">${WINS.map((_, i) => chip(i, false)).join("")}</div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${stats.join("")}</div>${chart}${cmp}${note}`;
    return pmod("plan", titleTxt, sum, body, "Departure planner");
  }
  return `<section class="card" style="display:flex;flex-direction:column;gap:16px;padding:24px" aria-label="Departure planner">
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px"><h2 class="sg" style="margin:0;font-size:28px;font-weight:600">${titleTxt} <span style="font-size:16px;font-weight:500">${pick}</span></h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${WINS.map((_, i) => chip(i, true)).join("")}<button class="chip" data-compare style="height:36px;padding:0 14px;color:#7FD1FF;border-color:#2B5573;${cmpOn ? "background:#13283A" : "background:none"};cursor:pointer">Compare mountains</button></div></div>
    <div style="display:flex;flex-wrap:wrap;gap:32px;align-items:flex-end"><div style="display:flex;gap:40px;flex:0 0 auto">${stats.join("")}</div><div style="flex:1 1 520px;min-width:0">${chart}</div></div>${cmp}${note}</section>`;
}

// Crowd by hour for one mountain: estimated from the expected drive up until the crowd log has a season.
function crowdStrip(k, iso, hour, phone) {
  const hs = [8, 9, 10, 11, 12, 13, 14, 15], src = h => Math.max(5, Math.min(10, h - 2));
  const vals = hs.map(h => Math.max(0, expected(iso, "W", src(h)))), typ = hs.map(h => { const s = (D.model.slots || {})[`${pyDow(iso)}-${String(src(h)).padStart(2, "0")}00-W`]; return s ? s.median : 0; });
  const mx = Math.max(4, ...vals, ...typ), sv = vals.reduce((a, b) => a + b, 0), st = typ.reduce((a, b) => a + b, 0), dn = dayLong(iso), dt = dayInfo(iso).type;
  const usual = `a usual ${dt === "holiday" ? "holiday " : ""}${dn}`;
  const verdict = sv > st * 1.15 + 2 ? [`Busier than ${usual}`, "#FFC566"] : sv < st * 0.85 - 2 ? [`Quieter than ${usual}`, "#5BE3A1"] : [`About like ${usual}`, "#C1B6FF"];
  const Hh = phone ? 36 : 32, inner = Hh - 2;
  return `<div class="row" style="justify-content:space-between;align-items:baseline;gap:8px"><span class="kick">Crowd today by hour</span><span style="font-size:12px;font-weight:600;color:${verdict[1]};text-align:right">${verdict[0]}</span></div>
    <div style="display:flex;gap:4px">${hs.map((h, i) => `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1"><div style="position:relative;width:100%;height:${Hh}px;display:flex;align-items:flex-end;${h === hour ? "outline:2px solid #EAF1F6;outline-offset:1px;border-radius:3px" : ""}"><div class="${h < hour ? "" : "hatch"}" style="width:100%;height:${Math.max(3, Math.round(vals[i] / mx * inner))}px;border-radius:3px 3px 0 0;${h < hour ? "background:#8C7FE0" : "color:#8C7FE0"}"></div><span style="position:absolute;left:-1px;right:-1px;bottom:${Math.round(typ[i] / mx * inner) + 4}px;height:2px;background:#EAF1F6;opacity:.85"></span></div><span style="font-size:11px;color:#9FB2C1">${clockS(h)}</span></div>`).join("")}</div>
    <span style="font-size:12px;color:#9FB2C1;margin-top:-6px">White tick is ${usual}. Striped hours are forecast. Estimated from traffic into the base area until the crowd log has a season.</span>`;
}
const LOTS_ROAD = { copper: "CO 91 into the lots", abasin: "US 6 into the lots", winterpark: "US 40 into the lots", eldora: "Eldora Rd into the lots" };
const EV_NAME = (key, k) => ({ cameras: "Base-area cameras", parking: "Parking", last_mile: LOTS_ROAD[k] })[key] || null;
function evidence(k, cr) {
  const order = ["cameras", "parking", "last_mile"];
  const rows = ((D.sources || {}).crowd_sources || []).filter(c => c.status !== "skipped" && EV_NAME(c.key, k)).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map(c => { const cam = c.key === "cameras" ? camOf(k) : null;
    const txt = c.key === "cameras" ? (cam ? `${cam.n} people in view, ${fmtTime(cam.at)}` : (CAMS_FOR_CROWD.includes(k) ? "no reading yet today" : "no usable camera yet"))
      : c.key === "last_mile" || c.status === "trial" ? (cr ? `${cr.ratio > 1.02 ? "+" + Math.round((cr.ratio - 1) * 100) + "%" : "moving freely"}, ${fmtTime(cr.at)}` : "no reading yet") : "not collected yet";
    return `<li style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid #22364A;font-size:12px"><span style="color:#9FB2C1">${esc(EV_NAME(c.key, k))}</span><span style="text-align:right">${esc(txt)}</span></li>`; }).join("");
  return `<div class="kick">Crowd: what it's based on</div><ul style="margin:0;padding:0;list-style:none">${rows}</ul>`;
}
function camsBlock(k, phone) {
  if (!CAMS) return `<div style="font-size:12px;color:#9FB2C1">Loading cameras…</div>`;
  const M = MTS[k], dd = c => Math.hypot((c.lon - M.lon) * 85, (c.lat - M.lat) * 111);
  const near = CAMS.filter(c => c.views && c.views.length).map(c => ({ c, d: dd(c) })).filter(x => x.d < 25).sort((a, b) => a.d - b.d).slice(0, 2);
  if (!near.length) return `<div style="font-size:12px;color:#9FB2C1">No COtrip camera near ${esc(M.name)}.</div>`;
  return `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${near.map(({ c }) => { const v = c.views.find(v => !/surface/i.test(v[0])) || c.views[0];
    return `<figure style="margin:0"><a href="${esc(v[1])}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(v[1])}" alt="${esc(c.name)}" style="width:100%;height:${phone ? 96 : 100}px;object-fit:cover;border-radius:10px;background:#0E1A24;display:block"></a><figcaption style="font-size:12px;color:#9FB2C1;margin-top:4px">${esc(c.name.replace(/\s*:.*$/, ""))}</figcaption></figure>`; }).join("")}</div>`;
}
function nextBigDay(k) { let b = null; weekDays().slice(0, 3).forEach(iso => { const d = dayScore(k, iso); if (d && d.during >= 1 && (!b || d.during > b.during)) b = d; }); return b; }
function snowBlock(r) {
  const s = r.s, nb = nextBigDay(r.k);
  return `<div class="kick">Snow</div><div style="display:grid;grid-template-columns:110px 1fr;gap:6px 12px"><span style="color:#9FB2C1">Base (SNOTEL)</span><span>${s.depth != null ? s.depth + " in" : "n/a"}${s.temp != null ? ", " + Math.round(s.temp) + "°F" : ""}</span>${nb ? `<span style="color:#9FB2C1">${dayLong(nb.iso)}</span><span>${r1(nb.during)} in${nb.lo != null ? `, range ${r1(nb.lo)}–${r1(nb.hi)}` : ""}</span>` : ""}<span style="color:#9FB2C1">Quality</span><span>${esc(quality(s))}</span></div>`;
}
function whyBlock(r, i, R) {
  const s = r.s, cr = r.crowd, rc = roadCond(r.k), f = r.f;
  const rows = [["Snow", f.snow / 40, `${r1(s.new24 + s.fc24)} in`], ["Drive", 1 + f.drive / 15, plusMin(r.t.delay)], ["Wind", 1 + f.wind / 20, s.gust != null ? Math.round(s.gust) + " mph" : "n/a"],
    ["Crowd", 1 + f.crowd / 9, cr && cr.level ? CROWD_WORD[cr.level] : "n/a"], [`${rc && rc !== "Dry" ? rc : "Dry"} roads`, 1 + f.roads / 9, f.roads ? String(f.roads).replace("-", "−") : "0"]];
  if (r.closed) rows.push(["Closures", 0, "−40"]);
  const bar = ([n, v, t]) => `<div class="row" style="font-size:12px"><span style="width:76px;color:#9FB2C1">${n}</span><span style="flex:1;height:6px;border-radius:3px;background:#22364A"><span style="display:block;width:${Math.round(Math.max(0.03, Math.min(1, v)) * 100)}%;height:6px;border-radius:3px;background:#7FD1FF"></span></span><span style="width:52px;text-align:right">${esc(t)}</span></div>`;
  let line;
  if (i === 0 && R[1]) line = R[1].score === r.score ? `Tied with ${MTS[R[1].k].name} at ${r.score}; ${MTS[r.k].name} wins on the shorter drive.` : `${r.score - R[1].score} point${r.score - R[1].score > 1 ? "s" : ""} ahead of ${MTS[R[1].k].name}.`;
  else { const worst = [["wind", f.wind, `Gusts to ${Math.round(s.gust || 0)} mph pull it down`], ["drive", f.drive, `the drive is ${Math.round(r.t.delay)} min slow`], ["roads", f.roads, `${(rc || "snowy").toLowerCase()} roads cost it`], ["closure", f.closure, "a closure on the way"]].sort((a, b) => a[1] - b[1])[0];
    const lf = statusOf(r.k).lifts, [lo, la] = String(lf || "").split(" of ").map(Number); const few = la && lo / la < 0.2 ? `only ${lo} of ${la} lifts open` : "";
    line = worst[1] < -1 ? `${worst[2][0].toUpperCase() + worst[2].slice(1)}${few ? "; " + few : ""}.` : few ? `${few[0].toUpperCase() + few.slice(1)}.` : `Less snow than ${MTS[R[0].k].name}.`; }
  return `<div class="kick">Why it ranks ${["first", "second", "third", "fourth"][i] || "#" + (i + 1)}</div>${rows.map(bar).join("")}<span style="font-size:12px;color:#9FB2C1">${esc(line)}</span>`;
}
function renderMountains(R, dir, phone) {
  const st = D.status || {}, { iso, hour } = nowParts(), dk = dest();
  const sub = r => `${esc(MTS[r.k].route)}${r.k === dk ? " · your destination" : ""}`;
  const lifts = k => { const d = liftsDelta(k); return `${esc(statusOf(k).lifts || "n/a")}${d ? ` <span style="color:${d > 0 ? "#5BE3A1" : "#FF8A7F"};font-size:12px">${d > 0 ? "+" : "−"}${Math.abs(d)}</span>` : ""}`; };
  if (!phone) {
    const rows = R.map((r, i) => { const M = MTS[r.k], on = UI.openM === r.k, t = tripNow(r.k, dir), cr = r.crowd;
      return `<tr style="background:${on ? "#13283A" : "transparent"}"><td class="sg" style="font-weight:700;color:#9FB2C1">${i + 1}</td>
        <td><button data-m="${r.k}" aria-expanded="${on}" style="display:flex;align-items:center;gap:10px;min-height:44px;padding:0;border:0;background:none;color:#EAF1F6;font:inherit;text-align:left;cursor:pointer"><span class="pip mid" style="${on ? "" : "background:#7FD1FF"}" aria-hidden="true"></span><span><span class="sg" style="display:block;font-size:18px;font-weight:600">${esc(M.name)}</span><span style="display:block;font-size:12px;color:#9FB2C1">${sub(r)}</span></span></button></td>
        <td>${r1(r.s.new24)} in</td><td style="color:#7FD1FF;font-weight:600">${r1(r.s.fc24)} in</td><td>${lifts(r.k)}</td>
        <td style="white-space:nowrap">${meterBig(cr && cr.level, 8, 12)} <span style="margin-left:6px;color:#C1B6FF">${cr && cr.level ? CROWD_WORD[cr.level] : "No reading"}</span></td>
        <td style="white-space:nowrap"><span class="sg" style="font-weight:600">${hm(t.minutes)}</span> <span style="color:${TXT_T(tone(t.pct))};font-size:12px">${plusMin(t.delay)}</span></td>
        <td>${flagChips(r, { crowd: false, short: true })}</td>
        <td><div class="row" style="gap:8px"><span style="flex:1;height:6px;border-radius:3px;background:#22364A"><span style="display:block;width:${r.score}%;height:6px;border-radius:3px;background:#7FD1FF"></span></span><span>${r.score}</span></div></td></tr>` +
        (on ? `<tr style="background:#13283A"><td colspan="9" style="border-top:0;padding:0 10px 18px 50px"><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px">
          <div style="display:flex;flex-direction:column;gap:8px">${evidence(r.k, cr)}${crowdStrip(r.k, iso, hour, false)}</div>
          <div style="display:flex;flex-direction:column;gap:8px"><div class="kick">Cameras</div>${camsBlock(r.k, false)}</div>
          <div style="display:flex;flex-direction:column;gap:8px">${snowBlock(r)}</div>
          <div style="display:flex;flex-direction:column;gap:8px">${whyBlock(r, i, R)}</div></div></td></tr>` : ""); }).join("");
    return `<section class="card" style="display:flex;flex-direction:column;gap:8px;padding:24px 24px 12px" aria-label="Mountains"><div class="row" style="justify-content:space-between"><h2 class="sg" style="margin:0;font-size:20px;font-weight:600">Mountains</h2><span style="font-size:12px;color:#9FB2C1">Tap a mountain for details · ${esc(passLabel())} · lift reports at ${esc((st.checked || "").replace(/^.*, /, ""))} · <a href="#" data-settings>change passes</a></span></div>
      <div style="overflow-x:auto"><table class="mt2" style="width:100%;border-collapse:collapse;min-width:1040px"><thead><tr><th style="width:40px">#</th><th>Mountain</th><th>New 24 h</th><th>Next 24 h</th><th>Lifts</th><th>Crowd now</th><th>Drive now</th><th>Flags</th><th style="width:150px">Score</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  const cards = R.map((r, i) => { const M = MTS[r.k], on = UI.openM === r.k, t = tripNow(r.k, dir), cr = r.crowd;
    const head = `<button data-m="${r.k}" aria-expanded="${on}" style="display:flex;align-items:baseline;gap:12px;width:100%;min-height:48px;padding:0;border:0;background:none;color:#EAF1F6;font:inherit;text-align:left;cursor:pointer"><span style="flex:1;min-width:0"><span class="sg" style="display:block;font-size:20px;font-weight:600">${i + 1}.&nbsp;${esc(M.name)}</span><span style="display:block;font-size:12px;color:#9FB2C1">${sub(r)}</span><span style="display:block;font-size:12px;color:#9FB2C1;white-space:nowrap">${r1(r.s.new24)}&nbsp;in new · ${r1(r.s.fc24)}&nbsp;in next 24&nbsp;h</span></span><span style="text-align:right"><span class="sg" style="display:block;font-size:20px;font-weight:600">${hm(t.minutes)}</span><span style="display:block;font-size:12px;color:${TXT_T(tone(t.pct))}">${plusMin(t.delay)}</span></span><span class="pip" style="${on ? "" : "background:#7FD1FF"}" aria-hidden="true"></span></button>`;
    const chips = `<div style="display:flex;flex-wrap:wrap;gap:6px">${flagChips(r)}</div>`;
    const det = on ? `<div style="display:flex;flex-direction:column;gap:12px"><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px"><div><div class="kick">New 24 h</div><div style="font-weight:600">${r1(r.s.new24)} in</div></div><div><div class="kick">Next 24 h</div><div style="font-weight:600;color:#7FD1FF">${r1(r.s.fc24)} in</div></div><div><div class="kick">Lifts</div><div style="font-weight:600">${lifts(r.k)}</div></div></div>
      <div class="row" style="justify-content:space-between;padding:10px 12px;border-radius:12px;background:#1A2240;border:1px solid #3B3A66"><div><div class="kick" style="color:#C1B6FF">Crowd now</div><div style="font-weight:600">${cr && cr.level ? `${CROWD_WORD[cr.level]} · last mile ${cr.ratio > 1.02 ? Math.round((cr.ratio - 1) * 100) + "% slower" : "moving freely"}` : "No reading yet"}</div></div>${meterBig(cr && cr.level)}</div>${chips}
      <div style="border-top:1px solid #22364A;padding-top:12px;display:flex;flex-direction:column;gap:12px">${evidence(r.k, cr)}${crowdStrip(r.k, iso, hour, true)}<div class="kick">Cameras</div>${camsBlock(r.k, true)}${snowBlock(r)}${whyBlock(r, i, R)}</div></div>` : chips;
    return `<article class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;border-color:${on ? "#7FD1FF" : "#22364A"}">${head}${det}</article>`; }).join("");
  const closed = UI.closed.has("mtn"), order = R.map(r => MTS[r.k].name);
  const sum = `${order[0]} first${order.length > 1 ? ", then " + order.slice(1).join(", ") : ""} · ${esc(passLabel())} · lifts at ${esc((st.checked || "").replace(/^.*, /, ""))}`;
  return `<section id="m-mtn" class="${closed ? "closed" : ""}" style="display:flex;flex-direction:column;gap:10px" aria-label="Mountains"><div class="card" style="padding:12px 16px"><button data-tog="mtn" aria-expanded="${!closed}" style="${HEADBTN}"><span style="flex:1;min-width:0"><span class="sg" style="display:block;font-size:20px;font-weight:600">Mountains</span><span style="display:block;font-size:12px;color:#9FB2C1;margin-top:2px">${sum}</span></span>${PIP()}</button></div><div class="mbody" style="display:flex;flex-direction:column;gap:10px">${cards}</div></section>`;
}
let CAMS = null;
function factorBars(f, vals) {
  const rows = [["Snow", f.snow / 40, vals.snow], ["Drive", 1 + f.drive / 15, vals.drive], ["Wind", 1 + f.wind / 20, vals.wind], ["Crowd", 1 + f.crowd / 9, vals.crowd], ["Snowy roads", 1 + f.roads / 9, vals.roads], ["Closures", f.closure ? 0 : 1, vals.closure]];
  return rows.map(([n, v, t]) => `<div class="fac"><span class="muted">${n}</span><span class="tk"><i class="${v < 0.5 && n !== "Snow" ? "neg" : ""}" style="width:${Math.round(Math.max(0.03, Math.min(1, v)) * 100)}%"></i></span><b style="text-align:right">${esc(t)}</b></div>`).join("");
}
// Destination picker: every open mountain with its drive now; the page's best pick is marked.
function renderPicker() {
  const R = ranked(), dk = dest(), dir = curDir();
  return `<div class="row" style="justify-content:space-between"><h2 class="sg" style="margin:0;font-size:20px;font-weight:600">${dir === "W" ? "Where are you going?" : "Where are you coming from?"}</h2><button class="ibtn" data-close aria-label="Close">✕</button></div>
    <div style="display:flex;flex-direction:column">${R.map((r, i) => { const t = tripNow(r.k, dir);
      return `<button data-dest="${r.k}" class="row" style="padding:12px 4px;border:0;border-top:1px solid #22364A;background:${r.k === dk ? "#13283A" : "none"};color:#EAF1F6;font:inherit;text-align:left;cursor:pointer;border-radius:${r.k === dk ? "12px" : "0"}"><span style="flex:1"><span style="display:block;font-weight:600">${esc(MTS[r.k].name)}${i === 0 ? ` <span style="font-size:12px;color:#7FD1FF;font-weight:500">best pick</span>` : ""}</span><span style="display:block;font-size:12px;color:#9FB2C1">${esc(MTS[r.k].route)} · score ${r.score}</span></span><span class="sg" style="font-size:18px;font-weight:600">${hm(t.minutes)} <span style="font-size:12px;color:${TXT_T(tone(t.pct))}">${plusMin(t.delay)}</span></span></button>`; }).join("")}</div>
    <p style="margin:0;font-size:12px;color:#9FB2C1">Your pick sets the call, the planner and the map for this visit. Next time the page starts on its best pick again.</p>`;
}

// ---- Week -----------------------------------------------------------------------------------------------------
// Built from the approved boards (Week · Phone, Week · Desktop).
const dayName = iso => { const d = new Date(iso + "T12:00:00Z"); return `${d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })} ${d.getUTCDate()}`; };
const dayTagShort = iso => { const t = dayInfo(iso).type; return t === "holiday" ? "Holiday" : t === "break" ? "School break" : t === "disrupted" ? "Storm" : ""; };
const leaveShort = iso => { const p = dayProfile(iso); return p.upPeak >= 10 && p.leaveH != null ? `Leave by ${p.leaveH % 12 || 12}` : "No rush"; };
const crowdBars = (n, w = 4, h = 8) => `<span style="display:inline-flex;gap:1px">${[1, 2, 3, 4].map(i => `<span style="width:${w}px;height:${h}px;border-radius:1px;background:${i <= n ? "#8C7FE0" : "#2C3554"}"></span>`).join("")}</span>`;
const trafficSource = iso => { const cov = (D.model.coverage || {})[`${pyDow(iso)}-amW`], t = dayInfo(iso).type;
  const logged = t === "typical" ? cov && (cov.n || 0) > 0 : (((D.model.day_types || {})[t] || {}).days || []).some(d => d < nowParts().iso);
  return logged ? "Profile" : "Estimate"; };
function bestRuns(days, best) {
  const runs = []; days.forEach(iso => { const k = best[iso] ? best[iso].k : null; const last = runs[runs.length - 1]; if (last && last.k === k) last.to = iso; else runs.push({ k, from: iso, to: iso }); });
  const wd = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
  return runs.filter(r => r.k).map(r => `${MTS[r.k].name} ${wd(r.from)}${r.to !== r.from ? " to " + wd(r.to) : ""}`).join(", ");
}

function renderWeek() {
  const days = weekDays(); if (!days.length) return `<div class="card"><p style="margin:0;color:#9FB2C1">The 7-day outlook fills in after the next forecast run.</p></div>`;
  const S2 = {}; MKEYS.forEach(k => days.forEach(iso => { S2[k + iso] = isOpen(k) ? dayScore(k, iso) : null; }));
  const best = {}; days.forEach(iso => { best[iso] = MKEYS.map(k => S2[k + iso]).filter(Boolean).sort((a, b) => b.score - a.score)[0] || null; });
  if (!UI.weekDay || !days.includes(UI.weekDay)) UI.weekDay = days.reduce((a, iso) => (best[iso] && (!best[a] || best[iso].score > best[a].score)) ? iso : a, days[0]);
  const sel = UI.weekDay, phone = isPhone(), b = best[sel] ? best[sel].k : MKEYS[0];
  const grid = weekGrid(days, S2, best, sel, phone);
  const call = weekCall(sel, b, S2, phone), plan = weekPlanner(sel, b, phone), crowd = weekCrowd(sel, b, phone), why = weekWhy(sel, S2, best, phone), others = weekOthers(sel, S2, best, phone);
  const foot = `<footer style="font-size:12px;color:#9FB2C1;padding:4px 4px 0">Snow: NWS plus 4 models. Traffic: the logger's model of past days like this one. Crowd: estimated from traffic until the crowd log has a season. <a href="#data">About this dashboard</a></footer>`;
  if (phone) return `${grid}${call}${plan}${crowd}${why}${others}${foot}`;
  return `${grid}<div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:20px;align-items:start"><div style="display:flex;flex-direction:column;gap:20px">${call}${plan}${crowd}</div><div style="display:flex;flex-direction:column;gap:20px">${why}${others}</div></div>${foot}`;
}
function weekKey(phone) {
  const items = [["Snow", "Forecast snow, night before plus the day. Deeper blue means more.", `<span style="display:inline-flex;gap:1px">${["#1F4A6B", "#2A6A99", "#3D8FCC"].map(c => `<span style="width:9px;height:9px;border-radius:2px;background:${c}"></span>`).join("")}</span>`, "l"],
    ["Traffic", "Drive up vs an empty road. Green is under 12% slower, amber 12 to 30%, red over 30%.", `<span style="display:inline-flex;gap:2px">${["g", "a", "r"].map(t => `<span style="width:7px;height:7px;border-radius:50%;background:${TONE[t]}"></span>`).join("")}</span>`, "l"],
    ["Crowd", "Crowd forecast, 1 to 4 bars. Estimated from traffic until the crowd log fills in.", crowdBars(2, 3, 9), "c"],
    ["Best", "The model's top pick for that day.", `<span style="width:10px;height:10px;border-radius:3px;outline:2px solid #EAF1F6;outline-offset:-2px"></span>`, "r"],
    ["Rough", "4 or more days out. Treat it as a heads-up, not a plan.", `<span style="display:inline-flex;align-items:center;gap:5px;opacity:.5"><span style="width:10px;height:10px;border-radius:3px;background:#2A6A99"></span></span>`, "r"]];
  const st = phone ? "display:flex;flex-wrap:nowrap;justify-content:space-between;align-items:center;gap:8px;font-size:11px;color:#9FB2C1;padding:4px 4px 0;white-space:nowrap" : "display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;font-size:12px;color:#9FB2C1";
  return `<div aria-label="Key" style="${st}">${items.map(([n, tt, ic, pos]) => `<span class="ki k${pos}" tabindex="0" role="button" aria-label="${n}: ${tt}">${ic}${n}<span class="tt" role="tooltip">${tt}</span></span>`).join("")}</div>`;
}
function weekGrid(days, S2, best, sel, phone) {
  const cellData = (k, iso) => { const r = S2[k + iso]; if (!r) return null; const t = tone(r.drivePeak / 90); return { r, t, snow: Math.round(r.snow), ring: best[iso] && best[iso].k === k, cr: crowdEst(iso) }; };
  if (phone) {
    const rows = days.map((iso, i) => { const on = iso === sel, tag = dayTagShort(iso);
      const cells = MKEYS.map(k => { const c = cellData(k, iso); if (!c) return `<span style="display:flex;align-items:center;justify-content:center;border-radius:10px;background:#15232F;font-size:11px;color:#9FB2C1">Closed</span>`;
        return `<span style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border-radius:10px;background:${snowBg(c.snow)};outline:${c.ring ? "2px solid #EAF1F6" : "none"};outline-offset:-2px"><span class="sg" style="font-size:16px;font-weight:600">${c.snow}"</span><span style="display:flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${TONE[c.t]}"></span>${crowdBars(c.cr)}</span></span>`; }).join("");
      return `<button data-day="${iso}" aria-label="${dayName(iso)}${on ? ", selected" : ""}" style="opacity:${i > 2 ? 0.5 : 1};display:grid;grid-template-columns:84px repeat(4,minmax(0,1fr));gap:4px;padding:4px;border-radius:12px;background:${on ? "#13283A" : "transparent"};border:1px solid ${on ? "#7FD1FF" : "transparent"};color:#EAF1F6;font:inherit;text-align:left;cursor:pointer;width:100%"><span style="display:flex;flex-direction:column;justify-content:center;line-height:1.2;min-height:52px"><span style="font-weight:600">${dayName(iso)}</span><span style="font-size:11px;color:${tag ? "#FFC566" : "#9FB2C1"}">${tag}</span><span style="font-size:11px;color:#9FB2C1">${leaveShort(iso)}</span></span>${cells}</button>`; }).join("");
    const body = `<div style="display:flex;flex-direction:column;gap:6px"><div style="display:grid;grid-template-columns:84px repeat(4,minmax(0,1fr));gap:4px;padding:0 4px"><span></span>${MKEYS.map(k => `<span style="font-size:12px;font-weight:600;text-align:center">${esc(MTS[k].short)}</span>`).join("")}</div>${rows}${weekKey(true)}</div>`;
    const closed = UI.closed.has("days");
    return `<section class="card${closed ? " closed" : ""}" id="m-days" style="padding:12px;display:flex;flex-direction:column;gap:6px" aria-label="Seven days"><button data-tog="days" aria-expanded="${!closed}" style="${HEADBTN}"><span style="flex:1;min-width:0"><span class="sg" style="display:block;font-size:20px;font-weight:600">Seven days</span><span style="display:block;font-size:12px;color:#9FB2C1;margin-top:2px">Best pick: ${esc(bestRuns(days, best))}</span></span>${PIP()}</button><div class="mbody">${body}</div></section>`;
  }
  const cols = `grid-template-columns:150px repeat(${days.length},minmax(0,1fr));gap:6px`;
  const heads = days.map(iso => { const on = iso === sel, tag = dayTagShort(iso); return `<button data-day="${iso}" style="display:flex;flex-direction:column;align-items:center;gap:1px;padding:8px 4px;border-radius:12px;background:${on ? "#13283A" : "transparent"};border:1px solid ${on ? "#7FD1FF" : "transparent"};color:#EAF1F6;line-height:1.25;font:inherit;cursor:pointer"><span style="font-weight:600">${dayName(iso)}</span><span style="font-size:12px;color:${tag ? "#FFC566" : "#9FB2C1"}">${tag || "&nbsp;"}</span><span style="font-size:12px;color:#9FB2C1">${leaveShort(iso)}</span></button>`; }).join("");
  const rows = MKEYS.map(k => `<div style="display:grid;${cols}"><div style="display:flex;flex-direction:column;justify-content:center;line-height:1.25"><span class="sg" style="font-size:16px;font-weight:600">${esc(MTS[k].name)}</span><span style="font-size:12px;color:#9FB2C1">${esc(MTS[k].way)}</span></div>${days.map((iso, i) => { const c = cellData(k, iso);
      if (!c) return `<div style="display:flex;align-items:center;justify-content:center;height:64px;border-radius:12px;background:#15232F;font-size:12px;color:#9FB2C1">Closed</div>`;
      return `<button data-day="${iso}" style="opacity:${i > 2 ? 0.5 : 1};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:64px;border:0;border-radius:12px;background:${snowBg(c.snow)};outline:${c.ring ? "2px solid #EAF1F6" : "none"};outline-offset:-2px;color:#EAF1F6;font:inherit;cursor:pointer" title="${esc(MTS[k].name)} ${dayName(iso)}: score ${c.r.score}"><span class="sg" style="font-size:20px;font-weight:600;line-height:1">${c.snow}"</span><span style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="display:flex;align-items:center;gap:4px;color:#C9D6E0"><span style="width:8px;height:8px;border-radius:50%;background:${TONE[c.t]}"></span>${WORD[c.t]}</span>${crowdBars(c.cr, 4, 9)}</span></button>`; }).join("")}</div>`).join("");
  return `<section class="card" style="display:flex;flex-direction:column;gap:10px;padding:20px 24px" aria-label="Seven days"><div style="overflow-x:auto"><div style="min-width:980px;display:flex;flex-direction:column;gap:6px"><div style="display:grid;${cols}"><span></span>${heads}</div>${rows}</div></div>${weekKey(false)}</section>`;
}
function weekVerdict(iso, b, S2) {
  const p = dayProfile(iso), r = S2[b + iso], info = dayInfo(iso), weekend = pyDow(iso) >= 5, off = isOffDay(iso);
  if (!r) return "Nothing's open that day.";
  if (r.snow >= 6 && !(weekend || off)) return "Powder on a weekday. Call in sick.";
  if ((weekend || off) && (info.type === "holiday" || info.type === "break")) return p.upPeak < 10 ? "Everybody's off, but the roads should be fine." : `Everybody's off. ${p.leave} or keep your ass at home.`;
  if (r.snow >= 6) return `Powder day incoming. ${p.leave === "No rush going up" ? "Set an alarm." : p.leave + "."}`;
  if (p.upPeak >= 25) return `${p.leave} or don't bother.`;
  if (!weekend && !off) return r.snow >= 3 ? "Fresh snow on a weekday. Call in sick." : "Empty roads, empty lifts.";
  return r.snow >= 1 ? "Should be a good one. Go get it." : "Old snow, normal traffic. Groomer day.";
}
function weekCall(iso, b, S2, phone) {
  const line = weekVerdict(iso, b, S2), p = dayProfile(iso), lh = p.leaveH, r = S2[b + iso];
  const q = r ? (r.tmax != null && r.tmax <= 30 ? "cold and light" : r.tmax != null && r.tmax >= 36 ? "warm and heavy" : "medium density") : "";
  const peakH = Object.keys(p.up).map(Number).reduce((a, h) => p.up[h] > p.up[a] ? h : a, 5);
  const why = !r ? "" : `${r.snow >= 6 ? `Powder day: ${r1(r.snow)} in at ${MTS[b].name}, ${q}.` : r.snow >= 1 ? `${r1(r.snow)} in at ${MTS[b].name}, ${q}.` : `No new snow at ${MTS[b].name}.`} ${p.upPeak >= 5 ? `The drive up peaks at +${Math.round(p.upPeak)} min around ${clock(peakH)}.` : "The drive up should stay clear."}`;
  const homeH = Object.keys(p.home).map(Number).find(h => p.home[h] >= 15), homeAfter = Object.keys(p.home).map(Number).filter(h => p.home[h] >= 15).pop();
  const tags = dayTags(iso).filter(t => !/blackout/i.test(t)).map(t => `<span class="chip">${esc(t.replace(/:\s*/, " ").replace(/\s*\(.*\)$/, "").replace(/^School break Colorado$/, "Colorado school break"))}</span>`);
  ((D.model.pass_blackouts) || []).forEach(pb => (pb.dates || []).forEach(([a, z]) => { if (iso >= a && iso <= z) { const nm = (pb.pass || "").toLowerCase(), mine = nm.includes("ikon") ? S.passes.ikon : nm.includes("epic") ? S.passes.epic : false; tags.push(`<span class="chip" style="color:#9FB2C1">${esc(pb.pass.replace(" Base and Session", ""))} blackout${mine ? "" : " (not your pass)"}</span>`); } }));
  const big = phone ? 20 : 24, st = (k, v, s, c) => `<div><div class="kick">${k}</div><div class="sg" style="font-size:${big}px;font-weight:600">${v}</div><div style="font-size:12px;color:${c}">${s}</div></div>`;
  const stats = `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:${phone ? 10 : 12}px 0;border-top:1px solid #22364A;border-bottom:1px solid #22364A">
    ${st("Go to", esc(phone ? MTS[b].short : MTS[b].name), `crowd ${CROWD_WORD[crowdEst(iso)].toLowerCase()}`, "#C1B6FF")}
    ${st("Leave", lh != null && p.upPeak >= 10 ? `By ${clock(lh)}` : "Any time", lh != null && p.upPeak >= 10 ? `${plusMin(p.up[lh] || 0)} min then` : "no rush", "#9FB2C1")}
    ${st("Home", homeH != null ? `By ${clock(homeH).replace("12 PM", "noon")}` : "Any time", homeAfter != null ? `or after ${clock(homeAfter + 1)}` : "no rush", "#9FB2C1")}</div>`;
  const chips = tags.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${tags.join("")}</div>` : "";
  const kick = `<span class="kick" style="color:#7FD1FF">${dayLong(iso)} · forecast</span>`, h1 = `<h1 class="sg" style="margin:0;font-size:${phone ? 26 : 40}px;line-height:1.1;font-weight:700">${esc(line)}</h1>`;
  const whyP = why ? `<p style="margin:0;color:#C9D6E0${phone ? "" : ";font-size:16px"}">${esc(why)}</p>` : "";
  if (!phone) return `<section class="card" style="background:#13283A;border-color:#2B5573;display:flex;flex-direction:column;gap:12px;padding:24px" aria-label="${dayLong(iso)}'s call">${kick}${h1}${whyP}${stats}${chips}</section>`;
  const closed = UI.closed.has("wcall");
  return `<section class="card${closed ? " closed" : ""}" id="m-wcall" style="background:#13283A;border-color:#2B5573;display:flex;flex-direction:column;gap:10px;padding:16px" aria-label="${dayLong(iso)}'s call"><button data-tog="wcall" aria-expanded="${!closed}" style="display:flex;align-items:flex-start;gap:12px;width:100%;min-height:44px;padding:0;border:0;background:none;color:#EAF1F6;font:inherit;text-align:left;cursor:pointer"><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">${kick}${h1}</span>${PIP("k")}</button><div class="mbody" style="display:flex;flex-direction:column;gap:10px">${whyP}${stats}${chips}</div></section>`;
}
function weekPlanner(iso, b, phone) {
  const dir = UI.weekDir, M = MTS[b], share = M.eldora ? 0 : M.bands / 9, vals = [...Array(24).keys()].map(h => r1(expected(iso, dir, h) * share)), p = dayProfile(iso);
  const win = dir === "W" ? [5, 6, 7, 8, 9, 10] : [11, 12, 13, 14, 15, 16, 17, 18];
  const worst = win.reduce((a, h) => vals[h] > vals[a] ? h : a, win[0]);
  const at = dir === "W" ? (p.upPeak >= 10 && p.leaveH != null ? p.leaveH : win.reduce((a, h) => vals[h] < vals[a] ? h : a, win[0])) : win.reduce((a, h) => vals[h] < vals[a] - 0.5 ? h : a, win[0]);
  // Clear: before the road starts to build (up), or after it settles (home).
  const quiet = h => vals[h] < 3;
  let clear;
  if (dir === "W") { const firstBusy = [...Array(24).keys()].find(h => h >= 4 && !quiet(h)); clear = firstBusy == null ? ["All morning", 0] : [`Before ${firstBusy % 12 || 12}`, Math.max(0, ...[...Array(firstBusy).keys()].map(h => vals[h]).slice(-1))]; }
  else { const lastBusy = [...Array(24).keys()].filter(h => h >= 11 && !quiet(h)).pop(); clear = lastBusy == null ? ["All afternoon", 0] : [`After ${clock(lastBusy + 1).replace(":00", "").replace(/ (AM|PM)$/, "")}`, vals[Math.min(23, lastBusy + 1)]]; }
  const big = phone ? 20 : 24, st = (k, v, s, c) => `<div><div class="kick">${k}</div><div class="sg" style="font-size:${big}px;font-weight:600">${v}</div><div style="font-size:12px;color:${c}">${s}</div></div>`;
  const stats = [st(`At ${clock(at)}`, hm(M.base + vals[at]), `${plusMin(vals[at])} min`, TXT_T(tone(vals[at] / M.base))), st("Clear", clear[0], `${plusMin(clear[1])} min`, "#5BE3A1"),
    st("Worst", vals[worst] < 1 ? "None" : clock(worst), `${plusMin(vals[worst])} min`, TXT_T(tone(vals[worst] / M.base)))];
  const mx = Math.max(30, ...vals), Hp = phone ? 64 : 84;
  const bars = `<div style="height:${phone ? 90 : 110}px;display:flex;align-items:flex-end;gap:3px;border-bottom:1px solid #3A5266">${vals.map((m, h) => { const c = TONE[tone(m / M.base)];
    return `<div class="hatch" title="${clock(h)}: ${plusMin(m)} min" style="flex:1;height:${Math.max(4, Math.round(m / mx * Hp))}px;border-radius:3px 3px 0 0;color:${c};outline:${h === at ? "2px solid #EAF1F6" : "none"};outline-offset:1px"></div>`; }).join("")}</div>
    <div class="row" style="justify-content:space-between;font-size:12px;color:#9FB2C1;margin-top:${phone ? -6 : 6}px">${phone ? "<span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>" : "<span>12 AM</span><span>6 AM</span><span>Noon</span><span>6 PM</span><span>12 AM</span>"}</div>`;
  const src = trafficSource(iso), tag = (dayTags(iso)[0] || "").replace(/[:;(].*$/, "").trim();
  const other = dir === "W" ? "E" : "W", ov = [...Array(24).keys()].map(h => expected(iso, other, h) * share), ow = (other === "W" ? [5, 6, 7, 8, 9, 10] : [11, 12, 13, 14, 15, 16, 17, 18]);
  const owH = ow.reduce((a, h) => ov[h] > ov[a] ? h : a, ow[0]);
  const note = `All forecast, so all striped. ${src === "Estimate" ? `Estimate: ${tag ? `no ${tag} logged yet` : `few ${dayLong(iso)}s logged yet`}.` : `From logged ${dayLong(iso)}s.`}${phone ? "" : ` ${other === "E" ? "Heading home" : "Going up"}, the worst is ${plusMin(ov[owH])} min around ${clock(owH)}.`}${M.eldora ? " Eldora's route has no hourly model yet, so this stays flat." : ""}`;
  const seg = (d, n) => `<button data-wdir="${d}" style="height:32px;padding:0 ${phone ? 12 : 14}px;border:0;border-radius:999px;background:${dir === d ? "#EAF1F6" : "none"};color:${dir === d ? "#0E1A24" : "#9FB2C1"};font:${dir === d ? 600 : 500} 12px Inter;cursor:pointer">${n}</button>`;
  const toggle = `<div role="group" aria-label="Direction" style="display:flex;border:1px solid #22364A;border-radius:999px;padding:2px">${seg("W", phone ? "Up" : "Going up")}${seg("E", phone ? "Home" : "Heading home")}</div>`;
  const sum = `${dir === "W" ? (p.upPeak >= 10 ? `${p.leave}, ${plusMin(vals[at])} min` : "No rush going up") : `Best ${clock(at)}`} · worst ${clock(worst)}, ${plusMin(vals[worst])}`;
  if (phone) return pmod("wplan", `${dayLong(iso)} to ${esc(M.name)}`, esc(sum), `<div class="row" style="justify-content:space-between">${toggle}</div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${stats.join("")}</div>${bars}<p style="margin:0;font-size:12px;color:#9FB2C1">${esc(note)}</p>`, `${dayLong(iso)} departure planner`);
  return `<section class="card" style="display:flex;flex-direction:column;gap:14px;padding:20px 24px" aria-label="${dayLong(iso)} departure planner"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 class="sg" style="margin:0;font-size:20px;font-weight:600">${dayLong(iso)}, ${dir === "W" ? `Coors to ${esc(M.name)}` : `${esc(M.name)} to Coors`}</h2>${toggle}</div>
    <div style="display:flex;flex-wrap:wrap;gap:28px;align-items:flex-end"><div style="display:flex;gap:32px;flex:0 0 auto">${stats.join("")}</div><div style="flex:1 1 320px;min-width:0">${bars}</div></div><p style="margin:0;font-size:12px;color:#9FB2C1">${esc(note)}</p></section>`;
}
function weekCrowd(iso, b, phone) {
  const k = UI.crowdM || b, M = MTS[k], open = liftOpen(k, iso), close = M.close;
  // Arrivals estimate: the expected drive up about 2 hours earlier, on the 24-hour axis. Typical: the same weekday with no holiday lift.
  const src = h => Math.max(5, Math.min(10, h - 2)), lift = liftFor(iso);
  const fc = [...Array(24).keys()].map(h => h < Math.floor(open) - 1 || h > close ? 0 : Math.max(0, expected(iso, "W", src(h))) + 3);
  const ty = fc.map(v => v ? (v - 3) / lift + 3 : 0);
  const mx = Math.max(6, ...fc, ...ty), X = h => h * 10 + 5, Y = v => (80 - v / mx * 72).toFixed(1);
  const hrs = [...Array(24).keys()].filter(h => h >= Math.floor(open) - 1 && h <= close);
  const path = arr => hrs.map((h, i) => (i ? "L" : "M") + X(h) + " " + Y(arr[h])).join("");
  const line = path(fc), area = line + `L${X(hrs[hrs.length - 1])} 80L${X(hrs[0])} 80Z`, band = path(ty) + `L${X(hrs[hrs.length - 1])} 80L${X(hrs[0])} 80Z`;
  const peakV = Math.max(...fc), pk = hrs.filter(h => fc[h] >= peakV * 0.85), pa = pk[0], pz = pk[pk.length - 1] + 1;
  const quietH = hrs.find(h => h > pz && fc[h] < peakV * 0.5);
  const p = dayProfile(iso), driveH = Object.keys(p.up).map(Number).reduce((a, h) => p.up[h] > p.up[a] ? h : a, 5), lh = p.leaveH;
  const vs = fc.reduce((a, b) => a + b, 0) > ty.reduce((a, b) => a + b, 0) * 1.1 ? ["Busier than usual", "#FFC566"] : ["About usual", "#C1B6FF"];
  const pct = h => (h * 10 / 2.4).toFixed(2) + "%", lab = h => h % 1 ? `${Math.floor(h) % 12 || 12}:30${h < 12 ? "a" : "p"}` : clockS(h);
  const peakTxt = `${pa % 12 || 12} to ${pz % 12 || 12}`, typTxt = `Typical ${isOffDay(iso) ? "holiday " : ""}${dayLong(iso)}`;
  const say = lh != null && p.upPeak >= 10 ? `Leave by ${lh % 12 || 12} and you are on the lift before the lines build at ${pa % 12 || 12}.` : `No real rush. Lines are longest from ${peakTxt}.`;
  const tabs = `<div role="tablist" aria-label="Mountain" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">${MKEYS.map(kk => { const on = kk === k; return `<button role="tab" aria-selected="${on}" data-cm="${kk}" style="min-height:36px;padding:0 4px;border-radius:999px;border:1px solid ${on ? "#8C7FE0" : "#2C4459"};background:${on ? "#2A2550" : "transparent"};color:${on ? "#EAF1F6" : "#9FB2C1"};font:inherit;font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer">${esc(MTS[kk].short)}</button>`; }).join("")}</div>`;
  const big = phone ? 20 : 22, st = (kk, v, s, c) => `<div><div class="kick">${kk}</div><div class="sg" style="font-size:${big}px;font-weight:600">${v}</div><div style="font-size:12px;color:${c}">${s}</div></div>`;
  const stats = `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${st("Peak", peakTxt, vs[0], vs[1])}${st("Lift lines", "n/a", "no wait data yet", "#9FB2C1")}${st("Quiet", quietH != null ? `After ${quietH % 12 || 12}` : "Late", "shorter waits", "#9FB2C1")}</div>`;
  const chart = `<div style="position:relative;height:${phone ? 110 : 120}px;border-bottom:1px solid #3A5266"><svg viewBox="0 0 240 80" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" style="display:block;overflow:visible"><path d="${band}" fill="#EAF1F6" opacity=".14"></path><path d="${area}" fill="#8C7FE0" opacity=".35"></path><path d="${line}" fill="none" stroke="#C1B6FF" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"></path><line x1="${X(driveH)}" x2="${X(driveH)}" y1="0" y2="80" stroke="#FFC566" stroke-width="1.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line></svg><span style="position:absolute;top:0;left:calc(${pct(driveH + 0.5)} - 4px);transform:translateX(-100%);font-size:11px;color:#FFC566;white-space:nowrap">Drive peak</span></div>
    <div aria-label="Hours; ticks mark lift open and close" style="position:relative;height:24px;margin-top:-12px;font-size:12px;line-height:1.2;color:#9FB2C1;white-space:nowrap"><span style="position:absolute;top:6px;left:0">12a</span><span style="position:absolute;top:6px;left:25%;transform:translateX(-50%)">6a</span><span style="position:absolute;top:6px;left:50%;transform:translateX(-50%)">12p</span><span style="position:absolute;top:6px;left:75%;transform:translateX(-50%)">6p</span><span style="position:absolute;top:6px;left:100%;transform:translateX(-100%)">12a</span>
      <span style="position:absolute;top:0;left:${pct(open)};width:2px;height:5px;margin-left:-1px;background:#EAF1F6"></span><span style="position:absolute;top:6px;left:${pct(open)};transform:translateX(-50%);color:#EAF1F6;font-weight:600;background:#15232F;padding:0 2px">${lab(open)}</span><span style="position:absolute;top:0;left:${pct(close)};width:2px;height:5px;margin-left:-1px;background:#EAF1F6"></span><span style="position:absolute;top:6px;left:${pct(close)};transform:translateX(-50%);color:#EAF1F6;font-weight:600;background:#15232F;padding:0 2px">${lab(close)}</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:#9FB2C1"><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:14px;height:2px;background:#C1B6FF"></span>Forecast</span><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:14px;height:10px;border-radius:2px;background:rgba(234,241,246,.14)"></span>${esc(typTxt)}</span><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:0;height:10px;border-left:2px dashed #FFC566"></span>Drive peak</span><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:2px;height:6px;background:#EAF1F6;align-self:flex-start;margin-top:2px"></span>Lift hours</span></div>`;
  const body = `${tabs}${stats}${chart}<p style="margin:0;font-weight:600">${esc(say)}</p><p style="margin:0;font-size:12px;color:#9FB2C1">Estimated from traffic into each base area; typical comes from past traffic until the crowd log has a full season.</p>`;
  const chip = `<span class="chip" style="border-color:#4A4682;color:#C1B6FF">Estimate</span>`;
  if (phone) return pmod("wcrowd", `Crowd ${dayLong(iso)}`, `${esc(M.short)}: peak ${peakTxt}, lift waits n/a`, `<div class="row" style="justify-content:space-between;align-items:baseline;gap:8px">${chip}</div>${body}`, `${dayLong(iso)} crowd forecast`);
  return `<section class="card" style="display:flex;flex-direction:column;gap:12px;padding:20px 24px" aria-label="${dayLong(iso)} crowd forecast"><div class="row" style="justify-content:space-between;align-items:baseline;gap:8px"><h2 class="sg" style="margin:0;font-size:22px;font-weight:600">Crowd ${dayLong(iso)}</h2>${chip}</div>${body}</section>`;
}
function weekWhy(iso, S2, best, phone) {
  const b = best[iso]; if (!b) return "";
  const rs = MKEYS.map(k => S2[k + iso]).filter(Boolean).sort((x, y) => y.score - x.score), nxt = rs[1];
  const f = b.f, row = (n, v, t) => `<div class="row"><span style="width:76px;color:#9FB2C1">${n}</span><span style="flex:1;height:6px;border-radius:3px;background:#22364A"><span style="display:block;width:${Math.round(Math.max(0.03, Math.min(1, v)) * 100)}%;height:6px;border-radius:3px;background:#7FD1FF"></span></span><span style="width:${phone ? 58 : 64}px;text-align:right">${esc(t)}</span></div>`;
  const rows = `<div style="display:flex;flex-direction:column;gap:6px;font-size:12px">${row("Snow", f.snow / 40, `${r1(b.snow)} in`)}${row("Drive", 1 + f.drive / 15, b.drivePeak >= 1 ? `+${Math.round(b.drivePeak)} peak` : "clear")}${row("Wind", 1 + f.wind / 20, b.gust != null ? Math.round(b.gust) + " mph" : "n/a")}${row("Crowd", 1 + f.crowd / 9, CROWD_WORD[crowdEst(iso)])}${row("Snowy drive", 1 + f.roads / 9, f.roads ? String(f.roads).replace("-", "−") : "0")}</div>`;
  const scaleMax = Math.max(10, Math.ceil((b.hi || 0) / 5) * 5), pos = v => Math.min(100, (v || 0) / scaleMax * 100).toFixed(0);
  const models = `<div style="display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:12px;border:1px solid #22364A"><span class="kick">Snow models</span><div style="position:relative;height:20px;margin-top:4px"><span style="position:absolute;left:0;right:0;top:9px;height:2px;background:#22364A"></span><span style="position:absolute;left:${pos(b.lo)}%;width:${Math.max(2, pos(b.hi) - pos(b.lo))}%;top:5px;height:10px;border-radius:5px;background:#2A6A99"></span><span style="position:absolute;left:${pos(b.mid)}%;top:2px;width:3px;height:16px;background:#EAF1F6"></span></div>
    <div class="row" style="justify-content:space-between;font-size:12px;color:#9FB2C1"><span>0${phone ? "" : " in"}</span><span>${phone ? "" : `${b.n || 0} models: `}${phone ? "Range " : ""}${r1(b.lo || 0)}–${r1(b.hi || 0)} in, middle ${r1(b.mid || 0)}${b.rangeDay !== iso ? ` (${dayLong(b.rangeDay)})` : ""}</span><span>${scaleMax} in</span></div></div>`;
  let cmp = "";
  if (nxt) { const why = []; if (nxt.snow < b.snow - 0.5) why.push(`less snow (${r1(nxt.snow)} in)`); else if (nxt.snow > b.snow + 0.5) why.push(`more snow (${r1(nxt.snow)} in)`);
    if (nxt.drivePeak < b.drivePeak - 2) why.push(`traffic peaks at only +${Math.round(nxt.drivePeak)} min`); else if (nxt.drivePeak > b.drivePeak + 2) why.push(`a worse drive (+${Math.round(nxt.drivePeak)} peak)`);
    if ((nxt.gust || 0) > (b.gust || 0) + 8) why.push(`gusts to ${Math.round(nxt.gust)} mph`);
    cmp = ` Next best is ${MTS[nxt.k].name} at ${nxt.score}${why.length ? ": " + why.join(why.length > 1 && /^more|^less/.test(why[0]) ? " but " : " and ") : ""}.`; }
  const body = `${rows}${models}<span style="font-size:12px;color:#9FB2C1">Score ${b.score}.${cmp}</span>`;
  const title = `Why ${MTS[b.k].name} ${dayLong(iso)}`;
  if (phone) return pmod("wwhy", title, `Score ${b.score}${nxt ? ` · next best ${MTS[nxt.k].name} ${nxt.score}` : ""}`, body, title, 10);
  return `<section class="card" style="display:flex;flex-direction:column;gap:12px;padding:20px 24px" aria-label="${title}"><h2 class="sg" style="margin:0;font-size:20px;font-weight:600">${title}</h2>${body}</section>`;
}
function weekOthers(iso, S2, best, phone) {
  const rs = MKEYS.map(k => S2[k + iso]).filter(Boolean).sort((a, b) => b.score - a.score).slice(1);
  if (!rs.length) return "";
  const rows = rs.map((r, i) => `<div class="row" style="padding:${phone ? 10 : 12}px 0;${i ? "border-top:1px solid #22364A" : ""}"><span class="sg" style="font-weight:700;color:#9FB2C1;width:${phone ? 14 : 16}px">${i + 2}</span><div style="flex:1"><div style="font-weight:600">${esc(MTS[r.k].name)}</div><div style="font-size:12px;color:#9FB2C1">${r1(r.snow)} in${phone || r.lo == null ? "" : ` (${r1(r.lo)}–${r1(r.hi)})`} · ${phone ? "peak" : "traffic peak"} +${Math.round(r.drivePeak)} · gusts ${r.gust != null ? Math.round(r.gust) : "n/a"}</div></div><span class="chip" style="border-color:#4A4682;color:#C1B6FF">Crowd ${CROWD_WORD[crowdEst(iso)].toLowerCase()}</span><span class="sg" style="font-weight:600;width:${phone ? 24 : 28}px;text-align:right">${r.score}</span></div>`).join("");
  if (phone) { const closed = UI.closed.has("wother");
    return `<section class="card${closed ? " closed" : ""}" id="m-wother" style="display:flex;flex-direction:column;padding:6px 16px" aria-label="Other mountains ${dayLong(iso)}"><button data-tog="wother" aria-expanded="${!closed}" style="${HEADBTN}"><span style="flex:1;min-width:0"><span class="sg" style="display:block;font-size:20px;font-weight:600">Other mountains</span><span style="display:block;font-size:12px;color:#9FB2C1;margin-top:2px">${rs.map(r => `${MTS[r.k].name} ${r.score}`).join(" · ")}</span></span>${PIP()}</button><div class="mbody" style="display:flex;flex-direction:column;gap:0">${rows}</div></section>`; }
  return `<section class="card" style="display:flex;flex-direction:column;gap:0;padding:8px 24px" aria-label="Other mountains ${dayLong(iso)}">${rows}</section>`;
}

// ---- History ---------------------------------------------------------------------------------------------------
const HIST = {}, CSV = {};
const parseCSV = t => { const L = t.trim().split(/\r?\n/); if (L.length < 2) return []; const H = L[0].split(","); return L.slice(1).map(l => { const v = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(x => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')); return Object.fromEntries(H.map((h, i) => [h, v[i]])); }); };
async function histMonth(m) { if (!HIST[m]) HIST[m] = fetch(BASE + `history/${m}.json`, { cache: "no-store" }).then(r => r.ok ? r.json() : { days: {} }).catch(() => ({ days: {} })); return HIST[m]; }
async function csvMonth(dir, m) { const k = dir + m; if (!CSV[k]) CSV[k] = fetch(BASE + `${dir}/${m}.csv`, { cache: "no-store" }).then(r => r.ok ? r.text() : "").then(parseCSV).catch(() => []); return CSV[k]; }
async function loadHistory(iso) { const m = iso.slice(0, 7); const [h, st, sn] = await Promise.all([histMonth(m), csvMonth("resort_status", m), csvMonth("snotel", m)]); return { day: (h.days || {})[iso] || null, st, sn }; }
function renderHistory(H) {
  const iso = UI.histDay, day = H && H.day, today = nowParts().iso;
  const phone = isPhone(), dn = dayMed(iso).replace(",", ""), tagChips = dayTags(iso).filter(t => !/blackout/i.test(t)).map(t => `<span class="chip">${esc(t.replace(/:\s*/, " ").replace(/\s*\(.*\)$/, "").replace(/^School break Colorado$/, "Colorado school break"))}</span>`);
  ((D.model.pass_blackouts) || []).forEach(pb => (pb.dates || []).forEach(([a, z]) => { if (iso >= a && iso <= z) { const nm = (pb.pass || "").toLowerCase(), mine = nm.includes("ikon") ? S.passes.ikon : nm.includes("epic") ? S.passes.epic : false; tagChips.push(`<span class="chip" style="color:#9FB2C1">${esc(pb.pass.replace(" Base and Session", ""))} blackout${mine ? "" : " · not your pass"}</span>`); } }));
  const nav = `<button class="ibtn" data-hday="-1" aria-label="Previous day"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg></button>
    <div style="${phone ? "flex:1;" : "min-width:180px;"}text-align:center;line-height:1.2"><div class="sg" style="font-size:22px;font-weight:600">${dn}</div><div style="font-size:12px;color:#9FB2C1">${iso === addDays(today, -1) ? "Yesterday · logged" : "Logged"}</div></div>
    <button class="ibtn" data-hday="1" aria-label="Next day" ${addDays(iso, 1) >= today ? "disabled style='opacity:.4'" : ""}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg></button>
    <label class="ibtn" aria-label="Pick a date" style="position:relative;overflow:hidden;cursor:pointer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg><input type="date" id="hdate" value="${iso}" max="${addDays(today, -1)}" min="${D.model.first_day || ""}" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>`;
  const picker = phone ? `<div class="row" style="justify-content:space-between;gap:8px">${nav}</div>${tagChips.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${tagChips.join("")}</div>` : ""}`
    : `<div class="row" style="justify-content:space-between;gap:16px;flex-wrap:wrap"><div class="row" style="gap:12px">${nav}</div><div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end">${tagChips.join("")}</div></div>`;
  if (!H) return picker + `<div class="skel">Loading ${dayMed(iso)}…</div>`;
  if (!day) return picker + `<div class="card"><p class="muted" style="margin:0">Nothing logged for ${dayMed(iso)}. The logger started ${dayMed(D.model.first_day || iso)}.</p></div>`;
  const worstIn = (dir, a, b, rk) => { let w = null; for (let h = a; h < b; h++) { const v = loggedAt(day, dir, h, rk); if (v != null && (!w || v > w.v)) w = { h, v }; } return w; };
  const up = worstIn("W", 5, 11), home = worstIn("E", 11, 19), mx = Math.max(up ? up.v : 0, home ? home.v : 0);
  const head = mx < 2 ? "Roads stayed empty. Any hour would have worked." : mx / 90 < 0.12 ? "An easy day on the roads." : up && up.v >= (home ? home.v : 0) ? `A real rush going up: +${Math.round(up.v)} min at ${clock(up.h)}.` : `A real jam coming home: +${Math.round(home.v)} min at ${clock(home.h)}.`;
  const snowDay = k => { const rows = H.sn.filter(r => r.resort === k && (r.obs_time_mst || "").startsWith(iso)).map(r => num(r.depth_in)).filter(v => v != null); return rows.length ? Math.max(0, rows[rows.length - 1] - rows[0]) : null; };
  const hiDay = k => { const rows = H.sn.filter(r => r.resort === k && (r.obs_time_mst || "").startsWith(iso)).map(r => num(r.temp_f)).filter(v => v != null); return rows.length ? Math.round(Math.max(...rows)) : null; };
  const depthDay = k => { const rows = H.sn.filter(r => r.resort === k && (r.obs_time_mst || "").startsWith(iso)).map(r => num(r.depth_in)).filter(v => v != null); return rows.length ? rows[rows.length - 1] : null; };
  const liftsDay = k => (H.st.filter(r => r.resort === k && (r.checked_at || "").startsWith(iso)).pop() || {}).lifts || null;
  const snows = MKEYS.map(snowDay).filter(v => v != null), his = MKEYS.map(hiDay).filter(v => v != null);
  const sumBody = `<p style="margin:0;color:var(--ink3)">${up ? `The worst drive up was +${Math.round(up.v)} min at ${clock(up.h)}` : "No drive-up hours logged"}${home ? `, and the drive home peaked at +${Math.round(home.v)} min at ${clock(home.h)}` : ""}. ${snows.some(v => v >= 1) ? `New snow: up to ${Math.max(...snows)} in.` : "No new snow anywhere."}${his.length ? ` Highs ran ${Math.min(...his)} to ${Math.max(...his)}°F.` : ""}</p>
    <div class="stats" style="padding-top:10px;border-top:1px solid var(--line)"><div><div class="kick">Up to Copper</div><div class="big">${hm(90 + (up ? up.v : 0))}</div><div class="sub ${tone((up ? up.v : 0) / 90)}">+${Math.round(up ? up.v : 0)} at worst</div></div>
      <div><div class="kick">Home</div><div class="big">${hm(90 + (home ? home.v : 0))}</div><div class="sub ${tone((home ? home.v : 0) / 90)}">+${Math.round(home ? home.v : 0)} at worst</div></div>
      <div><div class="kick">Crowd</div><div class="big v">n/a</div><div class="sub muted">crowd log starts with 2.0</div></div></div>`;
  const summary = mod("hsum", `<h1 class="call" style="font-size:26px">${esc(head)}</h1>`, "", sumBody, { call: true, cls: "call", label: "Day summary", kick: `<span class="kick">${esc((dayTags(iso)[0] || dayLong(iso)).replace(/:.*$/, ""))} · logged</span>` });
  // Planner, logged
  const k = UI.histM, dir = UI.histDir, rk = MTS[k].eldora ? "eldora_boulder" : null, base = MTS[k].eldora ? 66 : MTS[k].base;
  const vals = [...Array(24).keys()].map(h => loggedAt(day, dir, h, rk));
  const win = dir === "W" ? [5, 11] : [11, 19], inW = [...Array(win[1] - win[0]).keys()].map(i => i + win[0]).filter(h => vals[h] != null);
  const bH = inW.length ? inW.reduce((a, h) => vals[h] < vals[a] - 0.5 ? h : a, inW[0]) : null, wH = inW.length ? inW.reduce((a, h) => vals[h] > vals[a] ? h : a, inW[0]) : null;
  const all = vals.map((v, h) => [h, v]).filter(x => x[1] != null), pk = all.length ? all.reduce((a, x) => x[1] > a[1] ? x : a) : null;
  const hseg = `<div class="seg" role="group" aria-label="Direction" style="align-self:flex-start"><button data-hdir="W" class="${dir === "W" ? "on" : ""}">Going up</button><button data-hdir="E" class="${dir === "E" ? "on" : ""}">Heading home</button></div>`;
  const pBody = `${phone ? hseg : ""}
    <div class="mpills" role="tablist">${MKEYS.map(kk => `<button data-hm="${kk}" class="${kk === k ? "on" : ""}">${esc(MTS[kk].short)}</button>`).join("")}</div>
    <div class="stats"><div><div class="kick">Best</div><div class="big">${bH != null ? clock(bH) : "n/a"}</div><div class="sub g">${bH != null ? "+" + Math.round(vals[bH]) + " min" : ""}</div></div>
      <div><div class="kick">Worst</div><div class="big">${wH != null ? clock(wH) : "n/a"}</div><div class="sub ${wH != null ? tone(vals[wH] / base) : ""}">${wH != null ? "+" + Math.round(vals[wH]) + " min" : ""}</div></div>
      <div><div class="kick">Day's peak</div><div class="big">${pk ? "+" + Math.round(pk[1]) : "n/a"}</div><div class="sub muted">${pk ? "at " + clock(pk[0]) : ""}</div></div></div>
    ${barsHTML(vals, { H: 96, base, logged: () => true })}
    <p class="small muted" style="margin:0">All logged, so all solid. Best and worst cover the ski window (${dir === "W" ? "5 to 11 AM" : "11 AM to 7 PM"}); day's peak covers all 24 hours.${rk ? "" : " A-Basin and Winter Park use the I-70 log for now."}</p>`;
  const planner = mod("hdrive", `${dayLong(iso)}, ${dir === "W" ? `Coors to ${esc(MTS[k].name)}` : `${esc(MTS[k].name)} to Coors`}`, bH != null ? `Best ${clock(bH)} · worst ${clock(wH)}, +${Math.round(vals[wH])}` : "No logged hours in the window", pBody, { label: "Drive by hour", right: phone ? "" : hseg });
  const mBody = `<ul class="plain">${MKEYS.map(kk => { const sd = snowDay(kk), l = liftsDay(kk), dp = depthDay(kk), hi = hiDay(kk), w = (() => { let m = null; for (let h = 5; h < 11; h++) { const v = loggedAt(day, "W", h, MTS[kk].eldora ? "eldora_boulder" : null); if (v != null && (m == null || v > m)) m = v; } return m; })();
      return `<li><button data-hm="${kk}" class="row" style="width:100%;border:0;background:${kk === k ? "#13283A" : "none"};border-radius:10px;padding:6px 8px;text-align:left;cursor:pointer"><span style="flex:1;min-width:0"><b>${esc(MTS[kk].name)}</b><span class="small muted" style="display:block">${esc(MTS[kk].route)} · ${l ? esc(l) + " lifts" : "no lift report"} · ${sd != null ? sd + " in new" : "no snow reading"}${dp != null ? ", " + dp + " in base" : ""}${hi != null ? " · high " + hi + "°F" : ""}</span></span><span class="chip" style="border-color:#4A4682;color:#C1B6FF;flex:none">Crowd n/a</span><span style="text-align:right;flex:none;min-width:56px"><b class="sg" style="color:${w != null ? TXT_T(tone(w / MTS[kk].base)) : "#9FB2C1"}">${w != null ? "+" + Math.round(w) : "n/a"}</b><span style="display:block;font-size:12px;color:${w != null ? TXT_T(tone(w / MTS[kk].base)) : "#9FB2C1"}">worst up</span></span></button></li>`; }).join("")}</ul>
    <p class="small muted" style="margin:0">These are ${dayLong(iso)}'s values, not today's.</p>`;
  const liftAt = (H.st.filter(r => (r.checked_at || "").startsWith(iso)).pop() || {}).checked_at;
  const mts = mod("hmtn", "Mountains that day", `Lifts, snow and highs as of ${dayLong(iso)}${phone && liftAt ? `<span style="display:block;margin-top:8px">Lifts at ${fmtTime(liftAt)}</span>` : ""}`, mBody, { label: "Mountains that day", right: phone || !liftAt ? "" : `<span style="font-size:12px;color:#9FB2C1;white-space:nowrap">Lifts at ${fmtTime(liftAt)}</span>` });
  if (phone) return picker + summary + planner + mts + renderModelDid(iso);
  return picker + `<div class="grid2"><div class="col" style="flex:1.2 1 520px">${summary}${planner}</div><div class="col">${renderModelDid(iso)}${mts}</div></div>`;
}
function renderModelDid(iso) {
  const p = (D.daily_predictions || {})[iso], dumb = (name, pr, lg, err) => { const x = v => (Math.min(v, 60) / 60 * 100).toFixed(1) + "%", lo = Math.min(pr, lg), hi = Math.max(pr, lg);
    return `<li style="display:grid;grid-template-columns:minmax(0,1fr) 72px;gap:4px 10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)"><span class="small" style="color:var(--ink3)">${esc(name)}</span><span class="small" style="text-align:right;color:${err >= 15 ? "var(--ambert)" : "var(--ink2)"}">off ${r1(err)} min</span>
      <span style="grid-column:1 / -1;position:relative;height:14px"><span style="position:absolute;left:0;right:0;top:6px;height:2px;background:var(--line)"></span><span style="position:absolute;left:${x(lo)};width:calc(${x(hi)} - ${x(lo)});top:6px;height:2px;background:#5A7184"></span>
      <span title="Predicted +${pr}" style="position:absolute;left:${x(pr)};top:1px;width:12px;height:12px;margin-left:-6px;border-radius:50%;border:2px solid #9FB2C1;background:#15232F;box-sizing:border-box"></span><span title="Logged +${lg}" style="position:absolute;left:${x(lg)};top:1px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:#7FD1FF"></span></span></li>`; };
  const legend = `<div class="row small muted" style="justify-content:space-between;margin-top:-4px"><span>+0</span><span>+30</span><span>+60 min</span></div><div class="row small muted" style="gap:14px;flex-wrap:wrap"><span class="row" style="gap:6px"><span style="width:10px;height:10px;border-radius:50%;border:2px solid #9FB2C1;box-sizing:border-box"></span>Predicted peak</span><span class="row" style="gap:6px"><span class="dot" style="background:#7FD1FF"></span>Logged peak</span></div>`;
  let body;
  if (p && p.result && Object.keys(p.result).length) {
    const rows = [["W", "Drive up, 5 to 11 AM"], ["E", "Drive home, 11 AM to 7 PM"]].filter(([d]) => p.result[d]).map(([d, n]) => dumb(n, Math.round(p.result[d].pred_peak[1]), Math.round(p.result[d].logged_peak[1]), p.result[d].error_min)).join("");
    body = `<div class="row" style="justify-content:space-between;align-items:baseline"><span class="kick">${p.late ? "Forecast made the same day" : "Forecast made the evening before"}</span><span class="small muted">Off by <b class="sg" style="color:var(--ink);font-size:16px">${r1(p.mean_error_min)}</b> min on average</span></div><ul class="plain">${rows}</ul>${legend}`;
  } else {
    const g = (D.model.graded || []).slice(-1)[0];
    body = `<div style="padding:10px 12px;border-radius:12px;background:#2A2416;border:1px solid #7A6A35;font-size:13px;color:#F3E3B5"><b style="color:var(--ambert)">No forecast to grade for ${dayLong(iso)}.</b> ${iso < "2026-11-28" ? "Daily forecasts started with 2.0 on Nov 27; before that the model only forecast weekend windows." : p ? "It grades after the day is fully logged." : "No forecast was saved for this day."}</div>` +
      (g ? `<div class="row" style="justify-content:space-between;align-items:baseline;flex-wrap:wrap"><span class="kick">Last graded weekend: ${esc(dayMed(g.weekend))}</span><span class="small muted">Off by <b class="sg" style="color:var(--ink);font-size:16px">${r1(g.mean_error_min)}</b> min on average</span></div>
        <ul class="plain small">${Object.entries(g.error_min || {}).filter(([kk]) => !kk.includes(":")).map(([kk, v]) => `<li class="row" style="justify-content:space-between;padding:6px 0"><span class="muted">${esc({ fri_pm_W: "Fri evening, up", sat_am_W: "Sat morning, up", sun_am_W: "Sun morning, up", sat_pm_E: "Sat afternoon, home", sun_pm_E: "Sun afternoon, home" }[kk] || kk)}</span><span style="color:${v >= 15 ? "var(--ambert)" : "inherit"}">off ${r1(v)} min</span></li>`).join("")}</ul>
        ${(() => { const LBL = { fri_pm_W: "Friday evening going up", sat_am_W: "Saturday morning going up", sun_am_W: "Sunday morning going up", sat_pm_E: "Saturday afternoon coming home", sun_pm_E: "Sunday afternoon coming home" }; const miss = Object.entries(g.error_min || {}).filter(([kk, v]) => !kk.includes(":") && v >= 15).sort((a, b) => b[1] - a[1]);
          return `${miss.length ? `<p style="margin:0;font-size:14px;color:#C9D6E0">Biggest misses: ${miss.map(([kk, v]) => `${LBL[kk] || kk} (off ${Math.round(v)} min)`).join(" and ")}. Crowd predictions get graded here too once the crowd log has a season.</p>` : ""}<a href="#history" data-hgo="${g.weekend}" style="font-size:12px;font-weight:600">Open ${esc(dayMed(g.weekend).replace(",", ""))} ›</a>`; })()}` : "");
  }
  return mod("hmodel", "How the model did", p && p.mean_error_min != null ? `Off by ${r1(p.mean_error_min)} min on average` : `No forecast to grade for ${dayLong(iso)}`, body, { label: "How the model did" });
}

// ---- Data -------------------------------------------------------------------------------------------------------
function renderData() {
  const m = D.model, conf = Math.round((m.confidence || 0) * 100), cov = m.coverage || {}, src = D.sources || {};
  const prev = PREV.data, days = m.days_logged || 0, errs = src.errors_48h || {}, errN = Object.values(errs).reduce((a, b) => a + b, 0);
  const typDays = (m.daily || []).filter(x => x.typical && x.win.some(Boolean)).length;
  const crowdOn = Object.keys(D.crowd || {}).length > 0;
  const since = `<ul class="plain small">${[
    [prev ? (days - prev.days > 0 ? "g" : "n") : "n", prev ? `<b>${days - prev.days >= 0 ? "+" : ""}${days - prev.days} days logged</b> since ${esc(fmtDayTime(prev.at))}` : `<b>${days} days logged</b> since ${esc(dayMed(m.first_day || ""))}`],
    ["n", prev && prev.conf !== conf ? `Traffic model <b>${prev.conf}% → ${conf}%</b> trained` : `Traffic model still <b>${conf}%</b> trained${dayInfo(nowParts().iso).type !== "typical" ? ": special days don't count toward the weekly pattern" : ""}`],
    [errN ? "a" : "g", errN ? `${errN} fetch error${errN > 1 ? "s" : ""} in the last 48 hours (${Object.entries(errs).map(([k, v]) => `${esc(k)} ${v}`).join(", ")}), each retried on the next run` : "No fetch errors in the last 48 hours"]]
    .map(([t, h]) => `<li class="row" style="gap:10px;padding:5px 0;border:0"><span class="dot" style="width:8px;height:8px;background:${t === "n" ? "#9FB2C1" : TONE[t]}"></span><span>${h}</span></li>`).join("")}</ul>`;
  const barRow = (name, pct, sub, col) => `<div style="display:flex;flex-direction:column;gap:4px"><div class="row" style="justify-content:space-between;align-items:baseline"><b>${name}</b><span class="sg" style="font-size:22px;font-weight:700;color:${col}">${pct}%</span></div><div style="height:8px;border-radius:4px;background:var(--line)"><div style="width:${Math.max(1, pct)}%;height:8px;border-radius:4px;background:${col}"></div></div><span class="small muted">${sub}</span></div>`;
  const rcov = Object.values(m.routes || {}).map(r => Object.values(r.coverage || {}).map(c => Math.min(1, (c.n || 0) / 6))).flat(), rconf = rcov.length ? Math.round(rcov.reduce((a, b) => a + b, 0) / rcov.length * 100) : 0;
  const lastG = (m.graded || []).slice(-1)[0], dg = Object.values(D.daily_predictions || {}).filter(p => p.mean_error_min != null), dErr = dg.length ? r1(dg.reduce((a, p) => a + p.mean_error_min, 0) / dg.length) : null;
  const smart = barRow("Traffic, I-70", conf, `${Math.round(conf / 100 * 42)} of 42 typical days logged (6 of each weekday window). Holidays and breaks don't count.`, "#7FD1FF") +
    barRow("Alternate routes", rconf, "Weekend windows on each alternate, 6 typical weekends each.", "#7FD1FF") +
    barRow("Crowd", crowdOn ? 1 : 0, crowdOn ? "Last-mile traffic and A-Basin's base camera are logging. Parking comes next; app lift waits are skipped (app-only)." : "Starts with the first crowd reading (last-mile traffic trial).", "#8C7FE0") +
    `<div class="row" style="justify-content:space-between;padding-top:8px;border-top:1px solid var(--line)"><span class="small" style="color:var(--ink3)">${dErr != null ? `Accuracy, ${dg.length} graded day${dg.length > 1 ? "s" : ""}` : "Accuracy, last graded weekend"}</span><span><b class="sg" style="font-size:18px">${dErr != null ? dErr : lastG ? r1(lastG.mean_error_min) : "n/a"} min</b> <span class="small muted">off on average</span> <a href="#history" class="small" style="font-weight:600">History ›</a></span></div>`;
  // Training progress: running confidence after each logged day, plus where it heads at this pace.
  const counts = {}, series = (m.daily || []).map(x => { const dow = pyDow(x.d); if (x.typical) ["amW", "pmW", "pmE"].forEach((w, j) => { if (x.win[j]) counts[dow + "-" + w] = (counts[dow + "-" + w] || 0) + 1; });
    let s = 0; for (let d = 0; d < 7; d++) ["amW", "pmW", "pmE"].forEach(w => { s += Math.min(1, (counts[d + "-" + w] || 0) / 6); }); return [x.d, s / 21]; });
  const d0 = m.first_day || nowParts().iso, d1 = addDays(d0, 92), span = 92, X = iso => Math.max(0, Math.min(300, (Date.parse(iso) - Date.parse(d0)) / 864e5 / span * 300));
  const pth = series.map(([d, v], i) => `${i ? "L" : "M"}${X(d).toFixed(1)} ${(100 - v * 100).toFixed(1)}`).join("");
  const hols = (m.holidays || []).filter(([a, b]) => b >= d0 && a <= d1).map(([a, b]) => `<rect x="${X(a).toFixed(1)}" y="0" width="${Math.max(1, X(b) - X(a) + 300 / span).toFixed(1)}" height="100" fill="#F5B841" opacity=".08"></rect>`).join("");
  const perWeek = typDays && series.length ? (series[series.length - 1][1]) / Math.max(1, (Date.parse(series[series.length - 1][0]) - Date.parse(d0)) / 6048e5) : 0;
  const weeksLeft = perWeek > 0 ? (1 - (series.length ? series[series.length - 1][1] : 0)) / perWeek : null, eta = weeksLeft != null ? addDays(nowParts().iso, Math.round(weeksLeft * 7 * 1.25)) : null;
  const curV = series.length ? series[series.length - 1][1] : 0, tX = X(nowParts().iso);
  const prog = `<div style="position:relative;height:${isPhone() ? 200 : 260}px;border-bottom:1px solid #3A5266;border-left:1px solid var(--line)"><svg viewBox="0 0 300 100" preserveAspectRatio="none" width="100%" height="100%" style="display:block;overflow:visible" aria-label="Training progress">${hols}
      <line x1="0" x2="300" y1="50" y2="50" stroke="#22364A" vector-effect="non-scaling-stroke"></line><path d="${pth}${series.length ? ` L${X(series[series.length - 1][0]).toFixed(1)} 100 L0 100 Z` : ""}" fill="#7FD1FF" opacity=".18"></path>
      <path d="${pth}" fill="none" stroke="#7FD1FF" stroke-width="2.5" vector-effect="non-scaling-stroke"></path>${eta && series.length ? `<path d="M${X(series[series.length - 1][0]).toFixed(1)} ${(100 - series[series.length - 1][1] * 100).toFixed(1)} L${X(eta).toFixed(1)} 0" fill="none" stroke="#7FD1FF" stroke-width="1.5" stroke-dasharray="4 4" opacity=".7" vector-effect="non-scaling-stroke"></path>` : ""}<line x1="${tX.toFixed(1)}" x2="${tX.toFixed(1)}" y1="0" y2="100" stroke="#EAF1F6" stroke-width="1" opacity=".6" vector-effect="non-scaling-stroke"></line></svg>
      <span style="position:absolute;top:2px;left:calc(${(tX / 3).toFixed(1)}% + 6px);font-size:11px;font-weight:600;color:#EAF1F6;white-space:nowrap">Today ${Math.round(curV * 100)}%</span>
      <span style="position:absolute;right:2px;top:-2px;font-size:11px;color:var(--ink2)">100%</span><span style="position:absolute;right:2px;top:calc(50% - 8px);font-size:11px;color:var(--ink2)">50%</span></div>
    <div class="axis" style="margin-top:-8px"><span style="left:0">${dayMed(d0).replace(/^\w+, /, "")}</span><span style="left:50%">${dayMed(addDays(d0, 46)).replace(/^\w+, /, "")}</span><span style="left:100%">${dayMed(d1).replace(/^\w+, /, "")}</span></div>
    <div class="row small muted" style="gap:14px;flex-wrap:wrap"><span class="row" style="gap:6px"><span style="width:14px;height:3px;background:#7FD1FF"></span>Logged</span><span class="row" style="gap:6px"><span style="width:14px;border-top:2px dashed #7FD1FF"></span>Projected</span><span class="row" style="gap:6px"><span style="width:12px;height:10px;background:rgba(245,184,65,.25)"></span>Holidays and breaks (don't count)</span></div>`;
  // Coverage grid
  const cell = (n, col = "#7FD1FF") => `<span title="${n} of 6 days" style="position:relative;display:flex;align-items:center;justify-content:center;height:28px;border-radius:8px;background:#1A2A38;overflow:hidden"><span style="position:absolute;left:0;top:0;bottom:0;width:${Math.round(Math.min(n, 6) / 6 * 100)}%;background:${col};opacity:.35"></span><span style="position:relative;font-size:12px;font-weight:600;color:${n ? "#EAF1F6" : "#5A7184"}">${n}/6</span></span>`;
  const rcount = w => Object.values(m.routes || {}).map(r => ((r.coverage || {})[w] || {}).n || 0);
  const altN = dow => dow === 5 ? Math.min(...rcount("sat_am")) : dow === 6 ? Math.min(...rcount("sun_am")) : 0;
  const special = t => ((m.day_types || {})[t] || {}).days ? m.day_types[t].days.length : 0;
  const crowdDays = 0, phone = isPhone(), ccols = phone ? 1 : 4;
  const gtc = `grid-template-columns:${phone ? "96px" : "130px"} repeat(${2 + ccols},minmax(0,1fr))`;
  const rows = [["Mon", 0], ["Tue", 1], ["Wed", 2], ["Thu", 3], ["Fri", 4], ["Sat", 5], ["Sun", 6]].map(([n, d]) => [n, (cov[d + "-amW"] || {}).n || 0, altN(d)])
    .concat([null, ["Holiday", special("holiday"), special("holiday")], ["School break", special("break"), special("break")], ["Storm or closure", special("disrupted"), special("disrupted")], ["Powder day", ((m.conditions_seen || {}).powder || []).length, 0]]);
  const grp = `<div style="display:grid;${gtc};gap:4px;font-size:11px;font-weight:600;letter-spacing:.1em;color:var(--ink2)"><span></span><span style="grid-column:span 2;text-align:center;border-bottom:1px solid var(--line);padding-bottom:3px">TRAFFIC</span><span style="grid-column:span ${ccols};text-align:center;border-bottom:1px solid var(--line);padding-bottom:3px;color:var(--violett)">CROWD</span></div>`;
  const grid = grp + `<div style="display:grid;${gtc};gap:4px;font-size:12px;font-weight:600;color:var(--ink2)"><span></span><span style="text-align:center">I-70</span><span style="text-align:center">Alternates</span>${phone ? '<span style="text-align:center">Crowd</span>' : MKEYS.map(k => `<span style="text-align:center;color:var(--violett)">${esc(MTS[k].short)}</span>`).join("")}</div>` +
    rows.map(r => r ? `<div style="display:grid;${gtc};gap:4px;align-items:center"><span style="font-size:13px">${r[0]}</span>${cell(r[1])}${cell(r[2])}${[...Array(ccols)].map(() => cell(crowdDays, "#8C7FE0")).join("")}</div>` : `<div style="height:1px;background:var(--line);margin:4px 0"></div>`).join("");
  // Sources
  const age = iso => iso ? (Date.now() - Date.parse(iso)) / 6e4 : null;
  const tt = src.tomtom_use || {}, month = nowParts().iso.slice(0, 7), ttCalls = ["routing", "flow", "crowd"].reduce((a, k) => a + (((tt[k] || {})[month]) || 0), 0), dayOfMonth = +nowParts().iso.slice(8);
  const srcRows = [["TomTom routes and stretches", "Every 15 min", src.tomtom_routing, `about ${Math.round(ttCalls / Math.max(1, dayOfMonth))} of 2,500 free calls a day`, "routes"],
    ["CDOT speeds and travel times", "Every 15 min", src.last_run, "", "cdot"], ["NWS forecast", "Hourly", src.forecast, "", "forecast"], ["Open-Meteo outlook", "Every 3 hours", src.outlook, "", "outlook"],
    ["SNOTEL snow", "Hourly", src.snotel ? src.snotel.replace(" ", "T") + ":00-07:00" : null, "", "snotel"], ["Resort lifts and trails", "Twice a day", null, (D.status || {}).checked || "", "resort_status"],
    ["COtrip cameras", "Daily", src.cameras, "", "cameras"]].map(([n, cad, at, x, key]) => { const e = errs[key] || 0, a = age(at), st = e >= 3 ? "a" : a != null && a > 240 && !/Daily|Twice/.test(cad) ? "a" : "g";
      return `<li class="row" style="gap:10px;align-items:flex-start"><span class="dot" style="width:8px;height:8px;margin-top:6px;background:${TONE[st]}"></span><span style="flex:1;min-width:0"><b style="display:block">${n}</b><span class="small muted">${cad}${at ? " · " + esc(fmtDayTime(at)) : ""}${x ? " · " + esc(x) : ""}${e ? ` · ${e} error${e > 1 ? "s" : ""} in 48 h, retried` : ""}</span></span><span class="small" style="font-weight:600;color:${TONE_T[st]}">${st === "g" ? "OK" : "Flaky"}</span></li>`; }).join("") +
    (() => { const cs = src.crowd_sources || [], on = cs.filter(c => c.status === "trial").map(c => ({ last_mile: "last mile", cameras: "cameras" })[c.key] || c.key), next = cs.filter(c => c.status === "not yet").map(c => ({ parking: "parking" })[c.key] || c.key), skip = cs.filter(c => c.status === "skipped").map(c => ({ app_waits: "app lift waits" })[c.key] || c.key);
      const st = on.length ? (crowdOn ? "g" : "a") : "n";
      return `<li class="row" style="gap:10px;align-items:flex-start"><span class="dot" style="width:8px;height:8px;margin-top:6px;background:${st === "n" ? "#5A7184" : TONE[st]}"></span><span style="flex:1;min-width:0"><b style="display:block">Crowd: ${esc([...on, ...next].join(", "))}</b><span class="small muted">${on.length ? `${esc(on.join(" and "))} trial: last mile every 30 min, cameras hourly` : "Not started"}${next.length ? ` · ${esc(next.join(", "))} next` : ""}${skip.length ? ` · ${esc(skip.join(", "))} skipped` : ""}${src.crowd ? " · " + esc(fmtDayTime(src.crowd)) : ""}</span></span><span class="small" style="font-weight:600;color:${st === "n" ? "#9FB2C1" : TONE_T[st]}">${st === "g" ? "Trial" : st === "a" ? "Waiting" : "Not yet"}</span></li>`; })();
  // Calendar and conditions
  const today = nowParts().iso, up = (m.holidays || []).filter(([a, b]) => b >= today).slice(0, 4);
  const md = iso => dayMed(iso).replace(/^\w+, /, "");
  const cal = `<ul class="plain">${up.map(([a, b, n]) => `<li class="row" style="justify-content:space-between"><span><b style="display:block">${esc(n)}</b><span class="small muted">${md(a)} to ${md(b)}</span></span><span class="chip">Holiday</span></li>`).join("")}</ul>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px;padding-top:8px;border-top:1px solid var(--line)">${(m.pass_blackouts || []).map(pb => { const nm = (pb.pass || "").toLowerCase(), mine = nm.includes("ikon") ? S.passes.ikon : nm.includes("epic") ? S.passes.epic : false;
        const ours = /Copper, Winter Park, A-Basin and Eldora have no blackouts/i.test(pb.where || "");
        const ds = (pb.dates || []).filter(([a, b]) => b >= today).slice(0, 3).map(([a, b]) => `${md(a)} to ${md(b)}`).join(", ");
        return `<span class="muted">${esc(pb.pass.replace(" Base and Session", ""))}</span><span>${ours ? "No blackouts at Copper, Winter Park, A-Basin or Eldora" : `Blackouts ${esc(ds || "none left this season")}`}${mine ? "" : " · not your pass"}</span>`; }).join("")}
      <span class="muted">Seen so far</span><span>${Object.entries(m.conditions_seen || {}).filter(([, v]) => v.length).map(([k, v]) => `${v.length} ${k === "disrupted" ? "storm or closure" : k} weekend${v.length > 1 ? "s" : ""}`).join(", ") || "Nothing special yet"}</span></div>`;
  const FDESC = { "dashboard.json": ["Everything the page shows, one file · Every run", 1], travel: ["CDOT travel times · 15 min"], routes: ["TomTom trip times, every route · 15 min"], speed: ["Speeds by stretch · 15 min"], forecast: ["NWS forecasts as issued · Hourly"],
    snotel: ["Snow depth and temps · Hourly"], outlook: ["Five-model snow outlook · Every 3 hours"], history: ["Delay by hour, every day · Daily"], "traffic_model.json": ["Model, coverage and grades · Daily"], crowd: ["Crowd readings by source · 30 min", 1],
    "daily_predictions.json": ["Each day's forecast and its grade · Daily", 1], errors: ["Every failed fetch · As they happen"], events: ["COtrip closures and traction laws · 15 min"], road_conditions: ["CDOT road surface reports · When they change"], resort_status: ["Lifts and trails · Twice a day"],
    "cameras.json": ["COtrip camera list · Daily"], "calendar.json": ["Holidays, breaks and blackouts"], "resort_status.json": ["Latest lifts and trails"], "routes_now.json": ["Latest trip times with route shapes · 15 min"], "outlook.json": ["Latest five-model outlook"], "recent.json": ["Last 14 days, by hour"], "state.json": ["Logger state between runs"] };
  const ORDER = ["dashboard.json", "travel", "routes", "speed", "forecast", "snotel", "outlook", "history", "traffic_model.json", "crowd", "daily_predictions.json", "errors"];
  const fkey = pth => FDESC[pth] ? pth : pth.split("/")[0];
  const flist = [{ path: "dashboard.json", bytes: null }].concat((D.files || []).filter(f => /\.[a-z]+$/.test(f.path) && f.path !== "dashboard.json"))
    .filter(f => ORDER.includes(fkey(f.path))).sort((a, b) => ORDER.indexOf(fkey(a.path)) - ORDER.indexOf(fkey(b.path)) || a.path.localeCompare(b.path));
  const files = `<ul class="plain">${flist.map(f => { const dsc = FDESC[fkey(f.path)] || [""], sz = f.bytes ? (f.bytes > 1048576 ? r1(f.bytes / 1048576) + " MB" : Math.max(1, Math.round(f.bytes / 1024)) + " KB") : "~100 KB";
      return `<li class="row"><span style="flex:1;min-width:0"><span class="row" style="gap:8px"><code style="font-size:12px">${esc(f.path)}</code>${dsc[1] ? `<span class="chip" style="border-color:#2B5573;color:#7FD1FF;padding:1px 8px">New in 2.0</span>` : ""}</span><span class="small muted" style="display:block">${esc(dsc[0])}${dsc[0] ? " · " : ""}${sz}</span></span><a class="ibtn" style="width:36px;height:36px;border-radius:999px" href="${BASE + f.path}" download aria-label="Download ${esc(f.path)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"></path></svg></a></li>`; }).join("")}</ul>
    <p class="small muted" style="margin:0">The main files; the rest (events, road conditions, route shapes, plows and more) are in the repo. Monthly files, public on GitHub. <a href="${REPO_URL}/tree/main/data">Browse the repo ›</a></p>`;
  const L = mod("since", "Since you last looked", prev ? `Since ${fmtDayTime(prev.at)}` : `${days} days logged`, since, { label: "Since you last looked", right: prev ? `<span style="font-size:12px;color:#9FB2C1">Since ${esc(fmtDayTime(prev.at))}</span>` : "" }) +
    mod("smart", "How smart is it", `Traffic ${conf}% · Routes ${rconf}% · Crowd ${crowdOn ? 1 : 0}%`, smart, { label: "How smart is it" });
  const R2 = mod("prog", "Training progress", `${conf}% today${eta ? " · 100% around " + dayMed(eta).replace(/^\w+, /, "") : ""}`, prog + `<p class="small muted" style="margin:0">Only typical days count toward the weekly pattern, so holidays and breaks pause it.</p>`, { label: "Training progress", right: `<span style="font-size:12px;color:#9FB2C1">Traffic, I-70</span>` });
  const out = `<div class="grid2"><div class="col">${L}</div><div class="col" style="flex:1.3 1 520px">${R2}</div></div>
    <div class="grid2"><div class="col" style="flex:1.3 1 520px">${mod("cov", "Coverage", "Days logged of 6 needed", `<div style="display:flex;flex-direction:column;gap:4px">${grid}</div><p class="small muted" style="margin:0">Weekdays count only typical days. A special day seen fewer than 6 times is capped at 25% confidence.${((m.conditions_seen || {}).powder || []).length ? "" : " Not seen yet: a powder day."}</p>`, { label: "Coverage", right: `<span style="font-size:12px;color:#9FB2C1">Days logged of 6 needed</span>` })}</div>
      <div class="col">${mod("src", "Sources", `Last run ${fmtTime(src.last_run)}`, `<ul class="plain">${srcRows}</ul><a href="${BASE}errors/${month}.csv" class="small" style="font-weight:600">Error log ›</a>`, { label: "Sources", right: `<span style="font-size:12px;color:#9FB2C1">Last run ${fmtTime(src.last_run)}</span>` })}</div></div>
    <div class="grid2"><div class="col">${mod("cal", "Calendar and conditions", up.length ? `Next: ${up[0][2]}, ${dayMed(up[0][0])}` : "", cal, { label: "Calendar and conditions" })}</div><div class="col" style="flex:1.3 1 520px">${mod("files", "Files", `${(D.files || []).length + 1} files · download any or all`, files, { label: "Files", right: `<a href="${REPO_URL}/archive/refs/heads/main.zip" style="font-size:12px;font-weight:600">Download all (.zip)</a>` })}</div></div>`;
  return out;
}

// ---- Settings sheet ----------------------------------------------------------------------------------------------
function renderSettings() {
  const A = S.alerts, phone = isPhone();
  const sw = (key, on) => `<button class="switch${on ? " on" : ""}" data-alert="${key}" aria-pressed="${on}" aria-label="${key}"></button>`;
  const sel = (attr, opts, cur) => `<select ${attr} style="height:32px;margin:0 4px;background:#0E1A24;color:#EAF1F6;border:1px solid #3A5266;border-radius:8px;font:600 13px Inter;padding:0 6px">${opts.map(([v, n]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  const item = (title, desc, key, first) => `<div class="row" style="align-items:flex-start;gap:16px;padding:${first ? "0" : "14px"} 0 14px;${first ? "" : "border-top:1px solid #22364A"}"><div style="flex:1"><div style="font-weight:600;margin-bottom:4px">${title}</div><div style="font-size:12px;color:#9FB2C1;line-height:1.6">${desc}</div></div>${sw(key, A[key])}</div>`;
  const alerts = item("Powder day", `A weekend or holiday with at least ${sel("data-powder", [[4, "4 in"], [6, "6 in"], [8, "8 in"], [12, "12 in"]], A.powderIn)} forecast at a mountain on your passes. Sent once when it first shows, again if the pick changes.`, "powder", true)
    + item("Time to head home", `On ski days after ${clock(S.flip)}, when the drive home from the day's pick drops under ${sel("data-homemin", [[5, "+5 min"], [10, "+10 min"], [15, "+15 min"]], A.homeMin || 10)} and the planner sees it rising later.`, "home")
    + item("Closures on your routes", "Closures and traction or chain laws on I-70, Berthoud, Loveland or Boulder Canyon, from COtrip.", "closures")
    + item("Morning call", "6 AM on weekends and holidays: the verdict, the pick and when to leave.", "morning")
    + `<div style="padding-top:14px;border-top:1px solid #22364A;display:flex;flex-direction:column;gap:10px"><div style="font-weight:600">Send to</div>
      <label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" data-chan="push" ${A.push !== false ? "checked" : ""} style="width:20px;height:20px;accent-color:#3BA0E0">Push to ${phone ? "this" : "your"} phone <span style="font-size:12px;color:#9FB2C1">(needs Home Screen)</span></label>
      <label class="row" style="gap:10px;color:#9FB2C1"><input type="checkbox" disabled style="width:20px;height:20px">Email <span style="font-size:12px">(not set up yet)</span></label></div>`;
  const pass = `<div style="display:flex;flex-wrap:wrap;gap:8px">${[["ikon", "Ikon"], ["epic", "Epic"], ["indy", "Independent"], ["overnight", "Overnight trips"]].map(([k, n]) => `<button class="pill${S.passes[k] ? " on" : ""}" data-pass="${k}" style="font-size:14px;font-weight:500;padding:0 16px">${n}</button>`).join("")}</div><p style="margin:0;font-size:12px;color:#9FB2C1">${phone ? "Copper, A-Basin, Winter Park and Eldora today. " : ""}Overnight adds Aspen Snowmass and Steamboat.</p>`;
  const flip = `<div style="display:flex;gap:8px">${[[11, "11 AM"], [12, "Noon"]].map(([h, n]) => `<button class="pill${S.flip === h ? " on" : ""}" data-flip="${h}" style="font-size:14px;font-weight:500;padding:0 16px">${n}</button>`).join("")}</div>`;
  const season = `<div style="display:flex;gap:8px;flex-wrap:wrap">${[["auto", "Auto"], ["regular", "Regular"], ["off", "Off-season"]].map(([k, n]) => `<button class="pill${S.season === k ? " on" : ""}" data-season="${k}" style="font-size:14px;font-weight:500;padding:0 16px">${n}</button>`).join("")}</div><p style="margin:0;font-size:12px;color:#9FB2C1">Auto is in ${seasonWord(nowParts().iso)}: lift openings since yesterday show on Today. After closing day it becomes the season recap.</p>`;
  const home = `<p style="margin:0">Add Ski Day to your ${phone ? "" : "phone's "}Home Screen to open it full screen, keep the last good data when service drops, and get push alerts on iPhone.</p><details><summary class="pill" style="display:inline-flex;align-items:center;background:#EAF1F6;color:#0E1A24;font-size:14px;list-style:none">How to add</summary><p style="margin:10px 0 0;font-size:13px;color:#C9D6E0">In Safari, tap Share, then Add to Home Screen. Open Ski Day from the new icon once so it can ask to send alerts.</p></details>`;
  const foot = `<p style="margin:0;font-size:12px;color:#9FB2C1">Alerts are saved on this device. Sending them needs push set up (a stored subscription), which is next on the list. The old page is still at <a href="classic/">/classic/</a>.</p>`;
  const kick = t => `<div class="kick">${t}</div>`;
  if (phone) {
    const grp = (t, body) => `<div class="row" style="justify-content:space-between;margin-top:6px">${kick(t)}<span class="pip" style="margin-top:0"></span></div><div class="card" style="padding:16px;gap:12px">${body}</div>`;
    return `<div class="row" style="gap:12px"><button class="ibtn" data-close aria-label="Back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg></button><h2 class="sg" style="margin:0;font-size:22px;font-weight:600">Alerts and settings</h2></div>
      ${grp("Alerts", alerts)}${grp("Mountains and passes", pass)}${grp("Page", `<div style="font-weight:600">Switch to the drive home at</div>${flip}<div style="border-top:1px solid #22364A;padding-top:12px;font-weight:600">Season</div>${season}`)}${grp("Home Screen", home)}${foot}`;
  }
  return `<div class="row" style="justify-content:space-between"><h2 class="sg" style="margin:0;font-size:28px;font-weight:600">Alerts and settings</h2><button class="ibtn" data-close aria-label="Close">✕</button></div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.8fr);gap:40px;align-items:start"><div style="display:flex;flex-direction:column;gap:10px">${kick("Alerts")}<div style="border-top:1px solid #22364A;padding-top:14px">${alerts}</div></div>
      <div style="display:flex;flex-direction:column;gap:12px">${kick("Mountains and passes")}${pass}${kick("Switch to the drive home at")}${flip}${kick("Season")}${season}<div style="border:1px solid #22364A;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px">${kick("Home Screen")}${home}</div></div></div>
    <div style="border-top:1px solid #22364A;padding-top:14px">${foot}</div>`;
}

const openSheet = (html, full) => { $("sheetpane").innerHTML = html; $("sheet").classList.toggle("full", !!full); $("sheet").classList.add("on"); };
// ---- Render and events ------------------------------------------------------------------------------------------
let histData = null;
function render() {
  const tab = (location.hash || "#today").slice(1);
  UI.tab = ["today", "week", "history", "data"].includes(tab) ? tab : "today";
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + UI.tab));
  const { hour } = nowParts();
  const fresh = (Date.now() - Date.parse(D.updated)) / 6e4 < 40, { iso: tIso } = nowParts();
  $("sub").innerHTML = UI.tab === "today" ? `<span style="width:7px;height:7px;border-radius:50%;background:${fresh ? "#3DD68C" : "#F5B841"}" title="${fresh ? "Live" : "Data is more than 40 minutes old"}"></span>${dayMed(tIso).replace(",", "")} · ${fmtTime(D.updated)} · ${seasonWord(tIso)}` : UI.tab === "week" ? `${dayMed(tIso).replace(",", "")} · forecast from ${fmtTime((D.outlook || {}).updated)}` : UI.tab === "history" ? "History · logged data" : "Data · model, sources and files";
  $("bell").style.display = UI.tab === "today" ? "" : "none"; $("belldot").style.display = powderPick() ? "" : "none";
  if (UI.tab === "week" && !UI.weekDay) { const wd = weekDays(); UI.weekDay = wd[0]; }
  const wIso = UI.weekDay || nowParts().iso, lift = liftFor(wIso);
  $("headchip").innerHTML = UI.tab === "week" ? `<span class="chip" style="border-color:#7A6A35;color:#FFC566">Traffic: ${trafficSource(wIso)}${isPhone() ? "" : isOffDay(wIso) && lift > 1 ? ` · holiday +${Math.round((lift - 1) * 100)}%` : ""}</span>` : "";
  $("gear").style.display = UI.tab === "week" && isPhone() ? "none" : "";
  let html = "";
  try {
    if (UI.tab === "today") html = renderToday();
    else if (UI.tab === "week") html = renderWeek();
    else if (UI.tab === "history") { if (!UI.histDay) UI.histDay = addDays(nowParts().iso, -1); html = renderHistory(histData && histData.iso === UI.histDay ? histData : null);
      if (!histData || histData.iso !== UI.histDay) loadHistory(UI.histDay).then(h => { histData = { iso: UI.histDay, ...h }; if (UI.tab === "history") render(); }); }
    else html = renderData();
  } catch (e) { console.error(e); html = `<div class="err">Something broke drawing this tab: ${esc(e.message)}. The data loaded fine; this is a page bug.</div>`; }
  $("main").innerHTML = `<div style="display:flex;flex-direction:column;gap:${isPhone() ? 14 : 20}px">${html}</div>`;
  drawRealMap();
}
document.addEventListener("click", ev => {
  const t = ev.target.closest("[data-hgo],[data-pick],[data-dest],[data-win],[data-compare],[data-dismiss],[data-goweek],[data-settings],[data-ph],[data-mapmode],[data-tog],[data-dir],[data-m],[data-day],[data-wdir],[data-cm],[data-hday],[data-hdir],[data-hm],[data-close],[data-alert],[data-pass],[data-flip],[data-season],.bars i[data-h]");
  if (!t) return;
  const d = t.dataset;
  if (d.tog) { if (!isPhone()) return; const sec = $("m-" + d.tog); const c = !sec.classList.contains("closed"); sec.classList.toggle("closed", c); t.setAttribute("aria-expanded", !c); c ? UI.closed.add(d.tog) : UI.closed.delete(d.tog); store.set("closed", [...UI.closed]); return; }
  if (d.hgo) { ev.preventDefault(); UI.histDay = d.hgo; render(); return; }
  if ("pick" in d) { openSheet(renderPicker(), false); return; }
  if (d.dest) { UI.dest = d.dest; UI.selHour = null; $("sheet").classList.remove("on"); }
  else if (d.win != null) { UI.win = +d.win; UI.selHour = null; }
  else if ("compare" in d) UI.compare = !UI.compare;
  else if (d.ph != null) UI.selHour = +d.ph;
  else if ("dismiss" in d) { const snow = {}; MKEYS.forEach(k => { snow[k] = {}; weekDays().slice(0, 3).forEach(iso => { const x = dayScore(k, iso); if (x) snow[k][iso] = x.during; }); });
    PREV.snap = { at: D.updated, seen: new Date().toISOString(), lifts: Object.fromEntries(MKEYS.map(k => [k, statusOf(k).lifts])), snow }; store.set("snap", PREV.snap); }
  else if (d.goweek) { ev.preventDefault(); UI.weekDay = d.goweek; location.hash = "#week"; return; }
  else if ("settings" in d) { ev.preventDefault(); openSheet(renderSettings(), true); return; }
  else if (d.mapmode) { UI.mapMode = d.mapmode; store.set("mapMode", UI.mapMode); }
  else if (d.dir) { UI.dir = d.dir; UI.selHour = null; UI.win = null; }
  else if (d.m) { UI.openM = UI.openM === d.m ? "" : d.m; store.set("openM", UI.openM); if (UI.openM && !CAMS) loadCams(); }
  else if (d.day) { UI.weekDay = d.day; UI.crowdM = null; }
  else if (d.wdir) UI.weekDir = d.wdir;
  else if (d.cm) UI.crowdM = d.cm;
  else if (d.hday) { UI.histDay = addDays(UI.histDay, +d.hday); }
  else if (d.hdir) UI.histDir = d.hdir;
  else if (d.hm) UI.histM = d.hm;
  else if (d.h != null && t.matches(".bars i")) UI.selHour = +d.h;
  else if ("close" in d) { $("sheet").classList.remove("on"); return; }
  else if (d.alert) { S.alerts[d.alert] = !S.alerts[d.alert]; saveSettings(); $("sheetpane").innerHTML = renderSettings(); return; }
  else if (d.pass) { S.passes[d.pass] = !S.passes[d.pass]; saveSettings(); $("sheetpane").innerHTML = renderSettings(); render(); return; }
  else if (d.flip) { S.flip = +d.flip; saveSettings(); $("sheetpane").innerHTML = renderSettings(); render(); return; }
  else if (d.season) { S.season = d.season; saveSettings(); $("sheetpane").innerHTML = renderSettings(); render(); return; }
  render();
});
document.addEventListener("change", ev => {
  if (ev.target.id === "hdate" && ev.target.value) { UI.histDay = ev.target.value; render(); }
  if (ev.target.matches("[data-powder]")) { S.alerts.powderIn = +ev.target.value; saveSettings(); }
  if (ev.target.matches("[data-homemin]")) { S.alerts.homeMin = +ev.target.value; saveSettings(); }
  if (ev.target.matches("[data-chan]")) { S.alerts.push = ev.target.checked; saveSettings(); }
});
$("bell").onclick = () => { openSheet(renderSettings(), true); };
$("gear").onclick = () => { openSheet(renderSettings(), true); };
$("sheet").onclick = ev => { if (ev.target.id === "sheet") $("sheet").classList.remove("on"); };
addEventListener("hashchange", render);
let lastW = innerWidth; addEventListener("resize", () => { if ((innerWidth < 900) !== (lastW < 900)) render(); lastW = innerWidth; });
async function loadCams() { try { const c = await fetch(BASE + "cameras.json", { cache: "no-store" }).then(r => r.json()); CAMS = c.cameras || []; } catch (e) { CAMS = []; } render(); }

// ---- Load: one small file, refreshed after each logger run, paused while hidden -------------------------------------
async function load(first) {
  try {
    const r = await fetch(BASE + "dashboard.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status === 404 ? "dashboard.json isn't there yet. It appears after the logger's next run (every 15 minutes)." : "HTTP " + r.status);
    const fresh = await r.json();
    if (D && fresh.updated === D.updated) return;
    D = fresh; MAP = MAPDATA;
    render();
    if (first) {
      // Remember what you saw, for "since you last looked" (only once you've been away 30 minutes).
      const prev = store.get("snap", null);
      if (!prev || Date.now() - Date.parse(prev.seen || prev.at) > 30 * 6e4) {
        const snow = {}; MKEYS.forEach(k => { snow[k] = {}; weekDays().slice(0, 3).forEach(iso => { const d = dayScore(k, iso); if (d) snow[k][iso] = d.during; }); });
        store.set("snap", { at: D.updated, seen: new Date().toISOString(), lifts: Object.fromEntries(MKEYS.map(k => [k, statusOf(k).lifts])), snow });
        const dp = store.get("dataSnap", null);
        if (!dp || Date.now() - Date.parse(dp.seen) > 30 * 6e4) store.set("dataSnap", { at: D.updated, seen: new Date().toISOString(), days: D.model.days_logged || 0, conf: Math.round((D.model.confidence || 0) * 100) });
      }
      if (UI.openM) loadCams();
    }
  } catch (e) {
    console.error(e);
    if (!D) $("main").innerHTML = `<div class="err"><b>Couldn't load the latest run.</b> ${esc(e.message)} <a href="classic/">Use the old page</a> in the meantime.</div>`;
  }
}
load(true);
setInterval(() => { if (!document.hidden) load(false); }, 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false); });
})();
