"""
Route pages (SEO): one static page per city pair, rebuilt with every forecast, plus an index. Each page answers
"could a supersonic airliner fly <A> to <B> without a sonic boom today?" from today's FL550 field (GFS + ECMWF mean,
analysis time) along the great circle, with a typical margin, and links to the live router for the real plan.

Input: engine/_cache_fl550_f000.npz written by build.py (M: 36 directions x 181 x 360, lat 90..-90, lon 0..359;
land mask). Output: site/routes/<a>-<b>.html, site/routes/index.html, site/sitemap.xml.
Numbers here are a quick screen (no wind on ground speed, one level, typical margin); the router on the map is the plan.
"""
import argparse, datetime as dt, html, json, math, os, re
import numpy as np

MARGIN = 0.05            # typical Auto margin at FL550 (the live map uses the per-point ensemble margin)
M_MIN = 1.05             # below this a corridor is not worth flying (map's default threshold)
M_SUPER = 1.7            # Overture-class cruise over water
M_SUB = 0.85             # today's airliner
M_SUBSONIC_SST = 0.94    # a supersonic aircraft held subsonic over land
A_FL550 = 295.07         # speed of sound in the ISA stratosphere, m/s
OVERHEAD_MIN = 30        # taxi, climb and descent allowance per flight

PAIRS = [("KJFK", "KLAX"), ("KJFK", "KSFO"), ("KJFK", "KSEA"), ("KBOS", "KLAX"), ("KBOS", "KSFO"), ("KORD", "KLAX"),
         ("KORD", "KSFO"), ("KATL", "KLAX"), ("KATL", "KSEA"), ("KMIA", "KLAX"), ("KMIA", "KSEA"), ("KIAD", "KLAX"),
         ("KIAD", "KSFO"), ("KDFW", "KJFK"), ("KDFW", "KSEA"), ("KIAH", "KJFK"), ("KDEN", "KJFK"), ("KDEN", "KMIA"),
         ("KLAS", "KJFK"), ("KPHX", "KJFK"), ("KCLE", "KLAX"), ("KMSP", "KMIA"), ("KJFK", "TJSJ"),
         ("KMIA", "TJSJ"), ("KDFW", "TJSJ"), ("KLAX", "PHNL"), ("KSFO", "PHNL"), ("KSEA", "PANC"), ("CYYZ", "CYVR"),
         ("CYYZ", "KLAX"), ("KJFK", "MMMX"), ("KLAX", "MMMX"), ("KMIA", "SBGR"), ("KJFK", "SBGR"), ("KMIA", "SAEZ"),
         ("KMIA", "SKBO"), ("KJFK", "SCEL"), ("KJFK", "EGLL"), ("KJFK", "LFPG"), ("KBOS", "EGLL"), ("KIAD", "EDDF"),
         ("KORD", "EGLL"), ("KJFK", "LEMD"), ("KMIA", "LEMD"), ("TJSJ", "LEMD"), ("EGLL", "OMDB"), ("EGLL", "VIDP"),
         ("EGLL", "WSSS"), ("EGLL", "VHHH"), ("LFPG", "HKJK"), ("EGLL", "FAOR"), ("EDDF", "ZBAA"), ("EGLL", "LTFM"),
         ("LEMD", "SBGR"), ("OMDB", "WSSS"), ("OMDB", "VABB"), ("ZBAA", "ZSPD"), ("RJTT", "VHHH"), ("RKSI", "WSSS"),
         ("KSFO", "RJTT"), ("KLAX", "RJTT"), ("KLAX", "YSSY"), ("YSSY", "YMML"), ("YSSY", "WSSS"), ("NZAA", "YSSY"),
         ("SBGR", "SAEZ"), ("SBGR", "SCEL"), ("HECA", "OMDB"), ("UUEE", "LTFM")]


def airports(site_dir):
    src = open(os.path.join(site_dir, "app.js"), encoding="utf8").read()
    block = src[src.index("const AIRPORTS = ["):src.index("];", src.index("const AIRPORTS = ["))]
    out = {}
    for code, name, la, lo in re.findall(r'\["([A-Z0-9]{4})", "([^"]+)", (-?[\d.]+), (-?[\d.]+)\]', block):
        out[code] = (name, float(la), float(lo))
    return out


