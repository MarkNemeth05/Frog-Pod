// SW
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg=>{
      const ping=()=>reg.update();
      document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') ping(); });
      ping();
    });
  });
}

// ----- State -----
const SKEY='frogpond_state_v1';
const state={
  timerTitle:'Study',
  timerTargetSec:25*60,
  timerStartEpoch:null,
  pretendSpawnCount:0,
  podOpen:false,
  podCount:0,
  autoMerge:false,
  musicOn:true,
  history:[],
  todos:[],
  frogs:[],
  unlockedMax:1
};

const SPAWN_MS = 30*60*1000; // spawn every 30 min
let W=540, H=700;

// ----- UI helpers -----
function save(){ localStorage.setItem(SKEY, JSON.stringify(state)); }
function load(){ try{ const raw=localStorage.getItem(SKEY); if(raw) Object.assign(state, JSON.parse(raw)); }catch(e){} }
function mmss(s){ s=Math.max(0,s|0); const m=(s/60|0), n=s%60; return `${String(m).padStart(2,'0')}:${String(n).padStart(2,'0')}`; }
function show(id){ document.querySelectorAll('.view').forEach(v=>v.classList.toggle('visible', v.id===id)); if(id==='pond') requestPaint(); if(id==='history') renderHistory(); if(id==='todo') renderTodos(); if(id==='biggest') renderBiggest(); }

// Drawer
const drawer=document.getElementById('drawer'), scrim=document.getElementById('scrim'), burger=document.getElementById('hamburger');
function openDrawer(){ drawer.classList.add('open'); scrim.classList.add('show'); }
function closeDrawer(){ drawer.classList.remove('open'); scrim.classList.remove('show'); }
burger.addEventListener('click', openDrawer); scrim.addEventListener('click', closeDrawer);
drawer.querySelectorAll('.drawer-item').forEach(b=>b.addEventListener('click',()=>{ show(b.dataset.view); closeDrawer(); }));

// ----- Timer (dial) -----
const timerTitleEl=document.getElementById('timerTitle');
const timerPreview=document.getElementById('timerPreview');
const startTimerBtn=document.getElementById('startTimerBtn');

const dial=document.getElementById('dial');
const dialArc=document.getElementById('dialArc');
const dialKnob=document.getElementById('dialKnob');
const R=90, PERIM=2*Math.PI*R;
function minutesToAngle(min){ return (min/120)*360; }
function angleToMinutes(a){ return Math.max(1, Math.min(120, Math.round((a%360)/3))); }
function setDialFromMinutes(min){
  const a=minutesToAngle(min), rad=(a-90)*Math.PI/180;
  dialKnob.setAttribute('cx', 120 + R*Math.cos(rad));
  dialKnob.setAttribute('cy', 120 + R*Math.sin(rad));
  dialArc.style.strokeDasharray=PERIM;
  dialArc.style.strokeDashoffset=PERIM - (PERIM*(min/120));
  state.timerTargetSec=min*60; timerPreview.textContent=mmss(state.timerTargetSec); save();
}
function pointAngle(x,y){ const dx=x-120, dy=y-120; let ang=Math.atan2(dy,dx)*180/Math.PI+90; if(ang<0) ang+=360; return ang; }
let dragging=false;
function dialPointer(e){
  const r=dial.getBoundingClientRect();
  const px=(e.touches?e.touches[0].clientX:e.clientX)-r.left;
  const py=(e.touches?e.touches[0].clientY:e.clientY)-r.top;
  const ang=pointAngle(px*(240/r.width), py*(240/r.height));
  setDialFromMinutes(angleToMinutes(ang));
}
dial.addEventListener('pointerdown',e=>{ dragging=true; dial.setPointerCapture(e.pointerId); dialPointer(e); });
dial.addEventListener('pointermove', e=>{ if(dragging) dialPointer(e); });
dial.addEventListener('pointerup',   ()=>{ dragging=false; });
dial.addEventListener('touchstart',  e=>{ dragging=true; dialPointer(e); }, {passive:true});
dial.addEventListener('touchmove',   e=>{ if(dragging) dialPointer(e); }, {passive:true});
dial.addEventListener('touchend',    ()=>{ dragging=false; });

timerTitleEl.addEventListener('input',()=>{ state.timerTitle=timerTitleEl.value||'Study'; save(); });

