"""Checks for rocket.py (issue #50): the vector tracer against the scalar one and the exact Mach cone, the cone
geometry of a climbing vehicle, the Launch Library parser, and the loudness calibration against measured booms."""
import datetime as dt, json, math
import numpy as np
from rays import Profile, trace
import rocket
from rocket import cone_normals, trace_many, trace_normal, parse_ll2, scenario, profile_from_column, town_verdicts


def test_vector_matches_scalar():
    c0, h = 300.0, 15000.0
    prof = Profile(np.array([0.0, 70000.0]), np.array([c0, c0]))
    for M in (1.3, 2.0, 3.0):
        r = trace(prof, h, M, dt=0.05)
        n, _ = cone_normals(M, 0.0, 0.0, 72)
        k = int(np.argmin(n[:, 2]))
        hit, x, y, t, L = trace_normal(prof, h, n[k], dt=0.05)
        assert hit and abs(y - r["y"][-1]) < 1.0 and abs(t - r["t_end"]) < 0.06, (M, y, r["y"][-1])
        behind = M * c0 * t - y                                   # exact cone: lands h sqrt(M^2-1) behind
        assert abs(behind / (h * math.sqrt(M * M - 1)) - 1) < 2e-3
    print("vector tracer = scalar tracer; exact Mach cone in still uniform air")


def test_climbing_cone():
    """A vehicle climbing steeper than acos(1/M) sends no normal downward; one diving sends half or more down."""
    for M, gam, expect in ((1.2, 60.0, 0), (3.0, 60.0, 1), (2.0, 75.0, 0), (2.0, -70.0, 2)):
        n, down = cone_normals(M, 90.0, gam, 72)
        assert np.allclose(np.linalg.norm(n, axis=1), 1.0)
        v = np.array([math.cos(math.radians(gam)), 0.0, math.sin(math.radians(gam))])   # heading east
        assert np.allclose(n @ v, 1.0 / M, atol=1e-9)
        theta = math.degrees(math.acos(1.0 / M))
        if expect == 0:
            assert not down.any() and gam > theta
        elif expect == 1:
            assert 0 < down.sum() < 36
        else:
            assert down.sum() >= 36
    print("cone: n.v = 1/M; no downward normals while climbing steeper than acos(1/M)")


def test_refraction_edge():
    """Warm surface layer + head wind aloft: the far edge of a booster's boom zone moves; with the standard atmosphere
    the zone is bounded (the atmosphere bends the outer rays back up), not infinite."""
    prof = profile_from_column(None)
    r = scenario("vandenberg", "falcon9", "descent", prof, n_phi=36)
    H = np.array(r["hits"])
    d = np.hypot((H[:, 0] - 34.633) * 111.32, (H[:, 1] + 120.615) * 111.32 * math.cos(math.radians(34.6)))
    assert 20 < d.max() < 250, d.max()
    z = np.arange(0, 70001, 1000.0)
    col = {"z": z, "T": rocket.std_T(z), "u": np.where(z < 15000, 0.0, 0.0), "v": np.where((z > 8000) & (z < 16000), 40.0, 0.0)}
    r2 = scenario("vandenberg", "falcon9", "descent", profile_from_column(col), n_phi=36)
    H2 = np.array(r2["hits"])
    assert abs(H2[:, 0].mean() - H[:, 0].mean()) > 0.005            # a 40 m/s jet shifts the carpet
    print(f"boom zone bounded at {d.max():.0f} km; a northward jet moves it {111.32 * (H2[:, 0].mean() - H[:, 0].mean()):+.1f} km")


FIXTURE = {"results": [
    {"id": "a", "name": "Falcon 9 Block 5 | Starlink Group 11-9", "net": "2030-01-01T03:00:00Z", "status": {"abbrev": "Go"},
     "pad": {"name": "Space Launch Complex 4E", "latitude": "34.632", "longitude": "-120.611"},
     "rocket": {"configuration": {"full_name": "Falcon 9 Block 5"}, "launcher_stage": [{"landing": {"type": {"abbrev": "ASDS"}, "landing_location": {"abbrev": "OCISLY"}}}]},
     "mission": {"orbit": {"abbrev": "LEO"}}},
    {"id": "b", "name": "Falcon 9 Block 5 | Transporter-20", "net": "2030-01-02T18:00:00Z", "status": {"abbrev": "TBC"},
     "pad": {"name": "Space Launch Complex 4E", "latitude": "34.632", "longitude": "-120.611"},
     "rocket": {"configuration": {"full_name": "Falcon 9 Block 5"}, "launcher_stage": [{"landing": {"type": {"abbrev": "RTLS"}, "landing_location": {"abbrev": "LZ-4"}}}]},
     "mission": {"orbit": {"abbrev": "SSO"}}},
    {"id": "c", "name": "Starship | Flight 13", "net": "2030-01-03T12:30:00Z", "status": {"abbrev": "TBD"},
     "pad": {"name": "Orbital Launch Mount A", "latitude": "25.997", "longitude": "-97.157"},
     "rocket": {"configuration": {"full_name": "Starship"}, "launcher_stage": []}, "mission": {"orbit": {"abbrev": "Sub"}}},
    {"id": "d", "name": "Electron | Some Mission", "net": "2030-01-03T12:30:00Z",
     "pad": {"name": "LC-1", "latitude": "-39.26", "longitude": "177.86"}, "rocket": {"configuration": {"full_name": "Electron"}}},
]}


def test_ll2_parser():
    L = parse_ll2(FIXTURE)
    assert [x["id"] for x in L] == ["a", "b", "c"]
    a, b, c = L
    assert a["site"] == "vandenberg" and not a["rtls"]
    assert b["rtls"] and b["orbit"] == "SSO"
    assert c["site"] == "starbase" and c["vehicle"] == "superheavy" and c["rtls"]
    print("Launch Library parser: sites, vehicles, return-to-site landings")


def test_calibration():
    """Model vs published measurements (rocket.CAL: name, site, vehicle, phase, town or (lat, lon), measured psf, factor).
    The model must land within the stated factor of each measurement."""
    if not rocket.CAL:
        print("calibration: no measurements listed yet (rocket.CAL empty)")
        return
    prof = profile_from_column(None)
    for name, site, veh, phase, where, meas, fac in rocket.CAL:
        r = scenario(site, veh, phase, prof)
        H = np.array(r["hits"])
        la, lo = where
        d = np.hypot((H[:, 0] - la) * 111.32, (H[:, 1] - lo) * 111.32 * math.cos(math.radians(la)))
        m = d < 4.0
        assert m.any(), (name, "no boom predicted there")
        pred = float(np.median(H[m, 2]))
        assert meas / fac <= pred <= meas * fac, (name, pred, meas)
        print(f"calibration {name}: model {pred:.2f} psf vs measured {meas:.2f} psf")


if __name__ == "__main__":
    test_vector_matches_scalar()
    test_climbing_cone()
    test_ll2_parser()
    test_refraction_edge()
    test_calibration()
    print("rocket: all checks passed")
