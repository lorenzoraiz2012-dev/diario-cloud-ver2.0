// ============================================================
//  IMPORTANTE: prima di usare l'app, vai su Firebase Console →
//  Realtime Database → Regole, e imposta:
//  { "rules": { "utenti": { "$uid": { ".read": true, ".write": true } } } }
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase, ref, get, set, push, onValue, update, remove
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ── CONFIGURAZIONE FIREBASE ──────────────────────────────────
const firebaseConfig = {
  apiKey:            'AIzaSyBLPEAIdG8yHTkhlxCg84kgXTbORK7GG2w',
  authDomain:        'diario-scolastico-cfd88.firebaseapp.com',
  projectId:         'diario-scolastico-cfd88',
  storageBucket:     'diario-scolastico-cfd88.firebasestorage.app',
  messagingSenderId: '826560545383',
  appId:             '1:826560545383:web:aa9471e480f1d7aa9bcac2',
  databaseURL:       'https://diario-scolastico-cfd88-default-rtdb.europe-west1.firebasedatabase.app'
};

const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp, "https://diario-scolastico-cfd88-default-rtdb.europe-west1.firebasedatabase.app/");

// ── MATERIE ──────────────────────────────────────────────────
const MATERIE = [
  'Algebra','Geometria','Scienze','Italiano','Storia','Geografia',
  'Inglese','Tedesco','Religione','Educazione Civica','Tecnologia',
  'Arte','Musica','Motoria','Certificazioni Linguistica','Laboratori','Evento'
];

// ── COLORI PASTELLO (deterministici) ────────────────────────
const COLORS = [
  { bg:'#FFD6D6', text:'#7a2020' }, { bg:'#FFE5CC', text:'#7a4e20' },
  { bg:'#FEFEC8', text:'#5e5a10' }, { bg:'#D6FFD6', text:'#1a6020' },
  { bg:'#CCE5FF', text:'#1a4070' }, { bg:'#E5CCFF', text:'#4a2070' },
  { bg:'#FFD6F0', text:'#7a2060' }, { bg:'#D6F0FF', text:'#1a4070' },
  { bg:'#D6FFE5', text:'#1a6040' }, { bg:'#F0D6FF', text:'#5a2070' },
  { bg:'#FFD6E0', text:'#7a2040' }, { bg:'#D6FFFA', text:'#1a6060' },
];

function hashColor(str) {
  let h = 0;
  for (const c of str) h = (h << 5) - h + c.charCodeAt(0);
  return COLORS[Math.abs(h) % COLORS.length];
}

// ── STATO GLOBALE ────────────────────────────────────────────
let currentUser   = null; // { nome, pin, key }
let diarioData    = {};   // { [fbId]: { materia, data, tipo, descrizione, completato, studiato } }
let votiData      = {};   // { [fbId]: { materia, voto } }
let activeTab     = 'home';
let searchQuery   = '';
let unsubDiario   = null;
let unsubVoti     = null;

// ── UTILITÀ GENERALI ─────────────────────────────────────────
function getUserKey(nome, pin) {
  return nome.toLowerCase().trim().replace(/[^a-z0-9]/gi, '_') + '_' + pin.trim();
}

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isPast(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d < today();
}

