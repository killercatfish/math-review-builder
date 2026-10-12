(function(){
"use strict";
/* Capture the page as authored, before anything renders, so a kit can be saved as a standalone page. */
const ORIGIN = { app: document.getElementById('app').outerHTML, print: document.getElementById('print-root').outerHTML };
let BAKED=null;
try{ BAKED=JSON.parse(document.getElementById('kit-data').textContent); }catch(e){ BAKED=null; }
const IN_CLAUDE = !!(window.claude && typeof window.claude.use === 'function');
const STORE_KEY='review-kit:last';
const PARENT_PROMPT = /*PARENT_PROMPT*/"";
const CLAUDE_BUILDER_URL = /*CLAUDE_URL*/"";
const REPO_URL = 'https://github.com/killercatfish/math-review-builder';

/* ================= shared helpers ================= */
const MACROS = {"\\hl":"\\htmlClass{hl}{#1}","\\warn":"\\htmlClass{warn}{#1}"};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function tex(src, display){
  if(typeof katex==='undefined') return '<code>'+esc(src)+'</code>';
  try{ return katex.renderToString(String(src||''),{displayMode:display!==false,throwOnError:false,macros:MACROS,trust:(c)=>c.command==="\\htmlClass",strict:false}); }
  catch(e){ return '<code>'+esc(src)+'</code>'; }
}
const STATUS = {correct:"Right",partial:"Partial credit",wrong:"Missed",blank:"Left blank",unknown:"No grade visible"};
const STEP_MS = 2700;
const $id = (id)=>document.getElementById(id);

/* ---------- number checking with math.js ---------- */
const SCOPES = [0,1,2].map(s=>{const o={};'abcdfghjklmnopqrstuvwxyz'.split('').forEach((ch,k)=>{o[ch]=0.55+((k*7+s*13)%17)/10;});return o;});
function num(v){
  if(typeof v==='number') return v;
  if(v && typeof v==='object'){ if(typeof v.re==='number' && Math.abs(v.im||0)<1e-9) return v.re; if(typeof v.valueOf==='function'){const n=Number(v.valueOf()); if(!isNaN(n)) return n;} }
  return NaN;
}
function close(p,q){ return isFinite(p)&&isFinite(q)&&Math.abs(p-q)<=1e-7*Math.max(1,Math.abs(p),Math.abs(q)); }
function runCheck(chk){
  if(!chk || typeof math==='undefined') return {ok:null};
  if(chk.type==='expr'){
    const pairs=SCOPES.map(s=>[num(math.evaluate(String(chk.given_expr),Object.assign({},s))),num(math.evaluate(String(chk.expected),Object.assign({},s)))]);
    return {ok:pairs.every(([a,b])=>close(a,b)),pairs};
  }
  if(chk.type==='solve'){
    const kv=num(math.evaluate(String(chk.expected)));
    const pairs=SCOPES.map(s=>{const sc=Object.assign({},s,{[chk.var]:kv});return [num(math.evaluate(String(chk.lhs),sc)),num(math.evaluate(String(chk.rhs),Object.assign({},sc)))];});
    return {ok:pairs.every(([a,b])=>close(a,b)),pairs};
  }
  return {ok:null};
}
function verify(chk){ try{ return runCheck(chk).ok; }catch(e){ return false; } }
function checkTag(chk){
  const r=verify(chk);
  if(r===true) return '<span class="check good" title="Checked by plugging in numbers">✓ checked</span>';
  if(r===false) return '<span class="check flag">double-check this one</span>';
  return '';
}

/* ================= the player ================= */
function Player(host, item, opts){
  const frames=[{label:opts.firstLabel||"The problem",math:item.problem,caption:opts.firstCaption||"Try it on paper first. Press play when you're ready to check."}].concat(item.steps||[]);
  let i=0, timer=null;
  host.innerHTML=`<div class="stage" aria-live="polite"><div class="flabel"></div><div class="math"></div><p class="caption"></p></div>
  <div class="controls"><button class="ctl prev" aria-label="Previous step">←</button><button class="ctl play">Play</button><button class="ctl next" aria-label="Next step">→</button><div class="dots"></div></div>`;
  const q=s=>host.querySelector(s);
  const dots=q('.dots');
  frames.forEach((f,k)=>{const d=document.createElement('button');d.className='dot';d.setAttribute('aria-label','Step '+(k+1));d.onclick=()=>{stop();go(k)};dots.appendChild(d)});
  function go(k){
    i=Math.max(0,Math.min(frames.length-1,k));
    const f=frames[i];
    q('.flabel').textContent=f.label||'';
    const m=q('.math'); m.innerHTML=tex(f.math); m.classList.remove('fade'); void m.offsetWidth; m.classList.add('fade');
    q('.caption').textContent=f.caption||'';
    [...dots.children].forEach((d,k)=>d.classList.toggle('on',k===i));
    q('.prev').disabled=i===0; q('.next').disabled=i===frames.length-1;
  }
  function stop(){clearInterval(timer);timer=null;q('.play').textContent=i===frames.length-1&&frames.length>1?'Replay':'Play';}
  function play(){
    if(i===frames.length-1) go(0);
    q('.play').textContent='Pause';
    timer=setInterval(()=>{ if(i>=frames.length-1){stop();return;} go(i+1); if(i===frames.length-1) stop(); },STEP_MS);
  }
  q('.play').onclick=()=>timer?stop():(go(i===0?1:i),play());
  q('.prev').onclick=()=>{stop();go(i-1)};
  q('.next').onclick=()=>{stop();go(i+1);stop()};
  host.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){stop();go(i+1)}else if(e.key==='ArrowLeft'){stop();go(i-1)}});
  if(frames.length<2) q('.play').disabled=true;
  go(0);
  return {destroy:()=>clearInterval(timer)};
}

function station(chipHost, panelHost, items, kind){
  let current=null;
  chipHost.innerHTML=''; panelHost.innerHTML='';
  if(!items.length){ panelHost.innerHTML='<p class="lede">Nothing here yet.</p>'; return; }
  function open(idx){
    if(current) current.destroy();
    const it=items[idx];
    [...chipHost.children].forEach((c,k)=>c.setAttribute('aria-pressed',String(k===idx)));
    let head='';
    if(kind==='test'){
      head=`<div class="panel-head"><h3>Question ${esc(it.n)}</h3><span class="pill" data-s="${esc(it.status)}">${esc(STATUS[it.status]||it.status)}</span>${it.points?`<span class="pts">${esc(it.points)} pts</span>`:''}${checkTag(it.check)}</div>
      <p class="prompt">${esc([it.section,it.prompt].filter(Boolean).join(' · '))}</p>`;
      if(it.what_broke){
        head+=`<details class="broke"><summary>What happened on the test</summary><p>${esc(it.what_broke)}</p>${it.student_answer?`<div class="yours">On the test: ${tex(it.student_answer,false)}</div>`:''}</details>`;
      }
    } else {
      head=`<div class="panel-head"><h3>Practice ${esc(it.n)}</h3><span class="pts">${esc(it.section||'')}</span>${checkTag(it.check)}</div><p class="prompt">${esc(it.prompt||'')}</p>`;
    }
    panelHost.innerHTML=`<div class="panel">${head}<div class="player"></div></div>`;
    current=Player(panelHost.querySelector('.player'),it,{});
  }
  items.forEach((it,k)=>{
    const b=document.createElement('button');
    b.className='chip'; b.dataset.s=kind==='test'?it.status:'practice';
    b.textContent=(kind==='test'?'#':'P')+it.n;
    b.setAttribute('aria-label',(kind==='test'?'Question ':'Practice ')+it.n+(kind==='test'?', '+(STATUS[it.status]||''):''));
    b.onclick=()=>open(k);
    chipHost.appendChild(b);
  });
  let start=0; if(kind==='test'){const w=items.findIndex(t=>t.status!=='correct'); start=w<0?0:w;}
  open(start);
}

