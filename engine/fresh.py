"""Is there a complete GFS run newer than the one on the map? Prints build=true|false for GitHub Actions.
Standard library only, so the hourly check costs seconds."""
import datetime as dt, json, os, urllib.request

BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
PUBLISHED = "https://raw.githubusercontent.com/FernandoVazq/mach-corridor/forecast-data/manifest.json"


def ok(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as r:
            return r.status == 200
    except Exception:
        return False


def latest():
    now = dt.datetime.now(dt.timezone.utc)
    for back in range(0, 48, 6):
        t = now - dt.timedelta(hours=back)
        run, h = t.strftime("%Y%m%d"), f"{(t.hour // 6) * 6:02d}"
        if ok(f"{BASE}/gfs.{run}/{h}/atmos/gfs.t{h}z.pgrb2.1p00.f048.idx"):
            return run + h
    return None


def published():
    try:
        with urllib.request.urlopen(PUBLISHED, timeout=30) as r:
            return json.load(r)["run"]
    except Exception:
        return None


if __name__ == "__main__":
    new, cur = latest(), published()
    build = new is not None and (cur is None or new > cur)
    print(f"latest {new}, published {cur}, build {build}")
    with open(os.environ.get("GITHUB_OUTPUT", os.devnull), "a") as f:
        f.write(f"build={'true' if build else 'false'}\n")
