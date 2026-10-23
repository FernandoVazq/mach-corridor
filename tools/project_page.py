"""
Mach Corridor project page in the Atlas FJV system (Fernando J. Vazquez's shared visual system for his public sites):
fixed order bar, hero, KPIs, insights, main visual, tables, money and costs, how I built it, sources and licences, notice.
Writes site/about/index.html (English) and site/es/index.html (Spanish) from one template so both stay the same.
Every number is from the repository: docs/METHOD.md, docs/ROADMAP.md, study/results/*.json, engine/rocket.py.
Usage: python tools/project_page.py
"""
import html, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")
FONTS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"

T = {
 "en": {
  "kpi_short": ["target 0.010", "vs today's ban", "target under 0.5 %", "Europe 43 %"],
  "money_short": ["per year, 2026 USD", "per flight, in passenger time", "break-even value of an hour", "open data, free hosting"],
  "how_sum": ["A ban since 1973, and a way around it that depends on the weather.",
              "Two free global forecasts, every 6 hours, every point and direction.",
              "3,500 weather balloons and a year of past weather.",
              "Claude wrote most of the code; I set the questions and made the calls.",
              "Rocket booms, and a page for every airline route.",
              "Five mistakes found and fixed, and what is still open."],
  "src_sum": "All open data; commercial use allowed except where noted.",
  "more": "More",
  "stat_n": "3 forecast ages",
  "series_short": {"mean_u": "2 models, unsafe", "mean_r": "2 models, RMS", "gfs_r": "GFS, RMS"},
  "lang": "en", "path": "about/", "other": "../es/", "other_label": "ES", "other_name": "Español", "home": "../",
  "title": "Mach Corridor: an open forecast of boomless supersonic flight",
  "desc": "Where a supersonic jet can fly today without its boom reaching the ground: a global forecast, validated against 3,500 weather balloons, with route planning, rocket booms and economics.",
  "nav": [("Live map", "../"), ("Routes today", "../routes/"), ("Rocket booms", "../rockets.html")],
  "hero_line": "An open, global forecast of where a supersonic jet can fly without its boom reaching the ground, updated four times a day.",
  "cta1": "Open the live map", "cta2": "Routes today", "cta3": "Rocket booms",
  "hero_cap": "Boomless cruise Mach at 55,000 ft in any direction, 23 Oct 2026 (GFS + ECMWF). Brighter = faster without a boom.",
  "kpis": [
   ("24-h forecast error", "0.0117", "Mach", "Target 0.010; the unsafe-side error, 0.0095, meets it", "good", "▼ 10 % vs GFS alone",
    "3,500 radiosonde launches at 12 stations, Oct 2025 – Sep 2026"),
   ("Saved per flight", "25–28", "min", "vs today's overland ban; a perfect forecast would save 36", "warn", "Estimate · hindcast",
    "53 weekly forecasts, 48 routes, Overture-class jet at FL550"),
   ("Flights over 0.11 psf", "0.28", "%", "95 % upper bound 0.47 %; design target under 0.5 %", "good", "▼ under target",
    "Fastest of 7 candidate routes, 53 dates, margin k 4.0 (model 2.8)"),
   ("US corridor at FL550", "65", "% of year", "Europe 43 %, all land 40 %", "warn", "Climatology",
    "Share of days and directions with boomless Mach ≥ 1.15, 53 weekly analyses"),
  ],
  "insights_h": "What the forecast shows",
  "insights": [
   "Altitude is the lever: at FL550 a corridor is usable on 93 % of balloon soundings, at FL350 on 38 % (margin 0.03).",
   "Season and daily weather each drive about half of the variation (48 % and 51 %); time of day barely matters (under 1 %).",
   "Forecast skill buys speed: shaving 0.02 off the margin without a better forecast multiplies booming flights 37 times.",
  ],
  "chart_t": "The two-model forecast stays under the 0.010 target on the unsafe side for 24 hours",
  "chart_s": "Error of the boomless Mach number against radiosondes, Mach · Oct 2025 – Sep 2026",
  "chart_src": "Source: Mach Corridor validation, 3,500 IGRA2 launches at 12 stations (study/results/validation_ifs_mean.json)",
  "series": {"mean_u": "GFS + ECMWF, unsafe side", "mean_r": "GFS + ECMWF, RMS", "gfs_r": "GFS alone, RMS", "target": "target"},
  "ages": ["Analysis", "6 h", "24 h"],
  "t1_h": "What a forecast is worth in a year of past weather",
  "t1_cols": ["Policy", "Minutes saved vs ban", "Flights with a boom on land"],
  "t1": [("Perfect knowledge of the atmosphere", "36.4", "0 %", False),
         ("Forecast with ensemble margin (held out)", "26.1–29.1", "0.4–0.5 % (any boom)", False),
         ("Same, margin raised for route choice (live today)", "about 0.7 less", "0.28 % over 0.11 psf (95 %: 0.47 %)", True),
         ("Fixed Mach 1.05, no weather", "18.9", "boom on 1.1 % of the distance", False)],
  "t1_note": "Hindcast: 53 weekly GFS analyses and 24 h forecasts, 48 directed routes, Overture-class aircraft at FL550, real-world error added (σ 0.012).",
  "t2_h": "Rocket booms: the model against measured booms",
  "t2_cols": ["Measurement", "Measured, psf", "Model, psf"],
  "t2": [("Falcon Heavy side boosters, LZ-1/2, at LC-40 (8.9 km)", "1.59–1.71", "1.82"),
         ("Falcon Heavy side boosters, LZ-1/2, at LC-39A (15.1 km)", "1.40–1.44", "1.26"),
         ("Super Heavy booster return, Flight 5, Port Isabel", "7.1 at 10.5 km; about 10", "8.6")],
  "t2_note": "Sources: FAA Final Environmental Assessment, SpaceX Falcon program, appendices, Table 1; Gee et al., JASA Express Letters 4, 113601 (2024).",
  "money_h": "Money and costs",
  "money": [("cost", "Cost to run", "$11–15", "per year, 2026 USD: the domain. Data and hosting are free."),
            ("save", "Benefit per flight", "$1,800–2,100", "passenger time saved by corridors: 52 passengers × 25–28 min × $85/h (assumed value of time)"),
            ("pay", "Pays off for a passenger", "$1,300–2,200/h", "a supersonic seat beats a 787-9 only if an hour of your time is worth this much"),
            ("pay", "Who pays", "Nobody yet", "open data (NOAA, ECMWF) and free hosting; ads and sponsors optional")],
  "money_cols": ["Scenario", "Jet fuel", "Break-even vs 787-9", "Reading"],
  "money_rows": [("Low", "$0.71/kg (2025)", "$1,296/h", "Business travellers with a high time value", False),
                 ("Base", "$1.20/kg (2026 average)", "$1,835/h", "Top executives and urgent trips", True),
                 ("High", "$1.50/kg (latest)", "$2,164/h", "A niche market", False)],
  "money_note": "2026 USD. Break-even = extra cost per seat ÷ hours saved, median of 960 router flights of an Overture-class jet (study/results/mach_value.json). Seat costs are estimates: Overture's fuel burn is not published.",
  "est": "Estimate",
  "how_h": "How I built it",
  "how": [
   ("The problem", "Since 1973 the United States has banned civil supersonic flight over land because of the sonic boom. In July 2026 the FAA proposed replacing the ban with a noise limit of 0.11 psf at the ground. There are two ways to meet it. One is a new, quieter airframe such as NASA's X-59. The other needs no new airplane: fly just slow enough that the air below bends the boom back up before it reaches the ground. That is called Mach cutoff, and Boom's XB-1 showed it works in January 2025. The catch is that the speed that works depends on the temperature and wind of the day, the direction of flight and the terrain below. I wanted to know where and when it works, how fast, and how much a forecast of it would be worth."),
   ("The data", "Every six hours the site downloads the latest NOAA GFS forecast and the ECMWF open-data forecast, both free, and computes the boomless Mach number at every 1-degree point, seven flight levels and 36 directions. The answer is the mean of the two models; where either model says no corridor, the map shows none. The NOAA GEFS ensemble of 31 forecasts sets the safety margin point by point. Terrain comes from GFS and a 600 m elevation model, coastlines from Natural Earth, and the satellite map styles from NASA GIBS."),
   ("How I checked it", "A forecast is only useful if you know how wrong it is. I compared the predicted boomless Mach with what 3,500 weather balloons measured at 12 stations in the US, Alaska and Europe over a full year. I then replayed a year of past weather to see how many minutes corridors save and how often a boom would have slipped through, and set the margins so that fewer than 0.5 % of flights exceed 0.11 psf. The loudness models were checked against NASA's FaINT flight tests and Concorde measurements. The ray tracer is tested against exact solutions every time the code changes, and a browser test plus an accessibility audit run before every deploy."),
   ("What the AI did", "I worked with Claude, an AI model by Anthropic. It wrote most of the code and ran the studies, while I set the questions, read the results, made the decisions and contacted NASA and Boom for flight data. Separate AI reviewers acted as a red team, one expert at a time, and found real problems I then fixed. Every number on this page comes from the repository, where the method, the code and the change log are public."),
   ("Beyond airliners", "The same ray tracer now forecasts rocket booms. A returning booster falls nose-down at two to four times the speed of sound, so its boom lands on the towns around the landing zone. The site traces those rays through the forecast atmosphere for each upcoming launch at Cape Canaveral, Vandenberg and Starbase, and calibrates the loudness against booms measured for the FAA and by Brigham Young University. It also publishes a page per airline route that says whether that route could fly boomless today."),
   ("What failed", "Plenty. The first humid-air sound speed was slightly wrong and gave corridors up to 0.001 Mach too fast in hot, humid air (fixed in model 2.10). Picking the fastest of several routes quietly raised the chance of a boom from 0.43 % to 0.59 %, so the margin went up. An early claim that a 1 km height buffer cost only one minute was withdrawn once the loudness model showed an airliner needs about 1.25 km. Hudson Bay was treated as open sea until model 2.12. The original error target of 0.010 is not met in plain RMS terms by any single model, even at analysis time; the two-model mean meets it only on the unsafe side, and that choice is still open. Rocket loudness is good to about a factor of two, and focus booms are not modelled yet."),
  ],
  "src_h": "Sources and licences",
  "src_cols": ["Source", "Used for", "Licence", "Commercial use"],
  "src": [("NOAA GFS and GEFS (AWS Open Data)", "Forecast atmosphere, ensemble margin", "US Government public domain", "Yes"),
          ("ECMWF IFS open data", "Second model", "CC BY 4.0", "Yes, with attribution"),
          ("NOAA IGRA2 radiosondes", "Validation", "Public domain", "Yes"),
          ("NASA GIBS (VIIRS, Blue Marble, Black Marble)", "Satellite map styles", "NASA open data, acknowledgement", "Yes"),
          ("Natural Earth", "Coastlines and borders", "Public domain", "Yes"),
          ("AWS Terrain Tiles (SRTM, GMTED2010, ETOPO1)", "Terrain floor", "Public domain sources, attribution", "Yes"),
          ("Launch Library 2, The Space Devs", "Upcoming launches", "Free API under its own terms", "Check its terms")],
  "src_note": "Forecast data are updated every 6 hours; validation covers Oct 2025 – Sep 2026. Method, code and model change log: github.com/FernandoVazq/mach-corridor.",
  "notice": "Research project by Fernando J. Vázquez. Not for flight planning.",
  "privacy": "Privacy",
 },
 "es": {
  "kpi_short": ["meta 0.010", "vs la prohibición actual", "meta bajo 0.5 %", "Europa 43 %"],
  "money_short": ["al año, 2026 USD", "por vuelo, en tiempo de pasajeros", "valor de equilibrio de una hora", "datos abiertos, hosting gratis"],
  "how_sum": ["Una prohibición desde 1973 y una salida que depende del tiempo.",
              "Dos pronósticos globales gratis, cada 6 horas, en cada punto y dirección.",
              "3,500 globos sonda y un año de tiempo pasado.",
              "Claude escribió la mayor parte del código; yo puse las preguntas y decidí.",
              "Booms de cohetes y una página por cada ruta aérea.",
              "Cinco errores encontrados y arreglados, y lo que sigue abierto."],
  "src_sum": "Todo son datos abiertos; uso comercial permitido salvo donde se indica.",
  "more": "Más",
  "stat_n": "3 horizontes",
  "series_short": {"mean_u": "2 modelos, inseguro", "mean_r": "2 modelos, RMS", "gfs_r": "GFS, RMS"},
  "lang": "es", "path": "es/", "other": "../about/", "other_label": "EN", "other_name": "English", "home": "../",
  "title": "Mach Corridor: un pronóstico abierto del vuelo supersónico sin estampido",
  "desc": "Dónde puede volar hoy un jet supersónico sin que su estampido llegue al suelo: un pronóstico global, validado con 3,500 globos sonda, con rutas, booms de cohetes y economía.",
  "nav": [("Mapa en vivo", "../"), ("Rutas hoy", "../routes/"), ("Booms de cohetes", "../rockets.html")],
  "hero_line": "Un pronóstico abierto y global de dónde puede volar un jet supersónico sin que su estampido llegue al suelo, actualizado cuatro veces al día.",
  "cta1": "Abrir el mapa en vivo", "cta2": "Rutas hoy", "cta3": "Booms de cohetes",
  "hero_cap": "Mach de crucero sin estampido a 55,000 pies en cualquier dirección, 23 oct 2026 (GFS + ECMWF). Más claro = más rápido sin boom.",
  "kpis": [
   ("Error del pronóstico a 24 h", "0.0117", "Mach", "Meta 0.010; el error del lado inseguro, 0.0095, la cumple", "good", "▼ 10 % vs solo GFS",
    "3,500 lanzamientos de globos sonda en 12 estaciones, oct 2025 – sep 2026"),
   ("Ahorro por vuelo", "25–28", "min", "vs la prohibición actual sobre tierra; un pronóstico perfecto ahorraría 36", "warn", "Estimado · retroanálisis",
    "53 pronósticos semanales, 48 rutas, jet tipo Overture a FL550"),
   ("Vuelos sobre 0.11 psf", "0.28", "%", "Cota superior 95 %: 0.47 %; meta de diseño bajo 0.5 %", "good", "▼ bajo la meta",
    "La más rápida de 7 rutas candidatas, 53 fechas, margen k 4.0 (modelo 2.8)"),
   ("Corredor en EE. UU. a FL550", "65", "% del año", "Europa 43 %, toda la tierra 40 %", "warn", "Climatología",
    "Parte de días y direcciones con Mach sin estampido ≥ 1.15, 53 análisis semanales"),
  ],
  "insights_h": "Lo que muestra el pronóstico",
  "insights": [
   "La altitud es la palanca: a FL550 hay corredor en el 93 % de los sondeos, a FL350 en el 38 % (margen 0.03).",
   "La estación y el tiempo del día explican cada uno la mitad de la variación (48 % y 51 %); la hora casi no importa (menos de 1 %).",
   "La calidad del pronóstico compra velocidad: quitar 0.02 al margen sin mejor pronóstico multiplica por 37 los vuelos con boom.",
  ],
  "chart_t": "El pronóstico de dos modelos se queda bajo la meta de 0.010 del lado inseguro durante 24 horas",
  "chart_s": "Error del Mach sin estampido contra globos sonda, Mach · oct 2025 – sep 2026",
  "chart_src": "Fuente: validación de Mach Corridor, 3,500 lanzamientos IGRA2 en 12 estaciones (study/results/validation_ifs_mean.json)",
  "series": {"mean_u": "GFS + ECMWF, lado inseguro", "mean_r": "GFS + ECMWF, RMS", "gfs_r": "Solo GFS, RMS", "target": "meta"},
  "ages": ["Análisis", "6 h", "24 h"],
  "t1_h": "Lo que vale un pronóstico en un año de tiempo pasado",
  "t1_cols": ["Política", "Minutos ahorrados vs prohibición", "Vuelos con boom sobre tierra"],
  "t1": [("Conocimiento perfecto de la atmósfera", "36.4", "0 %", False),
         ("Pronóstico con margen del ensemble (fuera de muestra)", "26.1–29.1", "0.4–0.5 % (cualquier boom)", False),
         ("Igual, margen subido por la elección de ruta (en vivo hoy)", "unos 0.7 menos", "0.28 % sobre 0.11 psf (95 %: 0.47 %)", True),
         ("Mach 1.05 fijo, sin tiempo", "18.9", "boom en el 1.1 % de la distancia", False)],
  "t1_note": "Retroanálisis: 53 análisis semanales de GFS y sus pronósticos a 24 h, 48 rutas con dirección, avión tipo Overture a FL550, con error real añadido (σ 0.012).",
  "t2_h": "Booms de cohetes: el modelo contra booms medidos",
  "t2_cols": ["Medición", "Medido, psf", "Modelo, psf"],
  "t2": [("Propulsores laterales del Falcon Heavy, LZ-1/2, en LC-40 (8.9 km)", "1.59–1.71", "1.82"),
         ("Propulsores laterales del Falcon Heavy, LZ-1/2, en LC-39A (15.1 km)", "1.40–1.44", "1.26"),
         ("Regreso del Super Heavy, vuelo 5, Port Isabel", "7.1 a 10.5 km; unos 10", "8.6")],
  "t2_note": "Fuentes: FAA, evaluación ambiental final del programa Falcon de SpaceX, apéndices, tabla 1; Gee et al., JASA Express Letters 4, 113601 (2024).",
  "money_h": "Dinero y costos",
  "money": [("cost", "Costo de operar", "$11–15", "al año, 2026 USD: el dominio. Los datos y el hosting son gratis."),
            ("save", "Beneficio por vuelo", "$1,800–2,100", "tiempo de pasajeros ahorrado por los corredores: 52 pasajeros × 25–28 min × $85/h (valor del tiempo supuesto)"),
            ("pay", "Le compensa a un pasajero", "$1,300–2,200/h", "un asiento supersónico le gana a un 787-9 solo si tu hora vale esto"),
            ("pay", "Quién paga", "Nadie todavía", "datos abiertos (NOAA, ECMWF) y hosting gratis; anuncios y patrocinios opcionales")],
  "money_cols": ["Escenario", "Combustible", "Equilibrio vs 787-9", "Lectura"],
  "money_rows": [("Bajo", "$0.71/kg (2025)", "$1,296/h", "Viajeros de negocios con un valor del tiempo alto", False),
                 ("Base", "$1.20/kg (promedio 2026)", "$1,835/h", "Altos ejecutivos y viajes urgentes", True),
                 ("Alto", "$1.50/kg (último)", "$2,164/h", "Un mercado de nicho", False)],
  "money_note": "2026 USD. Equilibrio = costo extra por asiento ÷ horas ahorradas, mediana de 960 vuelos planeados para un jet tipo Overture (study/results/mach_value.json). Los costos por asiento son estimados: el consumo de Overture no es público.",
  "est": "Estimado",
  "how_h": "Cómo lo hice",
  "how": [
   ("El problema", "Desde 1973 Estados Unidos prohíbe el vuelo civil supersónico sobre tierra por el estampido sónico. En julio de 2026 la FAA propuso cambiar la prohibición por un límite de ruido de 0.11 psf en el suelo. Hay dos formas de cumplirlo. Una es un avión nuevo y más silencioso, como el X-59 de la NASA. La otra no necesita avión nuevo: volar justo lo bastante lento para que el aire de abajo doble el estampido hacia arriba antes de tocar el suelo. Eso se llama Mach cutoff, y el XB-1 de Boom demostró en enero de 2025 que funciona. El problema es que la velocidad que funciona depende de la temperatura y el viento del día, de la dirección del vuelo y del terreno. Quería saber dónde y cuándo funciona, a qué velocidad y cuánto valdría pronosticarlo."),
   ("Los datos", "Cada seis horas el sitio descarga el último pronóstico GFS de la NOAA y el pronóstico abierto del ECMWF, los dos gratis, y calcula el Mach sin estampido en cada punto de 1 grado, siete niveles de vuelo y 36 direcciones. La respuesta es el promedio de los dos modelos; si uno de ellos dice que no hay corredor, el mapa no muestra ninguno. El ensemble GEFS de la NOAA, con 31 pronósticos, fija el margen de seguridad punto por punto. El terreno sale de GFS y de un modelo de elevación de 600 m, las costas de Natural Earth y los estilos de mapa satelital de NASA GIBS."),
   ("Cómo lo comprobé", "Un pronóstico solo sirve si sabes cuánto se equivoca. Comparé el Mach sin estampido pronosticado con lo que midieron 3,500 globos sonda en 12 estaciones de EE. UU., Alaska y Europa durante un año completo. Después repetí un año de tiempo pasado para ver cuántos minutos ahorran los corredores y cuántas veces se habría escapado un boom, y fijé los márgenes para que menos del 0.5 % de los vuelos pase de 0.11 psf. Los modelos de ruido se compararon con los vuelos de prueba FaINT de la NASA y con mediciones del Concorde. El trazador de rayos se prueba contra soluciones exactas cada vez que cambia el código, y antes de cada publicación corren una prueba en navegador y una auditoría de accesibilidad."),
   ("Qué hizo la IA", "Trabajé con Claude, un modelo de IA de Anthropic. Escribió la mayor parte del código y corrió los estudios; yo puse las preguntas, leí los resultados, tomé las decisiones y contacté a la NASA y a Boom para pedir datos de vuelo. Otros revisores de IA hicieron de equipo rojo, un experto a la vez, y encontraron problemas reales que luego arreglé. Cada número de esta página sale del repositorio, donde el método, el código y el historial de cambios son públicos."),
   ("Más allá de los aviones", "El mismo trazador de rayos ahora pronostica booms de cohetes. Un propulsor que regresa cae de punta a dos o cuatro veces la velocidad del sonido, así que su estampido cae sobre los pueblos alrededor de la zona de aterrizaje. El sitio traza esos rayos por la atmósfera pronosticada para cada lanzamiento próximo en Cabo Cañaveral, Vandenberg y Starbase, y calibra el ruido con booms medidos para la FAA y por la Universidad Brigham Young. También publica una página por ruta aérea que dice si esa ruta podría volarse hoy sin estampido."),
   ("Qué falló", "Bastante. La primera velocidad del sonido en aire húmedo estaba un poco mal y daba corredores hasta 0.001 Mach demasiado rápidos en aire caliente y húmedo (arreglado en el modelo 2.10). Escoger la más rápida de varias rutas subía en silencio la probabilidad de boom de 0.43 % a 0.59 %, así que subió el margen. Una primera afirmación de que un colchón de 1 km de altura costaba solo un minuto se retiró cuando el modelo de ruido mostró que un avión de línea necesita unos 1.25 km. La bahía de Hudson se trataba como mar abierto hasta el modelo 2.12. La meta original de error de 0.010 no la cumple ningún modelo solo en RMS, ni siquiera en el análisis; el promedio de dos modelos la cumple solo del lado inseguro, y esa decisión sigue abierta. El ruido de los cohetes es bueno a un factor de dos, y los booms concentrados aún no se modelan."),
  ],
  "src_h": "Fuentes y licencias",
  "src_cols": ["Fuente", "Para qué", "Licencia", "Uso comercial"],
  "src": [("NOAA GFS y GEFS (AWS Open Data)", "Atmósfera pronosticada, margen del ensemble", "Dominio público del Gobierno de EE. UU.", "Sí"),
          ("ECMWF IFS, datos abiertos", "Segundo modelo", "CC BY 4.0", "Sí, con atribución"),
          ("NOAA IGRA2, globos sonda", "Validación", "Dominio público", "Sí"),
          ("NASA GIBS (VIIRS, Blue Marble, Black Marble)", "Estilos de mapa satelital", "Datos abiertos de la NASA, con reconocimiento", "Sí"),
          ("Natural Earth", "Costas y fronteras", "Dominio público", "Sí"),
          ("AWS Terrain Tiles (SRTM, GMTED2010, ETOPO1)", "Piso del terreno", "Fuentes de dominio público, con atribución", "Sí"),
          ("Launch Library 2, The Space Devs", "Próximos lanzamientos", "API gratuita con sus propios términos", "Revisar sus términos")],
  "src_note": "Los datos del pronóstico se actualizan cada 6 horas; la validación cubre oct 2025 – sep 2026. Método, código e historial del modelo: github.com/FernandoVazq/mach-corridor.",
  "notice": "Proyecto de investigación de Fernando J. Vázquez. No apto para planificar vuelos.",
  "privacy": "Privacidad",
 },
}