/* ================= render a kit ================= */
function render(KIT, mode){
  $id('course').textContent=KIT.course||'';
  $id('title').textContent=KIT.title||'Review';
  $id('score').textContent=KIT.score?('Test score '+KIT.score):'';
  $id('summary').textContent=KIT.student_summary||'';
  $id('schema').textContent=KIT.schema||'math-review-kit';
  document.title=(KIT.title||'Math review').slice(0,60);

  station($id('test-chips'),$id('test-panel'),KIT.test_questions||[],'test');
  station($id('practice-chips'),$id('practice-panel'),KIT.practice||[],'practice');
  const pl=document.querySelector('#practice .lede');
  if(pl){ const n=(KIT.practice||[]).length; pl.textContent=`${n} problem${n===1?'':'s'} built from the missed ones. The answer only shows on the last frame.`; }

  const rh=$id('refreshers'); rh.innerHTML='';
  $id('refresh').hidden=!(KIT.background||[]).length;
  (KIT.background||[]).forEach(b=>{
    const card=document.createElement('div'); card.className='panel refresher';
    card.innerHTML=`<div class="panel-head"><h3>${esc(b.topic)}</h3></div><p class="explain">${esc(b.explanation)}</p><div class="player"></div>`;
    rh.appendChild(card);
    const steps=b.steps||[];
    Player(card.querySelector('.player'),{problem:steps[0]?steps[0].math:'',steps:steps.slice(1)},{firstLabel:steps[0]?steps[0].label:'',firstCaption:steps[0]?steps[0].caption:''});
  });

  const how=$id('paper-how');
  if(how && (mode==='standalone'||mode==='site')) how.textContent='Use the print buttons at the top of this page. The practice sheet prints with boxed work space and no answers; the answer key prints separately with every step worked out.';
  else if(how && mode==='built') how.textContent='Save the printable page with the button at the top, then open the saved file in any browser. It works offline and has buttons to print the practice sheet and the answer key separately.';

  /* print sheet + key */
  const P=KIT.practice||[];
  let layout=Array.isArray(KIT.print_layout)&&KIT.print_layout.reduce((a,b)=>a+b,0)===P.length?KIT.print_layout:(P.length>6?[6,P.length-6]:[P.length]);
  let html='', idx=0;
  layout.forEach((count,pg)=>{
    html+=`<div class="${pg?'pagebreak':''}"><div class="p-head"><h1>${esc(KIT.title)}${pg?' (continued)':''}</h1><div class="nd">Name ____________________ &nbsp; Date __________</div></div>`;
    let sec=null, grid='';
    const flush=()=>{ if(grid){ html+=`<div class="p-grid">${grid}</div>`; grid=''; } };
    P.slice(idx,idx+count).forEach(p=>{
      if(p.section!==sec){ flush(); sec=p.section; html+=`<div class="p-sec">${esc(sec)}</div>`; }
      grid+=`<div class="p-box" style="min-height:${pg?'3.7in':'2.05in'}"><div class="q"><span class="n">${esc(p.n)}.</span><div><div class="pm">${esc(p.prompt)}</div><div class="km">${tex(p.problem,false)}</div></div></div></div>`;
    });
    flush(); html+='</div>'; idx+=count;
  });
  $id('print-sheet').innerHTML=html;
  let key=`<div class="p-head"><h1>Answer key: ${esc(KIT.title)}</h1></div>`;
  P.forEach(p=>{
    key+=`<div class="key-item"><div class="n">${esc(p.n)}.</div><div><div>${tex(p.problem,false)} &nbsp;→&nbsp; <span class="ans">${tex(p.answer,false)}</span></div><div class="lines">${(p.worked_solution||[]).map(l=>'<div>'+tex(l,false)+'</div>').join('')}</div></div></div>`;
  });
  $id('print-key').innerHTML=key;
}

/* Standalone copies (opened from a saved file) can print. */
function addPrintBar(){
  const bar=document.createElement('div'); bar.className='printbar';
  bar.innerHTML='<button class="ctl play" data-p="sheet">Print practice sheet</button><button class="ctl" data-p="key">Print answer key</button>';
  bar.querySelectorAll('button').forEach(b=>b.onclick=()=>{document.body.dataset.print=b.dataset.p;window.print();});
  document.querySelector('#app header').appendChild(bar);
}

/* ================= reading pasted JSON ================= */
function extractObjects(t){
  const parts=[]; let depth=0,inStr=false,escNext=false,start=-1;
  for(let i=0;i<t.length;i++){
    const ch=t[i];
    if(inStr){ if(escNext) escNext=false; else if(ch==='\\') escNext=true; else if(ch==='"') inStr=false; continue; }
    if(depth>0 && ch==='"'){ inStr=true; continue; }
    if(ch==='{'){ if(depth===0) start=i; depth++; }
    else if(ch==='}' && depth>0){ depth--; if(depth===0){ parts.push(t.slice(start,i+1)); start=-1; } }
    else if(depth>0 && (ch==='['||ch===']')) depth+= ch==='['?1:-1;
  }
  return {parts, cutOff: depth>0 || inStr};
}
function readKit(text){
  const t=String(text||'').trim();
  if(!t) return {error:"Paste the AI's whole answer into the box first."};
  if(t.indexOf('{')<0) return {error:"There's no JSON in what you pasted. Ask the AI to send the review kit as JSON, then paste its whole answer."};
  const {parts, cutOff}=extractObjects(t);
  if(cutOff) return {error:"The AI's answer got cut off before the end. Reply \"continue\" to the AI, then paste everything it sent, one part after the other."};
  const objs=[]; let lastErr='';
  parts.forEach(p=>{ try{ objs.push(JSON.parse(p)); }catch(e){ try{ objs.push(JSON.parse(repairBackslashes(p))); }catch(e2){ lastErr=String(e.message||''); } } });
  const kitParts=objs.filter(o=>o&&typeof o==='object'&&!Array.isArray(o)&&(o.test_questions||o.practice||o.background||o.title));
  if(!kitParts.length){
    if(lastErr) return {error:"This isn't valid JSON ("+lastErr+"). Ask the AI to send the kit again as JSON only."};
    return {error:"This JSON doesn't look like a review kit: it has no practice or test_questions list."};
  }
  const kit={};
  kitParts.forEach(o=>Object.keys(o).forEach(k=>{
    if(Array.isArray(o[k]) && Array.isArray(kit[k])) kit[k]=kit[k].concat(o[k]);
    else if(kit[k]===undefined || kit[k]==='' ) kit[k]=o[k];
  }));
  if(!Array.isArray(kit.practice) && !Array.isArray(kit.test_questions))
    return {error:"This JSON doesn't look like a review kit: it has no practice or test_questions list."};
  if(Array.isArray(kit.test_questions) && !Array.isArray(kit.practice))
    return {error:"This is only part 1 of the kit. Reply \"continue\" to the AI, then paste part 2 below part 1 in this box."};
  return {kit:fixKit(kit)};
}