const MONTHS_IT = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d)} ${MONTHS_IT[parseInt(m)-1]} ${y}`;
}

function getMediaClass(v) {
  if (v >= 8.5) return 'green';
  if (v >= 7)   return 'blue';
  if (v >= 6)   return 'yellow';
  return 'red';
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

// ── SESSION ──────────────────────────────────────────────────
function saveSession(user) {
  localStorage.setItem('diario_session', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('diario_session');
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('diario_session')); } catch { return null; }
}

// ── AUTH ─────────────────────────────────────────────────────
async function doLogin(nome, pin) {
  if (!nome.trim() || !pin.trim()) return 'Inserisci nome e PIN.';
  const key = getUserKey(nome, pin);
  try {
    const snap = await get(ref(db, `utenti/${key}/info`));
    if (!snap.exists()) return 'Account non trovato. Usa "Crea Account" per registrarti.';
    const user = { nome: nome.trim(), pin, key };
    saveSession(user);
    return null; // success
  } catch (e) {
    return 'Errore di connessione. Controlla la tua rete e riprova.';
  }
}

async function doRegister(nome, pin) {
  if (!nome.trim() || !pin.trim()) return 'Inserisci nome e PIN.';
  if (pin.length < 4) return 'Il PIN deve avere almeno 4 cifre.';
  const key = getUserKey(nome, pin);
  try {
    const snap = await get(ref(db, `utenti/${key}/info`));
    if (snap.exists()) return 'Account già registrato con questo nome e PIN. Prova ad accedere.';
    await set(ref(db, `utenti/${key}/info`), { nome: nome.trim(), createdAt: Date.now() });
    const user = { nome: nome.trim(), pin, key };
    saveSession(user);
    return null;
  } catch (e) {
    return 'Errore di connessione. Controlla la tua rete e riprova.';
  }
}

// ── FIREBASE CRUD ────────────────────────────────────────────
async function addDiarioItem(data) {
  await push(ref(db, `utenti/${currentUser.key}/diario`), {
    ...data, completato: false, studiato: false
  });
}

async function toggleDiario(id, field) {
  const cur = diarioData[id];
  await update(ref(db, `utenti/${currentUser.key}/diario/${id}`), {
    [field]: !cur[field]
  });
}

async function deleteDiario(id) {
  await remove(ref(db, `utenti/${currentUser.key}/diario/${id}`));
}

async function addVoto(materia, voto) {
  await push(ref(db, `utenti/${currentUser.key}/voti`), { materia, voto });
}

async function deleteVoto(id) {
  await remove(ref(db, `utenti/${currentUser.key}/voti/${id}`));
}

// ── SUBSCRIPTIONS ─────────────────────────────────────────────
function subscribe() {
  unsubDiario = onValue(ref(db, `utenti/${currentUser.key}/diario`), snap => {
    diarioData = snap.val() || {};
    renderHome();
  });
  unsubVoti = onValue(ref(db, `utenti/${currentUser.key}/voti`), snap => {
    votiData = snap.val() || {};
    renderVoti();
  });
}

function unsubscribe() {
  if (unsubDiario) { unsubDiario(); unsubDiario = null; }
  if (unsubVoti)   { unsubVoti();   unsubVoti   = null; }
}

// ── RENDER: HOME ─────────────────────────────────────────────
function renderHome() {
  const t = today();
  let todo = 0, done = 0;
  const items = [];

  for (const [id, item] of Object.entries(diarioData)) {
    const itemDate = new Date(item.data + 'T00:00:00');
    const past     = itemDate < t;

    if (item.tipo === 'Compito') {
      item.completato ? done++ : todo++;
    } else {
      past ? done++ : todo++;
    }

    // Logica visibilità
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      item.materia.toLowerCase().includes(q) ||
      item.descrizione.toLowerCase().includes(q);

    if (!matchSearch) continue;
    if (item.tipo === 'Compito' && item.completato) continue;
    if ((item.tipo === 'Verifica' || item.tipo === 'Evento') && past) continue;

    items.push({ id, ...item });
  }

  // Ordina per data
  items.sort((a, b) => new Date(a.data) - new Date(b.data));

  // Statistiche
  document.getElementById('stat-todo').textContent = todo;
  document.getElementById('stat-done').textContent = done;

  // Contatore risultati
  const countEl = document.getElementById('items-count');
  countEl.textContent = items.length > 0 ? `${items.length} risultat${items.length === 1 ? 'o' : 'i'}` : '';

  // Lista
  const list = document.getElementById('diario-list');

  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
        </div>
        <h3>${searchQuery ? 'Nessun risultato' : 'Tutto pulito!'}</h3>
        <p>${searchQuery ? 'Prova altri termini di ricerca.' : 'Aggiungi un impegno con il "+".'}</p>
      </div>`;
    return;
  }

  list.innerHTML = items.map(item => buildCard(item)).join('');
}

