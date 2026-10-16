"""Sanity checks for physics v2 (not validation: see README)."""
import numpy as np
from physics import mmax_grid

PLEV = np.array([1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500,
                 450, 400, 350, 300, 250, 200, 150, 100, 70, 50], dtype=float)


def isa_T_from_p(p):
    h = np.where(p > 226.32, (1 - (p / 1013.25) ** (1 / 5.25588)) / 2.25577e-5,
                 11000 - 6341.62 * np.log(p / 226.32))
    return np.where(h < 11000, 288.15 - 0.0065 * h, 216.65), h


def column(u_of_z=None, v_of_z=None):
    T, Z = isa_T_from_p(PLEV)
    U = u_of_z(Z) if u_of_z else np.zeros_like(T)
    V = v_of_z(Z) if v_of_z else np.zeros_like(T)
    sh = lambda a: np.asarray(a, float)[:, None, None]
    return sh(T), sh(U), sh(V), sh(Z)


def run(fl, hd, zg=0.0, h_buf=0.0, lateral=True, **kw):
    T, U, V, Z = column(**kw)
    r = mmax_grid(PLEV, T, U, V, Z, np.full((1, 1), zg), fl, [hd], h_buf=h_buf, lateral=lateral)
    return float(r["M"][0, 0, 0])


def test_isa():
    m0 = run(400, 90, h_buf=0)
    m1 = run(400, 90, h_buf=1000)
    assert abs(m0 - 1.153) < 0.006, m0          # textbook ISA value (sanity check only)
    assert 0.008 < m0 - m1 < 0.02, (m0, m1)     # 1 km turning-height buffer costs ~0.013
    print(f"ISA FL400: no buffer {m0:.3f}, 1 km buffer {m1:.3f}")


def test_jet_heading():
    jet = lambda z: 40 * np.exp(-((z - 11000) / 3500) ** 2)
    east, west = run(350, 90, u_of_z=jet), run(350, 270, u_of_z=jet)
    assert east < 1.06 and west > 1.2, (east, west)
    print(f"Jet FL350 eastbound {east:.3f}, westbound {west:.3f}")


def test_lateral_rays_crosswind():
    # crosswind shear: -20 m/s low, +50 m/s at cruise (v component, flight eastbound)
    shear = lambda z: -20 + 70 * np.clip(z / 12000, 0, 1)
    on = run(400, 90, v_of_z=shear, lateral=False)
    lat = run(400, 90, v_of_z=shear, lateral=True)
    assert lat < on - 0.005, (on, lat)
    still_on, still_lat = run(400, 90, lateral=False), run(400, 90, lateral=True)
    assert abs(still_on - still_lat) < 1e-6           # still air: on-track ray is critical
    print(f"Crosswind shear FL400: on-track only {on:.3f}, with lateral rays {lat:.3f}")


def test_terrain():
    lo, hi = run(450, 0, zg=0, h_buf=1000), run(450, 0, zg=3000, h_buf=1000)
    assert hi < lo, (lo, hi)
    print(f"FL450 sea level {lo:.3f} vs 3000 m terrain {hi:.3f}")


def test_no_corridor_is_below_one():
    # inversion-free isothermal column: nothing below is faster -> no cutoff (M < 1 or NaN)
    T, U, V, Z = column()
    T[:] = 230.0
    r = mmax_grid(PLEV, T, U, V, Z, np.zeros((1, 1)), 400, [0], h_buf=1000)
    m = float(r["M"][0, 0, 0])
    assert not (m > 1.0 + 1e-6), m
    print(f"Isothermal column: M_max {m:.3f} (no corridor)")


def test_haglund_buffer():
    from physics import haglund_buffer, mmax_grid
    T, U, V, Z = column()
    hb = float(haglund_buffer(PLEV, T, U, V, Z, np.zeros((1, 1)))[0, 0])
    assert 1150 < hb < 1350, hb                   # ISA: dc/dz ~ -0.0038 /s -> R ~ 89 km; SST signal 150 m -> ~1.25 km
    m_fix, m_hag = run(450, 90, h_buf=1000), run(450, 90, h_buf="haglund")
    assert m_hag < m_fix, (m_hag, m_fix)          # an SST-length boom needs more than 1 km in a standard lapse
    T2, U2, V2, Z2 = column(u_of_z=lambda z: 25 + 0.004 * z)    # shear makes V_P fall faster eastbound...
    hb2 = float(haglund_buffer(PLEV, T2, U2, V2, Z2, np.zeros((1, 1)))[0, 0])
    assert hb2 > hb, (hb2, hb)                    # ...but westbound slower: the worst direction is the cap
    # per direction: the floor only matters where the caustic sits at it, so the sheared column keeps a
    # thin buffer for the direction where V_P falls fast
    m_h_e = mmax_grid(PLEV, T2, U2, V2, Z2, np.zeros((1, 1)), 450, [90], h_buf="haglund", lateral=False)["M"][0, 0, 0]
    m_f_e = mmax_grid(PLEV, T2, U2, V2, Z2, np.zeros((1, 1)), 450, [90], h_buf=1000, lateral=False)["M"][0, 0, 0]
    assert abs(m_h_e - m_f_e) < 0.02, (m_h_e, m_f_e)
    print(f"Haglund buffer ISA {hb:.0f} m (M {m_hag:.3f} vs {m_fix:.3f} with 1 km); sheared worst direction {hb2:.0f} m")


