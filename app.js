// ─── FIREBASE ────────────────────────────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCz0SLWLbRVvFhpcnjdpaf-MA2lOiGaz8c",
  authDomain: "strava-chris.firebaseapp.com",
  databaseURL: "https://strava-chris-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "strava-chris",
  storageBucket: "strava-chris.firebasestorage.app",
  messagingSenderId: "256179591581",
  appId: "1:256179591581:web:35b38046b7d91d7fd83774"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CLIENT_ID    = '212390';
const REDIRECT_URI = 'https://christianziegler1-ctrl.github.io/Strava-Dashboard/';
const SCOPE        = 'read,activity:read_all';

// ─── STATE ────────────────────────────────────────────────────────────────────
let activities = [];
let athlete    = null;
let charts     = {};
let planDist   = null;
let planTarget = 0;
let weekOffset = 0;
let currentPlan = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  if (code) {
    window.history.replaceState({}, '', window.location.pathname);
    show('loading'); setSpinText('Verbinde mit Strava…');
    await exchangeCode(code); return;
  }
  const token = getStoredToken();
  if (token) { show('loading'); setSpinText('Lade gespeicherte Daten…'); await loadData(); }
  else show('login');
});

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function stravaLogin() {
  window.location.href = `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&approval_prompt=auto&scope=${SCOPE}`;
}
async function exchangeCode(code) {
  try {
    const res  = await fetch('https://www.strava.com/api/v3/oauth/token', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id:CLIENT_ID,client_secret:'9a72a230557541966f235311c06afb92255238cd',code,grant_type:'authorization_code'})
    });
    const data = await res.json();
    if (data.access_token) { saveToken(data); await loadData(); }
    else throw new Error(data.message||'Token-Fehler');
  } catch(e) { alert('Fehler: '+e.message); show('login'); }
}
async function refreshIfNeeded() {
  const t = JSON.parse(localStorage.getItem('strava_token')||'null');
  if (!t) return null;
  if (Date.now()/1000 > t.expires_at-300) {
    try {
      const res  = await fetch('https://www.strava.com/api/v3/oauth/token', {
        method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body: new URLSearchParams({client_id:CLIENT_ID,client_secret:'9a72a230557541966f235311c06afb92255238cd',grant_type:'refresh_token',refresh_token:t.refresh_token})
      });
      const data = await res.json();
      if (data.access_token) { saveToken(data); return data.access_token; }
    } catch {}
    return null;
  }
  return t.access_token;
}
function saveToken(data) { localStorage.setItem('strava_token',JSON.stringify({access_token:data.access_token,refresh_token:data.refresh_token,expires_at:data.expires_at,athlete:data.athlete})); }
function getStoredToken() { return JSON.parse(localStorage.getItem('strava_token')||'null'); }
function logout() { localStorage.removeItem('strava_token'); activities=[];athlete=null;Object.values(charts).forEach(c=>c?.destroy());charts={};show('login'); }

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function loadData() {
  const token = await refreshIfNeeded();
  if (!token) { show('login'); return; }
  const stored    = getStoredToken();
  const athleteId = stored?.athlete?.id||'user';
  const dbRef     = ref(db,`athletes/${athleteId}`);
  try {
    setSpinText('Gespeicherte Daten laden…');
    const snapshot = await get(dbRef);
    const cached   = snapshot.exists()?snapshot.val():null;
    if (cached?.activities && Object.keys(cached.activities).length>0) {
      activities = Object.values(cached.activities).map(hydrateActivity).sort((a,b)=>b.date-a.date);
      athlete    = cached.athleteProfile||stored?.athlete;
      initApp();
      setSpinText('Prüfe auf neue Läufe…');
      const newActs = await fetchNewActivities(token,cached.lastSync||0);
      if (newActs.length>0) {
        const updates={};
        newActs.forEach(a=>{updates[`athletes/${athleteId}/activities/${a.id}`]=serializeActivity(a);});
        updates[`athletes/${athleteId}/lastSync`]=Math.floor(Date.now()/1000);
        await update(ref(db),updates);
        const existingIds=new Set(activities.map(a=>a.id));
        newActs.forEach(a=>{if(!existingIds.has(a.id))activities.push(a);});
        activities.sort((a,b)=>b.date-a.date);
        renderAll();
        document.getElementById('athlete-meta').textContent=`${activities.length} Läufe · ${newActs.length} neu`;
      }
    } else {
      setSpinText('Erstes Laden — alle Aktivitäten werden geholt…');
      const ar = await fetch('https://www.strava.com/api/v3/athlete',{headers:{Authorization:`Bearer ${token}`}});
      athlete = await ar.json();
      activities = await fetchAllActivities(token);
      setSpinText('In Datenbank speichern…');
      const saveData={athleteProfile:athlete,lastSync:Math.floor(Date.now()/1000),activities:{}};
      activities.forEach(a=>{saveData.activities[a.id]=serializeActivity(a);});
      await set(dbRef,saveData);
      initApp();
    }
  } catch(e) {
    console.error(e);
    setSpinText('Lade direkt von Strava…');
    activities = await fetchAllActivities(token);
    initApp();
  }
}
async function fetchNewActivities(token,after) {
  try {
    const res=await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=50&after=${after}`,{headers:{Authorization:`Bearer ${token}`}});
    const data=await res.json();
    return (data||[]).filter(a=>a.sport_type==='Run'||a.type==='Run').map(parseAct).filter(a=>a&&a.distance>0.1);
  } catch{return[];}
}
async function fetchAllActivities(token) {
  const all=[];let page=1;
  while(true){
    setSpinText(`Aktivitäten laden… (${all.length} geladen)`);
    const res=await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=100&page=${page}`,{headers:{Authorization:`Bearer ${token}`}});
    const batch=await res.json();
    if(!batch?.length)break;
    all.push(...batch);
    if(batch.length<100)break;
    page++;await sleep(300);
  }
  return all.filter(a=>a.sport_type==='Run'||a.type==='Run').map(parseAct).filter(a=>a&&a.distance>0.1).sort((a,b)=>b.date-a.date);
}
function parseAct(a){const dist=a.distance/1000;return{id:a.id,name:a.name,date:new Date(a.start_date_local),distance:dist,movingTime:a.moving_time,elevation:a.total_elevation_gain||0,avgHR:a.average_heartrate||0,maxHR:a.max_heartrate||0,pace:dist>0?a.moving_time/dist:0,avgSpeed:a.average_speed};}
function serializeActivity(a){return{...a,date:a.date instanceof Date?a.date.getTime():a.date};}
function hydrateActivity(a){return{...a,date:new Date(a.date)};}

