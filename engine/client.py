"""
Mach Corridor public data client (issue #22). No server: every number the site shows comes from static files on
GitHub Pages, documented in docs/API.md. This client reads them and answers the same questions as the map.

    from client import MachCorridor
    mc = MachCorridor()                                   # live site; MachCorridor("http://localhost:8765/") for a copy
    mc.limit(39.5, -98.0, heading=270, fl=550)            # boomless Mach limit (no margin), None if no corridor
    mc.margin(39.5, -98.0, heading=270, fl=550)           # ensemble margin the router subtracts
    mc.flyable(39.5, -98.0, heading=270, fl=550)          # limit - margin - cushion for a 61 m airliner

Command line:  python client.py LAT LON HEADING FL [hours-after-run]
Needs numpy and pillow. Research prototype: not for flight.
"""
import io, json, math, sys, urllib.request
import numpy as np
from PIL import Image

LIVE = "https://fernandovazq.github.io/mach-corridor/"


class MachCorridor:
    def __init__(self, base=LIVE):
        self.base = base.rstrip("/") + "/"
        self._img = {}
        self.man = self._json("data/manifest.json")
        try:
            self.gefs = self._json("data/gefs/gefs.json")
        except Exception:
            self.gefs = None

    # ---------- raw files ----------
    def _get(self, path):
        with urllib.request.urlopen(self.base + path + ("&" if "?" in path else "?") + "r=" + self.man["run"] if hasattr(self, "man") else self.base + path, timeout=60) as r:
            return r.read()

    def _json(self, path):
        return json.loads(self._get(path))

    def _png(self, path, channel=0):
        if path not in self._img:
            a = np.asarray(Image.open(io.BytesIO(self._get(path))))
            self._img[path] = a if a.ndim == 2 else a[..., channel]
        return self._img[path]

    # ---------- helpers ----------
    def _fh(self, hours):
        H = self.man["forecast_hours"]
        return min(H, key=lambda h: abs(h - hours))

    def _tile(self, atlas, t, i, j):
        A = self.man["atlas"]; cols = A["cols"]; ny, nx = self.man["grid"]["ny"], self.man["grid"]["nx"]
        r, c = divmod(t, cols)
        return int(atlas[r * ny + j, c * nx + i])

    def _nodes(self, lat, lon):
        fi = ((lon + 180) % 360); fj = min(180.0, max(0.0, 90 - lat))
        i0, j0 = int(math.floor(fi)) % 360, min(179, int(math.floor(fj)))
        return [(i0, j0, (1 - (fi - math.floor(fi))) * (1 - (fj - j0))), ((i0 + 1) % 360, j0, (fi - math.floor(fi)) * (1 - (fj - j0))),
                (i0, j0 + 1, (1 - (fi - math.floor(fi))) * (fj - j0)), ((i0 + 1) % 360, j0 + 1, (fi - math.floor(fi)) * (fj - j0))]

    # ---------- answers ----------
    def limit(self, lat, lon, heading, fl, hours=0):
        """Boomless Mach limit (turning point 1 km above the highest terrain), bilinear in space, the lower of the
        two bracketing 10-degree headings; None if any surrounding node has no corridor (as the router does)."""
        fh = self._fh(hours); atlas = self._png(f"data/f{fh:03d}_FL{fl}.png")
        e = self.man["encoding"]; h = (heading % 360) / 10; t0 = int(math.floor(h)) % 36; t1 = (t0 + 1) % 36
        out = []
        for t in (t0, t1):
            v = 0.0
            for i, j, w in self._nodes(lat, lon):
                raw = self._tile(atlas, t, i, j)
                if raw == 0:
                    return None
                v += w * (e["M0"] + e["M_step"] * raw)
            out.append(v)
        return round(min(out), 4)

    def margin(self, lat, lon, heading, fl, hours=0, s_extra=None, air_data=0.005):
        """Auto margin k * sqrt(spread^2 + s_extra^2 + air_data^2) from the live GEFS spread (the site raises s_extra
        to 0.015 over terrain above 1.5 km); None if the ensemble is not published."""
        g = self.gefs
        if not g:
            return None
        valid = self.man["run_time"]
        import datetime as dt
        t = dt.datetime.fromisoformat(valid.replace("Z", "+00:00")) + dt.timedelta(hours=hours)
        hg = (t - dt.datetime.fromisoformat(g["run_time"].replace("Z", "+00:00"))).total_seconds() / 3600
        fh = min(g["fhs"], key=lambda x: abs(x - hg))
        fls = [int(x) for x in g["fls"]]; flg = min(fls, key=lambda x: abs(x - fl))
        a = self._png(f"data/gefs/" + g["pattern"].format(fh=fh, fl=flg))
        gx, gy, d = g["nx"], g["ny"], g["d"]
        fi = ((lon + 180) % 360) / d; fj = min(gy - 1, max(0, (90 - lat) / d))
        i0, j0 = int(fi) % gx, min(gy - 2, int(fj)); di, dj = fi - int(fi), fj - j0; i1 = (i0 + 1) % gx
        def sd(t):
            r = lambda i, j: float(a[(t // 6) * gy + j, (t % 6) * gx + i])
            return g["sd_step"] * ((r(i0, j0) * (1 - di) + r(i1, j0) * di) * (1 - dj) + (r(i0, j0 + 1) * (1 - di) + r(i1, j0 + 1) * di) * dj)
        h = (heading % 360) / 10; s = max(sd(int(h) % 36), sd((int(h) + 1) % 36))
        ks = {int(k): v for k, v in g["k"].items()}; k = ks[min(ks, key=lambda x: abs(x - fl))]
        e = g.get("s_extra", 0.012) if s_extra is None else s_extra
        return round(k * math.sqrt(s * s + e * e + air_data * air_data), 4)

    def flyable(self, lat, lon, heading, fl, hours=0, cushion_mach=0.0035):
        """Highest Mach the router would fly boomless here (limit - margin - airliner cushion), or None."""
        m, g = self.limit(lat, lon, heading, fl, hours), self.margin(lat, lon, heading, fl, hours)
        if m is None or g is None:
            return None
        v = m - g - cushion_mach
        return round(v, 4) if v >= 1.0 else None


if __name__ == "__main__":
    if len(sys.argv) < 5:
        print(__doc__); sys.exit(1)
    lat, lon, hd, fl = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
    hrs = float(sys.argv[5]) if len(sys.argv) > 5 else 0
    base = sys.argv[6] if len(sys.argv) > 6 else LIVE
    mc = MachCorridor(base)
    print(json.dumps(dict(run=mc.man["run_time"], model=mc.man.get("model_version"), lat=lat, lon=lon, heading=hd, fl=fl, hours=hrs,
                          limit=mc.limit(lat, lon, hd, fl, hrs), margin=mc.margin(lat, lon, hd, fl, hrs), flyable=mc.flyable(lat, lon, hd, fl, hrs)), indent=1))
