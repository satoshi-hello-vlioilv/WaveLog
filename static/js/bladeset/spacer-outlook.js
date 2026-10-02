/* ============================================================
   spacer-outlook.js: スペーサーの在庫の見通し（§9.540、利用者の選択 E-11＋E-14）

   「E-11とE-14の複合でお願いします。」「クリックでE-11、マウスオーバーでE-14タイプでお願いします。」

   盤の頭の下に**3つの札**（次の刃組で使える／作れる端数／使えるぶんの長さ）を並べる。
     マウスを乗せる（焦点を当てる）… その図が浮いて出る（E-14・表は動かない・`WL.popMenu`の1つ）
     押す                          … その図を表と入れ替えて全幅で開く（E-11・札がタブを兼ねる）
   いま開いている札には浮く図を出さない（同じ図を2か所に出さない・§CLAUDE 8）。

   数はすべて`WL.bladeSet.spacerOutlook()`の答え（刃組ガイダンスと同じ台車の載り方と積み方）。
   ここは**描くだけ**で、数え直さない。表と保存は`stock-board.js`が持つ。
   ============================================================ */
(function(){
 const fmt=v=>String(+(+v).toFixed(3));
 const nf=v=>Math.round(+v||0).toLocaleString('ja-JP');
 const pc=(v,max)=>(max>0?Math.max(0,Math.min(100,v/max*100)):0).toFixed(1);
 /* 札の顔ぶれと並び（左から: 表の中身 → 細かい寸法の効き → 全体の量）。 */
 const VIEWS=['table','frac','len'];
 const VIEW_WORD={table:'次の刃組で使える',frac:'作れる端数',len:'使えるぶんの長さ'};

 /* ---------- 小さな部品 ---------- */
 /* 内訳の棒（稼働中の台車／組み替える台車／棚）。`max`＝目盛りの端（全行で同じ）。 */
 const split=(r,max)=>`<span class="bk-split" aria-hidden="true"><i class="is-busy" style="width:${pc(r.busy,max)}%"></i>`
  +`<i class="is-car" style="width:${pc(r.onCar,max)}%"></i><i class="is-shelf" style="width:${pc(r.shelf,max)}%"></i></span>`;
 const recWord=r=>r?`${esc(r.carriage)}${r.at?`・${esc(String(r.at).slice(5,10).replace('-','/'))}の記録`:''}`:'';
 /* 凡例。記録が無いときは「みなし」を字で言う（出どころ・§CLAUDE 6）。 */
 function legend(o){
  if(!o.busy)return '<p class="bk-legend">刃組の記録がまだ無いので、保有を<b>ぜんぶ次の刃組で使える</b>とみなしています（台車に載っている数は記録から数えます）。</p>';
  return `<p class="bk-legend"><span class="bk-key is-busy"></span>稼働中の台車（${recWord(o.busy)}）に載っている＝外せない`
   +`<span class="bk-key is-car"></span>組み替える台車（${o.onCar?recWord(o.onCar):esc(o.carriage)+'・記録なし'}）に載っている＝そのまま使える`
   +`<span class="bk-key is-shelf"></span>棚にある</p>`;
 }
 /* 端数のマス。濃さ＝作れる区間の数（上限で頭打ち）、赤＝作れない。区切りの数は持たない（下限の言い換えにしない）。 */
 const cellCls=c=>c.free===0?' is-zero':'';
 const cellTone=(c,cap)=>c.free===0?'':` style="--k:${Math.round(32+58*Math.min(c.free,cap)/cap)}%"`;
 function fracGrid(o,full,sel){
  const F=o.frac;
  return `<div class="bk-frac${full?' is-full':''}" role="${full?'listbox':'img'}" aria-label="作れる端数の地図">${F.cells.map(c=>
   `<${full?'button type="button" role="option"':'span'} class="bk-fc${cellCls(c)}${full&&c.u===sel?' is-on':''}" data-u="${c.u}" data-n="${c.free}"${cellTone(c,F.cap)}`
   +` title="${c.label}：${c.free===0?'作れない':c.free+'か所'}">`
   +`<small>${c.label}</small><b>${c.free>=F.cap?F.cap+'+':c.free}</b></${full?'button':'span'}>`).join('')}</div>`;
 }
 const fracKey=o=>`<p class="bk-legend"><span class="bk-key is-zero"></span>作れない`
  +`<span class="bk-key is-fc"></span>濃いほど多く作れる（数字＝${o.frac.base}mm台の区間を、次の刃組で使える枚数で何か所ちょうどに作れるか・${o.frac.cap}で頭打ち）</p>`;

 /* いちばん作りにくい端数（作れる区間がいちばん少ないマス）。全幅を開いたときに最初に選ぶ・浮く図が名指しする。 */
 const worstCell=o=>o.frac.cells.reduce((w,c)=>(c.free<w.free?c:w),o.frac.cells[0]);

 /* ---------- 札（帯） ---------- */
 function fracSummary(o){
  const cells=o.frac.cells,zero=cells.filter(c=>c.free===0).length,min=Math.min(...cells.map(c=>c.free));
  const few=cells.filter(c=>c.free===min).length;
  return zero?{v:`${zero}<small>通りは作れない</small>`,warn:true}
   :{v:`${min>=o.frac.cap?o.frac.cap+'+':min}<small>か所（いちばん少ない端数・${few}通り）</small>`,warn:false};
 }
 function cardHtml(k,o,view){
  const s=o.sum,L=o.len,on=k===view;
  const body={
   table:()=>({v:`${nf(s.free)}<small> / 保有 ${nf(s.total)}枚</small>`,mini:split(s,s.total)}),
   frac:()=>Object.assign(fracSummary(o),{mini:`<span class="bk-mini">${o.frac.cells.map(c=>`<i class="${c.free===0?'is-zero':''}"${cellTone(c,o.frac.cap)}></i>`).join('')}</span>`}),
   len:()=>({v:L.perSet>0?`刃組 ${(L.free/L.perSet).toFixed(1)}<small>回ぶん（保有 ${(L.total/L.perSet).toFixed(1)}回）</small>`:'<small>有効長が未設定</small>',
             mini:`<span class="bk-split" aria-hidden="true"><i class="is-shelf" style="width:${pc(L.free,L.total)}%"></i><i class="is-busy" style="width:${pc(L.total-L.free,L.total)}%"></i></span>`})
  }[k]();
  return `<button type="button" role="tab" class="bk-sv${on?' is-on':''}" data-sv="${k}" aria-selected="${on}">`
   +`<s>${VIEW_WORD[k]}</s><b${body.warn?' class="is-warn"':''}>${body.v}</b><span class="bk-sv-mini">${body.mini}</span></button>`;
 }
 const bandHtml=(o,view)=>`<div class="bk-svband" role="tablist" aria-label="スペーサーの在庫の見通し">${VIEWS.map(k=>cardHtml(k,o,view)).join('')}</div>`;

 /* ---------- 浮く図（E-14）・全幅（E-11） ---------- */
 function tablePeek(o){
  const s=o.sum,row=(cls,w,n)=>`<span class="bk-key ${cls}"></span><span>${w}</span><b>${nf(n)}枚</b>`;
  return `<h4>保有 ${nf(s.total)}枚の内訳</h4>${o.busy?`<div class="bk-peek-rows">${row('is-busy',`稼働中の台車（${recWord(o.busy)}）＝外せない`,s.busy)}`
   +`${row('is-car',`組み替える台車（${o.onCar?recWord(o.onCar):esc(o.carriage)}）＝そのまま使える`,s.onCar)}${row('is-shelf','棚にある',s.shelf)}</div>`:legend(o)}`
   +`<p class="bk-peek-go">押すと、表に寸法ごとの内訳を出します。</p>`;
 }
 function cellWhy(o,c){
  const stack=c.stack.map(([sz,n])=>`${fmt(sz)}${n>1?'×'+n:''}`).join(' ＋ ')||'—';
  return `<dl class="bk-why"><dt>次の刃組で</dt><dd><b${c.free===0?' class="is-warn"':''}>${c.free===0?'作れない':c.free+'か所'}</b>（保有ぜんぶなら ${c.total}か所）</dd>`
   +`<dt>積みの例</dt><dd>${stack}　＝ ${fmt(o.frac.base+c.u*WL.bladeSet.FILL_STEP)}mm</dd>`
   +(c.short.length?`<dt>足りない寸法</dt><dd class="is-warn">${c.short.map(fmt).join('・')}（稼働中の台車に載っている）</dd>`:'')+`</dl>`;
 }
 function fracPeek(o){
  const w=worstCell(o);
  return `<h4>作れる端数の地図</h4>${fracGrid(o,false)}${fracKey(o)}<p>いちばん少ない端数 <b>${w.label}</b></p>${cellWhy(o,w)}`
   +`<p class="bk-peek-go">押すと、端数ごとの積みと理由を全幅で出します。</p>`;
 }
 function lenBars(o){
  const L=o.len,max=Math.max(L.total,L.perSet)||1;
  const marks=L.perSet>0?Array.from({length:Math.floor(max/L.perSet)},(_,i)=>`<u style="left:${pc((i+1)*L.perSet,max)}%"><em>${i+1}回</em></u>`).join(''):'';
  const bar=(free,total,m)=>`<span class="bk-lenbar"><i class="is-shelf" style="width:${pc(free,max)}%"></i><i class="is-busy" style="width:${pc(total-free,max)}%"></i>${m||''}</span>`;
  return `<div class="bk-len"><span><b>ぜんぶ</b></span>${bar(L.free,L.total,marks)}<span><b>${nf(L.free)}</b> / ${nf(L.total)}mm</span>`
   +L.byUse.map(u=>`<span>${esc(u.use||'（用途なし）')}</span>${bar(u.free,u.total)}<span><b>${nf(u.free)}</b> / ${nf(u.total)}mm</span>`).join('')+`</div>`
   +`<p class="bk-legend">刃組1回＝上下2軸×アーバー有効長＝<b>${nf(L.perSet)}mm</b>（刃組基準値）。濃い緑＝次の刃組で使える・灰＝稼働中の台車の上。`
   +`<b>目安</b>：刃組は寸法を混ぜて積むので、長さが足りても寸法の顔ぶれで組めないことがある（それは「作れる端数」が言う）。</p>`;
 }
 const lenPeek=o=>`<h4>並べた長さ（寸法×枚数）</h4>${lenBars(o)}<p class="bk-peek-go">押すと、寸法の分布と並べて全幅で出します。</p>`;
 function histHtml(o){
  const rows=o.rows.slice().sort((a,b)=>a.size-b.size),max=Math.max(1,...rows.map(r=>r.total));
  return `<div class="bk-hist">${rows.map(r=>`<span title="${fmt(r.size)}mm：使える ${r.free}／保有 ${r.total}"><b>${r.free}</b>`
   +`<i class="is-shelf" style="height:${pc(r.shelf,max)}%"></i><i class="is-car" style="height:${pc(r.onCar,max)}%"></i><i class="is-busy" style="height:${pc(r.busy,max)}%"></i></span>`).join('')}</div>`
   +`<div class="bk-hist-x">${rows.map(r=>`<span>${fmt(r.size)}</span>`).join('')}</div>`;
 }
 function fineList(o,c){
  const rows=o.rows.filter(r=>Math.abs(r.size-Math.round(r.size))>1e-9),max=Math.max(1,...rows.map(r=>r.total));
  const used=new Set(c.stack.map(([sz])=>sz));
  return `<h4>細かい寸法（端数を作る寸法）の内訳</h4><div class="bk-fine">${rows.map(r=>`<span class="bk-fine-s${used.has(r.size)?' is-on':''}">${fmt(r.size)}</span>`
   +`${split(r,max)}<span${c.short.includes(r.size)?' class="is-warn"':''}>使える <b>${r.free}</b> / 保有 ${r.total}</span>`).join('')}</div>`;
 }
 function viewHtml(kind,o,sel){
  if(kind==='frac'){const c=sel==null?worstCell(o):(o.frac.cells[sel]||worstCell(o));
   return `<div class="bk-svview is-frac"><section class="bk-card"><h4>作れる端数の地図（マスを押すと右に積みと理由）</h4>${fracGrid(o,true,c.u)}${fracKey(o)}</section>`
    +`<section class="bk-card"><h4>${c.label} の端数</h4>${cellWhy(o,c)}${fineList(o,c)}</section></div>`;}
  return `<div class="bk-svview is-len"><section class="bk-card"><h4>並べた長さ（寸法×枚数）</h4>${lenBars(o)}</section>`
   +`<section class="bk-card"><h4>寸法の分布（小さい順・高さ＝保有・上の数＝次の刃組で使える）</h4>${histHtml(o)}${legend(o)}</section></div>`;
 }
 const PEEK={table:tablePeek,frac:fracPeek,len:lenPeek};

 /* ---------- 表の列（`stockTable()`の`calc`へ渡す） ---------- */
 function tableCols(o){
  const by=new Map(o.rows.map(r=>[r.size,r])),max=Math.max(1,...o.rows.map(r=>r.total));
  return [{label:'内訳（稼働中／組み替え／棚）',html:x=>{const r=by.get(+x.size);return r?split(r,max):'—'}},
          {label:'次に使える',html:x=>{const r=by.get(+x.size);return r?`<b data-calc="free" data-v="${r.free}">${r.free}</b>枚`:'—'}}];
 }

 /* ---------- 配線: 乗せる＝浮く図／押す＝入れ替え ----------
    浮く面の開け閉め（待ち時間・面の上へ移る間は閉じない）は`WL.popMenu.peek()`の1箇所（§9.542で共有）。 */
 function wire(box,o,{onView,onCell}){
  box.querySelectorAll('.bk-sv[data-sv]').forEach(card=>{
   WL.popMenu.peek(card,{key:card.dataset.sv,cls:'bk-peek',html:()=>PEEK[card.dataset.sv](o),
    skip:()=>card.classList.contains('is-on')});
   card.onclick=()=>{WL.popMenu.closePeek();onView(card.dataset.sv)};
  });
  box.querySelectorAll('.bk-frac.is-full [data-u]').forEach(b=>{b.onclick=()=>onCell(+b.dataset.u)});
 }

 WL.spacerOutlook={VIEWS,bandHtml,legend,viewHtml,tableCols,wire,closePeek:()=>WL.popMenu.closePeek()};
})();
