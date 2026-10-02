/* 自己診断（環境変数 WAVELOG_SELFTEST=結果のファイル で起動したときだけ、窓が画面に流し込む・§9.544）。
   本物の WebView の中から、ブラウザ版と同じに動くかを確かめて /__desktop/selftest へ送る。窓は結果を書いて終わる。
   調べること: 起動が終わる・画面（Python）・部品（Rust）・連結した CSS（Python）・API・404/400・大きな日本語の本文・
   日本語の問い合わせ・40本同時・安全な文脈（クリップボード）・保存領域・端末の控え（§9.545）・保存（ダウンロード）の2つの道と
   印刷の書類の組み立て（§9.551）・速さ。印刷の窓とファイルを選ぶ窓は人が操作する窓なので、ここでは開かない（実機で確かめる）。 */
(async () => {
  const res = [];
  const ok = (name, cond, info = "") => res.push({ name, ok: !!cond, info: String(info).slice(0, 300) });
  const t0 = performance.now();
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const get = async (url, opt) => { const r = await fetch(url, opt); return { r, by: r.headers.get("X-WaveLog-By"), text: await r.text() }; };
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    // 1) 起動が終わる（起動の覆いが外れる＝画面のJSが全部読めて、一覧まで組み上がった）
    const end = performance.now() + 60000;
    while (document.documentElement.classList.contains("app-booting") && performance.now() < end) await sleep(200);
    ok("起動が終わる（起動の覆いが外れる）", !document.documentElement.classList.contains("app-booting"),
       ((performance.now() - t0) / 1000).toFixed(1) + " 秒");
    ok("画面の題（Python が作った HTML）", /測定伝送システム/.test(document.title), document.title);
    ok("画面のJSが動いている（WL・記録の層）", typeof WL === "object" && WL.records && typeof WL.records.reliableAll === "function");

    // 2) 振り分け
    const js = await get("/static/js/core/base.js?t=selftest");
    ok("部品は Rust が返す（長く使い回す）", js.by === "shell" && js.r.ok && /immutable/.test(js.r.headers.get("Cache-Control") || ""), js.by);
    const page = await get("/");
    ok("画面は Python が作る", page.by === "python" && page.r.ok, page.by);
    const css = await get("/css/app.css?t=selftest");
    ok("連結した CSS は Python が作る", css.by === "python" && css.r.ok && css.text.length > 10000, `${css.by} ${css.text.length}字`);

    // 3) API
    const b = await get("/api/build");
    ok("API が答える（/api/build）", b.r.ok && b.by === "python" && JSON.parse(b.text).version, b.text.slice(0, 80));
    const ch = await get("/api/changelog");
    ok("大きな答え（更新履歴）が欠けずに届く", ch.r.ok && JSON.parse(ch.text) && ch.text.length > 100000, ch.text.length + " 字");
    const nf = await get("/api/no-such-route");
    ok("無いところは 404", nf.r.status === 404, nf.r.status);
    const bad = await get("/api/measurement/backup", json("POST", {}));
    const why = (JSON.parse(bad.text).error || "");
    ok("誤りの答え（400 と日本語の理由）", bad.r.status === 400 && /必須/.test(why), why);

    // 4) 大きな日本語の本文（約 460KB・15.3万字）が往復する——端末の控えの設定へ重ねて読み戻す
    const big = "汚れ位置・発見設備".repeat(17000);
    const put = await get("/api/terminal/settings", json("POST", { values: { wlSelftestBigV1: big } }));
    const back = JSON.parse((await get("/api/terminal/settings")).text);
    ok("約 460KB の日本語の本文が往復する", put.r.ok && (back.values || {}).wlSelftestBigV1 === big,
       `${put.r.status} / ${((back.values || {}).wlSelftestBigV1 || "").length}`);
    await get("/api/terminal/settings", json("POST", { values: { wlSelftestBigV1: null } }));

    // 5) 日本語の問い合わせ文字
    const q = await get("/api/measurement/backup/get?id=" + encodeURIComponent("存在しない記録・日本語"));
    ok("日本語の問い合わせ文字（Python のアプリが答える）", q.by === "python" && q.r.ok && JSON.parse(q.text).item === null, q.text.slice(0, 80));

    // 6) 同時の問い合わせが混ざらない
    const paths = Array.from({ length: 40 }, (_, i) => (i % 2 ? "/api/build" : "/static/js/core/base.js?t=p" + i));
    const all = await Promise.all(paths.map((p) => get(p)));
    ok("40 本同時でも、それぞれの答えが届く", all.every((x, i) => x.r.ok && (i % 2 ? JSON.parse(x.text).version : x.by === "shell")));

    // 7) 安全な文脈・保存領域
    ok("安全な文脈（クリップボードへ写せる）", window.isSecureContext && !!(navigator.clipboard && navigator.clipboard.writeText),
       `isSecureContext=${window.isSecureContext}`);
    localStorage.setItem("wlSelftestV1", "1");
    ok("localStorage が使える", localStorage.getItem("wlSelftestV1") === "1");
    localStorage.removeItem("wlSelftestV1");
    const idb = await new Promise((done) => { const r = indexedDB.open("wlSelftest", 1); r.onsuccess = () => { r.result.close(); done(true); }; r.onerror = () => done(false); });
    ok("IndexedDB が使える", idb);

    // 8) 端末の控え（§9.545）: 記録が控えへ届き、消した印も残る
    const rec = await WL.records.terminalReconciled();
    ok("端末の控えと突き合わせられる", WL.terminalStore.enabled() && rec && !rec.error && !rec.skipped, JSON.stringify(rec));
    const id = "selftest-" + Date.now();
    await WL.records.reliablePut({ id, status: "編集中", updatedAt: new Date().toISOString(), basic: { lotNo: "SELFTEST" }, measurements: {} });
    let seen = false;
    for (let i = 0; i < 25 && !seen; i++) { await sleep(200); seen = JSON.parse((await get("/api/terminal/records")).text).items.some((x) => x.id === id); }
    ok("保存した記録が端末の控えへ届く", seen);
    await WL.records.reliableDelete(id);
    let gone = false;
    for (let i = 0; i < 25 && !gone; i++) { await sleep(200); gone = JSON.parse((await get("/api/terminal/records")).text).items.some((x) => x.id === id && x.deletedAt); }
    ok("消した記録は控えに「消した印」が残る", gone);

    // 10) 保存（ダウンロード）の2つの道（§9.551）。窓は自己診断のときだけ保存を記録し、/__desktop/downloads で答える
    const saved = async (match, ms = 20000) => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        const f = (await (await fetch("/__desktop/downloads")).json()).find((x) => x.state === "finished" && match(x));
        if (f) return f;
        await sleep(200);
      }
      return null;
    };
    //   【実験・§9.551】1本目に元の形（添付へページを移す）を試す。2本目以降は人の操作なしだと止められる疑いがあるため
    const x0 = document.createElement("a");
    x0.href = "/api/roll-master/export";
    document.body.append(x0); x0.click(); x0.remove();
    const s0 = await saved((r) => r.url.includes("/api/roll-master/export"));
    ok("【実験】1本目: 添付へページを移す形で Excel が届く", s0 && s0.success, JSON.stringify(s0));
    //   保存の答えは画面の WL.base.saveBlob／saveFrom の1箇所（CSV・フィルタ・列の設定・ログ・Excel の書き出しが通る道）
    //   ① 画面で作ったファイル（Blob）
    const blob = new Blob(["WaveLog 自己診断 保存 ✓\n".repeat(100)], { type: "text/plain;charset=utf-8" });
    WL.base.saveBlob(blob, "wl-selftest-保存.txt");
    const s1 = await saved((x) => x.url.startsWith("blob:"));
    ok("保存: 画面で作ったファイル（Blob）が名前どおり・大きさどおりに届く", s1 && s1.success && s1.bytes === blob.size
       && /wl-selftest-保存.*\.txt$/.test(s1.path || ""), JSON.stringify(s1));
    //   ② 中身（Python）が添付で返すファイル（Excel・日本語の名前は filename*）。窓の中では添付へページを移しても
    //      保存が始まらない（§9.551 で実測）ので、saveFrom は fetch で受け取って Blob から落とす
    const named = await WL.base.saveFrom("/api/roll-master/export", "export.xlsx");
    const s2 = await saved((r) => r.url.startsWith("blob:") && (r.path || "").includes("ロールマスタ"));
    ok("保存: 中身が添付で返す Excel（日本語の名前）が届く", s2 && s2.success && s2.head === "504b0304"
       && /ロールマスタ.*\.xlsx$/.test(s2.path || "") && /^ロールマスタ_.*\.xlsx$/.test(named), JSON.stringify({ named, s2 }));

    // 11) 印刷の書類の組み立て（帳票は見えない iframe へ書いて刷る・report-dashboard の rpPrintFrame と同じ形）
    const fr = document.createElement("iframe");
    fr.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm";
    document.body.append(fr);
    const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")).filter(Boolean);
    const d = fr.contentDocument;
    d.open();
    d.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8">${hrefs.map((h) => `<link rel="stylesheet" href="${h}">`).join("")}`
      + `<style>@page{size:A4 portrait;margin:8mm}</style></head><body class="rp-print-doc"><div class="rp-page">印刷の試し</div></body></html>`);
    d.close();
    const links = [...d.querySelectorAll('link[rel="stylesheet"]')];
    const loaded = await new Promise((done) => {
      let left = links.length;
      if (!left) return done(0);
      const t = setTimeout(() => done(links.length - left), 10000);
      links.forEach((l) => {
        l.addEventListener("load", () => { if (--left === 0) { clearTimeout(t); done(links.length); } });
        l.addEventListener("error", () => { clearTimeout(t); done(-1); });
      });
    });
    const w = fr.contentWindow;
    const teal = w.getComputedStyle(d.documentElement).getPropertyValue("--teal").trim();
    ok("印刷: 帳票の書類（見えない iframe）が画面と同じ CSS で組み上がり、print を呼べる",
       links.length > 0 && loaded === links.length && teal !== "" && typeof w.print === "function" && "onafterprint" in w,
       `CSS ${loaded}/${links.length} 本・--teal=${teal}`);
    fr.remove();

    // 9) 速さ（参考）: Python へ 30 回・Rust の部品 30 回の平均（ミリ秒）
    const avg = async (url) => { const s = performance.now(); for (let i = 0; i < 30; i++) await (await fetch(url)).arrayBuffer(); return (performance.now() - s) / 30; };
    const py = await avg("/api/build"), sh = await avg("/static/js/core/base.js?t=speed");
    ok("問い合わせの速さ（参考）", py < 300, `Python ${py.toFixed(1)}ms / Rust の部品 ${sh.toFixed(1)}ms`);
  } catch (e) {
    ok("例外", false, e && (e.stack || e.message || e));
  }
  const body = JSON.stringify({ ok: res.every((r) => r.ok), elapsed_ms: Math.round(performance.now() - t0), ua: navigator.userAgent, results: res });
  await fetch("/__desktop/selftest", { method: "POST", headers: { "Content-Type": "application/json" }, body });
})();