// ─── APP INIT ─────────────────────────────────────────────────────────────────
function initApp() {
  const stored=getStoredToken();
  const ath=stored?.athlete||athlete;
  if(ath){
    document.getElementById('athlete-name').textContent=`${ath.firstname||''} ${ath.lastname||''}`.trim();
    document.getElementById('athlete-meta').textContent=`${activities.length} Läufe gespeichert`;
    if(ath.profile_medium||ath.profile)document.getElementById('athlete-avatar').src=ath.profile_medium||ath.profile;
  }
  const years=[...new Set(activities.map(a=>a.date.getFullYear()))].sort((a,b)=>b-a);
  const sel=document.getElementById('filter-year');
  sel.innerHTML='<option value="">Alle Jahre</option>';
  years.forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y;sel.appendChild(o);});
  ['p-hours','p-min','p-sec'].forEach(id=>document.getElementById(id).addEventListener('input',updateGoBtn));
  renderAll();
  show('app');
}
function renderAll(){renderOverview();renderActivities();renderCharts();renderPRs();}

// ─── OVERVIEW ─────────────────────────────────────────────────────────────────
function renderOverview(){
  const now=Date.now();
  const last7=activities.filter(a=>(now-a.date)/86400000<=7);
  const last30=activities.filter(a=>(now-a.date)/86400000<=30);
  const prev30=activities.filter(a=>{const d=(now-a.date)/86400000;return d>30&&d<=60;});
  const km30=last30.reduce((s,a)=>s+a.distance,0);
  const pKm30=prev30.reduce((s,a)=>s+a.distance,0);
  const diff=pKm30>0?((km30-pKm30)/pKm30*100).toFixed(0):null;
  const avgPace=last30.length?last30.reduce((s,a)=>s+a.pace,0)/last30.length:0;
  document.getElementById('stat-grid').innerHTML=`
    <div class="stat-card"><div class="stat-lbl">Km diese Woche</div><div class="stat-val">${last7.reduce((s,a)=>s+a.distance,0).toFixed(1)}</div><div class="stat-unit">km</div></div>
    <div class="stat-card"><div class="stat-lbl">Km (30 Tage)</div><div class="stat-val">${km30.toFixed(0)}</div><div class="stat-unit">km ${diff!==null?`<span style="color:${diff>=0?'var(--green)':'var(--red)'}">${diff>=0?'↑':'↓'}${Math.abs(diff)}%</span>`:''}</div></div>
    <div class="stat-card"><div class="stat-lbl">Ø Pace (30T)</div><div class="stat-val">${fmtPace(avgPace)}</div><div class="stat-unit">min/km</div></div>
    <div class="stat-card"><div class="stat-lbl">Gesamt-Läufe</div><div class="stat-val">${activities.length}</div><div class="stat-unit">alle Zeiten</div></div>
    <div class="stat-card"><div class="stat-lbl">Gesamt-Km</div><div class="stat-val">${(activities.reduce((s,a)=>s+a.distance,0)/1000).toFixed(1)}k</div><div class="stat-unit">km</div></div>
    <div class="stat-card"><div class="stat-lbl">Ø km/Woche</div><div class="stat-val">${(km30/4).toFixed(0)}</div><div class="stat-unit">km</div></div>
    <div class="stat-card"><div class="stat-lbl">Höhenmeter (30T)</div><div class="stat-val">${last30.reduce((s,a)=>s+a.elevation,0).toFixed(0)}</div><div class="stat-unit">m</div></div>
    <div class="stat-card"><div class="stat-lbl">Zeit (30T)</div><div class="stat-val">${Math.floor(last30.reduce((s,a)=>s+a.movingTime,0)/3600)}</div><div class="stat-unit">Stunden</div></div>`;
  document.getElementById('recent-runs').innerHTML=activities.slice(0,8).map(actRow).join('');
  renderWeeklyChart();
}
function actRow(a){const pc=a.pace<300?'pb-fast':a.pace<360?'pb-mid':'pb-slow';return`<div class="act-row"><div class="act-left"><div class="act-name">${a.name}</div><div class="act-date">${fmtDate(a.date)}</div></div><div class="act-right"><div class="act-stat"><div class="act-stat-val">${a.distance.toFixed(2)}</div><div class="act-stat-lbl">km</div></div><div class="act-stat"><div class="act-stat-val"><span class="pace-badge ${pc}">${fmtPace(a.pace)}</span></div><div class="act-stat-lbl">/km</div></div><div class="act-stat"><div class="act-stat-val">${fmtTime(a.movingTime)}</div><div class="act-stat-lbl">Zeit</div></div>${a.avgHR>0?`<div class="act-stat"><div class="act-stat-val">${a.avgHR.toFixed(0)}</div><div class="act-stat-lbl">HF</div></div>`:''}</div></div>`;}
function renderWeeklyChart(){
  const weeks={};
  activities.forEach(a=>{const k=getMonday(a.date).toISOString().slice(0,10);weeks[k]=(weeks[k]||0)+a.distance;});
  const sorted=Object.keys(weeks).sort().slice(-16);
  if(charts.weekly)charts.weekly.destroy();
  charts.weekly=new Chart(document.getElementById('weeklyChart'),{type:'bar',data:{labels:sorted.map(w=>{const d=new Date(w);return`${d.getDate()}.${d.getMonth()+1}.`;}),datasets:[{data:sorted.map(w=>+weeks[w].toFixed(1)),backgroundColor:sorted.map(w=>weeks[w]>60?'#FC4C02':'rgba(252,76,2,0.4)'),borderRadius:5}]},options:chartOpts()});
}

