"""Tests for the secondary-boom ray ranges (engine/secondary.py)."""
import math
import numpy as np
from secondary import std_T, column_grid, ray_ranges, ranges_vec, ssb_table, DZ


def jet_columns():
    z = np.arange(0, 48001, 1000.0); T = std_T(z)
    jet = 60 * np.exp(-((z - 50000) / 12000) ** 2) + 15 * np.exp(-((z - 11000) / 3000) ** 2)
    Z = np.c_[z, z, z]; TT = np.c_[T, T, T]; U = np.c_[jet, -jet, 0 * jet]; V = np.zeros_like(U)
    return Z, TT, U, V


def test_vectorised_matches_reference():
    Z, T, U, V = jet_columns(); c, u, v = column_grid(Z, T, U, V)
    ka = int(round(550 * 30.48 / DZ)); n_hit = 0
    for e in (60.0, 90.0, 270.0):
        Vt = np.array([355.0, 355.0, 355.0])
        r = ray_ranges(c, u, v, ka * DZ, np.full(3, e), Vt)
        R1, R2 = ranges_vec(c, u, v, ka, e, Vt)
        ok = np.isfinite(r["I_along"]); n_hit += int(ok.sum())
        assert (np.isfinite(R1) == ok).all()
        assert np.allclose(R1[ok], r["I_along"][ok], rtol=0.02) and np.allclose(R2[ok], r["II_along"][ok], rtol=0.02)
    assert n_hit >= 2


def test_no_jet_no_secondary_and_jet_gives_150_300_km():
    Z, T, U, V = jet_columns(); tab = ssb_table(Z, T, U, V)
    east = tab[9]                                  # e = 090: column 0 has a 60 m/s stratospheric tailwind
    assert east[1, 0] > east[0, 0] and 120 < east[2, 0] < 320
    assert not np.isfinite(east[2, 2])             # still air: the stratosphere never beats the ground


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"): f(); print("ok", n)