startTimerBtn.addEventListener('click',()=>{
  state.timerStartEpoch=Date.now(); state.pretendSpawnCount=0; save();
  show('timer-run'); if(state.musicOn) startMusic();
});

// ----- Running -----
const countdownEl=document.getElementById('countdown');
const queuedInfo=document.getElementById('queuedInfo');
const cancelTimerBtn=document.getElementById('cancelTimerBtn');
const podModal=document.getElementById('podModal'), podCountEl=document.getElementById('podCount');
const releaseManualBtn=document.getElementById('releaseManualBtn'), releaseAutoBtn=document.getElementById('releaseAutoBtn');

function computePretendSpawnCount(){ if(!state.timerStartEpoch) return state.pretendSpawnCount; return Math.floor((Date.now()-state.timerStartEpoch)/SPAWN_MS); }
function finishTimer(finalSeconds){
  state.podCount=computePretendSpawnCount(); state.podOpen=true;
  state.history.unshift({title:state.timerTitle||'Study', seconds:finalSeconds, endedAt:Date.now()});
  state.timerStartEpoch=null; state.pretendSpawnCount=0; stopMusic(); save();
  podCountEl.textContent=state.podCount; try{ podModal.showModal(); }catch{}; show('pond');
}
cancelTimerBtn.addEventListener('click',()=>{ if(!state.timerStartEpoch) return; const el=((Date.now()-state.timerStartEpoch)/1000)|0; finishTimer(el); });
function tick(){
  if(!state.timerStartEpoch) return;
  const el=(Date.now()-state.timerStartEpoch)/1000, rem=Math.max(0, state.timerTargetSec-el);
  countdownEl.textContent=mmss(rem);
  const n=computePretendSpawnCount(); if(n!==state.pretendSpawnCount){ state.pretendSpawnCount=n; save(); }
  queuedInfo.textContent=`Frogs: ${state.pretendSpawnCount}`; if(rem<=0) finishTimer(state.timerTargetSec|0);
}
setInterval(()=>{ if(document.getElementById('timer-run').classList.contains('visible')) tick(); },200);

// ----- Music -----
const musicToggleSetup=document.getElementById('musicToggleSetup');
const musicToggleRun=document.getElementById('musicToggleRun');
const TRACKS=Array.from({length:26},(_,i)=>`assets/audio/track${i+1}.mp3`);
const audio=new Audio(); audio.preload='auto'; let currentTrack=-1;
function pickNextTrack(){ if(!TRACKS.length) return null; let i=Math.floor(Math.random()*TRACKS.length); if(TRACKS.length>1 && i===currentTrack) i=(i+1)%TRACKS.length; currentTrack=i; return TRACKS[i]; }
function startMusic(){ if(!state.musicOn||!state.timerStartEpoch||!TRACKS.length) return; const src=pickNextTrack(); if(!src) return; audio.src=src; audio.currentTime=0; audio.play().catch(()=>{}); }
function stopMusic(){ try{ audio.pause(); }catch{} audio.currentTime=0; }
audio.addEventListener('ended',()=>{ if(state.timerStartEpoch && state.musicOn) startMusic(); });
function updateMusicUI(){ const on=!!state.musicOn; [musicToggleSetup,musicToggleRun].forEach(b=>{ if(!b) return; b.classList.toggle('on',on); b.classList.toggle('off',!on); }); }
[musicToggleSetup,musicToggleRun].forEach(b=>b&&b.addEventListener('click',()=>{ state.musicOn=!state.musicOn; save(); updateMusicUI(); if(!state.musicOn) stopMusic(); else if(state.timerStartEpoch) startMusic(); }));

// ----- Pond / frogs -----
const canvas=document.getElementById('pondCanvas'); const ctx=canvas.getContext('2d',{alpha:true});
function resizeCanvas(){
  const ratio=window.devicePixelRatio||1;
  const cssW=Math.min(document.body.clientWidth-24, 720-24);
  const aspect=700/540; const cssH=Math.round(cssW*aspect);
  canvas.style.width=cssW+'px'; canvas.style.height=cssH+'px';
  canvas.width=Math.floor(cssW*ratio); canvas.height=Math.floor(cssH*ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0); W=cssW; H=cssH;
}
resizeCanvas(); window.addEventListener('resize', resizeCanvas);