function buildCard(item) {
  const col   = hashColor(item.materia);
  const isC   = item.tipo === 'Compito';
  const isV   = item.tipo === 'Verifica';

  const checkHtml = isC ? `
    <button class="checkbox-btn ${item.completato ? 'checked' : ''}"
      onclick="handleToggle('${item.id}','completato')" title="Segna come completato">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
    </button>` : isV ? `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
      <button class="checkbox-btn square ${item.studiato ? 'checked' : ''}"
        onclick="handleToggle('${item.id}','studiato')" title="Segna come studiato">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      ${item.studiato ? '<span class="studiato-label">Studiato</span>' : ''}
    </div>` : `
    <div class="event-icon">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    </div>`;

  const badgeStudiato = (isV && item.studiato)
    ? '<span class="badge-studiato">STUDIATO</span>'
    : '';

  return `
    <div class="diario-card ${isV && item.studiato ? 'studiato-card' : ''}">
      <div class="card-action">${checkHtml}</div>
      <div class="card-body">
        <div class="card-badges">
          <span class="badge-materia" style="background:${col.bg};color:${col.text}">${item.materia}</span>
          <span class="badge-tipo">${item.tipo}</span>
          ${badgeStudiato}
        </div>
        <div class="card-desc ${item.completato ? 'completed-text' : ''}">${item.descrizione}</div>
        <div class="card-footer">
          <div class="card-date">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${fmtDate(item.data)}
          </div>
          <button class="btn-delete" onclick="handleDeleteDiario('${item.id}')" title="Elimina">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

// ── RENDER: VOTI ─────────────────────────────────────────────
function renderVoti() {
  const grouped = {};
  for (const [id, v] of Object.entries(votiData)) {
    if (!grouped[v.materia]) grouped[v.materia] = [];
    grouped[v.materia].push({ id, voto: Number(v.voto) });
  }

  const materie = Object.keys(grouped).sort();

  // Media generale
  const mediaEl = document.getElementById('media-generale');
  if (materie.length === 0) {
    mediaEl.textContent = '—';
    mediaEl.style.color = '';
  } else {
    const totale = materie.reduce((sum, m) => {
      const voti = grouped[m].map(v => v.voto);
      return sum + voti.reduce((a, b) => a + b, 0) / voti.length;
    }, 0) / materie.length;
    mediaEl.textContent = totale.toFixed(2);
  }

  const grid = document.getElementById('voti-grid');
  if (materie.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </div>
        <h3>Nessun voto</h3>
        <p>Inizia ad aggiungere i tuoi voti per calcolare le medie.</p>
      </div>`;
    return;
  }

  grid.innerHTML = materie.map(materia => {
    const entries = grouped[materia];
    const voti    = entries.map(e => e.voto);
    const media   = voti.reduce((a, b) => a + b, 0) / voti.length;
    const cls     = getMediaClass(media);

    const chips = entries
      .sort((a, b) => b.voto - a.voto)
      .map(e => `<span class="voto-chip" onclick="handleDeleteVoto('${e.id}',${e.voto})">${e.voto}</span>`)
      .join('');

    return `
      <div class="voto-card">
        <div class="voto-card-header">
          <div class="voto-materia-name">${materia}</div>
          <div class="voto-media ${cls}">${media.toFixed(2)}</div>
        </div>
        <div class="voti-chips">${chips}</div>
        <div class="voto-count">${entries.length} voto${entries.length !== 1 ? 'i' : ''} · clicca per eliminare</div>
      </div>`;
  }).join('');
}

// ── HANDLERS GLOBALI (chiamati da onclick inline) ─────────────
window.handleToggle = async (id, field) => {
  await toggleDiario(id, field);
};

window.handleDeleteDiario = async (id) => {
  if (!confirm('Eliminare questo impegno?')) return;
  await deleteDiario(id);
};

window.handleDeleteVoto = async (id, voto) => {
  if (!confirm(`Eliminare il voto ${voto}?`)) return;
  await deleteVoto(id);
};

