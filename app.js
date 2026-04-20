// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CLIENT_ID     = ‘212390’;
const REDIRECT_URI  = ‘https://christianziegler1-ctrl.github.io/Strava-Dashboard/’;
const SCOPE         = ‘read,activity:read_all’;

// ─── STATE ────────────────────────────────────────────────────────────────────
let activities  = [];
let athlete     = null;
let charts      = {};
let planDist    = null;
let planTarget  = 0;
let weekOffset  = 0;

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener(‘DOMContentLoaded’, async () => {
// Handle OAuth callback
const params = new URLSearchParams(window.location.search);
const code   = params.get(‘code’);

if (code) {
// Clean URL immediately
window.history.replaceState({}, ‘’, window.location.pathname);
show(‘loading’); setSpinText(‘Verbinde mit Strava…’);
await exchangeCode(code);
return;
}

// Check stored token
const token = getToken();
if (token) {
show(‘loading’); setSpinText(‘Daten werden geladen…’);
await loadData();
} else {
show(‘login’);
}
});

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function stravaLogin() {
const url = `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&approval_prompt=auto&scope=${SCOPE}`;
window.location.href = url;
}

async function exchangeCode(code) {
try {
const res = await fetch(‘https://www.strava.com/api/v3/oauth/token’, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/x-www-form-urlencoded’ },
body: new URLSearchParams({
client_id:     CLIENT_ID,
client_secret: ‘9a72a230557541966f235311c06afb92255238cd’,
code:          code,
grant_type:    ‘authorization_code’
})
});
const data = await res.json();
if (data.access_token) {
saveToken(data);
await loadData();
} else {
throw new Error(data.message || ‘Token-Fehler’);
}
} catch(e) {
alert(’Verbindung fehlgeschlagen: ’ + e.message);
show(‘login’);
}
}

async function refreshToken() {
const stored = JSON.parse(localStorage.getItem(‘strava_token’) || ‘null’);
if (!stored?.refresh_token) return false;
try {
const res = await fetch(‘https://www.strava.com/api/v3/oauth/token’, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/x-www-form-urlencoded’ },
body: new URLSearchParams({
client_id:     CLIENT_ID,
client_secret: ‘9a72a230557541966f235311c06afb92255238cd’,
grant_type:    ‘refresh_token’,
refresh_token: stored.refresh_token
})
});
const data = await res.json();
if (data.access_token) { saveToken(data); return true; }
} catch {}
return false;
}

function saveToken(data) {
localStorage.setItem(‘strava_token’, JSON.stringify({
access_token:  data.access_token,
refresh_token: data.refresh_token,
expires_at:    data.expires_at,
athlete:       data.athlete
}));
}

function getToken() {
const t = JSON.parse(localStorage.getItem(‘strava_token’) || ‘null’);
return t?.access_token ? t : null;
}

async function getValidToken() {
let t = JSON.parse(localStorage.getItem(‘strava_token’) || ‘null’);
if (!t) return null;
// Refresh if expires in < 5 min
if (Date.now() / 1000 > t.expires_at - 300) {
const ok = await refreshToken();
if (!ok) return null;
t = JSON.parse(localStorage.getItem(‘strava_token’));
}
return t.access_token;
}

function logout() {
localStorage.removeItem(‘strava_token’);
activities = []; athlete = null;
Object.values(charts).forEach(c => c?.destroy());
charts = {};
show(‘login’);
}

// ─── DATA LOADING ─────────────────────────────────────────────────────────────
async function loadData() {
const token = await getValidToken();
if (!token) { show(‘login’); return; }

try {
setSpinText(‘Athleten-Profil laden…’);
const athleteRes = await fetch(‘https://www.strava.com/api/v3/athlete’, {
headers: { Authorization: `Bearer ${token}` }
});
athlete = await athleteRes.json();

```
setSpinText('Aktivitäten laden (kann etwas dauern)…');
activities = await fetchAllActivities(token);

setSpinText('Dashboard wird aufgebaut…');
await sleep(200);
initApp();
```

} catch(e) {
alert(’Fehler beim Laden: ’ + e.message);
show(‘login’);
}
}

