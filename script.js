// ============================================================
//  DIARIO CLOUD v2.0 - VERSIONE INTEGRALE RIPRISTINATA
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
  databaseURL:       'https://diario-scolastico-cfd88-default-rtdb.europe-west1.firebasedatabase.app/'
};

const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

// ── MATERIE ──────────────────────────────────────────────────
const MATERIE = [
  'Algebra','Geometria','Scienze','Italiano','Storia','Geografia',
  'Inglese','Tedesco','Religione','Educazione Civica','Tecnologia',
  'Arte','Musica','Motoria','Certificazioni Linguistica','Laboratori','Evento'
];

// ── COLORI PASTELLO ──────────────────────────────────────────
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
let currentUser   = null; 
let diarioData    = {};   
let votiData      = {};   
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

// ── SESSIONE ──────────────────────────────────────────────────
function saveSession(user) {
  localStorage.setItem('diario_session', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('diario_session');
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('diario_session')); } catch { return null; }
}

// ── AUTENTICAZIONE ────────────────────────────────────────────
async function doLogin(nome, pin) {
  if (!nome.trim() || !pin.trim()) return 'Inserisci nome e PIN.';
  const key = getUserKey(nome, pin);
  try {
    const snap = await get(ref(db, `utenti/${key}/info`));
    if (!snap.exists()) return 'Account non trovato. Registrati prima.';
    const user = { nome: nome.trim(), pin, key };
    saveSession(user);
    return null;
  } catch (e) {
    return 'Errore di connessione.';
  }
}

async function doRegister(nome, pin) {
  if (!nome.trim() || !pin.trim()) return 'Inserisci nome e PIN.';
  if (pin.length < 4) return 'Il PIN deve essere di almeno 4 cifre.';
  const key = getUserKey(nome, pin);
  try {
    const snap = await get(ref(db, `utenti/${key}/info`));
    if (snap.exists()) return 'Account già esistente.';
    await set(ref(db, `utenti/${key}/info`), { nome: nome.trim(), createdAt: Date.now() });
    const user = { nome: nome.trim(), pin, key };
    saveSession(user);
    return null;
  } catch (e) {
    return 'Errore di connessione.';
  }
}

// ── OPERAZIONI DATABASE ───────────────────────────────────────
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

// ── SINCRONIZZAZIONE DATI ─────────────────────────────────────
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
  if (unsubDiario) unsubDiario();
  if (unsubVoti) unsubVoti();
}