let selectedId=null, animReq=null;
const TIER_NAMES={1:'Baby Frog',2:'Emo Teen Frog',3:'Smart Frog',4:'Business Frog',5:'Rich Frog',6:'Fit Frog',7:'Old Frog',8:'Angel Frog',9:'Galaxy Frog'};
const MAX_TIER=9;
const TIER_FILES={1:'assets/frogs/BabyFrog.PNG',2:'assets/frogs/TeenFrog.PNG',3:'assets/frogs/SmartFrog.PNG',4:'assets/frogs/BusinessFrog.PNG',5:'assets/frogs/RichFrog.PNG',6:'assets/frogs/FitFrog.PNG',7:'assets/frogs/OldFrog.PNG',8:'assets/frogs/AngelFrog.PNG',9:'assets/frogs/GalaxyFrog.PNG'};
const FROG_IMG={}; function loadImages(m){ return Promise.all(Object.entries(m).map(([k,src])=>new Promise(r=>{ const i=new Image(); i.onload=()=>{FROG_IMG[k]=i;r();}; i.onerror=()=>r(); i.src=src; }))); }
function random(a,b){ return Math.random()*(b-a)+a; }
function addFrog(tier,x,y){
  state.frogs.push({ id:crypto.randomUUID(), tier,x,y, vx:random(-12,12), vy:random(-9,9), phase:Math.random()*Math.PI*2, hopAmp:random(1,2), hopSpeed:random(0.6,1.0), merging:false, tx:x, ty:y });
  state.unlockedMax=Math.max(state.unlockedMax,tier);
}
function spawnBatch(n){ const cx=W/2, cy=H/2+40, R=Math.min(W,H)*0.3; for(let i=0;i<n;i++){ const a=Math.random()*Math.PI*2, r=random(0,R); addFrog(1,(cx+Math.cos(a)*r)|0,(cy+Math.sin(a)*r)|0); } save(); requestPaint(); }

// merge system
const MERGE_SPEED=140, MERGE_RADIUS=6; let mergePairs=[], pendingMerges=[]; const reserved=new Set();
function scheduleMerge(a,b){ if(reserved.has(a.id)||reserved.has(b.id)) return; reserved.add(a.id); reserved.add(b.id); pendingMerges.push({aId:a.id,bId:b.id,due:performance.now()+2000}); }
function beginMerge(a,b){ const mx=(a.x+b.x)/2, my=(a.y+b.y)/2; a.merging=b.merging=true; a.tx=mx; a.ty=my; b.tx=mx; b.ty=my; mergePairs.push({aId:a.id,bId:b.id,mx,my}); }

function updateFrogs(dt){
  // start queued (auto) merges
  if(pendingMerges.length){ const now=performance.now(); for(let i=pendingMerges.length-1;i>=0;i--){ const p=pendingMerges[i]; if(now<p.due) continue; const a=state.frogs.find(f=>f.id===p.aId), b=state.frogs.find(f=>f.id===p.bId); reserved.delete(p.aId); reserved.delete(p.bId); pendingMerges.splice(i,1); if(a&&b&&!a.merging&&!b.merging&&a.tier===b.tier) beginMerge(a,b); } }
  for(const f of state.frogs){
    f.phase+=f.hopSpeed*dt; const yb=Math.sin(f.phase*2*Math.PI)*f.hopAmp; let cx=f.x, cy=f.y;
    if(f.merging){ const dx=f.tx-cx, dy=f.ty-cy, d=Math.hypot(dx,dy); if(d>0.1){ const sp=MERGE_SPEED*dt; const nx=dx/d, ny=dy/d; cx+=Math.min(sp,d)*nx; cy+=Math.min(sp,d)*ny; } }
    else{ cx+=f.vx*dt; cy+=f.vy*dt; const m=40, top=40; if(cx<m||cx>W-m) f.vx*=-1, cx=Math.max(m,Math.min(W-m,cx)); if(cy<top||cy>H-m) f.vy*=-1, cy=Math.max(top,Math.min(H-m,cy)); }
    f.x=cx; f.y=cy+yb;
  }
  for(let i=mergePairs.length-1;i>=0;i--){ const p=mergePairs[i]; const a=state.frogs.find(f=>f.id===p.aId), b=state.frogs.find(f=>f.id===p.bId); if(!a||!b){ mergePairs.splice(i,1); continue; } const da=Math.hypot(a.x-p.mx,a.y-p.my), db=Math.hypot(b.x-p.mx,b.y-p.my); if(da<=MERGE_RADIUS && db<=MERGE_RADIUS){ const tier=Math.min(MAX_TIER,a.tier+1); state.frogs=state.frogs.filter(f=>f.id!==a.id && f.id!==b.id); addFrog(tier,p.mx,p.my); state.unlockedMax=Math.max(state.unlockedMax,tier); mergePairs.splice(i,1); save(); renderBiggest(); if(state.autoMerge) autoMergeSweep(); } }
}
function drawFrogs(){ ctx.clearRect(0,0,W,H); for(const f of state.frogs){ const img=FROG_IMG[f.tier]; const size=Math.max(40, Math.min(W,H)*0.09)+f.tier*2; const r=size/2; if(img) ctx.drawImage(img, f.x-r, f.y-r, size, size); else{ ctx.beginPath(); ctx.arc(f.x,f.y,r,0,Math.PI*2); ctx.fillStyle=`hsl(${(f.tier*35)%360} 60% 60%)`; ctx.fill(); } } }
function requestPaint(){ if(animReq) return; let last=performance.now(); const loop=(t)=>{ const dt=Math.min(0.05,(t-last)/1000); last=t; updateFrogs(dt); drawFrogs(); animReq=requestAnimationFrame(loop); if(!document.getElementById('pond').classList.contains('visible')){ cancelAnimationFrame(animReq); animReq=null; } }; animReq=requestAnimationFrame(loop); }