async function fetchAllActivities(token) {
const all = [];
let page  = 1;
while (true) {
setSpinText(`Aktivitäten laden… (${all.length} geladen)`);
const res = await fetch(
`https://www.strava.com/api/v3/athlete/activities?per_page=100&page=${page}`,
{ headers: { Authorization: `Bearer ${token}` } }
);
const batch = await res.json();
if (!batch.length) break;
all.push(…batch);
if (batch.length < 100) break;
page++;
await sleep(300); // rate limit friendliness
}
// Filter only runs
return all
.filter(a => a.sport_type === ‘Run’ || a.type === ‘Run’ || (a.sport_type||’’).toLowerCase().includes(‘run’))
.map(a => ({
id:        a.id,
name:      a.name,
date:      new Date(a.start_date_local),
distance:  a.distance / 1000,           // → km
movingTime: a.moving_time,              // seconds
elevation: a.total_elevation_gain,
avgHR:     a.average_heartrate || 0,
maxHR:     a.max_heartrate || 0,
pace:      a.moving_time / (a.distance / 1000), // sec/km
avgSpeed:  a.average_speed,
}))
.filter(a => a.distance > 0.1)
.sort((a, b) => b.date - a.date);
}

// ─── APP INIT ─────────────────────────────────────────────────────────────────
function initApp() {
// Athlete header
const stored = JSON.parse(localStorage.getItem(‘strava_token’));
const ath    = stored?.athlete || athlete;
if (ath) {
document.getElementById(‘athlete-name’).textContent = `${ath.firstname || ''} ${ath.lastname || ''}`.trim();
document.getElementById(‘athlete-meta’).textContent = `${activities.length} Läufe analysiert`;
if (ath.profile_medium || ath.profile) {
document.getElementById(‘athlete-avatar’).src = ath.profile_medium || ath.profile;
}
}

// Year filter
const years = […new Set(activities.map(a => a.date.getFullYear()))].sort((a,b) => b-a);
const sel   = document.getElementById(‘filter-year’);
years.forEach(y => { const o = document.createElement(‘option’); o.value=y; o.textContent=y; sel.appendChild(o); });

// Plan input listeners
[‘p-hours’,‘p-min’,‘p-sec’].forEach(id => document.getElementById(id).addEventListener(‘input’, updateGoBtn));

renderOverview();
renderActivities();
renderCharts();
renderPRs();
show(‘app’);
}

// ─── OVERVIEW ─────────────────────────────────────────────────────────────────
function renderOverview() {
const now   = Date.now();
const last7  = activities.filter(a => (now - a.date) / 86400000 <= 7);
const last30 = activities.filter(a => (now - a.date) / 86400000 <= 30);
const prev30 = activities.filter(a => { const d=(now-a.date)/86400000; return d>30&&d<=60; });

const km30   = last30.reduce((s,a)=>s+a.distance,0);
const pKm30  = prev30.reduce((s,a)=>s+a.distance,0);
const diff   = pKm30 > 0 ? ((km30-pKm30)/pKm30*100).toFixed(0) : null;
const avgPace = last30.length ? last30.reduce((s,a)=>s+a.pace,0)/last30.length : 0;

document.getElementById(‘stat-grid’).innerHTML = ` <div class="stat-card"><div class="stat-lbl">Km diese Woche</div><div class="stat-val">${last7.reduce((s,a)=>s+a.distance,0).toFixed(1)}</div><div class="stat-unit">km</div></div> <div class="stat-card"><div class="stat-lbl">Km (30 Tage)</div><div class="stat-val">${km30.toFixed(0)}</div><div class="stat-unit">km ${diff!==null?`<span style="color:${diff>=0?'var(--green)':'var(--red)'}">${diff>=0?‘↑’:‘↓’}${Math.abs(diff)}%</span>`:''}</div></div> <div class="stat-card"><div class="stat-lbl">Ø Pace (30T)</div><div class="stat-val">${fmtPace(avgPace)}</div><div class="stat-unit">min/km</div></div> <div class="stat-card"><div class="stat-lbl">Gesamt-Läufe</div><div class="stat-val">${activities.length}</div><div class="stat-unit">alle Zeiten</div></div> <div class="stat-card"><div class="stat-lbl">Gesamt-Km</div><div class="stat-val">${(activities.reduce((s,a)=>s+a.distance,0)/1000).toFixed(1)}k</div><div class="stat-unit">km gesamt</div></div> <div class="stat-card"><div class="stat-lbl">Ø Km/Woche</div><div class="stat-val">${(km30/4).toFixed(0)}</div><div class="stat-unit">km</div></div> <div class="stat-card"><div class="stat-lbl">Höhenmeter (30T)</div><div class="stat-val">${last30.reduce((s,a)=>s+a.elevation,0).toFixed(0)}</div><div class="stat-unit">m</div></div> <div class="stat-card"><div class="stat-lbl">Zeit (30T)</div><div class="stat-val">${Math.floor(last30.reduce((s,a)=>s+a.movingTime,0)/3600)}</div><div class="stat-unit">Stunden</div></div> `;

document.getElementById(‘recent-runs’).innerHTML = activities.slice(0,8).map(actRow).join(’’);
renderWeeklyChart();
}

