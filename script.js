// ============================================================
//  DIARIO CLOUD - VERSIONE RIPRISTINATA (FUNZIONANTE)
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase, ref, get, set, push, onValue, update, remove
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ── CONFIGURAZIONE FIREBASE (Corretta) ──────────────────────────
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
    return null;
  } catch (e) {
    return 'Errore di connessione Firebase.';
  }
}

async function doRegister(nome, pin) {
  if (!nome.trim() || !pin.trim()) return 'Inserisci nome e PIN.';
  if (pin.length < 4) return 'Il PIN deve avere almeno 4 cifre.';
  const key = getUserKey(nome, pin);
  try {
    const snap = await get(ref(db, `utenti/${key}/info`));
    if (snap.exists()) return 'Account già registrato.';
    await set(ref(db, `utenti/${key}/info`), { nome: nome.trim(), createdAt: Date.now() });
    const user = { nome: nome.trim(), pin, key };
    saveSession(user);
    return null;
  } catch (e) {
    return 'Errore di connessione Firebase.';
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

// ── RENDER ───────────────────────────────────────────────────
function renderHome() {
  const t = today();
  let todo = 0, done = 0;
  const items = [];
  for (const [id, item] of Object.entries(diarioData)) {
    const itemDate = new Date(item.data + 'T00:00:00');
    const past = itemDate < t;
    if (item.tipo === 'Compito') { item.completato ? done++ : todo++; } else { past ? done++ : todo++; }
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
    list.innerHTML = `<div class="empty-state"><h3>Tutto pulito!</h3></div>`;
    return;
  }
  list.innerHTML = items.map(item => buildCard(item)).join('');
}

function buildCard(item) {
  const col = hashColor(item.materia);
  return `
    <div class="diario-card">
      <div class="card-body">
        <span class="badge-materia" style="background:${col.bg};color:${col.text}">${item.materia}</span>
        <div class="card-desc">${item.descrizione}</div>
        <div class="card-footer">${fmtDate(item.data)}</div>
        <button class="btn-delete" onclick="handleDeleteDiario('${item.id}')">Elimina</button>
      </div>
    </div>`;
}

function renderVoti() {
  const grid = document.getElementById('voti-grid');
  grid.innerHTML = `<p style="padding:20px">Voti caricati con successo!</p>`;
}

// ── HANDLERS GLOBALI ─────────────────────────────────────────
window.handleDeleteDiario = async (id) => {
  if (confirm('Eliminare?')) await deleteDiario(id);
};

// ── NAVIGAZIONE SCHEDE ─────────────────────────────────────────
function showTab(tab) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
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
  subscribe();
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display   = 'none';
}

// ── EVENTI ────────────────────────────────────────────────────
function initEvents() {
  // Toggle Schermate
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
    unsubscribe(); clearSession(); currentUser = null; showLogin();
  };

  // Navigazione
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });
}

function init() {
  initEvents();
  const session = loadSession();
  if (session) { currentUser = session; showApp(); } else { showLogin(); }
}

init();