// ── RENDERIZZAZIONE HOME ──────────────────────────────────────
function renderHome() {
  const t = today();
  let todo = 0, done = 0;
  const items = [];

  for (const [id, item] of Object.entries(diarioData)) {
    const itemDate = new Date(item.data + 'T00:00:00');
    const past = itemDate < t;

    if (item.tipo === 'Compito') {
      item.completato ? done++ : todo++;
    } else {
      past ? done++ : todo++;
    }

    const q = searchQuery.toLowerCase();
    if (q && !item.materia.toLowerCase().includes(q) && !item.descrizione.toLowerCase().includes(q)) continue;
    if (item.tipo === 'Compito' && item.completato) continue;
    if ((item.tipo === 'Verifica' || item.tipo === 'Evento') && past) continue;

    items.push({ id, ...item });
  }

  items.sort((a, b) => new Date(a.data) - new Date(b.data));

  document.getElementById('stat-todo').textContent = todo;
  document.getElementById('stat-done').textContent = done;
  const list = document.getElementById('diario-list');

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><h3>Tutto pronto! 🚀</h3><p>Nessun impegno in vista.</p></div>`;
    return;
  }

  list.innerHTML = items.map(item => buildCard(item)).join('');
}

function buildCard(item) {
  const col = hashColor(item.materia);
  const isC = item.tipo === 'Compito';
  const isV = item.tipo === 'Verifica';

  // LOGICA DELLE SPUNTE (Ripristinata)
  const checkHtml = isC ? `
    <button class="checkbox-btn ${item.completato ? 'checked' : ''}" onclick="handleToggle('${item.id}','completato')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
    </button>` : isV ? `
    <button class="checkbox-btn square ${item.studiato ? 'checked' : ''}" onclick="handleToggle('${item.id}','studiato')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
    </button>` : `
    <div class="event-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>`;

  return `
    <div class="diario-card ${isV && item.studiato ? 'studiato-card' : ''}">
      <div class="card-action">${checkHtml}</div>
      <div class="card-body">
        <div class="card-badges">
          <span class="badge-materia" style="background:${col.bg};color:${col.text}">${item.materia}</span>
          <span class="badge-tipo">${item.tipo}</span>
        </div>
        <div class="card-desc ${item.completato ? 'completed-text' : ''}">${item.descrizione}</div>
        <div class="card-footer">
          <div class="card-date">${fmtDate(item.data)}</div>
          <button class="btn-delete" onclick="handleDeleteDiario('${item.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

// ── RENDERIZZAZIONE VOTI ──────────────────────────────────────
function renderVoti() {
  const grouped = {};
  for (const [id, v] of Object.entries(votiData)) {
    if (!grouped[v.materia]) grouped[v.materia] = [];
    grouped[v.materia].push({ id, voto: Number(v.voto) });
  }

  const materie = Object.keys(grouped).sort();
  const mediaEl = document.getElementById('media-generale');
  
  if (materie.length === 0) {
    mediaEl.textContent = '—';
  } else {
    const totale = materie.reduce((sum, m) => {
      const vMateria = grouped[m].map(v => v.voto);
      return sum + (vMateria.reduce((a, b) => a + b, 0) / vMateria.length);
    }, 0) / materie.length;
    mediaEl.textContent = totale.toFixed(2);
  }

  const grid = document.getElementById('voti-grid');
  grid.innerHTML = materie.map(m => {
    const vMateria = grouped[m].map(v => v.voto);
    const media = vMateria.reduce((a, b) => a + b, 0) / vMateria.length;
    return `
      <div class="voto-card">
        <div class="voto-card-header">
          <span>${m}</span>
          <span class="voto-media ${getMediaClass(media)}">${media.toFixed(2)}</span>
        </div>
        <div class="voti-chips">
          ${grouped[m].map(e => `<span class="voto-chip" onclick="handleDeleteVoto('${e.id}',${e.voto})">${e.voto}</span>`).join('')}
        </div>
      </div>`;
  }).join('');
}

// ── HANDLERS GLOBALI ──────────────────────────────────────────
window.handleToggle = async (id, field) => { await toggleDiario(id, field); };
window.handleDeleteDiario = async (id) => { if (confirm('Eliminare questo impegno?')) await deleteDiario(id); };
window.handleDeleteVoto = async (id, voto) => { if (confirm(`Eliminare il voto ${voto}?`)) await deleteVoto(id); };

// ── NAVIGAZIONE E UI ──────────────────────────────────────────
function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

function fillSelects() {
  const html = MATERIE.map(m => `<option value="${m}">${m}</option>`).join('');
  document.getElementById('form-materia').innerHTML = html;
  document.getElementById('voto-materia').innerHTML = html;
}

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
  // Switch Login/Registrazione
  document.getElementById('btn-to-register').onclick = () => {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('register-section').style.display = 'block';
  };
  document.getElementById('btn-to-login').onclick = () => {
    document.getElementById('register-section').style.display = 'none';
    document.getElementById('login-section').style.display = 'block';
  };

  // Login
  document.getElementById('btn-accedi').onclick = async () => {
    const nome = document.getElementById('login-nome').value;
    const pin = document.getElementById('login-pin').value;
    const err = await doLogin(nome, pin);
    if (err) alert(err); else { currentUser = loadSession(); showApp(); }
  };

  // Registrazione
  document.getElementById('btn-crea').onclick = async () => {
    const nome = document.getElementById('reg-nome').value;
    const pin = document.getElementById('reg-pin').value;
    const err = await doRegister(nome, pin);
    if (err) alert(err); else { currentUser = loadSession(); showApp(); }
  };

  // Logout
  document.getElementById('btn-logout').onclick = () => {
    if (confirm('Vuoi uscire?')) { unsubscribe(); clearSession(); showLogin(); }
  };

  // Navigazione Tab
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  // Ricerca
  document.getElementById('search-input').oninput = (e) => {
    searchQuery = e.target.value;
    renderHome();
  };

  // Aggiungi Compito
  document.getElementById('add-form').onsubmit = async (e) => {
    e.preventDefault();
    const materia = document.getElementById('form-materia').value;
    const tipo = document.getElementById('form-tipo').value;
    const data = document.getElementById('form-data').value;
    const descrizione = document.getElementById('form-descrizione').value.trim();
    if (!descrizione) return;
    await addDiarioItem({ materia, tipo, data, descrizione });
    document.getElementById('form-descrizione').value = '';
    showTab('home');
  };

  // Aggiungi Voto
  document.getElementById('voto-form').onsubmit = async (e) => {
    e.preventDefault();
    const materia = document.getElementById('voto-materia').value;
    const voto = parseFloat(document.getElementById('voto-value').value);
    if (voto >= 1 && voto <= 10) {
      await addVoto(materia, voto);
      document.getElementById('voto-value').value = '';
    }
  };
}

// ── AVVIO ─────────────────────────────────────────────────────
function init() {
  initEvents();
  const session = loadSession();
  if (session) { currentUser = session; showApp(); } else { showLogin(); }
}

init();