def gc_points(a, b, step_km=50.0):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d = 2 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))
    n = max(2, int(d * 6371.0 / step_km) + 1)
    pts = []
    for i in range(n):
        f = i / (n - 1)
        A = math.sin((1 - f) * d) / math.sin(d); B = math.sin(f * d) / math.sin(d)
        x = A * math.cos(la1) * math.cos(lo1) + B * math.cos(la2) * math.cos(lo2)
        y = A * math.cos(la1) * math.sin(lo1) + B * math.cos(la2) * math.sin(lo2)
        z = A * math.sin(la1) + B * math.sin(la2)
        pts.append((math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))))
    return pts, d * 6371.0


def bearing(p, q):
    la1, lo1, la2, lo2 = map(math.radians, (p[0], p[1], q[0], q[1]))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def sample(F, la, lo, hdg):
    i = int(round(90 - la)); j = int(round(lo % 360)) % 360
    k = int(round(hdg / 10.0)) % 36
    land = bool(F["land"][i, j] > 0)
    m = float(F["M"][k, i, j])
    return land, (m if np.isfinite(m) else float("nan"))


def analyse(F, A, B):
    pts, dist = gc_points((A[1], A[2]), (B[1], B[2]))
    seg = dist / (len(pts) - 1)
    legs = []
    for p, q in zip(pts[:-1], pts[1:]):
        mid = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        land, m = sample(F, mid[0], mid[1], bearing(p, q))
        usable = land and np.isfinite(m) and (m - MARGIN) >= M_MIN
        legs.append({"land": land, "m": None if not np.isfinite(m) else round(m, 3), "usable": bool(usable)})
    land_km = seg * sum(l["land"] for l in legs)
    corr_km = seg * sum(l["usable"] for l in legs)
    tas = lambda M: M * A_FL550 * 3.6
    t_sub = dist / tas(M_SUB)
    t_ban = (dist - land_km) / tas(M_SUPER) + land_km / tas(M_SUBSONIC_SST)
    t_corr = 0.0
    for l in legs:
        if not l["land"]:
            t_corr += seg / tas(M_SUPER)
        elif l["usable"]:
            t_corr += seg / tas(min(M_SUPER, l["m"] - MARGIN))
        else:
            t_corr += seg / tas(M_SUBSONIC_SST)
    mm = [l["m"] - MARGIN for l in legs if l["usable"]]
    return {"dist_km": dist, "land_km": land_km, "corr_km": corr_km, "legs": legs, "seg_km": seg,
            "t_sub_h": t_sub + OVERHEAD_MIN / 60, "t_ban_h": t_ban + OVERHEAD_MIN / 60, "t_corr_h": t_corr + OVERHEAD_MIN / 60,
            "corr_mach_median": float(np.median(mm)) if mm else None}


def hm(h):
    m = int(round(h * 60))
    return f"{m // 60} h {m % 60:02d} min"


def slug(a, b):
    return f"{a.lower()}-{b.lower()}"


