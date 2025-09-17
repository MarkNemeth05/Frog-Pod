// ------- SW register -------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
}

// ------- State & persistence -------
const SKEY = 'frogpod_state_v2';
const state = {
  timerTitle: 'Study',
  timerTargetSec: 25 * 60,
  timerStartEpoch: null,
  pretendSpawnCount: 0,
  podOpen: false,
  podCount: 0,
  autoMerge: false,
  history: [],
  todos: [],
  frogs: [],
  unlockedMax: 1
};

const SPAWN_MS = 3000;
let W = 540, H = 700;        // logical canvas size (updated on resize)

// persistence
function save() { localStorage.setItem(SKEY, JSON.stringify(state)); }
function load() { try { const raw = localStorage.getItem(SKEY); if (raw) Object.assign(state, JSON.parse(raw)); } catch(e){} }

function confirmDialog(message, title = 'Confirm'){
  return new Promise(resolve=>{
    const dlg = document.getElementById('confirmDialog');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = message;
    const yes = document.getElementById('confirmYes');
    const no  = document.getElementById('confirmNo');

    const cleanup = ()=>{ yes.onclick=null; no.onclick=null; try{ dlg.close(); }catch{} };

    yes.onclick = ()=>{ cleanup(); resolve(true); };
    no.onclick  = ()=>{ cleanup(); resolve(false); };

    // Safari/iOS PWA fallback
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open','');
  });
}

// ------- Views / routing -------
const views = [...document.querySelectorAll('.view')];
const tabs  = [...document.querySelectorAll('.tab')];
function show(id) {
  views.forEach(v => v.classList.toggle('visible', v.id === id));
  tabs.forEach(t => t.classList.toggle('active', t.dataset.view === id));
  if (id === 'pond') requestPaint();
  if (id === 'history') renderHistory();
  if (id === 'todo') renderTodos();
  if (id === 'biggest') renderBiggest();
}
tabs.forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

// ------- Timer setup -------
const timerTitleEl = document.getElementById('timerTitle');
const timerSlider  = document.getElementById('timerSlider');
const timerMinTxt  = document.getElementById('timerMinutesText');
const timerPreview = document.getElementById('timerPreview');
const startTimerBtn= document.getElementById('startTimerBtn');