// ── EXPORT CSV ────────────────────────────────────────────────
function exportCSV() {
  const rows = [['Materia','Data','Tipo','Descrizione','Completato','Studiato']];
  for (const item of Object.values(diarioData)) {
    rows.push([
      `"${item.materia}"`, `"${item.data}"`, `"${item.tipo}"`,
      `"${(item.descrizione || '').replace(/"/g,'""')}"`,
      item.completato ? 'Sì' : 'No',
      item.studiato   ? 'Sì' : 'No'
    ]);
  }
  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `diario_${currentUser.nome}_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── NAVIGAZIONE SCHEDE ─────────────────────────────────────────
function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}

// ── POPOLA SELECT MATERIE ──────────────────────────────────────
function fillSelects() {
  ['form-materia', 'voto-materia'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = MATERIE.map(m => `<option value="${m}">${m}</option>`).join('');
  });
}

// ── MOSTRA / NASCONDI SCHERMATE ────────────────────────────────
function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'flex';
  document.getElementById('user-badge').textContent     = currentUser.nome;
  fillSelects();
  document.getElementById('form-data').value = todayISO();
  subscribe();
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display   = 'none';
}

// ── EVENTI ────────────────────────────────────────────────────
function initEvents() {
  // Toggle login ↔ registrati
  document.getElementById('btn-to-register').addEventListener('click', () => {
    document.getElementById('login-section').style.display   = 'none';
    document.getElementById('register-section').style.display = 'block';
  });
  document.getElementById('btn-to-login').addEventListener('click', () => {
    document.getElementById('register-section').style.display = 'none';
    document.getElementById('login-section').style.display    = 'block';
  });

  // Accedi
  document.getElementById('btn-accedi').addEventListener('click', async () => {
    const nome = document.getElementById('login-nome').value;
    const pin  = document.getElementById('login-pin').value;
    const errEl = document.getElementById('login-error');
    errEl.style.display = 'none';
    document.getElementById('btn-accedi').disabled = true;
    document.getElementById('btn-accedi').textContent = 'Accesso...';
    const err = await doLogin(nome, pin);
    document.getElementById('btn-accedi').disabled = false;
    document.getElementById('btn-accedi').textContent = 'Accedi';
    if (err) {
      errEl.textContent    = err;
      errEl.style.display  = 'block';
      return;
    }
    currentUser = loadSession();
    showApp();
  });

  // Crea account
  document.getElementById('btn-crea').addEventListener('click', async () => {
    const nome  = document.getElementById('reg-nome').value;
    const pin   = document.getElementById('reg-pin').value;
    const errEl = document.getElementById('reg-error');
    errEl.style.display = 'none';
    document.getElementById('btn-crea').disabled = true;
    document.getElementById('btn-crea').textContent = 'Creazione...';
    const err = await doRegister(nome, pin);
    document.getElementById('btn-crea').disabled = false;
    document.getElementById('btn-crea').textContent = 'Crea Account';
    if (err) {
      errEl.textContent   = err;
      errEl.style.display = 'block';
      return;
    }
    currentUser = loadSession();
    showApp();
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (!confirm('Sei sicuro di voler uscire?')) return;
    unsubscribe();
    clearSession();
    currentUser = null;
    diarioData  = {};
    votiData    = {};
    showLogin();
  });

  // Export CSV
  document.getElementById('btn-export').addEventListener('click', exportCSV);

  // Navigazione
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // Ricerca
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderHome();
  });

  // Form aggiungi impegno
  document.getElementById('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const materia    = document.getElementById('form-materia').value;
    const tipo       = document.getElementById('form-tipo').value;
    const data       = document.getElementById('form-data').value;
    const descrizione = document.getElementById('form-descrizione').value.trim();
    if (!data || !descrizione) return;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    await addDiarioItem({ materia, tipo, data, descrizione });
    document.getElementById('form-descrizione').value = '';
    document.getElementById('form-data').value = todayISO();
    btn.disabled = false;
    showTab('home');
  });

  // Form aggiungi voto
  document.getElementById('voto-form').addEventListener('submit', async e => {
    e.preventDefault();
    const materia = document.getElementById('voto-materia').value;
    const voto    = parseFloat(document.getElementById('voto-value').value);
    if (isNaN(voto) || voto < 1 || voto > 10) {
      alert('Il voto deve essere un numero tra 1 e 10.');
      return;
    }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    await addVoto(materia, voto);
    document.getElementById('voto-value').value = '';
    btn.disabled = false;
  });

  // Invio con tasto Enter su login
  ['login-nome','login-pin'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-accedi').click();
    });
  });
  ['reg-nome','reg-pin'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-crea').click();
    });
  });
}

// ── INIZIALIZZAZIONE ──────────────────────────────────────────
function init() {
  initEvents();
  const session = loadSession();
  if (session) {
    currentUser = session;
    showApp();
  } else {
    showLogin();
  }
}

init();