// ─── ACTIVITIES ───────────────────────────────────────────────────────────────
function renderActivities(){
  const year=document.getElementById('filter-year').value;
  const sort=document.getElementById('sort-by').value;
  let acts=year?activities.filter(a=>a.date.getFullYear()==year):[...activities];
  if(sort==='distance')acts.sort((a,b)=>b.distance-a.distance);
  else if(sort==='pace')acts.sort((a,b)=>a.pace-b.pace);
  document.getElementById('all-activities').innerHTML=acts.map(actRow).join('');
}

// ─── CHARTS ───────────────────────────────────────────────────────────────────
function renderCharts(){
  const pd=activities.slice(0,60).reverse();
  if(charts.pace)charts.pace.destroy();
  charts.pace=new Chart(document.getElementById('paceChart'),{type:'line',data:{labels:pd.map(a=>`${a.date.getDate()}.${a.date.getMonth()+1}.`),datasets:[{data:pd.map(a=>+(a.pace/60).toFixed(2)),borderColor:'#FC4C02',backgroundColor:'rgba(252,76,2,0.08)',tension:0.4,fill:true,pointRadius:3}]},options:{...chartOpts(),scales:{x:{ticks:{color:'#555',font:{size:11}},grid:{color:'#1e1e1e'}},y:{reverse:true,ticks:{color:'#555',callback:v=>fmtPace(v*60)},grid:{color:'#1e1e1e'}}}}});
  const months={};
  activities.forEach(a=>{const k=`${a.date.getFullYear()}-${String(a.date.getMonth()+1).padStart(2,'0')}`;months[k]=(months[k]||0)+a.distance;});
  const sm=Object.keys(months).sort().slice(-18);
  if(charts.monthly)charts.monthly.destroy();
  charts.monthly=new Chart(document.getElementById('monthlyChart'),{type:'bar',data:{labels:sm.map(m=>{const[y,mo]=m.split('-');return`${mo}/${y.slice(2)}`;}),datasets:[{data:sm.map(m=>+months[m].toFixed(1)),backgroundColor:'rgba(252,76,2,0.55)',borderRadius:4}]},options:chartOpts()});
  const bk={'<5km':0,'5–10':0,'10–15':0,'15–21':0,'HM+':0,'42+':0};
  activities.forEach(a=>{if(a.distance<5)bk['<5km']++;else if(a.distance<10)bk['5–10']++;else if(a.distance<15)bk['10–15']++;else if(a.distance<21.1)bk['15–21']++;else if(a.distance<30)bk['HM+']++;else bk['42+']++;});
  if(charts.dist)charts.dist.destroy();
  charts.dist=new Chart(document.getElementById('distChart'),{type:'doughnut',data:{labels:Object.keys(bk),datasets:[{data:Object.values(bk),backgroundColor:['#FC4C02','#ff7043','#fbbf24','#4ade80','#60a5fa','#a78bfa'],borderWidth:0}]},options:{plugins:{legend:{labels:{color:'#888',font:{size:12}}}},maintainAspectRatio:false}});
  const maxHR=172;const zones={1:0,2:0,3:0,4:0,5:0};let hasHR=false;
  activities.forEach(a=>{if(a.avgHR>0){hasHR=true;const p=a.avgHR/maxHR;if(p<0.6)zones[1]++;else if(p<0.7)zones[2]++;else if(p<0.8)zones[3]++;else if(p<0.9)zones[4]++;else zones[5]++;}});
  const card=document.getElementById('hr-zone-card');
  if(hasHR){const total=Object.values(zones).reduce((s,v)=>s+v,0);const colors=['#60a5fa','#4ade80','#fbbf24','#f87171','#a78bfa'];const names=['Zone 1 Erholung','Zone 2 Grundlage','Zone 3 Tempo','Zone 4 Schwelle','Zone 5 Max'];card.innerHTML=`<div class="zone-bar">${[1,2,3,4,5].map((z,i)=>`<div class="zone-seg" style="width:${(zones[z]/total*100).toFixed(1)}%;background:${colors[i]}"></div>`).join('')}</div><div class="zone-legend">${[1,2,3,4,5].map((z,i)=>`<div class="zone-item"><div class="zone-dot" style="background:${colors[i]}"></div>${names[i]}: ${(zones[z]/total*100).toFixed(0)}%</div>`).join('')}</div>`;}
  else card.innerHTML='<div class="empty">Keine Herzfrequenzdaten gefunden.</div>';
}