/* LaTeX inside JSON is fragile: "\frac" parses as a form feed + "rac", "\dfrac" doesn't parse at all.
   repairBackslashes doubles lone backslashes before parsing; fixLatex undoes control characters after. */
function repairBackslashes(s){ return s.replace(/\\(?!["\\/bfnrtu])/g,'\\\\'); }
function fixLatex(s){
  if(typeof s!=='string') return s;
  return s.replace(/\f/g,'\\f').replace(/\t/g,'\\t').replace(/\x08/g,'\\b').replace(/\r/g,'\\r').replace(/\n(?=[a-zA-Z])/g,'\\n');
}
function fixSteps(steps){ return Array.isArray(steps)?steps.filter(Boolean).map(s=>({label:String(s.label||''),math:fixLatex(String(s.math||'')),caption:String(s.caption||'')})):[]; }
function fixKit(k){
  (k.test_questions||[]).forEach(q=>{ ['problem','answer','student_answer'].forEach(f=>q[f]=fixLatex(q[f])); q.steps=fixSteps(q.steps); });
  (k.practice||[]).forEach(p=>{ p.problem=fixLatex(p.problem); p.answer=fixLatex(p.answer); p.worked_solution=(p.worked_solution||[]).map(fixLatex); p.steps=fixSteps(p.steps); });
  (k.background||[]).forEach(b=>{ b.steps=fixSteps(b.steps); });
  return k;
}

/* ================= saving ================= */
function standaloneHTML(kit){
  const pick=(sel)=>[...document.querySelectorAll(sel)].map(e=>e.outerHTML).join('\n');
  const json=JSON.stringify(kit).replace(/<\/(script)/gi,'<\\/$1');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>'+esc(kit.title||'Math review')+'</title>\n'
    + pick('[data-kit="style"]') + '\n</head><body>\n'
    + pick('script[data-kit="lib"]') + '\n'
    + '<script data-kit="data" type="application/json" id="kit-data">'+json+'<\/script>\n'
    + ORIGIN.app + '\n' + ORIGIN.print + '\n'
    + pick('script[data-kit="main"]') + '\n</body></html>';
}
function slug(s){ return String(s||'math-review').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'math-review'; }
async function saveFile(filename, data, statusEl){
  const dl = IN_CLAUDE ? await window.claude.use('downloads').catch(()=>null) : null;
  if(!dl){ if(statusEl) statusEl.textContent='Saving files isn\'t available here. Use "Copy kit JSON" instead.'; return; }
  try{ await dl.save({filename, data}); if(statusEl) statusEl.textContent='Saved '+filename+'.'; }
  catch(e){ if(statusEl) statusEl.textContent = e && e.code==='declined' ? 'Save cancelled.' : 'That file couldn\'t be saved here ('+(e&&e.code||'error')+').'; }
}
async function copyText(text, statusEl, ta){
  try{ await navigator.clipboard.writeText(text); statusEl.textContent='Copied.'; }
  catch(e){ if(ta){ ta.hidden=false; ta.value=text; ta.select(); } statusEl.textContent='Copy was blocked here. The JSON is selected below; copy it by hand.'; }
}
function addKitToolbar(kit){
  const bar=document.createElement('div'); bar.className='toolbar';
  bar.innerHTML=`<button class="ctl play" id="save-html">Save printable page</button><button class="ctl" id="save-json">Save kit (JSON)</button><button class="ctl" id="copy-json">Copy kit JSON</button><button class="ctl ghost" id="start-over">Start a new kit</button>
  <p class="status-line muted" id="save-status" aria-live="polite" style="flex-basis:100%"></p><textarea id="copy-fallback" hidden style="width:100%;min-height:120px"></textarea>`;
  document.querySelector('#app header').appendChild(bar);
  const st=$id('save-status');
  $id('save-html').onclick=()=>saveFile(slug(kit.title)+'.html', standaloneHTML(kit), st);
  $id('save-json').onclick=()=>saveFile(slug(kit.title)+'.json', JSON.stringify(kit,null,1), st);
  $id('copy-json').onclick=()=>copyText(JSON.stringify(kit,null,1), st, $id('copy-fallback'));
  $id('start-over').onclick=()=>{ try{localStorage.removeItem(STORE_KEY);}catch(e){} location.reload(); };
}

/* ================= boot ================= */
if(BAKED){
  render(fixKit(BAKED), IN_CLAUDE?'baked':'standalone');
  if(!IN_CLAUDE) addPrintBar();
} else {
  builder();
}

/* ================= the builder ================= */
function builder(){
  if(!IN_CLAUDE){ landing(); return; }
  const app=$id('app'); app.hidden=true;
  const root=document.createElement('div'); root.className='wrap'; root.id='builder';
  root.innerHTML=`
  <header><div class="eyebrow">Math review kit</div><h1>Test Review Builder</h1>
    <p class="summary">Upload photos of a graded math test or quiz. Claude reads it, checks every answer, and builds step-by-step walkthroughs, practice problems, and a printable sheet. It runs on your own Claude account; the photos are not sent anywhere else.</p></header>

  <div class="bpanel" id="b-resume" hidden><p>You have a kit from earlier in this browser.</p><div class="row"><button class="ctl play" id="resume-open">Open it</button><button class="ctl" id="resume-clear">Discard it</button></div></div>

  <div class="bpanel" id="b-upload">
    <h2>1. Photos of the test</h2>
    <p class="muted">Every page, flat and in good light. Crop out the student's name if you like; it isn't needed.</p>
    <label class="drop" id="drop" for="photo-input"><strong>Add photos</strong><span class="muted">Tap to choose, or drop images here</span><input id="photo-input" type="file" accept="image/*" multiple></label>
    <div class="thumbs" id="thumbs"></div>
    <div class="field"><label for="hint">Course or chapter (optional)</label><input id="hint" placeholder="e.g. Algebra 1, Chapter 8: Exponents"></div>
    <div class="row"><button class="ctl play" id="read-btn" disabled>Read the test</button><button class="ctl" id="read-stop" hidden>Stop</button></div>
    <p class="status-line" id="read-status" aria-live="polite"></p>
  </div>

  <div class="bpanel" id="b-confirm" hidden>
    <h2>2. Check what Claude read</h2>
    <p class="muted">Fix anything misread before the walkthroughs are written. Questions with an orange edge are ones Claude wasn't sure about and are open for editing. Tap Edit on any other question to fix it.</p>
    <div class="grid3">
      <div class="field"><label for="k-title">Title</label><input id="k-title"></div>
      <div class="field"><label for="k-course">Course</label><input id="k-course"></div>
      <div class="field"><label for="k-score">Score</label><input id="k-score"></div>
    </div>
    <div class="qlist" id="qlist"></div>
    <div class="row"><button class="ctl play" id="build-btn">Looks right, build the review</button></div>
  </div>

  <div class="bpanel" id="b-build" hidden>
    <h2>3. Building the review</h2>
    <p class="muted">This takes a few minutes. Each part is checked by plugging numbers into the answers before it's used.</p>
    <ul class="jobs" id="jobs"></ul>
    <div class="row"><button class="ctl" id="build-stop">Stop</button><button class="ctl play" id="build-retry" hidden>Retry the failed parts</button><button class="ctl" id="build-show" hidden>Show what's ready</button></div>
    <p class="status-line" id="build-status" aria-live="polite"></p>
  </div>

  <details class="paste" id="b-paste"><summary>Already have a kit JSON? Paste it</summary>
    <textarea id="kit-input" spellcheck="false" style="width:100%;min-height:200px;font:13px/1.45 var(--f-mono);background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:12px" placeholder='{ "title": "...", "test_questions": [...], "practice": [...] }'></textarea>
    <p class="loader-error" id="kit-error" role="alert" hidden></p>
    <button class="ctl play" id="kit-build" style="justify-self:start">Build from JSON</button>
  </details>`;
  app.parentNode.insertBefore(root, app);

  /* ---------- state ---------- */
  const photos=[];        // {file, url}
  let readResult=null;    // {title, course, score, questions:[...]}
  let sample=null, limits=null;

  function showKit(kit){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(kit)); }catch(e){}
    root.remove(); app.hidden=false; render(kit,'built'); addKitToolbar(kit); window.scrollTo(0,0);
  }

  /* ---------- resume + paste ---------- */
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(STORE_KEY)||'null'); }catch(e){ saved=null; }
  if(saved && (saved.practice||saved.test_questions)){
    $id('b-resume').hidden=false;
    $id('b-resume').querySelector('p').textContent=`You have a kit from earlier in this browser: ${saved.title||'untitled'}.`;
    $id('resume-open').onclick=()=>showKit(fixKit(saved));
    $id('resume-clear').onclick=()=>{ try{localStorage.removeItem(STORE_KEY);}catch(e){} $id('b-resume').hidden=true; };
  }
  $id('kit-build').onclick=()=>{
    const r=readKit($id('kit-input').value), err=$id('kit-error');
    if(r.error){ err.textContent=r.error; err.hidden=false; return; }
    err.hidden=true; showKit(r.kit);
  };

  /* ---------- photos ---------- */
  const input=$id('photo-input'), drop=$id('drop');
  function addFiles(list){
    [...list].filter(f=>/^image\//.test(f.type)||/\.(jpe?g|png|webp|gif|heic)$/i.test(f.name)).forEach(f=>photos.push({file:f,url:URL.createObjectURL(f)}));
    drawThumbs();
  }
  function drawThumbs(){
    const box=$id('thumbs'); box.innerHTML='';
    photos.forEach((p,k)=>{
      const d=document.createElement('div'); d.className='thumb';
      d.innerHTML=`<img alt="Page ${k+1}" src="${p.url}"><button aria-label="Remove page ${k+1}">×</button>`;
      d.querySelector('button').onclick=()=>{URL.revokeObjectURL(p.url);photos.splice(k,1);drawThumbs();};
      box.appendChild(d);
    });
    updateReadButton();
  }
  input.onchange=()=>{ addFiles(input.files); input.value=''; };
  ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
  drop.addEventListener('drop',e=>{ if(e.dataTransfer&&e.dataTransfer.files) addFiles(e.dataTransfer.files); });

  const rs=$id('read-status');
  function updateReadButton(){
    const max=limits&&limits.images?limits.images.maxCount:20;
    $id('read-btn').disabled=!sample||!limits||!limits.images||!photos.length||photos.length>max;
    if(sample&&limits&&limits.images&&photos.length>max){ rs.className='status-line err'; rs.textContent=`That's ${photos.length} photos; Claude can look at ${max} at a time. Remove some pages or combine them.`; }
    else if(rs.classList.contains('err')&&!busy){ rs.className='status-line'; rs.textContent=''; }
  }

  /* ---------- connect to Claude (the viewer's own account) ---------- */
  let busy=false;
  (async()=>{
    if(!IN_CLAUDE){ noClaude('Photo reading works when this page is opened in Claude. You can still paste a kit JSON below.'); return; }
    rs.innerHTML='<span class="spin"></span> Connecting to Claude…';
    sample=await window.claude.use('sample').catch(()=>null);
    if(!sample){ noClaude('Photo reading needs Claude, which isn\'t available in this view. Sign in to Claude and open the page there, or paste a kit JSON below.'); return; }
    limits=await sample.limits().catch(()=>null);
    if(!limits||!limits.images){ noClaude('This view can\'t send photos to Claude. Try the Claude website or app, or paste a kit JSON below.'); return; }
    if(limits.images.mediaTypes&&limits.images.mediaTypes.length) input.accept=limits.images.mediaTypes.join(',');
    rs.textContent=''; updateReadButton();
  })();
  function noClaude(msg){ rs.className='status-line err'; rs.textContent=msg; $id('read-btn').disabled=true; $id('b-paste').open=true; }

  function errCopy(e){
    const c=e&&e.code;
    return ({
      not_granted:'Claude wasn\'t allowed for this page. Reload the page and choose Allow to use photo reading.',
      sampling_disabled:'Claude isn\'t available for this account.',
      rate_limited:'Claude is busy or your usage limit was reached. Wait a bit, then try again.',
      session_expired:'Your Claude sign-in expired. Sign in again, then try again.',
      image_rejected:'One of the photos couldn\'t be used. Try a JPEG or PNG under 20 MB.',
      images_unavailable:'This view can\'t send photos to Claude.',
      invalid_json:'Claude\'s answer didn\'t come back in the expected format. Try again.',
      refused:'Claude declined to read these images. Check that they are photos of a math test.',
      prompt_too_large:'That was too much to send at once. Try fewer photos.',
      cancelled:'Stopped.',
    })[c] || 'Something went wrong talking to Claude. Try again.';
  }
  function isHidingError(e){ return ['not_granted','sampling_disabled','not_declared','capability_disabled','capability_removed','images_unavailable','session_expired'].includes(e&&e.code); }

  /* sample.json with a repair pass for LaTeX backslashes */
  async function askJSON(prompt, opts){
    const useTools = !!(limits&&limits.tools&&opts.tools);
    const o={modelTier:opts.modelTier||'default', signal:opts.signal};
    if(opts.images) o.images=opts.images;
    if(useTools) o.tools=opts.tools; else o.cache=false;
    const p = useTools ? prompt : prompt.replace(/\n\[TOOLS\][\s\S]*?\[\/TOOLS\]\n/,'\nThere are no check tools in this view: recompute every answer twice by hand before you reply.\n');
    try{ return await sample.json(useTools?p.replace(/\[\/?TOOLS\]/g,''):p, o); }
    catch(e){
      if(e&&e.code==='invalid_json'&&e.text){
        const first=e.text.indexOf('{'), last=e.text.lastIndexOf('}');
        if(first>=0&&last>first){ try{ return JSON.parse(repairBackslashes(e.text.slice(first,last+1))); }catch(_){ } }
      }
      throw e;
    }
  }

  /* ---------- tools Claude can call while it works (they run here, in the page) ---------- */
  const TOOLS=[
    {name:'check_equal',
     description:'Checks whether two math.js expressions are equal by evaluating both at several sets of positive values for every single-letter variable. Use it to confirm a simplified answer equals the original problem. Returns {equal, samples}. Write math.js syntax: * for every multiplication, ^ for powers, / for division, parentheses around negative exponents like x^(-3).',
     inputSchema:{type:'object',properties:{given_expr:{type:'string',description:'The original problem as a math.js expression'},expected:{type:'string',description:'Your answer as a math.js expression'}},required:['given_expr','expected']},
     execute(inp){
       const r=runCheck({type:'expr',given_expr:String(inp.given_expr||''),expected:String(inp.expected||'')});
       return {equal:r.ok===true,samples:(r.pairs||[]).map(([a,b])=>[+a.toPrecision(10),+b.toPrecision(10)])};
     }},
    {name:'check_solution',
     description:'Checks a solved equation: substitutes value for var and compares both sides at several sets of positive values for the other single-letter variables. Returns {holds, samples}. math.js syntax.',
     inputSchema:{type:'object',properties:{lhs:{type:'string'},rhs:{type:'string'},var:{type:'string'},value:{type:'string',description:'The solution, e.g. "-5" or "9/5"'}},required:['lhs','rhs','var','value']},
     execute(inp){
       const r=runCheck({type:'solve',lhs:String(inp.lhs||''),rhs:String(inp.rhs||''),var:String(inp.var||'k'),expected:String(inp.value||'')});
       return {holds:r.ok===true,samples:(r.pairs||[]).map(([a,b])=>[+a.toPrecision(10),+b.toPrecision(10)])};
     }},
  ];

  /* ---------- step 1: read ---------- */
  let readCtl=null;
  $id('read-btn').onclick=async()=>{
    busy=true; readCtl=new AbortController();
    $id('read-btn').disabled=true; $id('read-stop').hidden=false;
    rs.className='status-line'; rs.innerHTML='<span class="spin"></span> Claude is reading the test and checking every answer. This usually takes one to three minutes.';
    try{
      const res=await askJSON(PROMPTS.read($id('hint').value.trim(), photos.length), {images:photos.map(p=>p.file), modelTier:'complex', tools:TOOLS, signal:readCtl.signal});
      if(!res||!Array.isArray(res.questions)||!res.questions.length) throw {code:'invalid_json'};
      readResult=normalizeRead(res);
      rs.textContent=''; showConfirm();
    }catch(e){
      rs.className='status-line err'; rs.textContent=errCopy(e);
      if(isHidingError(e)) { $id('read-btn').disabled=true; return; }
    }finally{ busy=false; $id('read-stop').hidden=true; updateReadButton(); }
  };
  $id('read-stop').onclick=()=>readCtl&&readCtl.abort();

  function normalizeRead(r){
    const qs=r.questions.map((q,k)=>({
      n:q.n!=null?q.n:k+1, section:String(q.section||''), prompt:String(q.prompt||''),
      problem:fixLatex(String(q.problem||'')), answer:fixLatex(String(q.answer||'')), student_answer:fixLatex(String(q.student_answer||'')),
      status:STATUS[q.status]?q.status:'unknown', points:String(q.points||''), what_broke:String(q.what_broke||''),
      unsure:q.read_confidence==='unsure', unsure_note:String(q.unsure_note||''), check:q.check||null }));
    return {title:String(r.title||'Test review'), course:String(r.course||''), score:String(r.score||''), questions:qs};
  }

  /* ---------- step 2: confirm ---------- */
  function showConfirm(){
    $id('b-confirm').hidden=false;
    $id('k-title').value=readResult.title; $id('k-course').value=readResult.course; $id('k-score').value=readResult.score;
    ['title','course','score'].forEach(f=>$id('k-'+f).oninput=e=>readResult[f]=e.target.value);
    drawQuestions();
    $id('b-confirm').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function drawQuestions(){
    const list=$id('qlist'); list.innerHTML='';
    readResult.questions.forEach((q,k)=>{
      const c=document.createElement('div'); c.className='qcard'+(q.unsure?' unsure editing':'');
      const opts=Object.keys(STATUS).map(s=>`<option value="${s}"${s===q.status?' selected':''}>${STATUS[s]}</option>`).join('');
      c.innerHTML=`<div class="qhead"><strong>#${esc(q.n)}</strong>
        <label class="sr" style="position:absolute;left:-9999px" for="st-${k}">Status</label><select id="st-${k}">${opts}</select>
        <label class="sr" style="position:absolute;left:-9999px" for="pt-${k}">Points</label><input id="pt-${k}" value="${esc(q.points)}" placeholder="points">
        <button class="ctl ghost edit-toggle" id="ed-${k}" aria-pressed="${q.unsure?'true':'false'}">Edit</button><button class="ctl ghost rm" id="rm-${k}">Remove</button></div>
        ${q.unsure?`<p class="unsure-note">Not sure: ${esc(q.unsure_note||'part of this was hard to read.')}</p>`:''}
        ${fieldHTML(k,'problem','Problem',q.problem,true)}
        ${fieldHTML(k,'answer','Correct answer',q.answer,true)}
        ${fieldHTML(k,'student_answer','Answer on the test',q.student_answer,true)}
        <div class="field"><label for="wb-${k}">What happened</label><textarea id="wb-${k}">${esc(q.what_broke)}</textarea><p class="wb-view">${esc(q.what_broke||'Nothing to note.')}</p></div>`;
      list.appendChild(c);
      c.querySelector('#ed-'+k).onclick=e=>{ const on=c.classList.toggle('editing'); e.target.setAttribute('aria-pressed',String(on)); e.target.textContent=on?'Done':'Edit'; if(on) c.querySelector('input.latex').focus(); };
      if(q.unsure) c.querySelector('#ed-'+k).textContent='Done';
      c.querySelector('#st-'+k).onchange=e=>q.status=e.target.value;
      c.querySelector('#pt-'+k).oninput=e=>q.points=e.target.value;
      c.querySelector('#wb-'+k).oninput=e=>{ q.what_broke=e.target.value; c.querySelector('.wb-view').textContent=e.target.value||'Nothing to note.'; };
      c.querySelector('#rm-'+k).onclick=()=>{ readResult.questions.splice(k,1); drawQuestions(); };
      ['problem','answer','student_answer'].forEach(f=>{
        const inp=c.querySelector(`#${f}-${k}`), pv=c.querySelector(`#pv-${f}-${k}`);
        inp.oninput=()=>{ q[f]=inp.value; pv.innerHTML=tex(inp.value,false); if(f!=='student_answer') q.edited=true; };
      });
    });
  }
  function fieldHTML(k,f,label,val){
    return `<div class="field"><label for="${f}-${k}">${label}</label><input class="latex" id="${f}-${k}" value="${esc(val)}" spellcheck="false"><div class="preview" id="pv-${f}-${k}">${tex(val,false)}</div></div>`;
  }

  /* ---------- step 3: build ---------- */
  let jobs=[], buildCtl=null, plan=null;
  $id('build-btn').onclick=()=>startBuild();
  $id('build-stop').onclick=()=>buildCtl&&buildCtl.abort();
  $id('build-retry').onclick=()=>runJobs(jobs.filter(j=>j.st==='failed'));
  $id('build-show').onclick=()=>finish(true);

  function startBuild(){
    if(!readResult.questions.length){ return; }
    readResult.questions.forEach(q=>{ if(q.edited) q.check=null; });
    $id('b-build').hidden=false; $id('build-btn').disabled=true;
    plan=null;
    const tq=readResult.questions;
    jobs=[{id:'plan',label:'Summary, refreshers and practice problems',st:'waiting',run:runPlan}];
    for(let s=0;s<tq.length;s+=4){ const part=tq.slice(s,s+4); jobs.push({id:'t'+s,label:`Walkthroughs for test questions ${part.map(q=>'#'+q.n).join(', ')}`,st:'waiting',run:()=>runWalk(part.map(q=>({id:'t'+q.n,kind:'test',q})))}); }
    jobs.push({id:'practice',label:'Walkthroughs for the practice problems',st:'waiting',needsPlan:true,run:runPracticeWalks});
    drawJobs();
    $id('b-build').scrollIntoView({behavior:'smooth',block:'start'});
    runJobs(jobs);
  }
  function drawJobs(){
    const ul=$id('jobs'); ul.innerHTML='';
    const words={waiting:'Waiting',working:'Working',done:'Done',failed:'Didn\'t finish'};
    jobs.forEach(j=>{ const li=document.createElement('li'); li.dataset.st=j.st;
      li.innerHTML=`<span class="st">${j.st==='working'?'<span class="spin"></span> ':''}${words[j.st]}</span><span>${esc(j.label)}${j.note?` <span class="muted">(${esc(j.note)})</span>`:''}</span>`; ul.appendChild(li); });
  }
  async function runJobs(list){
    buildCtl=new AbortController();
    const bs=$id('build-status'); bs.className='status-line'; bs.textContent='';
    $id('build-retry').hidden=true; $id('build-show').hidden=true; $id('build-stop').hidden=false;
    list.forEach(j=>{ j.st='waiting'; j.note=''; }); drawJobs();
    const queue=[...list].sort((a,b)=>(a.id==='plan'?-1:0)-(b.id==='plan'?-1:0));
    let fatal=null;
    async function worker(){
      while(queue.length && !buildCtl.signal.aborted && !fatal){
        let idx=queue.findIndex(j=>!j.needsPlan || plan);
        if(idx<0){ if(jobs.find(j=>j.id==='plan').st==='failed'){ queue.splice(0).forEach(j=>{j.st='failed';j.note='needs the practice problems first';}); drawJobs(); return; } await new Promise(r=>setTimeout(r,400)); continue; }
        const j=queue.splice(idx,1)[0];
        j.st='working'; drawJobs();
        try{ await j.run(buildCtl.signal); j.st='done'; }
        catch(e){ j.st='failed'; j.note=e&&e.code==='cancelled'?'stopped':errCopy(e); if(isHidingError(e)||(e&&e.code==='rate_limited')) fatal=e; }
        drawJobs();
      }
    }
    await Promise.all([worker(),worker()]);
    queue.forEach(j=>{ j.st='failed'; j.note=j.note||'not started'; }); drawJobs();
    $id('build-stop').hidden=true;
    const failed=jobs.filter(j=>j.st==='failed');
    if(!failed.length){ finish(false); return; }
    bs.className='status-line err';
    bs.textContent= fatal ? errCopy(fatal) : `${failed.length} part${failed.length>1?'s':''} didn't finish. Retry them, or show what's ready.`;
    $id('build-retry').hidden=!!(fatal&&isHidingError(fatal)); $id('build-show').hidden=false;
  }

  async function runPlan(signal){
    const qs=readResult.questions.map(q=>({n:q.n,section:q.section,prompt:q.prompt,problem:q.problem,answer:q.answer,student_answer:q.student_answer,status:q.status,what_broke:q.what_broke}));
    const res=await askJSON(PROMPTS.plan(readResult, qs), {modelTier:'complex', tools:TOOLS, signal});
    if(!res||!Array.isArray(res.practice)||!res.practice.length) throw {code:'invalid_json'};
    res.practice=res.practice.map((p,k)=>({n:k+1,section:String(p.section||''),prompt:String(p.prompt||'Simplify.'),problem:fixLatex(String(p.problem||'')),answer:fixLatex(String(p.answer||'')),worked_solution:(p.worked_solution||[]).map(l=>fixLatex(String(l))),check:p.check||null,steps:[]}));
    res.background=(res.background||[]).slice(0,3).map(b=>({topic:String(b.topic||''),explanation:String(b.explanation||''),steps:fixSteps(b.steps)}));
    plan=res;
  }
  async function runPracticeWalks(signal){
    const P=plan.practice; const parts=[];
    for(let s=0;s<P.length;s+=5) parts.push(P.slice(s,s+5).map(p=>({id:'p'+p.n,kind:'practice',q:p})));
    const results=await Promise.allSettled(parts.map(part=>runWalk(part,signal)));
    const bad=results.find(r=>r.status==='rejected'); if(bad) throw bad.reason;
  }
  const WALKS={};   // id -> {steps, check}
  async function runWalk(items, signal){
    const payload=items.map(({id,kind,q})=>({id, kind, problem:q.problem, prompt:q.prompt, correct_answer:q.answer, status:kind==='test'?q.status:undefined, what_broke:kind==='test'?q.what_broke:undefined}));
    const res=await askJSON(PROMPTS.walk(payload), {modelTier:'default', tools:TOOLS, signal});
    const arr=Array.isArray(res)?res:(res&&res.items);
    if(!Array.isArray(arr)) throw {code:'invalid_json'};
    arr.forEach(r=>{ if(r&&r.id) WALKS[r.id]={steps:fixSteps(r.steps),check:r.check||null}; });
    const missing=items.filter(it=>!WALKS[it.id]||!WALKS[it.id].steps.length);
    if(missing.length===items.length) throw {code:'invalid_json'};
  }

  function finish(partial){
    const kit={
      schema:'math-review-kit/0.1',
      title:readResult.title, course:readResult.course, score:readResult.score,
      student_summary:plan?String(plan.student_summary||''):'',
      test_questions:readResult.questions.map(q=>{ const w=WALKS['t'+q.n]||{}; return {n:q.n,status:q.status,points:q.points,section:q.section,prompt:q.prompt,problem:q.problem,answer:q.answer,student_answer:q.student_answer,what_broke:q.what_broke,check:w.check||(!q.edited&&q.check)||null,steps:w.steps||[]}; }),
      background:plan?plan.background:[],
      practice:plan?plan.practice.map(p=>{ const w=WALKS['p'+p.n]||{}; return Object.assign({},p,{steps:w.steps||[],check:p.check||w.check||null}); }):[],
    };
    if(partial) kit.note='Some walkthroughs did not finish.';
    showKit(kit);
  }
}


/* ================= public landing: any AI, copy and paste ================= */
function landing(){
  const app=$id('app'); app.hidden=true;
  const root=document.createElement('div'); root.className='wrap'; root.id='landing';
  root.innerHTML=`
  <header><div class="eyebrow">Free for parents</div><h1>Math Test Review Builder</h1>
    <p class="summary">Turn photos of your child's graded math test into a step-by-step walkthrough of every question, new practice problems with the same traps, and a printable practice sheet with an answer key. It works with the AI you already use, and nothing is uploaded to this site.</p>
    <div class="row"><a class="ctl" href="example.html" style="display:inline-flex;align-items:center;text-decoration:none">See an example kit</a>${CLAUDE_BUILDER_URL?`<a class="ctl" href="${esc(CLAUDE_BUILDER_URL)}" style="display:inline-flex;align-items:center;text-decoration:none" target="_blank" rel="noopener">Use Claude? Skip the copy and paste</a>`:''}</div></header>

  <div class="bpanel"><h2>1. Copy the prompt</h2>
    <p>This tells the AI exactly what to build and in what format.</p>
    <div class="row"><button class="ctl play" id="copy-prompt">Copy the prompt</button><span class="status-line muted" id="copy-status" aria-live="polite"></span></div>
    <details class="paste"><summary>Read the prompt</summary><pre id="prompt-text" style="white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 var(--f-mono);margin:0;max-height:360px;overflow:auto"></pre></details>
  </div>

  <div class="bpanel"><h2>2. Ask your AI</h2>
    <p>Start a new chat in Claude, ChatGPT, or Gemini. Attach a photo of every page of the graded test, paste the prompt, and send it. Use the strongest model your plan offers; the answer takes a few minutes.</p>
    <p class="muted">Cropping out your child's name is fine; it isn't needed. If the answer stops partway or comes in two parts, reply "continue" and keep everything it sends.</p>
  </div>

  <div class="bpanel"><h2>3. Paste the AI's answer here</h2>
    <p>Paste the whole answer, including both parts if there were two. The kit is built right here in your browser.</p>
    <div class="field"><label for="kit-input">The AI's answer</label><textarea id="kit-input" spellcheck="false" style="min-height:200px;font:13px/1.45 var(--f-mono)" placeholder='{ "title": "...", "test_questions": [...], "practice": [...] }'></textarea></div>
    <p class="loader-error" id="kit-error" role="alert" hidden></p>
    <div class="row"><button class="ctl play" id="kit-build">Build the review</button></div>
  </div>

  <footer><p>AI can make mistakes. Every answer with a math check is tested here by plugging in numbers, and anything that fails is marked "double-check this one". When in doubt, trust the teacher.</p>
  <p>Free to use and share for non-commercial purposes. <a href="${REPO_URL}" style="color:var(--accent)">Source and license</a>.</p></footer>`;
  app.parentNode.insertBefore(root, app);
  $id('prompt-text').textContent=PARENT_PROMPT;
  $id('copy-prompt').onclick=async()=>{
    const st=$id('copy-status');
    try{ await navigator.clipboard.writeText(PARENT_PROMPT); st.textContent='Copied. Now paste it into your AI.'; }
    catch(e){ const d=root.querySelector('details'); d.open=true; const r=document.createRange(); r.selectNodeContents($id('prompt-text')); const s=getSelection(); s.removeAllRanges(); s.addRange(r); st.textContent='Copying was blocked. The prompt is selected below; copy it by hand.'; }
  };
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(STORE_KEY)||'null'); }catch(e){}
  if(saved&&(saved.practice||saved.test_questions)){
    const p=document.createElement('div'); p.className='bpanel';
    p.innerHTML=`<p>You have a kit from earlier in this browser: ${esc(saved.title||'untitled')}.</p><div class="row"><button class="ctl play" id="resume-open">Open it</button><button class="ctl" id="resume-clear">Discard it</button></div>`;
    root.querySelector('header').after(p);
    $id('resume-open').onclick=()=>openKit(fixKit(saved));
    $id('resume-clear').onclick=()=>{ try{localStorage.removeItem(STORE_KEY);}catch(e){} p.remove(); };
  }
  $id('kit-build').onclick=()=>{
    const r=readKit($id('kit-input').value), err=$id('kit-error');
    if(r.error){ err.textContent=r.error; err.hidden=false; return; }
    err.hidden=true; openKit(r.kit);
  };
  function openKit(kit){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(kit)); }catch(e){}
    root.remove(); app.hidden=false; render(kit,'site'); addSiteToolbar(kit); window.scrollTo(0,0);
  }
}
function addSiteToolbar(kit){
  const bar=document.createElement('div'); bar.className='toolbar';
  bar.innerHTML=`<button class="ctl play" data-p="sheet">Print practice sheet</button><button class="ctl" data-p="key">Print answer key</button><button class="ctl" id="dl-html">Download this review</button><button class="ctl ghost" id="start-over">Start a new kit</button>`;
  document.querySelector('#app header').appendChild(bar);
  bar.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{document.body.dataset.print=b.dataset.p;window.print();});
  $id('dl-html').onclick=()=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([standaloneHTML(kit)],{type:'text/html'})); a.download=slug(kit.title)+'.html'; document.body.appendChild(a); a.click(); a.remove(); };
  $id('start-over').onclick=()=>{ try{localStorage.removeItem(STORE_KEY);}catch(e){} location.reload(); };
}

