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
const UI = { tab: "today", dir: null, selHour: null, openM: store.get("openM", "copper"), weekDay: null, weekDir: "W", crowdM: null, histDay: null, histDir: "W", histM: "copper",
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
    : `<button class="mhead" data-tog="${id}" aria-expanded="${!closed}"><span class="ttl"><span class="sg" style="display:block;font-size:20px;font-weight:600">${title}</span>${summary ? `<span class="sum">${summary}</span>` : ""}</span>${opts.right || ""}<span class="pip"></span></button>`;
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
  const best = (ranked()[0] || {}).k;
  (phone ? Object.entries(M.phoneDest).map(([kk, p]) => [kk, p[0], p[1]]) : M.dest.map(([kk, x, y]) => [kk, ...tfD(x, y)])).forEach(([kk, cx, cy]) => {
    const t = tripNow(kk, dir), lab = MTS[kk].name, tm = hm(t.minutes), wbox = 26 + 7.4 * lab.length + 8 * tm.length, on = kk === best;
    out.push(`<g><rect x="${(cx - wbox / 2).toFixed(1)}" y="${(cy - 14).toFixed(1)}" width="${wbox.toFixed(1)}" height="28" rx="14" fill="#15232F" stroke="${on ? "#7FD1FF" : "#3A5266"}" stroke-width="${on ? 2 : 1}"></rect>` +
      `<text x="${(cx - wbox / 2 + 12).toFixed(1)}" y="${(cy + 4.5).toFixed(1)}" font-size="13" font-weight="600" fill="#EAF1F6">${esc(lab)} <tspan fill="${TONE_T[tone(t.pct)]}" font-weight="500">${tm}</tspan></text></g>`);
  });
  out.push(`</svg>`);
  return out.join("");
}

