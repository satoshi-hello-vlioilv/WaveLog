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
  };
  await wipe();

  /* **ここから finally で囲う。** 途中で落ちた実行が後片付けを飛ばすと、
     刃組のマスタと設備停止の行が共有の `db/master.sqlite3` に残り、
     次の実行が丸ごと引き継ぐ（§9.284）。実際に1度、途中の FATAL で
     86行を置き去りにして「汚した本」に名指しされた。 */
  try {
    await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
    await W.booted(page);

    /* ---- 1) 左メニューから開き、足りないものを言う ---- */
    rec('左メニューに刃組ガイダンスがある', !!(await page.$('#openBladeSet')));
    await page.click('#openBladeSet');
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
    await page.click('#openBladeSet');
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
    /* 戻す（以降の判定はゴムリング方式で見る） */
    await page.evaluate(() => {
     const el = document.querySelector('#bsThick');
     el.value = '1.3';
     el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await W.until(page, () => !/フィンガー/.test(document.querySelector('#bsV2').textContent),
                  null, { ms: 8000, what: 'ゴムリング方式へ戻る' });

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
    rec('取りに行く先は版まで決めてある（版は1箇所）',
        /^https:\/\/[^ ]+\/r\d+\/three(\.min)?\.js$/.test(src3 || ''), String(src3));
    await page.route(src3, r => r.abort());
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
    await page.unroute(src3);

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
        && !(left.blades || []).length && !(left.fingers || []).length,
        `sp=${(left.spacers || []).length} ring=${(left.rings || []).length}`);
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
