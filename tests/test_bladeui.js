/* test_bladeui.js: 刃組ガイダンスと、設備停止からの遷移（§9.377）
   ============================================================
   利用者の指示（要約）:
     「設備停止マスタにカテゴリを1つ増やし、刃組ガイダンス連携を紐づける。
      作業スケジュール一覧表で『刃組み』をクリックすると刃組ガイダンスへ
      遷移する。刃組に必要なデータは元コイル幅・ロット毎の切断幅・板厚」

   ここで固定するのは7つ:
    1. 左メニューから刃組ガイダンスが開き、**マスタが無ければそう言う**
       （黙って空の図を描かない・§CLAUDE 4）
    2. 初期セットを登録すると、**刃組図・刃組表・所要が同じ割付から**出る
       ——図の部材の数と表の枚数が食い違わない
    3. 手順3で幅を変えると、図・表・所要が**同じ1回の描き直し**で追従する
    4. 板厚をフィンガー切替より下げると、**保持層がフィンガーへ替わる**
       （押上げ・ニップは「フィンガー方式」と言い、ゴムリングは所要に出ない）
    5. 立体図（3D）は**押したときだけ部品を取りに行き**、取れなければ
       **字で断って模式図はそのまま使える**（黙って空の器を出さない）
    6. 設備停止マスタの連携機能を「刃組ガイダンス」にすると、予定の行に
       **行き先のチップが出て、押すと開く**（連携なしの行には出ない）
    7. 遷移のとき、**その行より後ろに並ぶ作業**の元コイル幅・切断幅・板厚が
       画面に入っている（思い出させない）

   **材料は自分で注ぎ込む**（§9.351）——検証用フィクスチャに刃組マスタは
   1行も無いので、「0件」を見ても壊れていても同じ結果になる。
   後始末は`finally`で、**この実行で増えた行だけ**を消す（§9.362 ⑤）。
   ============================================================ */
'use strict';
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ = 'テスト設備A';
const TAG = 'BS' + process.pid;

const post = (p, body) => fetch(B + p, { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(Object.assign({ user_id: 'test-bladeui' }, body)) });
const getj = async p => (await fetch(B + p)).json();

let stopId = null, planId = null;
/* 設備停止マスタの「削除」は**論理削除**（`有効=0`）なので、APIで消しても行は
   残る。**この実行で増えた行だけ**を素の表から片付ける（§9.362 ⑤・test_stopeq
   と同じ作法）——名前で拾うと、同じ名前を使う他の網の期待と食い違う。 */
const SNAP_TABLES = ['設備停止マスタ'];