function mmss(sec){ sec=Math.max(0,Math.floor(sec)); const m=(sec/60|0), s=sec%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
function updateTimerSetupUI(){
  timerMinTxt.textContent = Math.round(state.timerTargetSec/60);
  timerPreview.textContent = mmss(state.timerTargetSec);
  timerTitleEl.value = state.timerTitle;
  timerSlider.value = Math.round(state.timerTargetSec/60);
}
timerTitleEl.addEventListener('input', () => { state.timerTitle = timerTitleEl.value || 'Study'; save(); });
timerSlider.addEventListener('input', () => { state.timerTargetSec = Math.min(120, Math.max(1, parseInt(timerSlider.value))) * 60; updateTimerSetupUI(); save(); });
startTimerBtn.addEventListener('click', () => { state.timerStartEpoch = Date.now(); state.pretendSpawnCount = 0; save(); show('timer-run'); });

// ------- Timer run -------
const countdownEl = document.getElementById('countdown');
const queuedInfo  = document.getElementById('queuedInfo');
const cancelTimerBtn = document.getElementById('cancelTimerBtn');
const podModal    = document.getElementById('podModal');
const podCountEl  = document.getElementById('podCount');
const releaseManualBtn = document.getElementById('releaseManualBtn');
const releaseAutoBtn   = document.getElementById('releaseAutoBtn');

function computePretendSpawnCount(){
  if (!state.timerStartEpoch) return state.pretendSpawnCount;
  return Math.floor((Date.now() - state.timerStartEpoch) / SPAWN_MS);
}
function finishTimer(finalSeconds){
  state.podCount = computePretendSpawnCount();
  state.podOpen = true;
  state.history.unshift({ title: state.timerTitle || 'Study', seconds: finalSeconds, endedAt: Date.now() });
  state.timerStartEpoch = null;
  state.pretendSpawnCount = 0;
  save();
  podCountEl.textContent = state.podCount;
  podModal.showModal();
  show('pond');
}
cancelTimerBtn.addEventListener('click', () => {
  if (!state.timerStartEpoch) return;
  const elapsed = Math.floor((Date.now() - state.timerStartEpoch)/1000);
  finishTimer(elapsed);
});
function tick(){
  if (!state.timerStartEpoch) return;
  const elapsed = (Date.now() - state.timerStartEpoch)/1000;
  const rem = Math.max(0, state.timerTargetSec - elapsed);
  countdownEl.textContent = mmss(rem);
  const newCount = computePretendSpawnCount();
  if (newCount !== state.pretendSpawnCount){ state.pretendSpawnCount = newCount; save(); }
  queuedInfo.textContent = `Frogs queued so far: ${state.pretendSpawnCount}`;
  if (rem <= 0) finishTimer(Math.round(state.timerTargetSec));
}
setInterval(() => { if (document.getElementById('timer-run').classList.contains('visible')) tick(); }, 200);

// ------- Pond / frogs -------
const canvas = document.getElementById('pondCanvas');
const ctx = canvas.getContext('2d', { alpha: true });

// high-DPI & responsive sizing (portrait)
function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const cssW = Math.min(document.body.clientWidth - 24, 720 - 24); // card padding-ish
  const aspect = 700/540; // portrait
  const cssH = Math.round(cssW * aspect);
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = Math.floor(cssW * ratio);
  canvas.height = Math.floor(cssH * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  W = cssW; H = cssH; // update logical bounds so frogs stay in view
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

let selectedId = null;
let animReq = null;

const TIER_NAMES = {1:'Baby Frog',2:'Emo Teen Frog',3:'Smart Frog',4:'Business Frog',5:'Rich Frog',6:'Fit Frog',7:'Old Frog',8:'God Frog',9:'Galaxy Frog'};
const MAX_TIER = 9;

// images
const TIER_FILES = {
  1: 'assets/frogs/BabyFrog.png',
  2: 'assets/frogs/TeenFrog.png',
  3: 'assets/frogs/SmartFrog.png',
  4: 'assets/frogs/BusinessFrog.png',
  5: 'assets/frogs/RichFrog.png',
  6: 'assets/frogs/FitFrog.png',
  7: 'assets/frogs/OldFrog.png',
  8: 'assets/frogs/GodFrog.png',
  9: 'assets/frogs/GalaxyFrog.png'
};
const FROG_IMG = {};
function loadImages(map){
  const jobs = Object.entries(map).map(([k,src]) => new Promise(resolve => {
    const img = new Image();
    img.onload  = ()=>{ FROG_IMG[k]=img; resolve(); };
    img.onerror = ()=>{ console.warn('img failed:', src); resolve(); };
    img.src = src;
  }));
  return Promise.all(jobs);
}
let BG_IMG = null;
(function loadBG(){
  const img = new Image();
  img.onload = ()=>{ BG_IMG = img; };
  img.src = 'assets/frogs/Background.png';
})();

function random(a,b){ return Math.random()*(b-a)+a; }
function addFrog(tier, x, y){
  state.frogs.push({
    id: crypto.randomUUID(),
    tier, x, y,
    vx: random(-12,12),
    vy: random(-9,9),
    phase: Math.random()*Math.PI*2,
    hopAmp: random(1,2),
    hopSpeed: random(0.6,1.0),
    merging:false, tx:x, ty:y
  });
  state.unlockedMax = Math.max(state.unlockedMax, tier);
}

// spawn
function spawnBatch(n){
  const cx = W/2, cy = H/2 + 40, R = Math.min(W,H) * 0.3;
  for(let i=0;i<n;i++){
    const ang = Math.random()*Math.PI*2, r = random(0,R);
    addFrog(1, Math.round(cx + Math.cos(ang)*r), Math.round(cy + Math.sin(ang)*r));
  }
  save();
  requestPaint();
}

// --- merge pipeline: 2s wait -> move slowly to midpoint -> tier up ---
const MERGE_SPEED = 140;      // slower animation
const MERGE_RADIUS = 6;
let mergePairs = [];          // active movements [{aId,bId,mx,my}]
let pendingMerges = [];       // scheduled waits [{aId,bId,due}]
const reserved = new Set();   // to avoid double scheduling

function scheduleMerge(a,b){
  if (reserved.has(a.id) || reserved.has(b.id)) return;
  reserved.add(a.id); reserved.add(b.id);
  pendingMerges.push({ aId:a.id, bId:b.id, due: performance.now() + 2000 }); // 2s wait
}
function beginMerge(a, b) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  a.merging = true; a.tx = mx; a.ty = my;
  b.merging = true; b.tx = mx; b.ty = my;
  mergePairs.push({ aId: a.id, bId: b.id, mx, my });
}

function updateFrogs(dt){
  // start any pending merges whose 2s wait is over
  if (pendingMerges.length){
    const now = performance.now();
    for (let i = pendingMerges.length-1; i >= 0; i--){
      const p = pendingMerges[i];
      if (now < p.due) continue;
      const a = state.frogs.find(f=>f.id===p.aId);
      const b = state.frogs.find(f=>f.id===p.bId);
      reserved.delete(p.aId); reserved.delete(p.bId);
      pendingMerges.splice(i,1);
      if (a && b && !a.merging && !b.merging && a.tier===b.tier) beginMerge(a,b);
    }
  }

  // movement
  for(const f of state.frogs){
    f.phase += f.hopSpeed*dt;
    const yb = Math.sin(f.phase*2*Math.PI)*f.hopAmp;
    let cx=f.x, cy=f.y;

    if(f.merging){
      const dx = f.tx - cx, dy = f.ty - cy;
      const d = Math.hypot(dx,dy);
      if(d>0.1){
        const sp = MERGE_SPEED*dt;
        const nx = dx/d, ny = dy/d;
        cx += Math.min(sp,d)*nx;
        cy += Math.min(sp,d)*ny;
      }
    } else {
      cx += f.vx*dt; cy += f.vy*dt;
      const margin=40, top=40;
      if (cx<margin||cx>W-margin) f.vx*=-1, cx=Math.max(margin,Math.min(W-margin,cx));
      if (cy<top||cy>H-margin)   f.vy*=-1, cy=Math.max(top,Math.min(H-margin,cy));
    }
    f.x=cx; f.y=cy+yb;
  }

  // complete merges when both arrive
  for (let i = mergePairs.length - 1; i >= 0; i--) {
    const pair = mergePairs[i];
    const a = state.frogs.find(f => f.id === pair.aId);
    const b = state.frogs.find(f => f.id === pair.bId);
    if (!a || !b) { mergePairs.splice(i,1); continue; }
    const da = Math.hypot(a.x - pair.mx, a.y - pair.my);
    const db = Math.hypot(b.x - pair.mx, b.y - pair.my);
    if (da <= MERGE_RADIUS && db <= MERGE_RADIUS) {
      const tier = Math.min(MAX_TIER, a.tier + 1);
      state.frogs = state.frogs.filter(f => f.id !== a.id && f.id !== b.id);
      addFrog(tier, pair.mx, pair.my);
      state.unlockedMax = Math.max(state.unlockedMax, tier);
      mergePairs.splice(i,1);
      save();
      renderBiggest();
      if (state.autoMerge) autoMergeSweep();
    }
  }
}

function drawFrogs(){
  // background first (scaled)
  if (BG_IMG) ctx.drawImage(BG_IMG, 0, 0, canvas.width/(window.devicePixelRatio||1), canvas.height/(window.devicePixelRatio||1));
  else ctx.clearRect(0,0,W,H);

  for(const f of state.frogs){
    const img = FROG_IMG[f.tier];
    const size = Math.max(40, Math.min(W,H) * 0.09) + f.tier*2; // scale with screen
    const r = size/2;

    if (img) ctx.drawImage(img, f.x - r, f.y - r, size, size);
    else { ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI*2); ctx.fillStyle = `hsl(${(f.tier*35)%360} 60% 60%)`; ctx.fill(); }

    // NO selection rings anymore (requested)
  }
  document.getElementById('frogCount').textContent = state.frogs.length;
}

