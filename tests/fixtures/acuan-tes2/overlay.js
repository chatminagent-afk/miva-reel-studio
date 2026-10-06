// Grafik tes2 — waktu = detik di video hasil potong (timing.json). Masuk back.out 0,3 dtk, keluar fade 0,24 dtk.
const pop = (sel, t, from) => tl.fromTo(sel, Object.assign({ opacity: 0, scale: 0.6, y: 24 }, from || {}),
  { opacity: 1, scale: 1, y: 0, duration: 0.34, ease: "back.out(2.2)", immediateRender: false }, t);
const out = (sel, t) => tl.to(sel, { opacity: 0, duration: 0.24, ease: "power2.in" }, t);

// "CapCut ... pake Adobe Premiere ... aplikasi-aplikasi editing yang lain": chip muncul satu per satu, tersapu saat topik ganti
pop("#ch1", 3.30); pop("#ch2", 4.10); pop("#ch3", 5.62);
tl.to(["#ch1", "#ch2", "#ch3"], { x: -980, opacity: 0, duration: 0.36, ease: "power3.in", stagger: 0.05 }, 6.60);

// "coba Claude": kartu produk di atas kepala + flash putih bareng boom
tl.fromTo("#flash", { opacity: 0 }, { opacity: 0.3, duration: 0.05, ease: "none", immediateRender: false }, 7.97);
tl.to("#flash", { opacity: 0, duration: 0.3, ease: "power2.out" }, 8.02);
pop("#card", 7.96, { scale: 0.5, y: 40 });
out("#card", 9.75);

// "video yang kalian lagi nonton ini": viewfinder REC
tl.fromTo("#vf", { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power3.out", immediateRender: false }, 9.92);
[10.15, 10.65].forEach((t) => tl.fromTo("#recdot", { opacity: 1 }, { opacity: 0.15, duration: 0.25, ease: "none", immediateRender: false }, t));
out("#vf", 10.92);

// "bisa kasih subtitle ... motion grafik": checklist fitur
pop("#f1", 12.58, { x: -40, scale: 0.8 }); pop("#f2", 14.40, { x: -40, scale: 0.8 });
out(["#f1", "#f2"], 15.95);

// "Keren gak menurut kalian?": stiker poll, hasil terisi
pop("#poll", 17.60, { rotation: -6, scale: 0.4 });
tl.fromTo("#pf1", { width: "0%" }, { width: "82%", duration: 0.6, ease: "power2.out", immediateRender: false }, 18.15);
tl.fromTo("#pf2", { width: "0%" }, { width: "18%", duration: 0.6, ease: "power2.out", immediateRender: false }, 18.15);
tl.fromTo(["#pp1", "#pp2"], { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none", immediateRender: false }, 18.55); // seek-safe (tanpa tl.call)
out("#poll", 19.10);

// pertanyaan penutup: ajak komen
pop("#cta", 19.75, { scale: 0.7, y: 16 });
