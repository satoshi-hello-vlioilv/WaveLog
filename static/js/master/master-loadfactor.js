"use strict";
/* master-loadfactor.js: 換算係数——見積と実績の散布図・1ロットの積み上げ・係数の効き目と上書き
   （§9.543、利用者の選択 H-1＋H-5＋H-2）
   ============================================================
   「H-1とH-5とH-2の組み合わせでお願いします。」
   上から: 要約の数（当たっているか）→ 左＝見積×実績の散布図（主役・H-1）／右＝係数の効き目（H-2）。
     点を押す   … そのロットの見積がどう積み上がったか（基準時間×係数・H-5）を散布図の下に出す
     係数を押す … 下に上書きの欄。打つと保存の前に「効くロット・見積の変わり方」を字で言い、図の◆と点が動く
     積み上げの段を押す … その係数を右の図で選ぶ（H-5 → H-2）
   答え（1件ごとの見積・外れ値・要約）は**サーバーの1箇所**（`load_factor.points()`）——ここは描くだけ。
   因子の呼び名もサーバー（`FACTOR_LABELS`）。
   ============================================================ */
(function(){
 const {requireMaintUser,setMaintLoading}=WL.mm;
 const st={equipment:'',configured:true,model:null,points:[],summary:null,labels:{},lot:'',sel:null};
 const BASIS={equipment:'この設備の実績',pooled:'全設備の実績（この設備の実績が20件に足りない間）'};
 const nameOf=k=>(st.labels[k]||{}).label||k,unitOf=k=>(st.labels[k]||{}).unit||'';
 const levelText=(k,lv)=>`${nameOf(k)}＝${lv}${unitOf(k)&&/\d/.test(lv)?' '+unitOf(k):''}`;
 const pct=v=>Math.round(v*100);
 const mins=v=>WL.duration.text(v);
 const live=()=>st.points.filter(p=>!p.outlier&&p.estimate);
 const ovOf=(k,lv)=>((st.model&&st.model.overrides)||[]).find(o=>o.factor===k&&String(o.level||'')===String(lv||''));

 /* ---------- 読む ---------- */
 async function loadLoadFactorMaint(force){
  const list=$('#masterMaintList');if(!list)return;
  if(typeof WL.records.loadEquipmentMaster==='function'){try{await WL.records.loadEquipmentMaster(force)}catch(e){WL.quiet.note('設備マスタが読めなくても画面表示は継続する',e)}}
  const opts=WL.records.equipmentMasterState.items||[];
  if(!st.equipment&&opts.length)st.equipment=opts[0].name;
  renderForm();
  if(!st.equipment){list.innerHTML='<div class="mm-empty">設備マスタが未登録です。先に「設備」タブで登録してください。</div>';return}
  list.innerHTML='<div class="mm-empty">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/load-factors?equipment='+encodeURIComponent(st.equipment));
   st.configured=!!(r&&r.configured);st.model=st.configured?r.model:null;
   st.points=(r&&r.points)||[];st.summary=(r&&r.accuracy)||null;st.labels=(r&&r.factorLabels)||{};
   if(!st.points.some(p=>p.lot===st.lot))st.lot='';
   renderList();
  }catch(e){list.innerHTML=`<div class="mm-empty error">読み込みに失敗しました: ${esc(e.message)}</div>`}
 }
 function renderForm(){
  const form=$('#masterMaintForm');if(!form)return;
  const opts=WL.records.equipmentMasterState.items||[];
  form.innerHTML=`<div class="mm-cd-toolbar">
    <div class="mm-cd-dbtabs"><select id="mmLfEquipment" aria-label="設備">${opts.map(eq=>`<option value="${esc(eq.name)}"${eq.name===st.equipment?' selected':''}>${esc(eq.name)}</option>`).join('')||'<option value="">設備マスタが未登録です</option>'}</select></div>
    <p class="mm-form-hint lf-lead">見積は<b>基準時間 × 因子ごとの係数</b>です。左の図で当たり具合を見て、右の図で係数を直します（直した係数は予定の見積にすぐ効きます）。</p>
    <div class="mm-cd-actions"><button type="button" id="mmLfRecalc" class="mm-btn-ghost sm" title="完了した実績から係数を作り直します">再計算</button></div></div>`;
  form.onsubmit=ev=>ev.preventDefault();
  $('#mmLfEquipment').onchange=e=>{st.equipment=e.target.value;st.lot='';st.sel=null;loadLoadFactorMaint(false)};
  $('#mmLfRecalc').onclick=recalc;
 }
 async function recalc(){
  const uid=requireMaintUser();if(uid===null)return;
  try{
   setMaintLoading(true,'再計算しています…');
   await api('/api/schedule/load-factors/recalc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment:st.equipment,user_id:uid})});
   await loadLoadFactorMaint(true);
   showToast('再計算しました','完了した実績から係数を作り直しました。',3200);
  }catch(e){showToast('再計算できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---------- 全体 ---------- */
 function renderList(){
  const list=$('#masterMaintList');if(!list)return;
  if(!st.configured){list.innerHTML='<div class="mm-empty">スケジュール機能が設定されていません(config/local.jsonのschedule_share_path未設定)。</div>';return}
  if(!st.model){list.innerHTML='<div class="mm-empty">この設備の完了実績がまだ無く、係数を作れません。完了した実績（開始と終了の時刻つき）がたまると作ります。</div>';return}
  list.innerHTML=`${kpiHtml()}<div class="lf-grid"><section class="lf-col"><div class="lf-box" id="lfPlot">${plotHtml()}</div><div class="lf-box" id="lfWf">${wfHtml()}</div></section>`
   +`<section class="lf-col"><div class="lf-box" id="lfForest">${forestHtml()}</div><div class="lf-box" id="lfEdit">${editHtml()}</div></section></div>`;
  wire(list);
 }
 function kpiHtml(){
  const m=st.model,s=st.summary,base=ovOf('BASE','');
  const card=(key,v,label,val,note,tone)=>`<div class="lf-kpi${tone?' is-'+tone:''}" data-lf-kpi="${key}" data-v="${v}"><small>${label}</small><b>${val}</b>${note?`<i>${note}</i>`:''}</div>`;
  const r=s&&s.ratio,rWord=r==null?'—':Math.abs(r-1)<.02?'見積どおり':`見積より ${pct(Math.abs(r-1))}% ${r>1?'長い':'短い'}`;
  return `<div class="lf-kpis">${card('base',m.T0,'基準時間（1ロット）',mins(base?base.coefficient:m.T0),base?`上書き中（自動は ${mins(m.T0)}）`:'')}`
   +(s&&s.n?card('within20',s.within20,'見積の±20%に入った実績',`${pct(s.within20)}%`,`${Math.round(s.within20*s.n)}/${s.n}件`)
    +card('ratio',r,'実績 ÷ 見積（中央値）',rWord,'',r!=null&&Math.abs(r-1)>=.1?'warn':'')
    +card('band',s.band||0,'80%の帯（見積の）',s.band?`±${pct(s.band-1)}%`:'—',s.band?`帯に入った ${s.inBand}/${s.n}件`:'')
    :card('within20','','見積と実績','—','この設備の完了実績はまだありません'))
   +card('out',s?s.outliers:(m.excluded||0),'外れ値として除いた実績',`${s?s.outliers:(m.excluded||0)}件`,'係数に使っていない')
   +`</div><p class="lf-src">出どころ: ${esc(BASIS[m.basis]||m.basis||'—')}・${m.n}件／係数を作った時刻 ${esc(WL.mm.fmtDT?WL.mm.fmtDT(m.calculatedAt):String(m.calculatedAt||'—'))}</p>`;
 }

 /* ---------- 散布図（H-1） ---------- */
 const PW=640,PH=400,PM={l:48,r:14,t:12,b:36};
 function plotScale(){
  const v=st.points.flatMap(p=>[p.actual,p.estimate]).filter(x=>x>0);
  const lo=Math.log(Math.min(...v)*.85),hi=Math.log(Math.max(...v)*1.15);
  return {lo,hi,X:x=>PM.l+(Math.log(x)-lo)/(hi-lo)*(PW-PM.l-PM.r),Y:y=>PH-PM.b-(Math.log(y)-lo)/(hi-lo)*(PH-PM.t-PM.b)};
 }
 function ticks(lo,hi){
  const out=[];for(const d of [1,10,100,1000])for(const k of [1,1.5,2,3,5,7])out.push(d*k);
  return out.filter(t=>Math.log(t)>=lo&&Math.log(t)<=hi);
 }
 function plotHtml(){
  if(!st.points.length)return '<h4>見積 × 実績</h4><div class="mm-empty">この設備の完了実績はまだありません（係数は全設備の実績から作っています）。</div>';
  const {lo,hi,X,Y}=plotScale(),b=(st.summary&&st.summary.band)||1,e0=Math.exp(lo),e1=Math.exp(hi);
  let s=`<svg class="lf-svg" viewBox="0 0 ${PW} ${PH}" role="img" aria-label="見積と実績の散布図">`;
  ticks(lo,hi).forEach(t=>{s+=`<line class="lf-grid-l" x1="${X(t)}" y1="${PM.t}" x2="${X(t)}" y2="${PH-PM.b}"/><line class="lf-grid-l" x1="${PM.l}" y1="${Y(t)}" x2="${PW-PM.r}" y2="${Y(t)}"/>`
   +`<text class="lf-t" x="${X(t)}" y="${PH-PM.b+14}" text-anchor="middle">${t}</text><text class="lf-t" x="${PM.l-5}" y="${Y(t)+3}" text-anchor="end">${t}</text>`});
  s+=`<path class="lf-band" d="M${X(e0)},${Y(Math.min(e1,e0*b))} L${X(e1/b)},${Y(e1)} L${X(e1)},${Y(e1)} L${X(e1)},${Y(e1/b)} L${X(Math.min(e1,e0*b))},${Y(e0)} L${X(e0)},${Y(e0)}Z"/>`
   +`<line class="lf-eq" x1="${X(e0)}" y1="${Y(e0)}" x2="${X(e1)}" y2="${Y(e1)}"/>`;
  s+=st.points.map(p=>{const inb=!p.outlier&&Math.abs(Math.log(p.actual/p.estimate))<=Math.log(b);
   return `<circle class="lf-pt${p.outlier?' is-out':inb?'':' is-off'}${p.lot===st.lot?' is-sel':''}" cx="${X(p.estimate).toFixed(1)}" cy="${Y(p.actual).toFixed(1)}" r="${p.lot===st.lot?6:4}"`
    +` data-lf-lot="${esc(p.lot)}" data-est="${p.estimate}" data-act="${p.actual}" data-out="${p.outlier?1:0}"/>`}).join('');
  s+=`<text class="lf-t" x="${(PW+PM.l)/2}" y="${PH-4}" text-anchor="middle">見積（分・対数の目盛り）</text>`
   +`<text class="lf-t" x="12" y="${(PH-PM.b)/2}" transform="rotate(-90 12 ${(PH-PM.b)/2})" text-anchor="middle">実績（分）</text>`
   +`<text class="lf-t" x="${X(e1)-6}" y="${Y(e1)+14}" text-anchor="end">見積＝実績</text></svg>`;
  return `<h4>見積 × 実績 <small>1点＝1ロット。斜めの線より上は見積より長くかかった。点を押すと下に見積の積み上げ</small></h4>${s}${plotKey()}`;
 }
 function plotKey(){
  const s=st.summary||{},n=st.points.length,out=s.outliers||0,inb=s.inBand||0;
  return `<p class="lf-key"><span><i class="lf-sw is-in"></i>帯の中 ${inb}件</span><span><i class="lf-sw is-off"></i>帯の外 ${Math.max(0,(s.n||0)-inb)}件</span>`
   +`<span><i class="lf-sw is-out"></i>外れ値（係数に使っていない） ${out}件</span><span><i class="lf-sw is-band"></i>80%の帯</span>`
   +(s.total>n?`<span>新しい ${n}件を表示（全 ${s.total}件）</span>`:'')+`</p>`;
 }

 /* ---------- 1ロットの積み上げ（H-5） ---------- */
 function wfHtml(){
  const p=st.points.find(x=>x.lot===st.lot);
  if(!p)return '<h4>1ロットの見積の積み上げ</h4><p class="lf-empty">図の点を押すと、そのロットの見積が「基準時間 × 係数」でどう積み上がったかを出します。</p>';
  if(!p.base)return `<h4>ロット ${esc(p.lot)}</h4><p class="lf-empty">この見積は係数から作っていません（${esc(p.basis||'')}）。</p>`;
  const rows=[];let cur=p.base;
  p.factors.forEach(f=>{const to=cur*f.value;rows.push({f,from:cur,to});cur=to});
  const max=Math.max(p.actual,p.estimate,...rows.map(r=>Math.max(r.from,r.to)))*1.1,X=v=>v/max*100;
  const bar=(from,to,cls)=>`<span class="lf-wbar"><b class="${cls}" style="left:${X(Math.min(from,to)).toFixed(2)}%;width:${Math.max(.6,Math.abs(X(to)-X(from))).toFixed(2)}%"></b><em style="left:${X(p.actual).toFixed(2)}%"></em></span>`;
  const top=rows.reduce((a,r)=>Math.abs(Math.log(r.f.value))>Math.abs(Math.log(a.f.value))?r:a,rows[0]||{f:{value:1}});
  return `<h4>ロット ${esc(p.lot)} の見積の積み上げ <small>${esc(String(p.at||'').slice(0,10))}・段を押すと右の図でその係数を選ぶ</small></h4><div class="lf-wf">`
   +`<div class="lf-wrow" data-lf-wf-base data-v="${p.base}"><span>基準時間</span>${bar(0,p.base,'is-base')}<span>${mins(p.base)}</span></div>`
   +rows.map(r=>`<div class="lf-wrow is-step" data-lf-step data-v="${r.f.value}" data-key="${esc(r.f.key)}" data-level="${esc(r.f.level)}" role="button" tabindex="0"><span>${esc(levelText(r.f.key,r.f.level))}</span>`
    +`${bar(r.from,r.to,r.f.value>1.005?'is-up':r.f.value<.995?'is-dn':'is-flat')}<span>×${r.f.value}${r.f.source==='override'?'（上書き）':r.f.source==='unknown'?'（実績なし）':''}</span></div>`).join('')
   +`<div class="lf-wrow is-total" data-lf-wf-total data-v="${p.estimate}"><span>見積</span>${bar(0,p.estimate,'is-total')}<span>${mins(p.estimate)}</span></div></div>`
   +`<p class="lf-read">実績は <b>${mins(p.actual)}</b>（紫の線・見積の ${pct(p.actual/p.estimate)}%）。いちばん効いている係数は <b>${esc(top.f.key?levelText(top.f.key,top.f.level):'—')}（×${top.f.value}）</b>。</p>`;
 }

 /* ---------- 係数の効き目（H-2） ---------- */
 /* 係数の図の物差し（対数・×1 が基準）。描くのも、打った値の◆を置くのもこの1つ。 */
 function forestScale(){
  const vals=(st.model.factors||[]).map(f=>f.value).concat(((st.model.overrides||[]).filter(o=>o.factor!=='BASE')).map(o=>o.coefficient),[.8,1.25]);
  const lo=Math.log(Math.min(...vals)*.92),hi=Math.log(Math.max(...vals)*1.08),W=520,L=170,R=70;
  return {lo,hi,W,R,L,X:v=>L+(Math.log(Math.max(v,1e-6))-lo)/(hi-lo)*(W-L-R)};
 }
 /* 水準の並び: 数の水準は小さい順（「〜a」が先・「a〜b」「a」は a で比べる）、字の水準は件数の多い順。 */
 const levelNum=lv=>{const t=String(lv).trim();if(/^〜/.test(t))return -Infinity;const n=parseFloat(t);return Number.isFinite(n)?n:null};
 function forestRows(){
  const m=st.model,rows=[{base:true}],by=new Map();
  (m.factors||[]).forEach(f=>{if(!by.has(f.key))by.set(f.key,[]);by.get(f.key).push(f)});
  by.forEach((fs,key)=>{
   const num=fs.every(f=>levelNum(f.level)!==null);
   fs.sort((a,b)=>num?levelNum(a.level)-levelNum(b.level):b.n-a.n);
   rows.push({head:key},...fs.map(f=>({f})));
  });
  return rows;
 }
 function forestHtml(){
  const rows=forestRows(),{X,lo,hi,W,R}=forestScale(),rh=19,H=rows.length*rh+26;
  let s=`<svg class="lf-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="係数の効き目"><line class="lf-one" x1="${X(1)}" y1="2" x2="${X(1)}" y2="${H-22}"/>`;
  [.8,1,1.25,1.5].filter(v=>Math.log(v)>lo&&Math.log(v)<hi).forEach(v=>{s+=`<text class="lf-t" x="${X(v)}" y="${H-8}" text-anchor="middle">${v===1?'×1（基準）':'×'+v}</text>`});
  rows.forEach((r,i)=>{s+=forestRow(r,i,{X,W,R,rh})});
  s+=`<text class="lf-dt" data-lf-draft-t text-anchor="end"></text>`;
  return `<h4>係数の効き目 <small>×1 の線より右＝長くかかる・左＝短い。横棒は確からしさ（件数が少ないほど長い）。◆＝手動上書き。押すと下で直せる</small></h4>${s}</svg>`;
 }
 function forestRow(r,i,{X,W,R,rh}){
  const y=12+i*rh,m=st.model;
  if(r.head)return `<text class="lf-th" x="4" y="${y+4}">${esc(nameOf(r.head))}${unitOf(r.head)?`（${esc(unitOf(r.head))}）`:''}</text>`;
  const key=r.base?'BASE':r.f.key,lv=r.base?'':r.f.level,ov=ovOf(key,lv),sel=st.sel&&st.sel.key===key&&st.sel.level===lv;
  const hit=`<rect class="lf-hit${sel?' is-sel':''}" x="0" y="${y-rh/2}" width="${W}" height="${rh}" data-lf-level-row data-key="${esc(key)}" data-level="${esc(lv)}" role="button" tabindex="0"/>`;
  if(r.base)return hit+`<text class="lf-th" x="4" y="${y+4}">基準時間</text><text class="lf-t" x="${W-R+6}" y="${y+4}">${mins(m.T0)}${ov?' → '+mins(ov.coefficient):''}</text>`;
  const f=r.f,half=1/Math.sqrt(Math.max(1,f.n)),thin=f.n<10;
  return hit+`<text class="lf-tl" x="16" y="${y+4}">${esc(f.level)}</text><text class="lf-t" x="150" y="${y+4}" text-anchor="end">${f.n}件</text>`
   +`<line class="lf-ci" x1="${X(f.value*Math.exp(-half*.5))}" y1="${y}" x2="${X(f.value*Math.exp(half*.5))}" y2="${y}"/>`
   +`<circle class="lf-dot${thin?' is-thin':''}" cx="${X(f.value)}" cy="${y}" r="4"/>`
   +(ov?`<path class="lf-ov" d="M${X(ov.coefficient)},${y-6} l6,6 l-6,6 l-6,-6z"/>`:'')
   +`<path class="lf-ov is-draft" data-lf-draft="${esc(key+'|'+lv)}" d="" />`
   +`<text class="lf-t" x="${W-R+6}" y="${y+4}">×${f.value}${ov?' → ×'+ov.coefficient:''}${thin?' 少ない':''}</text>`;
 }

 /* ---------- 上書き（選んだ係数） ---------- */
 function editHtml(){
  const s=st.sel;
  if(!s)return '<h4>係数を直す</h4><p class="lf-empty">右上の図で係数（または基準時間）を押すと、ここで上書きできます。保存の前に、効くロットと見積の変わり方を出します。</p>';
  const base=s.key==='BASE',f=base?null:(st.model.factors||[]).find(x=>x.key===s.key&&x.level===s.level),ov=ovOf(s.key,s.level);
  const auto=base?`${mins(st.model.T0)}（実績 ${st.model.n}件の中央値から）`:`×${f?f.value:1}（${f?f.n:0}件${f&&f.n<10?'・件数が少ないので×1寄りに縮めてある':''}）`;
  return `<h4>${base?'基準時間':esc(levelText(s.key,s.level))} を直す</h4><dl class="lf-dl"><dt>自動の値</dt><dd>${auto}</dd>`
   +`<dt>手動上書き</dt><dd>${ov?`<b class="lf-ovv">${base?mins(ov.coefficient):'×'+ov.coefficient}</b>${ov.reason?`（${esc(ov.reason)}）`:''}`:'なし'}</dd>`
   +`<dt>${base?'分で上書き':'係数で上書き'}</dt><dd class="lf-ovrow"><input type="number" id="lfOvValue" step="${base?'0.1':'0.01'}" min="0" value="${ov?esc(ov.coefficient):''}" placeholder="${base?'例 40':'例 1.25'}" aria-label="上書きする値">`
   +`<button type="button" id="lfOvSave" class="mm-btn-primary sm">保存</button>${ov?'<button type="button" id="lfOvClear" class="mm-btn-ghost sm">解除（自動に戻す）</button>':''}</dd></dl>`
   +`<p class="lf-prev" data-lf-preview data-lots="0" data-delta="0"></p>`;
 }
 /* 打った値の効き目（保存の前）。効くロット＝外れ値を除いた実績のうち、その係数を使っているもの。 */
 function previewOf(val){
  const s=st.sel;if(!s)return null;
  const base=s.key==='BASE',hits=live().filter(p=>base?p.base:(p.factors||[]).some(f=>f.key===s.key&&f.level===s.level));
  const delta=hits.reduce((a,p)=>{const cur=base?p.base:p.factors.find(f=>f.key===s.key&&f.level===s.level).value;return a+p.estimate*(val/cur-1)},0);
  return {hits,delta,mean:hits.length?hits.reduce((a,p)=>a+p.estimate,0)/hits.length:0};
 }
 function paintPreview(){
  const el=$('#lfOvValue'),out=document.querySelector('#lfEdit [data-lf-preview]');if(!el||!out)return;
  const v=Number(el.value),ok=el.value.trim()!==''&&Number.isFinite(v)&&v>0,pv=previewOf(ok?v:NaN),s=st.sel;
  const hits=new Set(pv?pv.hits.map(p=>p.lot):[]);
  document.querySelectorAll('#lfPlot [data-lf-lot]').forEach(c=>c.classList.toggle('is-hit',hits.has(c.dataset.lfLot)));
  out.dataset.lots=pv?pv.hits.length:0;out.dataset.delta=ok&&pv?pv.delta.toFixed(2):0;
  out.innerHTML=!pv?'':`効くロット: 実績 <b>${pv.hits.length}件</b>（図で緑の輪）。`
   +(ok?`この値なら見積は 1件あたり平均 ${mins(pv.mean)} → <b>${mins(pv.mean+pv.delta/Math.max(1,pv.hits.length))}</b>（${pv.delta>=0?'+':''}${Math.round(pv.delta)}分・${pv.hits.length}件の合計）。保存すると予定の見積にもすぐ効きます。`:'値を打つと、見積の変わり方をここに出します。');
  paintDraft(s,ok?v:null);
 }
 function paintDraft(s,v){
  document.querySelectorAll('#lfForest [data-lf-draft]').forEach(p=>p.setAttribute('d',''));
  const t0=document.querySelector('#lfForest [data-lf-draft-t]');if(t0)t0.textContent='';
  if(!s||v==null||s.key==='BASE')return;
  const p=document.querySelector(`#lfForest [data-lf-draft="${CSS.escape(s.key+'|'+s.level)}"]`),dot=p&&p.parentNode.querySelector(`[data-lf-level-row][data-key="${CSS.escape(s.key)}"][data-level="${CSS.escape(s.level)}"]`);
  if(!p||!dot)return;
  /* 物差しの外の値は**端で止め**、値は字で添える（図を描き直さない——打っている途中に物差しが動くと読めない）。 */
  const {X,L,W,R}=forestScale(),y=+dot.getAttribute('y')+(+dot.getAttribute('height'))/2,x=Math.min(Math.max(X(v),L),W-R);
  p.setAttribute('d',`M${x},${y-6} l6,6 l-6,6 l-6,-6z`);
  const t=document.querySelector('#lfForest [data-lf-draft-t]');
  if(t){t.setAttribute('x',x-9);t.setAttribute('y',y+4);t.textContent=`打った値 ×${v}`}
 }
 async function saveOverride(clear){
  const uid=requireMaintUser();if(uid===null)return;
  const s=st.sel,el=$('#lfOvValue');let coefficient=null;
  if(!clear){const v=Number(el&&el.value);if(!el||el.value.trim()===''||!Number.isFinite(v)||v<=0){showToast('値を入れてください',s.key==='BASE'?'基準時間は分で入れます。':'係数は 0 より大きい数で入れます（例 1.25）。',4000);return}coefficient=v}
  try{
   setMaintLoading(true,clear?'上書きを解除しています…':'上書きを保存しています…');
   await api('/api/schedule/load-factors/override',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({equipment:st.equipment,factor:s.key,level:s.level,coefficient,user_id:uid})});
   await loadLoadFactorMaint(true);
   showToast(clear?'上書きを解除しました':'上書きを保存しました','予定の見積にもすぐ効きます。',3200);
  }catch(e){showToast('保存できませんでした',e.message,6500)}
  finally{setMaintLoading(false)}
 }

 /* ---------- 配線 ---------- */
 function selectLevel(key,level){st.sel={key,level};renderList()}
 function wire(list){
  list.querySelectorAll('#lfPlot [data-lf-lot]').forEach(c=>{
   c.addEventListener('click',()=>{st.lot=c.dataset.lfLot;WL.popMenu.closePeek();renderList()});
   WL.popMenu.peek(c,{key:c.dataset.lfLot,cls:'lf-peek',side:'above',html:()=>peekHtml(c.dataset.lfLot)});
  });
  list.querySelectorAll('[data-lf-level-row],#lfWf [data-lf-step]').forEach(r=>{
   const go=()=>selectLevel(r.dataset.key,r.dataset.level);
   r.addEventListener('click',go);r.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}});
  });
  const inp=$('#lfOvValue');if(inp){inp.addEventListener('input',paintPreview);paintPreview()}
  const sv=$('#lfOvSave');if(sv)sv.onclick=()=>saveOverride(false);
  const cl=$('#lfOvClear');if(cl)cl.onclick=()=>saveOverride(true);
 }
 function peekHtml(lot){
  const p=st.points.find(x=>x.lot===lot);if(!p)return '';
  return `<h4>ロット ${esc(p.lot)}</h4><p>実績 <b>${mins(p.actual)}</b>／見積 ${mins(p.estimate)}（${pct(p.actual/p.estimate)}%）</p>`
   +`<p>${esc(String(p.at||'').replace('T',' ').slice(0,16))}${p.outlier?'・<b>外れ値</b>（係数に使っていない）':''}</p><p class="lf-pgo">押すと、見積の積み上げを下に出します。</p>`;
 }

 WL.mm.registerSpecial('load-factor',{load:loadLoadFactorMaint});
})();
