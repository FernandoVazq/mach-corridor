"""Loudness v0 checks against published cases (issue #12)."""
from boom import carlson, lift_parameter, leg_psf, safe_cutoff_height, faint_plsel, isa, PSF


def test_carlson_sample_problems():
    # TP-1122 Sample 1: reconnaissance aircraft, M 1.99 at 15.24 km over ground at 0.76 km; printed 74 Pa, 0.17 s
    # (p_v, p_g, a_v from the 1962 standard atmosphere; K_p 1.10, K_t 0.85, K_S 0.087, K_R 2.0, l = 32.8 m)
    _, p_v, a_v = isa(15240.0)
    _, p_g, _ = isa(760.0)
    dp, dt = carlson(1.99, 15240.0 - 760.0, p_v, p_g, a_v, 32.8, 0.087, K_p=1.10, K_t=0.85, K_R=2.0)
    assert abs(dp / 74.25 - 1) < 0.03, dp
    assert abs(dt / 0.170 - 1) < 0.05, dt
    # Sample 2 lift parameter: M 2, W 353,000 N, p_v 6880 Pa, l 30 m, off-track 52 deg -> 0.0108
    import math
    assert abs(lift_parameter(2.0, 353000, 6880, 30.0) * math.cos(math.radians(52)) / 0.0108 - 1) < 0.01
    print(f"Carlson sample 1: {dp:.1f} Pa (printed 74), {dt:.3f} s (printed 0.17)")


def test_concorde():
    # NASA DFRC FS-016: Concorde, M 2 at 52,000 ft -> 1.94 psf on the ground
    psf, dt = leg_psf("concorde", 2.0, 520)
    assert abs(psf / 1.94 - 1) < 0.15, psf
    # Jaeschke et al. 2024 (Carlson, 61.7 m, 179,850 kg MTOW): M 2 at 18.5 km -> 79.7 Pa (1.66 psf); same order
    psf2, _ = leg_psf("concorde", 2.0, 18500 / 0.3048 / 100)
    assert abs(psf2 / 1.66 - 1) < 0.15, psf2
    print(f"Concorde M2 FL520: {psf:.2f} psf (measured 1.94), {dt:.2f} s; M2 18.5 km: {psf2:.2f} psf (Carlson-based 1.66)")


def test_buffer_and_faint():
    # Haglund safe height: SST signal (~0.2 s x 300 m/s) under a standard lapse (dV_P/dz ~ -0.004 /s) -> ~0.7 km
    z = safe_cutoff_height(300.0, -0.004, 0.2 * 300.0)
    assert 500 < z < 900, z
    # FaINT eq. 8 worked example: Z_CO 6000 ft, delta 0.015 -> ~71 dB; delta 0.010 -> ~86 dB
    assert abs(faint_plsel(6000 * 0.3048, 0.015) - 71) < 2
    assert abs(faint_plsel(6000 * 0.3048, 0.010) - 86) < 2
    print(f"safe cutoff height, standard lapse: {z:.0f} m; FaINT eq. 8 reproduces 71 / 86 dB")


if __name__ == "__main__":
    test_carlson_sample_problems(); test_concorde(); test_buffer_and_faint()
    print("all boom tests passed")