canvas.addEventListener('click',ev=>{
  const r=canvas.getBoundingClientRect(), pxr=window.devicePixelRatio||1;
  const sx=(canvas.width/pxr)/r.width, sy=(canvas.height/pxr)/r.height;
  const x=(ev.clientX-r.left)*sx, y=(ev.clientY-r.top)*sy;
  let hit=null;
  for(let i=state.frogs.length-1;i>=0;i--){ const f=state.frogs[i]; const size=Math.max(40, Math.min(W,H)*0.09)+f.tier*2; if(Math.hypot(f.x-x,f.y-y)<=size/2){ hit=f; break; } }
  if(!hit){ selectedId=null; return; }
  if(selectedId===null){ selectedId=hit.id; return; }
  if(selectedId===hit.id){ selectedId=null; return; }
  const a=state.frogs.find(f=>f.id===selectedId), b=hit;
  if(a&&b&&a.tier===b.tier&&!a.merging&&!b.merging){
    for(let i=pendingMerges.length-1;i>=0;i--){ const p=pendingMerges[i]; if(p.aId===a.id||p.bId===a.id||p.aId===b.id||p.bId===b.id) pendingMerges.splice(i,1); }
    reserved.delete(a.id); reserved.delete(b.id);
    beginMerge(a,b); // instant on manual
  }
  selectedId=null;
});

document.getElementById('autoMergeToggle').addEventListener('change',e=>{ state.autoMerge=e.target.checked; save(); autoMergeSweep(); });
function autoMergeSweep(){ if(!state.autoMerge) return; const buckets={}; for(const f of state.frogs){ if(!f.merging && !reserved.has(f.id)) (buckets[f.tier]??=[]).push(f); } for(const k in buckets){ const L=buckets[k]; for(let i=0;i+1<L.length;i+=2) scheduleMerge(L[i],L[i+1]); } }

// Pod
function closePod(){ try{ podModal.close(); }catch{} }
releaseManualBtn.addEventListener('click',()=>{ spawnBatch(state.podCount); state.podOpen=false; state.podCount=0; save(); closePod(); });
releaseAutoBtn.addEventListener('click',()=>{ spawnBatch(state.podCount); state.podOpen=false; state.podCount=0; state.autoMerge=true; document.getElementById('autoMergeToggle').checked=true; save(); closePod(); autoMergeSweep(); });

