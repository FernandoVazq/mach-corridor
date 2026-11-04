"""
Articles and the author page (AdSense "low value content" fix, Nov 2026): written, visible text with figures.
Writes, from tools/learn_en.py and tools/learn_es.py:
  site/learn/index.html, site/learn/<slug>/index.html            (English)
  site/es/aprende/index.html, site/es/aprende/<slug>/index.html  (Spanish)
  site/author/index.html, site/es/autor/index.html
Every page carries the same site menu (Map · Articles · Method · About the author · Privacy) as the rest of the site.
Usage: python tools/learn_pages.py
"""
import html, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import learn_en, learn_es  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")
UPDATED = "2026-11-04"
FONTS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
MAIL = "fernando.vazquez2@aol.com"
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23061029'/%3E"
        "%3Cpath d='M6 21 L16 9 L26 21' fill='none' stroke='%23fff' stroke-width='2.6' stroke-linejoin='round'/%3E%3Cpath d='M5 25 Q16 17 27 25' fill='none' stroke='%237FA6DB' stroke-width='2.2'/%3E%3C/svg%3E")
BRAND_SVG = ('<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#061029"/>'
             '<path d="M6 21 L16 9 L26 21" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>'
             '<path d="M5 25 Q16 17 27 25" fill="none" stroke="#7FA6DB" stroke-width="2.2"/></svg>')
e = html.escape

L = {
 "en": {
  "nav": [("Map", "/"), ("Articles", "/learn/"), ("Method", "/learn/how-the-forecast-works/"), ("About the author", "/author/"), ("Privacy", "/privacy.html")],
  "base": "/learn/", "author": "/author/", "other_lang": "ES", "other_name": "Español",
  "by": "By", "updated": "Updated", "min": "min read", "sources": "Sources", "more": "More articles",
  "tools_h": "Tools", "tools": [("Live map", "/"), ("Rocket booms", "/rockets.html"), ("Sound tonight", "/sound.html"), ("Fireballs", "/fireballs.html"),
                                 ("X-59 carpet", "/x59.html"), ("Blast windows", "/blast.html"), ("Routes today", "/routes/"), ("The project", "/about/")],
  "contact": "Contact", "notice": "Research project by Fernando J. Vázquez. Not for flight planning.",
  "ad": "Advertisement", "ad_about": "About ads and privacy", "date": "4 November 2026", "illus": "Illustration",
  "idx_title": "Articles: how boomless supersonic flight works", "idx_h1": "Articles",
  "idx_lead": "How a sonic boom can stay in the sky, how the forecast on this site is made and checked, and the history and the airplanes behind it. Written by me, Fernando J. Vázquez, with the data behind every number.",
  "idx_desc": "Plain-language articles on Mach cutoff, the Mach Corridor forecast and its validation against weather balloons, the 1973 ban on supersonic flight over land, and NASA's X-59.",
  "read_btn": "Read the article",
 },
 "es": {
  "nav": [("Mapa", "/"), ("Artículos", "/es/aprende/"), ("Método", "/es/aprende/como-funciona-el-pronostico/"), ("Sobre el autor", "/es/autor/"), ("Privacidad", "/privacy.html")],
  "base": "/es/aprende/", "author": "/es/autor/", "other_lang": "EN", "other_name": "English",
  "by": "Por", "updated": "Actualizado", "min": "min de lectura", "sources": "Fuentes", "more": "Más artículos",
  "tools_h": "Herramientas", "tools": [("Mapa en vivo", "/"), ("Estampidos de cohetes", "/rockets.html"), ("Sonido esta noche", "/sound.html"), ("Bólidos", "/fireballs.html"),
                                        ("Alfombra del X-59", "/x59.html"), ("Ventanas de voladura", "/blast.html"), ("Rutas de hoy", "/routes/"), ("El proyecto", "/es/")],
  "contact": "Contacto", "notice": "Proyecto de investigación de Fernando J. Vázquez. No apto para planificar vuelos.",
  "ad": "Anuncio", "ad_about": "Sobre los anuncios y la privacidad", "date": "4 de noviembre de 2026", "illus": "Ilustración",
  "idx_title": "Artículos: cómo funciona el vuelo supersónico sin estampido", "idx_h1": "Artículos",
  "idx_lead": "Cómo un estampido sónico puede quedarse en el cielo, cómo se hace y se comprueba el pronóstico de este sitio, y la historia y los aviones detrás de todo esto. Escritos por mí, Fernando J. Vázquez, con los datos detrás de cada número.",
  "idx_desc": "Artículos en lenguaje sencillo sobre el Mach cutoff, el pronóstico de Mach Corridor y su validación con globos sonda, la prohibición de 1973 del vuelo supersónico sobre tierra y el X-59 de la NASA.",
  "read_btn": "Leer el artículo",
 },
}

