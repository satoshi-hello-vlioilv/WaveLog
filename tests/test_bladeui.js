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

    /* ---- 3) 幅を変えると、図・表・所要が同じ1回で追従する ---- */
    await page.click('[data-step-open="bsV3"]');
    await page.waitForSelector('#bsLotTbl input[data-k="w"]', { timeout: 8000 });
    await page.evaluate(() => {
     const el = document.querySelector('#bsLotTbl input[data-k="w"]');
     el.value = '120';
     el.dispatchEvent(new Event('input', { bubbles: true }));
     const n = document.querySelector('#bsLotTbl input[data-k="n"]');
     n.value = '6';
     n.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await W.until(page, () => /120/.test(document.querySelector('#bsV3').textContent),
                  null, { ms: 8000, what: '手順3の現在値' });
    const s2 = await snap();
    rec('幅を変えると図が描き直される', s2.rects !== s1.rects || s2.rows !== s1.rows,
        `rects ${s1.rects}→${s2.rects} / rows ${s1.rows}→${s2.rows}`);
    rec('条の並びが本数どおりになる',
        (await page.evaluate(() => document.querySelectorAll('#bsOrdList .bs-oc').length)) === 6);
    const kpi = await page.evaluate(() => document.querySelector('#bsKpis').textContent);
    rec('割付の内訳（耳・条・刃の対数）が出る', /OS耳/.test(kpi) && /刃 対数/.test(kpi),
        kpi.replace(/\s+/g, ' ').slice(0, 60));

    /* ---- 4) 板厚をフィンガー切替より下げると保持層が替わる ---- */
    await page.click('[data-step-open="bsV2"]');
    await page.waitForSelector('#bsThick', { timeout: 8000 });
    await page.evaluate(() => {
     const el = document.querySelector('#bsThick');
     el.value = '0.4';
     el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await W.until(page, () => /フィンガー/.test(document.querySelector('#bsV2').textContent),
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

    /* フィンガーは**板押さえ**なので、軸のまわりではなく**板の両側**に描く
       （§9.379、利用者の指示4）。以前は輪と同じ場所に出しており、どこを
       押さえているのかが図から読めなかった。ここで見るのは位置関係だけ
       ——形（先細り）は幅しだいで変わるので数えない。 */
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
     return { n: fs.length, above: above.length, below: below.length,
              /* 軸と板のあいだに居るか（軸の中心より板側、かつ板の外） */
              between: fs.every(b => {
               const c = (b.y0 + b.y1) / 2;
               return (c < top && c > upC) || (c > bot && c < loC);
              }), top, bot, upC, loC };
    });

    rec('フィンガーを図に描く（方式だけ言って絵に出さない、をやめる）',
        fg.n > 0, `${fg.n}本`);
    rec('フィンガーは板の両側に出る（上下それぞれの軸から押さえる）',
        fg.above > 0 && fg.below > 0, `上${fg.above}/下${fg.below}`);
    rec('フィンガーは軸と板のあいだに置く（軸に被せない）',
        fg.n > 0 && fg.between === true,
        `板 ${Math.round(fg.top)}..${Math.round(fg.bot)} / 軸 ${fg.upC}..${fg.loC}`);
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
    const flip0 = await page.evaluate(() => {
     const b = document.querySelector('#bsFlip');
     const edge = () => [...document.querySelectorAll('#bsStage text')]
       .map(t => (t.textContent || '').trim()).filter(t => t === 'OS' || t === 'DS');
     return { inFig: !!document.querySelector('.bs-figpanel .bs-ph #bsFlip'),
              inBar: !!document.querySelector('.bs-bar #bsFlip'),
              label: b ? (b.textContent || '').trim() : '', edge: edge().join('/') };
    });
    rec('向きの切り替えは刃組図の見出しにある', flip0.inFig && !flip0.inBar,
        `図${flip0.inFig}/バー${flip0.inBar}`);
    /* **手順の窓を先に閉じる。** 窓（`.bs-pop`）は図の見出しへ垂れ下がるので、
       開いたままだと見出しの札に手が届かない（人が押すときも同じ）。
       向きの切り替えを図の見出しへ移した（§9.380）ぶん、この札も窓の下に入る。 */
    await page.keyboard.press('Escape');
    await W.until(page, () => !document.querySelector('.bs-step.is-open'),
                  null, { ms: 5000, what: '手順の窓が閉じる' });
    /* **開いたときの向きを決め打ちしない**（刃組の道具なので既定は段取り向き
       ＝DS左だが、既定が変わってもこの網は「入れ替わること」を見たい）。 */
    await page.click('#bsFlip');
    await W.until(page, (before) =>
      document.querySelector('#bsFlip').textContent.trim() !== before,
      flip0.label, { ms: 8000, what: '向きが切り替わる' });
    const flip1 = await page.evaluate(() => ({
     label: (document.querySelector('#bsFlip').textContent || '').trim(),
     edge: [...document.querySelectorAll('#bsStage text')]
       .map(t => (t.textContent || '').trim()).filter(t => t === 'OS' || t === 'DS').join('/'),
     flipped: document.querySelector('#bsFigRow').classList.contains('is-flip')
    }));
    rec('押すと図の左右が入れ替わる（移しても効く）',
        /^(OS\/DS|DS\/OS)$/.test(flip0.edge) && flip1.edge !== flip0.edge
        && /^(OS\/DS|DS\/OS)$/.test(flip1.edge),
        `${flip0.edge} → ${flip1.edge}`);
    rec('向きの札は「いま押すと何になるか」を言う（状態と札が食い違わない）',
        flip1.label !== flip0.label && /向き/.test(flip1.label),
        `${flip0.label} → ${flip1.label}`);
    await page.click('#bsFlip');
    await W.until(page, (before) =>
      document.querySelector('#bsFlip').textContent.trim() !== before,
      flip1.label, { ms: 8000, what: '元の向きへ戻す' });

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
     return { vw: vb[2] || 0, x0: bb ? bb.x : 0, x1: bb ? bb.x + bb.width : 0, cols,
              inRail, inFig, figW, stW };
    });
    /* 中身が viewBox の横幅の 98% 以上を占めていること（見出しの右端の
       わずかな空きだけを許す）。 */
    rec('模式図は器の横幅を使い切る（左右に何も無い帯を残さない）',
        fill.vw > 0 && (fill.x1 - fill.x0) >= fill.vw * 0.98,
        `中身 ${Math.round(fill.x0)}..${Math.round(fill.x1)} / viewBox 0..${fill.vw}`);
    /* 端部の表は右レールへ移した（§9.379）。図の段に戻ると模式図が
       7割まで痩せるので、**どちらに居るか**を両方向から見る。 */
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
     const badge = document.querySelector('#bsStage [data-badge]');
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
    rec('立体図の部品は起動時に読まない（押したときだけ取りに行く）',
        await page.evaluate(() => !window.THREE
          && ![...document.scripts].some(x => /three/i.test(x.src || ''))));
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
       .map(b => b.textContent)
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
    rec('HUDは「表示」と「段取り」の2群', st3.caps.join('/') === '表示/段取り',
        st3.caps.join('/'));
    rec('段取りは3手順＋視点を戻すの4つ',
        st3.steps.length === 4 && /③台車を回す/.test(st3.steps[2]), st3.steps.join('/'));
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
    await page.click('#bsFigTabs [data-fig="2d"]');
    await W.until(page, () => !document.querySelector('.bs-stage').hidden,
                  null, { ms: 8000, what: '模式図へ戻る' });

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
     const b2 = row.querySelector('.sc-nw-link');
     return b2 ? { text: b2.textContent, title: b2.title } : null;
    }, TAG + '刃組み');
    rec('行き先のチップが行に出る', !!chip && chip.text === '刃組ガイダンス', JSON.stringify(chip));
    rec('押すと何が起きるかを字で言う', !!chip && /開きます/.test(chip.title || ''),
        chip && chip.title);
    const others = await page.evaluate(() => {
     const rows = [...document.querySelectorAll('.sc-row-line')];
     return rows.filter(r => r.querySelector('.sc-nw-link')).length;
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
     row.querySelector('.sc-nw-link').click();
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
    const seed = await page.evaluate(() => {
     const mk = o => Object.assign({ kind: '作業', lotNo: o.id, detail: {} }, o);
     const list = [
      mk({ id: 'stop', kind: '設備停止', title: 'この停止' }),
      /* ① 分割ありの親＋子2本 */
      mk({ id: 'P1', detail: { mfgWidth: 1200, mfgThickness: 1.6, originalWidth: 1200 } }),
      mk({ id: 'C1', parentId: 'P1', detail: { __childLot: true, __childWidth: 65, __childStrips: 2 } }),
      mk({ id: 'C2', parentId: 'P1', detail: { __childLot: true, __childWidth: 50, __childStrips: 3 } }),
      /* ② 分割なしの行は従来どおり */
      mk({ id: 'N1', detail: { mfgWidth: 80, boxHorizontalCount: 2 } }),
      /* ③ 切断巾が読めない子（0で埋めず、飛ばして数える） */
      mk({ id: 'P2', detail: { mfgWidth: 900 } }),
      mk({ id: 'C3', parentId: 'P2', detail: { __childLot: true, __childStrips: 1 } })
     ];
     return WL.scheduleView.bladeSeedLots(list, 1);
    });
    const names = (seed.lots || []).map(L => L.name).join(',');
    rec('分割ありの親ロットは条にならない（親の幅＝元コイル幅を条に混ぜない）',
        !/P1|P2/.test(names), names);
    rec('条になるのは子ロット。幅は切断巾・本数は条数',
        JSON.stringify(seed.lots) === JSON.stringify(
         [{ name: 'C1', w: 65, n: 2, parent: 'P1' },
          { name: 'C2', w: 50, n: 3, parent: 'P1' },
          { name: 'N1', w: 80, n: 2, parent: 'N1' }]),
        JSON.stringify(seed.lots));
    rec('どの親ロットの条かまで運ぶ（条の設計は親ロットで引くため）',
        (seed.lots || []).every(L => !!L.parent),
        (seed.lots || []).map(L => `${L.name}<-${L.parent}`).join(','));
    rec('板厚・元コイル幅は親の行からも読む',
        seed.thickness === 1.6 && seed.originalWidth === 1200,
        `t=${seed.thickness} W=${seed.originalWidth}`);
    rec('渡せなかった行は0で埋めず件数で言う', seed.skipped === 1, String(seed.skipped));

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
  }
 }, { mode: 'edit', viewport: { width: 1700, height: 1000 },
      /* 刃組ガイダンスは**この端末の使用設備**で開く。検証用の端末には
         登録が無いので、始める前に入れておく（他の網と同じ作法）。 */
      init: () => localStorage.setItem('AccessMeasurementConfiguredEquipment', 'テスト設備A') });