HEAD = """<!doctype html>
<html lang="en">
<head>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5654559314082674"
     crossorigin="anonymous"></script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://machcorridor.com/{path}">
<meta property="og:type" content="article">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="https://machcorridor.com/{path}">
<meta property="og:image" content="https://machcorridor.com/og.jpg">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23061029'/%3E%3Cpath d='M6 21 L16 9 L26 21' fill='none' stroke='%23fff' stroke-width='2.6' stroke-linejoin='round'/%3E%3Cpath d='M5 25 Q16 17 27 25' fill='none' stroke='%237FA6DB' stroke-width='2.2'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../style.css">
<style>
  html, body {{ height: auto; }}
  .bar {{ height: 52px; }}
  .rt {{ max-width: 760px; margin: 0 auto; }}
  .rt h1 {{ font-size: 28px; }}
  .rt .lead {{ font-size: 16.5px; color: var(--ink); line-height: 1.6; }}
  .rt h2 {{ font-size: 18px; font-weight: 600; margin: 28px 0 6px; }}
  .rt p, .rt li {{ color: var(--ink-2); line-height: 1.65; }}
  .rt .kpis {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }}
  .rt .kpi {{ background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius); padding: 10px 12px; }}
  .rt .kpi b {{ display: block; font-size: 20px; font-weight: 600; color: var(--ink); }}
  .rt .kpi span {{ font-size: 12.5px; color: var(--ink-3); }}
  .rt .kpi.hl {{ border-color: var(--accent); }}
  .rt .strip {{ width: 100%; height: 48px; display: block; margin: 6px 0 2px; border-radius: 4px; }}
  .rt .ends {{ display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-3); }}
  .rt .keyline {{ display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; margin: 6px 0 10px; }}
  .rt .keyline i {{ display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }}
  .rt .ss {{ margin: 6px 0 14px; }}
  .rt .cta {{ display: inline-block; margin: 8px 0 0; padding: 8px 14px; border-radius: var(--radius); background: var(--ink); color: var(--paper); text-decoration: none; font-weight: 500; }}
  .rt .tbl td, .rt .tbl th {{ white-space: normal; }}
  .rt ul.routes {{ columns: 2; padding-left: 18px; }}
  @media (max-width: 640px) {{ .rt .kpis {{ grid-template-columns: 1fr; }} .rt ul.routes {{ columns: 1; }} }}
</style>
<script src="../ui.js" defer></script>
<script src="https://fernando-vazquez.netlify.app/bar/v1.js" defer data-project="mach"></script>
</head>
<body>
<header class="bar">
  <a class="brand" href="../" aria-label="Mach Corridor home">
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#061029"/><path d="M6 21 L16 9 L26 21" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="M5 25 Q16 17 27 25" fill="none" stroke="#7FA6DB" stroke-width="2.2"/></svg>
    <span class="name">Mach Corridor</span>
  </a>
  <div class="status"><a href="../about/">About</a><a href="index.html">All routes</a><a href="../rockets.html">Rocket booms</a><a href="../">Live map</a></div>
</header>
<main class="page rt">
"""
FOOT = """
  <p class="fine">Mach Corridor is an open research project; not for flight planning. Data: NOAA GFS and ECMWF IFS open data (CC BY 4.0). <a href="../privacy.html">Privacy</a> · <a href="https://github.com/FernandoVazq/mach-corridor">Code and method</a>.</p>
</main>
</body>
</html>
"""


def strip_svg(r):
    """Along-route bar: water, land with a corridor (shade = Mach), land without one."""
    W, H, n = 720, 54, len(r["legs"])
    w = W / n
    out = [f'<svg class="strip" viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Along the route: water, land with a boomless corridor, and land without one">']
    for i, l in enumerate(r["legs"]):
        if not l["land"]:
            fill, op = "var(--route-super)", 0.35
        elif l["usable"]:
            fill, op = "var(--accent)", min(1.0, 0.35 + (l["m"] - MARGIN - M_MIN) * 6)
        else:
            fill, op = "var(--bad)", 0.75
        out.append(f'<rect x="{i * w:.1f}" y="0" width="{w + 0.6:.1f}" height="{H}" fill="{fill}" fill-opacity="{op:.2f}"/>')
    out.append("</svg>")
    out.append(f'<div class="ends"><span>Departure</span><span>Arrival · {r["dist_km"]:,.0f} km</span></div>')
    return "".join(out)


def corridor_strip(r):
    """The standard summary strip (site/ui.js): usable boomless Mach over the land legs that have a corridor."""
    v = sorted(l["m"] - MARGIN for l in r["legs"] if l["usable"])
    if not v:
        return ""
    q = lambda f: v[min(len(v) - 1, int(f * (len(v) - 1) + 0.5))]
    n_land = sum(1 for l in r["legs"] if l["land"])
    return (f'  <div class="ss" data-values="{",".join(f"{x:.3f}" for x in v)}" '
            f'data-ref="{M_MIN}" data-ref-label="floor" data-dec="2" data-lo="1.0" data-unit="Mach" data-period="today, FL550" '
            f'data-n="{len(v)} of {n_land} land legs of {r["seg_km"]:.0f} km" data-label="Corridor speed over land"></div>')


