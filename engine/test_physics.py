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


if __name__ == "__main__":
    test_isa(); test_jet_heading(); test_lateral_rays_crosswind(); test_terrain(); test_no_corridor_is_below_one(); test_haglund_buffer()
    print("all physics tests passed")