/* ================= prompts ================= */
const NOTATION = String.raw`MATH NOTATION (every "problem", "answer", "math" and worked-solution line):
- KaTeX LaTeX, no $ signs. \dfrac{a}{b} for fractions, \left( \right) for tall parentheses, \cdot for times, \checkmark for a check mark.
- Two highlight macros: \hl{...} marks the terms or exponents being combined in this move (shown purple). \warn{...} marks a sign, a negative exponent being applied, or an operation changing (shown yellow).
- This is JSON: every backslash must be doubled inside strings, e.g. "\\dfrac{1}{2}", "\\left(x^{-3}\\right)^{2}".

CHECK OBJECTS (machine-checkable, math.js syntax: * for every multiplication, ^ for powers, x^(-3) for negative exponents, single-letter variables):
- simplify/evaluate: {"type":"expr","given_expr":"(5/2^(-2))^(-2)","expected":"1/400"}
- solve: {"type":"solve","lhs":"x^(-k+2)/x^(3k+7)","rhs":"x^15","var":"k","expected":"-5"}
- create-an-example questions: given_expr = the sample answer, expected = the target.
- null when nothing can be checked this way (explain-why, graphs, word problems without an expression).
[TOOLS]
CHECK TOOLS: you have check_equal and check_solution. Before your final answer, call them for every answer, several calls in one round. If a check fails, fix your answer and check again. Never report an answer that failed its check.
[/TOOLS]`;