// ---- Today ---------------------------------------------------------------------------------------------------
const isPhone = () => matchMedia("(max-width: 899px)").matches;
function renderToday() {
  const { iso, hour } = nowParts(), v = verdictNow(), top = v.top, dir = UI.dir || (hour < S.flip ? "W" : "E"), R = ranked();
  const offSeason = S.season === "off" || (S.season === "auto" && !MKEYS.some(isOpen));
  if (offSeason) return `<section class="card call"><span class="kick" style="color:var(--accent)">Off-season</span><h1 class="call">The lifts are closed. See you next winter.</h1><p class="muted" style="margin:0">The logger keeps running, so the traffic model keeps learning. Switch modes in settings.</p></section>`;
  const info = dayInfo(iso), lvl = { g: "g", a: "a", r: "r", n: "" }[v.level];
  const kickTxt = `${info.type !== "typical" ? (info.tags[0] || info.type).replace(/[:;(].*$/, "") + " " : ""}${dayLong(iso)} · ${hour < S.flip ? "Going up" : "Heading home"}`;
  const tTop = top ? tripNow(top.k, "W") : null, cr = top ? crowdOf(top.k) : null;
  const leaveTxt = hour < S.flip ? (v.prof.leaveH != null && v.prof.leaveH > hour ? clock(v.prof.leaveH) : "Now") : "Now";
  const callBody = `<p style="margin:0;color:var(--ink3)">${esc(v.why)}</p>
    <div class="stats" style="padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
      <div><div class="kick">Go to</div><div class="big">${top ? esc(isPhone() ? MTS[top.k].short : MTS[top.k].name) : "n/a"}</div><div class="sub v">${cr && cr.level ? "crowd " + CROWD_WORD[cr.level].toLowerCase() : "no crowd reading"}</div></div>
      <div><div class="kick">Leave</div><div class="big">${leaveTxt}</div><div class="sub ${tone(tTop ? tTop.pct : 0)}">${tTop ? (tTop.delay < 1 ? "+0 min" : `+${Math.round(tTop.delay)} min`) : ""}</div></div>
      <div><div class="kick">Drive</div><div class="big">${tTop ? hm(tTop.minutes) : "n/a"}</div><div class="sub muted">Coors to ${top ? esc(MTS[top.k].short) : ""}</div></div>
    </div>
    <div class="seg" role="group" aria-label="Direction" style="align-self:flex-start"><button data-dir="W" class="${dir === "W" ? "on" : ""}">Going up</button><button data-dir="E" class="${dir === "E" ? "on" : ""}">Heading home</button></div>`;
  const call = mod("call", `<h1 class="call ${lvl}" style="color:var(--ink)">${esc(v.line)}</h1>`, "", callBody, { call: true, cls: "call", label: "Today's call", kick: `<span class="kick" style="color:var(--accent)">${esc(kickTxt)}</span>` });
  const news = renderNews(), roads = renderRoads(dir), plan = renderPlanner(iso, dir, hour), mts = renderMountains(R, dir);
  return `<div class="grid2"><div class="col" style="flex:1.3 1 520px">${call}</div><div class="col">${news}</div></div>${roads}${plan}${mts}`;
}
function renderNews() {
  const items = [];
  // Powder alert: any of your mountains with the alert threshold or more in the next three days.
  const thr = S.alerts.powderIn || 6, days = weekDays().slice(0, 3);
  let best = null; MKEYS.forEach(k => days.forEach(iso => { const d = dayScore(k, iso); if (d && d.snow >= thr * 0.7 && (!best || d.snow > best.snow)) best = d; }));
  if (best) items.push(`<div class="row" style="align-items:flex-start;padding:12px;border-radius:14px;background:#17324A;border:1px solid #2B5573"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7FD1FF" stroke-width="1.8" aria-hidden="true" style="flex:none"><path d="M12 2v20M4.9 7l14.2 10M4.9 17l14.2-10"></path></svg><div><b>Powder alert · ${dayLong(best.iso)} at ${esc(MTS[best.k].name)}</b><div class="small muted">${r1(best.snow)} in forecast (models ${r1(best.lo || 0)} to ${r1(best.hi || 0)}). ${esc(dayProfile(best.iso).leave)}.</div></div></div>`);
  // Since you last looked
  const prev = PREV.snap, changes = [];
  if (prev && prev.at) {
    MKEYS.forEach(k => { const a = (prev.lifts || {})[k], b = statusOf(k).lifts; if (a && b && a !== b) changes.push(`${MTS[k].name} lifts ${a.split(" of ")[0]} → ${b.split(" of ")[0]}`); });
    MKEYS.forEach(k => weekDays().slice(0, 3).forEach(iso => { const a = ((prev.snow || {})[k] || {})[iso], d = dayScore(k, iso); if (a != null && d && Math.abs(d.during - a) >= 1) changes.push(`${dayShort(iso).split(" ")[0]} ${MTS[k].name} ${Math.round(a)} → ${Math.round(d.during)} in`); }));
  }
  const since = prev && prev.at ? `Since ${fmtDayTime(prev.at)}` : "Since your last visit";
  items.push(`<div><div class="kick" style="margin-bottom:6px">${esc(since)}</div>${changes.length ? `<ul class="plain small">${changes.slice(0, 6).map(c => `<li style="padding:6px 0">${esc(c)}</li>`).join("")}</ul>` : `<p class="small muted" style="margin:0">${prev ? "Nothing new on lifts or snow forecasts." : "Changes in lifts and snow forecasts show here next time."}</p>`}</div>`);
  return mod("new", "What's new", best ? `Powder alert for ${dayLong(best.iso)} · ${changes.length} changes` : `${changes.length} changes`, items.join(""), { label: "What's new" });
}
function renderRoads(dir) {
  const ways = [["copper", "I-70", "to Copper"], ["winterpark", "Berthoud Pass", "to Winter Park"], ["abasin", "Loveland Pass", "to A-Basin"], ["eldora", "Nederland", "to Eldora"]].map(([k, nm, to]) => {
    const t = tripNow(k, dir), cl = closedFor(k, dir); return { k, nm, to, t, cl }; });
  const allClear = ways.every(w => !w.cl.length && tone(w.t.pct) === "g");
  const list = `<ul class="plain">${ways.map(w => `<li class="row"><span class="dot" style="background:${w.cl.length ? TONE.r : TONE[tone(w.t.pct)]}"></span><div style="flex:1"><b>${esc(w.nm)}</b> <span class="small muted">${esc(w.to)}</span></div><div style="text-align:right"><b class="sg" style="font-size:16px">${w.cl.length ? "Closed" : hm(w.t.minutes)}</b> <span class="small ${tone(w.t.pct)}">${w.cl.length ? "" : w.t.delay < 1 ? "+0" : "+" + Math.round(w.t.delay)}</span></div></li>`).join("")}</ul>`;
  const tr = (D.events || []).filter(e => started(e) && e.class === "chainLaws" && !/commercial/i.test(e.title || "")).length, shut = closures().filter(e => /I70|US6|US40|CO119|CO72|US36|I25|CO58|CO93/.test(EV_ROUTE(e.route))).length, plan = plannedClosures().filter(e => EV_ROUTE(e.route) === "I70");
  const foot = `<p class="small muted" style="margin:0;border-top:1px solid var(--line);padding-top:10px">${shut ? `${shut} closure${shut > 1 ? "s" : ""} on COtrip.` : "No closures (COtrip)."} ${tr ? `${tr} traction law${tr > 1 ? "s" : ""} in effect.` : "No traction laws."}${plan.length ? ` Planned: ${esc(plan[0].title.replace(/\.$/, ""))} from ${esc(fmtDayTime(plan[0].began))}${plan.length > 1 ? ` (+${plan.length - 1} more nights)` : ""}.` : ""} Updated ${fmtTime(D.updated)}.</p>`;
  const sum = `${allClear ? '<span class="g" style="font-weight:600">All clear</span> · ' : ""}${ways.map(w => `${w.nm.replace(" Pass", "")} ${w.cl.length ? "closed" : hm(w.t.minutes)}`).join(" · ")}`;
  const seg = `<div class="seg" role="group" aria-label="Direction" style="align-self:flex-end"><button data-dir="W" class="${dir === "W" ? "on" : ""}">Westbound</button><button data-dir="E" class="${dir === "E" ? "on" : ""}">Eastbound</button></div>`;
  return mod("roads", dir === "W" ? "Ways up" : "Ways home", sum, `${seg}<div>${lineMap(isPhone(), dir)}</div>${list}${foot}`, { label: "Roads" });
}
function renderPlanner(iso, dir, hour) {
  const day = loggedDay(iso), vals = [];
  for (let h = 0; h < 24; h++) { const l = loggedAt(day, dir, h); vals.push(h < hour && l != null ? l : expected(iso, dir, h)); }
  const sel = UI.selHour != null ? UI.selHour : hour, cur = vals[sel] || 0, base = 90;
  const ahead = [...Array(24).keys()].filter(h => h >= hour && (dir === "W" ? h >= 5 && h < 11 : h >= 11 && h < 19));
  const win = ahead.length ? ahead : [...Array(24).keys()].filter(h => h >= hour);
  const bestH = win.reduce((a, h) => vals[h] < vals[a] - 0.5 ? h : a, win[0] ?? hour), worstH = win.reduce((a, h) => vals[h] > vals[a] ? h : a, win[0] ?? hour);
  const flat = vals[worstH] - vals[bestH] < 1;
  const body = `<div class="stats">
      <div><div class="kick">At ${clock(sel)}</div><div class="big">${hm(base + cur)}</div><div class="sub ${tone(cur / base)}">+${Math.round(cur)} min</div></div>
      <div><div class="kick">Best ahead</div><div class="big">${clock(bestH)}</div><div class="sub g">+${Math.round(vals[bestH] || 0)} min</div></div>
      <div><div class="kick">Worst ahead</div><div class="big">${flat ? "None" : clock(worstH)}</div><div class="sub ${flat ? "muted" : tone(vals[worstH] / base)}">${flat ? "every hour within a minute" : "+" + Math.round(vals[worstH]) + " min"}</div></div></div>
    ${barsHTML(vals, { H: 96, base, nowH: hour, sel, logged: h => h < hour && loggedAt(day, dir, h) != null })}
    <p class="small muted" style="margin:0">Coors Field to Copper on I-70. Solid is logged, striped is forecast. Tap a bar to pick an hour.</p>`;
  return mod("plan", `Leave Coors at <span style="color:var(--accent)">${clock(sel)}</span>`, `${hm(base + cur)}, +${Math.round(cur)} min · best ${clock(bestH)} · ${flat ? "no slow hour ahead" : "worst " + clock(worstH) + ", +" + Math.round(vals[worstH])}`, body, { label: "Departure planner" });
}
function crowdStrip(k, iso, hour) {
  // Hourly crowd for the open mountain: estimated from the expected drive up, arriving about 1.5 hours later.
  const hs = [8, 9, 10, 11, 12, 13, 14, 15], est = h => Math.max(0, expected(iso, "W", Math.max(5, Math.min(10, h - 2))));
  const vals = hs.map(est), mx = Math.max(4, ...vals);
  const typ = hs.map(h => { const s = (D.model.slots || {})[`${pyDow(iso)}-${String(Math.max(5, Math.min(10, h - 2))).padStart(2, "0")}00-W`]; return s ? s.median : 0; });
  const verdict = vals.reduce((a, b) => a + b, 0) > typ.reduce((a, b) => a + b, 0) * 1.15 + 2 ? ["Busier than usual", "a"] : vals.reduce((a, b) => a + b, 0) < typ.reduce((a, b) => a + b, 0) * 0.85 - 2 ? ["Quieter than usual", "g"] : ["About usual", "v"];
  return `<div class="row" style="justify-content:space-between;align-items:baseline"><span class="kick">Crowd today by hour</span><span class="small ${verdict[1]}" style="font-weight:600">${verdict[0]}</span></div>
    <div style="display:flex;gap:4px">${hs.map((h, i) => `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1"><div style="position:relative;width:100%;height:36px;display:flex;align-items:flex-end;${h === hour ? "outline:2px solid #EAF1F6;outline-offset:1px;border-radius:3px" : ""}"><div class="${h < hour ? "" : "hatch"}" style="width:100%;height:${Math.max(3, Math.round(vals[i] / mx * 34))}px;border-radius:3px 3px 0 0;background:var(--violet);color:var(--violet)"></div><span style="position:absolute;left:-1px;right:-1px;bottom:${Math.round(typ[i] / mx * 34)}px;height:2px;background:#EAF1F6;opacity:.85"></span></div><span style="font-size:11px;color:var(--ink2)">${clockS(h)}</span></div>`).join("")}</div>
    <span class="small muted" style="margin-top:-6px">Estimated from traffic into the base area until the crowd log has a season. White tick is a typical ${esc(dayLong(iso))}.</span>`;
}
let CAMS = null;
function camsFor(k) {
  if (!CAMS) return `<div class="small muted">Loading cameras…</div>`;
  const M = MTS[k], d = c => Math.hypot((c.lon - M.lon) * 85, (c.lat - M.lat) * 111);
  const near = CAMS.filter(c => c.views && c.views.length).map(c => ({ c, d: d(c) })).filter(x => x.d < 25).sort((a, b) => a.d - b.d).slice(0, 2);
  if (!near.length) return `<div class="small muted">No COtrip camera near ${esc(M.name)}.</div>`;
  return `<div class="cams">${near.map(({ c }) => { const v = c.views.find(v => !/surface/i.test(v[0])) || c.views[0]; return `<figure><a href="${esc(v[1])}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(v[1])}" alt="${esc(c.name)}"></a><figcaption>${esc(c.name.replace(/\s*:.*$/, ""))}</figcaption></figure>`; }).join("")}</div>`;
}
function factorBars(f, vals) {
  const rows = [["Snow", f.snow / 40, vals.snow], ["Drive", 1 + f.drive / 15, vals.drive], ["Wind", 1 + f.wind / 20, vals.wind], ["Crowd", 1 + f.crowd / 9, vals.crowd], ["Snowy roads", 1 + f.roads / 9, vals.roads], ["Closures", f.closure ? 0 : 1, vals.closure]];
  return rows.map(([n, v, t]) => `<div class="fac"><span class="muted">${n}</span><span class="tk"><i class="${v < 0.5 && n !== "Snow" ? "neg" : ""}" style="width:${Math.round(Math.max(0.03, Math.min(1, v)) * 100)}%"></i></span><b style="text-align:right">${esc(t)}</b></div>`).join("");
}
function mountainDetail(r, i, R) {
  const k = r.k, M = MTS[k], st = statusOf(k), s = r.s, cr = r.crowd, tr = tractionFor(k), { iso, hour } = nowParts();
  const chips = [cr && cr.level ? `<span class="chip vio">Crowd ${CROWD_WORD[cr.level].toLowerCase()}</span>` : `<span class="chip vio">Crowd: no reading</span>`];
  if (s.gust >= 35) chips.push(`<span class="chip amb">Gusts ${Math.round(s.gust)} mph</span>`);
  tr.forEach(() => chips.push(`<span class="chip amb">Traction law</span>`));
  if (r.closed) chips.push(`<span class="chip" style="border-color:#6B2E2E;color:var(--redt)">Closure on the way</span>`);
  if (k === "abasin") chips.push(`<span class="chip">${iso >= "2027-01-02" && iso <= "2027-05-02" && (pyDow(iso) >= 5) ? "Parking reservation required" : "No parking reservation until Jan 2"}</span>`);
  const nxt = R[i + 1] ? `${MTS[R[i + 1].k].name} at ${R[i + 1].score}` : null;
  return `<div class="stats"><div><div class="kick">New 24 h</div><b>${r1(s.new24)} in</b></div><div><div class="kick">Next 24 h</div><b style="color:var(--accent)">${r1(s.fc24)} in</b></div><div><div class="kick">Lifts</div><b>${esc(st.lifts || "n/a")}</b></div></div>
    <div class="crowdnow"><div><div class="kick v">Crowd now</div><b>${cr && cr.level ? `${CROWD_WORD[cr.level]} · last mile ${Math.round((cr.ratio - 1) * 100)}% slower` : "No reading yet"}</b></div>${meter(cr && cr.level)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${chips.join("")}</div>
    <div style="border-top:1px solid var(--line);padding-top:12px;display:flex;flex-direction:column;gap:12px">
      <div class="kick">Crowd: what it's based on</div>
      <ul class="plain small">${((D.sources || {}).crowd_sources || []).map(c => `<li class="row" style="justify-content:space-between;padding:6px 0"><span class="muted">${esc(c.name)}</span><span>${c.status === "trial" ? (cr ? "reading" : "trial, no reading yet") : "not yet"}</span></li>`).join("")}</ul>
      ${crowdStrip(k, iso, hour)}
      <div class="kick">Cameras</div>${camsFor(k)}
      <div class="kick">Snow</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px"><span class="muted">Base (SNOTEL)</span><span>${s.depth != null ? s.depth + " in" : "n/a"}${s.temp != null ? ", " + Math.round(s.temp) + "°F" : ""}</span><span class="muted">Quality</span><span>${esc(quality(s))}</span></div>
      <div class="kick">Why it ranks ${["first", "second", "third", "fourth"][i] || "#" + (i + 1)}</div>
      ${factorBars(r.f, { snow: `${r1(s.new24 + s.fc24)} in`, drive: r.t.delay < 1 ? "+0" : "+" + Math.round(r.t.delay), wind: s.gust != null ? Math.round(s.gust) + " mph" : "n/a", crowd: cr && cr.level ? CROWD_WORD[cr.level] : "n/a", roads: r.f.roads ? String(r.f.roads) : "none", closure: r.closed ? "−40" : "none" })}
      <span class="small muted">Score ${r.score}${nxt ? `, next best ${esc(nxt)}` : ""}.</span></div>`;
}
function renderMountains(R, dir) {
  const st = D.status || {}, phone = isPhone();
  if (!phone) {
    const rows = R.map((r, i) => { const M = MTS[r.k], on = UI.openM === r.k, t = tripNow(r.k, dir), cr = r.crowd;
      return `<tr style="background:${on ? "#13283A" : "transparent"}"><td class="sg" style="font-weight:700;color:var(--ink2);width:40px">${i + 1}</td>
        <td><button class="mh" data-m="${r.k}" aria-expanded="${on}"><span><span class="nm">${esc(M.name)}</span><span class="small muted">${esc(M.route)}</span></span></button></td>
        <td>${r1(r.s.new24)} in</td><td style="color:var(--accent)">${r1(r.s.fc24)} in</td><td>${esc(statusOf(r.k).lifts || "n/a")}</td>
        <td>${meter(cr && cr.level)} <span class="small v">${cr && cr.level ? CROWD_WORD[cr.level] : "no reading"}</span></td>
        <td><b class="sg">${hm(t.minutes)}</b> <span class="small ${tone(t.pct)}">${t.delay < 1 ? "+0" : "+" + Math.round(t.delay)}</span></td><td><b class="sg">${r.score}</b></td></tr>` +
        (on ? `<tr><td></td><td colspan="7" style="padding:4px 8px 20px">${mountainDetail(r, i, R)}</td></tr>` : ""); }).join("");
    return `<section class="card" aria-label="Mountains"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 class="t">Mountains</h2><span class="small muted">Tap a mountain for details · Ikon · lifts at ${esc(st.checked || "")}</span></div>
      <div style="overflow-x:auto"><table class="mt" style="min-width:860px"><thead><tr><th>#</th><th>Mountain</th><th>New 24 h</th><th>Next 24 h</th><th>Lifts</th><th>Crowd now</th><th>Drive now</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  const cards = R.map((r, i) => { const M = MTS[r.k], on = UI.openM === r.k, t = tripNow(r.k, dir);
    return `<article class="card mcard${on ? " open" : ""}"><button class="mh" data-m="${r.k}" aria-expanded="${on}"><span style="flex:1;min-width:0"><span class="nm">${i + 1}. ${esc(M.name)}</span><span class="small muted" style="display:block">${esc(M.route)}</span><span class="small muted" style="display:block;white-space:nowrap">${r1(r.s.new24)}&nbsp;in new · ${r1(r.s.fc24)}&nbsp;in next 24&nbsp;h</span></span>
      <span style="text-align:right"><b class="sg" style="display:block;font-size:20px">${hm(t.minutes)}</b><span class="small ${tone(t.pct)}">${t.delay < 1 ? "+0" : "+" + Math.round(t.delay)}</span></span><span class="pip" style="${on ? "" : "background:var(--accent)"}"></span></button>${on ? mountainDetail(r, i, R) : ""}</article>`; }).join("");
  return mod("mtn", "Mountains", `${R.map(r => MTS[r.k].name).join(", ")} · lifts at ${esc(st.checked || "")}`, cards, { label: "Mountains" });
}

