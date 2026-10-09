/* Aircraft performance & cost assumptions. Sources: docs/ECONOMICS_SOURCES.md.
   Fuel per nautical mile = k / E(M), where E(M) is a relative efficiency (∝ M·L/D / TSFC),
   anchored at one sourced point per aircraft. E(M) shapes between anchors are estimates (L):
   the transonic dip reproduces DLR's finding that Mach-cutoff speeds (~M1.15) cost ~1.2x
   fuel per nm vs M0.95 (Liebhardt et al. 2021). */
window.AIRCRAFT = (() => {
  const mk = (o) => {
    const pts = o.E;
    o.eff = M => {
      if (M <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) if (M <= pts[i][0]) {
        const [m0, e0] = pts[i - 1], [m1, e1] = pts[i];
        return e0 + (e1 - e0) * (M - m0) / (m1 - m0);
      }
      return pts[pts.length - 1][1];
    };
    o.fuelPerNm = M => o.k / o.eff(M);
    return o;
  };
  return [
    mk({
      id: "overture", name: "Boom Overture (planned)", seats: 65, design: 1.7, sub: 0.94, supersonic: true,
      fl: 550, rangeNm: 4250, nonFuelPerBH: 8700,
      // anchor: ICCT 2022 7–9x subsonic fuel per seat-km (8x of 787-9 0.0199 kg/seat-km) at M1.7 → 19.2 kg/nm
      k: 19.2 * 15.3, E: [[0.85, 12.0], [0.95, 12.4], [1.05, 11.0], [1.15, 10.3], [1.3, 11.5], [1.5, 13.6], [1.7, 15.3]],
      note: "M1.7 over water; seats 60–80; fuel not published → ICCT 8× subsonic per seat-km (L); non-fuel cost 1.5× widebody (L)",
    }),
    mk({
      id: "concorde", name: "Concorde (historic)", seats: 100, design: 2.0, sub: 0.95, supersonic: true,
      fl: 550, rangeNm: 3360, nonFuelPerBH: 11600,
      // anchor: 20.5 t/h at M2.0 (BA), TAS ≈ 1,147 kt → 17.9 kg/nm; L/D 12 @M0.95, 7.5 @M2 (Orlebar)
      k: 17.9 * 12.8, E: [[0.85, 11.5], [0.95, 12.0], [1.05, 9.6], [1.15, 8.4], [1.3, 8.9], [1.5, 10.2], [1.7, 11.4], [2.0, 12.8]],
      note: "20.5 t/h at M2 (BA, H); E(M) between anchors estimated (L); non-fuel cost 2× widebody (L)",
    }),
    mk({
      id: "as2", name: "Aerion AS2 (cancelled bizjet)", seats: 10, design: 1.4, sub: 0.95, supersonic: true,
      fl: 450, rangeNm: 4200, nonFuelPerBH: 5000,
      // anchor: ICCT 2022 15-seat M1.4 jet 7–9x per seat-km → 8x · 0.0199 · 10 seats → 2.95 kg/nm
      k: 2.95 * 11.2, E: [[0.85, 11.0], [0.95, 11.5], [1.05, 10.2], [1.15, 9.6], [1.3, 10.6], [1.4, 11.2]],
      note: "Designed for boomless M1.1–1.2; fuel not published → ICCT ratio (L)",
    }),
    mk({
      id: "nplus3", name: "SST concept (NASA N+3 goal)", seats: 120, design: 1.6, sub: 0.95, supersonic: true,
      fl: 500, rangeNm: 5000, nonFuelPerBH: 7500,
      // anchor: NASA N+3 goal 3.5–4.5 pax-mi/lb → 4 pax-mi/lb → 15.7 kg/nm for 120 seats at M1.6 (aspirational)
      k: 15.7 * 14.0, E: [[0.85, 12.5], [0.95, 13.0], [1.05, 12.0], [1.15, 11.6], [1.3, 12.4], [1.6, 14.0]],
      note: "Aspirational efficiency goal, not a real aircraft (L)",
    }),
    mk({
      id: "b789", name: "Boeing 787-9 (subsonic baseline)", seats: 296, design: 0.85, sub: 0.85, supersonic: false,
      fl: 400, rangeNm: 7500, nonFuelPerBH: 5800,
      k: 10.7 * 12.0, E: [[0.85, 12.0]],
      note: "5.77 kg/km at 3,350 nm (H); non-fuel $4,325/bh 2016 ×1.35 (M)",
    }),
    mk({
      id: "a321lr", name: "Airbus A321LR (subsonic baseline)", seats: 154, design: 0.78, sub: 0.78, supersonic: false,
      fl: 370, rangeNm: 4000, nonFuelPerBH: 3000,
      k: 5.54 * 12.0, E: [[0.78, 12.0]],
      note: "2.99 kg/km (M); non-fuel cost estimate (L)",
    }),
  ];
})();