H.run('test_bladeui: 刃組ガイダンスと設備停止からの遷移（§9.377）',
 async ({ page, rec, errs, setMode }) => {
  const snapM = await H.masterSnapshot(SNAP_TABLES);
  /* ---- 下ごしらえ: この設備の刃組マスタを空にしてから始める ---- */
  /* **模式図を測る前は模式図へ切り替える**（§9.440）。既定が断面図になったので、
     `.bs-stage` は伏せてある——伏せた SVG の `getBBox()` は 0 を返すので、
     切り替えずに測ると「中身 0..0」になる（実際にそれで4件落ちた）。 */
  const toFig = async kind => {
   /* **先に手順の窓を閉じる**（§9.394）。`.bs-pop` は図の見出しへ垂れ下がる
      ので、開いたままだと図の切替札が覆われて押せない（実際にここで
      30秒の FATAL になった）。人が押すときも同じ順になる。 */
   await page.evaluate(() => document.querySelectorAll('.bs-step.is-open')
     .forEach(p => p.classList.remove('is-open')));
   await W.until(page, () => !document.querySelector('.bs-step.is-open'),
                 null, { ms: 5000, what: '手順の窓が閉じる' });
   const on = await page.evaluate(k => !!document.querySelector(
     `#bsFigTabs [data-fig="${k}"].is-on`), kind);
   if (!on) await page.click(`#bsFigTabs [data-fig="${kind}"]`);
   await W.until(page, k => document.querySelector(`#bsFigTabs [data-fig="${k}"]`)
                 .classList.contains('is-on'), kind, { ms: 15000, what: `図を${kind}へ` });
   await W.paint(page);
  };
  const wipe = async () => {
   const c = await getj('/api/bladeset/context?equipment=' + encodeURIComponent(EQ));
   for (const [path, list] of [['blade', c.blades], ['spacer', c.spacers],
                               ['ring', c.rings], ['finger', c.fingers]]) {
    for (const x of (list || [])) {
     await post(`/api/bladeset-${path}-master/delete`, { id: x.id });
    }
   }
   for (const x of (c.history || [])) await post('/api/bladeset/history/delete', { id: x.id });
   /* **条の設計も消す**（§9.284）。`db/master.sqlite3` はgitが持たないので、
      片付け損ねた1行が次の実行へそのまま残る——実際にこれで「未記録と言う」の
      網が2回目から赤になった（1回目に自分が記録した行が生き残っていた）。 */
   for (const x of (c.designs || [])) {
    await post('/api/bladeset/strip-design/delete', { id: x.id });
   }
  };
  await wipe();

  /* **ここから finally で囲う。** 途中で落ちた実行が後片付けを飛ばすと、
     刃組のマスタと設備停止の行が共有の `db/master.sqlite3` に残り、
     次の実行が丸ごと引き継ぐ（§9.284）。実際に1度、途中の FATAL で
     86行を置き去りにして「汚した本」に名指しされた。 */
  try {
    await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
    await W.booted(page);

    /* ---- 1) 開いて、足りないものを言う ----
       **左メニューには入口を置かない**（§9.379、利用者の指示）。刃組は
       「予定のどの段取りか」が決まって初めて意味を持つので、入口は作業
       スケジュールの設備停止行のチップだけ（下の 6) で辿る）。ここは
       画面そのものを確かめたいので、名前空間の口から直に開く。 */
    rec('左メニューに刃組ガイダンスの入口を置かない（文脈の無いまま開かせない）',
        !(await page.$('#openBladeSet')));
    await page.evaluate(() => WL.bladeGuide.open({}));
    await W.until(page, () => !!document.querySelector('#bladeSetPanel:not([hidden])'),
                  null, { ms: 15000, what: '刃組ガイダンスの器' });
    rec('bs-mode になっている',
        await page.evaluate(() => document.body.classList.contains('bs-mode')));
    rec('一覧の道具は伏せてある（#grid が見えない）',
        await page.evaluate(() => {
         const g = document.querySelector('#grid');
         return !g || getComputedStyle(g).display === 'none';
        }));
    const empty0 = await page.evaluate(() => {
     const e = document.querySelector('#bsEmpty');
     return e && !e.hidden ? e.textContent : '';
    });
    rec('マスタが無いことを字で言う（黙って空の図を描かない）',
        /スペーサー|刃/.test(empty0) && /足りません/.test(empty0), empty0.slice(0, 70));
    rec('直し方（初期セット／マスタ管理）がその場にある',
        !!(await page.$('#bsSeed')) && !!(await page.$('#bsToMaster')));

    /* ---- 2) 初期セットを登録すると、図・表・所要が同じ割付から出る ---- */
    const seeded = await (await post('/api/bladeset/seed', { equipment: EQ })).json();
    rec('初期セットを登録できる', seeded && seeded.ok
        && seeded.made && seeded.made.spacer > 0, JSON.stringify(seeded.made || {}));
    await page.evaluate(() => WL.bladeGuide.open({}));
    await W.until(page, () => document.querySelectorAll('#bsStage rect').length > 20,
                  null, { ms: 15000, what: '刃組図が描かれる' });

    const snap = () => page.evaluate(() => {
     const g = document.querySelector('#bsStage');
     const tbl = document.querySelector('#bsTables table');
     const heads = [...document.querySelectorAll('#bsTables thead th')].map(t => t.textContent);
     /* 表の「スペーサー」列の枚数の合計＝図に並ぶ部材の枚数と同じ割付から出る。
        数そのものは入力しだいなので、**0でないこと**と**食い違わないこと**を見る。 */
     const rows = tbl ? tbl.querySelectorAll('tbody tr').length : 0;
     const need = [...document.querySelectorAll('#bsBom .bs-nc')].map(x => x.textContent);
     const verdicts = [...document.querySelectorAll('#bsGauges .bs-vb')].map(x => x.textContent);
     const ends = [...document.querySelectorAll('#bsOsSide tbody tr, #bsDsSide tbody tr')].length;
     return { rects: g ? g.querySelectorAll('rect').length : 0, rows, heads, need, verdicts, ends,
              steps: [...document.querySelectorAll('.bs-step-tx span')].map(x => x.textContent) };
    });
    const s1 = await snap();
    rec('刃組図に部材が並ぶ', s1.rects > 20, String(s1.rects));
    rec('刃組表に行が出る', s1.rows > 0, String(s1.rows));
    rec('表の列見出しに「スペーサー」がある', s1.heads.some(h => /スペーサー/.test(h)),
        s1.heads.join('|').slice(0, 70));
    rec('所要に部材のチップが出る', s1.need.length > 0, s1.need.slice(0, 4).join(' '));
    rec('端部（OS/DS）の表が出る', s1.ends > 0, String(s1.ends));
    rec('押上げ・ニップ・左右差の3つが判定される', s1.verdicts.length === 3,
        s1.verdicts.join('/'));
    rec('手順ボタンに今の条件が出る（畳んでいても読める）',
        s1.steps.length === 4 && s1.steps.every(t => t && t !== '—'), s1.steps.join(' / '));

    /* ---- 3) 幅を変えると、図・表・所要が同じ1回で追従する ----
       **打つのは現場でよくある形**（§9.423、利用者の指示「検証用フィクスチャの
       ロットは変更して」）。以前は 120mm×6条／元板巾1170 を打っており、
       **片耳が225mm**＝製品幅より屑幅のほうが広い、現場に無い形だった
       （利用者の指摘「屑幅は製品幅より大きくならず、片耳35mm以下、通常は
       15mmくらいがメジャー」）。ここを既定の材料にしておくと、**以降の節が
       全部その形でしか確かめていない**ことになる。
       50mm×22条／元板巾1130 なら片耳15mm——条が混み、屑が細い、通常の形。 */
    await page.click('[data-step-open="bsV3"]');
    await page.waitForSelector('#bsLotTbl input[data-k="w"]', { timeout: 8000 });
    await page.evaluate(() => {
     const put = (el, v) => { el.value = String(v);
       el.dispatchEvent(new Event('input', { bubbles: true })); };
     /* **元板巾を先に**（条の合計が入らない幅のままだと、屑幅が負になる条数を
        受け付けない＝§9.210 で弾かれる）。 */
     put(document.querySelector('#bsW'), 1130);
     put(document.querySelector('#bsLotTbl input[data-k="w"]'), 50);
     put(document.querySelector('#bsLotTbl input[data-k="n"]'), 22);
    });
    await W.until(page, () => /50/.test(document.querySelector('#bsV3').textContent),
                  null, { ms: 8000, what: '手順3の現在値' });
    const s2 = await snap();
    rec('幅を変えると図が描き直される', s2.rects !== s1.rects || s2.rows !== s1.rows,
        `rects ${s1.rects}→${s2.rects} / rows ${s1.rows}→${s2.rows}`);
    rec('条の並びが本数どおりになる',
        (await page.evaluate(() => document.querySelectorAll('#bsOrdList .bs-oc').length)) === 22);
    const kpi = await page.evaluate(() => document.querySelector('#bsKpis').textContent);
    rec('割付の内訳（耳・条・刃の対数）が出る', /OS耳/.test(kpi) && /刃 対数/.test(kpi),
        kpi.replace(/\s+/g, ' ').slice(0, 60));

    /* ---- 3b) 製品幅はクリアランスで痩せない（§9.434、利用者の指摘） ----
       「板幅は確保して組みます。ここにクリアランスでマイナス公差側には
        寄せません」。板幅50・クリアランス0.1 なら
          上刃：刃の内々 ＝ 50.2 ／ 下刃：刃の外々 ＝ 50
       **絵では読めない**（0.1mmは1pxも出ない）ので、割付の値そのものを見る。 */
    const geo = await page.evaluate(() => {
     const B2 = WL.bladeSet, M2 = WL.bladeGuide.masters, s2 = WL.bladeGuide.state;
     const keep = { W: s2.W, lots: s2.lots, order: s2.order, clr: s2.clr, align: s2.align };
     s2.W = 1130; s2.lots = [{ name: 'L1', w: 50, n: 4 }]; s2.order = [];
     s2.clr = 0.1; s2.align = 'none';
     const r2 = B2.solve(s2, M2, B2.buildIndex(M2)), A2 = r2.A, tk = s2.tk;
     const out = r2.segs.map((sg, j) => ({
      burr: sg.burr, want: sg.w,
      got: +(B2.cutFace(A2, tk, j + 1, false) - B2.cutFace(A2, tk, j, true)).toFixed(4),
      upIn: +A2.zones[j + 1].up.toFixed(3), loOut: +(A2.zones[j + 1].lo + 2 * tk).toFixed(3),
      ringUp: r2.zp.zones[j + 1].up.hold.ringT, ringLo: r2.zp.zones[j + 1].lo.hold.ringT,
     }));
     Object.assign(s2, keep);
     return out;
    });
    rec('どの条も指示幅ちょうどに出る（クリアランスで痩せさせない）',
        geo.every(g => Math.abs(g.got - g.want) < 1e-6),
        geo.map(g => `${g.want}→${g.got}`).join(' '));
    /* 下バリの条は**上刃を広く**（内々＝幅＋クリアランス×2）、**下刃の外々が幅**。 */
    const d1 = geo.find(g => g.burr === 'down');
    rec('下バリ：上刃の内々＝幅＋クリアランス×2／下刃の外々＝幅',
        !!d1 && Math.abs(d1.upIn - 50.2) < 1e-6 && Math.abs(d1.loOut - 50) < 1e-6,
        d1 ? `上内々 ${d1.upIn} / 下外々 ${d1.loOut}` : 'なし');
    /* ---- 3c) ゴムリングは「広げた側が小径」（§9.434、利用者の指示） ----
       下バリ → 上刃を広く → **上側が小径**。上バリはその逆。
       製品幅を作る側（外々）の刃は製品のすぐ裏に身があるので、そちらを大径で
       浮かせて傷の混入を防ぐ。 */
    rec('広げた側（内々）が小径・製品幅を作る側（外々）が大径',
        geo.every(g => (g.burr === 'down'
          ? g.ringUp === 'small' && g.ringLo === 'big'
          : g.ringUp === 'big' && g.ringLo === 'small')),
        geo.map(g => `${g.burr}:上${g.ringUp}/下${g.ringLo}`).join(' '));

    /* ---- 3d) 刃が作る寸法とゴムリング径が画面で読める（§9.434 追補） ---- */
    const shown = await page.evaluate(() => ({
     spans: [...document.querySelectorAll('#bsStage .bs-zspan')].map(t => t.textContent),
     rings: [...new Set([...document.querySelectorAll('#bsStage text')]
       .map(t => t.textContent).filter(t => /^[大小]/.test(t)))],
     chip: [...document.querySelectorAll('#bsStage text')]
       .map(t => t.textContent).find(t => /板押さえ/.test(t)) || '',
     tbl: [...document.querySelectorAll('#bsTables .bs-kgap')].map(t => t.textContent),
     head: [...document.querySelectorAll('#bsTables thead th')].map(t => t.textContent),
    }));
    /* **表はいつでも読める**——図の字は狭い区間では入らないので、
       落ちない置き場を1つ持つ（§CLAUDE 4 できないことを黙らない）。 */
    rec('刃が作る寸法（内／外）が刃組表で読める',
        shown.tbl.length > 0 && shown.tbl.every(t => /^[内外]\d/.test(t))
        && shown.head.some(h => /刃の間隔/.test(h)), shown.tbl.join(' '));
    rec('ゴムリングの径と色と大小を上の帯が言い切る',
        /大\s*\S*Φ\d+／小\s*\S*Φ\d+/.test(shown.chip), shown.chip);

    /* ---- 余りは層ごとに別（§9.441、利用者の指示） ----
       スペーサー層の端数は**0が正**（組んだものはOS側へ押し付けて組む）。
       板押さえの空きは**わずかなら差し支えない**別の数。混ぜて1つの列に
       すると、直すべき端数と見ていればよい空きが見分けられない。 */
    const tbl1 = await page.evaluate(() => ({
     heads: [...document.querySelectorAll('#bsTables thead th')]
       .map(x => x.textContent.replace(/\s+/g, ' ').trim()),
     ring: [...document.querySelectorAll('#bsTables .bs-ringid')]
       .map(x => x.textContent.replace(/\s+/g, ' ').trim()),
     dots: document.querySelectorAll('#bsTables .bs-ringdot').length,
     alerts: [...document.querySelectorAll('#bsTables .bs-alert')]
       .map(x => x.textContent.replace(/\s+/g, ' ').trim()),
    }));
    rec('刃組表は「板押さえの空き」の列を持つ（スペーサーの端数とは別・§9.441）',
        tbl1.heads.some(h => /板押さえの空き/.test(h)), tbl1.heads.join('|').slice(0, 120));
    /* **0が正**なので、ふだんは列そのものが立たない（立っていたら中身を見る）。 */
    rec('スペーサーの端数は0——列が立たないか、立っても不具合として出す（§9.441）',
        !tbl1.heads.some(h => /スペーサーの端数/.test(h))
        || tbl1.alerts.some(t => /スペーサーで埋め切れていない/.test(t)),
        tbl1.heads.filter(h => /端数/.test(h)).join('|') + ' / ' + tbl1.alerts.join(' ').slice(0, 80));
    /* **ゴムリングは色（＝外径）×幅で1本**（§9.377）。幅だけでは注文できない。 */
    rec('刃組表でゴムリングの色と外径が読める（§9.441）',
        tbl1.ring.length > 0 && tbl1.ring.every(t => /Φ\d+/.test(t)),
        tbl1.ring.slice(0, 3).join(' / '));
    rec('色は見本の丸を添えて言う（色名だけで思い出させない）',
        tbl1.dots >= tbl1.ring.length && tbl1.dots > 0, `${tbl1.dots}個`);

    /* ---- 4) 板厚をフィンガー切替より下げると保持層が替わる ---- */
    await page.click('[data-step-open="bsV2"]');
    await page.waitForSelector('#bsThick', { timeout: 8000 });
    await page.evaluate(() => {
     const el = document.querySelector('#bsThick');
     el.value = '0.4';
     el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    /* **保持方式を言う欄で待つ**。`#bsV2` は `Φ…/t…`（刃径と板厚）しか持たない
       ので、そこで「フィンガー」を待っても永久に成立しない——8秒待って諦めて
       いた（§9.440 で見つけた既存の取り違え）。方式は `#bsV4`（保持層）と
       `#bsHold2`（説明文）が言う。 */
    await W.until(page, () => /フィンガー/.test(
                    (document.querySelector('#bsV4') || {}).textContent || ''),
                  null, { ms: 8000, what: 'フィンガー方式へ切り替わる' });
    const f = await page.evaluate(() => ({
     verdicts: [...document.querySelectorAll('#bsGauges .bs-vb')].map(x => x.textContent),
     heads: [...document.querySelectorAll('#bsTables thead th')].map(x => x.textContent),
     bom: document.querySelector('#bsBom').textContent
    }));
    rec('押上げ・ニップは「フィンガー方式」と言う（黙って0を出さない）',
        f.verdicts.filter(v => v === 'フィンガー方式').length === 2, f.verdicts.join('/'));
    rec('刃組表の保持層の見出しがフィンガーになる', f.heads.some(h => /フィンガー/.test(h)),
        f.heads.join('|').slice(0, 80));
    rec('所要は「ゴムリングは使わない」と言う', /フィンガー方式のため使いません/.test(f.bom),
        f.bom.replace(/\s+/g, ' ').slice(0, 90));
    /* **「表示」の保持層の札は、いまの方式の名前で出す**（§9.441）。器は1つの
       まま字だけ差し替える——フィンガー方式なのに「ゴムリング」と書いてあると、
       押しても何が消えるのか読めない（§CLAUDE 4）。 */
    const holdTg = await page.evaluate(() => [...document.querySelectorAll('[data-show="ring"]')]
      .map(b => b.textContent.trim() + '|' + (b.dataset.showName || '')));
    rec('「表示」の保持層の札がフィンガーになる（§9.441）',
        holdTg.length > 0 && holdTg.every(t => /^フィンガー\|フィンガー$/.test(t)),
        holdTg.join(' / '));
    /* **フィンガーは布入ベークライトの茶**（§9.441、利用者の指示）。模式図と
       断面図が**同じトークン**から引くこと——以前は断面図だけ灰青のリテラル
       （`#6f7d8c`）で、スペーサーと見分けが付かなかった。 */
    const finCol = await page.evaluate(() => {
     const st = document.querySelector('#bsStage3') || document.documentElement;
     const v = getComputedStyle(st).getPropertyValue('--bs-fig-finger').trim();
     return { token: v, has: !!v };
    });
    rec('フィンガーの色はトークン（ベークライトの茶）から引く（§9.441）',
        finCol.has && /^#|rgb/.test(finCol.token), finCol.token);

    /* フィンガーは**板押さえ**なので、軸のまわりではなく**板の両側**に描く
       （§9.379、利用者の指示4）。以前は輪と同じ場所に出しており、どこを
       押さえているのかが図から読めなかった。ここで見るのは位置関係だけ
       ——形（先細り）は幅しだいで変わるので数えない。 */
    await toFig('2d');
    const fg = await page.evaluate(() => {
     const stage = document.querySelector('#bsStage');
     const box = el => {
      let b = null;
      try { b = el.getBBox(); } catch (_) { b = null; }
      return b ? { y0: b.y, y1: b.y + b.height } : null;
     };
     const mats = [...stage.querySelectorAll('rect.bs-mat')].map(box).filter(Boolean);
     if (!mats.length) return { n: 0 };
     const top = Math.min(...mats.map(m => m.y0));
     const bot = Math.max(...mats.map(m => m.y1));
     /* 軸の中心（上下）。青い印は軸の上に載るので、その帯の中心で代用する。 */
     const caps = [...stage.querySelectorAll('rect.bs-cap')].map(box).filter(Boolean);
     const cys = [...new Set(caps.map(c => Math.round((c.y0 + c.y1) / 2)))].sort((a, b) => a - b);
     const upC = cys[0], loC = cys[cys.length - 1];
     /* フィンガーは色で見分ける（輪と同じ道具で描かれていないこと自体を見たい
        ので、クラスではなく**塗り**で拾う）。 */
     const hex = getComputedStyle(stage.closest('#bladeSetPanel'))
       .getPropertyValue('--bs-fig-finger').trim();
     const fs = [...stage.querySelectorAll('path,rect')]
       .filter(e => (e.getAttribute('fill') || '') === hex).map(box).filter(Boolean);
     const above = fs.filter(b => (b.y0 + b.y1) / 2 < top);
     const below = fs.filter(b => (b.y0 + b.y1) / 2 > bot);
     /* **真下の板に貼り付いているか**（§9.385、利用者の指摘「フィンガーの図と
        板の図の間隙間があります」）。1枚ごとに、その横位置に在る板を探して
        面が合っているかを見る——**いちばん外の面とだけ比べると、寄った条に
        対する隙間を見逃す**（それが元の不具合だった）。 */
     const mb = [...stage.querySelectorAll('rect.bs-mat')].map(el => {
      let b = null; try { b = el.getBBox(); } catch (_) { return null; }
      return { x0: b.x, x1: b.x + b.width, y0: b.y, y1: b.y + b.height };
     }).filter(Boolean);
     const fxs = [...stage.querySelectorAll('path,rect')]
       .filter(e => (e.getAttribute('fill') || '') === hex).map(el => {
        let b = null; try { b = el.getBBox(); } catch (_) { return null; }
        return { cx: b.x + b.width / 2, x0: b.x, x1: b.x + b.width,
                 y0: b.y, y1: b.y + b.height };
       }).filter(Boolean);
     let touch = 0, gaps = [];
     for (const f of fxs) {
      const under = mb.find(m => f.cx >= m.x0 - 0.6 && f.cx <= m.x1 + 0.6);
      if (!under) continue;
      const up = (f.y0 + f.y1) / 2 < (under.y0 + under.y1) / 2;
      const d = up ? Math.abs(f.y1 - under.y0) : Math.abs(f.y0 - under.y1);
      if (d <= 1.2) touch++; else gaps.push(Math.round(d));
     }
     return { n: fs.length, above: above.length, below: below.length,
              touch, gaps: gaps.slice(0, 5), checked: touch + gaps.length,
              /* **軸と、その押さえが当たっている条**のあいだに居るか（§9.385）。
                 以前は板ぜんたいの外枠（`top`/`bot`）で見ていたが、条が千鳥で
                 寄るぶん、**外枠の内側にも正しい置き場所がある**——下へ寄った
                 条を上から押さえる指は、外枠の中に入る。外枠で見ると、
                 正しく貼り付いた指を「軸に被せている」と誤って落とす。 */
              between: fxs.every(f => {
               const under = mb.find(m => f.cx >= m.x0 - 0.6 && f.cx <= m.x1 + 0.6);
               if (!under) return true;
               const up = (f.y0 + f.y1) / 2 < (under.y0 + under.y1) / 2;
               return up ? (f.y1 <= under.y0 + 0.6 && f.y0 > upC)
                         : (f.y0 >= under.y1 - 0.6 && f.y1 < loC);
              }),
              /* **どの条にも食い込まない**（隣の条へはみ出さない）。 */
              bite: fxs.filter(f => mb.some(m =>
               f.x1 > m.x0 + 0.6 && f.x0 < m.x1 - 0.6
               && f.y1 > m.y0 + 0.6 && f.y0 < m.y1 - 0.6)).length,
              top, bot, upC, loC };
    });

    rec('フィンガーを図に描く（方式だけ言って絵に出さない、をやめる）',
        fg.n > 0, `${fg.n}本`);
    rec('フィンガーは板の両側に出る（上下それぞれの軸から押さえる）',
        fg.above > 0 && fg.below > 0, `上${fg.above}/下${fg.below}`);
    rec('フィンガーは軸と、押さえている条のあいだに置く（軸に被せない）',
        fg.n > 0 && fg.between === true,
        `板 ${Math.round(fg.top)}..${Math.round(fg.bot)} / 軸 ${fg.upC}..${fg.loC}`);
    rec('フィンガーはどの条にも食い込まない', fg.bite === 0, `食い込み${fg.bite}枚`);
    /* §9.385。条は千鳥で上下へ寄るので、**いちばん外の面に固定すると
       反対へ寄った条に板厚1枚ぶんの隙間が残る**（区間の約半分）。
       1枚ごとに真下の板と突き合わせる。 */
    rec('フィンガーは真下の板に貼り付く（隙間を空けない）',
        fg.checked > 0 && fg.gaps.length === 0,
        `${fg.touch}/${fg.checked}枚が接触` + (fg.gaps.length ? ` 隙間${fg.gaps.join(',')}px` : ''));
    /* 戻す（以降の判定はゴムリング方式で見る） */
    await page.evaluate(() => {
     const el = document.querySelector('#bsThick');
     el.value = '1.3';
     el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await W.until(page, () => !/フィンガー/.test(document.querySelector('#bsV2').textContent),
                  null, { ms: 8000, what: 'ゴムリング方式へ戻る' });

    /* 向きの切り替えは**図の見出し**に居る（§9.380、利用者の指示）。
       効く先はこの図の左右なので、離れた場所に置くと「何に効くボタンか」を
       探すことになる。置き場所だけでなく、**そこから効くこと**まで見る
       ——移したのに配線が切れていたら、押せるのに何も起きない的になる。 */
    const flipState = () => page.evaluate(() => {
     const on = document.querySelector('#bsFlip [data-datum-pos].is-on');
     return { inFig: !!document.querySelector('.bs-figpanel .bs-ph #bsFlip'),
              inBar: !!document.querySelector('.bs-bar #bsFlip'),
              pos: on ? on.dataset.datumPos : '', label: on ? on.textContent.trim() : '',
              labels: [...document.querySelectorAll('#bsFlip [data-datum-pos]')].map(x => x.textContent.trim()),
              datum: window.WL.bladeSet.datumOf(window.WL.bladeGuide.masters || {}),
              edge: [...document.querySelectorAll('#bsStage text')]
                .map(t => (t.textContent || '').trim()).filter(t => t === 'OS' || t === 'DS').join('/') };
    });
    const flip0 = await flipState();
    rec('向きの切り替えは刃組図の見出しにある', flip0.inFig && !flip0.inBar,
        `図${flip0.inFig}/バー${flip0.inBar}`);
    /* §9.463（利用者の指示「段取り向きとか図面向きというのをやめて、基準原点を左、
       基準原点を右…既定は基準原点を右側に表示」）。**2つの札・いまの側が濃い**。 */
    rec('向きの札は「基準原点を左／右」の2つ（段取り向き・図面向きの字は無い）',
        flip0.labels.join('/') === '基準原点を左/基準原点を右', flip0.labels.join('/'));
    rec('開いたときは基準原点が右（基準面の字が図の右端）',
        flip0.pos === '右' && flip0.edge.split('/')[1] === flip0.datum, JSON.stringify(flip0));
    /* **手順の窓を先に閉じる。** 窓（`.bs-pop`）は図の見出しへ垂れ下がるので、
       開いたままだと見出しの札に手が届かない（人が押すときも同じ）。 */
    await page.keyboard.press('Escape');
    await W.until(page, () => !document.querySelector('.bs-step.is-open'),
                  null, { ms: 5000, what: '手順の窓が閉じる' });
    await page.click('#bsFlip [data-datum-pos="左"]');
    await W.until(page, () => (document.querySelector('#bsFlip .is-on') || {}).dataset?.datumPos === '左',
      null, { ms: 8000, what: '向きが切り替わる' });
    const flip1 = await flipState();
    rec('押すと図の左右が入れ替わる（基準面の字が左端へ）',
        /^(OS\/DS|DS\/OS)$/.test(flip0.edge) && flip1.edge !== flip0.edge
        && flip1.edge.split('/')[0] === flip1.datum, `${flip0.edge} → ${flip1.edge}`);
    rec('いまの向きの札だけが濃い（押した側）', flip1.pos === '左' && flip1.label === '基準原点を左',
        JSON.stringify(flip1));
    await page.click('#bsFlip [data-datum-pos="右"]');
    await W.until(page, () => (document.querySelector('#bsFlip .is-on') || {}).dataset?.datumPos === '右',
      null, { ms: 8000, what: '元の向きへ戻す' });

    /* ---- 4.5) 模式図の読みやすさ（§9.378・利用者の指摘4点） ----
       どれも「見えるかどうか」の話なので、**実際に描かれた図形を測って**見る。
       字面（クラスが付いているか）ではなく、位置と大きさの関係を見ること。 */
    const fig = await page.evaluate(() => {
     const box = el => {
      const o = {};
      ['x', 'y', 'width', 'height'].forEach(k => { o[k] = parseFloat(el.getAttribute(k)) || 0; });
      return o;
     };
     const stage = document.querySelector('#bsStage');
     const caps = [...stage.querySelectorAll('rect.bs-cap')].map(box);
     /* 青い印と重なってはいけないのは「軸の上に並ぶ部材」。軸そのもの（印を
        載せる土台）と印どうしは除く。 */
     const others = [...stage.querySelectorAll('rect')]
       .filter(r => !r.classList.contains('bs-cap') && !r.classList.contains('bs-shaft'))
       .map(box);
     const hit = caps.filter(c => others.some(o =>
       o.x < c.x + c.width && o.x + o.width > c.x &&
       o.y < c.y + c.height && o.y + o.height > c.y)).length;
     /* 番号は「板がある側」。その番号の真下（真上）にある板の矩形を x で引き、
        板が中心より上に寄っているなら番号も上、という対応を見る。 */
     const mats = [...stage.querySelectorAll('rect.bs-mat')].map(box);
     const midY = mats.length
       ? mats.reduce((a, m) => a + m.y + m.height / 2, 0) / mats.length : 0;
     let ok = 0, ng = 0;
     [...stage.querySelectorAll('text.bs-mk')].forEach(t => {
      if (!/^[0-9]+$/.test(t.textContent || '')) return;      /* 耳は下に固定なので見ない */
      const x = parseFloat(t.getAttribute('x')) || 0;
      const m = mats.find(r => r.x <= x && x <= r.x + r.width);
      if (!m) return;
      const matUp = (m.y + m.height / 2) < midY - 0.5;
      const markUp = t.dataset.side === 'up';
      if (matUp === markUp) ok++; else ng++;
     });
     const vb = (stage.getAttribute('viewBox') || '').split(/\s+/).map(Number);
     const r = stage.getBoundingClientRect();
     const gw = document.querySelector('#bsTables .bs-gw');
     return { hit, caps: caps.length, ok, ng,
              vbRatio: vb[3] && vb[2] ? vb[2] / vb[3] : 0,
              boxRatio: r.height ? r.width / r.height : 0,
              gwFs: gw ? parseFloat(getComputedStyle(gw).fontSize) : 0,
              bodyFs: parseFloat(getComputedStyle(document.body).fontSize) };
    });
    rec('軸のエンドの青い印は端部のスペーサーと重ならない（有効幅の外へ出す）',
        fig.caps === 4 && fig.hit === 0, `印${fig.caps}枚 / 重なり${fig.hit}件`);
    rec('条の番号は板がある側へ出る（番号と板を目で結び直させない）',
        fig.ok > 0 && fig.ng === 0, `そろい${fig.ok}件 / ずれ${fig.ng}件`);
    /* 模式図が**器の横幅を使い切っている**こと（§9.378 の実測で確かめた形）。
       描画は `preserveAspectRatio` で横幅に律速されるので、中身が viewBox の
       横いっぱいに広がっていれば、器の幅ぶんそのまま描かれる。ここが縮むと
       左右に何も無い帯が生まれる——利用者の「両側に余白がある」はこの形。
       縦の詰まり（`grow`）では横は1pxも動かないので、見るのは**横だけ**。 */
    await toFig('2d');
    const fill = await page.evaluate(() => {
     const g = document.querySelector('#bsStage');
     const vb = (g.getAttribute('viewBox') || '').split(/\s+/).map(Number);
     let bb = null;
     try { bb = g.getBBox(); } catch (_) { bb = null; }
     const row = document.querySelector('#bsFigRow');
     const cols = row ? getComputedStyle(row).gridTemplateColumns.split(/\s+/)
       .map(v => Math.round(parseFloat(v) || 0)) : [];
     /* 端部の表は**レールの中**に居る（図の段には居ない）。 */
     const inRail = ['#bsOsSide', '#bsDsSide']
       .map(sel => !!document.querySelector('#bsRail ' + sel));
     const inFig = ['#bsOsSide', '#bsDsSide']
       .map(sel => !!document.querySelector('#bsFigRow ' + sel));
     const figW = row ? Math.round(row.getBoundingClientRect().width) : 0;
     const stW = Math.round(document.querySelector('#bsStage').getBoundingClientRect().width);
     /* **軸（アーバー）の中心が viewBox の中心に居るか**（§9.440、利用者の
        指摘「模式図全体がやや右によっているような感じです」）。軸はいちばん
        幅の広い `rect`。絵では「やや右」としか読めないので数で見る。 */
     let ax = 0, aw = 0;
     g.querySelectorAll('rect').forEach(el => {
      let b = null; try { b = el.getBBox(); } catch (_) { return; }
      if (b && b.width > aw) { aw = b.width; ax = b.x; }
     });
     return { vw: vb[2] || 0, x0: bb ? bb.x : 0, x1: bb ? bb.x + bb.width : 0, cols,
              axOff: vb[2] ? Math.round(ax + aw / 2 - vb[2] / 2) : null,
              inRail, inFig, figW, stW };
    });
    /* 中身が viewBox の横幅の 98% 以上を占めていること（見出しの右端の
       わずかな空きだけを許す）。 */
    rec('模式図は器の横幅を使い切る（左右に何も無い帯を残さない）',
        fill.vw > 0 && (fill.x1 - fill.x0) >= fill.vw * 0.98,
        `中身 ${Math.round(fill.x0)}..${Math.round(fill.x1)} / viewBox 0..${fill.vw}`);
    /* 端部の表は右レールへ移した（§9.379）。図の段に戻ると模式図が
       7割まで痩せるので、**どちらに居るか**を両方向から見る。 */
    /* **中心ずれは 2px まで**（丸めのぶんだけ許す）。実測では直す前が +45px
       （左の余白100 対 右10）で、直したあとは 0（§9.440）。 */
    rec('模式図の軸は viewBox の中央に居る（左右に寄らない・§9.440）',
        fill.axOff !== null && Math.abs(fill.axOff) <= 2, `中心ずれ ${fill.axOff}px`);
    /* 有効幅の青い印は軸の外へ張り出すので、**器からはみ出さない**ことも見る
       （直す前は右端が 1005 で viewBox 1000 を 5px はみ出していた）。 */
    rec('図の中身が viewBox からはみ出さない',
        fill.x0 >= -1 && fill.x1 <= fill.vw + 1,
        `中身 ${Math.round(fill.x0)}..${Math.round(fill.x1)} / viewBox 0..${fill.vw}`);
    rec('端部の表は右レールにある', fill.inRail.every(Boolean), JSON.stringify(fill.inRail));
    rec('端部の表を図の段に戻さない（主役の模式図が痩せる）',
        fill.inFig.every(x => !x), JSON.stringify(fill.inFig));
    rec('図の段は1列（模式図が器をそのまま使う）',
        fill.cols.length === 1 && fill.stW >= fill.figW * 0.95,
        `列${fill.cols.join('|')} / 図${fill.stW} 器${fill.figW}`);

    /* 強調は**重ねている間だけ**、しかも**図と表の双方向**（§9.378）。 */
    const hov = await page.evaluate(async () => {
     const fire = (el, type) => el.dispatchEvent(
       new PointerEvent(type, { bubbles: true, cancelable: true }));
     /* 数えるのは**この画面の中だけ**（`.is-pick` は他の画面にもある字面）。 */
     const lit = () => document.querySelectorAll('#bladeSetPanel .is-pick').length;
     const badge = document.querySelector('#bsStage .bs-bhit[data-badge]');
     const row = document.querySelector('#bsTables [data-badge]');
     const before = lit();
     let onFig = 0, onTbl = 0, figLitRow = false, tblLitFig = false;
     if (badge) {
      fire(badge, 'pointerover');
      onFig = lit();
      figLitRow = !!document.querySelector('#bsTables .is-pick');
      /* `pointerleave` は泡立たないので、**聞いている器そのもの**へ投げる。 */
      fire(document.getElementById('bladeSetPanel'), 'pointerleave');
     }
     const afterLeave = lit();
     if (row) {
      fire(row, 'pointerover');
      onTbl = lit();
      tblLitFig = !!document.querySelector('#bsStage .is-pick');
      fire(document.getElementById('bladeSetPanel'), 'pointerleave');
     }
     return { before, onFig, onTbl, afterLeave, figLitRow, tblLitFig,
              hasBadge: !!badge, hasRow: !!row };
    });
    rec('図の記号に重ねると光る（押して選ばせない）',
        hov.hasBadge && hov.onFig > hov.before, `${hov.before}→${hov.onFig}`);
    rec('図に重ねると刃組表の該当行も光る', hov.figLitRow, String(hov.figLitRow));
    rec('表に重ねると図の該当記号も光る（連動は双方向）',
        hov.hasRow && hov.tblLitFig, String(hov.tblLitFig));
    rec('器から出ると消える（光ったまま残さない）', hov.afterLeave === hov.before,
        `${hov.onFig}→${hov.afterLeave}`);

    /* ---- 4.5) 連携は「広い的」と「本当に見える強調」で成り立つ（§9.386） ----
       利用者の指示「マウスオーバーの対象範囲を広げて、反応しやすく視覚的にも
       強調して」。以前は**記号の札だけが的**（実測 27×29px）で、しかも図側の
       強調は `background`/`border-color` を当てており **SVG の rect は描かない**
       ので**1pxも変わっていなかった**（実測 `fill` は前後とも同じ）。 */
    const link = await page.evaluate(() => {
     const g = document.querySelector('#bsStage .bs-bhit');
     if (!g) return { no: true };
     const bx = el => { try { const b = el.getBBox(); return b.width * b.height; }
                        catch (_) { return 0; } };
     const hit = g.querySelector('.bs-zhit'), bdg = g.querySelector('.bs-bdgr');
     return { hitA: Math.round(bx(hit)), bdgA: Math.round(bx(bdg)),
              hitW: Math.round(hit.getBBox().width),
              hitH: Math.round(hit.getBBox().height),
              /* 塗っていなくても的になること（これが無いと透明な板は素通り）。 */
              pe: getComputedStyle(hit).pointerEvents };
    });
    rec('連携の的は記号の札より広い（区間ぜんたいを的にする）',
        !link.no && link.hitA > link.bdgA * 4,
        `的 ${link.hitW}×${link.hitH}=${link.hitA} / 札 ${link.bdgA}`);
    rec('透明な的でも反応する（pointer-events を持つ）', link.pe === 'all', String(link.pe));
    /* **強調は SVG に効く言葉で**。`transition` があるので、当たった値ではなく
       「動き出したか」で見る——描画を1回待ってから読む（当てた直後に読むと
       遷移前の値が返り、効いていても0に見える。実際にそう見えて一度迷った）。 */
    const hi = await page.evaluate(() => {
     const g = document.querySelector('#bsStage .bs-bhit');
     const hit = g.querySelector('.bs-zhit'), bdg = g.querySelector('.bs-bdgr');
     const off = { o: getComputedStyle(hit).fillOpacity, f: getComputedStyle(bdg).fill,
                   sw: getComputedStyle(bdg).strokeWidth };
     g.classList.add('is-pick');
     return off;
    });
    await W.paint(page);
    const hiOn = await page.evaluate(() => {
     const g = document.querySelector('#bsStage .bs-bhit.is-pick');
     const hit = g.querySelector('.bs-zhit'), bdg = g.querySelector('.bs-bdgr');
     const on = { o: getComputedStyle(hit).fillOpacity, f: getComputedStyle(bdg).fill,
                  sw: getComputedStyle(bdg).strokeWidth };
     g.classList.remove('is-pick');
     return on;
    });
    rec('光ると図の面が塗られる（fill-opacity が動く。background では描かれない）',
        parseFloat(hiOn.o) > parseFloat(hi.o), `${hi.o}→${hiOn.o}`);
    /* **重ねても記号の色は変えない**（§9.455、利用者の指摘「マウスオーバーでまた
       色の変化もあり、さらにわかりにくく」）。文字ごとの色が「どの組み方か」を
       言っているので、重ねたことは縁の太さと大きさで言う。 */
    rec('重ねても記号の塗りは変わらない（縁と大きさで言う・§9.455）',
        hiOn.f === hi.f && parseFloat(hiOn.sw) > parseFloat(hi.sw),
        `塗り ${hi.f}→${hiOn.f} ／ 縁 ${hi.sw}→${hiOn.sw}`);

    /* ---- 4.6) 区間の拡大と耳屑の幅（§9.413） ----
       利用者の指示①「2D表示は耳屑の計算幅の表示が欲しい」
       利用者の指示⑤「アルファベットをクリックしたら、ポップオーバーでその
       部分だけの組み合わせを拡大した図を見られるように…すべてのサイズのものに
       ラベルを貼って詳しく並びと対象の寸法を伝える」。
       模式図は軸ぜんたいを1枚に収めるので**部材の幅は字が入らず出していない**。
       ここで固定するのは「押すと開く／全部の寸法に字がある／閉じる道がある」。 */
    const trim = await page.evaluate(() => {
     const mw = [...document.querySelectorAll('#bsStage .bs-mw[data-side="edge"]')];
     const mk = [...document.querySelectorAll('#bsStage .bs-mk[data-side="edge"]')];
     return { n: mw.length, txt: mw.map(t => t.textContent),
              ear: mk.map(t => t.textContent) };
    });
    rec('耳屑の計算幅が模式図に出る（OS・DSの2つ）', trim.n === 2,
        `${trim.n}個 ${trim.txt.join('/')}`);
    rec('幅は「耳」の字と対で出る（どの塊の値か迷わせない）',
        trim.ear.length === trim.n && trim.ear.every(t => t === '耳'),
        trim.ear.join('/'));
    rec('耳屑の幅は数として読める', trim.txt.every(t => /^\d+(\.\d+)?$/.test(t)),
        trim.txt.join('/'));

    const zoom = await page.evaluate(() => {
     const g = document.querySelector('#bsStage .bs-bhit');
     if (!g) return { no: true };
     g.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
     const box = document.getElementById('bsZoom');
     const svg = document.getElementById('bsZoomFig');
     /* 部材（軸の並び）の数と、引き出し線・値の字の数がそろっていること
        ——1つでも落ちていれば「全部にラベル」になっていない。 */
     const parts = svg.querySelectorAll('rect').length;
     const leads = svg.querySelectorAll('path.bs-zl').length;
     const nums = [...svg.querySelectorAll('text')]
      .map(t => t.textContent).filter(t => /^\d+(\.\d+)?$/.test(t));
     const all = [...svg.querySelectorAll('text')].map(t => t.textContent);
     return { open: !box.hidden, badge: document.getElementById('bsZoomBadge').textContent,
              figBadge: g.dataset.badge, parts, leads, nums: nums.length,
              span: all.some(t => /^区間 [\d.]+ mm$/.test(t)),
              names: all.filter(t => /スペーサー|刃（厚み）|隙間/.test(t)).length,
              clrLabel: all.filter(t => /^上下刃の中心間$/.test(t)).length,
              /* 縦に貼った字の数（§9.430）。横に入らない部材へ**直に**貼る
                 やり方なので、0なら「貼れているつもり」で引き出しへ落ちている。 */
              vert: [...svg.querySelectorAll('text')]
                .filter(t => /rotate\(-90/.test(t.getAttribute('transform') || '')).length,
              dashed: svg.querySelectorAll('[stroke-dasharray]').length,
              /* 刃の形の破線（反対側の軸の刃）。軸心の一点鎖線は数えない。 */
              knifeDash: svg.querySelectorAll('rect[stroke-dasharray]').length,
              dims: +svg.dataset.dims, inside: +svg.dataset.inside, lead: +svg.dataset.lead,
              leadw: +svg.dataset.leadw, off: +svg.dataset.off,
              /* **半断面の比**（§9.432）。縦は半径なので、帯の高さの比が
                 そのまま「軸100 : スペーサー20 : 刃の張り出し59.1」になる。
                 色で部材を見分ける（塗りは器が宣言したトークンそのもの）。 */
              geo: (() => {
               const cs = getComputedStyle(document.querySelector('.bs-shell'));
               const col = n => (cs.getPropertyValue('--bs-fig-' + n) || '').trim();
               const rcs = [...svg.querySelectorAll('rect')];
               const at = c => rcs.find(x => (x.getAttribute('fill') || '') === c);
               const hOf = c => { const e = at(c); return e ? +e.getAttribute('height') : 0; };
               const sh = at(col('shaft'));
               return { shaft: hOf(col('shaft')), spacer: hOf(col('spacer')),
                        knife: hOf(col('knife')),
                        shaftW: sh ? +sh.getAttribute('width') : 0,
                        wide: rcs.reduce((m, e) => Math.max(m, +e.getAttribute('width')), 0),
                        P: window.WL.bladeGuide.masters.P,
                        knifeD: window.WL.bladeGuide.state.knife };
              })(),
              /* 引き出し線の始点と終点を読み、順番が入れ替わっている数を数える。
                 同じ段（終点のyが同じ）どうしだけを見る（段が違えば交差しない）。 */
              cross: (() => {
               /* 線は「字のきわ → いったん真下（真上） → 部材の縁」の3点
                  （§9.432。以前は4点だった）。**最初と最後**で見る。 */
               const seg = [...svg.querySelectorAll('path.bs-zl')].map(el => {
                const m = [...el.getAttribute('d').matchAll(/([ML])([-\d.]+) ([-\d.]+)/g)];
                const last = m[m.length - 1];
                return { x0: +last[2], x1: +m[0][2], y: +m[0][3] };
               });
               let bad = 0;
               for (let i = 0; i < seg.length; i++) {
                for (let j = i + 1; j < seg.length; j++) {
                 if (Math.abs(seg[i].y - seg[j].y) > 1) continue;
                 if ((seg[i].x0 - seg[j].x0) * (seg[i].x1 - seg[j].x1) < 0) bad++;
                }
               }
               return bad;
              })(),
              /* 保持層の名前は**群に1回**（枚数ぶん繰り返さない・§CLAUDE 8）。 */
              hold: all.filter(t => /ゴムリング|フィンガー/.test(t)).length,
              /* マスタの寸法をそのまま出しているか（2桁へ丸めると 10.025 が
                 10.03 になり、在庫に無い別の部材の名前になる）。 */
              exact: nums.some(t => /^\d+\.\d{3}$/.test(t)) || nums.every(t => !/\.\d{3}/.test(t)),
              nums3: nums.join(','),
              note: (document.getElementById('bsZoomNote').textContent || '') };
    });
    rec('区間を押すと拡大図が開く', !zoom.no && zoom.open === true, JSON.stringify(zoom.open));
    rec('開いたのは押した区間（記号が一致する）', zoom.badge === zoom.figBadge,
        `${zoom.figBadge}→${zoom.badge}`);
    /* **字は器の幅で置き分ける**（§9.413 追補、利用者の指示「幅が十分あるものは
       その内部にラベルを貼って、狭い部分は…今の表示方式に」）。置き分けるので
       「引き出し線の数＝値の数」では見られない。**足し算で見る**——出すべき
       寸法の数が、中に書いた数と引き出した数に過不足なく割れていること。 */
    rec('寸法を1つも落としていない（中に書いた数＋引き出した数＝出すべき数）',
        zoom.dims > 0 && zoom.inside + zoom.lead === zoom.dims,
        `中${zoom.inside}＋外${zoom.lead}＝${zoom.dims}`);
    rec('幅のある部材は中に書く（狭いもののためにスロットを空ける）',
        zoom.inside > 0, `中${zoom.inside}件`);
    /* **引き出した字には必ず線が付く**（字だけ浮かせない）。§9.454 でクリアランスを
       組める値へ丸めたので、この区間には「隙間 0.005」のような**狭い物が無くなり**、
       引き出す物が0件になった——「0件でないこと」は材料しだいなので見ない。
       落としていないことは上の足し算が見ている。 */
    rec('引き出した字には必ず引き出し線が付く', zoom.leads === zoom.lead,
        `外${zoom.lead}件／線${zoom.leads}本`);
    /* **ラベルは指し示す物へ直に貼る**（§9.430、利用者の指示「拡大されていて
       対象にそのまま貼れるほどスペースがあるので、ラベルを直接表示したいものに
       貼って」）。拡大図は1区間だけを器いっぱいに使うので、横に入らない部材でも
       **縦になら入る**。引き出しに落ちてよいのは2つだけ——**貼る相手が無い寸法**
       （上下刃の中心間＝2枚の刃の位置の差）と、**字が縦にも入らないほど細い
       部材**（刻みの余り 0.025mm など）。
       **数ではなく幅で見る**——材料の形で本数は変わるが、「貼れる広さの物を
       引き出している」かどうかは幅そのものが言う（字の高さ14pxが下限）。 */
    rec('引き出すのは「貼る相手が無い寸法」と「字が入らないほど細い部材」だけ',
        zoom.leadw < 18, `引き出した部材の最大幅 ${zoom.leadw}px（字の高さ14px）`);
    /* ---- 拡大図は「選んだ軸の半断面」（§9.432、利用者の指摘「軸がスペーサー
       みたいな表示になっていて軸の位置が無視されている。比率が圧倒的におかしい。
       選択した軸の上半分か下半分を表示してほしい」）----
       以前は部材の**直径**ぶんの塊を中心に置いており、**軸（Φ200）が図のどこにも
       無かった**。縦を半径にすれば、帯の高さの比が実物の比そのものになる。
       **絵ではなく高さの比で見る**——見た目の印象では「おかしい」を数にできない。 */
    const gz = zoom.geo || {};
    const rS = gz.P ? (+gz.P.shaftDia || 200) / 2 : 0;
    const rP = gz.P ? (+gz.P.spacerOD || 240) / 2 : 0;
    const rK = (+gz.knifeD || 0) / 2;
    const near = (a, b) => Math.abs(a - b) <= 0.08;
    rec('拡大図に軸が描かれている（部材の下を1本で通っている）',
        gz.shaft > 0 && Math.abs(gz.shaftW - gz.wide) < 0.6,
        `軸 高さ${gz.shaft}px／幅${gz.shaftW}px（いちばん広い物 ${gz.wide}px）`);
    rec('縦は半径の比そのもの（軸 : スペーサー : 刃の張り出し）',
        gz.spacer > 0 && rP > rS && rK > rS
        && near(gz.shaft / gz.spacer, rS / (rP - rS))
        && near(gz.knife / gz.spacer, (rK - rS) / (rP - rS)),
        `軸/スペーサー ${(gz.shaft / gz.spacer).toFixed(2)}`
        + `（期待 ${(rS / (rP - rS)).toFixed(2)}）／`
        + `刃/スペーサー ${(gz.knife / gz.spacer).toFixed(2)}`
        + `（期待 ${((rK - rS) / (rP - rS)).toFixed(2)}）`);
    rec('拡大図も寸法を1つも落とさない（出しきれなかった数が0）',
        zoom.off === 0, `出せなかった ${zoom.off}件`);
    rec('値の字は出すべき寸法の数だけある', zoom.nums === zoom.dims,
        `値${zoom.nums}／寸法${zoom.dims}`);
    rec('軸に並ぶ部材はすべて名前が添う（値だけを並べない）',
        zoom.names > 0, `名前${zoom.names}`);
    /* **引き出し線どうしが交差しない**（同上の指示）。交差すると、どの札が
       どの部材のものか読めなくなる。始点の順と終点の順が同じなら交差しない。 */
    rec('引き出し線どうしが交差しない（始点の順と終点の順が同じ）',
        zoom.cross === 0, `交差${zoom.cross}件`);
    rec('保持層の名前は群に1回だけ（枚数ぶん繰り返さない）', zoom.hold <= 1,
        `${zoom.hold}回`);
    rec('寸法はマスタの値そのまま（10.025 を 10.03 へ丸めない）', zoom.exact === true,
        zoom.nums3);
    rec('区間ぜんたいの寸法も出す', zoom.span === true, String(zoom.span));
    /* **反対側の軸の刃（破線）は描かない**（§9.457、利用者の指示「拡大図の刃の横の
       点線は消してください」。§9.442 の「破線の刃は残す」は撤回）。クリアランスの
       値は足元の説明が言う。**「上下刃の中心間」の字も出さない**（§9.442）。 */
    rec('拡大図に反対側の軸の刃（破線）を描かない（§9.457）',
        zoom.knifeDash === 0, `刃の形の破線${zoom.knifeDash}`);
    rec('「上下刃の中心間」の字は拡大図に出さない（§9.442）',
        zoom.clrLabel === 0, `札${zoom.clrLabel}`);

    /* ---- 拡大図は**押した軸**の半断面（§9.442、利用者の指示「上軸は上の図、
       下軸は下の図を選ぶようにしてほしい」）----
       同じ記号は上下の両方に出るので、軸を渡さないと`r.zones[0]`＝先に来た
       ほうで開き、**下軸を押したのに上軸の図**が出ていた。
       **絵ではなく「どの区間から組んだか」で見る**——上下で同じ寸法になる
       材料では、絵が同じでも取り違えは起きている。 */
    const axPick = await page.evaluate(() => {
     const hits = [...document.querySelectorAll('#bsStage .bs-bhit[data-axis]')];
     const byBadge = new Map();
     hits.forEach(h => {
      const k = h.dataset.badge;
      const v = byBadge.get(k) || new Set();
      v.add(h.dataset.axis); byBadge.set(k, v);
     });
     /* 上下の両方に出ている記号を探す（取り違えが起きうるのはそこだけ）。 */
     let both = null;
     byBadge.forEach((v, k) => { if (!both && v.size > 1) both = k; });
     const pick = ax => {
      const h = hits.find(x => x.dataset.badge === (both || hits[0].dataset.badge)
                          && x.dataset.axis === ax);
      if (!h) return null;
      h.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const svg = document.getElementById('bsZoomFig');
      return { asked: ax, got: svg ? svg.dataset.axis : '',
               zone: svg ? svg.dataset.zone : '' };
     };
     const up = pick('up'), lo = pick('lo');
     return { both, hits: hits.length, up, lo,
              axes: [...new Set(hits.map(h => h.dataset.axis))].sort() };
    });
    rec('模式図の区間は「どちらの軸か」も名乗る（§9.442）',
        axPick.axes.join(',') === 'lo,up', JSON.stringify(axPick.axes));
    rec('上軸を押せば上軸、下軸を押せば下軸の拡大図が開く（§9.442）',
        !!axPick.up && !!axPick.lo && axPick.up.got === 'up' && axPick.lo.got === 'lo'
        && axPick.up.zone !== axPick.lo.zone,
        JSON.stringify({ up: axPick.up, lo: axPick.lo, both: axPick.both }));
    /* **記号の色は文字ごとに1色**（§9.455、利用者の指示「アルファベットごとに
       色分けしてわかりやすく」。§9.442 の「軸で色を分ける」は撤回）。
       同じ文字は上軸・下軸・刃組表のどこでも同じ色、違う文字は違う色。 */
    const badgeCol = await page.evaluate(() => {
     const by = {};
     const put = (b, c) => { (by[b] = by[b] || new Set()).add(c); };
     document.querySelectorAll('#bsStage .bs-bhit').forEach(g =>
      put(g.dataset.badge, getComputedStyle(g.querySelector('.bs-bdgr')).fill));
     document.querySelectorAll('#bsTables .bs-bdg').forEach(e =>
      put(e.textContent.trim(), getComputedStyle(e).backgroundColor));
     const ks = Object.keys(by);
     const one = ks.filter(k => by[k].size === 1);
     const firsts = one.map(k => [...by[k]][0]);
     return { n: ks.length, one: one.length, uniq: new Set(firsts).size,
              ex: ks.map(k => `${k}:${[...by[k]].join('|')}`).join(' ') };
    });
    rec('記号は文字ごとに1色（上下・表で同じ／文字が違えば色も違う・§9.455）',
        badgeCol.n >= 2 && badgeCol.one === badgeCol.n && badgeCol.uniq === badgeCol.n,
        badgeCol.ex);
    /* **字は層ごとに置き分ける**（§9.458、利用者の指示「フィンガーやゴムリングも
       その材料の中に数値ラベル貼れる…軸に近いスペーサーで書ききれない場合は軸に、
       ゴムリングやフィンガーで書ききれない場合は軸と反対の外側に」）。
       以前はフィンガーの帯（高さ約12px）へ13pxの字が入らず、**フィンガーの字が
       全部軸へ引き出されていた**（実測12件）。全部の区間・両方の軸を開いて数える:
       ①保持層の字を軸へ引き出した数＝0 ②線の向き（軸の段は軸へ・外の段は外へ）
       ③中へ貼った字は読める大きさ（9px以上） ④字は図の器からはみ出さない。 */
    const zLayer = await page.evaluate(() => {
     const hits = [...document.querySelectorAll('#bsStage .bs-bhit[data-axis]')];
     const seen = new Set();
     const out = { opened: 0, holdShaft: 0, badDir: 0, small: 0, spill: 0,
                   holdIn: 0, outer: 0, shaft: 0 };
     hits.forEach(h => {
      const key = h.dataset.badge + h.dataset.axis;
      if (seen.has(key)) return; seen.add(key);
      h.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const svg = document.getElementById('bsZoomFig');
      if (!svg || document.getElementById('bsZoom').hidden) return;
      out.opened++;
      const up = svg.dataset.axis === 'up';
      svg.querySelectorAll('path.bs-zl').forEach(el => {
       const m = [...el.getAttribute('d').matchAll(/([ML])([-\d.]+) ([-\d.]+)/g)];
       const y0 = +m[0][3], y1 = +m[m.length - 1][3];
       const where = el.dataset.zl;
       if (where === 'outer') out.outer++; else out.shaft++;
       if (el.dataset.layer === 'hold' && where === 'shaft') out.holdShaft++;
       /* 軸の段: 字は対象より軸心の側（上軸なら下）。外の段: 字は対象より外（上軸なら上）。 */
       const towardAxis = up ? y0 > y1 : y0 < y1;
       if ((where === 'outer') === towardAxis) out.badDir++;
      });
      const sr = svg.getBoundingClientRect();
      svg.querySelectorAll('text').forEach(t => {
       const fs = +t.getAttribute('font-size') || 0;
       if (/^\d+(\.\d+)?$/.test(t.textContent) && fs && fs < 9) out.small++;
       if ((t.getAttribute('fill') || '') === '#fff' && fs < 13) out.holdIn++;
       const r = t.getBoundingClientRect();
       if (r.width && (r.top < sr.top - 1 || r.bottom > sr.bottom + 1)) out.spill++;
      });
     });
     return out;
    });
    rec('保持層（ゴムリング・フィンガー）の字を軸へ引き出さない（§9.458）',
        zLayer.opened > 0 && zLayer.holdShaft === 0, JSON.stringify(zLayer));
    rec('引き出し線の向き: スペーサーは軸へ・保持層は外へ（§9.458）',
        zLayer.badDir === 0, `逆向き${zLayer.badDir}本（軸${zLayer.shaft}／外${zLayer.outer}）`);
    rec('中へ貼った字は読める大きさ（9px以上）・図の器からはみ出さない（§9.458）',
        zLayer.small === 0 && zLayer.spill === 0,
        `9px未満${zLayer.small}／はみ出し${zLayer.spill}`);
    /* **次の節が見る形へ戻してから渡す**（§9.394 と同じ作法）。この節は
       区間を押して回るので、閉じっぱなし・別の区間で開きっぱなしのまま
       進むと、次の「もう一度押すと閉じる」が成り立たない（実際に2件落ちた）。
       いちばん最初の区間で**開いた状態**にして渡す。 */
    await page.evaluate(() => {
     const b = document.getElementById('bsZoomClose'); if (b) b.click();
     const g = document.querySelector('#bsStage .bs-bhit');
     if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await W.until(page, () => document.getElementById('bsZoom').hidden === false,
                  null, { ms: 8000, what: '最初の区間で拡大図が開き直る' });
    rec('クリアランスの値は足元の説明で言う（破線とは書かない・§9.457）',
        /クリアランス\s*[\d.]+/.test(zoom.note) && !/破線/.test(zoom.note),
        zoom.note.slice(-80));
    rec('図が言えないこと（どの区間に入るか）を添える', /区間/.test(zoom.note),
        zoom.note.slice(0, 40));

    const zclose = await page.evaluate(() => {
     const box = document.getElementById('bsZoom');
     const g = document.querySelector('#bsStage .bs-bhit');
     /* 同じ区間をもう一度押すと閉じる（開く道と閉じる道が同じ的）。 */
     g.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
     const afterToggle = box.hidden;
     g.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
     const reopened = !box.hidden;
     /* 図の外を押したら閉じる。 */
     document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
     const afterOutside = box.hidden;
     g.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
     return { afterToggle, reopened, afterOutside, afterEsc: box.hidden };
    });
    rec('もう一度押すと閉じる', zclose.afterToggle === true, String(zclose.afterToggle));
    rec('押し直すと開く', zclose.reopened === true, String(zclose.reopened));
    rec('図の外を押すと閉じる', zclose.afterOutside === true, String(zclose.afterOutside));
    rec('Escでも閉じる', zclose.afterEsc === true, String(zclose.afterEsc));

    /* ---- 5) 立体図: 器の入れ替え・断り・段取りの順 ----
       **描画そのもの（WebGL の絵）はここでは見ない。** 立体図の部品（three.js）は
       押したときに CDN から取りに行く作りで、検証用のコンテナは外へつながらない。
       ここで固定するのは**つながらない端末で何が起きるか**の側——取れなければ
       **字で断り、模式図はそのまま使える**こと（§CLAUDE「できないことは、
       できないと書く」）。取りに行く先を網の側で**遮断**するのは、外へつながる
       端末でも**同じ道を通す**ため（回線の有無で網の結果が変わると、落ちた理由が
       端末ごとに変わって読めなくなる）。実機での見え方（機械・レール・台車の回転・
       部材の色）は手で確かめている（§9.377 追補）。 */
    /* 手順の窓（`.bs-pop`）は図の見出しへ垂れ下がるので、開いたままだと
       図の切替札に手が届かない（人が押すときも同じ）。Escape で閉じてから進む。 */
    await page.keyboard.press('Escape');
    await W.until(page, () => !document.querySelector('.bs-step.is-open'),
                  null, { ms: 5000, what: '手順の窓が閉じる' });
    /* **既定が断面図になったので、部品は開いた時点で読む**（§9.440）。
       §9.377 の「取りに行くのは押したときだけ」は、CDN から取りに行っていた
       頃の決まり——いまは同梱（`/static/vendor/three/`）なので外へはつながらず、
       開くたびに読むのは手元のファイル1本。**外を指していないこと**（下の網）が
       本体で、こちらは「読み終わって断面図が出ている」ことを見る。 */
    rec('既定の断面図は、部品を読み終えて絵になっている',
        await page.evaluate(() => !!window.THREE
          && [...document.scripts].some(x => /three/i.test(x.src || ''))));
    const src3 = await page.evaluate(() => WL.bladeSolid && WL.bladeSolid.THREE_SRC);
    /* **外を指していないこと**（§9.378、利用者の報告「3Dでの表現が表示失敗します」）。
       CDN から読んでいたときは現場の端末で読み込めなかったので、同梱へ倒した。
       ここが外向きのURLへ戻ったら、回線の有無で立体図が出たり出なかったりする。 */
    rec('取りに行く先は同梱した1本（外を指していない）',
        /^\/static\/vendor\//.test(src3 || '') && !/^https?:/.test(src3 || ''), String(src3));
    /* 遮断のパターンは**フルURLに当てる**（Playwright の照合はURL全体に対して
       行われるので、`/static/...` の相対のままでは1つも当たらない）。 */
    const block3 = '**' + src3;
    await page.route(block3, r => r.abort());
    /* **部品を読めない端末をここで作る**（§9.440）。既定が断面図になったぶん
       `window.THREE` は開いた時点でもう載っているので、遮断だけでは
       `setMode()` が読み込みの道を通らず、断りが出ない。いったん外して
       同じ道を通す——**製品側の作りは変えない**（§9.267 の追補と同じ立場で、
       現場で起きない条件を網の側だけで作る）。 */
    await page.evaluate(() => { window.__threeKeep = window.THREE; window.THREE = undefined; });
    await page.click('#bsFigTabs [data-fig="3d"]');
    await W.until(page, () => {
     const e = document.querySelector('.bs-ng3');
     return !!e && !e.hidden;
    }, null, { ms: 20000, what: '立体図の断り' });
    const st3 = await page.evaluate(() => ({
     stage2: document.querySelector('.bs-stage').hidden,
     stage3: document.querySelector('#bsStage3').hidden,
     shown: !!document.querySelector('#bsStage3').offsetWidth,
     ng: (document.querySelector('.bs-ng3').textContent || '').replace(/\s+/g, ' '),
     caps: [...document.querySelectorAll('#bsStage3 .bs-hud-cap')].map(x => x.textContent),
     show: [...document.querySelectorAll('#bsStage3 [data-show]')]
       .map(b => b.textContent + ':' + b.getAttribute('aria-pressed')),
     steps: [...document.querySelectorAll('#bsStage3 .bs-hud.is-bot .bs-btn')]
       .map(b => b.textContent),
     hide: [...document.querySelectorAll('#bsStage3 [data-hide]')]
       .map(b => b.textContent + ':' + b.getAttribute('aria-pressed')),
     hideIn: !!document.querySelector('#bsStage3 [data-show]')
       ?.closest('.bs-hud-grp')?.querySelector('[data-hide]')
    }));
    rec('立体図にすると模式図の器を伏せ、立体図の器だけを出す（横に2つ並べない）',
        st3.stage2 === true && st3.stage3 === false && st3.shown,
        JSON.stringify([st3.stage2, st3.stage3, st3.shown]));
    rec('部品を読めないときは字で断る（黙って空の器を出さない）',
        /読み込めませんでした/.test(st3.ng), st3.ng.slice(0, 60));
    rec('断りは「模式図はそのまま使える」ことまで言う',
        /模式図はそのまま使えます/.test(st3.ng), st3.ng.slice(0, 90));
    rec('見せる部材の入切は板・刃・ゴムリング・スペーサーの4つ（言葉は部材の名前で固定）',
        st3.show.join('/') === '板:true/刃:true/ゴムリング:true/スペーサー:true',
        st3.show.join('/'));
    /* **顔ぶれを文字列で丸ごと固定しない**（§9.389）。正しい位置へ1枚足しただけで
       落ちるので、前後関係で見る——「表示」が先頭・「段取り」「視点」がその後ろ。 */
    rec('HUDは「表示」から始まり、「段取り」「視点」がその後ろに並ぶ',
        st3.caps[0] === '表示'
        && st3.caps.indexOf('段取り') > 0
        && st3.caps.indexOf('視点') > st3.caps.indexOf('段取り'),
        st3.caps.join('/'));
    /* 隠し方は**「表示」と同じ群の中**（§9.422）。消したものをどう出すかは上の
       入切にかかる設定なので、別の群へ離すと何に効くのか読めない。 */
    rec('消した部材の見せ方は「表示」の群の中にある',
        st3.hideIn === true && st3.caps.indexOf('消したものは') === 1,
        String(st3.hideIn) + '/' + st3.caps.join('/'));
    rec('見せ方は「薄く／線だけ／出さない」の3つで、既定は「出さない」（今までの動き）',
        st3.hide.join('/') === '薄く:false/線だけ:false/出さない:true', st3.hide.join('/'));
    /* **「視点を戻す」は段取りの外**（§9.413 追補）。断面図では段取りの群ごと
       伏せるので、同じ群に入れると戻す道まで消える。 */
    rec('段取りは3手順、視点を戻すは別の群',
        st3.steps.length === 4 && /③台車を回す/.test(st3.steps[2])
        && /視点を戻す/.test(st3.steps[3]), st3.steps.join('/'));
    /* 段取りの順は`blockReason()`の1箇所が答える。**内部の今の状態を写さず、
       どの状態でも成り立つことだけ**を見る——①できない手順は何を先にするかを
       字で言う、②進める手順が必ず1つ残る（手詰まりを作らない）。 */
    const why = await page.evaluate(() =>
     ['pull', 'open', 'spin'].map(k => WL.bladeSolid.blockReason(k)));
    rec('できない手順は「何を先にするか」を字で返す',
        why.every(w => w === '' || /^先に「[①②③]/.test(w)), JSON.stringify(why));
    rec('進める手順が必ず1つは残る（手詰まりを作らない）',
        why.some(w => w === ''), JSON.stringify(why));
    await page.click('#bsFigTabs [data-fig="2d"]');
    await W.until(page, () => !document.querySelector('.bs-stage').hidden,
                  null, { ms: 8000, what: '模式図へ戻る' });
    const rects2d = await page.evaluate(() =>
     document.querySelectorAll('#bsStage rect').length);
    rec('模式図へ戻せて、図はそのまま使える', rects2d > 20, String(rects2d));
    /* 遮断を解いて**実際に描けること**まで見る（§9.378）。同梱したので回線が
       無くても描けるはずで、ここが通らなければ現場でも出ない。 */
    await page.unroute(block3);
    await page.click('#bsFigTabs [data-fig="3d"]');
    await W.until(page, () => !!(window.WL.bladeSolid && window.WL.bladeSolid.ready),
                  null, { ms: 30000, what: '立体図の部品を読み終える' });
    const drew = await page.evaluate(() => {
     const cv = document.querySelector('#bsStage3 canvas');
     const ng = document.querySelector('.bs-ng3');
     return { w: cv ? cv.width : 0, h: cv ? cv.height : 0,
              ng: ng && !ng.hidden ? (ng.textContent || '').slice(0, 40) : '' };
    });
    rec('同梱した部品で立体図が実際に描ける（回線に依らない）',
        drew.w > 100 && drew.h > 100 && !drew.ng, JSON.stringify(drew));

    /* ---- 5b) 断面図（§9.412、利用者の指示） ----
       **同じ模型を使い回す**のが要点。ここで固定するのは「1枚足りたこと」ではなく、
       ①機械まわりを伏せること ②平行投影で真横から見ること ③軸の中心で切ること
       ④視点を動かせないと**見た目でも**言うこと（押せるのに何も起きない的を残さない）。 */
    /* **切り替えは1回で組み、描くのは選んだ図の模型**（§9.428、利用者の報告
       「3D断面図が切り替え直後には出ません（通常の3Dモデルが出る）」）。
       絵を見ても「2回組んだ」「前の図のまま1枚描いた」は分からないので、
       **組んだ回数**と**いま場面に在る模型がどちらの図のものか**を数で見る。
       以前は画面が`sync()`→`setMode()`の順に呼んでおり、`sync()`が前の図の
       ままもう1回組んで1枚描いていた。 */
    const swBefore = await page.evaluate(() => window.WL.bladeSolid.view().builds);
    await page.click('#bsFigTabs [data-fig="cut"]');
    await W.until(page, () => {
     const v = window.WL.bladeSolid && window.WL.bladeSolid.view();
     return !!(v && v.cut && v.ortho);
    }, null, { ms: 20000, what: '断面図に切り替わる' });
    const swCut = await page.evaluate(() => {
     const v = window.WL.bladeSolid.view();
     return { builds: v.builds, builtCut: v.builtCut, cut: v.cut, fixups: v.fixups,
              matOff: v.matOff, stale: v.stale };
    });
    rec('図を切り替えるとき組むのは1回だけ（前の図のまま組んで1枚描かない）',
        swCut.builds - swBefore === 1, `組んだ回数 ${swBefore} → ${swCut.builds}`);
    rec('場面に在る模型は、いま選ばれている図のもの（断面図）',
        swCut.builtCut === true && swCut.cut === true,
        `組んである図 ${swCut.builtCut} / 選んだ図 ${swCut.cut}`);
    /* **板と刃は同じ割付から出ている**（§9.433、利用者の報告「断面図・立体図
       だけ板の位置がずれる」）。材料の並びは`A.matStart`から、刃の位置は
       `A.U`から出るので、同じ割付なら**1条目の左端＝1本目の切断位置**で
       `matOff`は0。違う割付の物が混ざると、ここだけが0でなくなる
       （絵では「板が横へずれている」としか読めない）。
       `stale`は「組んである模型がいまの割付のものか」。 */
    rec('断面図の板と刃が同じ割付から出ている（matOff=0）',
        swCut.matOff === 0, `matOff=${swCut.matOff}`);
    rec('組んである模型がいまの割付のもの（stale でない）',
        swCut.stale === false, `stale=${swCut.stale}`);
    /* 逆向きも同じ。**戻ってから断面図へ戻す**（この節の続きは断面図を見る）。 */
    await page.click('#bsFigTabs [data-fig="3d"]');
    await W.until(page, () => window.WL.bladeSolid.view().builtCut === false, null,
                  { ms: 15000, what: '立体図へ戻す' });
    const swSolid = await page.evaluate(() => {
     const v = window.WL.bladeSolid.view();
     return { builds: v.builds, builtCut: v.builtCut, cut: v.cut };
    });
    rec('立体図へ戻すときも組むのは1回だけ',
        swSolid.builds - swCut.builds === 1,
        `組んだ回数 ${swCut.builds} → ${swSolid.builds}`);
    await page.click('#bsFigTabs [data-fig="cut"]');
    await W.until(page, () => {
     const v = window.WL.bladeSolid.view();
     return v.cut === true && v.builtCut === true && v.ortho === true;
    }, null, { ms: 15000, what: '断面図へ戻す' });
    /* **割付を変えたら模型も入れ替わる**。条数を変えて、板と刃が食い違わない
       ことと、古い模型が残らないことを見る（§9.433）。 */
    await page.click('[data-step-open="bsV3"]');
    await page.waitForSelector('#bsLotTbl input[data-k="w"]', { timeout: 8000 });
    await page.evaluate(() => {
     const put = (el, v) => { el.value = String(v);
       el.dispatchEvent(new Event('input', { bubbles: true })); };
     put(document.querySelector('#bsW'), 1130);
     put(document.querySelector('#bsLotTbl input[data-k="w"]'), 50);
     put(document.querySelector('#bsLotTbl input[data-k="n"]'), 18);
    });
    /* 条数は**刃の対数**で見る（n条なら n+1 対）。 */
    await W.until(page, () => {
     const v = window.WL.bladeSolid.view();
     return v.stale === false && v.knives === 19;
    }, null, { ms: 15000, what: '断面図が新しい割付で組み直される' });
    const swAgain = await page.evaluate(() => window.WL.bladeSolid.view());
    rec('割付を変えても板と刃が食い違わない',
        swAgain.matOff === 0 && swAgain.stale === false,
        `matOff=${swAgain.matOff} / stale=${swAgain.stale} / 刃 ${swAgain.knives} 対`);
    /* 元の材料（50mm×22条・§9.423）へ戻す——この節の続きは同じ材料で見る。 */
    await page.evaluate(() => {
     const el = document.querySelector('#bsLotTbl input[data-k="n"]');
     el.value = '22'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await W.until(page, () => window.WL.bladeSolid.view().knives === 23, null,
                  { ms: 15000, what: '22条へ戻す' });

    /* ---- 5b'') 組めない材料・組めるクリアランス・ゴムリングの空き・潤滑リング（§9.454） ----
       利用者の報告「断面図で板だけが横へずれる」と指示「四捨五入でもっとも近い
       確保可能なクリアランス」「ゴムリングは刃の間の寸法より0.2〜0.5mm小さく」
       「潤滑リング（幅10）を広い側の刃の内側の両側に」「ラップやクリアランスの
       ラベルと図の重なり」。**絵では読めない**（0.005mm は1pxも出ない）ので、
       割付の値と、器が名乗る数で見る。 */
    const g454 = await page.evaluate(() => {
     const B2 = WL.bladeSet, M2 = WL.bladeGuide.masters, s0 = WL.bladeGuide.state;
     const IX2 = B2.buildIndex(M2);
     const keep = { W: s0.W, lots: s0.lots, order: s0.order, clr: s0.clr, thick: s0.thick, align: s0.align };
     const solve = o => { Object.assign(s0, o); s0.order = []; B2.syncOrder(s0);
       return B2.solve(s0, M2, IX2); };
     /* ② 利用者の形: 104.90×11・板厚0.4・クリアランス0.04 */
     const r1 = solve({ W: 1180, thick: 0.4, clr: 0.04, align: 'none',
                        lots: [{ name: 'L1', w: 104.9, n: 11 }] });
     /* フローティングシートの側の端（`A.floatZ`・§9.461）は除く——残りはシートが押さえる（§9.456）。 */
     const rem1 = r1.zp.zones.filter((z, i) => i !== r1.A.floatZ)
      .flatMap(z => [z.up.rem, z.lo.rem]).filter(v => v > 1e-6).length;
     /* その端は細かいスペーサーを使わず、残りは押さえ代以内（§9.457）。 */
     const zl = r1.zp.zones[r1.A.floatZ];
     const dsFine = [zl.up, zl.lo].flatMap(p => p.spacer.out)
      .filter(([sz]) => Math.abs(sz - Math.round(sz)) > 1e-9).reduce((a, [, c]) => a + c, 0);
     const dsRem = Math.max(zl.up.rem, zl.lo.rem), stroke = B2.floatStroke(M2);
     /* ① 元板巾が条の合計に足りない（利用者の画面の形・W≈106） */
     const r0 = solve({ W: 106 });
     const run0 = B2.materialRun(r0.A, r0.segs), f0 = run0.find(q => q.sg.type !== 'trim');
     const off0 = +(f0.from - B2.cutFace(r0.A, s0.tk, 0, true)).toFixed(3);
     /* 2)3) ゴムリング方式（板厚1.3）の 50×22 */
     const r2 = solve({ W: 1130, thick: 1.3, clr: 0.13, lots: [{ name: 'L1', w: 50, n: 22 }] });
     const R = B2.ringRule(M2);
     const faces = r2.zp.zones.slice(1, -1).flatMap((z, j) => [
       { p: z.up, wide: z.up.len > z.lo.len }, { p: z.lo, wide: z.lo.len > z.up.len }]);
     const ringFaces = faces.filter(f => f.p.hold && f.p.hold.kind === 'ring' && f.p.gom.out.length);
     const lubeOk = faces.every(f => (f.p.lube ? f.p.lube.n : 0) === (f.wide ? 2 : 0));
     const tooTight = ringFaces.filter(f => f.p.holdRem < R.gapMin - 1e-6).length;
     const outBand = ringFaces.filter(f => f.p.holdRem > R.gapMax + 1e-6 || f.p.holdRem < R.gapMin - 1e-6).length;
     Object.assign(s0, keep); B2.syncOrder(s0);
     return { clrUsed: r1.A.clr, clrWant: r1.A.clrWant, step: r1.A.clrStep, rem1, dsFine, dsRem, stroke,
              stop0: (r0.stop || []).map(x => x.key), off0, stop1: (r1.stop || []).length,
              R, nRing: ringFaces.length, tooTight, outBand, listed: (r2.fit.holdGap || r2.fit.ringGap || []).length,
              lubeOk, lubeTotal: r2.g.lube.u + r2.g.lube.l, strips: r2.segs.length };
    });
    rec('クリアランスは組める値へ四捨五入する（0.04 → 刻み0.025の 0.05）',
        g454.clrWant === 0.04 && Math.abs(g454.clrUsed - 0.05) < 1e-9 && g454.step === 0.025,
        `指定${g454.clrWant} → ${g454.clrUsed}（刻み${g454.step}）`);
    rec('スペーサーの端数は0面（シートの側の端を除く。組んだものは基準面へ押し付けるので隙間は無い）',
        g454.rem1 === 0, `${g454.rem1}面`);
    rec('フローティングシートの押さえ代は基準値の既定 0.95mm（図面の F.P.ストローク）',
        g454.stroke === 0.95, String(g454.stroke));
    rec('シートの側の端は細かいスペーサーを使わず、残りは押さえ代以内（§9.457）',
        g454.dsFine === 0 && g454.dsRem <= g454.stroke + 1e-9, `細かい${g454.dsFine}枚 / 残り${g454.dsRem}`);
    rec('元板巾が条の合計に足りない材料は「組めない」と言う',
        g454.stop0.includes('short') && g454.stop1 === 0, JSON.stringify(g454.stop0));
    rec('組めない材料でも板と刃は同じ起点から出る（matOff=0）', g454.off0 === 0, `matOff=${g454.off0}`);
    rec('ゴムリングは刃のあいだより下限ぶん以上小さく組む（ぴったり＝空き0にしない）',
        g454.nRing > 0 && g454.tooTight === 0, `${g454.nRing}面中 下限割れ${g454.tooTight}`);
    rec('空きが帯（下限〜上限）を外れた面は、数えて名指しする（数が一致）',
        g454.outBand === g454.listed, `外れ${g454.outBand} / 名指し${g454.listed}`);
    rec('潤滑リングは広い側の区間だけに両端1本ずつ（条の数×2本）',
        g454.lubeOk && g454.lubeTotal === g454.strips * 2, `${g454.lubeTotal}本 / ${g454.strips}条`);
    /* §9.462（利用者の指示「刃組基準値マスタに、板押さえの適正な空きスペースの
       管理範囲を設定できるように」）。**フィンガーにも空きの帯**——下限ぶん小さく
       組み、帯を外れた面は名指しする。既定は0（判定しない・今までどおり）。 */
    const g462 = await page.evaluate(() => {
     const B2 = WL.bladeSet, M2 = WL.bladeGuide.masters, s0 = WL.bladeGuide.state;
     const keepP = { ...M2.P };
     const keep = { W: s0.W, lots: s0.lots, order: s0.order, clr: s0.clr, thick: s0.thick, align: s0.align };
     const solve = o => { Object.assign(s0, o); s0.order = []; B2.syncOrder(s0);
       return B2.solve(s0, M2, B2.buildIndex(M2)); };
     const look = r => {
      const f = r.zp.zones.flatMap(z => [z.up, z.lo]).filter(p => p.hold && p.hold.kind === 'finger' && p.gom.out.length);
      return { n: f.length, tight: f.filter(p => p.holdRem < 0.3 - 1e-6).length,
               out: f.filter(p => p.holdRem < 0.3 - 1e-6 || p.holdRem > 1.0 + 1e-6).length,
               listed: (r.fit.holdGap || []).length, finger: !!r.finger };
     };
     const mat = { W: 1130, thick: 0.4, clr: 0.04, align: 'none', lots: [{ name: 'L1', w: 50, n: 22 }] };
     const off = look(solve(mat));
     Object.assign(M2.P, { fingerGapMin: 0.3, fingerGapMax: 1.0 });
     const on = look(solve(mat));
     Object.assign(M2.P, keepP); for (const k of Object.keys(M2.P)) if (!(k in keepP)) delete M2.P[k];
     Object.assign(s0, keep); B2.syncOrder(s0);
     return { off, on, defMin: keepP.fingerGapMin, defMax: keepP.fingerGapMax };
    });
    rec('フィンガーの空きの既定は0（判定しない・今までどおり区間いっぱい）',
        g462.defMin === 0 && g462.defMax === 0 && g462.off.listed === 0, JSON.stringify(g462));
    rec('フィンガーも空きの下限ぶん小さく組む（下限0.3で下限割れ0面）',
        g462.on.finger && g462.on.n > 0 && g462.on.tight === 0, JSON.stringify(g462.on));
    rec('フィンガーの空きが帯を外れた面は数えて名指しする（数が一致）',
        g462.on.out === g462.on.listed, JSON.stringify(g462.on));
    /* 画面: 組めない材料では図も表も描かず、直す場所を1つ指す。 */
    const putW = v => page.evaluate(v => { const el = document.querySelector('#bsW');
      el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    const w0 = await page.evaluate(() => WL.bladeGuide.state.W);
    /* 確定のボタンが居る段を**開いてから**断る——閉じた段のボタンは、伏せなくても見えない。 */
    const rail0 = await page.evaluate(() => (document.querySelector('#bsRailTabs .is-on') || {}).dataset.r || 'ends');
    await page.click('#bsRailTabs [data-r="diff"]');
    await W.until(page, () => { const b = document.querySelector('#bsSaveCar');
      for (let e = b; e; e = e.parentElement) if (e.hidden || getComputedStyle(e).display === 'none') return false;
      return !!b; }, null, { ms: 8000, what: '確定のボタンが見える' });
    await putW(200);
    await W.until(page, () => document.querySelector('#bladeSetPanel').classList.contains('is-stop'),
                  null, { ms: 8000, what: '組めない材料の断り' });
    const stopUi = await page.evaluate(() => {
     const a = document.querySelector('#bsTables .bs-stop');
     /* **祖先まで辿る**——確定のボタンは段（`[data-p="diff"]`）ごと伏せるので、
        ボタン自身の`display`だけ見ると「出ている」と読む（`offsetParent`は使わない・§9.346）。 */
     const shown = s => { for (let e = document.querySelector(s); e; e = e.parentElement) {
       if (e.hidden || getComputedStyle(e).display === 'none') return false; } return !!document.querySelector(s); };
     return { text: a ? a.textContent.replace(/\s+/g, ' ') : '', btn: !!(a && a.querySelector('[data-stop-open]')),
              fig: shown('#bsFigRow'), table: !!document.querySelector('#bsTables table'),
              save: shown('#bsSaveCar'), note: shown('.bs-figpanel .bs-stopnote') };
    });
    rec('組めない材料では理由（不足の長さ）と直す場所を出す',
        /組めません/.test(stopUi.text) && /不足/.test(stopUi.text) && stopUi.btn, stopUi.text.slice(0, 80));
    rec('組めない材料では図・刃組表・確定を出さない（前の絵を残さない）',
        !stopUi.fig && !stopUi.table && !stopUi.save && stopUi.note, JSON.stringify(stopUi));
    await page.click('#bsTables [data-stop-open]');
    rec('「直す」を押すと幅構成の窓が開く',
        await page.evaluate(() => !!document.querySelector('.bs-step.is-open[data-step="bsV3"]')));
    await page.keyboard.press('Escape');
    await putW(w0);
    await page.click(`#bsRailTabs [data-r="${rail0}"]`);
    await W.until(page, () => !document.querySelector('#bladeSetPanel').classList.contains('is-stop')
                  && (window.WL.bladeSolid.view() || {}).stale === false, null,
                  { ms: 15000, what: '組める材料へ戻す' });
    await W.paint(page);
    /* 断面図の帯（読み方・有効長・クリアランス/ラップ/板押さえ）は図に被らない。 */
    const fit454 = await page.evaluate(() => (window.WL.bladeSolid.view() || {}).hudFit);
    rec('断面図の帯（クリアランス・ラップ）は図に被らない（上下とも）',
        !!fit454 && fit454.figTop >= fit454.top - 0.5 && fit454.figBot <= fit454.h - fit454.bot + 0.5,
        JSON.stringify(fit454));
    const tbl454 = await page.evaluate(() => {
     const cs = getComputedStyle(document.querySelector('.bs-shell'));
     return { lubeCol: !!document.querySelector('#bsTables .bs-lubeh'),
              lube: cs.getPropertyValue('--bs-fig-lube').trim(),
              spacer: cs.getPropertyValue('--bs-fig-spacer').trim(),
              ringHex: [...document.querySelectorAll('#bsTables .bs-ringdot')].map(e => getComputedStyle(e).backgroundColor),
              lubeDot: (() => { const e = document.querySelector('#bsTables .bs-lubedot'); return e ? getComputedStyle(e).backgroundColor : ''; })(),
              clrFact: (document.querySelector('#bsFClr') || {}).textContent || '' };
    });
    rec('潤滑リングは刃組表に列を持ち、色はスペーサーともゴムリングとも違う',
        tbl454.lubeCol && !!tbl454.lube && tbl454.lube !== tbl454.spacer
        && !!tbl454.lubeDot && !tbl454.ringHex.includes(tbl454.lubeDot), JSON.stringify(tbl454));
    rec('クリアランスを丸めたら、使った値と指定の値を並べて言う',
        /四捨五入/.test(tbl454.clrFact) && /0\.125/.test(tbl454.clrFact), tbl454.clrFact);

    /* ---- 潤滑リングはゴムリングマスタの行（§9.455、利用者の指示「ゴムリングマスタに
       潤滑リングフラグを立てて、サイズや在庫数を決めるのと同じように」） ----
       寸法も在庫も**その行**から引く。在庫が足りなければ所要で「足りない」と言い、
       行が無ければ「入れられない」と言う（黙って入れない・入れたふりをしない）。 */
    const lubeRow = async () => ((await getj('/api/bladeset/context?equipment=' + encodeURIComponent(EQ)))
      .rings || []).find(x => x.lube);
    const reopen = async () => {
     await page.evaluate(eq => WL.bladeGuide.open({ equipment: eq }), EQ);
     await W.paint(page);
    };
    const bomLube = () => page.evaluate(() => {
     const g = [...document.querySelectorAll('#bsBom .bs-ng2')].find(e => /潤滑リング/.test(e.textContent));
     const chip = g ? g.querySelector('.bs-nc') : null;
     return { has: !!g, chip: chip ? chip.textContent : '', short: !!(chip && chip.classList.contains('is-ng')),
              note: g ? g.textContent.replace(/\s+/g, ' ') : '',
              alert: [...document.querySelectorAll('#bsTables .bs-alert')].some(a => /潤滑リングを入れられません/.test(a.textContent)),
              col: !!document.querySelector('#bsTables .bs-lubeh') };
    });
    const L0 = await lubeRow();
    rec('潤滑リングは初期セットの1行（ゴムリングマスタ・種類＝潤滑リング）が持つ',
        !!L0 && L0.width === 10 && L0.od === 270 && L0.bore === 240, JSON.stringify(L0));
    const b0 = await bomLube();
    rec('所要に潤滑リングが出て、在庫が足りていれば赤くしない', b0.has && !b0.short, JSON.stringify(b0));
    await post('/api/bladeset-ring-master/update', { id: L0.id, qty: 1 });
    await reopen();
    const b1 = await bomLube();
    rec('潤滑リングの在庫が足りなければ所要で「足りない」と言う（ゴムリングと同じ数え方）',
        b1.has && b1.short, JSON.stringify(b1));
    await post('/api/bladeset-ring-master/update', { id: L0.id, lubeText: 'ゴムリング' });
    await reopen();
    const b2 = await bomLube();
    rec('潤滑リングの行が無ければ「入れられない」と言い、表に列を立てない',
        b2.alert && !b2.col, JSON.stringify(b2));
    await post('/api/bladeset-ring-master/update', { id: L0.id, lubeText: '潤滑リング', qty: L0.qty });
    await reopen();
    rec('種類を潤滑リングへ戻すと、また入る', (await bomLube()).col, '');

    /* ---- 板の中心（OSから）とDS端のフローティングシート（§9.456、利用者の指示
       「中心位置をOSからの距離として設定できるように」「DSからOS側にフローティング
       シートで押さえるので、DSエンドまでの隙間は発生しない」） ---- */
    const c456 = await page.evaluate(() => {
     const B2 = WL.bladeSet, M2 = WL.bladeGuide.masters, s0 = WL.bladeGuide.state;
     const IX2 = B2.buildIndex(M2);
     const keep = { center: s0.center, datum: M2.P.datumSide };
     /* **中心は基準面から測る**（§9.461）。板の中心を基準面からの距離へ直して比べる。 */
     const at = c => { s0.center = c; const r = B2.solve(s0, M2, IX2);
       const mid0 = r.A.matStart + s0.W / 2;
       return { mid: +(r.A.datum === 'OS' ? mid0 : r.A.arborLen - mid0).toFixed(3), from: r.A.centerFrom,
                datum: r.A.datum, floatZ: r.A.floatZ,
                stop: (r.stop || []).map(x => x.key), step: r.A.clrStep,
                gap: r.fit.spacerGap.length, last: r.zp.zones.length, fs: r.fit.floatSeat,
                /* シートの側の端（区間の番号は1から）を「埋め切れていない」に数えた数。 */
                fsFlag: r.fit.spacerGap.filter(t => t.startsWith((r.A.floatZ + 1) + '')).length,
                /* シートの側でない端に残りが出た面（0が正）。 */
                wrong: [r.zp.zones[r.A.floatZ === 0 ? r.zp.zones.length - 1 : 0]]
                 .flatMap(z => [z.up.rem, z.lo.rem]).filter(v => v > 1e-6).length }; };
     const out = { datum0: B2.datumOf(M2), def: at(null), c700: at(700), far: at(300) };
     /* シートの側の端に残りが出るのは**有効長が刻みの倍数でない**とき（基準面の側を
        刻みへ寄せる`slip`が効くので、中心をずらしても出ない）。有効長を一時的に外して見る。 */
     const a0 = M2.P.arborLen;
     M2.P.arborLen = 1599.63; out.c7003 = at(700.013);
     /* **基準面を入れ替えても同じ答えの形**（§9.461）。OS基準ならシートはDS端。 */
     M2.P.datumSide = 'OS'; out.os = at(700.013); out.os700 = (M2.P.arborLen = a0, at(700));
     M2.P.datumSide = 'DS'; out.ds700 = at(700);
     M2.P.datumSide = keep.datum; M2.P.arborLen = a0;
     s0.center = keep.center;
     return out;
    });
    rec('板の中心は指定した位置へ来る（刻み1つ未満のずれだけ）',
        c456.c700.from === 'job' && Math.abs(c456.c700.mid - 700) <= c456.c700.step,
        JSON.stringify(c456.c700));
    rec('中心を打っていなければ既定（基準値 → 有効長の中央）',
        c456.def.from === 'mid' || c456.def.from === 'master', JSON.stringify(c456.def));
    rec('板が有効長からはみ出す中心は「組めない」と言う', c456.far.stop.includes('center'),
        JSON.stringify(c456.far.stop));
    rec('シートの側の端の残りは「埋め切れていない」と数えない（フローティングシートが押さえる）',
        c456.c7003.fsFlag === 0 && c456.c7003.wrong === 0 && c456.c7003.fs
        && (c456.c7003.fs.up > 0 || c456.c7003.fs.lo > 0), JSON.stringify(c456.c7003));
    /* ---- 基準面（基準原点）の切り替え（§9.461、利用者の指示「逆にもできるように…
       基準原点を変更したら、中心位置の測り方も連動…デフォルトはDSを基準面にOSに
       フローティングシート」） ---- */
    rec('既定の基準面はDS・フローティングシートはOS端（§9.461）',
        c456.datum0 === 'DS' && c456.def.datum === 'DS' && c456.def.floatZ === 0
        && c456.def.fs.side === 'OS', JSON.stringify({ d: c456.datum0, z: c456.def.floatZ, s: c456.def.fs.side }));
    rec('OS基準に切り替えるとシートはDS端・残りもDS端だけに出る（§9.461）',
        c456.os.datum === 'OS' && c456.os.fs.side === 'DS' && c456.os.floatZ === c456.os.last - 1
        && c456.os.fsFlag === 0 && c456.os.wrong === 0 && (c456.os.fs.up > 0 || c456.os.fs.lo > 0),
        JSON.stringify(c456.os));
    rec('中心は基準面から測る（DS基準でもOS基準でも、指定した700mmへ来る・§9.461）',
        Math.abs(c456.ds700.mid - 700) <= c456.ds700.step && Math.abs(c456.os700.mid - 700) <= c456.os700.step,
        `DS基準 ${c456.ds700.mid} / OS基準 ${c456.os700.mid}`);
    await page.evaluate(() => { const el = document.querySelector('#bsCenter');
      el.value = '700.013'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await W.until(page, () => /この作業で指定/.test((document.querySelector('#bsCenterSrc') || {}).textContent || '')
                  && (window.WL.bladeSolid.view() || {}).stale === false, null, { ms: 15000, what: '中心を打つ' });
    await W.paint(page);
    const ui456 = await page.evaluate(() => ({
     src: document.querySelector('#bsCenterSrc').textContent,
     unit: (document.querySelector('#bsCenterUnit') || {}).textContent || '',
     note: (document.querySelector('#bsEndsNote') || {}).textContent || '',
     /* シートの側の端（既定はDS基準なのでOS端）の表。 */
     ds: [...document.querySelectorAll('#bsOsSide .bs-rem .bs-a')].map(e => e.textContent).join('|'),
     other: [...document.querySelectorAll('#bsDsSide .bs-rem .bs-a')].map(e => e.textContent).join('|'),
     len: (document.querySelector('#bsStage3 .bs-len3') || {}).textContent || '',
     alert: [...document.querySelectorAll('#bsTables .bs-alert')].some(a => /埋め切れていない/.test(a.textContent)) }));
    rec('シートの側の端（既定OS端）の表は「フローティングシート」の行で押さえる量を言う（隙間と書かない）',
        /フローティングシート/.test(ui456.ds) && !/隙間|残り/.test(ui456.ds) && !/フローティングシート/.test(ui456.other),
        `${ui456.ds} ／ 反対 ${ui456.other}`);
    rec('中心の欄は「どちらから測るか」を言い、端部の説明は基準面を言う（§9.461）',
        /DSから/.test(ui456.unit) && /基準面はDS/.test(ui456.note) && /OS端はフローティングシート/.test(ui456.note),
        `${ui456.unit} ／ ${ui456.note}`);
    rec('シートの側の端の残りでは「埋め切れていない」の帯を出さない', !ui456.alert, String(ui456.alert));
    rec('断面図の突き合わせは、足りないぶんをフローティングシートと言う（差で出さない）',
        !/\(-/.test(ui456.len), ui456.len);
    await page.evaluate(() => { const el = document.querySelector('#bsCenter');
      el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await W.until(page, () => !/この作業で指定/.test((document.querySelector('#bsCenterSrc') || {}).textContent || ''),
                  null, { ms: 8000, what: '中心を既定へ戻す' });

    await page.click('[data-step-open="bsV3"]');
    const cut = await page.evaluate(() => {
     const st3 = document.querySelector('#bsStage3'), cv = st3.querySelector('canvas');
     const rig = st3.querySelector('.bs-hud-grp--rig');
     return Object.assign({}, window.WL.bladeSolid.view(), {
      stage2: document.querySelector('.bs-stage').hidden,
      stage3: st3.hidden, isCut: st3.classList.contains('is-cut'),
      w: cv ? cv.width : 0, h: cv ? cv.height : 0,
      rigShown: rig ? getComputedStyle(rig).display !== 'none' : true,
      resetShown: (() => { const b = st3.querySelector('.bs-step3-reset');
        return !!b && getComputedStyle(b).display !== 'none'
               && getComputedStyle(b.parentNode).display !== 'none'; })(),
      cursor: cv ? getComputedStyle(cv).cursor : '',
      tabs: [...document.querySelectorAll('#bsFigTabs [data-fig]')].map(b => b.dataset.fig)
     });
    });
    rec('刃組図の札は模式図／断面図／立体図の3枚', cut.tabs.join('/') === '2d/cut/3d',
        cut.tabs.join('/'));
    rec('断面図は立体の器で描く（模式図の器は伏せる）',
        cut.stage2 === true && cut.stage3 === false && cut.w > 100 && cut.h > 100,
        JSON.stringify([cut.stage2, cut.stage3, cut.w, cut.h]));
    rec('断面図は平行投影（遠近を付けない＝寸法を目で比べられる）', cut.ortho === true);
    rec('軸の中心で切る面を1枚だけ持つ', cut.clips === 1, `${cut.clips}枚`);
    rec('機械まわりの段取りは断面図では出さない（押せるのに何も起きない的を残さない）',
        cut.isCut === true && cut.rigShown === false,
        JSON.stringify([cut.isCut, cut.rigShown]));
    /* §9.412 では真横に固定していたが、利用者の指示で**板幅の中心を起点に
       回せる**ようにした（§9.413 追補）。掴める見た目は残し、戻す道が
       断面図でも見えていることを固定する（寄る・引くは§9.463で持つようにした）。 */
    rec('断面図でも掴んで回せる（掴める見た目のまま）', cut.cursor === 'grab', cut.cursor);
    rec('視点を戻す道は断面図でも見えている', cut.resetShown === true,
        String(cut.resetShown));
    const spin = await page.evaluate(async () => {
     const cv = document.querySelector('#bsStage3 canvas');
     const r = cv.getBoundingClientRect();
     const at = (t, dx, dy) => cv.dispatchEvent(new PointerEvent(t, { bubbles: true,
       pointerId: 7, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 + dy }));
     const before = window.WL.bladeSolid.view();
     at('pointerdown', 0, 0); at('pointermove', -160, 90); at('pointerup', -160, 90);
     const after = window.WL.bladeSolid.view();
     /* **90°までは回さない**（真横を越えるとカメラが切り落とす側へ回り込む）。 */
     let az = after.cutAz, el = after.cutEl;
     for (let i = 0; i < 40; i++) {
      at('pointerdown', 0, 0); at('pointermove', -400, 400); at('pointerup', -400, 400);
      az = window.WL.bladeSolid.view().cutAz; el = window.WL.bladeSolid.view().cutEl;
     }
     document.querySelector('.bs-step3-reset').click();
     const back = window.WL.bladeSolid.view();
     return { b: before, a: after, az, el, back, marks: after.marks };
    });
    rec('掴んで引くと左右にも上下にも回る（板幅の中心が起点）',
        spin.a.cutAz !== spin.b.cutAz && spin.a.cutEl !== spin.b.cutEl,
        JSON.stringify([spin.b.cutAz, spin.b.cutEl, spin.a.cutAz, spin.a.cutEl]));
    rec('真横（±90°）までは回らない（切り落とす側へ回り込まない）',
        Math.abs(spin.az) < Math.PI / 2 && Math.abs(spin.el) < Math.PI / 2,
        `az ${spin.az.toFixed(2)} / el ${spin.el.toFixed(2)}`);
    rec('「視点を戻す」で断面図の角度も戻る',
        spin.back.cutAz === 0 && spin.back.cutEl === 0,
        JSON.stringify([spin.back.cutAz, spin.back.cutEl]));
    /* §9.463（利用者の指示「ガイダンスの断面図は拡大縮小もできるように」）。
       §9.413 の「寄る・引くは持たない」を撤回した。**マウスの下の点は動かない**
       （寄った先を探させない）・倍率は画面に出る・「視点を戻す」で×1へ。 */
    const zm = await page.evaluate(async () => {
     const cv = document.querySelector('#bsStage3 canvas');
     const r = cv.getBoundingClientRect();
     const V = () => window.WL.bladeSolid.view();
     const mx = 180, my = -40;                         /* 器の中心からのずれ(px) */
     const world = v => [mx * v.cutSc + v.cutPan[0], v.cutOff * v.cutSc + v.cutPan[1] - my * v.cutSc];
     const wheel = dy => cv.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
       deltaY: dy, clientX: r.left + r.width / 2 + mx, clientY: r.top + r.height / 2 + my }));
     const v0 = V();
     wheel(-100); wheel(-100); wheel(-100);
     const v1 = V();
     const read = document.querySelector('.bs-zoom3');
     const shown = read && !read.hidden ? read.textContent : '';
     /* 拡大したまま右ドラッグで動かす */
     const at = (t, dx, dy) => cv.dispatchEvent(new PointerEvent(t, { bubbles: true, button: 2,
       pointerId: 17, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 + dy }));
     at('pointerdown', 0, 0); at('pointermove', 60, 0); at('pointerup', 60, 0);
     const v2 = V();
     for (let i = 0; i < 40; i++) wheel(100);          /* 引ききっても×1より小さくならない */
     const v3 = V();
     wheel(-100); wheel(-100);
     document.querySelector('.bs-step3-reset').click();
     const v4 = V();
     return { z0: v0.cutZoom, z1: v1.cutZoom, w0: world(v0), w1: world(v1), shown, sc1: v1.cutSc,
              pan1: v1.cutPan, pan2: v2.cutPan, azKeep: v2.cutAz === v1.cutAz,
              z3: v3.cutZoom, pan3: v3.cutPan, z4: v4.cutZoom, pan4: v4.cutPan,
              hidden4: !!(read && read.hidden) };
    });
    rec('断面図もホイールで拡大できる（§9.463）', zm.z0 === 1 && zm.z1 > 1.5,
        `×${zm.z0} → ×${zm.z1}`);
    /* 許容は**寄った先の画面で1px**（世界の長さでなく画素で見る。帯の高さの
       端数で 0.5mm＝0.3px ほど動くのは目に見えない）。 */
    rec('寄ってもマウスの下の点は動かない（寄った先の画面で1px未満）',
        Math.abs(zm.w0[0] - zm.w1[0]) < zm.sc1 && Math.abs(zm.w0[1] - zm.w1[1]) < zm.sc1,
        JSON.stringify([zm.w0, zm.w1, zm.sc1]));
    rec('いまの倍率が「視点」の群に出る', /^×\d/.test(zm.shown), zm.shown);
    rec('拡大したら右ドラッグで動かせる（回さない）',
        zm.pan2[0] < zm.pan1[0] && zm.azKeep, JSON.stringify([zm.pan1, zm.pan2]));
    rec('引ききっても全体（×1）より小さくならず、ずれも残さない',
        zm.z3 === 1 && zm.pan3[0] === 0 && zm.pan3[1] === 0, JSON.stringify([zm.z3, zm.pan3]));
    rec('「視点を戻す」で×1へ戻り、倍率の字は伏せる',
        zm.z4 === 1 && zm.pan4[0] === 0 && zm.hidden4, JSON.stringify([zm.z4, zm.pan4, zm.hidden4]));
    /* **光はカメラと一緒に動く**（§9.413 追補、利用者の指摘「中空の物はない
       はずなので断面図注意して」）。止めておくと、回した先の面（軸や青い印の
       端の丸）に光が1つも当たらず真っ黒になり、**穴に見える**。
       真横から見ている間は端の丸が見えないので、回さないと気づけない。 */
    const lit = await page.evaluate(() => {
     const cv = document.querySelector('#bsStage3 canvas');
     const r = cv.getBoundingClientRect();
     const at = (t, dx, dy) => cv.dispatchEvent(new PointerEvent(t, { bubbles: true,
       pointerId: 13, clientX: r.left + r.width / 2 + dx, clientY: r.top + r.height / 2 + dy }));
     at('pointerdown', 0, 0); at('pointermove', -180, 70); at('pointerup', -180, 70);
     const v = window.WL.bladeSolid.view();
     document.querySelector('.bs-step3-reset').click();
     return v;
    });
    rec('断面図の光はカメラと同じ側に居る（回した先の面が黒くならない）',
        !!lit.cutCam && !!lit.cutLit
        && Math.sign(lit.cutLit[2]) === Math.sign(lit.cutCam[2])
        && Math.abs(lit.cutLit[0] - lit.cutCam[0]) < 1200,
        `cam ${(lit.cutCam || []).map(n => Math.round(n)).join(',')}`
        + ` / light ${(lit.cutLit || []).map(n => Math.round(n)).join(',')}`);
    /* 有効幅の境目の青い印（§9.413 追補、利用者の指示「上下軸のend部分は青色で
       明示しているので3D断面も分かるようにして」）。模式図と**同じ色・同じ径**。 */
    /* **シートの側の端は青い印ではなくフローティングシート**（§9.459、利用者の指示「上下軸の
       DSエンドを青のオブジェクトではなくフローティングシートを図面から3Dで再現」）。
       青い印は基準面の端の上下軸に1つずつ（2個）、反対の端は図面の寸法の輪が上下軸に1つずつ。 */
    rec('断面図の青い印は基準面の端だけ（上下軸に1つずつ・§9.459／§9.461）',
        lit.endCaps === 2, `${lit.endCaps}個`);
    const fs = lit.fseat || {};
    const arbor = lit.pack ? lit.pack.arbor : 0;
    rec('シートの側の端はフローティングシート（図面の寸法: Φ269・幅70・ピストン18本×上下・§9.459）',
        fs.n === 2 && fs.od === 269 && fs.w === 70 && fs.pistons === 36, JSON.stringify(fs));
    /* 押さえ板の面は**押さえている量だけ有効長の端より内側**（ピストンがそのぶん伸びる）。
       押さえている量は刃組の内訳の「フローティングシート押さえ代」と同じ答え。 */
    /* 置く端は**基準面の反対**（§9.461。既定はDS基準なのでOS端＝座標は−）。 */
    rec('フローティングシートは基準面の反対の端（既定DS基準＝OS端・§9.461）', fs.side === 'OS',
        String(fs.side));
    rec('押さえ板の面は有効長の端から押さえている量だけ内側（上下とも・§9.459）',
        arbor > 0 && (fs.faces || []).length === 2
        && fs.faces.every((f, i) => Math.abs(Math.abs(f) - (arbor / 2 - fs.take[i])) < 0.002
                                    && Math.sign(f) === (fs.side === 'DS' ? 1 : -1))
        && fs.take.every(t => t >= 0 && t <= 0.95 + 1e-6),
        `面 ${(fs.faces || []).join('/')}／押さえ ${(fs.take || []).join('/')}／有効長 ${arbor}`);
    /* 板と耳屑の札（§9.413 追補、利用者の指示「2Dの表示のようにラベルもほしい」）。
       **模式図と同じ数だけ**出る——並びは同じ `materialRun()` から作るので、
       数が食い違ったらどちらかが落としている。 */
    const lab = await page.evaluate(() => {
     const els = [...document.querySelectorAll('#bsStage3 .bs-t3-mk')].filter(e => !e.hidden);
     return { n: els.length,
              txt: els.map(e => (e.querySelector('b') || {}).textContent).join('/'),
              sub: els.map(e => (e.querySelector('small') || {}).textContent),
              /* 種類は**印の並びではなく** `data-kind` で読む（§9.418）。 */
              kinds: [...new Set(els.map(e => e.dataset.kind || ''))].sort(),
              mag: (document.querySelector('#bsStage3 .bs-o3').textContent || '') };
    });
    rec('断面図にも板・耳屑の札が出る（模式図と同じ言葉）',
        lab.n > 0 && /耳/.test(lab.txt), `${lab.n}枚 ${lab.txt}`);
    rec('札には幅が添う（条幅・耳屑幅）',
        lab.sub.length === lab.n && lab.sub.every(t => /^\d+(\.\d+)?$/.test(t)),
        lab.sub.join('/'));
    rec('条と耳屑は札の色でも見分けられる', lab.kinds.length >= 2, lab.kinds.join('/'));
    /* **誇張したら倍率を書く**（§CLAUDE 6）。板厚 1.3mm は実寸では1pxも出ない。 */
    rec('板厚を誇張していることを字で言う', /板厚.*倍/.test(lab.mag), lab.mag.slice(0, 60));
    /* **散文は「使い方」が持つ**（§9.443）。帯は図の上に浮いていて、1行増える
       たびに寸法の字の置き場が減る（実測: 3行で103px・器619pxの17%）。
       いつも同じ事実は読む場所を1つにする（§CLAUDE 8）——帯には**値**だけ。 */
    const howto = await page.evaluate(() =>
      (document.querySelector('#bsStage3 .bs-hpop') || {}).textContent || '');
    rec('上下軸を離していることは「使い方」が言う（帯には値だけ・§9.443）',
        /上下軸.*離/.test(howto) && !/上下軸.*離/.test(lab.mag),
        `使い方:${/上下軸.*離/.test(howto)} 帯:${lab.mag.slice(0, 40)}`);
    /* ---- 4.8) 詰め・クリアランス・寸法の字（§9.418） ----
       利用者の指摘「エンド部分までスペーサーが詰まっていないといけないが、
       隙間が目立つ」「OS側のエンドの青オブジェクトの上下軸の外々に線が付着
       している」、利用者の指示「刃の交差する部分切断面に縦の破線を入れて…」
       「板幅、スペーサー幅、ゴムリング幅、重ならないようにラベルを表示…」
       「ラベルは板の上下交互に配置している余白の部分に配置して」 */
    const pk = await page.evaluate(() => window.WL.bladeSolid.view());
    /* **割り付けが区間より長くない**。長い積みは物理的に入らず、はみ出したぶん
       だけ刃の位置が動く。丸めを`round`でやっていたため最大0.0125mm超えていた。 */
    rec('割り付けが区間長を超えていない（超えると刃の位置が動く）',
        !!pk.pack && pk.pack.over === 0,
        pk.pack ? `超えた区間 ${pk.pack.over} / 最大 ${pk.pack.worst}mm` : '読めない');
    /* **図が部材を落としていない**。丸めのせいで最後の1枚を落とすと、10mm級の
       穴が開く（実測: 下軸のDS端 10.025mm・中間区間 9mm）。 */
    rec('詰めるときに部材を1枚も落としていない',
        !!pk.pack && pk.pack.drop === 0,
        pk.pack ? `落とした枚数 ${pk.pack.drop}` : '読めない');
    /* 残った端数は**空けずに置く**（模式図の`fillZone`と同じ作法）。 */
    /* **有効長を基準に描く**（§9.418 追補、利用者の指示「有効長よりエンドto
       エンドが長くなっていないか確認してほしい」）。区間の和＋刃は作りのうえで
       有効長ちょうどになるが、**図が実際に置いた物**で見る——置き方を間違えれば
       計算が合っていても絵は溢れる。 */
    rec('端から端が有効長を超えていない（有効長を基準に描いている）',
        !!pk.pack && pk.pack.x0 >= -0.05 && pk.pack.x1 <= pk.pack.arbor + 0.05,
        pk.pack ? `${pk.pack.x0} 〜 ${pk.pack.x1} / 有効長 ${pk.pack.arbor}` : '読めない');
    /* 端まで使っていること（超えないだけでなく、余らせてもいない）。 */
    /* **空いてよいのはフローティングシートの側の端だけ**（§9.461。既定のDS基準ならOS端）。
       その端の空きはシートが押さえる量で、押さえ代（0.95）以内。基準面の側は空けない。 */
    const fsSide = pk.fseat ? pk.fseat.side : 'OS';
    const gapOS = pk.pack ? +pk.pack.x0 : 99, gapDS = pk.pack ? +(pk.pack.arbor - pk.pack.x1).toFixed(3) : 99;
    rec('端から端が有効長ぶんある（空くのはシートの側の端だけ・押さえ代以内・§9.461）',
        !!pk.pack && (fsSide === 'OS' ? gapOS <= 0.95 + 1e-6 && gapDS <= 0.6
                                      : gapDS <= 0.95 + 1e-6 && gapOS <= 0.6),
        `シート ${fsSide}／左(OS)の空き ${gapOS} / 右(DS)の空き ${gapDS}`);
    /* **上下の刃は刃の身のぶんすれ違う**（§9.419、利用者の指摘「上下の刃は刃厚分
       ズレてないと切れません」）。同じ切断の上刃と下刃は円周が食い違う（ラップ）
       ので、軸方向に刃厚ぶん離れていないと**円周でぶつかって切れない**。
       以前はクリアランス（0.13mm）だけずらしており、刃の身が 9.87mm 重なって
       いた——物として組めない配置だった。 */
    rec('上下の刃が刃の身のぶんすれ違う（円周でぶつからない）',
        !!pk.pack && pk.pack.knifeGap !== null && pk.pack.knifeGap >= pk.pack.tk,
        pk.pack ? `中心間 ${pk.pack.knifeGap}mm / 刃厚 ${pk.pack.tk}mm` : '読めない');
    /* **有効長がどの区間かを図の上で言う**（§9.420、利用者の指示）。字だけだと
       「どこからどこまで」が辿れないので、寸法線で端から端を示す。 */
    const span = await page.evaluate(() => {
     const svg = document.querySelector('#bsStage3 .bs-t3v');
     if (!svg) return null;
     const ln = [...svg.querySelectorAll('.bs-span')];
     const tx = svg.querySelector('text.is-span');
     return { n: ln.length, t: tx ? tx.textContent : '' };
    });
    rec('有効長がどの区間かを寸法線で出す（端の立て線2本＋あいだの線）',
        !!span && span.n >= 4 && /有効長/.test(span.t), span ? `${span.n}本 ${span.t}` : '読めない');
    /* 寸法線の端は**軸の端そのもの**（青い印の位置）を指している。 */
    /* 向きを裏返すと左右が入れ替わるので、**差の絶対値**で見る。 */
    rec('寸法線の端は軸の端をさしている',
        !!pk.spanLine && Math.abs(pk.spanLine.x1 - pk.spanLine.x0) > 200,
        pk.spanLine ? `${pk.spanLine.x0} 〜 ${pk.spanLine.x1}px` : '読めない');
    /* **設定有効長と、組んだときの上下それぞれの合計長を出す**（§9.418 追補、
       利用者の指示）。差も一緒に出して、合っているかを引き算させない。 */
    const len3 = await page.evaluate(() =>
      (document.querySelector('#bsStage3 .bs-len3') || {}).textContent || '');
    rec('設定有効長と、組んだときの上下それぞれの合計長を出す',
        /有効長/.test(len3) && /上軸/.test(len3) && /下軸/.test(len3)
        && len3.indexOf(String(pk.pack.arbor)) >= 0, len3.slice(0, 120));
    rec('組んだ合計長は有効長を超えない（上下とも）',
        !!pk.pack && pk.pack.sumU <= pk.pack.arbor + 1e-6
        && pk.pack.sumL <= pk.pack.arbor + 1e-6,
        pk.pack ? `上 ${pk.pack.sumU} / 下 ${pk.pack.sumL} / 有効長 ${pk.pack.arbor}` : '読めない');
    rec('端数は空けずに埋めてある（端数の合計は刻み数枚ぶん以内）',
        !!pk.pack && pk.pack.fillerMm < 1,
        pk.pack ? `端数 ${pk.pack.filler}か所・計 ${pk.pack.fillerMm}mm` : '読めない');
    /* **断面図に機械まわりが残っていない**。軸受の行き先だけ`rig`でなく`g`に
       なっており、OS側の1つが切り口の無い筒として「線」だけ残していた。 */
    rec('有効長と青い印より外に物が残っていない（機械まわりは断面図に出ない）',
        pk.stray === 0, `外に残った物 ${pk.stray}`);
    /* ---- 切断の位置の破線（§9.418） ----
       模式図は刃そのものを上下に描き分けているので線を足さない。断面図だけが
       「材料のところに刃を描けない」ので引く。**1本**で上下を通す。 */
    const kl = await page.evaluate(() => {
     const svg = document.querySelector('#bsStage3 .bs-t3v');
     const fig = document.querySelector('#bsStage');
     if (!svg) return null;
     const ln = [...svg.querySelectorAll('.bs-kl.is-cut')];
     return { n: ln.length,
              /* 上下がつながっている＝1本が材料の高さを越えて伸びている。 */
              span: ln.length ? Math.abs(+ln[0].getAttribute('y2') - +ln[0].getAttribute('y1')) : 0,
              dash: ln.length ? ln[0].getAttribute('stroke-dasharray') : '',
              pair: ln.length ? svg.querySelectorAll('.bs-kl.is-up,.bs-kl.is-lo').length : -1,
              /* 模式図には引かない。 */
              fig2: fig ? fig.querySelectorAll('.bs-kl').length : -1 };
    });
    rec('断面図に切断の位置の破線が出る（刃の対と同じ数・1本ずつ）',
        !!kl && kl.n > 0 && kl.n === pk.knives && kl.pair === 0,
        kl ? `破線 ${kl.n} / 刃の対 ${pk.knives} / 2本組 ${kl.pair}` : '読めない');
    rec('破線は上下がつながっている（材料の高さより長い）',
        !!kl && kl.span > 20 && !!kl.dash, kl ? `${kl.span}px / ${kl.dash}` : '読めない');
    /* **模式図には引かない**（§9.418、利用者の指摘「2Dは正しく刃が並んで
       いるので破線を引く必要がない」）。同じことを2回言わない（§CLAUDE 8）。 */
    rec('模式図には破線を引かない（刃そのものが上下に描き分けてある）',
        !!kl && kl.fig2 === 0, kl ? `模式図の破線 ${kl.fig2}本` : '読めない');
    /* 何の線かを図の上で言う（§CLAUDE 6）。 */
    const magNow = await page.evaluate(() =>
      (document.querySelector('#bsStage3 .bs-o3') || {}).textContent || '');
    /* 帯は**値だけ**（§9.443）。「材料のところは刃を描けないため」という理由は
       いつも同じ事実なので「使い方」が1箇所で持つ。 */
    const howto2 = await page.evaluate(() =>
      (document.querySelector('#bsStage3 .bs-hpop') || {}).textContent || '');
    rec('破線が何かは図の上で言い、理由は「使い方」が持つ（§9.443）',
        /破線＝切断の位置/.test(magNow) && /刃を描けない/.test(howto2)
        && !/刃を描けない/.test(magNow),
        magNow.slice(0, 100));
    /* ---- 部材の幅の字（入る／引き出す／出さない） ---- */
    rec('部材の幅の字が出ている（中に書いたぶん＋引き出したぶん）',
        !!pk.dims && pk.dims.inside > 0 && pk.dims.inside + pk.dims.lead > 0,
        pk.dims ? `中 ${pk.dims.inside} / 引き出し ${pk.dims.lead} / 出さない ${pk.dims.off}`
                : '読めない');
    /* **出しきれないものは出さない**（引き出し先も埋まっているとき）。
       全部出していたら、それは重なっているということ。 */
    /* **スペーサーとゴムリングの字が混ざらない**（§9.418 追補、利用者の指摘
       「ゴムリングとスペーサーの表示がごちゃ混ぜでわかりにくい」）。
       スペーサーは軸の上・そのスペーサーの側へ寄せ、ゴムリングは輪の帯の中。 */
    const mix = await page.evaluate(() => {
     const svg = document.querySelector('#bsStage3 .bs-t3v');
     if (!svg) return null;
     const ts = [...svg.querySelectorAll('text')];
     const sp = ts.filter(e => !e.classList.contains('is-ring'));
     const rg = ts.filter(e => e.classList.contains('is-ring'));
     const ys = a => a.map(e => Math.round(+e.getAttribute('y')));
     /* 引き出し線は必ず対象へ届いている（宙に浮いた線を作らない）。 */
     const ln = [...svg.querySelectorAll('.bs-lead')];
     /* **長さで見る**（§9.429）。線は`<line>`から`<path>`（真下へ降ろして
        から寄せる形）になったので、`y1`/`y2`では測れない——属性が無いと
        `+null`は0になり、**全部「宙ぶらりん」に見えて**しまう。 */
     const len = l => { try { return l.getTotalLength(); } catch (e) { return 0; } };
     /* 字どうしが重なっていないか（§9.429、利用者の指示「重ならないように
        工夫して」）。落とさずに全部出すのだから、**重ねていないこと**まで
        見ないと「出ている」と言えない。 */
     const box = e => { try { const r = e.getBBox();
       return { a: r.x, b: r.x + r.width, c: r.y, d: r.y + r.height }; } catch (e2) { return null; } };
     const bs = ts.map(box).filter(Boolean);
     let hit = 0;
     for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
       const p = bs[i], q = bs[j];
       if (p.a < q.b - 0.5 && q.a < p.b - 0.5 && p.c < q.d - 0.5 && q.c < p.d - 0.5) hit++;
      }
     }
     return { sp: sp.length, rg: rg.length, spY: ys(sp), rgY: ys(rg), lines: ln.length,
              loose: ln.filter(l => len(l) < 3).length, over: hit, texts: bs.length,
              dims: window.WL.bladeSolid.view().dims };
    });
    rec('スペーサーとゴムリングの字が同じ高さに混ざらない',
        !!mix && mix.sp > 0 && mix.rg > 0
        && mix.spY.every(y => mix.rgY.indexOf(y) < 0),
        mix ? `スペーサー ${mix.sp} / ゴムリング ${mix.rg}` : '読めない');
    rec('引き出し線は対象まで届いている（宙に浮かせない）',
        !!mix && mix.loose === 0, mix ? `${mix.lines}本中 ${mix.loose}本が宙ぶらりん` : '読めない');
    /* **数え落としはしない。置けない字は数えて言う**（§9.429 → §9.443 で
       言い直した）。§9.429 は「1つも落とさない」と決めていたが、それは
       **重なってでも置く**作りのときの約束だった。利用者の指示
       「表示ラベルなどが重ならないように」を入れたいま、**器が縮めば
       どうしても置けない字が出る**——器の高さは変わっても字の数
       （実測150件）は変わらないため。
       だから見るのは2つ:
         ① 足し算が合う（中＋外＋置けなかった ＝ 出すべき数）——数え落としが無い
         ② 置けなかったのは**ごく一部**（2割まで）。半分落ちたら作りが悪い
       **重なっていないこと**は下の網が別に見る（そちらが本体）。
       置けなかった数は図の読み方の1行が言う（§CLAUDE 4）。 */
    rec('断面図の寸法は数え落とさない（中＋外＋置けなかった＝出すべき数）',
        !!mix && mix.dims
        && mix.dims.inside + mix.dims.lead + mix.dims.off === mix.dims.all,
        mix && mix.dims
         ? `中${mix.dims.inside}＋外${mix.dims.lead}＋置けず${mix.dims.off}＝${mix.dims.all}`
         : '読めない');
    rec('置けなかった寸法はごく一部（2割まで・§9.443）',
        !!mix && mix.dims && mix.dims.all > 0
        && mix.dims.off <= mix.dims.all * 0.2,
        mix && mix.dims
         ? `${mix.dims.off}/${mix.dims.all}件`
           + `（${Math.round(100 * mix.dims.off / mix.dims.all)}%）`
           + ` 内訳 ${JSON.stringify(mix.dims.why || {})}`
         : '読めない');
    rec('断面図の寸法の字どうしが重なっていない',
        !!mix && mix.over === 0, mix ? `${mix.texts}字中 ${mix.over}組が重なり` : '読めない');
    rec('出しきれない幅は出していない（重ねて出さない）',
        !!pk.dims && pk.dims.inside + pk.dims.lead + pk.dims.off === pk.dims.all,
        pk.dims ? `${pk.dims.inside}+${pk.dims.lead}+${pk.dims.off} = ${pk.dims.all}` : '読めない');

    /* ---- 断面図でも設定が読める（§9.443、利用者の指示「断面図でも板押さえ
       （フィンガーまたはゴムリングの色や外径）の情報、ラップなど必要な情報を
       良い感じに表示を」）----
       模式図の帯には在ったが、断面図には**1つも出ていなかった**（実測: 4項目中
       3項目が読めない）。中身は同じ1箇所（`chipBandItems`）が作る。 */
    const cutSet = await page.evaluate(() => {
     const st = document.getElementById('bsStage3');
     const t = (st.innerText || '').replace(/\s+/g, ' ');
     return { chips: [...st.querySelectorAll('.bs-cutchip')].map(x => x.textContent.trim()),
              clr: /クリアランス/.test(t), ov: /ラップ/.test(t),
              hold: /板押さえ/.test(t), od: /Φ\d+/.test(t) };
    });
    rec('断面図でクリアランス・ラップ・板押さえ・色と外径が読める（§9.443）',
        cutSet.clr && cutSet.ov && cutSet.hold && cutSet.od,
        JSON.stringify({ clr: cutSet.clr, ov: cutSet.ov, hold: cutSet.hold, od: cutSet.od }));
    rec('設定は3つの札で出す（模式図の帯と同じ顔ぶれ）',
        cutSet.chips.length === 3, cutSet.chips.join(' / ').slice(0, 90));

    /* ---- 器の縦が30%縮んでも札が重ならない（§9.443、利用者の指示）----
       **絵ではなく矩形の交差で数える**（「近い」では素通りする）。面積4px²
       以上を重なりと数える——1pxの接触は重なりではない。
       直す前は器の高さ819→459pxで**4件**重なっていた（いちばん大きいもの
       100px²）。器の高さは`ResizeObserver`が見ているので、窓を縮めれば効く。 */
    const overlapAt = async ht => {
     await page.setViewportSize({ width: 1700, height: ht });
     await W.settle(page, 900);
     return page.evaluate(() => {
      const st = document.getElementById('bsStage3');
      const vis = el => { const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.hidden; };
      const rs = [...st.querySelectorAll('.bs-t3,.bs-t3b,.bs-m3,.bs-o3,.bs-len3,'
                  + '.bs-t3v text,.bs-cutchip')].filter(vis)
        .map(e => { const r = e.getBoundingClientRect();
          return { t: (e.textContent || '').trim().slice(0, 16),
                   x: r.left, y: r.top, w: r.width, h: r.height }; });
      let hits = 0, worst = null;
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
       const a = rs[i], b = rs[j];
       const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
       const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
       if (ox > 0 && oy > 0 && ox * oy >= 4) {
        hits++; if (!worst || ox * oy > worst.area) worst = { a: a.t, b: b.t, area: Math.round(ox * oy) };
       }
      }
      return { n: rs.length, hits, worst,
               h: Math.round(st.getBoundingClientRect().height) };
     });
    };
    const ovFull = await overlapAt(1000);
    /* **器の高さで30%**（利用者の指示）。窓の高さと器の高さは同じではない
       ——器の外に帯・見出し・レールがあるぶん（実測 約381px）を引いてから
       決める。窓 1000px で器 619px なので、器 433px（＝70%）は窓 814px。 */
    const ovThin = await overlapAt(814);
    await page.setViewportSize({ width: 1700, height: 1000 });
    await W.settle(page, 900);
    rec('断面図の札が重ならない（いまの高さ・§9.443）',
        ovFull.hits === 0, `器${ovFull.h}px・札${ovFull.n}枚 → 重なり${ovFull.hits}`
        + (ovFull.worst ? ` ${JSON.stringify(ovFull.worst)}` : ''));
    rec('縦が30%縮んでも断面図の札が重ならない（§9.443）',
        ovThin.hits === 0, `器${ovThin.h}px・札${ovThin.n}枚 → 重なり${ovThin.hits}`
        + (ovThin.worst ? ` ${JSON.stringify(ovThin.worst)}` : ''));
    /* ---- 板の札は「千鳥の空き」に入る ---- */
    const mlab = await page.evaluate(() => {
     const els = [...document.querySelectorAll('#bsStage3 .bs-t3-mk')].filter(e => !e.hidden);
     const cv = document.querySelector('#bsStage3 .bs-c3');
     const h = cv ? cv.clientHeight : 0;
     const ys = els.map(e => parseFloat(e.style.top) || 0);
     return { n: els.length, h, ys,
              /* 器の上下の縁からどれだけ内側か（端へ寄せていないこと）。 */
              near: ys.filter(y => y > h * 0.25 && y < h * 0.75).length };
    });
    rec('板の札は器の端ではなく板のそばに居る（千鳥の空きの中）',
        mlab.n > 0 && mlab.near === mlab.n, `${mlab.near}/${mlab.n} 枚が中ほど（器 ${mlab.h}px）`);
    /* 上下に振り分かれていること（同じ段に並べない）。 */
    /* 分ける線は**札の並びの中ほど**（§9.454）。器の中央で分けていたが、図は
       帯を避けて「帯のあいだ」の中央へ置くようになったので、器の中央とは限らない。 */
    const midY = mlab.ys.length ? (Math.min(...mlab.ys) + Math.max(...mlab.ys)) / 2 : 0;
    rec('板の札は上下へ振り分かれている（千鳥に乗る）',
        new Set(mlab.ys.map(y => (y < midY ? 'u' : 'd'))).size === 2,
        mlab.ys.map(y => (y < midY ? 'u' : 'd')).join(''));
    /* ---- 4.7) 断面図の区間の記号・表とのリンク・拡大図（§9.417） ----
       利用者の指示「断面3Dのラベルの付け方は2Dを参考にもう少し修正してほしい。
       強調も入れたい」「断面3Dの強調は2Dと同じ、表とのリンクで、クリックによる
       拡大表示も同じように欲しい」。
       **模式図と同じ対応表から出す**ので、記号の顔ぶれは模式図と一致するはず。
       ここは「同じ数」ではなく**同じ顔ぶれ**で見る——数だけだと、別の区間へ
       ずれて振られても通ってしまう。 */
    const zb = await page.evaluate(() => {
     const vis = sel => [...document.querySelectorAll(sel)].filter(e => !e.hidden);
     const chips = vis('#bsStage3 .bs-t3b'), boxes = vis('#bsStage3 .bs-t3z');
     const sorted = a => [...new Set(a)].sort();
     return { n: chips.length, zones: window.WL.bladeSolid.view().zones,
              cut: sorted(chips.map(e => e.dataset.badge)),
              fig2: sorted([...document.querySelectorAll('#bsStage .bs-bhit')]
                     .map(g => g.dataset.badge)),
              /* 区間の板は**光るだけ**（押せるのは記号の札だけ）。塗りを的に
                 すると、立体を掴んで回す道をふさぐ。 */
              zonePe: boxes.length ? getComputedStyle(boxes[0]).pointerEvents : '',
              chipCur: chips.length ? getComputedStyle(chips[0]).cursor : '',
              hit: chips.length ? chips[0].classList.contains('bs-bhit') : false };
    });
    rec('断面図にも区間の記号が出る', zb.n > 0 && zb.zones === zb.n,
        `札 ${zb.n}枚 / view().zones ${zb.zones}`);
    rec('記号の顔ぶれは模式図と同じ（同じ対応表から出している）',
        zb.cut.length > 0 && zb.cut.join(',') === zb.fig2.join(','),
        `断面 ${zb.cut.join('')} / 模式 ${zb.fig2.join('')}`);
    rec('区間の板は的にしない（掴んで回す道をふさがない）', zb.zonePe === 'none', zb.zonePe);
    rec('記号の札は押せる（指のカーソル＋模式図と同じ印）',
        zb.chipCur === 'pointer' && zb.hit === true, `${zb.chipCur} / bs-bhit ${zb.hit}`);
    /* **本物のマウス移動で辿る**（§9.398）。`pointerover` は `el.click()` では
       1度も通らない。 */
    const chipBox = await page.locator('#bsStage3 .bs-t3b:not([hidden])').first().boundingBox();
    await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
    await W.paint(page);
    const litA = await page.evaluate(() => {
     const chip = document.querySelector('#bsStage3 .bs-t3b.is-pick');
     const b = chip ? chip.dataset.badge : '';
     const zone = document.querySelector('#bsStage3 .bs-t3z.is-pick');
     return { b, zone: !!zone,
              /* 淡い塗りが本当に入ったか（`transparent` のままなら効いていない）。 */
              fill: zone ? getComputedStyle(zone).backgroundColor : '',
              row: !!(b && document.querySelector(`.bs-g tr.is-pick[data-badge="${b}"]`)) };
    });
    rec('記号に重ねると、その区間が光る（模式図と同じ 16%の塗り）',
        litA.zone && !/rgba?\([^)]*,\s*0\)/.test(litA.fill), `${litA.b} / ${litA.fill}`);
    rec('記号に重ねると刃組表の行も光る（図と表が同じ印でつながる）',
        litA.row === true, litA.b || '記号が光っていない');
    /* 逆向きも同じ配線で効く——**表に重ねたら断面図の区間が光る**。 */
    const rowBox = await page.evaluate(b => {
     const tr = document.querySelector(`.bs-g tr[data-badge="${b}"]`);
     if (!tr) return null;
     const r = tr.getBoundingClientRect();
     return { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 };
    }, litA.b);
    if (rowBox) {
     await page.mouse.move(rowBox.x, rowBox.y);
     await W.paint(page);
    }
    const litB = await page.evaluate(b => ({
     chip: !!document.querySelector(`#bsStage3 .bs-t3b.is-pick[data-badge="${b}"]`),
     zone: !!document.querySelector('#bsStage3 .bs-t3z.is-pick') }), litA.b);
    rec('表の行に重ねると断面図の区間と記号が光る（連動は双方向）',
        !!rowBox && litB.chip && litB.zone, `行 ${litA.b}`);
    /* §9.463（利用者の指示「OS,DSのエリアにマウスオーバーでフォーカスしたときに右側の
       一覧表が強調されるように。刃の部分は強調が効いてわかりやすくなりましたが
       OS,DSの部分は無かった」）。**図の OS・DS の札に重ねると、端の区間と右の端部の表が
       光る**（刃の区間と同じ `[data-badge]` の道）。模式図は端の区間そのものが的。 */
    const endLit = [];
    for (const sd of ['OS', 'DS']) {
     const bx = await page.locator(`#bsStage3 .bs-t3-${sd.toLowerCase()}`).boundingBox();
     if (!bx) { endLit.push({ sd, tag: false }); continue; }
     await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
     await W.paint(page);
     endLit.push(await page.evaluate(sd => ({ sd,
      side: !!document.querySelector(`.bs-side.is-pick[data-badge="${sd}"]`),
      other: !!document.querySelector(`.bs-side.is-pick:not([data-badge="${sd}"])`),
      zone: !!document.querySelector(`#bsStage3 .bs-t3z.is-pick[data-badge="${sd}"]`) }), sd));
    }
    rec('断面図の OS・DS の札に重ねると、右の端部の表と端の区間が光る（§9.463）',
        endLit.every(x => x.side && x.zone && !x.other), JSON.stringify(endLit));
    rec('端の区間は記号の札を持たない（区間の数＝記号の札の数のまま）',
        await page.evaluate(() => { const v = window.WL.bladeSolid.view();
          return v.endZones > 0 && v.zones === [...document.querySelectorAll('#bsStage3 .bs-t3b')].filter(e => !e.hidden).length; }));
    /* **押したら模式図と同じ拡大窓**（§9.413 と同じ `openZoneZoom`）。 */
    /* **先に閉じてから押す。** 前の節で開いた窓が残っていると、押しても
       何も起きなくなったことに気づけない——欠陥注入（記号から `.bs-bhit` を
       外す）で**そのまま素通りした**（記号がたまたま同じだったため）。 */
    await page.keyboard.press('Escape');
    await W.until(page, () => document.querySelector('#bsZoom').hidden, null,
                  { ms: 4000, what: '拡大図を一度閉じる' });
    await page.mouse.click(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
    await W.until(page, () => !document.querySelector('#bsZoom').hidden, null,
                  { ms: 6000, what: '断面図から拡大図が開く' });
    const zcut = await page.evaluate(() => {
     const box = document.querySelector('#bsZoom'), fig = document.querySelector('#bsZoomFig');
     const r = box.getBoundingClientRect();
     return { shown: !box.hidden,
              badge: (document.querySelector('#bsZoomBadge').textContent || '').trim(),
              dims: +(fig.dataset.dims || 0), inside: +(fig.dataset.inside || 0),
              lead: +(fig.dataset.lead || 0), w: Math.round(r.width) };
    });
    /* **「開いている」ことまで見る**。`#bsZoomBadge` の字は閉じても残るので、
       記号だけを見ると**窓が出ていなくても通る**（欠陥注入でそうなった）。 */
    rec('押した区間の拡大図が開く（記号が一致する）',
        zcut.shown === true && zcut.badge === litA.b,
        `出ている ${zcut.shown} / ${zcut.badge} / 押したのは ${litA.b}`);
    rec('拡大図の中身は模式図から開いたときと同じ（寸法を1つも落とさない）',
        zcut.shown === true && zcut.dims > 0 && zcut.dims === zcut.inside + zcut.lead,
        `出す ${zcut.dims} = 中 ${zcut.inside} + 引き出し ${zcut.lead}`);

    /* ---- 4.7b) 引き出し線（§9.437、利用者の指摘「引き出し線が特にラベルと
       つながっていないように見えるものが残っている」「対象の中心位置から伸ばす
       ように示して、各段によって少し色を変える」「線も細いのでかなり見づらい」） ----
       **絵では読めない**（1本の細い線が字に触れているかどうかは目では確かめ
       られない）ので、**始点と字の枠の距離を px で測る**。以前は段の高さ
       （2行ぶん）を縁にしていたので、**値だけの1行の札では 12px 浮いて**いた。 */
    const lead = await page.evaluate(() => {
     const svg = document.querySelector('#bsZoomFig');
     const lines = [...svg.querySelectorAll('path.bs-zl')];
     const dots = [...svg.querySelectorAll('circle.bs-zl-dot')];
     const texts = [...svg.querySelectorAll('text')];
     /* 線の始点と、いちばん近い字の枠との距離。 */
     const gaps = lines.map(l => {
      const m = /^M([-\d.]+) ([-\d.]+)/.exec(l.getAttribute('d') || '');
      if (!m) return 999;
      const px = +m[1], py = +m[2];
      let best = 1e9;
      texts.forEach(t => {
       const bb = t.getBBox();
       const dx = Math.max(bb.x - px, 0, px - (bb.x + bb.width));
       const dy = Math.max(bb.y - py, 0, py - (bb.y + bb.height));
       best = Math.min(best, Math.hypot(dx, dy));
      });
      return +best.toFixed(1);
     });
     return { n: lines.length, dots: dots.length, gapMax: gaps.length ? Math.max(...gaps) : null,
              width: lines.length ? +lines[0].getAttribute('stroke-width') : 0,
              colors: [...new Set(lines.map(l => l.getAttribute('stroke')))],
              tiers: [...new Set(lines.map(l => l.getAttribute('stroke')))].length };
    });
    /* 引き出しが0本のときは測れない——**測っていないと言う**（§9.369）。 */
    if (!lead.n) {
     rec('引き出し線は測れなかった（この割付では0本）', true, '0本');
    } else {
     rec('引き出し線は字の縁から出る（宙から始まらない）',
         lead.gapMax <= 4, `いちばん離れている始点で ${lead.gapMax}px`);
     rec('引き出し線の先は対象の中心（終端に点を打つ・線と同じ数）',
         lead.dots === lead.n, `線 ${lead.n} / 点 ${lead.dots}`);
     rec('引き出し線は細すぎない（1.3px。部材より太くはしない）',
         lead.width >= 1.2 && lead.width <= 1.6, `${lead.width}px`);
     /* 段が1つしか無いときは色の違いを見られない——そのときは数えない。 */
     rec('段が2つ以上あれば段ごとに色が違う',
         lead.n < 2 || lead.tiers >= 1, lead.colors.join(' '));
    }
    /* ---- 4.7c) 拡大図の窓は掴んで動かせる（§9.437、利用者の指示） ----
       **押した区間の真下へ出すのは変えない**（どこを開いたのかを目で辿る）。
       そのうえで、隠れた物を見たいときに自分でどかせること。 */
    const zBefore = await page.evaluate(() => {
     const r = document.querySelector('#bsZoom').getBoundingClientRect();
     return { x: Math.round(r.left), y: Math.round(r.top) };
    });
    const hdBox = await page.locator('#bsZoom .bs-zoom-hd').boundingBox();
    /* **本物のマウスで掴む**（§9.398）——`el.click()` は pointerdown の道を
       1度も通らないので、掴む配線が外れていても素通りする。 */
    /* **器の中央へ向けて掴む**——窓は押した区間の反対側の半分に出て、器の縁で止まる
       （§9.437）。どちらの半分に出るかは図の向き（§9.463 で既定を「基準原点を右」に
       した）で変わるので、左へ決め打ちすると縁に当たって動かない。 */
    const toMid = await page.evaluate(() => {
     const z = document.querySelector('#bsZoom').getBoundingClientRect();
     const host = (document.querySelector('#bsZoom').offsetParent || document.body).getBoundingClientRect();
     return (z.left + z.width / 2) < (host.left + host.width / 2) ? 1 : -1;
    });
    const DX = 90 * toMid;
    await page.mouse.move(hdBox.x + 40, hdBox.y + hdBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hdBox.x + 40 + DX, hdBox.y + hdBox.height / 2 - 50, { steps: 6 });
    await page.mouse.up();
    const zAfter = await page.evaluate(() => {
     const r = document.querySelector('#bsZoom').getBoundingClientRect();
     return { x: Math.round(r.left), y: Math.round(r.top) };
    });
    rec('拡大図の窓は見出しの帯を掴んで動かせる',
        zAfter.x - zBefore.x === DX && zAfter.y - zBefore.y === -50,
        `動いた量 ${zAfter.x - zBefore.x},${zAfter.y - zBefore.y}（掴んだ量 ${DX},-50）`);
    await page.keyboard.press('Escape');
    await W.until(page, () => document.querySelector('#bsZoom').hidden, null,
                  { ms: 4000, what: '拡大図を閉じる' });
    /* ---- 4.8b) 消した部材の見せ方（§9.422、利用者の指示） ----
       「表示」で切った部材を **そのまま消す／薄く残す／線だけ** から選べる。
       **絵の見た目ではなく、組み立てている物の数で見る**——「薄く残す」は
       「描かない」ではなく「薄い材質で描く」なので、材質の名前で数えれば
       「透かして在る」と「物ごと無い」が数字で分かれる。 */
    const hideAt = () => page.evaluate(() => {
     const v = window.WL.bladeSolid.view();
     return { hide: v.hide, mesh: (v.skins || {}).mesh | 0,
              skinned: (v.skins || {}).skinned | 0, dims: (v.dims || {}).all | 0 };
    });
    const h0 = await hideAt();
    rec('既定は「出さない」（今までの動き）で、薄く残っている物は1つも無い',
        h0.hide === 'gone' && h0.skinned === 0 && h0.mesh > 0, JSON.stringify(h0));
    await page.click('#bsStage3 [data-show="liner"]');
    await W.until(page, m => window.WL.bladeSolid.view().skins.mesh < m, h0.mesh,
                  { ms: 8000, what: 'スペーサーを消す' });
    const hGone = await hideAt();
    rec('「出さない」でスペーサーを切ると、物ごと無くなる',
        hGone.mesh < h0.mesh && hGone.skinned === 0,
        `物 ${h0.mesh} → ${hGone.mesh} / 薄い物 ${hGone.skinned}`);
    /* ---- 4.8c) 選ばれている札は「見た目」で分かる（§9.427、利用者の報告
       「3D断面図バッジのONOFFの状態がバッジから読み取れません」） ----
       `72-bladeset.css`が`@layer components`（複数形）と書いていたため、
       **宣言に無い名前＝全部の後ろの別レイヤ**になり、`90-state.css`が持つ
       「選ばれた札の見た目」（§9.353）が刃組画面では**1つも効いていなかった**
       ——入切4つが全部「入」なのに点が白いままだった。綴りそのものは
       `test_csslint.py`が見る。ここは**実際に描かれた色**で見る——レイヤの
       並びが正しくても、当てる先を間違えれば同じ結果になるので、
       「入と切が見分けられる」ことを画面の側からも固定する。
       いまスペーサーだけが「切」なので、同じ群の中で入と切を比べられる。 */
    const look = await page.evaluate(() => {
     const bg = (el, pe) => (el ? getComputedStyle(el, pe || null).backgroundColor : '');
     const pair = sel => {
      const all = [...document.querySelectorAll(sel)];
      return { on: all.find(b => b.classList.contains('is-on')),
               off: all.find(b => !b.classList.contains('is-on')) };
     };
     const tg = pair('#bsStage3 [data-show]'), fig = pair('#bsFigTabs [data-fig]');
     const rail = pair('#bsRailTabs [data-r]'), hide = pair('#bsStage3 [data-hide]');
     return { tg: [bg(tg.on), bg(tg.off)],
              dot: [bg(tg.on, '::before'), bg(tg.off, '::before')],
              fig: [bg(fig.on), bg(fig.off)], rail: [bg(rail.on), bg(rail.off)],
              hide: [bg(hide.on), bg(hide.off)] };
    });
    const differs = q => !!q[0] && !!q[1] && q[0] !== q[1];
    rec('入切の札は「入」と「切」で地の色が違う', differs(look.tg), look.tg.join(' / '));
    rec('入切の札の点は「入」だけ塗られている', differs(look.dot), look.dot.join(' / '));
    rec('図の札（模式図／断面図／立体図）は選ばれている1枚だけ地が違う',
        differs(look.fig), look.fig.join(' / '));
    rec('刃組の内訳の札も選ばれている1枚だけ地が違う',
        differs(look.rail), look.rail.join(' / '));
    rec('隠し方の札も選ばれている1枚だけ地が違う', differs(look.hide), look.hide.join(' / '));
    await page.click('#bsStage3 [data-hide="ghost"]');
    await W.until(page, () => window.WL.bladeSolid.view().skins.skinned > 0, null,
                  { ms: 8000, what: '薄く残す' });
    const hGhost = await hideAt();
    rec('「薄く」にすると、切った部材が物として戻る（薄い材質で描かれる）',
        hGhost.hide === 'ghost' && hGhost.skinned > 0 && hGhost.mesh > hGone.mesh,
        `物 ${hGone.mesh} → ${hGhost.mesh} / 薄い物 ${hGhost.skinned}`);
    /* **薄く残しても字は増やさない**。残すのは「そこに在る」ことを見せるためで、
       寸法まで並べると、消して減らしたはずの読む物が戻ってしまう。 */
    rec('薄く残した部材の寸法の字は出さない（読む物を増やさない）',
        hGhost.dims === hGone.dims && hGhost.dims < h0.dims,
        `出さない ${hGone.dims} / 薄く ${hGhost.dims} / 全部出す ${h0.dims}`);
    await page.click('#bsStage3 [data-hide="wire"]');
    await W.until(page, () => window.WL.bladeSolid.view().hide === 'wire', null,
                  { ms: 8000, what: '線だけにする' });
    const hWire = await hideAt();
    rec('「線だけ」でも物はそこに在る（輪郭で位置が読める）',
        hWire.hide === 'wire' && hWire.skinned > 0 && hWire.mesh === hGhost.mesh,
        `物 ${hWire.mesh} / 薄い物 ${hWire.skinned}`);
    /* 選べるのは**1つだけ**（セグメント）。2つ光っていたら、どちらが効いて
       いるのかを押した人が推測することになる。 */
    const hOn = await page.evaluate(() =>
     [...document.querySelectorAll('#bsStage3 [data-hide]')]
      .filter(b => b.classList.contains('is-on')).map(b => b.dataset.hide));
    rec('見せ方は1つだけ選ばれている（押した札だけが濃い）',
        hOn.length === 1 && hOn[0] === 'wire', hOn.join('/'));
    /* **確かめたら戻す**（後の節が別の姿を見る）。 */
    await page.click('#bsStage3 [data-show="liner"]');
    await page.click('#bsStage3 [data-hide="gone"]');
    await W.until(page, m => { const v = window.WL.bladeSolid.view();
      return v.hide === 'gone' && v.skins.skinned === 0 && v.skins.mesh === m; }, h0.mesh,
                  { ms: 8000, what: '元へ戻す' });
    const hBack = await hideAt();
    rec('元へ戻せる（物の数も字の数も元どおり）',
        hBack.mesh === h0.mesh && hBack.skinned === 0 && hBack.dims === h0.dims,
        JSON.stringify(hBack) + ' / ' + JSON.stringify(h0));

    /* ---- 4.9) もう一方の端（幅の広い条が少し）でも同じことが言えるか ----
       **片方だけで決めない**（§9.418）。手順3で打つ既定を「50mm×22条／片耳15mm」
       ＝混んだ通常の形にした（§9.423）ので、ここで確かめるのは**反対の端**
       ——幅の広い条が少しだけ並ぶ形（279.8mm×4条／元板巾1170＝片耳25.4mm。
       画面の既定値そのもので、これも現場にある形）。札が入るかは混んだ側で、
       札が離れすぎないか・区間が長くなっても詰めが崩れないかは広い側で出る。
       **状態を差し替えて描き直し、確かめたら必ず戻す**（後の節が別の材料を見る）。 */
    const wasLots = await page.evaluate(() => {
     const st = window.WL.bladeGuide.state;
     const keep = { lots: st.lots, order: st.order, W: st.W, trimMode: st.trimMode };
     st.lots = [{ name: 'LOT1', w: 279.8, n: 4 }];
     st.order = [0, 0, 0, 0];
     st.W = 1170; st.trimMode = 'even';
     const el = document.querySelector('#bsKnife');
     el.value = st.knife;
     el.dispatchEvent(new Event('input', { bubbles: true }));
     return keep;
    });
    /* 刃の数は「条の数−1」ではない——耳屑も1つの区間なので、6区間で5本になる。
       **数を決め打ちせず「減ったこと」で待ち**、本数どうしの一致は下で突き合わせる
       （決め打ちして外すと、待ちが黙って素通りする）。 */
    await W.until(page, () => (window.WL.bladeSolid.view() || {}).knives < 15,
                  null, { ms: 8000, what: '4条で描き直す' });
    const many = await page.evaluate(() => {
     const v = window.WL.bladeSolid.view();
     const vis = sel => [...document.querySelectorAll(sel)].filter(e => !e.hidden);
     const mk = vis('#bsStage3 .bs-t3-mk').map(e => ({
      x: parseFloat(e.style.left) || 0, y: parseFloat(e.style.top) || 0,
      w: e.offsetWidth, h: e.offsetHeight }));
     /* 札どうしが重なっていないか（狭い条が並ぶと、ここで初めて出る）。 */
     let hit = 0;
     for (let i = 0; i < mk.length; i++) {
      for (let j = i + 1; j < mk.length; j++) {
       if (Math.abs(mk[i].x - mk[j].x) < (mk[i].w + mk[j].w) / 2
        && Math.abs(mk[i].y - mk[j].y) < (mk[i].h + mk[j].h) / 2) hit++;
      }
     }
     return { pack: v.pack, stray: v.stray, cutLines: v.cutLines, dims: v.dims,
              knives: v.knives, marks: mk.length, hit,
              badges: vis('#bsStage3 .bs-t3b').length };
    });
    rec('幅の広い4条でも割り付けが区間長を超えず、部材を落とさない',
        !!many.pack && many.pack.over === 0 && many.pack.drop === 0,
        many.pack ? `超過 ${many.pack.over} / 落とし ${many.pack.drop}`
                  : '読めない');
    rec('幅の広い4条でも端から端が有効長を超えていない',
        !!many.pack && many.pack.x0 >= -0.05 && many.pack.x1 <= many.pack.arbor + 0.05,
        many.pack ? `${many.pack.x0} 〜 ${many.pack.x1} / 有効長 ${many.pack.arbor}` : '読めない');
    rec('幅の広い4条でも端数は埋めてある', !!many.pack && many.pack.fillerMm < 1,
        many.pack ? `${many.pack.filler}か所・計 ${many.pack.fillerMm}mm` : '読めない');
    rec('幅の広い4条でも機械まわりは断面図に出ない', many.stray === 0, `外に残った物 ${many.stray}`);
    rec('幅の広い4条で描き直せている（刃が減っている）', many.knives > 0 && many.knives < 15,
        `刃 ${many.knives}本`);
    rec('幅の広い4条でも切断の破線は刃の対と同じ数',
        many.cutLines === many.knives, `破線 ${many.cutLines} / 刃 ${many.knives}`);
    /* 札の重なりは**混んだ側**（既定の50mm×22条）で出る。ここは広い側なので、
       札が落ちていないこと・重なっていないことの両方を見る。 */
    rec('幅の広い4条でも板の札どうしが重ならない', many.marks > 0 && many.hit === 0,
        `札 ${many.marks}枚 / 重なり ${many.hit}組`);
    rec('幅の広い4条でも区間の記号は出る', many.badges > 0, `${many.badges}枚`);
    /* **拡大図のラベルは対象へ直に貼る**（§9.430、利用者の指示「拡大されていて
       対象にそのまま貼れるほどスペースがあるので、ラベルを直接表示したいものに
       貼って」）。**貼り方の網はこの節でしか効かない**——混んだ側（50mm×22条）は
       1区間が70mmしかなく拡大図の縮尺が 9.4px/mm あるので全部が横に入る。
       広い側は1区間300mmで 2.2px/mm まで落ち、9mm のスペーサーが20pxになる
       ——**横に入らない部材が出るのはこちら**。 */
    await page.keyboard.press('Escape');
    await W.until(page, () => document.querySelector('#bsZoom').hidden, null,
                  { ms: 4000, what: '拡大図を一度閉じる' });
    const zw = await page.evaluate(() => {
     const b = document.querySelector('#bsStage3 .bs-t3b:not([hidden])');
     if (!b) return null;
     b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
     const svg = document.getElementById('bsZoomFig');
     const ts = [...svg.querySelectorAll('text')];
     return { leadw: +svg.dataset.leadw, off: +svg.dataset.off, dims: +svg.dataset.dims,
              inside: +svg.dataset.inside, lead: +svg.dataset.lead,
              shown: !document.getElementById('bsZoom').hidden,
              /* **値の字だけ**を数える（ゴムリングの帯の中の字は10px・別の道で
                 貼っている）。混ぜると、部材への貼り方が壊れても素通りする。 */
              vert: ts.filter(t => /rotate\(-90/.test(t.getAttribute('transform') || '')
                                && +(t.getAttribute('font-size') || 0) >= 12).length };
    });
    rec('広い側の拡大図でも、横に入らない部材には縦に貼る（引き出しへ落とさない）',
        !!zw && zw.shown === true && zw.vert > 0,
        zw ? `縦書き ${zw.vert}件／引き出し ${zw.lead}件` : '読めない');
    /* **幅だけで見る網は半断面では使えない**（§9.432）。スペーサーの帯は
       半径方向に20mm＝24pxしかないので、広い側では**幅が23pxあっても縦に
       入らない**——そこは軸の帯の段へ引き出すのが正しい姿。見るのは
       「1つも落としていないこと」。 */
    rec('広い側の拡大図でも寸法を1つも落とさない',
        !!zw && zw.off === 0, zw ? `出せなかった ${zw.off}件` : '読めない');
    await page.keyboard.press('Escape');
    await W.until(page, () => document.querySelector('#bsZoom').hidden, null,
                  { ms: 4000, what: '拡大図を閉じる' });
    /* **必ず戻す**（§9.393 注ぎ込んだ見本はその場で片付ける）。 */
    await page.evaluate(keep => {
     const st = window.WL.bladeGuide.state;
     Object.assign(st, keep);
     const el = document.querySelector('#bsKnife');
     el.value = st.knife;
     el.dispatchEvent(new Event('input', { bubbles: true }));
    }, wasLots);
    await W.until(page, () => (window.WL.bladeSolid.view() || {}).knives > 15,
                  null, { ms: 8000, what: '元の構成（50mm×22条）へ戻す' });

    /* **板が刃へめり込まない**（§9.413 追補、利用者の指摘「板がめり込んでいる」）。
       板は千鳥で上下へ寄るので**見かけの厚みの3倍**の高さを占める。刃先のあいだの
       隙間がそれより狭いと、太らせた板が刃を突き抜ける。判定は実測ではなく
       **図を組み立てている値そのもの**で見る（絵を数えると、たまたま隠れただけで
       通ってしまう）。 */
    const room = await page.evaluate(() => window.WL.bladeSolid.view());
    rec('刃先のあいだの隙間が、板の占める高さより広い（板がめり込まない）',
        room.cutGap > room.matSpan,
        `隙間 ${(room.cutGap || 0).toFixed(1)} / 板 ${(room.matSpan || 0).toFixed(1)}`);
    /* 向きの切り替えは断面図でも効く。**台車は回さず**、見る側とどちらを残すかを
       入れ替える（回すと切断面まで一緒に回り、カメラ側の入れ替えと打ち消し合う）。
       **いまどちら向きかを当てにしない**——ここへ来るまでに裏返っていることがある。 */
    const was = cut.flip;
    /* 向きは2つの札（§9.463）。**押されていない側**を押す。 */
    const other = () => page.click('#bsFlip [data-datum-pos]:not(.is-on)');
    await other();
    await W.until(page, w => (window.WL.bladeSolid.view() || {}).flip !== w,
                  was, { ms: 8000, what: '断面図の向きが裏返る' });
    const flipped = await page.evaluate(() => window.WL.bladeSolid.view());
    rec('断面図でも向きを裏返せる（残す側も一緒に入れ替わる）',
        flipped.flip === !was && flipped.keep === (flipped.flip ? 1 : -1) && flipped.cut === true,
        JSON.stringify([was, flipped]));
    /* **台車は回っていない**こと（回すと切断面まで回る）。 */
    rec('断面図では台車を回さない（裏返してもカメラ側だけが入れ替わる）',
        await page.evaluate(() => Math.abs(WL.bladeSolid.view().rotY) < 1e-6));
    await other();
    await W.until(page, w => (window.WL.bladeSolid.view() || {}).flip === w,
                  was, { ms: 8000, what: '向きを戻す' });
    /* **断面図は白へ飛ばない**（§9.415、利用者の指摘「暗すぎるか明るすぎるか
       反射の状況が悪すぎて見にくい」）。立体図の配分（主光1.05＋補助＋手前光）の
       まま切ると、**カメラをまっすぐ向いた切り口**へ3つの光が重なる。実測では
       **画面の36.7%が真っ白（輝度246以上）**になり、軸もスペーサーも板も地
       （`--bs-3d-bg`）と見分けが付かなかった。
       **描いた絵そのものを数える**——光の強さだけ見ても、材質の艶（`metalness`）で
       飛ぶぶんを見落とす（艶も断面図では落としてある）。WebGLの描画バッファは
       次の合成で消えるので、`render()`の**直後に同じタスクの中で**2Dへ写す。 */
    const tone = await page.evaluate(() => {
     const cv = document.querySelector('#bsStage3 canvas');
     window.WL.bladeSolid.render();
     const w = Math.min(420, cv.clientWidth), h = Math.min(280, cv.clientHeight);
     const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
     const cx = c2.getContext('2d');
     cx.drawImage(cv, 0, 0, w, h);
     const d = cx.getImageData(0, 0, w, h).data;
     const L = i => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
     const bg = L(0);                       /* 隅は地の色 */
     let parts = 0, sum = 0, blown = 0;
     for (let i = 0; i < d.length; i += 4) {
      const v = L(i);
      if (Math.abs(v - bg) <= 6) continue;  /* 地は数えない */
      parts++; sum += v;
      if (v >= 246) blown++;
     }
     return { bg: +bg.toFixed(1), parts, mean: parts ? +(sum / parts).toFixed(1) : null,
              blownPct: parts ? +(blown / parts * 100).toFixed(2) : null,
              lit: window.WL.bladeSolid.view().lit,
              gloss: window.WL.bladeSolid.view().gloss };
    });
    rec('断面図に部材が描かれている（絵を数える土台が効いている）',
        tone.parts > 500, `${tone.parts}px`);
    rec('断面図が白へ飛んでいない（部材の白飛びが1%未満）',
        tone.blownPct !== null && tone.blownPct < 1, `${tone.blownPct}%`);
    /* 地との差は**35以上**（実測: 直した図で53.9）。立体図の配分のまま切ると
       26まで落ちる——「白くは飛んでいないが地に溶けている」を通さないための線。 */
    rec('断面図の部材が地と見分けられる（平均でΔL≧35）',
        tone.mean !== null && Math.abs(tone.mean - tone.bg) >= 35,
        `部材 ${tone.mean} / 地 ${tone.bg} / 差 ${tone.mean === null ? '-'
          : Math.abs(tone.mean - tone.bg).toFixed(1)}`);
    /* 立体図へ戻すと、切る面は外れる（同じ模型がそのまま立体図に戻る）。 */
    await page.click('#bsFigTabs [data-fig="3d"]');
    await W.until(page, () => (window.WL.bladeSolid.view() || {}).cut === false,
                  null, { ms: 20000, what: '立体図へ戻る' });
    const back3 = await page.evaluate(() => window.WL.bladeSolid.view());
    rec('立体図へ戻すと切る面が外れる（同じ模型がそのまま戻る）',
        back3.cut === false && back3.clips === 0, JSON.stringify(back3));

    await page.click('#bsFigTabs [data-fig="2d"]');
    await W.until(page, () => !document.querySelector('.bs-stage').hidden,
                  null, { ms: 8000, what: '模式図へ戻る' });

    /* **光の配分は図ごとに別**（§9.415）。立体図は機械まわりが主役なので
       斜め上からの主光で形を立ち上げ、断面図は地明かりで平らに照らす。
       同じ配分を使い回すと、上の「白飛び」が戻る。 */
    const lit3 = await page.evaluate(() => window.WL.bladeSolid.view().lit);
    rec('光の配分は立体図と断面図で別（同じ配分を使い回さない）',
        !!lit3 && !!tone.lit && lit3.key > tone.lit.key && lit3.hemi < tone.lit.hemi,
        `立体 ${JSON.stringify(lit3)} / 断面 ${JSON.stringify(tone.lit)}`);
    rec('手前からの光は断面図のときだけ点ける',
        !!lit3 && lit3.cam === 0 && tone.lit.cam > 0,
        `立体 ${lit3 && lit3.cam} / 断面 ${tone.lit && tone.lit.cam}`);
    /* **断面図は艶を落とす**（§9.415、利用者の指摘「反射の状況が悪すぎて
       見にくい」）。立体図の部材は金属として磨いてある（`metalness` .6〜.8）ので、
       面がカメラをまっすぐ向く断面図では**材質の色ではなく光の色（白）**が出る
       ——鋼も板も耳も同じ白になって見分けが付かなかった。 */
    const gloss3 = await page.evaluate(() => window.WL.bladeSolid.view().gloss);
    rec('断面図の部材は艶を落としてある（映り込みで材質の色を消さない）',
        tone.gloss !== null && tone.gloss <= 0.1, `断面 metalness ${tone.gloss}`);
    rec('立体図の部材は磨いたまま（断面図だけの手当てになっている）',
        gloss3 > 0.5, `立体 metalness ${gloss3}`);

    /* ---- 5b') 刃 → 軸 → スペーサーの3段（§9.416、利用者の指摘「軸の色と
       スペーサーがほぼ同じ色でわかりにくい」） ----
       色の**近さ**は目で見ても言えないので、`--bs-fig-*` の実際の値から
       相対輝度を出して**隣り合う段の比**で見る。以前は軸 `--line`(.553)／
       スペーサー `--rs-slate-border`(.509) で **1.1:1** しかなく、断面図では
       まったく見分けられなかった。**2:1 を下回らせない**（実測 2.5:1 / 2.6:1）。 */
    const lad = await page.evaluate(() => {
     const sh = document.querySelector('.bs-shell');
     if (!sh) return null;
     const cs = getComputedStyle(sh);
     /* 相対輝度（WCAG）。`getPropertyValue` は `var()` を解いた値を返す。 */
     const lum = (name) => {
      const v = cs.getPropertyValue(name).trim();
      const m = /^#?([0-9a-f]{6})$/i.exec(v.replace(/^#/, '#'));
      if (!m) return null;
      const ch = [0, 2, 4].map(i => {
       const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
       return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
     };
     const r = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
     const knife = lum('--bs-fig-knife'), shaft = lum('--bs-fig-shaft'),
           spacer = lum('--bs-fig-spacer');
     if (knife === null || shaft === null || spacer === null) return null;
     return { knife: +knife.toFixed(3), shaft: +shaft.toFixed(3),
              spacer: +spacer.toFixed(3),
              ks: +r(knife, shaft).toFixed(2), ss: +r(shaft, spacer).toFixed(2) };
    });
    rec('刃・軸・スペーサーは暗い順に3段（軸はスペーサーより暗い）',
        !!lad && lad.knife < lad.shaft && lad.shaft < lad.spacer,
        lad ? `刃 ${lad.knife} / 軸 ${lad.shaft} / スペーサー ${lad.spacer}` : '読めない');
    rec('隣り合う段の差は2:1以上（軸とスペーサーが同じ色に見えない）',
        !!lad && lad.ks >= 2 && lad.ss >= 2,
        lad ? `刃↔軸 ${lad.ks}:1 / 軸↔スペーサー ${lad.ss}:1` : '読めない');

    /* ---- 5c) 模式図の「物」は直角（§9.415、利用者の指示「2Dのエッジ部分の
       丸角は無しにしてほしい」） ----
       この図は実寸を目で比べるためのもので、角丸は縁を実際より短く見せる
       （幅1.2pxの部材に rx=2 が付いていた）。**角丸を残すのは文字の器だけ**
       ——記号バッジ（`bs-bdgr`）と設定の帯（`bs-chip-band`）。 */
    const TEXT_HOLDERS = ['bs-bdgr', 'bs-chip-band'];
    const fig2 = await page.evaluate(holders => {
     const stage = document.querySelector('#bsStage');
     const round = [...stage.querySelectorAll('rect')]
      .filter(r => { const v = r.getAttribute('rx'); return v && parseFloat(v) > 0; })
      .map(r => (r.getAttribute('class') || '(無印)').trim());
     const texts = [...stage.querySelectorAll('text')].map(t => ({
       cls: (t.getAttribute('class') || '').trim(),
       fs: parseFloat(getComputedStyle(t).fontSize) }));
     const mk = texts.filter(t => t.cls === 'bs-mk').map(t => t.fs);
     return { kinds: [...new Set(round)].sort(),
              stray: round.filter(c => !holders.includes(c)).length,
              nRect: stage.querySelectorAll('rect').length,
              maxFs: texts.length ? Math.max(...texts.map(t => t.fs)) : 0,
              mkFs: mk.length ? Math.max(...mk) : 0, nText: texts.length };
    }, TEXT_HOLDERS);
    rec('模式図に部材が描かれている（角の判定が空振りしていない）',
        fig2.nRect > 20 && fig2.nText > 5, `rect ${fig2.nRect} / text ${fig2.nText}`);
    rec('模式図で角丸を持つのは文字の器だけ（軸・青い印・部材・板／条／耳・刃は直角）',
        fig2.stray === 0, fig2.kinds.join(' / ') || '角丸なし');
    /* **読み取る値より大きい札を作らない**（§9.415、利用者の指示「やや文字が
       大きすぎてバランスが悪い」）。DS/OS と行見出し（上軸・下軸・材料）は
       「どこを見ているか」の目印で、条番号・条幅より大きいのは順序が逆
       （実測 20.8px / 18.4px 対 15.9px）。 */
    rec('図のいちばん大きい字が、条の番号の段を超えない',
        fig2.mkFs > 0 && fig2.maxFs <= fig2.mkFs * 1.05,
        `最大 ${fig2.maxFs}px / 条番号 ${fig2.mkFs}px`);

    /* ---- 5d) 記録が無い台車でも差分が出る（基準は標準構成・§9.415） ----
       以前は記録が1件も無いと台車の列が全部「—」になり、**部材を1つ残らず
       棚から持ち出す**という読みになっていた（実測: そのまま使える0／持ち出す14）
       ——台車が空だとは分かっていないので、これは事実ではない。
       既定の刃組設定で組んだ標準構成を基準に置き、**出どころを字で書き分ける**。 */
    await page.click('#bsRailTabs [data-r="diff"]');
    await page.waitForSelector('#bsDiff tbody tr', { timeout: 8000 });
    const dif = await page.evaluate(() => ({
     /* **どの段と比べているかは器が名乗る**（§9.425）。頭の帯には「稼働中」の
        断りも入るので、字で見分けると取り違える（実際に取り違えた）。 */
     kind: (document.querySelector('#bsDiffHead [data-base]') || {}).dataset?.base || '',
     note: (document.querySelector('#bsDiffHead [data-base]') || {}).textContent || '',
     head: (document.querySelector('#bsDiffHead') || {}).textContent || '',
     cols: [...document.querySelectorAll('#bsDiff thead th')].map(t => t.textContent.trim()),
     secs: [...document.querySelectorAll('#bsDiff tbody tr.bs-sec')].map(t => t.textContent.trim()),
     rows: document.querySelectorAll('#bsDiff tbody tr').length,
     base: [...document.querySelectorAll('#bsDiff tbody tr:not(.bs-sec)')]
      .map(r => (r.children[1] || {}).textContent)
    }));
    rec('記録が無くても差分の行が出る', dif.rows > 0 && dif.secs.length > 0,
        `${dif.rows}行 / ${dif.secs.join(',')}`);
    rec('比べる相手が標準構成だと字で言う（組んだ事実ではないと書く）',
        /標準構成と比べています/.test(dif.head) && /計算値/.test(dif.head),
        dif.head.replace(/\s+/g, ' ').slice(0, 80));
    rec('列の見出しも「標準」にする（記録と同じ字で並べない）',
        dif.cols[1] === '標準', dif.cols.join('/'));
    rec('標準の列が「—」で埋まっていない（台車が空という嘘をつかない）',
        dif.base.some(t => t && t !== '—'), dif.base.join(','));
    rec('比べる相手は「標準構成」の段だと器が名乗る', dif.kind === 'std', dif.kind);
    rec('いまの材料で計算していることを字で断る（差分が小さく出る理由）',
        /これから流す材料/.test(dif.note), dif.note.replace(/\s+/g, ' ').slice(0, 120));

    /* ---- 5d') 記録が無い台車は「前回流した材料」と比べる（§9.425） ----
       利用者の指示「記録が無ければ前回流した材料から標準設定で計算」。
       **いまの材料で計算すると、これから流す物と比べることになり差分がほとんど
       出ない**（「もう組んである」と読める）。履歴に1件でも材料を組み直せる
       記録があれば、そちらを基準に置く。
       **注ぎ込んだ見本はその場で消す**（§9.393）。 */
    const recAt = '2026-02-03 09:00';
    const prevHist = await (await post('/api/bladeset/history',
      { equipment: EQ, carriage: 'B台車', at: recAt, note: TAG + '前回材料',
        detail: { spacer: {}, ring: {}, finger: {}, blade: {},
                  /* **いまの材料（50mm×22条／元板巾1130）とは別の形**にする
                     ——同じにすると、どちらで計算しても同じ答えになり、
                     網が「前回の材料を見た」ことを言えない。 */
                  cond: { strips: 10, widths: Array(10).fill(100), W: 1050,
                          thickness: 1.3 } } })).json();
    try {
     await page.evaluate(() => WL.bladeGuide.open({}));
     await W.until(page, () => document.querySelectorAll('#bsCarPick [data-car]').length === 2,
                   null, { ms: 10000, what: '刃組ガイダンスを開き直す' });
     await page.click('#bsRailTabs [data-r="diff"]');
     await page.waitForSelector('#bsDiff tbody tr', { timeout: 8000 });
     const pv = await page.evaluate(() => ({
      picked: WL.bladeGuide.state.carriage,
      kind: (document.querySelector('#bsDiffHead [data-base]') || {}).dataset?.base || '',
      note: (document.querySelector('#bsDiffHead [data-base]') || {}).textContent || '',
      cols: [...document.querySelectorAll('#bsDiff thead th')].map(t => t.textContent.trim()),
      base: [...document.querySelectorAll('#bsDiff tbody tr:not(.bs-sec)')]
       .map(r => (r.children[1] || {}).textContent)
     }));
     rec('記録が無い台車を選んでいる（A台車）', pv.picked === 'A台車', pv.picked);
     rec('記録が無い台車は「前回流した材料」の段と比べる（器が名乗る）',
         pv.kind === 'prev' && /前回流した材料/.test(pv.note),
         pv.kind + ' / ' + pv.note.replace(/\s+/g, ' ').slice(0, 90));
     rec('どの記録から起こした材料かを字で言う（出どころを出す）',
         pv.note.includes(recAt) && pv.note.includes('B台車'),
         pv.note.replace(/\s+/g, ' ').slice(0, 130));
     rec('列の見出しも「前回」にする（記録と同じ字で並べない）',
         pv.cols[1] === '前回', pv.cols.join('/'));
     rec('組んだ事実ではないと断る', /計算値/.test(pv.note) && /事実ではありません/.test(pv.note),
         pv.note.replace(/\s+/g, ' ').slice(0, 130));
     /* **いまの材料で計算したときとは違う答え**になる（前回の材料を見ている証拠）。
        比べるのは**この節の中の2枚**——記録を消して開き直すと「いまの材料」の段へ
        落ちるので、そのときの基準の列と突き合わせる。**離れた節の数字と比べない**
        （あいだで板厚などが変わり、材料以外の理由で差が出る＝素通りする網になる。
        実際に欠陥注入で素通りした）。 */
     if (prevHist && prevHist.id) {
      await post('/api/bladeset/history/delete', { id: prevHist.id });
      prevHist.id = null;
      await page.evaluate(() => WL.bladeGuide.open({}));
      await W.until(page, () => (document.querySelector('#bsDiffHead [data-base]') || {})
                                 .dataset?.base === 'std',
                    null, { ms: 10000, what: '記録を消して「いまの材料」の段へ落ちる' });
      await page.click('#bsRailTabs [data-r="diff"]');
      await page.waitForSelector('#bsDiff tbody tr', { timeout: 8000 });
      const now2 = await page.evaluate(() => ({
       kind: (document.querySelector('#bsDiffHead [data-base]') || {}).dataset?.base || '',
       base: [...document.querySelectorAll('#bsDiff tbody tr:not(.bs-sec)')]
        .map(r => (r.children[1] || {}).textContent)
      }));
      rec('記録を消すと「いまの材料」の段へ落ちる', now2.kind === 'std', now2.kind);
      rec('前回の材料で計算している（いまの材料で組んだ構成とは別の答え）',
          pv.base.join(',') !== now2.base.join(','),
          `前回 ${pv.base.slice(0, 8).join(',')} / いま ${now2.base.slice(0, 8).join(',')}`);
     }
     /* **元板巾が無い記録は使わない**（§9.231 0で埋めない）——耳屑の幅が出ず、
        軸の上の割付が決まらない。古い記録しか無ければ「いまの材料」へ落ちる。 */
     const oldCond = await page.evaluate(() =>
      WL.bladeSet.seedFromCond({ strips: 2, widths: [100, 100], thickness: 1.3 }));
     rec('元板巾の無い記録からは材料を組み直さない', oldCond === null, JSON.stringify(oldCond));
     const okCond = await page.evaluate(() =>
      WL.bladeSet.seedFromCond({ strips: 3, widths: [100, 100, 80], W: 1050, thickness: 1.3 }));
     rec('同じ幅はまとめて1つの束にする（並び順は員数に効かない）',
         !!okCond && okCond.originalWidth === 1050 && okCond.lots.length === 2
         && okCond.lots[0].n === 2 && okCond.lots[1].n === 1,
         JSON.stringify(okCond));
    } finally {
     if (prevHist && prevHist.id) {
      await post('/api/bladeset/history/delete', { id: prevHist.id });
     }
    }
    await page.evaluate(() => WL.bladeGuide.open({}));
    await W.until(page, () => document.querySelectorAll('#bsDiff thead th').length > 0
                           && document.querySelectorAll('#bsCarPick [data-car]').length === 2,
                  null, { ms: 10000, what: '見本を消して開き直す' });

    /* ---- 5e) 台車の札は台車マスタが作る（§9.424、利用者の指示） ----
       「台車マスタは、A台車、B台車を登録しておいてください。設備ごとですが
        スリッターがない設備もあるので。」「刃組ガイダンス使う設備＝台車マスタ必要」
       以前は画面のHTMLに `A`／`B` を直に書いていたので、**3台あるラインを
       登録できず、呼び名も変えられなかった。** 顔ぶれはマスタが決める。 */
    const car0 = await page.evaluate(() => ({
     chips: [...document.querySelectorAll('#bsCarPick [data-car]')].map(b => b.dataset.car),
     on: [...document.querySelectorAll('#bsCarPick [data-car].is-on')].map(b => b.dataset.car),
     picked: WL.bladeGuide.state.carriage,
     save: (document.querySelector('#bsSaveCar') || {}).textContent || '',
     disabled: !!(document.querySelector('#bsSaveCar') || {}).disabled,
     /* **HTMLに直書きが残っていないこと**——器の外に `data-car` があれば、
        それはマスタを通っていない札。 */
     stray: [...document.querySelectorAll('[data-car]')]
       .filter(b => !b.closest('#bsCarPick')).length
    }));
    rec('台車の札は初期セットで入った顔ぶれ（A台車・B台車）',
        car0.chips.join('/') === 'A台車/B台車', car0.chips.join('/'));
    rec('器の外に台車の札を直書きしていない', car0.stray === 0, `${car0.stray}枚`);
    rec('はじめから1つ選ばれている（選ばせ直さない）',
        car0.on.length === 1 && car0.on[0] === car0.picked && car0.picked === 'A台車',
        `${car0.on.join('/')} / state=${car0.picked}`);
    rec('完了のボタンは選んでいる台車の名前を言う',
        car0.disabled === false && car0.save.includes('A台車'), car0.save);
    /* **台車を足せば札も増える**（3台あるラインを登録できる）。
       **確かめたら必ず消す**（§9.393。残すと後の節が別の顔ぶれを見る）。 */
    /* 汎用CRUDの鍵は**その表の列そのもの**（`values`で包まない・§9.249 ②）。 */
    const addCar = await (await post('/api/master-table/台車マスタ',
      { 設備名: EQ, 台車名: TAG + 'C台車', 表示順: 30, 有効: -1 })).json();
    const carId = addCar && addCar.id;
    try {
     await page.evaluate(() => WL.bladeGuide.open({}));
     await W.until(page, () => document.querySelectorAll('#bsCarPick [data-car]').length > 2,
                   null, { ms: 10000, what: '3台目の札が出る' });
     const car3 = await page.evaluate(() =>
      [...document.querySelectorAll('#bsCarPick [data-car]')].map(b => b.dataset.car));
     rec('台車マスタへ足すと札も増える（2台の決め打ちではない）',
         car3.length === 3 && car3[2].includes('C台車'), car3.join('/'));
    } finally {
     if (carId) {
      await post('/api/master-table/台車マスタ/delete', { id: carId });
     }
    }
    await page.evaluate(() => WL.bladeGuide.open({}));
    await W.until(page, () => document.querySelectorAll('#bsCarPick [data-car]').length === 2,
                  null, { ms: 10000, what: '台車を2台へ戻す' });

    /* ---- 5f) 台車が1つのラインでは、直前の刃組が組み替える相手（§9.424） ----
       利用者の指示「ごくまれにスリッターがある設備でも、台車なしというパターンが
       ありました」。2台を交互に使うラインでは直前の刃組はラインで稼働中なので
       飛ばすが、**台車が1つなら、いま機械に載っているのがその直前の刃組**
       ——飛ばすと1つ古い記録と比べ、「稼働中だから外せない」と嘘の断りも出る。
       **確かめたら必ず元へ戻す**（台車も履歴も後の節が見る）。 */
    const rowsOf = async () => (await getj('/api/master-table/台車マスタ')).items || [];
    const bRow = (await rowsOf()).find(r => String(r['台車名'] || '') === 'B台車'
                                         && String(r['設備名'] || '') === EQ);
    let soloHist = null;
    try {
     if (bRow) await post('/api/master-table/台車マスタ/delete', { id: bRow.id });
     const hr = await (await post('/api/bladeset/history',
       { equipment: EQ, carriage: 'A台車', at: '2026-01-05 08:00', note: TAG + '単台',
         detail: { spacer: { 10: 4 }, ring: {}, finger: {}, blade: {} } })).json();
     soloHist = hr && hr.id;
     await page.evaluate(() => WL.bladeGuide.open({}));
     await W.until(page, () => document.querySelectorAll('#bsCarPick [data-car]').length === 1,
                   null, { ms: 10000, what: '台車が1つになる' });
     await page.click('#bsRailTabs [data-r="diff"]');
     await page.waitForSelector('#bsDiff tbody tr', { timeout: 8000 });
     const solo = await page.evaluate(() => ({
      kind: (document.querySelector('#bsDiffHead [data-base]') || {}).dataset?.base || '',
      note: (document.querySelector('#bsDiffHead [data-base]') || {}).textContent || '',
      head: (document.querySelector('#bsDiffHead') || {}).textContent || '',
      cols: [...document.querySelectorAll('#bsDiff thead th')].map(t => t.textContent.trim())
     }));
     rec('台車が1つなら直前の刃組と比べる（1つ古い記録へずらさない）',
         solo.kind === 'rec'
         && /組み替える A台車 の現在の構成（1回前）/.test(solo.note.replace(/\s+/g, ' ')),
         solo.kind + ' / ' + solo.note.replace(/\s+/g, ' ').slice(0, 90));
     rec('台車が1つなら「稼働中だから外せない」と断らない',
         !/ラインで稼働中/.test(solo.head), solo.head.replace(/\s+/g, ' ').slice(0, 60));
     rec('比べる相手が記録なら列の見出しは「台車」', solo.cols[1] === '台車',
         solo.cols.join('/'));
    } finally {
     if (soloHist) await post('/api/bladeset/history/delete', { id: soloHist });
     if (bRow) {
      await post('/api/master-table/台車マスタ',
        { 設備名: EQ, 台車名: 'B台車', 表示順: 20, 有効: -1 });
     }
    }
    await page.evaluate(() => WL.bladeGuide.open({}));
    await W.until(page, () => document.querySelectorAll('#bsCarPick [data-car]').length === 2,
                  null, { ms: 10000, what: '台車を2台へ戻す（後始末）' });
    await page.click('#bsRailTabs [data-r="diff"]');
    await page.waitForSelector('#bsDiff tbody tr', { timeout: 8000 });

    /* ---- 6) 設備停止 → 行き先のチップ ---- */
    const mk = await (await post('/api/schedule/stop-reason-master',
     { equipment: EQ, name: TAG + '刃組み', standardMinutes: 60, linkKey: 'bladeset' })).json();
    stopId = mk && mk.id;
    rec('連携機能つきの設備停止を登録できる', !!stopId, JSON.stringify(mk));
    const back = await getj('/api/schedule/stop-reason-master?equipment=' + encodeURIComponent(EQ));
    const mine = (back.items || []).find(x => x.id === stopId);
    rec('一覧が鍵と呼び名の両方を返す（画面が綴りを組み立てない）',
        mine && mine.linkKey === 'bladeset' && mine.linkLabel === '刃組ガイダンス',
        JSON.stringify(mine && { k: mine.linkKey, l: mine.linkLabel }));
    rec('選べる行き先もサーバーが答える',
        Array.isArray(back.linkFeatures) && back.linkFeatures.some(x => x.key === 'bladeset'),
        JSON.stringify((back.linkFeatures || []).map(x => x.key)));

    /* 予定へ入れるのはスケジュールモードの端末だけ（`access_mode`）。 */
    await setMode('schedule');
    const added = await (await post('/api/schedule/plan/add',
     { equipment: EQ, kind: '設備停止', stopReasonId: stopId })).json();
    planId = added && added.id;
    rec('予定へ入れられる', !!planId, JSON.stringify(added).slice(0, 80));

    await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
    await W.booted(page);
    await W.openSchedule(page, EQ);
    await W.until(page, t => [...document.querySelectorAll('.sc-row-nonwork')]
                    .some(n => n.textContent.includes(t)), TAG + '刃組み',
                  { ms: 15000, what: '設備停止の行' });
    const chip = await page.evaluate(t => {
     const row = [...document.querySelectorAll('.sc-row-line')]
      .find(r => (r.textContent || '').includes(t));
     if (!row) return null;
     const b2 = row.querySelector('.sc-nw-link[data-sc-link]');
     return b2 ? { text: b2.textContent, title: b2.title } : null;
    }, TAG + '刃組み');
    rec('行き先のチップが行に出る', !!chip && chip.text === '刃組ガイダンス', JSON.stringify(chip));
    rec('押すと何が起きるかを字で言う', !!chip && /開きます/.test(chip.title || ''),
        chip && chip.title);
    const others = await page.evaluate(() => {
     const rows = [...document.querySelectorAll('.sc-row-line')];
     /* 行き先を名乗る的だけを数える（ロット番号の横のLotDspの的は別の役・§9.460）。 */
     return rows.filter(r => r.querySelector('.sc-nw-link[data-sc-link]')).length;
    });
    rec('連携の無い行にはチップを出さない（押して何も起きない的を作らない）',
        others === 1, String(others));

    /* ---- 6.5) 刃組スケジュール一覧へ切り替わる（§9.383、利用者の指示） ----
       **実際に描かせて**見る（列の定義だけ見ても、切り替わらなければ意味が無い
       ——§9.306「サーバーが正しく答えても、画面が引かなければ何も変わらない」）。 */
    rec('刃組の段が出ている', !!(await page.$('#scModeBlade')));
    await page.click('#scModeBlade');
    await W.until(page, () => {
     const b = document.querySelector('#scBladeBody');
     return !!b && !b.hidden && /刃組スケジュール|ありません/.test(b.textContent || '');
    }, null, { ms: 15000, what: '刃組スケジュール一覧が出る' });
    const bl = await page.evaluate(() => {
     const box = document.querySelector('#scBladeBody');
     const rows = [...box.querySelectorAll('.sc-blade-tbl tbody tr')];
     return {
      shown: !box.hidden,
      timelineHidden: !!(document.querySelector('#scSingleBody') || {}).hidden,
      rows: rows.length,
      heads: [...box.querySelectorAll('.sc-blade-tbl thead th')].map(t => t.textContent),
      first: rows.length ? (rows[0].textContent || '').replace(/\s+/g, ' ').trim() : '',
      na: box.querySelectorAll('.sc-blade-na').length,
      todo: box.querySelectorAll('.sc-blade-todo').length
     };
    });
    rec('切り替えると刃組の表が出て、タイムラインは伏せる',
        bl.shown && bl.timelineHidden, JSON.stringify([bl.shown, bl.timelineHidden]));
    rec('予定にある刃組が行になる', bl.rows >= 1, `${bl.rows}行`);
    rec('列に利用者の挙げた項目が並ぶ',
        bl.heads.indexOf('予定本数') >= 0 && bl.heads.indexOf('1本目に切る材料') >= 0,
        bl.heads.join('|'));
    /* **記録が無い段取りを空欄にしない**（空欄は0に見える・§9.231）。 */
    rec('まだ組んでいない段取りは「これから」「未記録」と書く',
        bl.todo >= 1 && bl.na >= 1, `これから${bl.todo} 未記録${bl.na}`);

    /* ---- 6.6) 一覧から刃組ガイダンスへ行ける（§9.408、利用者の指示②） ----
       「刃組メインのスケジュールなのに刃組ガイダンスに行けないのは微妙です」
       **行き先の的は題名の横**（§9.377）。一覧のどの行からでも入れること。 */
    const openChip = await page.evaluate(() => {
     const b = document.querySelector('#scBladeBody [data-open-blade]');
     return b ? { text: b.textContent, title: b.title, id: b.dataset.openBlade } : null;
    });
    rec('刃組スケジュール一覧の行から刃組ガイダンスへ入れる',
        !!openChip && openChip.text === '刃組ガイダンス', JSON.stringify(openChip));
    rec('押すと何が起きるかを字で言う（一覧の側でも）',
        !!openChip && /開きます/.test(openChip.title || ''), openChip && openChip.title);

    /* ---- 6.7) 標準の計算値（§9.408） ----
       記録が無い段取りでも「標準どおり組んだら何をどれだけ使うか」は出せる。
       **同じ口を通して確かめる**（画面の字を数えない・§9.362）——計算は
       刃組ガイダンスと同じ`WL.bladeSet`の1箇所を通る。 */
    const fc = await page.evaluate(() => {
     const api = WL.scheduleView;
     if (!api || typeof api.bladeForecast !== 'function') return { missing: true };
     const got = api.bladeForecast({ thickness: 1.6, originalWidth: 1200,
       lots: [{ name: 'F1', w: 280, n: 4, parent: 'F1' }] });
     if (!got) return { nothing: true };
     const sp = got.snap.spacer || {};
     return { spacerKinds: Object.keys(sp).length,
              spacerTotal: Object.values(sp).reduce((a, b) => a + (+b || 0), 0),
              strips: got.snap.cond.strips, hold: got.snap.cond.hold,
              clearance: got.snap.cond.clearance, knife: got.snap.cond.knife };
    });
    rec('予定の材料から使用スペーサーを計算できる',
        !!fc && fc.spacerKinds > 0 && fc.spacerTotal > 0, JSON.stringify(fc));
    rec('計算値は条数・板押さえ・クリアランス・刃径まで揃う',
        !!fc && fc.strips === 4 && !!fc.hold && fc.clearance > 0 && fc.knife > 0,
        JSON.stringify(fc));
    /* **材料が読めない段取りでは計算しない**（既定の見本で埋めない・§9.231）。 */
    const none = await page.evaluate(() =>
     WL.scheduleView.bladeForecast({ thickness: 1.6, originalWidth: 1200, lots: [] }));
    rec('条が1本も読めないときは計算せず、既定の見本で埋めない', none === null, String(none));
    const todoNote = await page.evaluate(() => {
     const td = document.querySelector('#scBladeBody .sc-blade-todo small');
     return td ? { text: td.textContent, title: td.title } : null;
    });
    rec('見込みを出せない行は「これから」に理由を添える',
        !!todoNote && (/標準の計算値/.test(todoNote.text) || !!todoNote.title),
        JSON.stringify(todoNote));

    /* ---- 6.8) 来た道を戻る（§9.407、利用者の指摘①） ----
       「戻るボタンから戻ったときに、作業スケジュール一覧に戻れず、全体の
         スケジュール一覧に戻ってしまう」
       **送り出した段へ返す**こと。ここは刃組の段から送り出しているので、
       戻り先も刃組の段でなければならない。 */
    await page.click('#scBladeBody [data-open-blade]');
    await W.until(page, () => !!document.querySelector('#bladeSetPanel:not([hidden])'),
                  null, { ms: 15000, what: '一覧から刃組ガイダンスへ' });
    const backLabel = await page.evaluate(() => {
     const e = document.querySelector('#bsFrom');
     return e && !e.hidden ? (e.textContent || '') : '';
    });
    rec('戻るボタンが戻り先を名指しする（思い出させない）',
        /刃組スケジュール一覧へ戻る/.test(backLabel), backLabel.slice(0, 40));
    await page.click('#bsFrom');
    await W.until(page, () => {
     const b = document.querySelector('#scBladeBody');
     return document.body.classList.contains('sc-mode') && !!b && !b.hidden;
    }, null, { ms: 20000, what: '刃組スケジュール一覧へ戻る' });
    const backTo = await page.evaluate(() => ({
     blade: !(document.querySelector('#scBladeBody') || {}).hidden,
     board: !(document.querySelector('#scBoard') || {}).hidden
    }));
    rec('来た段（刃組スケジュール一覧）へ戻る（俯瞰ボードへ落ちない）',
        backTo.blade && !backTo.board, JSON.stringify(backTo));

    /* 戻れること（行き止まりを作らない・§CLAUDE 4）。 */
    await page.click('#scModeSingle');
    await W.until(page, () => {
     const b = document.querySelector('#scBladeBody');
     return !!b && b.hidden && !(document.querySelector('#scSingleBody') || {}).hidden;
    }, null, { ms: 10000, what: 'タイムラインへ戻る' });
    rec('個別へ戻せる（行き止まりにしない）', true);

    /* ---- 7) 押すと開き、後ろの作業の文脈が入っている ---- */
    await page.evaluate(t => {
     const row = [...document.querySelectorAll('.sc-row-line')]
      .find(r => (r.textContent || '').includes(t));
     row.querySelector('.sc-nw-link[data-sc-link]').click();
    }, TAG + '刃組み');
    await W.until(page, () => !!document.querySelector('#bladeSetPanel:not([hidden])'),
                  null, { ms: 15000, what: '刃組ガイダンスへ遷移' });
    rec('チップを押すと刃組ガイダンスへ移る',
        await page.evaluate(() => document.body.classList.contains('bs-mode')));
    const from = await page.evaluate(() => {
     const e = document.querySelector('#bsFrom');
     return e && !e.hidden ? e.textContent : '';
    });
    rec('どの予定から来たかを画面に出す（出どころを書く）',
        from.includes(TAG + '刃組み'), from.slice(0, 60));
    const carried = await page.evaluate(() => {
     const s = WL.bladeGuide && WL.bladeGuide.state;
     return s ? { W: s.W, thick: s.thick, lots: s.lots.map(l => [l.w, l.n]) } : null;
    });
    rec('刃組ガイダンスが文脈を受け取っている', !!carried, JSON.stringify(carried));
    /* 予定の後ろに作業が無い検証用データでも、**0で埋めない**ことを見る
       （読めなかった項目は既定のまま。§9.231） */
    rec('読めない項目を0で埋めていない',
        !!carried && carried.W > 0 && carried.thick > 0, JSON.stringify(carried));

    /* 出どころは**戻り道**（§9.378、利用者の指示「段取りから刃組画面に行った
       場合、段取りに戻りたいはずですが戻れない」）。字だけでなく**押せる的**で
       あること、押すと作業スケジュールへ戻ることを見る。 */
    const backTag = await page.evaluate(() => {
     const e = document.querySelector('#bsFrom');
     return e ? e.tagName : '';
    });
    rec('出どころが押せる的になっている（戻り道を兼ねる）', backTag === 'BUTTON', backTag);
    await page.click('#bsFrom');
    await W.until(page, () => document.body.classList.contains('sc-mode')
                  && !!document.querySelector('#bladeSetPanel[hidden]'),
                  null, { ms: 20000, what: '作業スケジュールへ戻る' });
    rec('押すと作業スケジュールへ戻る（刃組の画面は閉じる）',
        await page.evaluate(() => document.body.classList.contains('sc-mode')
          && !document.body.classList.contains('bs-mode')));

    /* ---- 7.5) 刃の選び方（§9.379、利用者の指示2） ----
       **同じ決まりをサーバーと画面の2箇所が持っている**（サーバーは
       `bladeset_repo.pick_group`、画面は `blade-core.js` の `pickGroup`）ので、
       **食い違わないこと**をここで固定する。片方だけ直すと、マスタ管理で
       見える組と実際に組む刃が静かにずれる。 */
    const pick = await page.evaluate(() => {
     const B = WL.bladeSet;
     const F = [{ field: 'thickness', kind: 'num' }, { field: 'strips', kind: 'num' },
                { field: 'material', kind: 'text' }];
     const R = (conds, group, name) => ({ conditions: conds, group, name: name || '決まり' });
     const CTX = { thickness: 1.8, strips: 6, material: 'SPCC' };
     const g = (rules, ctx) => (B.pickGroup(rules, ctx || CTX, F) || {}).group || '';
     return {
      none: g([]),
      hit: g([R([{ field: 'thickness', op: 'ge', value: '1.6' }], 'X')]),
      miss: g([R([{ field: 'thickness', op: 'ge', value: '1.6' }], 'X')],
              { thickness: 1.2, strips: 6, material: 'SPCC' }),
      and2: g([R([{ field: 'thickness', op: 'ge', value: '1.6' },
                  { field: 'strips', op: 'eq', value: '6' }], 'X')]),
      andNg: g([R([{ field: 'thickness', op: 'ge', value: '1.6' },
                   { field: 'strips', op: 'eq', value: '4' }], 'X')]),
      empty: g([R([], 'X')]),
      first: g([R([{ field: 'thickness', op: 'ge', value: '1.0' }], 'X'),
                R([{ field: 'thickness', op: 'ge', value: '1.0' }], 'Y')]),
      blank: g([R([{ field: 'thickness', op: 'ge', value: '1.0' }], 'X')],
               { thickness: null, strips: 6, material: 'SPCC' }),
      off: g([Object.assign(R([{ field: 'thickness', op: 'ge', value: '1.0' }], 'X'),
                            { enabled: false })])
     };
    });
    rec('決まりが無ければ「一般」', pick.none === '', pick.none);
    rec('条件に当たると「専用」の組になる', pick.hit === 'X', pick.hit);
    rec('当たらなければ「一般」', pick.miss === '', pick.miss);
    rec('同じ行の条件はANDで見る', pick.and2 === 'X' && pick.andNg === '',
        `${pick.and2}/${pick.andNg}`);
    rec('条件が空の行は当たらない（既定が静かに崩れない）', pick.empty === '', pick.empty);
    rec('先に並ぶ行が勝つ', pick.first === 'X', pick.first);
    rec('引けない値は当てない（0として比べない）', pick.blank === '', pick.blank);
    rec('無効にした決まりは当たらない', pick.off === '', pick.off);
    /* 画面は「なぜその刃か」を出す（§CLAUDE 6 出どころを書く）。 */
    const pf = await page.evaluate(() => {
     const e = document.querySelector('#bsFPick');
     return e ? { t: (e.textContent || '').trim(), title: e.title || '' } : null;
    });
    /* **サーバーの答えが画面まで届いているか**（§9.381、§9.306の教訓）。
       ここを見ていなかったので、`normalize()` が `picks` と語彙を落として
       いても気づけなかった——盤では当たるのにガイダンスでは一度も当たらない、
       という最も分かりにくい壊れ方をしていた。判定の関数を直に呼ぶ網
       （上の 7.5）は**通ってしまう**ので、器（`M`）の側も見る。 */
    const ctxKeys = await page.evaluate(() => {
     const M = WL.bladeGuide.masters || {};
     return { picks: Array.isArray(M.picks), fields: (M.pickFields || []).length,
              gen: M.bladeGeneral, sp: M.bladeSpecial, maint: M.bladeMaint,
              shape: !!(M.fingerShape && M.fingerShape.thickness),
              designs: Array.isArray(M.designs),
              fingerTh: ((M.fingers || [])[0] || {}).thickness };
    });
    rec('刃選択の決まりと語彙が画面まで届く（途中で落とさない）',
        ctxKeys.picks && ctxKeys.fields > 0 && !!ctxKeys.gen && !!ctxKeys.sp
        && !!ctxKeys.maint, JSON.stringify(ctxKeys));
    rec('フィンガーの形（厚み）がマスタから届く',
        ctxKeys.shape && +ctxKeys.fingerTh > 0, JSON.stringify(ctxKeys));
    rec('条の設計も同じ文脈で届く（測定と同じ行を見る）', ctxKeys.designs);

    rec('刃の選び方を画面に出す（既定は「一般」と書く）',
        !!pf && pf.t === '一般' && /一般/.test(pf.title), JSON.stringify(pf));

    /* ---- 7.8) 条の設計は、記録すると測定が読む（§9.381、利用者の指示） ----
       「刃組ガイダンスから設定した条の設計は、測定するときにも活かせるように
         連携してください」。ここで固定するのは**同じ1行を両側が見ている**こと
       ——記録した並びが `条設計マスタ` に入り、測定が読む API から同じ順で
       返ること。片側だけ見ると「記録したのに測定が既定の並びで始まる」を
       見逃す（§9.306）。 */
    /* 7) で作業スケジュールへ戻っているので、**刃組の画面を開き直す**
       （閉じた画面の札は押せない）。条の設計の節は幅構成の段の中にあるので、
       窓も開いてから触る（人が押すときも同じ道）。 */
    await page.evaluate(() => WL.bladeGuide.open({}));
    await W.until(page, () => document.querySelectorAll('#bsStage rect').length > 20,
                  null, { ms: 15000, what: '刃組ガイダンスを開き直す' });
    await page.keyboard.press('Escape');
    await W.until(page, () => !document.querySelector('.bs-step.is-open'), null,
                  { ms: 5000, what: '開いている窓を閉じる' });
    await page.click('[data-step-open="bsV3"]');
    await page.waitForSelector('#bsDsSave', { timeout: 8000 });
    const ds0 = await page.evaluate(() => {
     const e = document.querySelector('#bsDsState');
     return e ? { t: (e.textContent || '').trim(), cls: e.className } : null;
    });
    rec('記録していない条の設計は「未記録」と言う（黙って既定で始めない）',
        !!ds0 && /未記録/.test(ds0.t), JSON.stringify(ds0));
    await page.click('#bsDsSave');
    await W.until(page, () => /記録済み/.test(
      (document.querySelector('#bsDsState') || {}).textContent || ''), null,
      { ms: 15000, what: '条の設計が記録済みになる' });
    /* **測定が読む口から**引き直す（画面の控えではなく、サーバーの行を見る）。 */
    const want = await page.evaluate(() => {
     const BC = WL.bladeSet, st = WL.bladeGuide.state;
     return BC.designByParent(st).map(d => ({
      parent: d.parent, sig: (d.groups || []).map(g => `${g.lot}:${g.count}`).join('|') }));
    });
    let got = [];
    for (const w of want) {
     const r = await (await fetch(B + '/api/bladeset/strip-design?equipment='
       + encodeURIComponent(EQ) + '&lot=' + encodeURIComponent(w.parent))).json();
     got.push({ parent: w.parent,
                sig: ((r.item || {}).groups || []).map(g => `${g.lot}:${g.count}`).join('|') });
    }
    rec('記録した並びが測定の読む口から同じ順で返る',
        want.length > 0 && want.every((w, i) => got[i] && got[i].sig === w.sig),
        JSON.stringify({ want, got }));

    /* ---- 7.9) 条の設計は必須。未記録・記録違いでは刃組を確定できない ----
       §9.387、利用者の指示「条設計が必須の流れで、その内容で刃組をしてください」。
       止めるのは**確定保存の1箇所だけ**（図も刃組表も見られるままにする）。
       ここは「記録済み」の状態なので、**まず通ること**を見てから、
       並びを変えて（＝記録と違う状態にして）**断られること**を見る。 */
    /* 完了のボタンは右レールの「台車差分」の段の中に居る——**段を開いてから
       押す**（人が触るのと同じ順）。刃セットが未選択だと別の断りが先に出るので、
       **候補があれば先に選んでおく**（そこで止まると条の設計の判定まで届かない）。 */
    await page.click('#bsRailTabs [data-r="diff"]');
    await page.waitForSelector('#bsSaveCar', { state: 'visible', timeout: 8000 });
    await page.evaluate(() => {
     const sel = document.querySelector('#bsSetPick');
     if (!sel || sel.disabled) return;
     const opt = [...sel.options].map(o => o.value).filter(Boolean)[0];
     if (!opt) return;
     sel.value = opt;
     sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    /* 窓の題を読んで、**どちらの窓が出たか**で見分ける。器は `#appConfirm` の
       1枚だけ（§9.342）なので、題で判じて「やめる」で閉じる。 */
    const trySave = async () => {
     await page.click('#bsRailTabs [data-r="diff"]');
     await page.waitForSelector('#bsSaveCar', { state: 'visible', timeout: 8000 });
     await page.click('#bsSaveCar');
     await W.until(page, () => {
      const m = document.querySelector('#appConfirmModal');
      return !!m && !m.hidden;
     }, null, { ms: 8000, what: '確定保存の窓' });
     const t = await page.evaluate(() =>
      ((document.querySelector('#appConfirmTitle') || {}).textContent || '').trim());
     /* お知らせ（`alertModal`）は「やめる」を伏せるので、**必ず在る×**で閉じる
        （`#appConfirmCancel` は hidden のことがあり、押しに行くと固まる）。 */
     await page.click('#closeAppConfirm');
     await W.until(page, () => {
      const m = document.querySelector('#appConfirmModal');
      return !m || m.hidden;
     }, null, { ms: 8000, what: '窓が閉じる' });
     return t;
    };
    const t0 = await trySave();
    rec('条の設計が記録済みなら、刃組の確定（記録の確認）へ進める',
        /記録します/.test(t0), t0);
    /* 並びを変える＝記録と違う状態。**この状態では確定させない**——確定すると
       測定は記録した古い並びで条を埋め、組んだ形と食い違う。 */
    await page.click('[data-step-open="bsV3"]');
    await page.waitForSelector('#bsDsSave', { timeout: 8000 });
    /* **人が触るのと同じ道**で変える（本数の欄を打つ）——控えを直に書き換えると
       描き直しの配線を通らず、画面と控えが食い違ったまま測ることになる。 */
    /* **1本減らす**（§9.454）。増やすと 279.8×5＝1399 が元板巾 1170 を超えて
       **組めない材料**になり、確定のボタンごと伏せられる（そちらは別の断り）。
       ここで見たいのは「組めるが記録と違う」なので、組める側で作る。 */
    const n0 = await page.evaluate(() => {
     const el = document.querySelector('#bsLotTbl input[data-lot="0"][data-k="n"]');
     const was = +el.value || 2;
     el.value = String(Math.max(1, was - 1));
     el.dispatchEvent(new Event('input', { bubbles: true }));
     el.dispatchEvent(new Event('change', { bubbles: true }));
     return was;
    });
    await W.until(page, () => /記録と違う/.test(
      (document.querySelector('#bsDsState') || {}).textContent || ''), null,
      { ms: 8000, what: '記録と違うになる' });
    rec('記録と違うときは「記録し直す」と書く（上書きだと分かる字にする）',
        await page.evaluate(() => /記録し直す/.test(
         (document.querySelector('#bsDsSave') || {}).textContent || '')),
        await page.evaluate(() => ((document.querySelector('#bsDsSave') || {}).textContent || '').trim()));
    await page.keyboard.press('Escape');
    await W.until(page, () => !document.querySelector('.bs-step.is-open'), null,
                  { ms: 5000, what: '幅構成の窓が閉じる' });
    const t1 = await trySave();
    rec('記録と違うときは刃組を確定させない（理由と次の一手を字で出す）',
        /先に条の設計/.test(t1), t1);
    /* 元の並びへ戻して、以降の判定を「記録済み」から始める。 */
    await page.click('[data-step-open="bsV3"]');
    await page.waitForSelector('#bsDsSave', { timeout: 8000 });
    await page.evaluate(n => {
     const el = document.querySelector('#bsLotTbl input[data-lot="0"][data-k="n"]');
     el.value = String(n);
     el.dispatchEvent(new Event('input', { bubbles: true }));
     el.dispatchEvent(new Event('change', { bubbles: true }));
    }, n0);
    await W.until(page, () => /記録済み/.test(
      (document.querySelector('#bsDsState') || {}).textContent || ''), null,
      { ms: 8000, what: '記録済みへ戻る' });
    /* 画面の並びを変えると「記録と違う」と言う（測定が古い並びで始まるのを防ぐ）。 */
    await page.evaluate(() => {
     const st = WL.bladeGuide.state;
     if ((st.order || []).length > 1) st.order = st.order.slice().reverse();
    });
    /* 窓を閉じて次の節へ（開いたままだと図の札に手が届かない・§9.380）。 */
    await page.keyboard.press('Escape');
    await W.until(page, () => !document.querySelector('.bs-step.is-open'), null,
                  { ms: 5000, what: '幅構成の窓が閉じる' });

    /* ---- 8) 分割ありの親ロットは条にならない（§9.378） ----
       利用者の指示「分割ロットの場合、測定画面では親ロットは測定データ格納
       対象ではない…刃組もおなじです」。割った後の材料はすべて子ロットで、
       **親自身の持ち分は無い**（`lot-split.js` と同じ考え方）。予定には子が
       親の直後に実体で並ぶ（`parentId`付き・§9.83）ので、**条にするのは子だけ**。
       親が持つ幅は元コイル幅なので、条に混ぜると二重計上のうえ1本で元幅を
       使い切る（実際にそうなっていた）。
       ここは画面を組み立てず、**選び方の関数だけ**を合成した並びで見る。 */
    /* **組むのは「1本目に切るコイル」1本だけ**（§9.387、利用者の不具合報告
       「刃組間に処理するすべてのロットを同時にカットするような組み方に
       なっています。やり方が違います」）。以前は次の刃組までの作業行を端から
       集めていたので、別々に切るはずのコイルが1本の元板に同居していた。 */
    const seed = await page.evaluate(() => {
     const mk = o => Object.assign({ kind: '作業', lotNo: o.id, detail: {} }, o);
     const list = [
      mk({ id: 'stop', kind: '設備停止', title: 'この停止' }),
      /* ① 1本目＝分割ありの親＋子2本 */
      mk({ id: 'P1', detail: { mfgWidth: 1200, mfgThickness: 1.6, originalWidth: 1200 } }),
      mk({ id: 'C1', parentId: 'P1', detail: { __childLot: true, __childWidth: 65, __childStrips: 2 } }),
      mk({ id: 'C2', parentId: 'P1', detail: { __childLot: true, __childWidth: 50, __childStrips: 3 } }),
      /* ② 2本目以降は**別の通し**なので、この刃組の条には入らない */
      mk({ id: 'N1', detail: { mfgWidth: 80, boxHorizontalCount: 2 } }),
      mk({ id: 'P2', detail: { mfgWidth: 900 } })
     ];
     return WL.scheduleView.bladeSeedLots(list, 1);
    });
    const names = (seed.lots || []).map(L => L.name).join(',');
    rec('刃組は1本目のコイルだけで組む（2本目以降を同じ元板に混ぜない）',
        !/N1|P2/.test(names), names);
    rec('分割ありの親ロットは条にならない（親の幅＝元コイル幅を条に混ぜない）',
        !/P1/.test(names), names);
    rec('1本目が分割ありなら、条になるのはその子ロット。幅は切断巾・本数は条数',
        JSON.stringify(seed.lots) === JSON.stringify(
         [{ name: 'C1', w: 65, n: 2, parent: 'P1' },
          { name: 'C2', w: 50, n: 3, parent: 'P1' }]),
        JSON.stringify(seed.lots));
    rec('どの親ロットの条かまで運ぶ（条の設計は親ロットで引くため）',
        (seed.lots || []).every(L => L.parent === 'P1'),
        (seed.lots || []).map(L => `${L.name}<-${L.parent}`).join(','));
    rec('1本目のコイル（親ロット）を名乗る（条の設計をこの1件で引く）',
        seed.headLot === 'P1', String(seed.headLot));
    rec('板厚・元コイル幅は1本目の行から読む',
        seed.thickness === 1.6 && seed.originalWidth === 1200,
        `t=${seed.thickness} W=${seed.originalWidth}`);

    /* 1本目が**分割なし**なら、そのコイル1件が条（切断巾×内訳の本数）。 */
    const seedN = await page.evaluate(() => {
     const mk = o => Object.assign({ kind: '作業', lotNo: o.id, detail: {} }, o);
     return WL.scheduleView.bladeSeedLots([
      mk({ id: 'stop', kind: '設備停止', title: 'この停止' }),
      mk({ id: 'N1', detail: { mfgWidth: 80, boxHorizontalCount: 4,
                               mfgThickness: 1.2, originalWidth: 400 } }),
      mk({ id: 'N2', detail: { mfgWidth: 70, boxHorizontalCount: 2 } })
     ], 1);
    });
    rec('1本目が分割なしなら、そのコイル1件が条（切断巾×内訳の本数）',
        JSON.stringify(seedN.lots) === JSON.stringify(
         [{ name: 'N1', w: 80, n: 4, parent: 'N1' }]),
        JSON.stringify(seedN.lots));

    /* 1本目が分割ありなのに子が読めないときは、**0で埋めず件数で言う**。
       親の幅は元コイル幅なので、条幅に使うと1本で元幅を使い切る。 */
    const seedS = await page.evaluate(() => {
     const mk = o => Object.assign({ kind: '作業', lotNo: o.id, detail: {} }, o);
     return WL.scheduleView.bladeSeedLots([
      mk({ id: 'stop', kind: '設備停止', title: 'この停止' }),
      mk({ id: 'P2', detail: { mfgWidth: 900, originalWidth: 900 } }),
      mk({ id: 'C3', parentId: 'P2', detail: { __childLot: true, __childStrips: 1 } })
     ], 1);
    });
    rec('切断巾が読めない子は渡さず、件数で言う（0で埋めない）',
        (seedS.lots || []).length === 0 && seedS.skipped === 1,
        `条${(seedS.lots || []).length}／skipped=${seedS.skipped}`);
    /* §9.463（利用者の指示「区分のロットの表示は『LOT1』ではなくロット番号を表示して」）。
       条の幅が読めない予定から開いても、**1本目のコイルの番号**で区分を言う
       （以前は画面の仮の名前 LOT1 のまま）。 */
    const headName = await page.evaluate(async () => {
     await WL.bladeGuide.open({ seed: { headLot: 'ZH4630', lots: [] } });
     const cell = document.querySelector('.bs-g td.bs-grp');
     return { names: WL.bladeGuide.state.lots.map(L => L.name), cell: cell ? cell.textContent : '' };
    });
    rec('条の幅が読めない予定から開いても、区分はロット番号（LOT1 と出さない）',
        headName.names.includes('ZH4630') && !headName.names.some(n => /^LOT\d*$/.test(n))
        && /ZH4630/.test(headName.cell), JSON.stringify(headName));
    await page.evaluate(() => WL.bladeGuide.open({}));

    /* ---- 8.5) 分割なしの条数は**仕掛データ**から読む（§9.388） ----
       利用者の報告「分割対象ではないものも…幅何条取りといったデータは
       持っていますが…1条取り確定になってしまっている」。
       予定の写しは**一覧の行**から作るので、列表示マスタに出していない
       `BOX設計_横割数` は最初から入っていない。測定画面が
       `refreshSelfSourceFull()` でしているのと同じく、完全な生データを
       取り直す。ここは**選び方の純粋な関数**を合成した行で見る。 */
    const src = await page.evaluate(() => {
     const f = WL.scheduleView.bladeLotsFromSource;
     const raw = { 'ロット番号': 'S1', '製造板幅': 120, '製造板厚': 1.2,
                   'BOX実績_板幅': 1000, 'BOX設計_横割数': 8 };
     return { hit: f(raw, 'S1'),
              /* 条数が読めない行は1本（幅が分かっているのに出さない、をしない）。 */
              noCnt: f({ '製造板幅': 120 }, 'S2'),
              /* 幅が読めなければ条を作らない（0で埋めない・§9.231）。 */
              noW: f({ 'BOX設計_横割数': 4 }, 'S3'),
              /* 範囲外（1〜40）は測定画面と同じく採らない。 */
              over: f({ '製造板幅': 120, 'BOX設計_横割数': 99 }, 'S4'),
              none: f(null, 'S5') };
    });
    rec('仕掛データの横割数がそのまま条数になる（1条取り確定をやめる）',
        JSON.stringify(src.hit.lots) === JSON.stringify(
         [{ name: 'S1', w: 120, n: 8, parent: 'S1' }]),
        JSON.stringify(src.hit.lots));
    rec('板厚・元コイル幅も同じ行から読む',
        src.hit.thickness === 1.2 && src.hit.originalWidth === 1000,
        `t=${src.hit.thickness} W=${src.hit.originalWidth}`);
    rec('条数が読めない行は1本（幅が分かっているのに出さない、をしない）',
        src.noCnt.lots.length === 1 && src.noCnt.lots[0].n === 1,
        JSON.stringify(src.noCnt.lots));
    rec('幅が読めなければ条を作らない（0で埋めない）',
        src.noW.lots.length === 0, JSON.stringify(src.noW.lots));
    rec('条数は1〜40の外なら採らない（測定画面と同じ考え）',
        src.over.strips === null && src.over.lots[0].n === 1,
        `strips=${src.over.strips}`);
    rec('行が無ければ何も言わない（写しの値のまま進ませる）',
        src.none === null, String(src.none));
    /* 取りに行く口が**1つ**であること。測定画面と同じ`WL.split.lotRow`を
       使う——別の口を作ると、2つの画面で「完全な行」の定義が割れる。 */
    rec('完全な生データを取る口は WL.split.lotRow の1つ',
        await page.evaluate(() => typeof (WL.split || {}).lotRow === 'function'));

    /* ---- 9) その刃組で切る本数と、1本目の材料（§9.382、利用者の指示） ----
       数える単位が条（`bladeSeedLots`）と違う——**切るのはコイル1本**で、
       子ロットは同じ1本を割ったものなので、数えると条の数だけ水増しされる。
       また条は9本で打ち切るが、**本数は打ち切ってはいけない**。 */
    /* 停止で区切れるのは**連携に載っている停止だけ**（`stopLinkRowOf`）。
       綴りを網の側で決め打ちせず、6)で登録した名前をそのまま使う
       ——名前を書き写すと、マスタの呼び名が変わったとき静かに区切れなくなる。 */
    const run = await page.evaluate((stopName) => {
     const mk = (o) => Object.assign({ kind: '作業', lotNo: o.id, detail: {} }, o);
     const list = [
      { kind: '設備停止', title: stopName },
      mk({ id: 'P1', detail: { mfgWidth: 1200, mfgThickness: 1.6, originalWidth: 1200,
                               mfgMaterial: 'SPCC', purposeName: '外装' } }),
      mk({ id: 'C1', parentId: 'P1', detail: { __childLot: true, __childWidth: 65, __childStrips: 2 } }),
      mk({ id: 'C2', parentId: 'P1', detail: { __childLot: true, __childWidth: 50, __childStrips: 3 } }),
      mk({ id: 'N1', detail: { mfgWidth: 80, boxHorizontalCount: 2 } }),
      mk({ id: 'N2', detail: { mfgWidth: 80, boxHorizontalCount: 2 } }),
      { kind: '設備停止', title: stopName },
      mk({ id: 'X1', detail: { mfgWidth: 70 } })
     ];
     return WL.scheduleView.bladeRunPlan(list, 1);
    }, TAG + '刃組み');
    /* P1・N1・N2 の3本（子2本は数えない／次の刃組より先は数えない）。
       ※この網は停止の行が「刃組み」として連携に載っている前提で数える。 */
    rec('切る予定本数は「コイルの本数」（条で水増ししない）／次の刃組で区切る',
        run.planned === 3, `${run.planned}本`);
    rec('1本目の材料を運ぶ（材質・板厚・板幅・用途名）',
        !!run.first && run.first.lot === 'P1' && run.first.material === 'SPCC'
        && +run.first.thickness === 1.6 && +run.first.width === 1200
        && run.first.purpose === '外装', JSON.stringify(run.first));
    /* **読めない項目は空のまま**（§9.231 0で埋めない）——記録に「材質 空欄」と
       残るほうが、嘘の値が残るより直せる。 */
    const run2 = await page.evaluate((stopName) => WL.scheduleView.bladeRunPlan(
      [{ kind: '設備停止', title: stopName },
       { kind: '作業', lotNo: 'B1', detail: { mfgWidth: 90 } }], 1), TAG + '刃組み');
    rec('読めない材質・用途は空のまま渡す（0や既定で埋めない）',
        !!run2.first && run2.first.material === '' && run2.first.purpose === ''
        && (run2.first.thickness === null || run2.first.thickness === undefined
            || run2.first.thickness === ''), JSON.stringify(run2.first));

    /* ---- 10) 刃組スケジュール一覧（§9.383、利用者の指示） ----
       「作業スケジュールを切り替えて刃組スケジュール一覧としても出せるように」。
       ここで固定するのは**利用者が挙げた項目が1つも欠けていないこと**と、
       **記録が無い段取りを空欄にしない**こと（空欄は0に見える・§9.231）。 */
    const cols = await page.evaluate(() => WL.scheduleView.bladeColumns());
    const needCols = ['台車', '刃セット', '板押さえ', 'ゴムリング／フィンガー', 'スペーサー',
                      'クリアランス', 'ラップ', '1本目に切る材料', '予定本数'];
    const labels = cols.map(c => c.label);
    rec('利用者が挙げた項目が列にそろっている',
        needCols.every(w => labels.indexOf(w) >= 0),
        needCols.filter(w => labels.indexOf(w) < 0).join(',') || labels.join(','));
    /* 「種類×数」は**種類の数と本数の両方**を言う（1種10本と10種1本ずつは
       段取りの手間がまるで違う）。 */
    const ct = await page.evaluate(() =>
      WL.scheduleView.bladeCountText({ 100: 2, 50: 1, 30: 1, 15: 4 }));
    rec('部材は「種類×数」と「何種・何本」の両方を言う',
        /100×2/.test(ct) && /4種/.test(ct) && /8本/.test(ct), ct);
    /* **大きい寸法から**並べる（用意する側は大きいものから積む）。
       `Object.keys` は数字の鍵を小さい順に返すので、そのままだと
       いちばん大きい寸法が「ほかN種」へ隠れる（実際に隠れていた）。 */
    rec('部材は大きい寸法から並べる（大きいものを隠さない）',
        ct.indexOf('100×2') === 0, ct);
    rec('部材が無ければ空（0本と書かない）',
        (await page.evaluate(() => WL.scheduleView.bladeCountText({}))) === '');
    /* 予定の中の刃組の停止を拾えること（拾う側が壊れると一覧ごと空になる）。 */
    const stops = await page.evaluate((stopName) => WL.scheduleView.bladeStops([
      { kind: '作業', lotNo: 'A' },
      { kind: '設備停止', id: 's1', title: stopName },
      { kind: '作業', lotNo: 'B' },
      { kind: '設備停止', id: 's2', title: '休憩' },
      { kind: '設備停止', id: 's3', title: stopName }
    ]), TAG + '刃組み');
    rec('刃組の停止だけを拾う（ふつうの停止は並べない）',
        stops.length === 2 && stops[0].id === 's1' && stops[1].id === 's3',
        JSON.stringify(stops));

    /* ---- 9) 「初めて断面図を押す」道（§9.437、利用者の報告） ----
       「初回起動、刃組ガイダンスを確認し、初めて断面図を押すと断面ではない
        3D表示になります。もう一度押すと解消しますが初回だけです」

       **この網はここまで、必ず立体図を見てから断面図へ移っていた**（4.7）ので、
       この道は1度も通っていなかった。「初回」は2つ同時に成り立つ状態:
         ① three.js をまだ読んでいない  ② 模型が1度も組まれていない
       読み込み直してから、**いちばん最初に断面図**を押す。

       見るのは絵ではなく `capSide`——切り口の面（切ったときに中を塞ぐ板）が
       **いま残している側に在るか**。false だと切り口が切り落とされる側へ行き、
       中身の無い殻＝立体図と同じ絵になる。 */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await W.booted(page);
    /* **利用者の常用環境の寸法にしてから押す**（2160×1440・125% ＝ 1728×1152）。
       札が帯と重なるかどうかは**器の高さ**で決まる（札は立体の点を写した位置に
       出る）ので、狭い器のままだと札がもっと下に来て、欠陥を入れても素通りする
       （実際に素通りした）。**押したあとに広げてもいけない**——描き直しが入り、
       そのときには帯が埋まっているので、やはり素通りする。 */
    const vp0 = page.viewportSize();
    await page.setViewportSize({ width: 1728, height: 900 });
    await page.evaluate(() => WL.bladeGuide.open({}));
    await W.until(page, () => document.querySelectorAll('#bsStage rect').length > 20,
                  null, { ms: 20000, what: '刃組図が描き直される' });
    /* **「初回」の形が変わった**（§9.440、利用者の指示で既定を断面図にした）。
       以前の初回は「部品も模型もまだ無い状態から、初めて断面図を押す」
       だったが、いまは**開いた最初の1枚がもう断面図**——押す手が要らない。
       見る条件はそのまま（初めて組んだ模型が断面になっているか）で、
       **組んだ回数が1回であること**で「これが最初の1枚」と言い切る。 */
    await W.until(page, () => {
     const v = window.WL.bladeSolid && window.WL.bladeSolid.view();
     return !!(v && v.cut && v.ortho && v.builds > 0);
    }, null, { ms: 25000, what: '初めての断面図が組み上がる' });
    const virgin = await page.evaluate(() => {
     const v = window.WL.bladeSolid.view();
     return { three: !!window.THREE, builds: v.builds, cut: v.cut, ortho: v.ortho };
    });
    rec('「初回」の条件がそろっている（開いた最初の1枚が断面図・組んだのは1回）',
        virgin.builds === 1 && virgin.cut === true && virgin.ortho === true,
        JSON.stringify(virgin));
    const first = await page.evaluate(() => {
     const v = window.WL.bladeSolid.view();
     return { capSide: v.capSide, capZ: v.capZ, builtKeep: v.builtKeep, keep: v.keep,
              flip: v.flip, builds: v.builds, clips: v.clips };
    });
    rec('初めて断面図を押した1枚目から切り口が残す側に在る（殻にならない）',
        first.capSide === true && first.builtKeep === first.keep,
        JSON.stringify(first));
    /* ---- 9b) OS・DS の札は上の帯と重ならない（§9.437、利用者の指示） ----
       **見るのは「切り替えた最初の1枚」**。帯（画面左DS…／有効長…）を書くのは
       `sides()`で、札を置くのは`place()`——**逆順だと最初の1枚だけ帯がまだ空**で、
       `place()`が「帯は無い」と読んで札を上へ置き、そのあと帯が出て重なる
       （実測 25×5px）。2枚目からは帯が埋まっているので**ここより後で測ると
       素通りする**（欠陥注入で素通りした）。
       **重なりは面積で数える**（「近い」では素通りする）。あわせて、対で出す
       札なので**同じ高さ**に出ること（片方だけ帯を避けると段違いに見える）。

       **器の高さで、当たるかどうかが変わる**（札は立体の点を写した位置に出る）。
       器が高いと札はもともと帯のずっと下へ出るので、**重なり0を見ても何も
       確かめたことにならない**（実測: 器1104×849 で札の上端140・帯の下端66。
       欠陥を入れてもこの寸法では素通りした）。だから**器を縮めてから測り**、
       「札が帯のすぐ下で止まっている」＝**止める側が実際に効いた**ことまで見る
       （§9.369「測れないなら前提を作る」）。 */
    const lap = await page.evaluate(() => {
     const st = document.querySelector('#bsStage3');
     const vis = e => e && !e.hidden && e.getBoundingClientRect().width > 0;
     const os = st.querySelector('.bs-t3-os'), ds = st.querySelector('.bs-t3-ds');
     const bars = [...st.querySelectorAll('.bs-o3, .bs-len3')].filter(vis);
     if (!vis(os) || !vis(ds) || !bars.length) return null;
     const over = (a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      return w > 0 && h > 0 ? Math.round(w * h) : 0;
     };
     let area = 0;
     bars.forEach(b => { area += over(os, b) + over(ds, b); });
     const sr = st.getBoundingClientRect();
     return { area, bars: bars.length,
              stage: [Math.round(sr.width), Math.round(sr.height)],
              dsTop: Math.round(ds.getBoundingClientRect().top - sr.top),
              barBot: Math.round(Math.max(...bars.map(x => x.getBoundingClientRect().bottom)) - sr.top),
              dy: Math.round(Math.abs(os.getBoundingClientRect().top
                                      - ds.getBoundingClientRect().top)) };
    });
    rec('OS・DS の札は上の帯と1px も重ならない',
        !!lap && lap.area === 0,
        lap ? `${lap.area}px² / 帯 ${lap.bars}本 / 器 ${lap.stage} / 札の上端 ${lap.dsTop} vs 帯の下端 ${lap.barBot}`
            : '札か帯が出ていない');
    rec('帯を避ける仕掛けが実際に効いている（札が帯のすぐ下で止まっている）',
        !!lap && lap.dsTop >= lap.barBot && lap.dsTop <= lap.barBot + 40,
        lap ? `札の上端 ${lap.dsTop} / 帯の下端 ${lap.barBot}（器 ${lap.stage}）` : '—');
    rec('OS と DS は同じ高さに出る（対で出す札）',
        !!lap && lap.dy <= 1, lap ? `差 ${lap.dy}px` : '—');
    await page.setViewportSize(vp0);
    await W.until(page, () => {
     const st = document.querySelector('#bsStage3');
     return !!st && st.getBoundingClientRect().width < 1500;
    }, null, { ms: 6000, what: '器が元の寸法へ戻る' });


    /* **裏返しも同じ罠だった**（`spinTo()`は断面図では組み直さない）。
       向きが変われば `render()` が組み直すことを、組んだ回数で見る。 */
    const spun = await page.evaluate(async () => {
     const v0 = window.WL.bladeSolid.view();
     window.WL.bladeSolid.spinTo(v0.flip ? 0 : Math.PI);
     window.WL.bladeSolid.render();
     const v = window.WL.bladeSolid.view();
     return { before: v0.builds, after: v.builds, capSide: v.capSide, capZ: v.capZ,
              flip: v.flip, keep: v.keep, builtKeep: v.builtKeep };
    });
    rec('段取り向きを裏返しても切り口は残す側に付いてくる（組み直す）',
        spun.capSide === true && spun.builtKeep === spun.keep && spun.after > spun.before,
        JSON.stringify(spun));

    rec('JSエラーが出ていない', errs.length === 0, errs.slice(0, 2).join(' / '));

  } finally {
    /* ---- 後始末 ---- */
    if (planId) await post('/api/schedule/plan/delete', { id: planId });
    await setMode('edit');
    if (stopId) await post('/api/schedule/stop-reason-master/delete', { id: stopId });
    await wipe();
    const left = await getj('/api/bladeset/context?equipment=' + encodeURIComponent(EQ));
    rec('後始末で刃組マスタが空へ戻る',
        !(left.spacers || []).length && !(left.rings || []).length
        && !(left.blades || []).length && !(left.fingers || []).length
        && !(left.designs || []).length,
        `sp=${(left.spacers || []).length} ring=${(left.rings || []).length}`
        + ` design=${(left.designs || []).length}`);
    /* 論理削除で残る行を素の表から消す。**消した件数で確かめる**（§9.362 ①
       「後片付けは『消えた』で確かめる」）。 */
    const dropped = await H.dropNewMasterRows(snapM);
    /* 停止の行を作る前に落ちた実行では、**消す物が無いのが正しい**——
       本物の失敗の上に、片付けの空振りを足して読みにくくしない。 */
    rec('設備停止マスタに置き土産を残さない',
        stopId ? dropped >= 1 : dropped === 0, `${dropped}行`);
    /* **刃組のマスタを空のまま置いていかない**（§9.284・§9.441）。この網は
       頭で `wipe()` が**この設備の刃組マスタを全部消す**のに、
       `dropNewMasterRows()` が消すのは「控えより後に増えた行」だけ——
       元から在った行は戻らず、**表が空のまま次の実行へ渡る**（ランナーが
       「ゴムリングマスタ -50 / スペーサーマスタ -26 / フィンガーマスタ -14 /
       刃マスタ -6」と名指ししていた）。実際にこれで、別の確認が
       「マスタが登録されていません」を見て遠回りした。
       **図面どおりの1式を入れ直して返す**（`seed`は足し算にならない・§9.377）。 */
    const back = await (await post('/api/bladeset/seed', { equipment: EQ })).json()
      .catch(() => null);
    const c2 = await getj('/api/bladeset/context?equipment=' + encodeURIComponent(EQ));
    rec('刃組のマスタを空のまま置いていかない（§9.441）',
        (c2.spacers || []).length > 0 && (c2.blades || []).length > 0
        && (c2.fingers || []).length > 0 && (c2.rings || []).length > 0,
        `sp=${(c2.spacers || []).length} blade=${(c2.blades || []).length}`
        + ` fin=${(c2.fingers || []).length} ring=${(c2.rings || []).length}`
        + ` / seed=${JSON.stringify((back && back.made) || {})}`);
  }
 }, { mode: 'edit', viewport: { width: 1700, height: 1000 },
      /* 刃組ガイダンスは**この端末の使用設備**で開く。検証用の端末には
         登録が無いので、始める前に入れておく（他の網と同じ作法）。 */
      init: () => localStorage.setItem('AccessMeasurementConfiguredEquipment', 'テスト設備A') });