const WALK_STYLE = String.raw`WALKTHROUGH STYLE (each walkthrough is a list of frames {"label","math","caption"}):
- The page already shows the bare problem as frame 1. Start with the first move.
- One move per frame. Highlight what is about to change, then show the result in the next frame.
- Labels name the move: "Step 1 · inside first", "Step 2 · power to a power", "Step 3 · keep, change, flip", "Step 4 · match exponents", "Check", "Answer".
- Captions: one or two short sentences in plain words. State the rule and call out the trap at the moment it happens ("Careful: −2 × −6 = +12, not −12").
- Simplify/evaluate problems end with an "Answer" frame. Solve problems end with a "Check" frame that substitutes back.
- "Create" questions: walk through one sample answer and say other answers work. "Explain why" questions: animate the reasoning.
- 3 to 7 frames.
EXAMPLE for (5/2^{-2})^{-2}:
[{"label":"Step 1 · inside first","math":"\\left(\\dfrac{5}{\\warn{2^{-2}}}\\right)^{-2}","caption":"Clean up the negative exponent inside first. 2⁻² = 1/4."},
 {"label":"Step 2 · multiply","math":"\\left(\\hl{5\\cdot 4}\\right)^{-2}","caption":"Dividing by 1/4 is multiplying by 4."},
 {"label":"Step 3 · negative exponent","math":"\\warn{20^{-2}}=\\dfrac{1}{20^{2}}","caption":"Flip it, then do the power."},
 {"label":"Answer","math":"\\dfrac{1}{400}","caption":"Trap: 25 and 16 multiply to 400. They don't add to 41."}]`;