function actRow(a) {
const pc = a.pace < 300 ? ‘pb-fast’ : a.pace < 360 ? ‘pb-mid’ : ‘pb-slow’;
return `<div class="act-row"> <div class="act-left"><div class="act-name">${a.name}</div><div class="act-date">${fmtDate(a.date)}</div></div> <div class="act-right"> <div class="act-stat"><div class="act-stat-val">${a.distance.toFixed(2)}</div><div class="act-stat-lbl">km</div></div> <div class="act-stat"><div class="act-stat-val"><span class="pace-badge ${pc}">${fmtPace(a.pace)}</span></div><div class="act-stat-lbl">/km</div></div> <div class="act-stat"><div class="act-stat-val">${fmtTime(a.movingTime)}</div><div class="act-stat-lbl">Zeit</div></div> ${a.avgHR>0?`<div class="act-stat"><div class="act-stat-val">${a.avgHR.toFixed(0)}</div><div class="act-stat-lbl">HF</div></div>`:’’}
</div>

  </div>`;
}

function renderWeeklyChart() {
const weeks = {};
activities.forEach(a => {
const k = getMonday(a.date).toISOString().slice(0,10);
weeks[k] = (weeks[k]||0) + a.distance;
});
const sorted = Object.keys(weeks).sort().slice(-16);
if (charts.weekly) charts.weekly.destroy();
charts.weekly = new Chart(document.getElementById(‘weeklyChart’), {
type: ‘bar’,
data: { labels: sorted.map(w => { const d=new Date(w); return `${d.getDate()}.${d.getMonth()+1}.`; }),
datasets: [{ data: sorted.map(w => +weeks[w].toFixed(1)), backgroundColor: sorted.map(w=>weeks[w]>60?’#FC4C02’:‘rgba(252,76,2,0.4)’), borderRadius: 5 }] },
options: chartOpts()
});
}

// ─── ACTIVITIES ───────────────────────────────────────────────────────────────
function renderActivities() {
const year = document.getElementById(‘filter-year’).value;
const sort = document.getElementById(‘sort-by’).value;
let acts   = year ? activities.filter(a => a.date.getFullYear()==year) : […activities];
if (sort===‘distance’) acts.sort((a,b) => b.distance-a.distance);
else if (sort===‘pace’) acts.sort((a,b) => a.pace-b.pace);
document.getElementById(‘all-activities’).innerHTML = acts.map(actRow).join(’’);
}

// ─── CHARTS ───────────────────────────────────────────────────────────────────
function renderCharts() {
// Pace chart
const pd = activities.slice(0,60).reverse();
if (charts.pace) charts.pace.destroy();
charts.pace = new Chart(document.getElementById(‘paceChart’), {
type: ‘line’,
data: { labels: pd.map(a=>`${a.date.getDate()}.${a.date.getMonth()+1}.`),
datasets: [{ data: pd.map(a=>+(a.pace/60).toFixed(2)), borderColor:’#FC4C02’, backgroundColor:‘rgba(252,76,2,0.08)’, tension:0.4, fill:true, pointRadius:3 }] },
options: { …chartOpts(), scales: { x:{ticks:{color:’#555’,font:{size:11}},grid:{color:’#1e1e1e’}}, y:{reverse:true,ticks:{color:’#555’,font:{size:11},callback:v=>fmtPace(v*60)},grid:{color:’#1e1e1e’}} } }
});

// Monthly
const months = {};
activities.forEach(a => { const k=`${a.date.getFullYear()}-${String(a.date.getMonth()+1).padStart(2,'0')}`; months[k]=(months[k]||0)+a.distance; });
const sm = Object.keys(months).sort().slice(-18);
if (charts.monthly) charts.monthly.destroy();
charts.monthly = new Chart(document.getElementById(‘monthlyChart’), {
type:‘bar’,
data:{ labels:sm.map(m=>{const[y,mo]=m.split(’-’);return`${mo}/${y.slice(2)}`;}),
datasets:[{data:sm.map(m=>+months[m].toFixed(1)),backgroundColor:‘rgba(252,76,2,0.55)’,borderRadius:4}] },
options: chartOpts()
});

// Dist distribution
const bk={’<5km’:0,‘5–10’:0,‘10–15’:0,‘15–21’:0,‘HM+’:0,‘42+’:0};
activities.forEach(a=>{
if(a.distance<5)bk[’<5km’]++;else if(a.distance<10)bk[‘5–10’]++;
else if(a.distance<15)bk[‘10–15’]++;else if(a.distance<21.1)bk[‘15–21’]++;
else if(a.distance<30)bk[‘HM+’]++;else bk[‘42+’]++;
});
if (charts.dist) charts.dist.destroy();
charts.dist = new Chart(document.getElementById(‘distChart’), {
type:‘doughnut’,
data:{labels:Object.keys(bk),datasets:[{data:Object.values(bk),backgroundColor:[’#FC4C02’,’#ff7043’,’#fbbf24’,’#4ade80’,’#60a5fa’,’#a78bfa’],borderWidth:0}]},
options:{plugins:{legend:{labels:{color:’#888’,font:{size:12}}}},maintainAspectRatio:false}
});

// HR Zones (age 48 → max HR ~172)
const maxHR = 172;
const zones = {1:0,2:0,3:0,4:0,5:0};
let hasHR   = false;
activities.forEach(a => {
if (a.avgHR > 0) { hasHR=true; const p=a.avgHR/maxHR;
if(p<0.6)zones[1]++;else if(p<0.7)zones[2]++;else if(p<0.8)zones[3]++;else if(p<0.9)zones[4]++;else zones[5]++; }
});
const card = document.getElementById(‘hr-zone-card’);
if (hasHR) {
const total = Object.values(zones).reduce((s,v)=>s+v,0);
const colors = [’#60a5fa’,’#4ade80’,’#fbbf24’,’#f87171’,’#a78bfa’];
const names  = [‘Zone 1 Erholung’,‘Zone 2 Grundlage’,‘Zone 3 Tempo’,‘Zone 4 Schwelle’,‘Zone 5 Max’];
card.innerHTML = ` <div class="zone-bar">${[1,2,3,4,5].map((z,i)=>`<div class="zone-seg" style="width:${(zones[z]/total*100).toFixed(1)}%;background:${colors[i]}"></div>`).join('')}</div> <div class="zone-legend">${[1,2,3,4,5].map((z,i)=>`<div class="zone-item"><div class="zone-dot" style="background:${colors[i]}"></div>${names[i]}: ${(zones[z]/total*100).toFixed(0)}%</div>`).join('')}</div> `;
} else {
card.innerHTML = ‘<div class="empty">Keine Herzfrequenzdaten gefunden — bitte mit Pulsuhr laufen.</div>’;
}
}

// ─── PLAN ─────────────────────────────────────────────────────────────────────
function selectDist(km, el) {
planDist = km;
document.querySelectorAll(’.dist-btn’).forEach(b=>b.classList.remove(‘active’));
el.classList.add(‘active’);
const defaults = {5:[0,20,0],10:[0,40,0],21.1:[1,40,0],42.2:[3,30,0]};
const [h,m,s] = defaults[km]||[0,30,0];
document.getElementById(‘p-hours’).value = h||’’;
document.getElementById(‘p-min’).value   = m;
document.getElementById(‘p-sec’).value   = s||’’;
updateGoBtn();
}

function updateGoBtn() {
const h=parseInt(document.getElementById(‘p-hours’).value)||0;
const m=parseInt(document.getElementById(‘p-min’).value)||0;
const s=parseInt(document.getElementById(‘p-sec’).value)||0;
document.getElementById(‘go-btn’).disabled = !(planDist && (h*3600+m*60+s)>0);
}

function buildPlan() {
const h=parseInt(document.getElementById(‘p-hours’).value)||0;
const m=parseInt(document.getElementById(‘p-min’).value)||0;
const s=parseInt(document.getElementById(‘p-sec’).value)||0;
planTarget  = h*3600+m*60+s;
weekOffset  = 0;
const label = planDist===21.1?‘Halbmarathon’:planDist===42.2?‘Marathon’:`${planDist}K`;
document.getElementById(‘plan-dist-label’).textContent = label;
document.getElementById(‘plan-goal-sub’).textContent   = `Ziel: ${fmtTime(planTarget)}`;
renderGoalProgress();
renderPlanWeek();
renderThisWeekRuns();
document.getElementById(‘plan-setup’).style.display = ‘none’;
document.getElementById(‘plan-view’).style.display  = ‘block’;
}

function resetPlan() {
document.getElementById(‘plan-setup’).style.display = ‘block’;
document.getElementById(‘plan-view’).style.display  = ‘none’;
}

function renderGoalProgress() {
const best = getBestTime(planDist);
const pct  = best ? Math.min(100,(planTarget/best)*100) : 0;
const gap  = best ? best-planTarget : null;
let gapText = gap===null ? ‘Noch keine Vergleichsaktivität — leg los!’ :
gap<=0    ? `🎉 Ziel bereits erreicht! Bestzeit: ${fmtTime(best)}` :
`Noch ${fmtTime(gap)} bis zum Ziel`;
document.getElementById(‘goal-progress-card’).innerHTML = `<div class="gp-row"> <div class="gp-block"><div class="gp-val">${best?fmtTime(best):'—'}</div><div class="gp-lbl">Aktuelle Bestzeit</div></div> <div class="gp-block" style="text-align:right"><div class="gp-val" style="color:var(--orange)">${fmtTime(planTarget)}</div><div class="gp-lbl">Dein Ziel</div></div> </div> <div class="gp-bar"><div class="gp-fill" style="width:${pct.toFixed(1)}%"></div></div> <div class="gp-pct">${pct.toFixed(0)}% des Ziels erreicht</div> <div class="gp-gap">${gapText}</div>`;
}

function renderThisWeekRuns() {
const monday = getWeekMonday(weekOffset);
const sunday = new Date(monday); sunday.setDate(monday.getDate()+6); sunday.setHours(23,59,59);
const runs   = activities.filter(a=>a.date>=monday&&a.date<=sunday);
document.getElementById(‘plan-this-week’).innerHTML =
runs.length ? runs.map(actRow).join(’’) : ‘<div class="empty">Noch keine Läufe diese Woche.</div>’;
}

function renderPlanWeek() {
const monday  = getWeekMonday(weekOffset);
const today   = new Date(); today.setHours(0,0,0,0);
const days    = [‘Mo’,‘Di’,‘Mi’,‘Do’,‘Fr’,‘Sa’,‘So’];
const sessions = generateWeek(planDist, planTarget, weekOffset);

if (weekOffset===0) document.getElementById(‘wk-label’).textContent = ‘DIESE WOCHE’;
else if(weekOffset===1) document.getElementById(‘wk-label’).textContent = ‘NÄCHSTE WOCHE’;
else if(weekOffset===-1) document.getElementById(‘wk-label’).textContent = ‘LETZTE WOCHE’;
else { const e=new Date(monday); e.setDate(e.getDate()+6); document.getElementById(‘wk-label’).textContent=`${fmtDateShort(monday)}–${fmtDateShort(e)}`; }

document.getElementById(‘plan-sessions’).innerHTML = sessions.map((s,i) => {
const day     = new Date(monday); day.setDate(monday.getDate()+i);
const isToday = day.getTime()===today.getTime();
const dayRuns = activities.filter(a=>{ const d=new Date(a.date); d.setHours(0,0,0,0); return d.getTime()===day.getTime(); });
const done    = dayRuns.length>0 && s.type!==‘rest’;
return `<div class="session ${s.type==='rest'?'rest':''} ${isToday?'today':''} ${done?'done':''}"> <div class="s-day"> <div class="s-daynum">${day.getDate()}</div> <div class="s-dayname">${days[i]}</div> ${isToday?'<div class="s-today-dot"></div>':''} </div> <div> <div class="s-type ${s.type}">${done?'✓ ':''}${s.typeLabel}</div> <div class="s-title">${s.title}</div> <div class="s-desc">${s.desc}</div> <div class="s-chips"> ${s.dist?`<span class="chip chip-dist">${s.dist}</span>`:''} ${s.pace?`<span class="chip chip-pace">⚡ ${s.pace}</span>`:''} ${done?`<span class="chip chip-done">✓ ${dayRuns[0].distance.toFixed(1)} km</span>`:''} </div> </div> </div>`;
}).join(’’);
}

function changeWeek(d) {
weekOffset += d;
renderPlanWeek();
renderThisWeekRuns();
}

function generateWeek(dist, target, offset) {
const tp   = target / dist;              // target pace sec/km
const easy = tp * 1.20;
const tempo= tp * 1.05;
const intv = tp * 0.93;
const lng  = tp * 1.15;

const recent  = activities.filter(a=>(Date.now()-a.date)/86400000<=28);
const baseKm  = Math.max(20, recent.reduce((s,a)=>s+a.distance,0)/4);
const wKm     = Math.min(baseKm*(1+offset*0.05), baseKm*1.3);

const plans = {
5: [
{type:‘easy’,    typeLabel:‘Locker’,     title:‘Lockerer Dauerlauf’,  desc:‘Ruhig einlaufen, Nasenatmung.’, dist:`${(wKm*.20).toFixed(1)} km`, pace:`${fmtPace(easy)}/km`},
{type:‘interval’,typeLabel:‘Intervall’,  title:‘10 × 400m’,           desc:‘10 Min einlaufen · 10×400m schnell, 90 Sek. Trabpause · 10 Min auslaufen.’, dist:`${(wKm*.20).toFixed(1)} km`, pace:`${fmtPace(intv)}/km`},
{type:‘rest’,    typeLabel:‘Ruhetag’,    title:‘Aktive Erholung’,     desc:‘Kein Laufen. Stretching oder Spazieren.’, dist:null, pace:null},
{type:‘tempo’,   typeLabel:‘Tempo’,      title:‘Tempodauerlauf’,      desc:`2 km ein · ${(wKm*.15).toFixed(1)} km Tempopace · 2 km aus.`, dist:`${(wKm*.25).toFixed(1)} km`, pace:`${fmtPace(tempo)}/km`},
{type:‘rest’,    typeLabel:‘Ruhetag’,    title:‘Erholung’,            desc:‘Beine schonen.’, dist:null, pace:null},
{type:‘long’,    typeLabel:‘Langer Lauf’,title:‘Langer Lauf’,        desc:‘Gleichmäßig. Letztes Drittel etwas schneller.’, dist:`${(wKm*.30).toFixed(1)} km`, pace:`${fmtPace(lng)}/km`},
{type:‘rest’,    typeLabel:‘Ruhetag’,    title:‘Wochenabschluss’,     desc:‘Regeneration, Schlafen, Dehnen.’, dist:null, pace:null}
],
10: [
{type:‘easy’,    typeLabel:‘Locker’,     title:‘Regenerationslauf’,   desc:‘Sehr locker, HF unter 140.’, dist:`${(wKm*.15).toFixed(1)} km`, pace:`${fmtPace(easy)}/km`},
{type:‘interval’,typeLabel:‘Intervall’,  title:‘6 × 800m’,            desc:‘10 Min ein · 6×800m schnell, 400m Trabpause · 10 Min aus.’, dist:`${(wKm*.20).toFixed(1)} km`, pace:`${fmtPace(intv)}/km`},
{type:‘easy’,    typeLabel:‘Locker’,     title:‘Mittellauf locker’,   desc:‘Ruhig, Fokus Lauftechnik.’, dist:`${(wKm*.15).toFixed(1)} km`, pace:`${fmtPace(easy)}/km`},
{type:‘tempo’,   typeLabel:‘Tempo’,      title:‘Schwellenlauf’,       desc:`2 km ein · ${(wKm*.20).toFixed(1)} km Schwellentempo · 2 km aus.`, dist:`${(wKm*.28).toFixed(1)} km`, pace:`${fmtPace(tempo)}/km`},
{type:‘rest’,    typeLabel:‘Ruhetag’,    title:‘Ruhe’,                desc:‘Erholung ist auch Training.’, dist:null, pace:null},
{type:‘long’,    typeLabel:‘Langer Lauf’,title:‘Langer Lauf’,        desc:`${(wKm*.35).toFixed(1)} km gleichmäßig, letzte 3 km im 10K-Pace.`, dist:`${(wKm*.35).toFixed(1)} km`, pace:`${fmtPace(lng)}/km`},
{type:‘rest’,    typeLabel:‘Ruhetag’,    title:‘Wochenabschluss’,     desc:‘Regeneration.’, dist:null, pace:null}
],
21.1: [
{type:‘easy’,    typeLabel:‘Locker’,     title:‘Lockerer Dauerlauf’,  desc:‘Sehr locker, HF unter 140.’, dist:`${(wKm*.15).toFixed(1)} km`, pace:`${fmtPace(easy)}/km`},
{type:‘tempo’,   typeLabel:‘HM-Pace’,    title:‘Wettkampftempo-Lauf’, desc:`3 km ein · ${(wKm*.18).toFixed(1)} km exakt im HM-Tempo · 2 km aus.`, dist:`${(wKm*.25).toFixed(1)} km`, pace:`${fmtPace(tempo)}/km`},
{type:‘easy’,    typeLabel:‘Locker’,     title:‘Techniklauf’,         desc:‘Locker, Schrittfrequenz ~180spm.’, dist:`${(wKm*.12).toFixed(1)} km`, pace:`${fmtPace(easy)}/km`},
{type:‘interval’,typeLabel:‘Intervall’,  title:‘4 × 2km Schwelle’,   desc:‘10 Min ein · 4×2km an der Schwelle, 90 Sek. Pause · 10 Min aus.’, dist:`${(wKm*.25).toFixed(1)} km`, pace:`${fmtPace(intv)}/km`},
{type:‘rest’,    typeLabel:‘Ruhetag’,    title:‘Ruhe’,                desc:‘Beine schonen vor dem langen Lauf.’, dist:null, pace:null},
{type:‘long’,    typeLabel:‘Langer Lauf’,title:‘Langer Lauf’,        desc:`${(wKm*.35).toFixed(1)} km ruhig, letzten 5 km im HM-Pace. Verpflegung üben!`, dist:`${(wKm*.35).toFixed(1)} km`, pace:`${fmtPace(lng)}/km`},
{type:‘rest’,    typeLabel:‘Ruhetag’,    title:‘Wochenabschluss’,     desc:‘Früh schlafen, gut essen.’, dist:null, pace:null}
],
42.2: [
{type:‘easy’,    typeLabel:‘Locker’,     title:‘Regenerationslauf’,   desc:‘Sehr locker, HF unter 135.’, dist:`${(wKm*.12).toFixed(1)} km`, pace:`${fmtPace(easy)}/km`},
{type:‘interval’,typeLabel:‘Intervall’,  title:‘5 × 1km Intervalle’, desc:‘10 Min ein · 5×1km HM-Tempo, 2 Min Pause · 10 Min aus.’, dist:`${(wKm*.18).toFixed(1)} km`, pace:`${fmtPace(intv)}/km`},
{type:‘easy’,    typeLabel:‘Locker’,     title:‘Mittellauf’,          desc:‘Locker und fließend.’, dist:`${(wKm*.15).toFixed(1)} km`, pace:`${fmtPace(easy)}/km`},
{type:‘tempo’,   typeLabel:‘MP-Lauf’,    title:‘Marathon-Pace Lauf’, desc:`3 km ein · ${(wKm*.20).toFixed(1)} km Marathon-Tempo · 3 km aus.`, dist:`${(wKm*.30).toFixed(1)} km`, pace:`${fmtPace(tempo)}/km`},
{type:‘rest’,    typeLabel:‘Ruhetag’,    title:‘Ruhe’,                desc:‘Beine hochlegen.’, dist:null, pace:null},
{type:‘long’,    typeLabel:‘Langer Lauf’,title:‘Langer Lauf’,        desc:`${(wKm*.38).toFixed(1)} km gleichmäßig. Gel & Verpflegung testen!`, dist:`${(wKm*.38).toFixed(1)} km`, pace:`${fmtPace(lng)}/km`},
{type:‘rest’,    typeLabel:‘Ruhetag’,    title:‘Wochenabschluss’,     desc:‘Mental & körperlich auftanken.’, dist:null, pace:null}
]
};
const key = dist<=5?5:dist<=10?10:dist<=21.1?21.1:42.2;
return plans[key];
}

function getBestTime(dist) {
const tol = dist<10?0.4:dist<15?0.8:1.5;
const c   = activities.filter(a=>Math.abs(a.distance-dist)<=tol&&a.pace>0);
if (!c.length) return null;
return Math.min(…c.map(a=>a.pace*dist));
}

// ─── PRS ──────────────────────────────────────────────────────────────────────
function renderPRs() {
const dists  = [1,5,10,21.1,42.2];
const labels = [‘1K’,‘5K’,‘10K’,‘Halbmarathon’,‘Marathon’];
const prs    = dists.map((d,i)=>{
const t = getBestTime(d);
return t ? {label:labels[i],time:t,date:getBestDate(d)} : null;
}).filter(Boolean);

document.getElementById(‘pr-grid’).innerHTML = prs.map(p=>`<div class="pr-card"> <div class="pr-dist">${p.label}</div> <div class="pr-time">${fmtTime(p.time)}</div> <div class="pr-date">${p.date?fmtDate(p.date):''}</div> </div>`).join(’’);

// 5K trend
const runs5k = activities.filter(a=>Math.abs(a.distance-5)<=0.3&&a.pace>0).slice(0,30).reverse();
if (charts.pr) charts.pr.destroy();
if (runs5k.length>2) {
charts.pr = new Chart(document.getElementById(‘prChart’),{
type:‘line’,
data:{
labels:runs5k.map(a=>`${a.date.getDate()}.${a.date.getMonth()+1}.${a.date.getFullYear()}`),
datasets:[
{label:‘5K Pace’,data:runs5k.map(a=>+(a.pace/60).toFixed(2)),borderColor:’#FC4C02’,backgroundColor:‘rgba(252,76,2,0.08)’,tension:0.4,fill:true,pointRadius:4},
{label:‘Ziel 4:00’,data:runs5k.map(()=>4),borderColor:’#4ade80’,borderDash:[5,5],pointRadius:0}
]
},
options:{…chartOpts(),scales:{x:{ticks:{color:’#555’,font:{size:11}},grid:{color:’#1e1e1e’}},y:{reverse:true,ticks:{color:’#555’,callback:v=>fmtPace(v*60)},grid:{color:’#1e1e1e’}}}}
});
} else {
document.getElementById(‘prChart’).parentElement.innerHTML=’<div class="empty">Nicht genug 5K-Läufe vorhanden.</div>’;
}
}

function getBestDate(dist) {
const tol = dist<10?0.4:dist<15?0.8:1.5;
const c   = activities.filter(a=>Math.abs(a.distance-dist)<=tol&&a.pace>0);
if (!c.length) return null;
return c.reduce((b,a)=>a.pace<b.pace?a:b).date;
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function switchTab(el) {
document.querySelectorAll(’.tab’).forEach(t=>t.classList.remove(‘active’));
document.querySelectorAll(’.tab-content’).forEach(t=>t.classList.remove(‘active’));
el.classList.add(‘active’);
document.getElementById(‘tab-’+el.dataset.tab).classList.add(‘active’);
}

function show(name) {
document.getElementById(‘screen-login’).style.display   = name===‘login’   ? ‘flex’  : ‘none’;
document.getElementById(‘screen-loading’).style.display = name===‘loading’ ? ‘flex’  : ‘none’;
document.getElementById(‘screen-app’).style.display     = name===‘app’     ? ‘block’ : ‘none’;
}

function setSpinText(t) { document.getElementById(‘spin-text’).textContent = t; }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

function getMonday(d) {
const r=new Date(d); r.setHours(0,0,0,0);
const day=r.getDay()||7; r.setDate(r.getDate()-(day-1)); return r;
}
function getWeekMonday(offset=0) {
const n=new Date(); n.setHours(0,0,0,0);
const day=n.getDay()||7; n.setDate(n.getDate()-(day-1)+offset*7); return n;
}

function fmtPace(s) {
if(!s||s<=0) return ‘–:–’;
return `${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
}
function fmtTime(s) {
if(!s||s<=0) return ‘–’;
const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.round(s%60);
return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;
}
function fmtDate(d)      { return `${d.getDate()}.${d.getMonth()+1}.${d.getFullYear()}`; }
function fmtDateShort(d) { return `${d.getDate()}.${d.getMonth()+1}.`; }

function chartOpts() {
return {
responsive:true, maintainAspectRatio:false,
plugins:{legend:{display:false}},
scales:{
x:{ticks:{color:’#555’,font:{size:11},maxRotation:45},grid:{color:’#1e1e1e’}},
y:{ticks:{color:’#555’,font:{size:11}},grid:{color:’#1e1e1e’}}
}
};
}
