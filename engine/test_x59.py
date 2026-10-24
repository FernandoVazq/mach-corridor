"""Tests for x59.py (X-59 boom carpet): python test_x59.py"""
import numpy as np
import rocket, x59
from secondary import std_T


def test_still_air_symmetric():
    p = rocket.profile_from_column(None)
    a = x59.carpet(p, 0); b = x59.carpet(p, 90)
    assert a[0] == a[1] and a[0] == b[0] and 30 < a[0] < 100, (a, b)


def test_headwind_narrows_carpet():
    z = np.array([0, 5000, 10000, 12000, 16000, 20000, 30000.])
    col = {"z": list(z), "T": list(std_T(z)), "u": [0, 10, 30, 35, 25, 10, 0], "v": [0] * 7}
    p = rocket.profile_from_column(col)
    west = x59.carpet(p, 270); east = x59.carpet(p, 90); still = x59.carpet(rocket.profile_from_column(None), 270)
    assert west[0] < still[0] and west[0] < east[0], (west, east, still)     # into the wind: lower ground speed, narrower


if __name__ == "__main__":
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); print("ok", k)
