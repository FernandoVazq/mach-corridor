"""
Sonic-boom ray tracing in a stratified, moving atmosphere (Hamiltonian ray acoustics).

Dispersion relation for sound in wind w(z) = (u, v, 0):   omega = c(z) |k| + w(z)·k
Ray equations (t = time, x = position, k = wavenumber):
    dx/dt =  c k/|k| + w
    dk/dt = -(dc/dz |k| + du/dz k_x + dv/dz k_y) z_hat
omega and the horizontal wavenumber are constant along a ray, so the trace velocity along the
ray's horizontal direction e,  V_t = omega / |k_h| = c/cos(theta) + w·e,  is conserved (Snell).
The ray turns where c + w·e = V_t; mmax_grid in physics.py is built on exactly that condition.

Launch: aircraft at height z_a flying with air-relative Mach M along heading psi. A shock-front
normal n leaving the Mach cone at azimuth alpha off track satisfies  M c_a cos(alpha) cos(theta) = 1.
"""
import math
import numpy as np


class Profile:
    """Piecewise-linear column c(z), u(z), v(z); z ascending (m). Or pass functions returning
    (c, u, v, dc, du, dv) for analytic tests via Profile.from_functions."""

    def __init__(self, z, c, u=None, v=None):
        o = np.argsort(z)
        self.z = np.asarray(z, float)[o]
        self.c = np.asarray(c, float)[o]
        self.u = np.zeros_like(self.c) if u is None else np.asarray(u, float)[o]
        self.v = np.zeros_like(self.c) if v is None else np.asarray(v, float)[o]
        self.f = None

    @classmethod
    def from_functions(cls, f):
        p = cls.__new__(cls)
        p.f = f
        return p

    def __call__(self, z):
        if self.f is not None:
            return self.f(z)
        zz = self.z
        i = int(np.clip(np.searchsorted(zz, z) - 1, 0, len(zz) - 2))
        h = zz[i + 1] - zz[i]
        w = (z - zz[i]) / h
        out = []
        for a in (self.c, self.u, self.v):
            out.append(a[i] + w * (a[i + 1] - a[i]))
        for a in (self.c, self.u, self.v):
            out.append((a[i + 1] - a[i]) / h)
        return tuple(out)


def launch(prof, z_a, M, psi_deg, alpha_deg):
    """Initial state [x, y, z, kx, ky, kz] (|k| = 1) for the downward front at azimuth alpha."""
    c_a = prof(z_a)[0]
    ca = math.cos(math.radians(alpha_deg))
    if M * ca < 1.0:
        raise ValueError("alpha outside the Mach cone")
    cos_t = 1.0 / (M * ca)
    sin_t = math.sqrt(1.0 - cos_t * cos_t)
    az = math.radians(psi_deg + alpha_deg)                  # horizontal direction of the front normal
    ex, ey = math.sin(az), math.cos(az)                     # x east, y north
    return np.array([0.0, 0.0, z_a, cos_t * ex, cos_t * ey, -sin_t]), c_a


def _rhs(prof, s):
    c, u, v, dc, du, dv = prof(s[2])
    kx, ky, kz = s[3], s[4], s[5]
    K = math.sqrt(kx * kx + ky * ky + kz * kz)
    return np.array([c * kx / K + u, c * ky / K + v, c * kz / K, 0.0, 0.0, -(dc * K + du * kx + dv * ky)])


def omega(prof, s):
    c, u, v, *_ = prof(s[2])
    K = math.sqrt(s[3] ** 2 + s[4] ** 2 + s[5] ** 2)
    return c * K + u * s[3] + v * s[4]


def trace(prof, z_a, M, psi_deg=0.0, alpha_deg=0.0, z_floor=0.0, dt=0.05, t_max=1500.0):
    """RK4 integration until the ray reaches z_floor or turns and climbs back to z_a.
    Returns dict(t, x, y, z, kz arrays, ground (bool), z_turn (lowest height), t_end, c_a)."""
    s, c_a = launch(prof, z_a, M, psi_deg, alpha_deg)
    T, P = [0.0], [s.copy()]
    t, ground = 0.0, False
    while t < t_max:
        k1 = _rhs(prof, s)
        k2 = _rhs(prof, s + 0.5 * dt * k1)
        k3 = _rhs(prof, s + 0.5 * dt * k2)
        k4 = _rhs(prof, s + dt * k3)
        n = s + dt / 6.0 * (k1 + 2 * k2 + 2 * k3 + k4)
        if n[2] <= z_floor:                                 # cut the last step at the floor (linear)
            f = (s[2] - z_floor) / (s[2] - n[2])
            n = s + f * (n - s)
            t += f * dt
            T.append(t); P.append(n)
            ground = True
            break
        t += dt
        s = n
        T.append(t); P.append(s.copy())
        if s[5] > 0 and s[2] >= z_a:                        # turned and back at cruise height
            break
    P = np.array(P)
    return {"t": np.array(T), "x": P[:, 0], "y": P[:, 1], "z": P[:, 2], "kz": P[:, 5], "state": P,
            "ground": ground, "z_turn": float(P[:, 2].min()), "t_end": T[-1], "c_a": c_a}


def column_profile(plev, T, U, V, Z, RH=None):
    """Profile from pressure-level arrays (1-D, any order) with the same sound speed as physics.py."""
    from physics import sound_speed, virtual_temperature
    T = np.asarray(T, float)
    if RH is not None:
        T = virtual_temperature(T, np.asarray(RH, float), np.asarray(plev, float))
    return Profile(Z, sound_speed(T), U, V)