CSS = """
.art { max-width: 760px; margin: 0 auto; padding: 34px 20px 60px; }
.art h1 { font: 700 clamp(30px, 5vw, 42px)/1.08 var(--font-display); letter-spacing: -.01em; margin: 0 0 12px; }
.art .lead { font-size: 19px; line-height: 1.55; color: var(--ink); margin: 0 0 14px; }
.art .byline { font-size: 13px; color: var(--ink-3); margin: 0 0 26px; }
.art .byline a { color: inherit; }
.art h2 { font: 700 24px/1.2 var(--font-display); margin: 34px 0 10px; }
.art p, .art li { font-size: 16.5px; line-height: 1.7; color: var(--ink); }
.art p { margin: 0 0 14px; }
.art figure { margin: 22px 0 24px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px 14px 10px; }
.art figure svg, .art figure img { width: 100%; height: auto; display: block; }
.art figure img { border-radius: 6px; }
.art figcaption { font-size: 13.5px; line-height: 1.5; color: var(--ink-2); margin-top: 8px; }
.art figcaption b { color: var(--ink); }
.art .cta { display: inline-block; margin: 10px 0 4px; }
.art .src { margin-top: 34px; border-top: 1px solid var(--rule); padding-top: 14px; }
.art .src h2 { font-size: 18px; margin-top: 0; }
.art .src li { font-size: 14px; line-height: 1.5; color: var(--ink-2); margin-bottom: 6px; }
.art .rel { margin-top: 26px; }
.art .rel ul { padding-left: 18px; }
.art table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 6px 0 4px; }
.art th, .art td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; }
.art th { color: var(--ink-3); font-weight: 500; font-size: 12.5px; }
.art td.r, .art th.r { text-align: right; white-space: nowrap; }
.art tr.key td { font-weight: 600; }
.art .cards { display: grid; gap: 14px; margin-top: 20px; }
.art .card { display: block; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius); padding: 16px 18px; text-decoration: none; color: inherit; }
.art .card:hover { border-color: var(--ink-3); }
.art .card h2 { margin: 0 0 6px; font-size: 22px; }
.art .card p { margin: 0 0 8px; font-size: 15px; color: var(--ink-2); line-height: 1.55; }
.art .card span { font-size: 13px; color: var(--ink-3); }
.art .notice { background: var(--warn-soft); border-radius: 8px; padding: 10px 14px; font-weight: 600; font-size: 14px; }
.sitefoot { max-width: 760px; margin: 0 auto; padding: 0 20px 40px; font-size: 13px; color: var(--ink-3); line-height: 1.7; }
.sitefoot a { color: var(--ink-2); }
.adslot { margin: 28px 0; }
@media (max-width: 640px) { .art p, .art li { font-size: 16px; } .art .lead { font-size: 17.5px; } }
"""


# ---------- the shared site menu (same markup as the hand-written pages) ----------
def nav(lang, here=None, other_href=None):
    T = L[lang]
    items = "".join(f'<a href="{h}"{" aria-current=\"page\"" if h == here else ""}>{e(t)}</a>' for t, h in T["nav"])
    lang_a = f'<a class="lang" href="{other_href}" hreflang="{"es" if lang == "en" else "en"}" title="{e(T["other_name"])}">{T["other_lang"]}</a>' if other_href else ""
    return (f'<header class="bar">\n  <a class="brand" href="/" aria-label="Mach Corridor">{BRAND_SVG}<span class="name">Mach Corridor</span></a>\n'
            f'  <nav class="status sitenav" aria-label="{"Site" if lang == "en" else "Sitio"}">{items}{lang_a}</nav>\n</header>')


def foot(lang):
    T = L[lang]
    tools = " · ".join(f'<a href="{h}">{e(t)}</a>' for t, h in T["tools"])
    return (f'<footer class="sitefoot"><p>{T["tools_h"]}: {tools}</p>'
            f'<p>{e(T["notice"])} {T["contact"]}: <a href="mailto:{MAIL}">{MAIL}</a> · <a href="/privacy.html">{"Privacy" if lang == "en" else "Privacidad"}</a></p></footer>')


def head(lang, title, desc, path, alt_path=None):
    alt = f'\n<link rel="alternate" hreflang="{"es" if lang == "en" else "en"}" href="https://machcorridor.com{alt_path}">' if alt_path else ""
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5654559314082674"
     crossorigin="anonymous"></script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)} · Mach Corridor</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="https://machcorridor.com{path}">{alt}