// ─── PLAN SETUP ───────────────────────────────────────────────────────────────
function selectDist(km,el){
  planDist=km;
  document.querySelectorAll('.dist-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  const d={5:[0,20,0],10:[0,40,0],21.1:[1,40,0],42.2:[3,30,0]};
  const[h,m,s]=d[km]||[0,30,0];
  document.getElementById('p-hours').value=h||'';
  document.getElementById('p-min').value=m;
  document.getElementById('p-sec').value=s||'';
  updateGoBtn();
}
function updateGoBtn(){
  const h=parseInt(document.getElementById('p-hours').value)||0;
  const m=parseInt(document.getElementById('p-min').value)||0;
  const s=parseInt(document.getElementById('p-sec').value)||0;
  const key=localStorage.getItem('anthropic_key')||'';
  document.getElementById('go-btn').disabled=!(planDist&&(h*3600+m*60+s)>0&&key);
}

function saveApiKey(){
  const key=document.getElementById('api-key-input').value.trim();
  if(!key.startsWith('sk-ant')){alert('Ungültiger Key — muss mit sk-ant beginnen.');return;}
  localStorage.setItem('anthropic_key',key);
  document.getElementById('api-key-input').value='sk-ant-••••••••••••••••••••';
  document.getElementById('key-status').textContent='✓ Key gespeichert';
  document.getElementById('key-status').style.color='var(--green)';
  updateGoBtn();
}

async function buildPlan(){
  const h=parseInt(document.getElementById('p-hours').value)||0;
  const m=parseInt(document.getElementById('p-min').value)||0;
  const s=parseInt(document.getElementById('p-sec').value)||0;
  planTarget=h*3600+m*60+s; weekOffset=0;
  const label=planDist===21.1?'Halbmarathon':planDist===42.2?'Marathon':`${planDist}K`;
  document.getElementById('plan-dist-label').textContent=label;
  document.getElementById('plan-goal-sub').textContent=`Ziel: ${fmtTime(planTarget)}`;
  document.getElementById('plan-setup').style.display='none';
  document.getElementById('plan-view').style.display='block';
  renderGoalProgress();
  renderThisWeekRuns();
  await generateAIPlan();
}

function resetPlan(){
  document.getElementById('plan-setup').style.display='block';
  document.getElementById('plan-view').style.display='none';
  currentPlan=null;
}

// ─── AI PLAN GENERATION ───────────────────────────────────────────────────────
async function generateAIPlan(){
  const container=document.getElementById('plan-sessions');
  const weekLabel=document.getElementById('wk-label');
  weekLabel.textContent='KI ANALYSIERT…';
  container.innerHTML=`<div class="ai-loading"><div class="ai-spin"></div><div class="ai-load-text" id="ai-load-text">Claude analysiert deine ${activities.length} Läufe…</div></div>`;

  const apiKey=localStorage.getItem('anthropic_key');
  if(!apiKey){container.innerHTML='<div class="empty">Kein API Key gespeichert. Bitte oben eingeben.</div>';return;}

  // Build training summary for Claude
  const now=Date.now();
  const last90=activities.filter(a=>(now-a.date)/86400000<=90);
  const last30=activities.filter(a=>(now-a.date)/86400000<=30);
  const weeklyKm=last30.reduce((s,a)=>s+a.distance,0)/4;
  const avgPace=last90.length?last90.reduce((s,a)=>s+a.pace,0)/last90.length:0;
  const bestPace=last90.length?Math.min(...last90.map(a=>a.pace)):0;
  const longestRun=last90.length?Math.max(...last90.map(a=>a.distance)):0;
  const best=getBestTime(planDist);

  // Weekly breakdown last 12 weeks
  const weeklyData=[];
  for(let i=11;i>=0;i--){
    const wStart=new Date();wStart.setDate(wStart.getDate()-i*7-(wStart.getDay()||7)+1);wStart.setHours(0,0,0,0);
    const wEnd=new Date(wStart);wEnd.setDate(wStart.getDate()+6);wEnd.setHours(23,59,59);
    const wActs=activities.filter(a=>a.date>=wStart&&a.date<=wEnd);
    weeklyData.push({km:wActs.reduce((s,a)=>s+a.distance,0).toFixed(1),runs:wActs.length,longRun:wActs.length?Math.max(...wActs.map(a=>a.distance)).toFixed(1):0});
  }

  const distLabel=planDist===21.1?'Halbmarathon':planDist===42.2?'Marathon':`${planDist}km`;
  const targetPace=fmtPace(planTarget/planDist);

  const prompt=`Du bist ein erfahrener Lauftrainer mit Expertise in evidenzbasiertem Ausdauertraining (Daniels, Pfitzinger, Hansons-Methode).

Analysiere folgende Trainingsdaten und erstelle einen wissenschaftlich fundierten Wochentrainingsplan:

ATHLET:
- Ziel: ${distLabel} in ${fmtTime(planTarget)} (Zieltempo: ${targetPace}/km)
- Aktuelle Bestzeit über ${distLabel}: ${best?fmtTime(best):'noch keine'}
- Ø Wochenkilometer (30T): ${weeklyKm.toFixed(1)} km
- Längster Lauf (90T): ${longestRun.toFixed(1)} km
- Ø Pace (90T): ${fmtPace(avgPace)}/km
- Schnellste Pace (90T): ${fmtPace(bestPace)}/km

LETZTE 12 WOCHEN (älteste→neueste):
${weeklyData.map((w,i)=>`Woche ${i+1}: ${w.km}km, ${w.runs} Läufe, längster Lauf: ${w.longRun}km`).join('\n')}

Erstelle einen Trainingsplan für die AKTUELLE Woche (Montag bis Sonntag).
Die Paces sollen auf den echten Daten basieren und nach Daniels' Trainingszonen berechnet werden.
Long Runs müssen für ${distLabel} angemessen sein (HM: min 16km, Marathon: min 22km in Peak-Phase).

Antworte NUR mit einem JSON-Array, kein Text davor oder danach:
[
  {
    "day": 0,
    "type": "easy|tempo|interval|long|rest",
    "typeLabel": "Locker|Tempo|Intervall|Langer Lauf|Ruhetag",
    "title": "Kurzer Titel",
    "desc": "Genaue Beschreibung mit Warm-up, Hauptteil, Cool-down. Bei Intervallen: exakte Wiederholungen, Distanz, Pause.",
    "dist": "X.X km oder null",
    "pace": "M:SS/km oder null",
    "science": "1 Satz wissenschaftliche Begründung"
  }
]
day 0=Montag, 6=Sonntag. Genau 7 Einträge.`;

  try {
    document.getElementById('ai-load-text').textContent='Claude erstellt deinen personalisierten Plan…';
    const res=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:2000,messages:[{role:'user',content:prompt}]})
    });
    const data=await res.json();
    if(!res.ok)throw new Error(data.error?.message||'API Fehler');
    const text=data.content[0].text.replace(/```json|```/g,'').trim();
    const plan=JSON.parse(text);
    currentPlan=plan;
    weekLabel.textContent='DIESE WOCHE';
    renderAIPlanSessions(plan);
  } catch(e) {
    console.error(e);
    container.innerHTML=`<div class="empty">Fehler beim Generieren: ${e.message}<br><br><button onclick="generateAIPlan()" style="background:var(--orange);color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer">Nochmal versuchen</button></div>`;
    weekLabel.textContent='FEHLER';
  }
}

