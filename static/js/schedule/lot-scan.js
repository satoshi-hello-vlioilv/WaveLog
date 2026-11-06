'use strict';
/* lot-scan.js: バーコードで読んだロットを作業スケジュールの先頭へ（§9.642）
   ============================================================
   利用者の指示「作業スケジュールの並び替え機能の発展で、バーコードリーダー用のロット番号検索＆先頭に配置入れ替える
   機能」「今から作業するロットを読む使い方。7桁英数字が打ち込まれたら、スケジュールを探す、あればそれを並び替え、
   無ければ使用設備（対象設備）の仕掛ロットから探して、有れば、ロットを組み込む権限がない場合は変更無し。仕掛ロットを
   組み込む権限が無いことを通知、権限がある場合は、仕掛から強制スケジュールしますとメッセージを出し組み込む」。

   役割の分け方:
    ・何をするかは`decide()`／`decideWip()`の2つ（純粋な関数・画面を知らない・網が直に確かめる）。
    ・並べ替えと仕掛から入れるのは予定の画面の口（`WL.scheduleView.bringToTop()`／`addRowAtTop()`）——ドラッグ・
      仕掛一覧と同じ1本の道（書込の列・楽観描画・失敗の戻し）を通る。権限の判定も画面と同じ答え（`scanContext()`）。
    ・仕掛の行はロット1件の完全な行を引く口（`WL.split.lotRow()`・§9.388）。設備違いは予定へ入れる関門と同じ
      `otherEquipment()`（§9.637）。
   ============================================================ */