function requestPaint(){
  if (animReq) return;
  let last = performance.now();
  const loop = (t)=>{
    const dt = Math.min(0.05, (t-last)/1000); last = t;
    updateFrogs(dt);
    drawFrogs();
    animReq = requestAnimationFrame(loop);
    if (!document.getElementById('pond').classList.contains('visible')){
      cancelAnimationFrame(animReq); animReq=null;
    }
  };
  animReq = requestAnimationFrame(loop);
}

// clicks (manual merge scheduling with 2s wait)
canvas.addEventListener('click', (ev)=>{
  const rect = canvas.getBoundingClientRect();
  const ratioX = (canvas.width/(window.devicePixelRatio||1)) / rect.width;
  const ratioY = (canvas.height/(window.devicePixelRatio||1)) / rect.height;
  const x = (ev.clientX - rect.left) * ratioX;
  const y = (ev.clientY - rect.top) * ratioY;

  // find topmost frog
  let hit=null;
  for(let i=state.frogs.length-1;i>=0;i--){
    const f = state.frogs[i];
    const size = Math.max(40, Math.min(W,H) * 0.09) + f.tier*2;
    const r = size/2;
    if (Math.hypot(f.x-x,f.y-y) <= r){ hit=f; break; }
  }
  if (!hit){ selectedId=null; return; }
  if (selectedId===null){ selectedId = hit.id; return; }
  if (selectedId===hit.id){ selectedId=null; return; }

  const a = state.frogs.find(f=>f.id===selectedId);
  const b = hit;
  if (a && b && a.tier===b.tier && !a.merging && !b.merging){
  // cancel any pending auto-merge for these frogs, then merge immediately
  for (let i = pendingMerges.length - 1; i >= 0; i--) {
    const p = pendingMerges[i];
    if (p.aId === a.id || p.bId === a.id || p.aId === b.id || p.bId === b.id) {
      pendingMerges.splice(i, 1);
    }
  }
  reserved.delete(a.id); reserved.delete(b.id);
  beginMerge(a, b); // <-- no wait for manual merges
}
  selectedId=null;
});

