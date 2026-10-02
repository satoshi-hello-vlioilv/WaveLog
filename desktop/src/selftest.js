/* 自己診断（環境変数 WAVELOG_SELFTEST=結果のファイル で起動したときだけ、窓が画面に流し込む・§9.544）。
   本物の WebView の中から、ブラウザ版と同じに動くかを確かめて /__desktop/selftest へ送る。窓は結果を書いて終わる。
   調べること: 起動が終わる・画面（Python）・部品（Rust）・連結した CSS（Python）・API・404/400・大きな日本語の本文・
   日本語の問い合わせ・40本同時・安全な文脈（クリップボード）・保存領域・端末の控え（§9.545）・速さ。 */
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