// ---- Week -----------------------------------------------------------------------------------------------------
function renderWeek() {
  const days = weekDays(); if (!days.length) return `<div class="card"><p class="muted">The 7-day outlook fills in after the next forecast run.</p></div>`;
  const S2 = {}; MKEYS.forEach(k => days.forEach(iso => { S2[k + iso] = isOpen(k) ? dayScore(k, iso) : null; }));
  const best = {}; days.forEach(iso => { best[iso] = MKEYS.map(k => S2[k + iso]).filter(Boolean).sort((a, b) => b.score - a.score)[0] || null; });
  if (!UI.weekDay || !days.includes(UI.weekDay)) UI.weekDay = days.reduce((a, iso) => (best[iso] && (!best[a] || best[iso].score > best[a].score)) ? iso : a, days[0]);
  const sel = UI.weekDay, phone = isPhone(), far = i => i > 2;
  const cell = (k, iso, i) => { const r = S2[k + iso]; if (!r) return `<span class="cell" style="background:#15232F;color:var(--ink2);font-size:12px">Closed</span>`;
    const t = tone(r.drivePeak / 90), isB = best[iso] && best[iso].k === k;
    return `<button class="cell" data-day="${iso}" style="background:${snowBg(r.snow)};${isB ? "outline:2px solid #EAF1F6;outline-offset:-2px;" : ""}${far(i) ? "opacity:.5" : ""}" title="${esc(MTS[k].name)} ${dayShort(iso)}: score ${r.score}"><span class="sg" style="font-size:${phone ? 16 : 20}px;font-weight:600;line-height:1">${Math.round(r.snow)}"</span>
      <span style="display:flex;align-items:center;gap:${phone ? 5 : 8}px;font-size:12px"><span style="display:inline-flex;align-items:center;gap:4px"><span class="dot" style="width:8px;height:8px;background:${TONE[t]}"></span>${phone ? "" : WORD[t]}</span>${meter(crowdEst(iso), true)}</span></button>`; };
  const dayHead = (iso, i) => { const p = dayProfile(iso), tag = dayTags(iso)[0]; return `<button class="day${iso === sel ? " sel" : ""}" data-day="${iso}" style="${far(i) ? "opacity:.5" : ""}"><b>${dayShort(iso)}</b><span class="small" style="color:${tag ? "var(--ambert)" : "var(--ink2)"}">${tag ? esc(tag.replace(/[:;(].*$/, "").replace("School break", "Break")) : "&nbsp;"}</span><span class="small muted">${p.upPeak >= 10 ? "Leave by " + clockS(p.leaveH) : "No rush"}</span></button>`; };
  let grid;
  if (phone) grid = `<div class="wk" style="grid-template-columns:84px repeat(4,minmax(0,1fr))"><span></span>${MKEYS.map(k => `<span class="small" style="font-weight:600;text-align:center">${esc(MTS[k].short)}</span>`).join("")}${days.map((iso, i) => dayHead(iso, i) + MKEYS.map(k => cell(k, iso, i)).join("")).join("")}</div>`;
  else grid = `<div style="overflow-x:auto"><div class="wk" style="grid-template-columns:150px repeat(${days.length},minmax(110px,1fr));min-width:980px"><span></span>${days.map((iso, i) => dayHead(iso, i)).join("")}${MKEYS.map(k => `<div style="display:flex;flex-direction:column;justify-content:center"><b class="sg" style="font-size:16px">${esc(MTS[k].name)}</b><span class="small muted">${esc(MTS[k].way)}</span></div>` + days.map((iso, i) => cell(k, iso, i)).join("")).join("")}</div></div>`;
  const key = `<div class="key">${[["Snow", "Forecast snow, night before plus the day. Deeper blue means more.", `<span style="display:inline-flex;gap:1px">${["#1F4A6B", "#2A6A99", "#3D8FCC"].map(c => `<span style="width:9px;height:9px;border-radius:2px;background:${c}"></span>`).join("")}</span>`, "l"],
    ["Traffic", "Drive up vs an empty road. Green is under 12% slower, amber 12 to 30%, red over 30%.", `<span style="display:inline-flex;gap:2px">${["g", "a", "r"].map(t => `<span class="dot" style="width:7px;height:7px;background:${TONE[t]}"></span>`).join("")}</span>`, "l"],
    ["Crowd", "Crowd forecast, 1 to 4 bars. Estimated from traffic until the crowd log has a season.", meter(2, true), "c"],
    ["Best", "The model's top pick for that day.", `<span style="width:10px;height:10px;border-radius:3px;outline:2px solid #EAF1F6;outline-offset:-2px"></span>`, "r"],
    ["Rough", "4 or more days out. Treat it as a heads-up, not a plan.", `<span style="width:10px;height:10px;border-radius:3px;background:#2A6A99;opacity:.5"></span>`, "r"]]
    .map(([n, tt, ic, pos]) => `<span class="ki k${pos}" tabindex="0" role="button" aria-label="${n}: ${tt}">${ic}${n}<span class="tt" role="tooltip">${tt}</span></span>`).join("")}</div>`;
  const b = best[sel] ? best[sel].k : MKEYS[0];
  const sevenDays = mod("days", "Seven days", `Best pick: ${days.map(iso => best[iso] ? MTS[best[iso].k].short : "–").filter((x, i, a) => a.indexOf(x) === i).join(", ")}`, grid + key, { label: "Seven days" });
  const left = weekCall(sel, b, S2) + weekPlanner(sel) + weekCrowd(sel, b);
  const right = weekWhy(sel, S2, best) + weekOthers(sel, S2, best);
  return `${sevenDays}<div class="grid2"><div class="col" style="flex:1.2 1 520px">${left}</div><div class="col">${right}</div></div>`;
}
function weekVerdict(iso, b, S2) {
  const p = dayProfile(iso), r = S2[b + iso], info = dayInfo(iso), weekend = pyDow(iso) >= 5, off = isOffDay(iso);
  if (!r) return ["n", "Nothing's open that day.", ""];
  if (r.snow >= 6) return ["g", "Powder day incoming. Set an alarm.", `About ${Math.round(r.snow)}" forecast at ${MTS[b].name}. ${p.leave}.`];
  if ((weekend || off) && (info.type === "holiday" || info.type === "break")) return ["a", p.upPeak < 10 ? "Everybody's off, but the roads should be fine." : `Everybody's off. ${p.leave} or keep your ass at home.`, (info.tags || []).join(". ")];
  if (p.upPeak >= 25) return ["a", `${p.leave} or don't bother.`, `I-70 westbound usually runs about ${Math.round(p.upPeak)} minutes slow at the worst of it.`];
  if (!weekend && !off) return ["g", r.snow >= 3 ? "Fresh snow on a weekday. Call in sick." : "Empty roads, empty lifts.", `${MTS[b].name} looks best.`];
  return ["g", r.snow >= 1 ? "Should be a good one. Go get it." : "Old snow, normal traffic. Groomer day.", `${MTS[b].name} looks best. ${p.leave === "No rush going up" ? "No rush heading up." : p.leave + "."}`];
}
function weekCall(iso, b, S2) {
  const [lv, line, why] = weekVerdict(iso, b, S2), p = dayProfile(iso), lh = p.leaveH;
  const tags = dayTags(iso).map(t => `<span class="chip">${esc(t.replace(/:.*$/, ""))}</span>`);
  ((D.model.pass_blackouts) || []).forEach(pb => (pb.dates || []).forEach(([a, z]) => { if (iso >= a && iso <= z) { const mine = (pb.pass || "").toLowerCase().includes("ikon") ? S.passes.ikon : (pb.pass || "").toLowerCase().includes("epic") ? S.passes.epic : false; tags.push(`<span class="chip" style="color:var(--ink2)">${esc(pb.pass)} blackout${mine ? "" : " · not your pass"}</span>`); } }));
  const body = `<p style="margin:0;color:var(--ink3)">${esc(why)}</p>
    <div class="stats" style="padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
      <div><div class="kick">Go to</div><div class="big">${esc(isPhone() ? MTS[b].short : MTS[b].name)}</div><div class="sub v">crowd ${CROWD_WORD[crowdEst(iso)].toLowerCase()} (est.)</div></div>
      <div><div class="kick">Leave by</div><div class="big">${lh != null ? clock(lh) : "Any time"}</div><div class="sub g">${lh != null ? "+" + Math.round(p.up[lh] || 0) + " min then" : "no rush"}</div></div>
      <div><div class="kick">Home</div><div class="big">${p.homePeak >= 15 ? "By " + clock(Object.keys(p.home).map(Number).find(h => p.home[h] >= 15)) : "Any time"}</div><div class="sub muted">${esc(p.homeLine)}</div></div></div>
    ${tags.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${tags.join("")}</div>` : ""}`;
  return mod("wcall", `<h1 class="call" style="font-size:26px">${esc(line)}</h1>`, "", body, { call: true, cls: "call", label: "Day's call", kick: `<span class="kick" style="color:var(--accent)">${esc(dayLong(iso))} · forecast</span>` });
}
function weekPlanner(iso) {
  const dir = UI.weekDir, vals = [...Array(24).keys()].map(h => expected(iso, dir, h)), p = dayProfile(iso);
  const w0 = dir === "W" ? 5 : 11, w1 = dir === "W" ? 11 : 19, worst = [...Array(w1 - w0).keys()].map(i => i + w0).reduce((a, h) => vals[h] > vals[a] ? h : a, w0), lh = dir === "W" ? p.leaveH : null;
  const body = `<div class="seg" role="group" aria-label="Direction" style="align-self:flex-start"><button data-wdir="W" class="${dir === "W" ? "on" : ""}">Going up</button><button data-wdir="E" class="${dir === "E" ? "on" : ""}">Heading home</button></div>
    <div class="stats"><div><div class="kick">${lh != null ? "At " + clock(lh) : "Best"}</div><div class="big">${hm(90 + (lh != null ? vals[lh] : Math.min(...vals.slice(5, 19))))}</div><div class="sub g">+${Math.round(lh != null ? vals[lh] : Math.min(...vals.slice(5, 19)))} min</div></div>
      <div><div class="kick">Worst</div><div class="big">${vals[worst] < 1 ? "None" : clock(worst)}</div><div class="sub ${tone(vals[worst] / 90)}">+${Math.round(vals[worst])} min</div></div>
      <div><div class="kick">Source</div><div class="big">${(D.model.coverage || {})[`${pyDow(iso)}-amW`] && (D.model.coverage[`${pyDow(iso)}-amW`].n || 0) > 0 ? "Profile" : "Estimate"}</div><div class="sub muted">${isOffDay(iso) ? "holiday-adjusted" : "typical " + dayLong(iso)}</div></div></div>
    ${barsHTML(vals, { H: 96, base: 90 })}<p class="small muted" style="margin:0">All forecast, so all striped. Coors Field to Copper on I-70.</p>`;
  return mod("wplan", `${dayLong(iso)} to Copper`, `${p.leave} · worst ${clock(worst)}, +${Math.round(vals[worst])}`, body, { label: "Day planner" });
}
function weekCrowd(iso, b) {
  const k = UI.crowdM || b, M = MTS[k], open = liftOpen(k, iso), close = M.close;
  // Arrivals estimate: the expected drive up, shifted by the drive time, on the 24-hour axis.
  const arr = [...Array(24).keys()].map(h => h < open - 1 || h > close ? 0 : Math.max(0, expected(iso, "W", Math.max(5, Math.min(10, h - 2)))) + (h >= open && h <= close - 1 ? 3 : 0));
  const mx = Math.max(6, ...arr), X = h => h * 10 + 5, Y = v => (80 - v / mx * 70).toFixed(1);
  const pts = arr.map((v, h) => [X(h), Y(v)]).filter((_, h) => h >= open - 1 && h <= close);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""), area = line + `L${pts[pts.length - 1][0]} 80L${pts[0][0]} 80Z`;
  const peakH = arr.reduce((a, v, h) => v > arr[a] ? h : a, open), quietH = arr.findIndex((v, h) => h > peakH && v < arr[peakH] * 0.5);
  const pct = h => (h * 10 / 2.4).toFixed(2) + "%", lh = dayProfile(iso).leaveH;
  const body = `<div class="mpills vio" role="tablist">${MKEYS.map(kk => `<button role="tab" data-cm="${kk}" class="${kk === k ? "on" : ""}">${esc(MTS[kk].short)}</button>`).join("")}</div>
    <div class="stats"><div><div class="kick">Peak</div><div class="big">${clockS(peakH)} to ${clockS(peakH + 2)}</div><div class="sub v">${CROWD_WORD[crowdEst(iso)]} (est.)</div></div>
      <div><div class="kick">Lift lines</div><div class="big">n/a</div><div class="sub muted">no wait data yet</div></div>
      <div><div class="kick">Quiet</div><div class="big">${quietH > 0 ? "After " + clockS(quietH) : "Late"}</div><div class="sub muted">shorter waits</div></div></div>
    <div style="position:relative;height:120px;border-bottom:1px solid #3A5266"><svg viewBox="0 0 240 80" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" style="display:block;overflow:visible">
      <path d="${area}" fill="#8C7FE0" opacity=".35"></path><path d="${line}" fill="none" stroke="#C1B6FF" stroke-width="2" vector-effect="non-scaling-stroke"></path>
      ${lh != null ? `<line x1="${X(lh)}" x2="${X(lh)}" y1="0" y2="80" stroke="#FFC566" stroke-width="1.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>` : ""}</svg>
      ${lh != null ? `<span style="position:absolute;top:0;left:calc(${pct(lh + 0.5)} - 4px);transform:translateX(-100%);font-size:11px;color:#FFC566;white-space:nowrap">Leave by</span>` : ""}</div>
    <div class="axis" style="height:24px;margin-top:-12px"><span style="left:0;top:6px">12a</span><span style="left:25%;top:6px">6a</span><span style="left:50%;top:6px">12p</span><span style="left:75%;top:6px">6p</span><span style="left:100%;top:6px">12a</span>
      <i style="position:absolute;top:0;left:${pct(open)};width:2px;height:5px;margin-left:-1px;background:#EAF1F6"></i><b style="position:absolute;top:6px;left:${pct(open)};transform:translateX(-50%);color:#EAF1F6">${open % 1 ? clockS(Math.floor(open)).replace(/[ap]$/, ":30$&") : clockS(open)}</b>
      <i style="position:absolute;top:0;left:${pct(close)};width:2px;height:5px;margin-left:-1px;background:#EAF1F6"></i><b style="position:absolute;top:6px;left:${pct(close)};transform:translateX(-50%);color:#EAF1F6">${clockS(close)}</b></div>
    <p style="margin:0;font-weight:600">${lh != null ? `Leave by ${clock(lh)} to be on the lift before it builds.` : "No real rush expected."}</p>
    <p class="small muted" style="margin:0">Estimated from traffic into the base area until the crowd log has a season (${(D.sources || {}).crowd ? "trial running" : "starting"}). White ticks are lift hours.</p>`;
  return mod("wcrowd", `Crowd ${dayLong(iso)}`, `${M.name}: peak ${clockS(peakH)} to ${clockS(peakH + 2)} (estimate)`, body, { label: "Crowd forecast" });
}
function weekWhy(iso, S2, best) {
  const b = best[iso]; if (!b) return "";
  const others = MKEYS.map(k => S2[k + iso]).filter(Boolean).sort((x, y) => y.score - x.score), nxt = others[1];
  const body = factorBars(b.f, { snow: `${r1(b.snow)} in`, drive: b.drivePeak >= 1 ? `+${Math.round(b.drivePeak)} peak` : "clear", wind: b.gust != null ? Math.round(b.gust) + " mph" : "n/a", crowd: CROWD_WORD[crowdEst(iso)], roads: b.f.roads ? String(b.f.roads) : "none", closure: "none" }) +
    `<div><div class="kick" style="margin-bottom:6px">Snow models</div><div style="position:relative;height:20px"><span style="position:absolute;left:0;right:0;top:9px;height:2px;background:var(--line)"></span><span style="position:absolute;left:${Math.min(100, (b.lo || 0) / 12 * 100)}%;width:${Math.max(2, ((b.hi || 0) - (b.lo || 0)) / 12 * 100)}%;top:5px;height:10px;border-radius:5px;background:#2A6A99"></span><span style="position:absolute;left:${Math.min(100, (b.mid || 0) / 12 * 100)}%;top:2px;width:3px;height:16px;background:#EAF1F6"></span></div>
    <div class="row small muted" style="justify-content:space-between"><span>0 in</span><span>${dayShort(b.rangeDay).split(" ")[0]}: ${r1(b.lo || 0)} to ${r1(b.hi || 0)} in across ${b.n || 0} models</span><span>12 in</span></div></div>
    <span class="small muted">Score ${b.score}${nxt ? `. Next best ${esc(MTS[nxt.k].name)} ${nxt.score}` : ""}.</span>`;
  return mod("wwhy", `Why ${MTS[b.k].name} ${dayLong(iso)}`, `Score ${b.score}${nxt ? " · next best " + MTS[nxt.k].name + " " + nxt.score : ""}`, body, { label: "Why the pick" });
}
function weekOthers(iso, S2, best) {
  const rs = MKEYS.map(k => S2[k + iso]).filter(Boolean).sort((a, b) => b.score - a.score).slice(1);
  if (!rs.length) return "";
  const body = `<ul class="plain">${rs.map((r, i) => `<li class="row"><span class="sg muted" style="font-weight:700;width:14px">${i + 2}</span><div style="flex:1"><b>${esc(MTS[r.k].name)}</b><div class="small muted">${r1(r.snow)} in · peak +${Math.round(r.drivePeak)} · gusts ${r.gust != null ? Math.round(r.gust) : "n/a"}</div></div>${meter(crowdEst(iso), true)}<b class="sg" style="width:28px;text-align:right">${r.score}</b></li>`).join("")}</ul>`;
  return mod("wother", "Other mountains", rs.map(r => `${MTS[r.k].name} ${r.score}`).join(" · "), body, { label: "Other mountains" });
}

// ---- History ---------------------------------------------------------------------------------------------------
const HIST = {}, CSV = {};
const parseCSV = t => { const L = t.trim().split(/\r?\n/); if (L.length < 2) return []; const H = L[0].split(","); return L.slice(1).map(l => { const v = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(x => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')); return Object.fromEntries(H.map((h, i) => [h, v[i]])); }); };
async function histMonth(m) { if (!HIST[m]) HIST[m] = fetch(BASE + `history/${m}.json`, { cache: "no-store" }).then(r => r.ok ? r.json() : { days: {} }).catch(() => ({ days: {} })); return HIST[m]; }
async function csvMonth(dir, m) { const k = dir + m; if (!CSV[k]) CSV[k] = fetch(BASE + `${dir}/${m}.csv`, { cache: "no-store" }).then(r => r.ok ? r.text() : "").then(parseCSV).catch(() => []); return CSV[k]; }
async function loadHistory(iso) { const m = iso.slice(0, 7); const [h, st, sn] = await Promise.all([histMonth(m), csvMonth("resort_status", m), csvMonth("snotel", m)]); return { day: (h.days || {})[iso] || null, st, sn }; }
function renderHistory(H) {
  const iso = UI.histDay, day = H && H.day, today = nowParts().iso;
  const picker = `<div class="row" style="justify-content:space-between;gap:8px"><button class="ibtn" data-hday="-1" aria-label="Previous day">‹</button>
    <div style="flex:1;text-align:center;line-height:1.2"><div class="sg" style="font-size:20px;font-weight:600">${dayMed(iso)}</div><div class="small muted">${iso === addDays(today, -1) ? "Yesterday · logged" : "Logged"}</div></div>
    <button class="ibtn" data-hday="1" aria-label="Next day" ${addDays(iso, 1) >= today ? "disabled" : ""}>›</button>
    <label class="ibtn" aria-label="Pick a date" style="position:relative;overflow:hidden">📅<input type="date" id="hdate" value="${iso}" max="${addDays(today, -1)}" min="${D.model.first_day || ""}" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label></div>
    ${dayTags(iso).length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${dayTags(iso).map(t => `<span class="chip">${esc(t.replace(/:.*$/, ""))}</span>`).join("")}</div>` : ""}`;
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
  const pBody = `<div class="seg" role="group" aria-label="Direction" style="align-self:flex-start"><button data-hdir="W" class="${dir === "W" ? "on" : ""}">Going up</button><button data-hdir="E" class="${dir === "E" ? "on" : ""}">Heading home</button></div>
    <div class="mpills" role="tablist">${MKEYS.map(kk => `<button data-hm="${kk}" class="${kk === k ? "on" : ""}">${esc(MTS[kk].short)}</button>`).join("")}</div>
    <div class="stats"><div><div class="kick">Best</div><div class="big">${bH != null ? clock(bH) : "n/a"}</div><div class="sub g">${bH != null ? "+" + Math.round(vals[bH]) + " min" : ""}</div></div>
      <div><div class="kick">Worst</div><div class="big">${wH != null ? clock(wH) : "n/a"}</div><div class="sub ${wH != null ? tone(vals[wH] / base) : ""}">${wH != null ? "+" + Math.round(vals[wH]) + " min" : ""}</div></div>
      <div><div class="kick">Day's peak</div><div class="big">${pk ? "+" + Math.round(pk[1]) : "n/a"}</div><div class="sub muted">${pk ? "at " + clock(pk[0]) : ""}</div></div></div>
    ${barsHTML(vals, { H: 96, base, logged: () => true })}
    <p class="small muted" style="margin:0">All logged, so all solid. Best and worst cover the ski window (${dir === "W" ? "5 to 11 AM" : "11 AM to 7 PM"}); day's peak covers all 24 hours.${rk ? "" : " A-Basin and Winter Park use the I-70 log for now."}</p>`;
  const planner = mod("hdrive", `${dayLong(iso)}, Coors to ${esc(MTS[k].name)}`, bH != null ? `Best ${clock(bH)} · worst ${clock(wH)}, +${Math.round(vals[wH])}` : "No logged hours in the window", pBody, { label: "Drive by hour" });
  const mBody = `<ul class="plain">${MKEYS.map(kk => { const sd = snowDay(kk), l = liftsDay(kk), dp = depthDay(kk), hi = hiDay(kk), w = (() => { let m = null; for (let h = 5; h < 11; h++) { const v = loggedAt(day, "W", h, MTS[kk].eldora ? "eldora_boulder" : null); if (v != null && (m == null || v > m)) m = v; } return m; })();
      return `<li><button data-hm="${kk}" class="row" style="width:100%;border:0;background:${kk === k ? "#13283A" : "none"};border-radius:10px;padding:6px 8px;text-align:left;cursor:pointer"><span style="flex:1;min-width:0"><b>${esc(MTS[kk].name)}</b><span class="small muted" style="display:block">${esc(MTS[kk].route)} · ${l ? esc(l) + " lifts" : "no lift report"} · ${sd != null ? sd + " in new" : "no snow reading"}${dp != null ? ", " + dp + " in base" : ""}${hi != null ? " · high " + hi + "°F" : ""}</span></span><span style="text-align:right"><b class="sg">${w != null ? "+" + Math.round(w) : "n/a"}</b><span class="small muted" style="display:block">worst up</span></span></button></li>`; }).join("")}</ul>
    <p class="small muted" style="margin:0">These are ${dayLong(iso)}'s values, not today's.</p>`;
  const mts = mod("hmtn", "Mountains that day", `Lifts, snow and highs as of ${dayLong(iso)}`, mBody, { label: "Mountains that day" });
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
        <ul class="plain small">${Object.entries(g.error_min || {}).filter(([kk]) => !kk.includes(":")).map(([kk, v]) => `<li class="row" style="justify-content:space-between;padding:6px 0"><span class="muted">${esc({ fri_pm_W: "Fri evening, up", sat_am_W: "Sat morning, up", sun_am_W: "Sun morning, up", sat_pm_E: "Sat afternoon, home", sun_pm_E: "Sun afternoon, home" }[kk] || kk)}</span><span style="color:${v >= 15 ? "var(--ambert)" : "inherit"}">off ${r1(v)} min</span></li>`).join("")}</ul>` : "");
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
    barRow("Crowd", crowdOn ? 1 : 0, crowdOn ? "Last-mile traffic trial is logging. Cameras, app waits and parking come next." : "Starts with the first crowd reading (last-mile traffic trial).", "#8C7FE0") +
    `<div class="row" style="justify-content:space-between;padding-top:8px;border-top:1px solid var(--line)"><span class="small" style="color:var(--ink3)">${dErr != null ? `Accuracy, ${dg.length} graded day${dg.length > 1 ? "s" : ""}` : "Accuracy, last graded weekend"}</span><span><b class="sg" style="font-size:18px">${dErr != null ? dErr : lastG ? r1(lastG.mean_error_min) : "n/a"} min</b> <span class="small muted">off on average</span> <a href="#history" class="small" style="font-weight:600">History ›</a></span></div>`;
  // Training progress: running confidence after each logged day, plus where it heads at this pace.
  const counts = {}, series = (m.daily || []).map(x => { const dow = pyDow(x.d); if (x.typical) ["amW", "pmW", "pmE"].forEach((w, j) => { if (x.win[j]) counts[dow + "-" + w] = (counts[dow + "-" + w] || 0) + 1; });
    let s = 0; for (let d = 0; d < 7; d++) ["amW", "pmW", "pmE"].forEach(w => { s += Math.min(1, (counts[d + "-" + w] || 0) / 6); }); return [x.d, s / 21]; });
  const d0 = m.first_day || nowParts().iso, d1 = addDays(d0, 92), span = 92, X = iso => Math.max(0, Math.min(300, (Date.parse(iso) - Date.parse(d0)) / 864e5 / span * 300));
  const pth = series.map(([d, v], i) => `${i ? "L" : "M"}${X(d).toFixed(1)} ${(100 - v * 100).toFixed(1)}`).join("");
  const hols = (m.holidays || []).filter(([a, b]) => b >= d0 && a <= d1).map(([a, b]) => `<rect x="${X(a).toFixed(1)}" y="0" width="${Math.max(1, X(b) - X(a) + 300 / span).toFixed(1)}" height="100" fill="#F5B841" opacity=".08"></rect>`).join("");
  const perWeek = typDays && series.length ? (series[series.length - 1][1]) / Math.max(1, (Date.parse(series[series.length - 1][0]) - Date.parse(d0)) / 6048e5) : 0;
  const weeksLeft = perWeek > 0 ? (1 - (series.length ? series[series.length - 1][1] : 0)) / perWeek : null, eta = weeksLeft != null ? addDays(nowParts().iso, Math.round(weeksLeft * 7 * 1.25)) : null;
  const prog = `<div style="position:relative;height:170px;border-bottom:1px solid #3A5266;border-left:1px solid var(--line)"><svg viewBox="0 0 300 100" preserveAspectRatio="none" width="100%" height="100%" style="display:block;overflow:visible" aria-label="Training progress">${hols}
      <line x1="0" x2="300" y1="50" y2="50" stroke="#22364A" vector-effect="non-scaling-stroke"></line><path d="${pth}${series.length ? ` L${X(series[series.length - 1][0]).toFixed(1)} 100 L0 100 Z` : ""}" fill="#7FD1FF" opacity=".18"></path>
      <path d="${pth}" fill="none" stroke="#7FD1FF" stroke-width="2.5" vector-effect="non-scaling-stroke"></path>${eta && series.length ? `<path d="M${X(series[series.length - 1][0]).toFixed(1)} ${(100 - series[series.length - 1][1] * 100).toFixed(1)} L${X(eta).toFixed(1)} 0" fill="none" stroke="#7FD1FF" stroke-width="1.5" stroke-dasharray="4 4" opacity=".7" vector-effect="non-scaling-stroke"></path>` : ""}</svg>
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
  const grid = `<div style="display:grid;${gtc};gap:4px;font-size:12px;font-weight:600;color:var(--ink2)"><span></span><span style="text-align:center">I-70</span><span style="text-align:center">Alternates</span>${phone ? '<span style="text-align:center">Crowd</span>' : MKEYS.map(k => `<span style="text-align:center;color:var(--violett)">${esc(MTS[k].short)}</span>`).join("")}</div>` +
    rows.map(r => r ? `<div style="display:grid;${gtc};gap:4px;align-items:center"><span style="font-size:13px">${r[0]}</span>${cell(r[1])}${cell(r[2])}${[...Array(ccols)].map(() => cell(crowdDays, "#8C7FE0")).join("")}</div>` : `<div style="height:1px;background:var(--line);margin:4px 0"></div>`).join("");
  // Sources
  const age = iso => iso ? (Date.now() - Date.parse(iso)) / 6e4 : null;
  const tt = src.tomtom_use || {}, month = nowParts().iso.slice(0, 7), ttCalls = ["routing", "flow", "crowd"].reduce((a, k) => a + (((tt[k] || {})[month]) || 0), 0), dayOfMonth = +nowParts().iso.slice(8);
  const srcRows = [["TomTom routes and stretches", "Every 15 min", src.tomtom_routing, `about ${Math.round(ttCalls / Math.max(1, dayOfMonth))} of 2,500 free calls a day`, "routes"],
    ["CDOT speeds and travel times", "Every 15 min", src.last_run, "", "cdot"], ["NWS forecast", "Hourly", src.forecast, "", "forecast"], ["Open-Meteo outlook", "Every 3 hours", src.outlook, "", "outlook"],
    ["SNOTEL snow", "Hourly", src.snotel ? src.snotel.replace(" ", "T") + ":00-07:00" : null, "", "snotel"], ["Resort lifts and trails", "Twice a day", null, (D.status || {}).checked || "", "resort_status"],
    ["COtrip cameras", "Daily", src.cameras, "", "cameras"]].map(([n, cad, at, x, key]) => { const e = errs[key] || 0, a = age(at), st = e >= 3 ? "a" : a != null && a > 240 && !/Daily|Twice/.test(cad) ? "a" : "g";
      return `<li class="row" style="gap:10px;align-items:flex-start"><span class="dot" style="width:8px;height:8px;margin-top:6px;background:${TONE[st]}"></span><span style="flex:1;min-width:0"><b style="display:block">${n}</b><span class="small muted">${cad}${at ? " · " + esc(fmtDayTime(at)) : ""}${x ? " · " + esc(x) : ""}${e ? ` · ${e} error${e > 1 ? "s" : ""} in 48 h, retried` : ""}</span></span><span class="small" style="font-weight:600;color:${TONE_T[st]}">${st === "g" ? "OK" : "Flaky"}</span></li>`; }).join("") +
    ((src.crowd_sources) || []).map(c => `<li class="row" style="gap:10px;align-items:flex-start"><span class="dot" style="width:8px;height:8px;margin-top:6px;background:${c.status === "trial" ? (crowdOn ? TONE.g : TONE.a) : "#5A7184"}"></span><span style="flex:1;min-width:0"><b style="display:block">Crowd: ${esc(c.name.replace(/^./, s => s.toLowerCase()))}</b><span class="small muted">${c.status === "trial" ? "Every 30 min, 6 AM to 6 PM · trial" : "Planned"}</span></span><span class="small" style="font-weight:600;color:${c.status === "trial" ? TONE_T[crowdOn ? "g" : "a"] : "#9FB2C1"}">${c.status === "trial" ? (crowdOn ? "OK" : "Waiting") : "Not yet"}</span></li>`).join("");
  // Calendar and conditions
  const today = nowParts().iso, up = (m.holidays || []).filter(([a, b]) => b >= today).slice(0, 4);
  const cal = `<ul class="plain">${up.map(([a, b, n]) => `<li class="row" style="justify-content:space-between"><span><b style="display:block">${esc(n)}</b><span class="small muted">${dayMed(a)} to ${dayMed(b)}</span></span><span class="chip">Holiday</span></li>`).join("")}</ul>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px;padding-top:8px;border-top:1px solid var(--line)">${(m.pass_blackouts || []).map(pb => `<span class="muted">${esc(pb.pass)}</span><span>${esc(pb.where)}${(pb.dates || []).length ? " · " + (pb.dates || []).filter(([a, b]) => b >= today).slice(0, 3).map(([a, b]) => `${dayMed(a).replace(/^\w+, /, "")} to ${dayMed(b).replace(/^\w+, /, "")}`).join(", ") : ""}</span>`).join("")}
      <span class="muted">Seen so far</span><span>${Object.entries(m.conditions_seen || {}).filter(([, v]) => v.length).map(([k, v]) => `${v.length} ${k === "disrupted" ? "storm or closure" : k} weekend${v.length > 1 ? "s" : ""}`).join(", ") || "Nothing special yet"}</span></div>`;
  const files = `<ul class="plain">${(D.files || []).filter(f => /\.[a-z]+$/.test(f.path)).concat([{ path: "dashboard.json", bytes: null }]).map(f => `<li class="row"><span style="flex:1;min-width:0"><code style="font-size:12px">${esc(f.path)}</code><span class="small muted" style="display:block">${f.bytes ? (f.bytes > 1048576 ? r1(f.bytes / 1048576) + " MB" : Math.round(f.bytes / 1024) + " KB") : "everything on this page"}</span></span><a class="ibtn" style="width:36px;height:36px" href="${BASE + f.path}" download aria-label="Download ${esc(f.path)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"></path></svg></a></li>`).join("")}</ul>
    <p class="small muted" style="margin:0">Monthly files, public on GitHub. <a href="${REPO_URL}/tree/main/data">Browse them all ›</a> · <a href="${REPO_URL}/archive/refs/heads/main.zip">Download everything (.zip)</a></p>`;
  const L = mod("since", "Since you last looked", prev ? `Since ${fmtDayTime(prev.at)}` : `${days} days logged`, since, { label: "Since you last looked" }) +
    mod("smart", "How smart is it", `Traffic ${conf}% · Routes ${rconf}% · Crowd ${crowdOn ? 1 : 0}%`, smart, { label: "How smart is it" });
  const R2 = mod("prog", "Training progress", `${conf}% today${eta ? " · 100% around " + dayMed(eta).replace(/^\w+, /, "") : ""}`, prog + `<p class="small muted" style="margin:0">Only typical days count toward the weekly pattern, so holidays and breaks pause it.</p>`, { label: "Training progress" });
  const out = `<div class="grid2"><div class="col">${L}</div><div class="col" style="flex:1.3 1 520px">${R2}</div></div>
    <div class="grid2"><div class="col" style="flex:1.3 1 520px">${mod("cov", "Coverage", "Days logged of 6 needed", `<div style="display:flex;flex-direction:column;gap:4px">${grid}</div><p class="small muted" style="margin:0">Weekdays count only typical days. A special day seen fewer than 6 times is capped at 25% confidence.</p>`, { label: "Coverage" })}</div>
      <div class="col">${mod("src", "Sources", `Last run ${fmtTime(src.last_run)}`, `<ul class="plain">${srcRows}</ul><a href="${BASE}errors/${month}.csv" class="small" style="font-weight:600">Error log ›</a>`, { label: "Sources" })}</div></div>
    <div class="grid2"><div class="col">${mod("cal", "Calendar and conditions", up.length ? `Next: ${up[0][2]}, ${dayMed(up[0][0])}` : "", cal, { label: "Calendar and conditions" })}</div><div class="col" style="flex:1.3 1 520px">${mod("files", "Files", `${(D.files || []).length + 1} files · download any or all`, files, { label: "Files" })}</div></div>`;
  return out;
}