CSS = """
:root { --p-mach: #3a4cc0; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --p-mach: #8c9cff; } }
html, body { height: auto; }
.bar { height: 52px; } .bar .status a { text-decoration: none; } .bar .lang { border: 1px solid var(--rule); border-radius: 999px; padding: 1px 10px; font-family: var(--font-mono); font-size: 12px; }
.at { max-width: 1120px; margin: 0 auto; padding: 32px 16px 56px; }
.at section { margin-top: 32px; }
.lbl { font-family: var(--font-mono); font-size: 12px; line-height: 16px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); }
.at h1 { font-family: var(--font-display); font-size: 56px; line-height: 56px; font-weight: 700; letter-spacing: -.01em; margin: 0; display: flex; align-items: center; gap: 14px; }
.at h1 i { width: 14px; height: 14px; border-radius: 50%; background: var(--p-mach); display: inline-block; flex: none; }
.at h2 { font-family: var(--font-display); font-size: 36px; line-height: 40px; font-weight: 700; margin: 0 0 12px; }
.at h3 { font-family: var(--font-display); font-size: 24px; line-height: 28px; font-weight: 600; margin: 0; }
.at p, .at li { font-size: 16px; line-height: 24px; color: var(--ink-2); }
.hero .line { font-size: 19px; line-height: 28px; color: var(--ink-2); max-width: 760px; margin: 12px 0 18px; }
.hero .ctas { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
.btn { display: inline-block; padding: 9px 16px; border-radius: 8px; font-weight: 600; text-decoration: none; border: 1px solid var(--rule); color: var(--ink); background: var(--surface); }
.btn.main { background: var(--p-mach); border-color: var(--p-mach); color: #fff; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .btn.main { color: #0b1117; } }
.hero figure { margin: 0; } .hero img { width: 100%; height: auto; display: block; border-radius: 14px; border-top: 4px solid var(--p-mach); }
.hero figcaption { font-family: var(--font-mono); font-size: 12px; color: var(--ink-3); margin-top: 6px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.k { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 16px; display: grid; gap: 6px; align-content: start; }
.k .v { font-family: var(--font-display); font-weight: 700; font-size: 40px; line-height: 40px; font-variant-numeric: tabular-nums; color: var(--ink); }
.k .v small { font-size: 18px; color: var(--ink-2); font-weight: 600; margin-left: 4px; }
.k .c { font-size: 13px; line-height: 18px; color: var(--ink-2); }
.d { font-family: var(--font-mono); font-size: 12px; border-radius: 4px; padding: 1px 6px; justify-self: start; }
.d.good { color: var(--good); background: var(--good-soft); } .d.warn { color: var(--warn); background: var(--warn-soft); } .d.crit { color: var(--bad); background: var(--bad-soft); }
.ins { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.ins li { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 10px 14px; font-size: 15px; color: var(--ink); }
.frame { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 20px 24px; display: grid; gap: 6px; }
.frame .sub { font-size: 13px; color: var(--ink-3); } .frame > svg { width: 100%; height: auto; margin-top: 8px; }
.frame > svg.cmp { display: none; }
@media (max-width: 560px) { .frame > svg.wide { display: none; } .frame > svg.cmp { display: block; } .frame { padding: 14px; } }
.frame .src, .at .note { font-family: var(--font-mono); font-size: 12px; line-height: 18px; color: var(--ink-3); }
.tw { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; overflow-x: auto; margin-top: 10px; }
.tw table { border-collapse: collapse; width: 100%; font-size: 14px; }
.tw th { font-family: var(--font-mono); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); text-align: left; background: var(--surface-2); padding: 9px 12px; font-weight: 500; }
.tw td { padding: 9px 12px; border-top: 1px solid var(--rule); color: var(--ink); vertical-align: top; }
.tw .r { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap; }
.tw tr.key td { background: var(--accent-soft); }
@media (max-width: 560px) {
  .tw thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .tw table, .tw tbody, .tw tr, .tw td { display: block; width: 100%; }
  .tw tr { border-top: 1px solid var(--rule); padding: 6px 0; } .tw tr:first-child { border-top: 0; }
  .tw td { border: 0; padding: 3px 12px; display: flex; justify-content: space-between; gap: 12px; text-align: right; }
  .tw td:first-child { font-weight: 600; text-align: left; display: block; }
  .tw td:not(:first-child)::before { content: attr(data-label); font-family: var(--font-mono); font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); text-align: left; flex: none; max-width: 45%; }
  .tw .r { white-space: normal; }
}
.money { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 24px; display: grid; gap: 16px; }
.mg { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.cell { border-radius: 8px; padding: 12px; display: grid; gap: 4px; align-content: start; }
.cell.cost { background: var(--bad-soft); } .cell.save { background: var(--good-soft); } .cell.pay { background: var(--surface-2); }
.cell .v { font-family: var(--font-display); font-weight: 700; font-size: 28px; line-height: 30px; font-variant-numeric: tabular-nums; color: var(--ink); }
.cell.cost .v { color: var(--bad); } .cell.save .v { color: var(--good); }
.cell .lbl { color: var(--ink-2); }
.cell .s { font-size: 13px; line-height: 18px; color: var(--ink-2); }
.money .tw { margin: 0; border: 0; } .how h3 { margin-top: 18px; } .how { max-width: 760px; }
.notice { background: var(--warn-soft); color: var(--ink); border-radius: 8px; padding: 12px 16px; font-weight: 600; }
.foot { font-family: var(--font-mono); font-size: 12px; color: var(--ink-3); margin-top: 18px; }
@media (max-width: 900px) { .kpis, .mg { grid-template-columns: repeat(2, minmax(0, 1fr)); } .at h1 { font-size: 44px; line-height: 46px; } }
@media (max-width: 520px) { .kpis, .mg { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .k, .cell { padding: 10px; } .k .v { font-size: 30px; line-height: 32px; } .k .v small { font-size: 14px; }
  .cell .v { font-size: 22px; line-height: 24px; } .at h2 { font-size: 28px; line-height: 32px; } .at h1 { font-size: 40px; line-height: 42px; } .hero .line { font-size: 17px; line-height: 25px; } .at section { margin-top: 24px; } }
.k .lbl, .cell .lbl { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.th { display: flex; align-items: center; gap: 4px; } .th h3 { margin: 0; }
"""


