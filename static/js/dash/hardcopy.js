/* =========================================================================
   画面の印刷・ハードコピー（版 3.40.0。利用者の要望 2026-10）
   いま見えている画面（窓の中身）を、そのままの見た目で 1 枚の画像（PNG）にする（capture）。その画像を
     - 画像で保存（WL.dashKit.download。デスクトップ版は窓が保存し、置いた場所を右下に知らせる）
     - 画像をコピー（クリップボード。貼り付けて報告・メールに使う。できない PC では保存に替えて知らせる）
     - 印刷（画像を用紙の向きに合わせて 1 枚に収め、上に画面の名前と日時を添える。window.print の印刷の窓）
   に使う（印刷は WaveLog の「画面を印刷」＝WL.printCore.printScreen の1箇所・§9.525。ここでは刷らない）。描き方: 画面の要素を写し（入力の値・選び・チェック・送った位置も写す）、頁の CSS と一緒に SVG の foreignObject に入れ、
   canvas に描く（外の部品・通信なし。Chromium〈WebView2〉の描き方そのもの）。canvas（3D）は、その時の絵を画像にして入れる。
   ========================================================================= */
(function(){
  let toastT = 0;      // 知らせを消すまで
  /** XML に入れられない字（制御文字・U+FFFE・U+FFFF。タブ・改行・復帰は入れられる） */
  const xmlBad = (k) => (k < 32 && k !== 9 && k !== 10 && k !== 13) || k === 0xfffe || k === 0xffff;
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  /** いま出ている画面の名前（見出しのタブの選ばれている物） */
  const screenName = () => ((document.querySelector('.tab[aria-selected="true"], [role="tab"].on, .tab.on') || {}).textContent || "").trim().replace(/\s+/g, " ") || "画面";
  // アプリの名前は見出しの名前（brand.json から。コードにじかに書かない）
  const appName = () => ((document.querySelector(".brand h1") || {}).textContent || document.title || "app").trim().split(/\s/)[0];

  /** 頁の CSS（同じ頁の物だけ。読めない物は飛ばす） */
  function pageCss() {
    return [...document.styleSheets].map((sh) => { try { return [...sh.cssRules].map((r) => r.cssText).join("\n"); } catch (_) { return ""; } }).join("\n");
  }
  /** 写しへ、元の要素の今の様子（入力の値・選び・送った位置・canvas の絵）を移す */
  function carry(src, dst) {
    const a = [src, ...src.querySelectorAll("*")], b = [dst, ...dst.querySelectorAll("*")];
    const moves = [];
    for (let i = 0; i < a.length && i < b.length; i++) {
      const s = a[i], d = b[i];
      if (s.tagName !== d.tagName) continue;
      if (s.tagName === "INPUT") {
        if (s.type === "checkbox" || s.type === "radio") { if (s.checked) d.setAttribute("checked", ""); else d.removeAttribute("checked"); }
        else d.setAttribute("value", s.value);
      } else if (s.tagName === "TEXTAREA") d.textContent = s.value;
      else if (s.tagName === "SELECT") [...d.options].forEach((o, k) => { if (s.options[k] && s.options[k].selected) o.setAttribute("selected", ""); else o.removeAttribute("selected"); });
      else if (s.tagName === "CANVAS") {
        try { const img = document.createElement("img"); img.src = s.toDataURL("image/png"); img.width = s.clientWidth; img.height = s.clientHeight; img.setAttribute("style", getComputedStyle(s).cssText || `width:${s.clientWidth}px;height:${s.clientHeight}px`); moves.push(() => d.replaceWith(img)); } catch (e) { WL.quiet.note("読めない絵は空のまま写す", e); }
      }
      // 送った位置: 中身を送った分だけずらす（写しは送れないので、子を動かして同じ所を見せる）
      if ((s.scrollTop || s.scrollLeft) && s !== document.documentElement) {
        const x = s.scrollLeft, y = s.scrollTop;
        d.style.setProperty("overflow", "hidden", "important");
        moves.push(() => [...d.children].forEach((c) => c.style.setProperty("translate", `${-x}px ${-y}px`)));
      }
    }
    moves.forEach((f) => f());
  }
  /** いまの画面 → {svg（foreignObject に写しと CSS を入れた SVG の字）, W, H} */
  function svgOf() {
    const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    const html = document.documentElement.cloneNode(true);
    carry(document.documentElement, html);
    html.querySelectorAll("script, #hcPrint, link[rel=stylesheet]").forEach((x) => x.remove());
    const style = document.createElement("style");
    style.textContent = pageCss() + `\nhtml,body{width:${W}px;height:${H}px;overflow:hidden !important;margin:0}`;
    html.querySelector("head").append(style);
    // XML に入れられない制御文字（区切りに使う \u001f など。画面の属性にある）は空白に替える（入っていると画像として読めない）
    const body = new window.XMLSerializer().serializeToString(html).split("").map((c) => (xmlBad(c.charCodeAt(0)) ? " " : c)).join("");
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="100%" height="100%">${body}</foreignObject></svg>`, W, H };
  }
  /** いまの画面 → PNG の Blob（大きさは窓の中身・表示倍率のまま）。el を渡すと、その要素の所だけを切り出す（版 3.44.0。ダッシュボードのパネル 1 枚） */
  async function capture(el = null) {
    const { svg, W, H } = svgOf(), r = window.devicePixelRatio || 1;
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const b = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: W, height: H };
    const x = Math.max(0, b.left), y = Math.max(0, b.top), w = Math.min(W, b.left + b.width) - x, h = Math.min(H, b.top + b.height) - y;
    const cv = document.createElement("canvas");
    cv.width = Math.round(w * r); cv.height = Math.round(h * r);
    const g = cv.getContext("2d");
    g.scale(r, r);
    g.fillStyle = getComputedStyle(document.body).backgroundColor || "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(img, x, y, w, h, 0, 0, w, h);
    return new Promise((ok, ng) => cv.toBlob((b) => (b ? ok(b) : ng(new Error("画像にできませんでした"))), "image/png"));
  }
  const fileName = (part = "") => `${appName()}_${(screenName() + (part ? `_${part}` : "")).replace(/[\\/:*?"<>|\s]+/g, "")}_${stamp()}.png`;
  /** 短い知らせ（下の真ん中に 4 秒。読み上げにも届く） */
  function toast(t) {
    let el = document.querySelector(".hc-toast");
    if (!el) { el = document.createElement("div"); el.className = "hc-toast"; el.setAttribute("role", "status"); document.body.append(el); }
    el.textContent = t; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function(){ el.hidden = true; }, 4000);
  }

  /** 画像で保存（el・part: 要素の所だけ・ファイルの名前に添える字） */
  async function save(el = null, part = "") {
    try { WL.dashKit.download(await capture(el), fileName(part)); } catch (e) { toast(`画面を画像にできませんでした（${e.message}）`); }
  }
  /** 画像をコピー（クリップボード）。できなければ保存に替える */
  async function copy(el = null, part = "") {
    let blob;
    try { blob = await capture(el); } catch (e) { toast(`画面を画像にできませんでした（${e.message}）`); return; }
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
      toast(`${el ? "パネル" : "画面"}の画像をコピーしました（Excel・メール・チャットに貼り付けられます）`);
    } catch (_) {
      WL.dashKit.download(blob, fileName(part));
      toast("この PC ではクリップボードに入れられなかったので、画像で保存しました");
    }
  }
  WL.hardcopy = { capture, svgOf, save, copy, fileName, toast };
})();