(function(){
 const WL=window.WL;
 const LOT_LEN=7;   // 現場のバーコードのロット番号の桁（利用者の指示）
 const STATE_WORD={'着手':'作業中です','完了':'完了しています','取消':'取り消した予定です'};

 /* 読んだ字 → ロット番号（全角・空白・ハイフンを落として大文字）。形が違えば''。 */
 function codeOf(raw){
  const v=WL.base.normalizedLot(raw);
  return new RegExp(`^[0-9A-Z]{${LOT_LEN}}$`).test(v)?v:'';
 }
 /* 予定の中を探して、することを決める。ctx＝`WL.scheduleView.scanContext()`。
    返す: {kind, lot, entry?, pos?, head, why, next}。head＝結論（大きく1行）・why＝理由・next＝次の一手（無ければ''）。
    ロット番号と設備名は読む欄と段の頭が持つので、ここでは繰り返さない。
    kind: bad|move|top|state|locked|deny|blocked|wip（予定に無い→仕掛を探す） */
 const R=(kind,lot,head,why,next,more)=>Object.assign({kind,lot,head,why,next:next||''},more||{});
 function decide(raw,ctx){
  const lot=codeOf(raw);
  if(!lot)return R('bad','','読み直してください',`${LOT_LEN}桁の英数字のロット番号ではありません（読んだ字「${String(raw||'').trim()}」）`,'');
  const all=(ctx.entries||[]);
  const byId=new Map(all.map(e=>[String(e.id),e]));
  /* 子ロットを読んだら親の行（子は親にぶら下がって動く）。 */
  const hits=all.filter(e=>e.kind==='作業'&&WL.base.normalizedLot(e.lotNo)===lot)
   .map(e=>(e.parentId!=null&&byId.get(String(e.parentId)))||e);
  if(!hits.length)return R('wip',lot,'仕掛を探しています…',`予定に無いので、この設備の仕掛から探しています`,'');
  /* 同じロットが2行あるときは、動かせる予定 → 作業中 → その他 の順（今から作業するロットを読む使い方）。 */
  const rank=e=>e.reorderable?0:e.state==='着手'?1:2;
  const entry=hits.slice().sort((a,b)=>rank(a)-rank(b))[0];
  const movable=all.filter(e=>e.reorderable&&!e.fixedStart);
  const pos=movable.indexOf(entry),more={entry,pos};
  if(!entry.reorderable)return R('state',lot,'動かしていません',`${STATE_WORD[entry.state]||`「${entry.state}」の行です`}`,'',more);
  if(entry.fixedStart)return R('locked',lot,'動かしていません',`開始日時を固定した予定です`,'固定を外すと並べ替えられます',more);
  if(pos===0)return R('top',lot,'もう先頭です',`まだ始めていない予定の先頭にあります`,'',more);
  if(!ctx.canReorder)return R('deny',lot,'動かしていません',`この端末は並べ替えできません（${ctx.reorderWhy}）`,'並べ替えできる端末で読んでください',more);
  if(ctx.blocked)return R('blocked',lot,'動かしていません',ctx.blockedWhy,'',more);
  return R('move',lot,'先頭へ動かしました',`まだ始めていない予定の ${pos+1}番目 → 先頭`,'',more);
 }
 /* 仕掛を引いたあと。row＝仕掛の行（無ければ null）。kind: none|other|deny-add|blocked|add */
 function decideWip(lot,row,ctx,other){
  if(!row)return R('none',lot,'見つかりません',`予定にもこの設備の仕掛にもありません`,'ロット番号を確かめて読み直してください');
  if(other)return R('other',lot,'入れられません',`仕掛にありますが、設計設備がほかの設備のロットです`,'');
  if(!ctx.canAdd)return R('deny-add',lot,'変更していません',`予定に無く仕掛にあります。この端末は仕掛から組み込む権限がありません`,'スケジュールモードの端末で読んでください');
  if(ctx.blocked)return R('blocked',lot,'組み込めません',ctx.blockedWhy,'');
  return R('add',lot,'仕掛から強制スケジュールします',`予定に無いので、仕掛からまだ始めていない予定の先頭へ組み込みました`,'');
 }
 /* 結果の種類の札（印・色・字の3つで言う・色だけにしない）。帯の色も同じ答えから出す（CSS の data-tone）。 */
 const TONE={move:'ok',add:'add',top:'info',wip:'info',state:'warn',locked:'warn',deny:'warn','deny-add':'warn',blocked:'warn',other:'warn',none:'bad',bad:'bad',error:'bad'};
 const ICON={ok:'fa-check',add:'fa-plus',info:'fa-info',warn:'fa-exclamation',bad:'fa-xmark'};

 /* 1回読んだぶんを行う。返す: 最後の判定（網が読む）。 */
 async function run(raw,say){
  const sv=WL.scheduleView;
  const ctx=sv.scanContext();
  const d=decide(raw,ctx);
  say(d);
  if(d.kind==='move'){sv.bringToTop(d.entry.id);sv.flashLot(d.lot);return d}
  if(d.kind==='top')sv.flashLot(d.lot);
  if(d.kind!=='wip')return d;
  let row=null;
  try{row=await WL.split.lotRow(d.lot)}
  catch(e){const r=R('error',d.lot,'仕掛を引けませんでした',String((e&&e.message)||e),'もう一度読んでください');say(r);return r}
  /* 引いた行のロット番号がちがえば無いのと同じ（先頭の一致で拾った別の行を入れない）。 */
  if(row&&WL.base.normalizedLot(window.pick(row,'lotNo'))!==d.lot)row=null;
  const w=decideWip(d.lot,row,sv.scanContext(),row?sv.otherEquipment(row):false);
  say(w);
  if(w.kind==='add'){await sv.addRowAtTop(row);sv.flashLot(w.lot)}
  return w;
 }

 /* ---------- 読み取りの段（帯の「読んで先頭へ」で開く・一覧の下の知らせの棚の1段） ----------
    浮く面にしない——表の行と「開始」を覆うと、動かした行をその場で確かめられない（§9.642 の採点）。
    棚は一覧の下なので、開いても行のy座標は動かない（§9.397）。読む欄の位置は結果があってもなくても変えない。 */
 let last=null;
 const bar=()=>document.getElementById('scScanBar');
 function sayIn(d){
  last=d;
  const el=bar();if(!el)return;
  const tone=TONE[d.kind]||'info',box=el.querySelector('.sc-scan-say');
  box.dataset.tone=tone;box.dataset.kind=d.kind;
  box.innerHTML=`<span class="sc-scan-tag" aria-hidden="true"><i class="fa-solid ${ICON[tone]}"></i></span>`
   +`<span class="sc-scan-text"><b>${window.esc(d.head)}</b><span>${window.esc(d.why)}</span>`
   +(d.next?`<strong>→ ${window.esc(d.next)}</strong>`:'')+`</span>`
   +(d.entry||d.kind==='add'?`<button type="button" class="sc-scan-see">${window.esc(d.lot)} の行を見る</button>`:'');
  const see=box.querySelector('.sc-scan-see');if(see)see.onclick=()=>WL.scheduleView.flashLot(d.lot);
 }
 function close(){const el=bar();if(!el)return;el.hidden=true;const b=document.getElementById('scScanBtn');if(b)b.setAttribute('aria-expanded','false')}
 function open(btn){
  const el=bar();if(!el)return;
  if(!el.hidden){close();btn.focus();return}
  const ctx=WL.scheduleView.scanContext();
  el.innerHTML=`<b class="sc-scan-title"><i class="fa-solid fa-barcode" aria-hidden="true"></i>読んで先頭へ</b>`
   +`<input type="text" class="sc-scan-input" inputmode="latin" autocomplete="off" spellcheck="false" data-enter-own aria-label="ロット番号"`
   +` placeholder="${LOT_LEN}桁のロット番号を読む">`
   +`<p class="sc-scan-say" data-tone="idle" aria-live="polite"><span class="sc-scan-tag" aria-hidden="true"><i class="fa-solid fa-barcode"></i></span>`
   +`<span class="sc-scan-text"><span>予定にあれば、まだ始めていない予定の先頭へ並べ替えます。無ければこの設備の仕掛から探して${ctx.canAdd?'その先頭へ組み込みます':'知らせます（この端末は組み込みません）'}。</span></span></p>`
   +`<button type="button" class="sc-scan-close" aria-label="読んで先頭へを閉じる" title="閉じる（Esc）"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`;
  el.hidden=false;btn.setAttribute('aria-expanded','true');
  const inp=el.querySelector('.sc-scan-input');
  let busy=false;
  const go=async()=>{
   if(busy)return;busy=true;
   try{await run(inp.value,sayIn)}
   finally{busy=false;inp.select()}   // 次に読んだ字で置き換わる
  };
  /* 7桁そろった時点で動く（リーダーが Enter を送らない形でも）。長すぎる・形が違うときは Enter で理由を言う。 */
  inp.addEventListener('input',()=>{if(codeOf(inp.value))go()});
  inp.addEventListener('keydown',e=>{
   if(e.key==='Escape'){e.preventDefault();close();btn.focus();return}
   if(e.key==='Enter'&&!e.isComposing){e.preventDefault();if(!codeOf(inp.value))go()}});
  el.querySelector('.sc-scan-close').onclick=()=>{close();btn.focus()};
  inp.focus();
 }
 /* 帯のボタンを出すか（使えない端末にはボタンごと出さない）。予定の画面が段を切り替えるたびに呼ぶ。 */
 function sync(show){
  const btn=document.getElementById('scScanBtn');if(!btn)return;
  const ctx=WL.scheduleView.scanContext();
  btn.hidden=!show||!(ctx.canReorder||ctx.canAdd);
  if(btn.hidden)close();
  btn.onclick=()=>open(btn);
 }

 WL.lotScan={LOT_LEN,codeOf,decide,decideWip,run,sync,last:()=>last};
})();
