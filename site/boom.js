/* Loudness v0 (engine/boom.py, tested there against NASA TP-1122 and Concorde): primary-boom ground overpressure
   from Carlson's simplified method, and the FaINT bound for Mach-cutoff legs.
   dp = K_p K_R sqrt(p_v p_g) (M²−1)^(1/8) h^(−3/4) l^(3/4) K_S   (K_R 1.9, K_p 1.0; ±15% vs flight data)
   Cutoff legs: NASA FaINT measured 0.01–0.09 psf on the ground with the caustic at least one Haglund safe
   height above it; with the 1 km buffer plus margin that holds on every land column checked (study/buffer_check.py). */
window.BOOM = (() => {
  const PSF = 47.880258, K_R = 1.9, LIMIT = 0.11, CUTOFF_MAX = 0.09;
  function isa(h) {
    if (h < 11000) { const T = 288.15 - 0.0065 * h; return { p: 101325 * Math.pow(T / 288.15, 5.25588), a: Math.sqrt(1.4 * 287.05 * T) }; }
    return { p: 22632.1 * Math.exp(-(h - 11000) / 6341.62), a: Math.sqrt(1.4 * 287.05 * 216.65) };
  }
  // psf of the primary boom on track, aircraft at Mach M and flight level fl over ground at ground_m
  function psf(ac, M, fl, ground_m = 0) {
    if (!ac.boom || M <= 1.0) return 0;
    const h = fl * 100 * 0.3048, v = isa(h), g = isa(ground_m), b = Math.sqrt(M * M - 1);
    const dp = K_R * Math.sqrt(v.p * g.p) * Math.pow(b, 0.25) * Math.pow(h - ground_m, -0.75) * Math.pow(ac.boom.length, 0.75) * ac.boom.ks;
    return dp / PSF;
  }
  // per-route summary from evaluated segments
  function route(o, fl) {
    let land = 0, sea = 0;
    for (const s of o.segs) {
      if (s.M <= 1) continue;
      if (s.landish) land = Math.max(land, s.type === "boomless" ? CUTOFF_MAX : psf(o.ac, s.M, fl));
      else sea = Math.max(sea, psf(o.ac, s.M, fl));
    }
    return { land, sea, overland: psf(o.ac, o.ac.design, fl) };
  }
  return { psf, route, LIMIT, CUTOFF_MAX };
})();