// auto-merge schedules (also 2s wait)
document.getElementById('autoMergeToggle').addEventListener('change', (e)=>{
  state.autoMerge = e.target.checked; save();
  autoMergeSweep();
});
function autoMergeSweep(){
  if (!state.autoMerge) return;
  const buckets = {};
  for (const f of state.frogs){ if (!f.merging && !reserved.has(f.id)) (buckets[f.tier] ??= []).push(f); }
  for (const tier in buckets){
    const list = buckets[tier];
    for (let i=0;i+1<list.length;i+=2){
      const a=list[i], b=list[i+1];
      scheduleMerge(a,b);
    }
  }
}

// pod actions
function closePod(){ try{ podModal.close(); }catch{} }
releaseManualBtn.addEventListener('click', ()=>{ spawnBatch(state.podCount); state.podOpen=false; state.podCount=0; save(); closePod(); });
releaseAutoBtn.addEventListener('click', ()=>{ spawnBatch(state.podCount); state.podOpen=false; state.podCount=0; state.autoMerge=true; document.getElementById('autoMergeToggle').checked=true; save(); closePod(); autoMergeSweep(); });

// history
const historyList = document.getElementById('historyList');
function renderHistory(){
  historyList.innerHTML = '';
  if (!state.history.length){
    historyList.innerHTML = `<div class="item"><div>No sessions yet. Run a timer!</div></div>`;
    return;
  }

  state.history.forEach((h, idx) => {
    const row = document.createElement('div');
    row.className = 'item';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = h.title;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = mmss(h.seconds);

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.title = 'Delete';
    del.ariaLabel = 'Delete';
    del.textContent = '🗑️';

    del.addEventListener('click', () => {
      const ok = confirm(`Delete "${h.title}" (${mmss(h.seconds)}) from history?`);
      if (!ok) return;
      state.history.splice(idx, 1);
      save();
      renderHistory();
    });

    row.appendChild(title);
    row.appendChild(meta);     // .meta already has margin-left:auto in CSS
    row.appendChild(del);      // sits on the far right, after duration
    historyList.appendChild(row);
  });
}