def test_two_model_mean():
    """Model 2.9: the IFS columns have 13 levels, not 23; a smooth column must give nearly the same limit, and the
    mean must be 'no corridor' wherever either model has none."""
    import os
    os.environ["MC_NO_IFS"] = "1"
    import build
    IFS13 = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50]
    k = [list(PLEV).index(p) for p in IFS13]
    T, U, V, Z = column(u_of_z=lambda z: 20 * np.exp(-((z - 11000) / 4000) ** 2))
    for fl in (350, 450, 550):
        m23 = mmax_grid(PLEV, T, U, V, Z, np.zeros((1, 1)), fl, [90, 270], h_buf=1000)["M"][:, 0, 0]
        m13 = mmax_grid(PLEV[k], T[k], U[k], V[k], Z[k], np.zeros((1, 1)), fl, [90, 270], h_buf=1000)["M"][:, 0, 0]
        assert np.all(np.abs(m23 - m13) < 0.003), (fl, m23, m13)
    a, b = np.array([1.10, np.nan, 1.20]), np.array([1.12, 1.15, np.nan])
    m = build.combine(a, b)
    assert abs(m[0] - 1.11) < 1e-9 and np.isnan(m[1]) and np.isnan(m[2]), m
    Mg = np.full((2, 181, 360), 1.10); Mi = Mg + 0.004
    Mg[:, 0, 0] = np.nan; Mi[:, 0, 0] = np.nan          # neither
    Mi[1, 1, 0] = np.nan                                # one model only, one direction
    Mi[0, 2, 0] = 1.30                                  # beyond the cap
    D = np.roll(build.encode_disagreement(Mg, Mi), -180, axis=-1)
    assert D[0, 0] == 0 and D[1, 0] == 254 and D[2, 0] == 253 and D[5, 5] == 9, (D[0, 0], D[1, 0], D[2, 0], D[5, 5])
    got, r, lag, note = build.load_ifs("2026101200")
    assert got is None and r is None and "MC_NO_IFS" in note, note
    del os.environ["MC_NO_IFS"]
    print("two-model mean: 13 vs 23 levels within 0.003; no corridor if either model has none; GFS-only switch works")


def test_humid_sound_speed():
    """Model 2.10: humid-air sound speed from first principles (mixture R and cp/cv) vs the 0.51 q shortcut."""
    from physics import virtual_temperature, sound_speed
    for T, rh, p in ((303.15, 80, 1000), (298.15, 60, 925), (280.0, 90, 850)):
        es = 6.112 * np.exp(17.67 * (T - 273.15) / (T - 29.65)); e = rh / 100 * es
        q = 0.622 * e / (p - 0.378 * e)
        Rm = 287.05 * (1 - q) + 461.5 * q
        cp = 1004.7 * (1 - q) + 1870.0 * q; cv = cp - Rm
        exact = np.sqrt(cp / cv * Rm * T)
        approx = float(sound_speed(virtual_temperature(T, rh, p)))
        assert abs(exact - approx) < 0.05, (T, rh, p, exact, approx)
    print("humid sound speed: 0.51 q shortcut within 0.05 m/s of the mixture value (0.608 q overstated it ~0.3 m/s)")


def test_high_altitude_isa():
    """FL700-FL1000 (issue #53): extended ISA above 20 km (+1 K/km). Calm ISA: cutoff Mach = c(surface) / c(cruise);
    the stratosphere warms above 20 km, so the cutoff Mach falls with height: ~1.153 to FL650, 1.126 at FL1000."""
    from physics import isa_pressure_hpa, sound_speed
    assert abs(float(isa_pressure_hpa(30480)) - 10.9) < 0.1 and abs(float(isa_pressure_hpa(21336)) - 44.4) < 0.2
    plev = np.concatenate([PLEV, [40, 30, 20, 15, 10, 7, 5]]).astype(float)
    h = np.where(plev > 226.32, (1 - (plev / 1013.25) ** (1 / 5.25588)) / 2.25577e-5,
                 np.where(plev > 54.7489, 11000 - 6341.62 * np.log(plev / 226.32),
                          20000 + 216.65 * ((plev / 54.7489) ** (-1 / 34.1632) - 1) / 0.001))
    T = np.where(h < 11000, 288.15 - 0.0065 * h, np.where(h < 20000, 216.65, 216.65 + 0.001 * (h - 20000)))
    sh = lambda a: np.asarray(a, float)[:, None, None]
    out = {}
    for fl in (550, 700, 1000):
        r = mmax_grid(plev, sh(T), sh(0 * T), sh(0 * T), sh(h), np.zeros((1, 1)), fl, [90], h_buf=0.0)
        out[fl] = float(r["M"][0, 0, 0])
    expect = float(sound_speed(288.15) / sound_speed(216.65 + 0.001 * (30480 - 20000)))
    assert abs(out[1000] - expect) < 0.006, (out, expect)
    assert out[1000] < out[700] <= out[550] + 1e-3, out
    print("ISA high altitude:", {k: round(v, 3) for k, v in out.items()}, "expected FL1000", round(expect, 3))


if __name__ == "__main__":
    test_isa(); test_jet_heading(); test_lateral_rays_crosswind(); test_terrain(); test_no_corridor_is_below_one(); test_haglund_buffer()
    test_two_model_mean(); test_humid_sound_speed(); test_high_altitude_isa()
    print("all physics tests passed")