def chart(L, compact=False):
    rows = [("gfs_r", 0, .0104), ("gfs_r", 6, .0113), ("gfs_r", 24, .0130), ("mean_r", 0, .0092), ("mean_r", 6, .0104), ("mean_r", 24, .0117),
            ("mean_u", 0, .0070), ("mean_u", 6, .0080), ("mean_u", 24, .0095)]
    if compact:      # phones: taller, larger type, short series names
        VW, VH, X0, X1, Y0, Y1, fs, names, cls = 360, 320, 58, 200, 266, 30, 16, L["series_short"], "cmp"
    else:
        VW, VH, X0, X1, Y0, Y1, fs, names, cls = 760, 340, 80, 550, 300, 60, 12, L["series"], "wide"
    x = lambda a: X0 + a / 24 * (X1 - X0)
    y = lambda v: Y0 - (v - .006) / .008 * (Y0 - Y1)
    style = {"mean_u": ("var(--data-1)", "", 3), "mean_r": ("var(--data-1)", ' stroke-dasharray="6 4"', 2), "gfs_r": ("var(--data-other)", ' stroke-dasharray="6 4"', 2)}
    out = [f'<svg class="{cls}" viewBox="0 0 {VW} {VH}" role="img" aria-label="{html.escape(L["chart_t"])}" font-family="var(--font-mono)" font-size="{fs}">']
    for v in ((.006, .010, .014) if compact else (.006, .008, .010, .012, .014)):
        ref = abs(v - .010) < 1e-9
        dash = ' stroke-dasharray="2 3"' if ref else ""
        out.append(f'<line x1="{X0}" x2="{X1 + 10}" y1="{y(v):.1f}" y2="{y(v):.1f}" stroke="{"var(--ink-3)" if ref else "var(--grid)"}"{dash}/>')
        lab = f'{v:.3f}' + ("" if compact or not ref else " " + L["series"]["target"])
        out.append(f'<text x="{X0 - 8}" y="{y(v) + 4:.1f}" text-anchor="end" fill="{"var(--ink)" if ref else "var(--ink-3)"}">{lab}</text>')
    for i, a in enumerate((0, 6, 24)):
        out.append(f'<text x="{x(a):.1f}" y="{VH - 10}" text-anchor="middle" fill="var(--ink-3)">{L["ages"][i]}</text>')
    for key in ("gfs_r", "mean_r", "mean_u"):
        col, dash, w = style[key]
        pts = [(a, v) for k, a, v in rows if k == key]
        d = "".join(f'{"M" if i == 0 else "L"}{x(a):.1f},{y(v):.1f}' for i, (a, v) in enumerate(pts))
        out.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}"{dash}/>')
        for a, v in pts:
            out.append(f'<circle cx="{x(a):.1f}" cy="{y(v):.1f}" r="4" fill="{col}"><title>{html.escape(L["series"][key])}: {v:.4f}</title></circle>')
        a, v = pts[-1]
        out.append(f'<text x="{x(a) + 10:.1f}" y="{y(v) + 4:.1f}" font-family="var(--font-body)" font-size="{fs + 1}" fill="{"var(--ink)" if key == "mean_u" else "var(--ink-2)"}">{html.escape(names[key])}</text>')
        if key == "mean_u" and not compact:
            for a, v in pts:
                out.append(f'<text x="{x(a):.1f}" y="{y(v) + 20:.1f}" text-anchor="middle" fill="var(--ink)">{v:.4f}</text>')
    out.append("</svg>")
    return "".join(out)