// todos
const todoTitle = document.getElementById('todoTitle');
const todoSlider= document.getElementById('todoSlider');
const todoMinTxt= document.getElementById('todoMinutesText');
const addTodoBtn= document.getElementById('addTodoBtn');
const todoList  = document.getElementById('todoList');
function renderTodos(){
  todoList.innerHTML = '';
  if (!state.todos.length){ todoList.innerHTML = `<div class="item"><div>No goals yet.</div></div>`; return; }
  state.todos.forEach((t)=>{
    const row = document.createElement('div');
    row.className='item';
    const startBtn = document.createElement('button'); startBtn.className='btn'; startBtn.textContent='Start';
    startBtn.addEventListener('click', ()=>{
      state.timerTitle = t.title; state.timerTargetSec = Math.max(60, t.minutes*60);
      save(); updateTimerSetupUI();
      state.timerStartEpoch = Date.now(); state.pretendSpawnCount = 0; save();
      show('timer-run');
    });
    const title = document.createElement('div'); title.className='title'; title.textContent = t.title;
    const meta  = document.createElement('div'); meta.className='meta'; meta.textContent = `${t.minutes}m`;
    row.appendChild(startBtn); row.appendChild(title); row.appendChild(meta);
    todoList.appendChild(row);
  });
}
todoSlider.addEventListener('input', ()=>{ todoMinTxt.textContent = todoSlider.value; });
addTodoBtn.addEventListener('click', ()=>{ const ttl=(todoTitle.value||'Untitled').trim(); const minutes=Math.max(1,Math.min(120,parseInt(todoSlider.value))); state.todos.push({title:ttl, minutes}); save(); todoTitle.value=''; todoSlider.value=25; todoMinTxt.textContent='25'; renderTodos(); });

// biggest
const biggestImg = document.getElementById('biggestImg');
function renderBiggest(){
  const info = document.getElementById('biggestInfo');
  const tier = state.unlockedMax || 1;
  info.textContent = `Highest Tier: ${tier} – ${TIER_NAMES[tier]||'Frog'}`;
  const img = FROG_IMG[tier];
  if (img){ biggestImg.src = img.src; biggestImg.style.display='block'; } else { biggestImg.style.display='none'; }
}

// boot
function restoreUI(){
  load();
  updateTimerSetupUI();
  renderHistory(); renderTodos(); renderBiggest();
  document.getElementById('autoMergeToggle').checked = !!state.autoMerge;
  if (state.frogs.length>0) requestPaint();
  if (state.podOpen && state.podCount>0){ podCountEl.textContent = state.podCount; podModal.showModal(); }
}
Promise.all([loadImages(TIER_FILES)]).then(()=>{ restoreUI(); show('timer-setup'); });
document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState==='visible' && document.getElementById('timer-run').classList.contains('visible')) tick(); });