// ---- Settings sheet ----------------------------------------------------------------------------------------------
function renderSettings() {
  const sw = (key, on) => `<button class="switch${on ? " on" : ""}" data-alert="${key}" aria-pressed="${on}" aria-label="${key}"></button>`;
  const A = S.alerts;
  return `<div class="row" style="justify-content:space-between"><h2 class="t">Alerts and settings</h2><button class="ibtn" data-close aria-label="Close">✕</button></div>
    <span class="kick">Alerts</span>
    <div class="it"><div style="flex:1"><b>Powder day</b><div class="small muted">A weekend or holiday with at least <select data-powder style="background:#0E1A24;color:var(--ink);border:1px solid var(--line);border-radius:6px">${[4, 6, 8, 12].map(n => `<option ${n === A.powderIn ? "selected" : ""}>${n}</option>`).join("")}</select> inches forecast at your mountains</div></div>${sw("powder", A.powder)}</div>
    <div class="it"><div style="flex:1"><b>Time to head home</b><div class="small muted">When the drive home is about to get slow</div></div>${sw("home", A.home)}</div>
    <div class="it"><div style="flex:1"><b>Closures</b><div class="small muted">I-70 or a pass on your route closes</div></div>${sw("closures", A.closures)}</div>
    <div class="it"><div style="flex:1"><b>Morning call</b><div class="small muted">Today's verdict at 5:30 AM on weekends and holidays</div></div>${sw("morning", A.morning)}</div>
    <p class="small muted" style="margin:0">Alerts are saved on this device. Sending them needs push set up (a stored subscription), which is next on the list.</p>
    <span class="kick">Mountains and passes</span>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${[["ikon", "Ikon"], ["epic", "Epic"], ["indy", "Independent"], ["overnight", "Overnight"]].map(([k, n]) => `<button class="pill${S.passes[k] ? " on" : ""}" data-pass="${k}">${n}</button>`).join("")}</div>
    <span class="kick">Page</span>
    <div><b>Switch to the drive home at</b><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px">${[[11, "11 AM"], [12, "Noon"]].map(([h, n]) => `<button class="pill${S.flip === h ? " on" : ""}" data-flip="${h}">${n}</button>`).join("")}</div></div>
    <div><b>Season</b><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px">${[["auto", "Auto"], ["regular", "Regular"], ["off", "Off-season"]].map(([k, n]) => `<button class="pill${S.season === k ? " on" : ""}" data-season="${k}" style="padding:0 6px">${n}</button>`).join("")}</div></div>
    <span class="kick">Home Screen</span>
    <p style="margin:0">Add Ski Day to your Home Screen to open it full screen: in Safari, tap Share, then Add to Home Screen.</p>
    <p class="small muted" style="margin:0">Ski Day 2.0. The old page is still up at <a href="classic/">/classic/</a>.</p>`;
}