def route_page(a, b, A, B, r, run_iso):
    nA, nB = A[0], B[0]
    title = f"Supersonic {nA} to {nB} without a sonic boom: today's forecast · Mach Corridor"
    land_share = r["land_km"] / r["dist_km"]
    corr_share = r["corr_km"] / r["land_km"] if r["land_km"] > 1 else None
    if r["land_km"] < 50:
        verdict = f"Almost all of {nA} to {nB} is over water, where supersonic flight is already allowed: no corridor is needed."
    elif corr_share is not None and corr_share >= 0.9:
        verdict = f"Yes: today a boomless corridor covers {corr_share:.0%} of the {r['land_km']:,.0f} km over land."
    elif corr_share and corr_share >= 0.4:
        verdict = f"Partly: today a boomless corridor covers {corr_share:.0%} of the {r['land_km']:,.0f} km over land."
    else:
        verdict = f"Not today: a boomless corridor covers only {(corr_share or 0):.0%} of the {r['land_km']:,.0f} km over land."
    desc = f"{verdict} Flight time {hm(r['t_corr_h'])} with corridors, {hm(r['t_ban_h'])} under today's rules, {hm(r['t_sub_h'])} on a subsonic airliner."
    mach_line = f" Median usable corridor speed over land: Mach {r['corr_mach_median']:.2f}." if r["corr_mach_median"] else ""
    body = [HEAD.format(title=html.escape(title), desc=html.escape(desc), path=f"routes/{slug(a, b)}.html"),
            f"  <h1>{html.escape(nA)} to {html.escape(nB)}, supersonic and boomless?</h1>",
            f'  <p class="lead">{html.escape(verdict)}{html.escape(mach_line)}</p>',
            '  <div class="kpis">',
            f'    <div class="kpi hl"><b>{hm(r["t_corr_h"])}</b><span>Supersonic with today\'s corridors</span></div>',
            f'    <div class="kpi"><b>{hm(r["t_ban_h"])}</b><span>Supersonic, subsonic over land (today\'s rules)</span></div>',
            f'    <div class="kpi"><b>{hm(r["t_sub_h"])}</b><span>Subsonic airliner, Mach {M_SUB}</span></div>',
            "  </div>",
            strip_svg(r),
            '  <p class="keyline"><span><i style="background:var(--route-super);opacity:.5"></i>Water, Mach 1.7</span><span><i style="background:var(--accent)"></i>Land, boomless corridor</span><span><i style="background:var(--bad)"></i>Land, boom would land: subsonic</span></p>',
            corridor_strip(r),
            f'  <a class="cta" href="../#fl=550&amp;mg=auto&amp;r={a}-{b}&amp;ac=overture&amp;o=time">Plan this route on the live map</a>',
            f'  <details class="fold"><summary>How this is worked out <span class="sm">Great circle, 55,000 ft, today\'s forecast, margin {MARGIN}.</span></summary><div class="fb">'
            f"<p>A supersonic aircraft is boomless when the air below it bends the boom back up before it reaches the ground (Mach cutoff). How fast it can fly that way depends on the temperature and wind on the day and on the direction of flight. This page follows the great circle from {html.escape(nA)} to {html.escape(nB)} at 55,000 ft through today's forecast (NOAA GFS and ECMWF, analysis time), takes the boomless Mach for the route's direction at each point, and keeps a typical safety margin of {MARGIN}. Times assume no wind and add {OVERHEAD_MIN} minutes for climb and descent; the over-water cruise is Mach {M_SUPER}, like Boom Overture.</p>"
            f"<p>The great-circle distance is {r['dist_km']:,.0f} km, {land_share:.0%} of it over land. The live map plans the real route: it can detour to find better air, picks the margin point by point from the ensemble forecast, and refuses a corridor when the forecast is too old.</p></div></details>",
            '  <details class="fold"><summary>Why it changes from day to day <span class="sm">Half season, half the weather of the day.</span></summary><div class="fb">'
            "<p>About half of the variation in the boomless speed is the season and half is the weather of the day. Corridors are widest in summer and narrowest in winter, and flying east into the jet stream is the hardest direction in winter.</p></div></details>",
            f'  <p class="fine">Forecast valid {html.escape(run_iso)}. Updated four times a day.</p>',
            FOOT]
    return "\n".join(body), desc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache_fl550_f000.npz"))
    ap.add_argument("--site", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site"))
    a = ap.parse_args()
    Z = np.load(a.cache, allow_pickle=False)
    F = {"M": Z["M"].astype(np.float32), "land": Z["land"]}
    run = str(Z["run"])
    run_iso = dt.datetime.strptime(run, "%Y%m%d%H").strftime("%d %b %Y %H:00 UTC")
    APT = airports(a.site)
    os.makedirs(os.path.join(a.site, "routes"), exist_ok=True)
    rows = []
    for x, y in PAIRS:
        if x not in APT or y not in APT:
            continue
        r = analyse(F, APT[x], APT[y])
        page, desc = route_page(x, y, APT[x], APT[y], r, run_iso)
        with open(os.path.join(a.site, "routes", f"{slug(x, y)}.html"), "w", encoding="utf8") as f:
            f.write(page)
        rows.append((x, y, r))
    # index
    items = []
    for x, y, r in sorted(rows, key=lambda t: -(t[2]["t_ban_h"] - t[2]["t_corr_h"])):
        save = (r["t_ban_h"] - r["t_corr_h"]) * 60
        items.append(f'    <tr><td><a href="{slug(x, y)}.html">{html.escape(APT[x][0])} – {html.escape(APT[y][0])}</a></td>'
                     f'<td>{r["dist_km"]:,.0f}</td><td>{(r["corr_km"] / r["land_km"] if r["land_km"] > 50 else 1):.0%}</td><td>{save:.0f}</td></tr>')
    desc = f"Which airline routes could fly supersonic without a sonic boom today: corridor coverage over land and minutes saved for {len(rows)} city pairs, updated four times a day."
    idx = [HEAD.format(title="Boomless supersonic routes today · Mach Corridor", desc=desc, path="routes/"),
           "  <h1>Boomless supersonic routes today</h1>",
           f'  <p class="lead">For each city pair: how much of the flight over land has a boomless corridor in today\'s forecast, and how many minutes corridors save against flying subsonic over land. Sorted by minutes saved.</p>',
           '  <div class="tblwrap" tabindex="0" role="region" aria-label="Routes"><table class="tbl"><thead><tr><th scope="col">Route</th><th scope="col">Distance, km</th><th scope="col">Land with a corridor</th><th scope="col">Minutes saved</th></tr></thead><tbody>',
           *items, "  </tbody></table></div>",
           f'  <p class="fine">Forecast valid {html.escape(run_iso)}. FL550, typical margin {MARGIN}, no wind; the live map plans each route in full.</p>',
           FOOT]
    with open(os.path.join(a.site, "routes", "index.html"), "w", encoding="utf8") as f:
        f.write("\n".join(idx))
    # sitemap
    urls = [("", "hourly", "1.0"), ("about/", "weekly", "0.9"), ("es/", "weekly", "0.9"), ("rockets.html", "hourly", "0.9"), ("sound.html", "hourly", "0.8"), ("fireballs.html", "daily", "0.8"), ("routes/", "daily", "0.8")] + \
           [(f"routes/{slug(x, y)}.html", "daily", "0.6") for x, y, _ in rows] + [("privacy.html", "yearly", "0.2")]
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    sm += [f"  <url><loc>https://machcorridor.com/{u}</loc><changefreq>{c}</changefreq><priority>{p}</priority></url>" for u, c, p in urls]
    sm.append("</urlset>")
    with open(os.path.join(a.site, "sitemap.xml"), "w") as f:
        f.write("\n".join(sm) + "\n")
    try:                                           # status, published with the data branch (CI logs are not always readable)
        json.dump({"run": run, "pages": len(rows), "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")},
                  open(os.path.join(a.site, "data", "pages.json"), "w"))
    except OSError:
        pass
    print(f"wrote {len(rows)} route pages, index and sitemap ({run})")


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        print(f"::warning title=pages.py::{ex}")
        raise