function renderAIPlanSessions(plan){
  const monday=getWeekMonday(weekOffset);
  const today=new Date();today.setHours(0,0,0,0);
  const days=['Mo','Di','Mi','Do','Fr','Sa','So'];
  document.getElementById('plan-sessions').innerHTML=plan.map((s,i)=>{
    const day=new Date(monday);day.setDate(monday.getDate()+i);
    const isToday=day.getTime()===today.getTime();
    const dayRuns=activities.filter(a=>{const d=new Date(a.date);d.setHours(0,0,0,0);return d.getTime()===day.getTime();});
    const done=dayRuns.length>0&&s.type!=='rest';
    return`<div class="session ${s.type==='rest'?'rest':''} ${isToday?'today':''} ${done?'done':''}">
      <div class="s-day"><div class="s-daynum">${day.getDate()}</div><div class="s-dayname">${days[i]}</div>${isToday?'<div class="s-today-dot"></div>':''}</div>
      <div>
        <div class="s-type ${s.type}">${done?'✓ ':''}${s.typeLabel}</div>
        <div class="s-title">${s.title}</div>
        <div class="s-desc">${s.desc}</div>
        ${s.science?`<div class="s-science">📚 ${s.science}</div>`:''}
        <div class="s-chips">
          ${s.dist&&s.dist!=='null'?`<span class="chip chip-dist">${s.dist}</span>`:''}
          ${s.pace&&s.pace!=='null'?`<span class="chip chip-pace">⚡ ${s.pace}</span>`:''}
          ${done?`<span class="chip chip-done">✓ ${dayRuns[0].distance.toFixed(1)} km gelaufen</span>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

async function changeWeek(d){
  weekOffset+=d;
  renderThisWeekRuns();
  if(weekOffset===0)document.getElementById('wk-label').textContent='DIESE WOCHE';
  else if(weekOffset===1)document.getElementById('wk-label').textContent='NÄCHSTE WOCHE';
  else if(weekOffset===-1)document.getElementById('wk-label').textContent='LETZTE WOCHE';
  else{const m=getWeekMonday(weekOffset);const e=new Date(m);e.setDate(m.getDate()+6);document.getElementById('wk-label').textContent=`${fmtDateShort(m)}–${fmtDateShort(e)}`;}
  await generateAIPlan();
}

function renderGoalProgress(){
  const best=getBestTime(planDist);
  const pct=best?Math.min(100,(planTarget/best)*100):0;
  const gap=best?best-planTarget:null;
  const gapText=gap===null?'Noch keine Vergleichsaktivität — leg los!':gap<=0?`🎉 Ziel bereits erreicht! Bestzeit: ${fmtTime(best)}`:`Noch ${fmtTime(gap)} bis zum Ziel`;
  document.getElementById('goal-progress-card').innerHTML=`<div class="gp-row"><div class="gp-block"><div class="gp-val">${best?fmtTime(best):'—'}</div><div class="gp-lbl">Aktuelle Bestzeit</div></div><div class="gp-block" style="text-align:right"><div class="gp-val" style="color:var(--orange)">${fmtTime(planTarget)}</div><div class="gp-lbl">Dein Ziel</div></div></div><div class="gp-bar"><div class="gp-fill" style="width:${pct.toFixed(1)}%"></div></div><div class="gp-pct">${pct.toFixed(0)}% des Ziels erreicht</div><div class="gp-gap">${gapText}</div>`;
}
function renderThisWeekRuns(){
  const monday=getWeekMonday(weekOffset);const sunday=new Date(monday);sunday.setDate(monday.getDate()+6);sunday.setHours(23,59,59);
  const runs=activities.filter(a=>a.date>=monday&&a.date<=sunday);
  document.getElementById('plan-this-week').innerHTML=runs.length?runs.map(actRow).join(''):'<div class="empty">Noch keine Läufe diese Woche.</div>';
}
function getBestTime(dist){const tol=dist<10?0.4:dist<15?0.8:1.5;const c=activities.filter(a=>Math.abs(a.distance-dist)<=tol&&a.pace>0);if(!c.length)return null;return Math.min(...c.map(a=>a.pace*dist));}

// ─── PRS ──────────────────────────────────────────────────────────────────────
function renderPRs(){
  const dists=[1,5,10,21.1,42.2];const labels=['1K','5K','10K','Halbmarathon','Marathon'];
  const prs=dists.map((d,i)=>{const t=getBestTime(d);return t?{label:labels[i],time:t,date:getBestDate(d)}:null;}).filter(Boolean);
  document.getElementById('pr-grid').innerHTML=prs.map(p=>`<div class="pr-card"><div class="pr-dist">${p.label}</div><div class="pr-time">${fmtTime(p.time)}</div><div class="pr-date">${p.date?fmtDate(p.date):''}</div></div>`).join('');
  const runs5k=activities.filter(a=>Math.abs(a.distance-5)<=0.3&&a.pace>0).slice(0,30).reverse();
  if(charts.pr)charts.pr.destroy();
  if(runs5k.length>2){charts.pr=new Chart(document.getElementById('prChart'),{type:'line',data:{labels:runs5k.map(a=>`${a.date.getDate()}.${a.date.getMonth()+1}.${a.date.getFullYear()}`),datasets:[{label:'5K Pace',data:runs5k.map(a=>+(a.pace/60).toFixed(2)),borderColor:'#FC4C02',backgroundColor:'rgba(252,76,2,0.08)',tension:0.4,fill:true,pointRadius:4},{label:'Ziel 4:00',data:runs5k.map(()=>4),borderColor:'#4ade80',borderDash:[5,5],pointRadius:0}]},options:{...chartOpts(),scales:{x:{ticks:{color:'#555',font:{size:11}},grid:{color:'#1e1e1e'}},y:{reverse:true,ticks:{color:'#555',callback:v=>fmtPace(v*60)},grid:{color:'#1e1e1e'}}}}});}
  else document.getElementById('prChart').parentElement.innerHTML='<div class="empty">Nicht genug 5K-Läufe vorhanden.</div>';
}
function getBestDate(dist){const tol=dist<10?0.4:dist<15?0.8:1.5;const c=activities.filter(a=>Math.abs(a.distance-dist)<=tol&&a.pace>0);if(!c.length)return null;return c.reduce((b,a)=>a.pace<b.pace?a:b).date;}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function switchTab(el){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));el.classList.add('active');document.getElementById('tab-'+el.dataset.tab).classList.add('active');}
function show(name){document.getElementById('screen-login').style.display=name==='login'?'flex':'none';document.getElementById('screen-loading').style.display=name==='loading'?'flex':'none';document.getElementById('screen-app').style.display=name==='app'?'block':'none';}
function setSpinText(t){document.getElementById('spin-text').textContent=t;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function getMonday(d){const r=new Date(d);r.setHours(0,0,0,0);const day=r.getDay()||7;r.setDate(r.getDate()-(day-1));return r;}
function getWeekMonday(offset=0){const n=new Date();n.setHours(0,0,0,0);const day=n.getDay()||7;n.setDate(n.getDate()-(day-1)+offset*7);return n;}
function fmtPace(s){if(!s||s<=0)return'--:--';return`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;}
function fmtTime(s){if(!s||s<=0)return'--';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.round(s%60);return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;}
function fmtDate(d){return`${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}`;}
function fmtDateShort(d){return`${d.getDate()}.${d.getMonth()+1}.`;}
function chartOpts(){return{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#555',font:{size:11},maxRotation:45},grid:{color:'#1e1e1e'}},y:{ticks:{color:'#555',font:{size:11}},grid:{color:'#1e1e1e'}}}};}

window.stravaLogin=stravaLogin;window.logout=logout;window.switchTab=switchTab;
window.selectDist=selectDist;window.buildPlan=buildPlan;window.resetPlan=resetPlan;
window.changeWeek=changeWeek;window.renderActivities=renderActivities;window.updateGoBtn=updateGoBtn;
window.saveApiKey=saveApiKey;window.generateAIPlan=generateAIPlan;
