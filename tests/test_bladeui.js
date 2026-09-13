/* test_bladeui.js: 刃組ガイダンスと、設備停止からの遷移（§9.377）
   ============================================================
   利用者の指示（要約）:
     「設備停止マスタにカテゴリを1つ増やし、刃組ガイダンス連携を紐づける。
      作業スケジュール一覧表で『刃組み』をクリックすると刃組ガイダンスへ
      遷移する。刃組に必要なデータは元コイル幅・ロット毎の切断幅・板厚」

   ここで固定するのは6つ:
    1. 左メニューから刃組ガイダンスが開き、**マスタが無ければそう言う**
       （黙って空の図を描かない・§CLAUDE 4）
    2. 初期セットを登録すると、**刃組図・刃組表・所要が同じ割付から**出る
       ——図の部材の数と表の枚数が食い違わない
    3. 手順3で幅を変えると、図・表・所要が**同じ1回の描き直し**で追従する
    4. 板厚をフィンガー切替より下げると、**保持層がフィンガーへ替わる**
       （押上げ・ニップは「フィンガー方式」と言い、ゴムリングは所要に出ない）
    5. 設備停止マスタの連携機能を「刃組ガイダンス」にすると、予定の行に
       **行き先のチップが出て、押すと開く**（連携なしの行には出ない）
    6. 遷移のとき、**その行より後ろに並ぶ作業**の元コイル幅・切断幅・板厚が
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
  await page.click('[data-step-open="3"]');
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
  await page.click('[data-step-open="2"]');
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

  /* ---- 5) 設備停止 → 行き先のチップ ---- */
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

  /* ---- 6) 押すと開き、後ろの作業の文脈が入っている ---- */
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

  rec('JSエラーが出ていない', errs.length === 0, errs.slice(0, 2).join(' / '));

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
  rec('設備停止マスタに置き土産を残さない', dropped >= 1, `${dropped}行`);
 }, { mode: 'edit', viewport: { width: 1700, height: 1000 },
      /* 刃組ガイダンスは**この端末の使用設備**で開く。検証用の端末には
         登録が無いので、始める前に入れておく（他の網と同じ作法）。 */
      init: () => localStorage.setItem('AccessMeasurementConfiguredEquipment', 'テスト設備A') });