// ---- Render and events ------------------------------------------------------------------------------------------
let histData = null;
function render() {
  const tab = (location.hash || "#today").slice(1);
  UI.tab = ["today", "week", "history", "data"].includes(tab) ? tab : "today";
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + UI.tab));
  const { hour } = nowParts();
  $("sub").textContent = UI.tab === "today" ? `${dayMed(nowParts().iso)} · updated ${fmtTime(D.updated)}` : UI.tab === "week" ? `Forecast from ${fmtTime((D.outlook || {}).updated)}` : UI.tab === "history" ? "History · logged data" : "Data · model, sources and files";
  $("headchip").innerHTML = UI.tab === "today" || UI.tab === "week" ? `<span class="chip ${D.model.confidence >= 0.5 ? "blu" : "amb"}">Model ${Math.round((D.model.confidence || 0) * 100)}% trained</span>` : "";
  let html = "";
  try {
    if (UI.tab === "today") html = renderToday();
    else if (UI.tab === "week") html = renderWeek();
    else if (UI.tab === "history") { if (!UI.histDay) UI.histDay = addDays(nowParts().iso, -1); html = renderHistory(histData && histData.iso === UI.histDay ? histData : null);
      if (!histData || histData.iso !== UI.histDay) loadHistory(UI.histDay).then(h => { histData = { iso: UI.histDay, ...h }; if (UI.tab === "history") render(); }); }
    else html = renderData();
  } catch (e) { console.error(e); html = `<div class="err">Something broke drawing this tab: ${esc(e.message)}. The data loaded fine; this is a page bug.</div>`; }
  $("main").innerHTML = `<div style="display:flex;flex-direction:column;gap:${isPhone() ? 14 : 20}px">${html}</div>`;
}
document.addEventListener("click", ev => {
  const t = ev.target.closest("[data-tog],[data-dir],[data-m],[data-day],[data-wdir],[data-cm],[data-hday],[data-hdir],[data-hm],[data-close],[data-alert],[data-pass],[data-flip],[data-season],.bars i[data-h]");
  if (!t) return;
  const d = t.dataset;
  if (d.tog) { if (!isPhone()) return; const sec = $("m-" + d.tog); const c = !sec.classList.contains("closed"); sec.classList.toggle("closed", c); t.setAttribute("aria-expanded", !c); c ? UI.closed.add(d.tog) : UI.closed.delete(d.tog); store.set("closed", [...UI.closed]); return; }
  if (d.dir) { UI.dir = d.dir; UI.selHour = null; }
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
});
$("gear").onclick = () => { $("sheetpane").innerHTML = renderSettings(); $("sheet").classList.add("on"); };
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