def table(cols, rows, num_cols=(), key_flag=False):
    h = "".join(f'<th scope="col"{" class=\"r\"" if i in num_cols else ""}>{html.escape(c)}</th>' for i, c in enumerate(cols))
    body = []
    for r in rows:
        key = key_flag and r[-1] is True
        cells = r[:-1] if key_flag else r
        tds = "".join(f'<td{" class=\"r\"" if i in num_cols else ""} data-label="{html.escape(cols[i])}">{html.escape(str(c))}</td>' for i, c in enumerate(cells))
        body.append(f'<tr{" class=\"key\"" if key else ""}>{tds}</tr>')
    return f'<div class="tw" tabindex="0" role="region" aria-label="{html.escape(cols[0])}"><table><thead><tr>{h}</tr></thead><tbody>{"".join(body)}</tbody></table></div>'


def tip(text, label):
    return f'<button type="button" class="it" data-tip="{html.escape(text)}" aria-label="{html.escape(label)}"></button>'


def page(L):
    e = html.escape
    kp = "".join(f'<div class="k"><span class="lbl">{e(lbl)}{tip(c + ". " + src + ".", L["more"] + ": " + lbl)}</span><span class="v">{e(v)}<small>{e(u)}</small></span>'
                 f'<span class="c">{e(L["kpi_short"][i])}</span><span class="d {tone}">{e(chip)}</span></div>'
                 for i, (lbl, v, u, c, tone, chip, src) in enumerate(L["kpis"]))
    money = "".join(f'<div class="cell {kind}"><span class="lbl">{e(l)}{tip(s_, L["more"] + ": " + l)}</span><span class="v">{e(v)}</span><span class="s">{e(L["money_short"][i])}</span></div>'
                    for i, (kind, l, v, s_) in enumerate(L["money"]))
    how = "".join(f'<details class="fold"><summary>{e(h)} <span class="sm">{e(L["how_sum"][i])}</span></summary><div class="fb"><p>{e(p)}</p></div></details>'
                  for i, (h, p) in enumerate(L["how"]))
    nav = "".join(f'<a href="{u}">{e(n)}</a>' for n, u in L["nav"])
    strip = (f'<div class="ss" data-min="0.0070" data-med="0.0080" data-max="0.0095" data-ref="0.010" data-better="low" data-dec="4" '
             f'data-ref-label="{e(L["series"]["target"])}" data-n="{e(L["stat_n"])}" data-label="{e(L["series"]["mean_u"])}"></div>')
    alt_en, alt_es = "https://machcorridor.com/about/", "https://machcorridor.com/es/"
    canon = alt_en if L["lang"] == "en" else alt_es
    return f"""<!doctype html>
<html lang="{L['lang']}">
<head>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5654559314082674"
     crossorigin="anonymous"></script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(L['title'])}</title>
<meta name="description" content="{e(L['desc'])}">
<link rel="canonical" href="{canon}">
<link rel="alternate" hreflang="en" href="{alt_en}"><link rel="alternate" hreflang="es" href="{alt_es}"><link rel="alternate" hreflang="x-default" href="{alt_en}">
<meta property="og:type" content="website"><meta property="og:title" content="{e(L['title'])}"><meta property="og:description" content="{e(L['desc'])}">
<meta property="og:url" content="{canon}"><meta property="og:image" content="https://machcorridor.com/cover.webp"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="750">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23061029'/%3E%3Cpath d='M6 21 L16 9 L26 21' fill='none' stroke='%23fff' stroke-width='2.6' stroke-linejoin='round'/%3E%3Cpath d='M5 25 Q16 17 27 25' fill='none' stroke='%237FA6DB' stroke-width='2.2'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{FONTS}" rel="stylesheet">
<link rel="stylesheet" href="../style.css">
<style>{CSS}</style>
<script src="../ui.js" defer></script>
</head>
<body>
<header class="bar">
  <a class="brand" href="{L['home']}" aria-label="Mach Corridor">
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#061029"/><path d="M6 21 L16 9 L26 21" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="M5 25 Q16 17 27 25" fill="none" stroke="#7FA6DB" stroke-width="2.2"/></svg>
    <span class="name">Mach Corridor</span>
  </a>
  <nav class="status" aria-label="Mach Corridor">{nav}<a class="lang" href="{L['other']}" hreflang="{'es' if L['lang'] == 'en' else 'en'}" title="{e(L['other_name'])}">{L['other_label']}</a></nav>
</header>
<main class="at">
  <section class="hero" style="margin-top:0">
    <h1><i aria-hidden="true"></i>Mach Corridor</h1>
    <p class="line">{e(L['hero_line'])}</p>
    <div class="ctas"><a class="btn main" href="../">{e(L['cta1'])}</a><a class="btn" href="../routes/">{e(L['cta2'])}</a><a class="btn" href="../rockets.html">{e(L['cta3'])}</a></div>
    <figure><img src="../img/hero-map.webp" width="1600" height="1000" alt="{e(L['hero_cap'])}"><figcaption>{e(L['hero_cap'])}</figcaption></figure>
  </section>
  <section><div class="kpis">{kp}</div></section>
  <section><h2>{e(L['insights_h'])}</h2><ul class="ins">{''.join(f'<li>{e(i)}</li>' for i in L['insights'])}</ul></section>
  <section><div class="frame"><h3>{e(L['chart_t'])}</h3><span class="sub">{e(L['chart_s'])}</span>{strip}{chart(L)}{chart(L, True)}<span class="src">{e(L['chart_src'])}</span></div></section>
  <section><div class="th"><h3>{e(L['t1_h'])}</h3>{tip(L['t1_note'], L['more'] + ': ' + L['t1_h'])}</div>{table(L['t1_cols'], L['t1'], num_cols=(1,), key_flag=True)}</section>
  <section><div class="th"><h3>{e(L['t2_h'])}</h3>{tip(L['t2_note'], L['more'] + ': ' + L['t2_h'])}</div>{table(L['t2_cols'], L['t2'], num_cols=(1, 2))}</section>
  <section><div class="money"><div class="th"><h2 style="margin:0">{e(L['money_h'])}</h2><span class="d warn">{e(L['est'])}</span>{tip(L['money_note'], L['more'] + ': ' + L['money_h'])}</div><div class="mg">{money}</div>
    {table(L['money_cols'], L['money_rows'], num_cols=(1, 2), key_flag=True)}</div></section>
  <section class="how"><h2>{e(L['how_h'])}</h2>{how}</section>
  <section><h2>{e(L['src_h'])}</h2><details class="fold"><summary>{len(L['src'])} <span class="sm">{e(L['src_sum'])}</span></summary><div class="fb">{table(L['src_cols'], L['src'])}<p class="note">{e(L['src_note'])}</p></div></details></section>
  <section><p class="notice">{e(L['notice'])}</p><p class="foot"><a href="../privacy.html">{e(L['privacy'])}</a> · <a href="https://github.com/FernandoVazq/mach-corridor">GitHub</a></p></section>
</main>
</body>
</html>
"""


if __name__ == "__main__":
    for k, L in T.items():
        d = os.path.join(ROOT, L["path"])
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf8") as f:
            f.write(page(L))
        words = sum(len(p.split()) for _, p in L["how"])
        print(k, "written;", words, "words in", L["how_h"])