<meta property="og:type" content="article">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="https://machcorridor.com{path}">
<meta property="og:image" content="https://machcorridor.com/og.jpg">
<link rel="icon" href="{ICON}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{FONTS}" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
<style>{CSS}</style>
<script src="/config.js" defer></script>
<script src="/ads.js" defer></script>
<script src="https://fernando-vazquez.netlify.app/bar/v1.js" defer data-project="mach"></script>
</head>
<body>"""


# ---------- figures (inline SVG, colours from the site's tokens so they follow dark mode) ----------
def T_(x, y, s, size=13, anchor="start", weight=400, fill="var(--ink-2)", extra=""):
    return f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" font-weight="{weight}" fill="{fill}" font-family="var(--font-body)"{extra}>{e(s)}</text>'


def fig_cutoff_side(lang):
    en = lang == "en"
    W, H, G = 720, 300, 250
    s = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{e("Two side views: slow enough, the boom turns back up before the ground; too fast, it reaches the ground" if en else "Dos vistas de lado: lo bastante lento, el estampido sube antes del suelo; demasiado rápido, llega al suelo")}">',
         '<defs><linearGradient id="fAir" x1="0" x2="0" y1="1" y2="0"><stop offset="0%" stop-color="var(--warn-soft)"/><stop offset="70%" stop-color="var(--surface-2)"/></linearGradient></defs>']
    for k, (x0, ok) in enumerate([(10, True), (370, False)]):
        w = 340
        s.append(f'<rect x="{x0}" y="30" width="{w}" height="{G - 30}" fill="url(#fAir)" rx="6"/>')
        s.append(f'<line x1="{x0}" x2="{x0 + w}" y1="{G}" y2="{G}" stroke="var(--ink-2)" stroke-width="2"/>')
        ax, ay = x0 + w - 40, 56
        s.append(f'<path d="M{ax + 14},{ay} L{ax - 12},{ay - 5} L{ax - 16},{ay - 11} L{ax - 18},{ay} L{ax - 12},{ay + 5} Z" fill="var(--ink)"/>')
        col = "var(--data-1)" if ok else "var(--bad)"
        for j, dx in enumerate([0, 60, 120]):
            if ok:
                d = f"M{ax - dx},{ay} C{ax - dx - 70},{ay + 80} {ax - dx - 150},{ay + 150} {ax - dx - 210},{ay + 152} S{ax - dx - 300},{ay + 110} {ax - dx - 330},{ay + 60}"
            else:
                d = f"M{ax - dx},{ay} C{ax - dx - 60},{ay + 80} {ax - dx - 110},{ay + 150} {ax - dx - 140},{G}"
            s.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{2.6 if j == 0 else 1.4}" opacity="{1 if j == 0 else .45}" clip-path="url(#c{k})"/>')
        s.append(f'<clipPath id="c{k}"><rect x="{x0}" y="30" width="{w}" height="{G - 30 + 2}"/></clipPath>')
        if ok:
            s.append(T_(x0 + 115, ay + 175, "turns back up" if en else "da la vuelta", 12.5, "middle", 600, "var(--ink)"))
            s.append(T_(x0 + w / 2, G + 20, "quiet on the ground" if en else "silencio en el suelo", 13, "middle", 600, "var(--good)"))
        else:
            hx = ax - 140
            s.append(f'<path d="M{hx},{G - 9} l3,6 6,1 -5,4 1,6 -5,-3 -5,3 1,-6 -5,-4 6,-1z" fill="var(--bad)"/>')
            s.append(T_(hx, G + 20, "boom on the ground" if en else "estampido en el suelo", 13, "middle", 600, "var(--bad)"))
        s.append(T_(x0 + 10, 22, ("Slow enough (about Mach 1.1)" if ok else "Too fast (about Mach 1.3)") if en else ("Lo bastante lento (cerca de Mach 1.1)" if ok else "Demasiado rápido (cerca de Mach 1.3)"), 14, "start", 600, "var(--ink)"))
        s.append(T_(x0 + 10, 50, "cold air: sound slow" if en else "aire frío: sonido lento", 11.5))
        s.append(T_(x0 + 10, G - 10, "warm air: sound fast" if en else "aire caliente: sonido rápido", 11.5))
    s.append("</svg>")
    cap = ("<b>The same airplane at two speeds.</b> The boom bends toward the slower, colder air above it. Slow enough, its path flattens and turns back up before the ground; too fast, it lands. Illustration with a standard atmosphere."
           if en else "<b>El mismo avión a dos velocidades.</b> El estampido se dobla hacia el aire más frío y lento de arriba. Lo bastante lento, su camino se aplana y vuelve a subir antes del suelo; demasiado rápido, llega. Ilustración con una atmósfera estándar.")
    return "".join(s), cap


def bars(rows, lang, unit_fmt, xmin, xmax, label_w=270, W=720, zero=True, aria=""):
    """Horizontal bars: rows = [(label, value or (lo, hi), colour)]."""
    rh, top = 34, 16
    H = top + rh * len(rows) + 30
    x = lambda v: label_w + (v - xmin) / (xmax - xmin) * (W - label_w - 70)
    s = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{e(aria)}">']
    if zero and xmin < 0 < xmax:
        s.append(f'<line x1="{x(0)}" x2="{x(0)}" y1="{top - 6}" y2="{H - 24}" stroke="var(--ink-3)"/>')
    for i, (lab, v, col) in enumerate(rows):
        y = top + i * rh
        s.append(T_(label_w - 10, y + 17, lab, 13, "end", 400, "var(--ink)"))
        lo, hi = (v if isinstance(v, tuple) else ((0, v) if v >= 0 else (v, 0)))
        s.append(f'<rect x="{x(lo):.1f}" y="{y + 5}" width="{max(2, x(hi) - x(lo)):.1f}" height="18" rx="3" fill="{col}"/>')
        txt = unit_fmt(v)
        s.append(T_(x(hi) + 6 if (not isinstance(v, tuple) and v >= 0) or isinstance(v, tuple) else x(lo) - 6, y + 18, txt, 12.5,
                    "start" if (not isinstance(v, tuple) and v >= 0) or isinstance(v, tuple) else "end", 600, "var(--ink)"))
    s.append("</svg>")
    return "".join(s)


def fig_what_moves(lang):
    en = lang == "en"
    rows = [("10 kt tailwind at cruise" if en else "10 kt de viento de cola en crucero", -0.013, "var(--bad)"),
            ("10 kt tailwind near the ground" if en else "10 kt de viento de cola cerca del suelo", 0.018, "var(--data-1)"),
            ("Typical day-to-day jet-stream swing" if en else "Cambio típico diario del chorro", (-0.041, 0.041), "var(--data-other)"),
            ("3° descent" if en else "Descenso de 3°", -0.037, "var(--bad)"),
            ("3° climb" if en else "Ascenso de 3°", 0.043, "var(--data-1)"),
            ("500 m of higher terrain" if en else "500 m más de terreno", -0.004, "var(--bad)")]
    fmt = lambda v: ("±0.041" if isinstance(v, tuple) else f"{v:+.3f}")
    svg = bars(rows, lang, fmt, -0.06, 0.06, label_w=300, aria="Change in boomless Mach by factor" if en else "Cambio del Mach sin estampido por factor")
    cap = ("<b>What moves the boomless Mach, at 55,000 ft.</b> Change in the limit from one realistic nudge to each factor (median over a year of balloon soundings; the jet-stream bar is ±24.7 kt of cruise wind). Wind at cruise and near the ground pull in opposite directions."
           if en else "<b>Qué mueve el Mach sin estampido, a 55,000 pies.</b> Cambio del límite con un empujón realista a cada factor (mediana de un año de sondeos; la barra del chorro es ±24.7 kt de viento en crucero). El viento en crucero y el viento cerca del suelo halan en direcciones opuestas.")
    return svg, cap


def fig_pipeline(lang):
    en = lang == "en"
    W, H = 720, 270
    box = lambda x, y, w, h, t1, t2, col="var(--surface-2)": (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{col}" stroke="var(--rule)"/>'
                                                              + T_(x + w / 2, y + 22, t1, 13.5, "middle", 600, "var(--ink)") + T_(x + w / 2, y + 40, t2, 11.5, "middle"))
    arrow = lambda x1, y1, x2, y2: (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="var(--ink-3)" stroke-width="1.6"/>'
                                    f'<path d="M{x2},{y2} l-7,-4 0,8z" fill="var(--ink-3)" transform="rotate({0 if y1 == y2 else 90},{x2},{y2})"/>')
    s = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{e("From weather data to the map" if en else "De los datos del tiempo al mapa")}">']
    s.append(box(10, 14, 200, 52, "NOAA GFS", "1°, 23 levels, 0–48 h" if en else "1°, 23 niveles, 0–48 h"))
    s.append(box(10, 80, 200, 52, "ECMWF IFS", "open data, CC BY 4.0" if en else "datos abiertos, CC BY 4.0"))
    s.append(box(10, 146, 200, 52, "NOAA GEFS", "31 members: the spread" if en else "31 miembros: la dispersión"))
    s.append(box(10, 212, 200, 46, "Terrain" if en else "Terreno", "GFS + 600 m elevation model" if en else "GFS + modelo de 600 m"))
    s.append(box(262, 60, 200, 150, "Physics, every 1°" if en else "Física, cada 1°", "", "var(--accent-soft)"))
    for i, t in enumerate(["sound speed (T, humidity)" if en else "velocidad del sonido (T, humedad)", "wind on 36 headings" if en else "viento en 36 rumbos",
                           "side rays to ±45°" if en else "rayos laterales hasta ±45°", "floor: terrain + 1 km" if en else "piso: terreno + 1 km", "margin ≈ 4 × error" if en else "margen ≈ 4 × error"]):
        s.append(T_(362, 108 + i * 19, t, 11.5, "middle"))
    s.append(box(514, 60, 196, 64, "Tests, then publish" if en else "Pruebas y publicar", "every hour a new run is checked" if en else "cada hora se busca una corrida nueva"))
    s.append(box(514, 146, 196, 64, "Your browser" if en else "Tu navegador", "map, routes, rockets, sound" if en else "mapa, rutas, cohetes, sonido", "var(--good-soft)"))
    for y in (40, 106, 172, 235):
        s.append(f'<path d="M210,{y} C236,{y} 236,135 258,135" fill="none" stroke="var(--ink-3)" stroke-width="1.4"/>')
    s.append('<path d="M258,135 l-7,-4 0,8z" fill="var(--ink-3)"/>')
    s.append(arrow(462, 92, 510, 92))
    s.append(arrow(612, 124, 612, 142))
    s.append("</svg>")
    cap = ("<b>From weather data to the map.</b> Two free global models give the atmosphere, the ensemble sets the margin, and the terrain sets the floor. The build runs on GitHub Actions within about an hour of each new GFS run, and your browser draws the result."
           if en else "<b>De los datos del tiempo al mapa.</b> Dos modelos mundiales gratuitos dan la atmósfera, el conjunto fija el margen y el terreno fija el piso. El proceso corre en GitHub Actions en más o menos una hora después de cada corrida nueva del GFS, y tu navegador dibuja el resultado.")
    return "".join(s), cap


def fig_hero(lang):
    en = lang == "en"
    alt = "World map of boomless cruise Mach at 55,000 ft" if en else "Mapa mundial del Mach de crucero sin estampido a 55,000 pies"
    cap = ("<b>The result.</b> Boomless cruise Mach at 55,000 ft in any direction on 23 October 2026, from the mean of GFS and ECMWF. Brighter means faster without a boom; dark means no corridor."
           if en else "<b>El resultado.</b> Mach de crucero sin estampido a 55,000 pies en cualquier dirección el 23 de octubre de 2026, con el promedio del GFS y el ECMWF. Más brillante es más rápido sin estampido; oscuro es sin corredor.")
    return f'<img src="/img/hero-map.webp" width="1600" height="1000" alt="{e(alt)}" loading="lazy">', cap


def fig_val_ages(lang):
    en = lang == "en"
    W, H, l, r, t, b = 720, 300, 70, 210, 20, 40
    xs = {0: "Analysis" if en else "Análisis", 6: "6 h", 24: "24 h"}
    X = lambda h: l + h / 24 * (W - l - r)
    Y = lambda v: t + (0.014 - v) / (0.014 - 0.006) * (H - t - b)
    s = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{e("Forecast error against weather balloons by forecast age" if en else "Error del pronóstico contra globos sonda según la antigüedad")}">']
    for v in (0.006, 0.008, 0.010, 0.012, 0.014):
        s.append(f'<line x1="{l}" x2="{W - r}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="{"var(--ink-3)" if v == 0.010 else "var(--grid)"}"{" stroke-dasharray=\"3 3\"" if v == 0.010 else ""}/>')
        s.append(T_(l - 8, Y(v) + 4, f"{v:.3f}" + (" target" if v == 0.010 and en else " meta" if v == 0.010 else ""), 11.5, "end", 600 if v == 0.010 else 400, "var(--ink)" if v == 0.010 else "var(--ink-3)"))
    for h, lab in xs.items():
        s.append(T_(X(h), H - 14, lab, 12, "middle", 400, "var(--ink-3)"))
    series = [("GFS alone" if en else "GFS solo", [0.0104, 0.0113, 0.0130], "var(--data-other)", "6 4", 2),
              ("GFS + ECMWF", [0.0092, 0.0104, 0.0117], "var(--data-1)", "6 4", 2),
              ("GFS + ECMWF, unsafe side" if en else "GFS + ECMWF, lado inseguro", [0.0070, 0.0080, 0.0095], "var(--data-1)", "", 3)]
    for name, vals, col, dash, wd in series:
        pts = " ".join(f"{X(h):.1f},{Y(v):.1f}" for h, v in zip((0, 6, 24), vals))
        s.append(f'<polyline points="{pts}" fill="none" stroke="{col}" stroke-width="{wd}"{f" stroke-dasharray=\"{dash}\"" if dash else ""}/>')
        for h, v in zip((0, 6, 24), vals):
            s.append(f'<circle cx="{X(h):.1f}" cy="{Y(v):.1f}" r="4" fill="{col}"/>')
        s.append(T_(X(24) + 10, Y(vals[-1]) + 4, f"{name} {vals[-1]:.4f}", 12, "start", 600 if wd == 3 else 400, "var(--ink)"))
    s.append("</svg>")
    cap = ("<b>Error of the boomless Mach against 3,500 weather balloons, Oct 2025 – Sep 2026.</b> Root-mean-square error by forecast age, in Mach. The average of the two models beats GFS alone at every age; on the unsafe side it stays under the 0.010 target for 24 hours."
           if en else "<b>Error del Mach sin estampido contra 3,500 globos sonda, oct 2025 – sep 2026.</b> Raíz del error cuadrático medio según la antigüedad del pronóstico, en Mach. El promedio de los dos modelos supera al GFS solo en todas las antigüedades; del lado inseguro se queda por debajo de la meta de 0.010 durante 24 horas.")
    return "".join(s), cap


def fig_val_regions(lang):
    en = lang == "en"
    rows = [("Europe (2 stations)" if en else "Europa (2 estaciones)", 0.0110, "var(--data-1)"),
            ("Anchorage, Alaska", 0.0127, "var(--data-1)"),
            ("US plains and coasts (6 stations)" if en else "Llanos y costas de EE. UU. (6 estaciones)", 0.0131, "var(--data-1)"),
            ("Rocky Mountains (3 stations)" if en else "Montañas Rocosas (3 estaciones)", 0.0140, "var(--warn)")]
    svg = bars(rows, lang, lambda v: f"{v:.4f}", 0, 0.016, label_w=300, zero=False, aria="Day-ahead error by region" if en else "Error a un día por región")
    cap = ("<b>Day-ahead error by region, GFS alone.</b> Root-mean-square error of the boomless Mach 24 hours ahead. Mountains are about 20 % harder, so the margin uses a larger unseen error there."
           if en else "<b>Error a un día por región, GFS solo.</b> Raíz del error cuadrático medio del Mach sin estampido a 24 horas. Las montañas son cerca de 20 % más difíciles, así que el margen usa allí un error no visto mayor.")
    return svg, cap


def fig_timeline(lang):
    en = lang == "en"
    ev = [(1947, "First supersonic flight (Bell X-1)" if en else "Primer vuelo supersónico (Bell X-1)"),
          (1964, "Oklahoma City boom tests" if en else "Pruebas de Oklahoma City"),
          (1969, "Concorde's first flight" if en else "Primer vuelo del Concorde"),
          (1973, "US bans civil supersonic flight over land" if en else "EE. UU. prohíbe el vuelo civil supersónico sobre tierra"),
          (1976, "Concorde enters service" if en else "El Concorde entra en servicio"),
          (2003, "Concorde retired" if en else "Se retira el Concorde"),
          (2025, "XB-1 flies boomless; executive order" if en else "El XB-1 vuela sin estampido; orden ejecutiva"),
          (2026, "FAA proposes a 0.11 psf limit" if en else "La FAA propone un límite de 0.11 psf")]
    W, H, l, r = 720, 250, 30, 30
    X = lambda yr: l + (yr - 1945) / (2028 - 1945) * (W - l - r)
    s = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{e("Timeline of supersonic flight over land" if en else "Línea de tiempo del vuelo supersónico sobre tierra")}">',
         f'<line x1="{l}" x2="{W - r}" y1="125" y2="125" stroke="var(--ink-2)" stroke-width="2"/>',
         f'<rect x="{X(1973):.1f}" y="119" width="{X(2026) - X(1973):.1f}" height="12" fill="var(--bad-soft)"/>',
         T_((X(1973) + X(2026)) / 2, 145, "53 years of the speed ban" if en else "53 años de prohibición de velocidad", 11.5, "middle", 600, "var(--bad)")]
    for i, (yr, lab) in enumerate(ev):
        up = i % 2 == 0
        x, y = X(yr), (125 - 20 - (i % 4 // 2) * 34) if up else (125 + 40 + (i % 4 // 2) * 34)
        s.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="125" y2="{y + (6 if up else -14)}" stroke="var(--ink-3)"/>')
        s.append(f'<circle cx="{x:.1f}" cy="125" r="4.5" fill="var(--ink)"/>')
        anchor = "start" if x < 140 else "end" if x > W - 160 else "middle"
        s.append(T_(x, y - 12 if up else y + 4, str(yr), 12, anchor, 700, "var(--ink)"))
        s.append(T_(x, y + 2 if up else y + 18, lab, 11.5, anchor))
    s.append("</svg>")
    cap = ("<b>From the first supersonic flight to a proposed noise limit.</b> The 1973 rule banned the speed itself, whatever the weather; the 2026 proposal would replace it with a limit on the boom that reaches the ground."
           if en else "<b>Del primer vuelo supersónico a un límite de ruido propuesto.</b> La regla de 1973 prohibió la velocidad misma, sin importar el tiempo; la propuesta de 2026 la cambiaría por un límite al estampido que llega al suelo.")
    return "".join(s), cap


def fig_psf_compare(lang):
    en = lang == "en"
    rows = [("Proposed FAA limit (2026)" if en else "Límite propuesto por la FAA (2026)", 0.11, "var(--good)"),
            ("Falcon booster landing, 8.9 km away" if en else "Aterrizaje de un propulsor Falcon, a 8.9 km", (1.59, 1.71), "var(--warn)"),
            ("Concorde at Mach 2 (NASA measurement)" if en else "Concorde a Mach 2 (medición de la NASA)", 1.94, "var(--bad)")]
    svg = bars(rows, lang, lambda v: (f"{v[0]:.2f}–{v[1]:.2f} psf" if isinstance(v, tuple) else f"{v:.2f} psf"), 0, 2.3, label_w=300, zero=False,
               aria="Boom overpressure on the ground, psf" if en else "Sobrepresión del estampido en el suelo, psf")
    cap = ("<b>How loud, in pounds per square foot on the ground.</b> Concorde's boom was about 18 times the limit the FAA proposed in 2026. Sources: NASA fact sheet FS-016 (Concorde) and the FAA's Falcon environmental assessment, as used in this project's model checks."
           if en else "<b>Qué tan fuerte, en libras por pie cuadrado en el suelo.</b> El estampido del Concorde era unas 18 veces el límite que propuso la FAA en 2026. Fuentes: hoja informativa FS-016 de la NASA (Concorde) y la evaluación ambiental del Falcon de la FAA, usadas en las comprobaciones del modelo de este proyecto.")
    return svg, cap


def fig_nwave(lang):
    en = lang == "en"
    W, H = 720, 220
    s = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{e("Pressure against time: a classic N-wave and a shaped signature" if en else "Presión contra tiempo: una onda N clásica y una firma con forma")}">']
    for k, (x0, title, path, col) in enumerate([
        (20, "Classic boom: an N-wave" if en else "Estampido clásico: una onda N", "M0,110 L40,110 L40,40 L240,180 L240,110 L300,110", "var(--bad)"),
        (380, "Shaped (X-59): a softer thump" if en else "Con forma (X-59): un golpe más suave", "M0,110 L40,110 C70,110 80,78 110,78 L120,82 C150,82 160,150 200,142 C215,138 225,110 300,110", "var(--data-1)")]):
        s.append(T_(x0, 24, title, 14, "start", 600, "var(--ink)"))
        s.append(f'<line x1="{x0}" x2="{x0 + 300}" y1="{110 + 20}" y2="{110 + 20}" stroke="var(--grid)"/>')
        s.append(f'<g transform="translate({x0},20)"><line x1="0" x2="300" y1="110" y2="110" stroke="var(--ink-3)" stroke-dasharray="3 3"/>'
                 f'<path d="{path}" fill="none" stroke="{col}" stroke-width="2.8" stroke-linejoin="round"/></g>')
        s.append(T_(x0, 208, "time →" if en else "tiempo →", 11.5, "start", 400, "var(--ink-3)"))
        s.append(T_(x0 + 300, 208, ("two sudden jumps: bang-bang" if k == 0 else "gentle ramps: thump") if en else ("dos saltos de golpe: bum-bum" if k == 0 else "rampas suaves: un golpe"), 11.5, "end"))
    s.append("</svg>")
    cap = ("<b>What the ear hears.</b> A classic boom is two sudden pressure jumps; the X-59's shape spreads its shocks so the pressure changes more gently. Illustration, not measured data."
           if en else "<b>Lo que escucha el oído.</b> Un estampido clásico son dos saltos de presión repentinos; la forma del X-59 separa sus choques para que la presión cambie más suave. Ilustración, no datos medidos.")
    return "".join(s), cap


def fig_carpet(lang):
    en = lang == "en"
    W, H, G = 720, 250, 190
    s = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="{e("Cross-section of the boom carpet under the X-59" if en else "Corte transversal de la alfombra del estampido bajo el X-59")}">',
         '<defs><linearGradient id="fAir2" x1="0" x2="0" y1="1" y2="0"><stop offset="0%" stop-color="var(--warn-soft)"/><stop offset="70%" stop-color="var(--surface-2)"/></linearGradient></defs>',
         f'<rect x="10" y="20" width="{W - 20}" height="{G - 20}" fill="url(#fAir2)" rx="6"/>',
         f'<line x1="10" x2="{W - 10}" y1="{G}" y2="{G}" stroke="var(--ink-2)" stroke-width="2"/>']
    jx, jy = W / 2, 40
    for side in (-1, 1):
        for f, hit in ((0.4, True), (1.0, True), (1.12, False)):
            ex = jx + side * 210 * f
            if hit:
                d = f"M{jx},{jy} Q{jx + side * 120 * f},{jy + 80} {ex},{G}"
                s.append(f'<path d="{d}" fill="none" stroke="var(--data-1)" stroke-width="2"/>')
            else:
                d = f"M{jx},{jy} Q{jx + side * 140},{jy + 70} {jx + side * 225},{G - 22} T{jx + side * 300},{jy + 60}"
                s.append(f'<path d="{d}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="4 3"/>')
    s.append(f'<rect x="{jx - 210}" y="{G - 4}" width="420" height="8" rx="3" fill="#f0a33a"/>')
    s.append(f'<path d="M{jx - 15},{jy + 2} L{jx},{jy - 4} L{jx + 15},{jy + 2} L{jx},{jy} Z" fill="var(--ink)"/>')
    s.append(T_(jx, 16, "X-59, 55,000 ft, seen from behind" if en else "X-59 a 55,000 pies, visto desde atrás", 12, "middle", 600, "var(--ink)"))
    s.append(T_(jx, G + 24, "carpet: where the thump is heard" if en else "alfombra: donde se escucha el golpe", 12.5, "middle", 600, "#b86e0b"))
    s.append(T_(jx + 250, G - 30, "turns back: not heard" if en else "da la vuelta: no se oye", 11.5, "start"))
    s.append(T_(20, G - 10, "warm air near the ground" if en else "aire caliente cerca del suelo", 11.5))
    s.append("</svg>")
    cap = ("<b>The carpet, looking along the flight path.</b> Straight below, the boom always lands; to the sides, the warm air near the ground bends it back up, and where it turns is the carpet's edge. Hot days and headwinds narrow it. Illustration."
           if en else "<b>La alfombra, mirando a lo largo de la ruta.</b> Justo debajo, el estampido siempre llega; hacia los lados, el aire caliente cerca del suelo lo dobla hacia arriba, y donde da la vuelta está el borde de la alfombra. Los días calientes y los vientos de frente la estrechan. Ilustración.")
    return "".join(s), cap


FIGS = {"cutoff_side": fig_cutoff_side, "what_moves": fig_what_moves, "pipeline": fig_pipeline, "hero": fig_hero, "val_ages": fig_val_ages,
        "val_regions": fig_val_regions, "timeline": fig_timeline, "psf_compare": fig_psf_compare, "nwave": fig_nwave, "carpet": fig_carpet}


def table_hindcast(lang):
    en = lang == "en"
    cols = ["Policy (Overture-class jet, 55,000 ft)", "Minutes saved vs the ban", "Flights with a boom on land"] if en else \
           ["Política (avión tipo Overture, 55,000 pies)", "Minutos ahorrados vs la prohibición", "Vuelos con estampido sobre tierra"]
    rows = [("Perfect knowledge of the atmosphere" if en else "Conocer la atmósfera a la perfección", "36.4", "0 %", False),
            ("Forecast with ensemble margin (tested on unseen months)" if en else "Pronóstico con margen del conjunto (probado en meses no vistos)", "26.1–29.1", "0.4–0.5 % (any boom)" if en else "0.4–0.5 % (cualquier estampido)", False),
            ("Same, margin raised for route choice (live today)" if en else "Igual, con margen mayor por la elección de ruta (en vivo hoy)", "about 0.7 less" if en else "unos 0.7 menos", "0.28 % over 0.11 psf (95 %: 0.47 %)" if en else "0.28 % sobre 0.11 psf (95 %: 0.47 %)", True),
            ("Fixed Mach 1.05, no weather" if en else "Mach 1.05 fijo, sin mirar el tiempo", "18.9", "boom on 1.1 % of the distance" if en else "estampido en el 1.1 % de la distancia", False)]
    h = "".join(f'<th scope="col"{" class=r" if i == 1 else ""}>{e(c)}</th>' for i, c in enumerate(cols))
    b = "".join(f'<tr{" class=key" if k else ""}><td>{e(a)}</td><td class="r">{e(m)}</td><td>{e(f)}</td></tr>' for a, m, f, k in rows)
    cap = ("A year of past weather: 53 weekly forecasts, 48 routes, a realistic extra error added each day." if en else
           "Un año de clima pasado: 53 pronósticos semanales, 48 rutas y un error extra realista añadido cada día.")
    return f'<figure><div class="tblwrap" tabindex="0" role="region" aria-label="{e(cols[0])}"><table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table></div><figcaption>{cap}</figcaption></figure>'


def words(s):
    return len(re.sub(r"<[^>]+>", " ", s).split())


def article_page(lang, a, others, alt_path):
    T = L[lang]
    path = f'{T["base"]}{a["slug"]}/'
    body, n = [], 0
    for kind, val in a["body"]:
        if kind == "p":
            body.append(f"<p>{val}</p>")
        elif kind == "h2":
            body.append(f"<h2>{e(val)}</h2>")
        elif kind == "fig":
            svg, cap = FIGS[val](lang)
            body.append(f"<figure>{svg}<figcaption>{cap}</figcaption></figure>")
        elif kind == "table":
            body.append(table_hindcast(lang))
        elif kind == "cta":
            href = a.get("cta_href", "/")
            body.append(f'<p><a class="btn main cta" href="{href}">{e(val)}</a></p>')
    src = "".join(f'<li><a href="{e(u)}" rel="noopener">{e(t)}</a></li>' for t, u in a["sources"])
    rel = "".join(f'<li><a href="{T["base"]}{o["slug"]}/">{e(o["title"])}</a></li>' for o in others)
    ad = (f'<section class="adslot" id="adSlot" hidden aria-label="{e(T["ad"])}"><div class="adhead"><span>{e(T["ad"])}</span>'
          f'<a href="/privacy.html#ads">{e(T["ad_about"])}</a></div><div class="adbody"></div></section>')
    by = (f'{T["by"]} <a href="{T["author"]}">Fernando J. Vázquez</a> · {T["updated"]} <time datetime="{UPDATED}">{T["date"]}</time> · {a["read"]} {T["min"]}')
    main = (f'<main class="art"><article><h1>{e(a["title"])}</h1><p class="lead">{e(a["lead"])}</p><p class="byline">{by}</p>'
            + "".join(body) + f'</article>{ad}<section class="src"><h2>{T["sources"]}</h2><ol>{src}</ol></section>'
            f'<section class="rel"><h2>{T["more"]}</h2><ul>{rel}</ul></section></main>')
    ld = ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":' + json_str(a["title"]) +
          ',"author":{"@type":"Person","name":"Fernando J. Vázquez","url":"https://machcorridor.com' + T["author"] + '"},"dateModified":"' + UPDATED +
          '","inLanguage":"' + lang + '","mainEntityOfPage":"https://machcorridor.com' + path + '"}</script>')
    page = head(lang, a["title"], a["desc"], path, alt_path) + "\n" + nav(lang, None, alt_path) + "\n" + main + "\n" + foot(lang) + "\n" + ld + "\n</body>\n</html>\n"
    return path, page, words(" ".join(x for x in body) + a["lead"])


def json_str(s):
    import json
    return json.dumps(s, ensure_ascii=False)


def index_page(lang, arts, alt_path):
    T = L[lang]
    cards = "".join(f'<a class="card" href="{T["base"]}{a["slug"]}/"><h2>{e(a["title"])}</h2><p>{e(a["desc"])}</p><span>{a["read"]} {T["min"]} · {e(T["read_btn"])}</span></a>' for a in arts)
    main = (f'<main class="art"><h1>{e(T["idx_h1"])}</h1><p class="lead">{e(T["idx_lead"])}</p><div class="cards">{cards}</div></main>')
    return T["base"], head(lang, T["idx_title"], T["idx_desc"], T["base"], alt_path) + "\n" + nav(lang, T["base"], alt_path) + "\n" + main + "\n" + foot(lang) + "\n</body>\n</html>\n"


AUTHOR = {
 "en": {
  "title": "About the author: Fernando J. Vázquez",
  "desc": "Fernando J. Vázquez, a mechanical and aerospace engineering student at Case Western Reserve University and student pilot from Puerto Rico, built Mach Corridor.",
  "h1": "About the author",
  "body": [
   ("p", "I am Fernando J. Vázquez, from Humacao, Puerto Rico. I study Mechanical and Aerospace Engineering at Case Western Reserve University in Cleveland, Ohio, with Finance as a second major, and I expect to graduate in spring 2027. I also spent a semester at Universidad Carlos III de Madrid, taking thermodynamics, fluid mechanics and control systems in Spanish."),
   ("p", "I spent the summers of 2025 and 2026 at Bell Textron in Texas. Among other projects, I built a tool that takes an aircraft's weather limits and shows where and how often around the world it can operate, and I helped plan the 500-hour operational evaluation of the Bell 525. That first tool is, in a way, where Mach Corridor began: the question of what the atmosphere allows an aircraft to do, day by day and place by place."),
   ("p", "I am also a student pilot, training for my private pilot certificate in Cleveland and in Texas. Flying taught me to respect forecasts, and to read them with their uncertainty in mind, which is the spirit of the margins on this site."),
   ("h2", "Why I built Mach Corridor"),
   ("p", "When Boom's XB-1 flew supersonic in January 2025 without a boom reaching the ground, I wanted to know how often that is possible, where, and how fast. Nobody published an open answer, so I built one: a global forecast, checked against a year of weather balloons, with route planning and pages for rocket booms, fireballs, the X-59 and how far sound carries. I worked with Claude, an AI model by Anthropic, which wrote most of the code and ran the studies; I set the questions, read the results and made the decisions. Every number on the site comes from the public repository, where the method, the code and the list of mistakes I found and fixed are open."),
   ("p", "Mach Corridor is a research project, not affiliated with Boom, NASA or the FAA, and not for flight planning. If you find something wrong, I would genuinely like to hear it."),
   ("h2", "Contact"),
   ("p", f'Email: <a href="mailto:{MAIL}">{MAIL}</a><br>Personal site: <a href="https://fernandojvazquez.com">fernandojvazquez.com</a><br>Code: <a href="https://github.com/FernandoVazq/mach-corridor">github.com/FernandoVazq/mach-corridor</a>'),
  ],
 },
 "es": {
  "title": "Sobre el autor: Fernando J. Vázquez",
  "desc": "Fernando J. Vázquez, estudiante de ingeniería mecánica y aeroespacial en Case Western Reserve University y piloto estudiante de Puerto Rico, creó Mach Corridor.",
  "h1": "Sobre el autor",
  "body": [
   ("p", "Soy Fernando J. Vázquez, de Humacao, Puerto Rico. Estudio Ingeniería Mecánica y Aeroespacial en Case Western Reserve University, en Cleveland, Ohio, con Finanzas como segunda concentración, y espero graduarme en la primavera de 2027. También pasé un semestre en la Universidad Carlos III de Madrid, donde tomé termodinámica, mecánica de fluidos y sistemas de control en español."),
   ("p", "Pasé los veranos de 2025 y 2026 en Bell Textron, en Texas. Entre otros proyectos, construí una herramienta que toma los límites de clima de una aeronave y muestra dónde y con qué frecuencia puede operar en el mundo, y ayudé a planificar la evaluación operacional de 500 horas del Bell 525. Esa primera herramienta es, de alguna forma, donde empezó Mach Corridor: la pregunta de qué le permite hacer la atmósfera a una aeronave, día a día y lugar por lugar."),
   ("p", "También soy piloto estudiante y me entreno para la licencia de piloto privado en Cleveland y en Texas. Volar me enseñó a respetar los pronósticos y a leerlos con su incertidumbre en mente, que es el espíritu de los márgenes de este sitio."),
   ("h2", "Por qué hice Mach Corridor"),
   ("p", "Cuando el XB-1 de Boom voló supersónico en enero de 2025 sin que el estampido llegara al suelo, quise saber con qué frecuencia es posible, dónde y a qué velocidad. Nadie publicaba una respuesta abierta, así que hice una: un pronóstico mundial, comparado con un año de globos sonda, con planificación de rutas y páginas para los estampidos de cohetes, los bólidos, el X-59 y hasta dónde llega el sonido. Trabajé con Claude, un modelo de IA de Anthropic, que escribió la mayor parte del código e hizo los estudios; yo planteé las preguntas, leí los resultados y tomé las decisiones. Cada número del sitio sale del repositorio público, donde están abiertos el método, el código y la lista de errores que encontré y corregí."),
   ("p", "Mach Corridor es un proyecto de investigación, sin relación con Boom, la NASA ni la FAA, y no sirve para planificar vuelos. Si encuentras algo mal, de verdad me gustaría saberlo."),
   ("h2", "Contacto"),
   ("p", f'Correo: <a href="mailto:{MAIL}">{MAIL}</a><br>Sitio personal: <a href="https://fernandojvazquez.com">fernandojvazquez.com</a><br>Código: <a href="https://github.com/FernandoVazq/mach-corridor">github.com/FernandoVazq/mach-corridor</a>'),
  ],
 },
}


def author_page(lang, alt_path):
    T, A = L[lang], AUTHOR[lang]
    body = "".join(f"<p>{v}</p>" if k == "p" else f"<h2>{e(v)}</h2>" for k, v in A["body"])
    more = "".join(f'<li><a href="{T["base"]}{a["slug"]}/">{e(a["title"])}</a></li>' for a in (learn_en.ARTICLES if lang == "en" else learn_es.ARTICLES))
    main = f'<main class="art"><h1>{e(A["h1"])}</h1>{body}<section class="rel"><h2>{T["idx_h1"]}</h2><ul>{more}</ul></section></main>'
    ld = ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Fernando J. Vázquez","url":"https://fernandojvazquez.com",'
          '"email":"mailto:' + MAIL + '","alumniOf":"Case Western Reserve University","sameAs":["https://github.com/FernandoVazq"]}</script>')
    return T["author"], head(lang, A["title"], A["desc"], T["author"], alt_path) + "\n" + nav(lang, T["author"], alt_path) + "\n" + main + "\n" + foot(lang) + "\n" + ld + "\n</body>\n</html>\n"


def write(path, page):
    d = os.path.join(ROOT, path.strip("/"))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "index.html"), "w", encoding="utf8") as f:
        f.write(page)


def main():
    en, es = learn_en.ARTICLES, learn_es.ARTICLES
    es_by_en = {a["en"]: a for a in es}
    en_by_slug = {a["slug"]: a for a in en}
    for a in es:                                   # the Spanish articles cite the same sources
        a.setdefault("sources", en_by_slug[a["en"]]["sources"])
    report = []
    for lang, arts in (("en", en), ("es", es)):
        for a in arts:
            other = (f'{L["es"]["base"]}{es_by_en[a["slug"]]["slug"]}/' if lang == "en" else f'{L["en"]["base"]}{a["en"]}/')
            path, page, n = article_page(lang, a, [o for o in arts if o is not a], other)
            write(path, page); report.append((path, n))
        p, page = index_page(lang, arts, L["es" if lang == "en" else "en"]["base"])
        write(p, page)
        p, page = author_page(lang, L["es" if lang == "en" else "en"]["author"])
        write(p, page)
    for p, n in report:
        print(f"{n:5d} words  {p}")


if __name__ == "__main__":
    main()