const PROMPTS = {
  read(hint, pages){ return `You are reading ${pages} photo${pages>1?'s':''} of a student's graded math test or quiz, so a parent can build a review kit for a retake. Photos may be rotated, shadowed, or out of order; put the questions in test order.

For EVERY question on the test:
- Transcribe the problem exactly as printed ("problem", LaTeX) and its instruction ("prompt", plain words, e.g. "Simplify. Positive exponents only.").
- Solve it yourself ("answer", LaTeX) and give a "check" object for it.
- Read the student's final answer ("student_answer", LaTeX or a few words) and their work.
- "status": "correct", "partial", "wrong", "blank", or "unknown" (can't tell how it was graded). Use the teacher's marks when visible.
- "points": as graded, like "3/4", if visible; otherwise "".
- "what_broke": for partial or wrong, name the exact move that broke, in one or two plain sentences a parent can follow (e.g. "Added 25 + 16 instead of multiplying, so 1/41 instead of 1/400."). Credit real partial skills. Never invent praise. "" when correct.
- "section": the test's section heading in a few words.
- Never guess at illegible writing. Set "read_confidence":"unsure" and say what you couldn't read in "unsure_note". Otherwise "read_confidence":"clear".

${NOTATION}

${hint?'The parent says this is: '+hint+'\n\n':''}Reply with only this JSON:
{"title":"Unit 4 Quiz Review","course":"Algebra 1","score":"the score as written on the test, or empty","questions":[{"n":1,"section":"...","prompt":"...","problem":"...","answer":"...","check":{...},"student_answer":"...","status":"wrong","points":"1/3","what_broke":"...","read_confidence":"clear","unsure_note":""}]}`; },

  plan(r, qs){ return `A student took a math test. Here is each question, confirmed by a parent, with how the student did:
${JSON.stringify({title:r.title,course:r.course,score:r.score,questions:qs})}

Write the review plan:
1. "student_summary": 3 to 4 plain sentences for the parent: what is solid, where the points went (name question numbers), what the practice focuses on. No praise that isn't earned.
2. "background": 1 to 3 short refreshers on the prerequisite skills the mistakes point to (fraction arithmetic, distributing a negative, rewriting with the same base, and so on). Each: "topic", "explanation" (2 to 3 plain sentences), "steps" (3 to 5 frames, same frame format as below; the first frame is shown as the opener).
3. "practice": 10 new problems. Mirror the test's sections, weight toward the missed and partial types, include one or two confidence builders. Fresh numbers, clean answers, sometimes one notch harder (a non-unit fraction after a flip, a right side that must be rewritten as a power, a negative or fractional answer). Each: "section", "prompt", "problem", "answer", "worked_solution" (an array of 2 to 5 LaTeX lines showing the full work), "check".

${NOTATION}

${WALK_STYLE}

Reply with only this JSON:
{"student_summary":"...","background":[{"topic":"...","explanation":"...","steps":[...]}],"practice":[{"section":"...","prompt":"Simplify.","problem":"...","answer":"...","worked_solution":["...","..."],"check":{...}}]}`; },

  walk(items){ return `Write a step-by-step walkthrough for each of these math problems. "correct_answer" has been verified; your walkthrough must arrive at it. For test questions the student got wrong, put the warning caption at the exact move described in "what_broke".
${JSON.stringify(items)}

${WALK_STYLE}

${NOTATION}

Also return a "check" object for each problem's answer.
Reply with only this JSON, one entry per id:
{"items":[{"id":"t3","steps":[{"label":"...","math":"...","caption":"..."}],"check":{...}}]}`; },
};
})();
