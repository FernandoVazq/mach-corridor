"""Tests for sound.py (how far sound carries): run with python -m pytest engine/test_sound.py or python test_sound.py."""
import numpy as np
import sound


def _one(T0, T1, u0=0.0, u1=0.0):
    c0 = sound.c_of(np.array([T0])); c1 = sound.c_of(np.array([T1]))
    return sound.theta_c(c0, np.array([u0]), np.array([0.0]), [(c1, np.array([u1]), np.array([0.0]), np.array([True]))])[:, 0]


def test_lapse_rate_bends_up():
    th = _one(290.0, 285.0)                      # normal daytime cooling with height: no trapping in any direction
    assert (th == 0).all()


def test_inversion_traps_all_around():
    th = _one(280.0, 286.0)                      # 6 K inversion: c rises ~3.6 m/s
    assert (th > 7).all() and np.ptp(th) < 1e-9
    # closed form: arccos(c0 / c1)
    assert abs(th[0] - np.degrees(np.arccos(np.sqrt(280 / 286)))) < 1e-9


def test_wind_shear_traps_downwind_only():
    th = _one(288.0, 288.0, u0=1.0, u1=8.0)      # westerly increasing with height, no inversion
    east, west = th[sound.DIRS.index(90)], th[sound.DIRS.index(270)]
    assert east > 3 and west == 0


def test_band_mask():
    zg = np.zeros((1, 1))
    Fs = {("TMP", "2 m above ground"): np.full((1, 1), 280.0), ("UGRD", "10 m above ground"): np.zeros((1, 1)),
          ("VGRD", "10 m above ground"): np.zeros((1, 1))}
    plev = [900.0, 700.0]
    T = np.array([[[290.0]], [[300.0]]]); U = V = np.zeros((2, 1, 1))
    Z = np.array([[[1000.0]], [[3000.0]]])       # second level above the 1.5 km band: ignored
    th = sound.carry_grid(zg, Fs, plev, T, U, V, Z)
    assert abs(th[0, 0, 0] - np.degrees(np.arccos(np.sqrt(280 / 290)))) < 1e-9
    assert sound.carry_grid(zg, {}, plev, T, U, V, Z) is None


def test_atlas_shape_and_encoding():
    th = np.zeros((8, 181, 360)); th[2, 10, 20] = 5.0
    a = sound.atlas(th, lambda x: x)
    assert a.shape == (2 * 181, 6 * 360)
    # tile 2 at row 0, col 2; tile 9 (largest) at row 1, col 3; tile 8 (smallest) at row 1, col 2
    assert a[10, 2 * 360 + 20] == 50 and a[181 + 10, 3 * 360 + 20] == 50 and a[181 + 10, 2 * 360 + 20] == 0
    assert a[181 + 10, 4 * 360 + 20] == sound.WIND_ZERO and a[181 + 10, 5 * 360 + 20] == sound.WIND_ZERO     # calm


def test_band_wind_and_encoding():
    zg = np.zeros((1, 1)); plev = [925.0, 700.0]
    Fs = {("UGRD", "10 m above ground"): np.full((1, 1), 2.0), ("VGRD", "10 m above ground"): np.full((1, 1), 0.0),
          ("UGRD", "80 m above ground"): np.full((1, 1), 4.0), ("VGRD", "80 m above ground"): np.full((1, 1), 2.0)}
    U = np.array([[[6.0]], [[30.0]]]); V = np.array([[[4.0]], [[30.0]]]); Z = np.array([[[800.0]], [[3000.0]]])
    u, v = sound.band_wind(zg, Fs, plev, U, V, Z)      # 10 m, 80 m and 925 hPa (800 m); 700 hPa is above the band
    assert abs(u[0, 0] - 4.0) < 1e-12 and abs(v[0, 0] - 2.0) < 1e-12
    th = np.zeros((8, 181, 360)); w = (np.full((181, 360), -3.0), np.full((181, 360), 100.0))
    a = sound.atlas(th, lambda x: x, w)
    assert a[181, 4 * 360] == 128 - 6 and a[181, 5 * 360] == 255          # clipped at +63.5 m/s


if __name__ == "__main__":
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); print("ok", k)
