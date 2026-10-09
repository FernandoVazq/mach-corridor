"""Sanity checks: ISA column must reproduce the single-column prototype and XB-1 conditions."""
import numpy as np
from physics import mmax_grid, isa_pressure_hpa, FT

PLEV = np.array([1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500,
                 450, 400, 350, 300, 250, 200, 150, 100, 70, 50], dtype=float)


def isa_T_from_p(p):
    # invert ISA: height from pressure, then temperature
    h = np.where(p > 226.32, (1 - (p / 1013.25) ** (1 / 5.25588)) / 2.25577e-5,
                 11000 - 6341.62 * np.log(p / 226.32))
    return np.where(h < 11000, 288.15 - 0.0065 * h, 216.65), h


def column(Tfun_wind=None):
    T, Z = isa_T_from_p(PLEV)
    U = np.zeros_like(T)
    if Tfun_wind is not None:
        U = Tfun_wind(Z)
    sh = lambda a: a[:, None, None].astype(float)
    return sh(T), sh(U), sh(np.zeros_like(T)), sh(Z)


def test_isa_no_wind():
    T, U, V, Z = column()
    one = np.ones((1, 1))
    M, ca = mmax_grid(PLEV, T, U, V, Z, one * 0, one * 288.15, one * 0, one * 0, 400, [90])
    assert abs(M[0, 0, 0] - 1.153) < 0.005, M
    M36, _ = mmax_grid(PLEV, T, U, V, Z, one * 0, one * 288.15, one * 0, one * 0, 360, [90])
    assert 1.12 <= M36[0, 0, 0] <= 1.18, M36  # XB-1 flew 1.12-1.18 near 36 kft
    print("ISA FL400:", round(float(M[0, 0, 0]), 3), " FL360:", round(float(M36[0, 0, 0]), 3))


def test_jet_heading_dependence():
    jet = lambda z: 40 * np.exp(-((z - 11000) / 3500) ** 2)   # westerly jet (u>0)
    T, U, V, Z = column(jet)
    one = np.ones((1, 1))
    M, _ = mmax_grid(PLEV, T, U, V, Z, one * 0, one * 288.15, one * 0, one * 0, 350, [90, 270])
    east, west = M[0, 0, 0], M[1, 0, 0]
    assert east < 1.05 and west > 1.25, (east, west)   # tailwind kills margin, headwind grows it
    print("Jet FL350 eastbound:", round(float(east), 3), " westbound:", round(float(west), 3))


def test_terrain_removes_layers():
    T, U, V, Z = column()
    one = np.ones((1, 1))
    lo, _ = mmax_grid(PLEV, T, U, V, Z, one * 0, one * 288.15, one * 0, one * 0, 450, [0])
    hi, _ = mmax_grid(PLEV, T, U, V, Z, one * 3000, one * (288.15 - 19.5), one * 0, one * 0, 450, [0])
    assert hi[0, 0, 0] < lo[0, 0, 0]   # high plateau: warm low layers gone -> less margin
    print("Sea level vs 3000 m plateau FL450:", round(float(lo[0, 0, 0]), 3), round(float(hi[0, 0, 0]), 3))


if __name__ == "__main__":
    test_isa_no_wind(); test_jet_heading_dependence(); test_terrain_removes_layers()
    print("all physics tests passed")