// ----- History (with confirm) -----
const historyList=document.getElementById('historyList');
function confirmDialog(message,title='Confirm'){ return new Promise(res=>{ const dlg=document.getElementById('confirmDialog'); document.getElementById('confirmTitle').textContent=title; document.getElementById('confirmMsg').textContent=message; const yes=document.getElementById('confirmYes'); const no=document.getElementById('confirmNo'); const done=()=>{ yes.onclick=null; no.onclick=null; try{dlg.close();}catch{} }; yes.onclick=()=>{ done(); res(true); }; no.onclick=()=>{ done(); res(false); }; if(typeof dlg.showModal==='function') dlg.showModal(); else dlg.setAttribute('open',''); }); }
function renderHistory(){
  historyList.innerHTML='';
  if(!state.history.length){ historyList.innerHTML=`<div class="item"><div>No sessions.</div></div>`; return; }
  state.history.forEach((h,idx)=>{
    const row=document.createElement('div'); row.className='item';
    const t=document.createElement('div'); t.className='title'; t.textContent=h.title;
    const m=document.createElement('div'); m.className='meta'; m.textContent=mmss(h.seconds);
    const del=document.createElement('button'); del.className='icon-btn'; del.textContent='🗑️';
    del.addEventListener('click', async()=>{ const ok=await confirmDialog(`Delete "${h.title}" (${mmss(h.seconds)})?`,'Delete'); if(!ok) return; state.history.splice(idx,1); save(); renderHistory(); });
    row.appendChild(t); row.appendChild(m); row.appendChild(del); historyList.appendChild(row);
  });
}

// ----- To-Do -----
const todoTitle=document.getElementById('todoTitle'), todoSlider=document.getElementById('todoSlider'), todoMinTxt=document.getElementById('todoMinutesText'), addTodoBtn=document.getElementById('addTodoBtn'), todoList=document.getElementById('todoList');
todoSlider.addEventListener('input',()=>{ todoMinTxt.textContent=todoSlider.value; });
function renderTodos(){
  todoList.innerHTML='';
  if(!state.todos.length){ todoList.innerHTML=`<div class="item"><div>No goals.</div></div>`; return; }
  state.todos.forEach((t,idx)=>{
    const row=document.createElement('div'); row.className='item';
    const start=document.createElement('button'); start.className='btn'; start.textContent='Start';
    start.addEventListener('click',()=>{ state.timerTitle=t.title; state.timerTargetSec=Math.max(60,t.minutes*60); save(); setDialFromMinutes(Math.round(state.timerTargetSec/60)); show('timer-run'); state.timerStartEpoch=Date.now(); state.pretendSpawnCount=0; save(); if(state.musicOn) startMusic(); });
    const title=document.createElement('div'); title.className='title'; title.textContent=t.title;
    const meta=document.createElement('div'); meta.className='meta'; meta.textContent=`${t.minutes}m`;
    const del=document.createElement('button'); del.className='icon-btn'; del.textContent='🗑️';
    del.addEventListener('click', async()=>{ const ok=await confirmDialog(`Delete "${t.title}"?`,'Delete goal'); if(!ok) return; state.todos.splice(idx,1); save(); renderTodos(); });
    row.appendChild(start); row.appendChild(title); row.appendChild(meta); row.appendChild(del); todoList.appendChild(row);
  });
}
addTodoBtn.addEventListener('click',()=>{ const ttl=(todoTitle.value||'Untitled').trim(); const minutes=Math.max(1,Math.min(120,parseInt(todoSlider.value)||25)); state.todos.push({title:ttl, minutes}); save(); todoTitle.value=''; todoSlider.value=25; todoMinTxt.textContent='25'; renderTodos(); });

// ----- Biggest -----
const biggestImg=document.getElementById('biggestImg');
function renderBiggest(){ const info=document.getElementById('biggestInfo'); const tier=state.unlockedMax||1; info.textContent=`Tier ${tier} — ${TIER_NAMES[tier]||'Frog'}`; const img=FROG_IMG[tier]; if(img){ biggestImg.src=img.src; biggestImg.style.display='block'; } else biggestImg.style.display='none'; }

// ----- Boot -----
function restoreUI(){
  load();
  timerTitleEl.value=state.timerTitle; setDialFromMinutes(Math.round(state.timerTargetSec/60));
  document.getElementById('autoMergeToggle').checked=!!state.autoMerge; updateMusicUI();
  renderHistory(); renderTodos(); renderBiggest();
  if(state.frogs.length>0) requestPaint();
  if(state.podOpen && state.podCount>0){ podCountEl.textContent=state.podCount; try{ podModal.showModal(); }catch{} }
}
Promise.all([loadImages(TIER_FILES)]).then(()=>{ restoreUI(); show('timer-setup'); });
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible' && document.getElementById('timer-run').classList.contains('visible')) tick(); });
