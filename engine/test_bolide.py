"""Tests for bolide.py (fireball booms): python test_bolide.py"""
import math
import numpy as np
import bolide

# a CNEOS-shaped response: Chelyabinsk 2013-02-15 (published entry: 19 km/s, peak 23.3 km, ~440 kt, from the ENE,
# about 18 deg below the horizon) and one event without velocity components
FIX = {"signature": {"version": "1.0"}, "count": "2",
       "fields": ["date", "energy", "impact-e", "lat", "lat-dir", "lon", "lon-dir", "alt", "vel", "vx", "vy", "vz"],
       "data": [["2013-02-15 03:20:33", "37500", "440", "54.8", "N", "61.1", "E", "23.3", "18.6", "12.8", "-13.3", "-2.4"],
                ["2026-01-02 10:00:00", "4.1", "0.15", "12.0", "S", "40.0", "W", None, None, None, None, None]]}


def test_parse_and_direction():
    ev = bolide.parse(FIX)
    assert len(ev) == 2 and ev[1]["lon"] == -40.0 and ev[1]["lat"] == -12.0 and "gamma" not in ev[1]
    c = ev[0]
    assert c["gamma"] < -10 and c["gamma"] > -30, c["gamma"]          # shallow entry
    assert 250 < c["heading"] < 300, c["heading"]                       # moving roughly west (from the ENE)


def test_enu_identities():
    h, g = bolide.enu_dir(0.0, 0.0, -1.0, 0.0, 0.0)                  # at (0,0) -x is straight down
    assert abs(g + 90) < 1e-6
    h, g = bolide.enu_dir(0.0, 0.0, 0.0, 1.0, 0.0)                   # +y is east
    assert abs(h - 90) < 1e-6 and abs(g) < 1e-6


def test_diameter():
    d = bolide.diameter(440, 19.0)                                    # Chelyabinsk ~17-20 m
    assert 15 < d < 22, d


def test_chelyabinsk_order_of_magnitude():
    ev = bolide.parse(FIX)[0]
    hits, s = bolide.carpet(ev)
    assert s["heard"] and len(hits) > 50
    # overpressure on the ground near the track: 1-4 kPa reported (windows broken over a wide area); allow x3
    H = np.array(hits)
    near = H[np.hypot((H[:, 0] - 54.9) * 111, (H[:, 1] - 61.0) * 64) < 60]
    assert len(near), "no hits near the track"
    med = float(np.median(near[:, 2]))
    assert 300 < med < 12000, med
    # first boom one to three minutes after the flash
    assert 30 < s["t_min_s"] < 240, s["t_min_s"]


def test_small_meteor_matches_infrasound():
    # Edwards et al. (2008): centimetre meteoroids, boom from 56-103 km, 0.012-0.65 Pa on the ground
    z = 85000.0
    M = 35000.0 / bolide.c_std(z)
    pa = bolide.dp_ground(R=100000.0, R0=M * 0.02, z=z)
    assert 0.003 < pa < 2.0, pa


if __name__ == "__main__":
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); print("ok", k)
