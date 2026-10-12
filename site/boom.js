/* Loudness v0 (engine/boom.py, tested there against NASA TP-1122 and Concorde): primary-boom ground overpressure
   from Carlson's simplified method, and the FaINT bound for Mach-cutoff legs.
   dp = K_p K_R sqrt(p_v p_g) (M²−1)^(1/8) h^(−3/4) l^(3/4) K_S   (K_R 1.9, K_p 1.0; ±15% vs flight data)
   Cutoff legs: linear caustic (Airy) theory, engine/caustic.py, checked against NASA FaINT. The quiet height
   (caustic height giving 0.11 psf on the ground) and the per-leg ground psf use closed forms fitted to that model
   (study/results/caustic.json); the psf form is scaled x1.25 so it never under-predicts the model near the limit. */
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
      if (s.landish) land = Math.max(land, legPsf(s, o.ac, fl));
      else sea = Math.max(sea, psf(o.ac, s.M, fl));
    }
    return { land, sea, overland: psf(o.ac, o.ac.design, fl) };
  }
  // ---- aircraft-specific pieces (engine/aircraft_study.py) ----
  // shape factor from the lift parameter when only weight and length are known (custom aircraft):
  // K_S = max(0.06, 0.85 sqrt(K_L)), K_L = sqrt(M^2-1) W / (1.4 p_v M^2 l^2); ~15% vs Concorde and SR-71
  function shapeFactor(weight_t, length, M, fl) {
    const v = isa(fl * 100 * 0.3048), KL = Math.sqrt(M * M - 1) * weight_t * 1000 * 9.80665 / (1.4 * v.p * M * M * length * length);
    return Math.max(0.06, 0.85 * Math.sqrt(KL));
  }
  // signal length on the ground (Carlson duration x sound speed) and Haglund's safe height for it
  const R_TYP = 89000, DMDZ = -0.0064 / 500;
  function signalLength(ac, M, fl) {
    const h = fl * 100 * 0.3048, v = isa(h), g = isa(0), b2 = Math.sqrt(M * M - 1);
    const dt = 0.85 * (3.42 / v.a) * M / Math.pow(b2, 0.75) * Math.pow(h, 0.25) * Math.pow(ac.boom.length, 0.75) * ac.boom.ks;
    return dt * g.a;
  }
  const safeHeight = (ac, fl, M = 1.15) => ac.boom ? Math.cbrt(R_TYP) * Math.pow(signalLength(ac, M, fl), 2 / 3) : 1000;
  // free-field boom arriving at a turning point ~1.5 km up (no ground reflection)
  const freePsf = (ac, M, fl) => psf(ac, M, fl, 1500) / K_R;
  // caustic height above ground that gives 0.11 psf on the ground, from the same (conservative) form as shadowPsf
  const S = [1.308, 0.5662, -3.5556, 0.1023, -0.3039], S_SAFETY = 1.25;
  const qCache = new Map();                    // the router asks for every leg: memoise per aircraft and level
  function quietHeight(ac, fl, M = 1.15) {
    if (!ac.boom) return 1000;
    const key = `${ac.boom.length}|${ac.boom.ks}|${ac.weight || ""}|${fl}|${M}`;
    if (qCache.has(key)) return qCache.get(key);
    const v = quietHeightRaw(ac, fl, M); qCache.set(key, v); return v;
  }
  function quietHeightRaw(ac, fl, M) {
    const hs = safeHeight(ac, fl, M);
    let lo = 0.6 * hs, hi = 4 * hs;
    if (shadowPsf(ac, M, fl, lo) <= LIMIT) return lo;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (shadowPsf(ac, M, fl, mid) > LIMIT) lo = mid; else hi = mid; }
    return hi;
  }
  // ground psf with the caustic D metres above the ground (engine/caustic.py shadow_psf_fit, x1.25)
  function shadowPsf(ac, M, fl, D) {
    if (!ac.boom) return 0;
    const L = signalLength(ac, M, fl), r = Math.max(0.6, D / safeHeight(ac, fl, M));
    return S_SAFETY * freePsf(ac, M, fl) * Math.exp(S[0] + S[1] * Math.pow(r, 1.5) + S[2] * r + S[4] * Math.log(L / 100));
  }
  // Mach the map's 1 km floor over-promises when the quiet height is above it (never a bonus below it)
  const bufferPenalty = (ac, fl) => Math.min(0, (quietHeight(ac, fl) - 1000) * DMDZ);
  // caustic height above the highest terrain for a boomless leg: the map's limit puts it at 1 km; every 0.0128 Mach
  // flown below that limit lifts it about 1 km (DMDZ, sensitivity study)
  function legCausticHeight(s, ac, fl) {
    if (s.mcut == null || !Number.isFinite(s.margin)) return 1000;
    const mMap = s.mcut + s.margin - bufferPenalty(ac, fl);
    return 1000 + Math.max(0, mMap - s.M) / -DMDZ;
  }
  const legPsf = (s, ac, fl) => s.M <= 1 ? 0 : s.type === "boomless" ? shadowPsf(ac, s.M, fl, legCausticHeight(s, ac, fl)) : psf(ac, s.M, fl);
  return { psf, route, LIMIT, CUTOFF_MAX, shapeFactor, signalLength, safeHeight, quietHeight, shadowPsf, legCausticHeight, legPsf, bufferPenalty, isa };
})();
