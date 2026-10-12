"""Tests for the below-caustic loudness model (engine/caustic.py)."""
import math
import numpy as np
from scipy.special import airy
from caustic import shadow_signal, ground_psf, aircraft_wave, haglund, isa, depth_for, quiet_ratio, shadow_psf_fit, PSF


def test_airy_matching_reproduces_go():
    # far above the turning point the Airy solution must carry the incident GO amplitude: |C Ai(-xi)| envelope / 2
    beta, zref = 0.01, 3000.0
    C = 2 * math.sqrt(math.pi) * (beta * zref) ** 0.25
    xi = np.linspace(30, 40, 4000); env = np.max(np.abs(C * airy(-xi)[0]))
    go = (zref / (xi.mean() / beta)) ** 0.25          # GO amplitude grows as dz^(-1/4) towards the turning point
    assert abs(env / 2 - go) / go < 0.05


def test_rigid_ground_doubles_deep_shadow():
    # deep in the shadow the rigid-ground solution tends to 2 Ai
    for x, tol in ((6.0, 0.1), (20.0, 0.02)):           # asymptotic: corrections ~ x^(-3/2)
        ai, aip, bi, bip = airy(x)
        assert abs((ai - aip / bip * bi) / (2 * ai) - 1) < tol


def test_monotone_decay_and_faint_range():
    h = 37000 * 0.3048; R = 89e3
    dp, T = aircraft_wave(15, 17.1, 1.15, h, 2000); dz = haglund(R, T * isa(2000)[2])
    ps = [ground_psf(15, 17.1, 1.15, h, r * dz, R)[0] for r in (0.5, 1, 1.5, 2, 3)]
    assert all(a > b for a, b in zip(ps, ps[1:]))
    assert 0.03 <= ground_psf(15, 17.1, 1.15, h, 1.0 * dz, R)[0] <= 0.2       # FaINT 1-2 dZ_S bin: 0.03-0.09 measured
    assert ground_psf(15, 17.1, 1.15, h, 2.0 * dz, R)[0] <= 0.10                # FaINT > 2 dZ_S: <= 0.10 measured


def test_closed_forms_track_model():
    R = 89e3; h = 550 * 100 * 0.3048
    dp, T = aircraft_wave(160, 61.0, 1.15, h, 1500); sig = T * isa(1500)[2]; dz = haglund(R, sig)
    d = depth_for(160, 61.0, 1.15, h, R, 0.11)
    assert d / dz <= quiet_ratio(dp / PSF, R, sig) <= d / dz + 0.1                # fit + 0.05 is conservative
    for r in (1.0, 1.5):
        assert shadow_psf_fit(dp / PSF, r, R, sig) >= ground_psf(160, 61.0, 1.15, h, r * dz, R)[0]


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"): f(); print("ok", n)
