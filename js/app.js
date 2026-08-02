/**
 * Kille Score Calculator — App UI
 * Handles all screen navigation, rendering, and user interactions.
 */
import { CARDS, getCardById, getCardsByType, sortCardsByRank } from './cards.js';
import { PlayerStore, GameStore } from './store.js';
import {
  createGame, addRound, removeLastRound, completeGame, calculateScoreTable,
  NEKEN_PENALTY, LOW_STAKE_THRESHOLD
} from './game.js';
import {
  computeAdvancedStats, getMostCommonCard, getMostCommonWinnerCard,
  getCardsInDisplayOrder, getLeaderboard, buildHistogram
} from './stats.js';
import { GroupData } from './store.js';
import { downloadExport, importFile } from './importexport.js';
import { $, $$, escHtml, avatarInitial, formatScore, showToast, addSwipeToDismiss } from './dom.js';
import { Session } from './session.js';
import { Groups, SuperAdmin, Outbox, onSyncStatus } from './remote.js';
import { Activity } from './analytics.js';
import { SUPABASE_ENABLED } from './config.js';
import { groupSlugFromUrl, isAdminUrl, groupUrl, adminUrl, setUrlForGroup, clearUrl } from './router.js';

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════
let currentScreen = 'home';
const screenStack = [];

// Game setup
let selectedPlayerIds = new Set();

// Active game
let activeGame = null;

// Round entry
let roundState = {
  standByIds: new Set(),
  winnerId: null,
  winnerCardId: null,
  loserCards: {}, // { playerId: cardId }
  nekenIds: new Set()
};

// Card picker
let cardPickerTarget = null; // playerId being assigned

// Stats
let selectedStatsPlayerId = null;
let cachedStats = null;
let heatmapMode = 'loser'; // 'loser' | 'winner'

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════
function navigateTo(screenId, options = {}) {
  if (!options.replace) {
    screenStack.push(currentScreen);
  }
  currentScreen = screenId;
  $$('.screen').forEach(el => el.classList.remove('active'));
  $(`#screen-${screenId}`).classList.add('active');
  updateHeader(screenId);
  renderScreen(screenId);
  Activity.track('screen_view', { screen: screenId });
  window.scrollTo(0, 0);
}

function goBack() {
  const prev = screenStack.pop() || 'home';
  currentScreen = prev;
  $$('.screen').forEach(el => el.classList.remove('active'));
  $(`#screen-${prev}`).classList.add('active');
  updateHeader(prev);
  renderScreen(prev);
  window.scrollTo(0, 0);
}

function updateHeader(screenId) {
  const titles = {
    home: 'Kille',
    players: 'Spelare',
    setup: 'Nytt Spel',
    game: 'Protokoll',
    history: 'Historik',
    'view-game': 'Spelprotokoll',
    stats: 'Statistik',
    cards: 'Kortvärden',
    rules: 'Spelregler',
    group: 'Grupp',
    admin: 'Super-admin'
  };
  $('#header-title').textContent = titles[screenId] || 'Kille';
  const backBtn = $('#btn-back');
  if (screenId === 'home' || screenId === 'welcome') {
    backBtn.classList.remove('visible');
  } else {
    backBtn.classList.add('visible');
  }
  // Hide header action by default
  $('#btn-header-action').style.display = 'none';
}

function renderScreen(screenId) {
  switch (screenId) {
    case 'home': renderHome(); break;
    case 'players': renderPlayers(); break;
    case 'setup': renderSetup(); break;
    case 'game': renderGame(); break;
    case 'history': renderHistory(); break;
    case 'stats': renderStats(); break;
    case 'cards': renderCardValues(); break;
    case 'rules': break; // static content
    case 'group': renderGroup(); break;
    case 'admin': renderAdmin(); break;
    case 'view-game': break; // rendered when entering
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME SCREEN
// ═══════════════════════════════════════════════════════════════════════════
function renderHome() {
  renderModeBar();
  const active = GameStore.getActive();
  const continueBtn = $('#btn-continue-game');
  if (active) {
    continueBtn.style.display = '';
    const playerNames = active.playerIds
      .map(id => PlayerStore.get(id)?.name || '?')
      .join(', ');
    continueBtn.textContent = `▶ Fortsätt (${playerNames})`;
  } else {
    continueBtn.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUPS — mode selection, sync & group management
// ═══════════════════════════════════════════════════════════════════════════
let syncStatus = 'idle';          // 'idle' | 'syncing' | 'synced' | 'error'
let lastGroupSnapshot = null;     // most recent { group, members, ... } snapshot
let unlockedAdminCode = null;     // admin code held in memory once verified

function handleSyncStatus(status) {
  syncStatus = status;
  // Only the home mode-bar and group screen reflect sync state.
  if (currentScreen === 'home') renderModeBar();
  if (currentScreen === 'group') updateGroupSyncLine();
}

function syncDotHtml() {
  const pending = Outbox.pending();
  let cls = 'sync-dot';
  let label = 'Synkad';
  if (syncStatus === 'syncing') { cls += ' sync-dot--syncing'; label = 'Synkar…'; }
  else if (syncStatus === 'error') { cls += ' sync-dot--error'; label = 'Synk misslyckades'; }
  else if (pending > 0) { cls += ' sync-dot--pending'; label = `${pending} väntar`; }
  return `<span class="${cls}"></span>${label}`;
}

function renderModeBar() {
  const bar = $('#mode-bar');
  if (!bar) return;

  if (!SUPABASE_ENABLED) { bar.style.display = 'none'; return; }
  bar.style.display = '';

  if (Session.isGroup()) {
    const g = Session.group;
    const roleBadge = Session.isAdmin()
      ? '<span class="role-badge role-badge--admin">Admin</span>'
      : '<span class="role-badge role-badge--member">Medlem</span>';
    bar.innerHTML = `
      <span class="mode-bar__icon">👥</span>
      <span class="mode-bar__text">
        <span class="mode-bar__title">${escHtml(g.name)} ${roleBadge}</span>
        <span class="mode-bar__sub">${syncDotHtml()}</span>
      </span>
      <button class="mode-bar__btn" id="mode-bar-manage">Hantera</button>`;
  } else {
    bar.innerHTML = `
      <span class="mode-bar__icon">📱</span>
      <span class="mode-bar__text">
        <span class="mode-bar__title">Lokalt läge</span>
        <span class="mode-bar__sub">Data sparas bara på den här enheten</span>
      </span>
      <button class="mode-bar__btn" id="mode-bar-manage">Grupp</button>`;
  }
}

// ─── Welcome / mode selection ─────────────────────────────────────────────────
function showWelcome() {
  currentScreen = 'welcome';
  screenStack.length = 0;
  $$('.screen').forEach(el => el.classList.remove('active'));
  $('#screen-welcome').classList.add('active');
  $('#header-title').textContent = 'Kille';
  $('#btn-back').classList.remove('visible');
  $('#btn-header-action').style.display = 'none';
  resetWelcomeForms();
  $('#btn-welcome-back').style.display = Session.hasChosen() ? '' : 'none';
  window.scrollTo(0, 0);
}

function resetWelcomeForms() {
  $('#welcome-join-form').style.display = 'none';
  $('#welcome-create-form').style.display = 'none';
  ['#input-join-code', '#input-join-name', '#input-create-name',
    '#input-create-member', '#input-create-slug', '#input-create-admin'].forEach(sel => { $(sel).value = ''; });
}

function enterLocalMode() {
  Session.setLocal();
  unlockedAdminCode = null;
  clearUrl();
  PlayerStore.invalidate();
  GameStore.invalidate();
  activeGame = GameStore.getActive();
  navigateTo('home', { replace: true });
  screenStack.length = 0;
}

function enterGroupFromSnapshot(snapshot, memberName, adminUnlocked) {
  Session.setGroup(snapshot, memberName, adminUnlocked);
  lastGroupSnapshot = snapshot;
  GroupData.hydrate(snapshot);
  activeGame = GameStore.getActive();
  if (snapshot.group?.slug) setUrlForGroup(snapshot.group.slug);
  Outbox.flush();
  navigateTo('home', { replace: true });
  screenStack.length = 0;
}

async function doJoin() {
  const code = $('#input-join-code').value.trim();
  const name = $('#input-join-name').value.trim();
  if (!code) { showToast('Ange en gruppkod'); return; }
  const btn = $('#btn-do-join');
  btn.disabled = true;
  try {
    const snapshot = await Groups.join(code, name);
    enterGroupFromSnapshot(snapshot, name, false);
    showToast(`Inloggad i ${snapshot.group.name}`);
  } catch (err) {
    showToast(err.message || 'Inloggning misslyckades');
  } finally {
    btn.disabled = false;
  }
}

async function doCreate() {
  const name = $('#input-create-name').value.trim();
  const member = $('#input-create-member').value.trim();
  const slug = $('#input-create-slug').value.trim();
  const adminCode = $('#input-create-admin').value.trim();
  if (!name) { showToast('Ange ett gruppnamn'); return; }
  if (adminCode.length < 4) { showToast('Admin-koden måste vara minst 4 tecken'); return; }
  const btn = $('#btn-do-create');
  btn.disabled = true;
  try {
    const snapshot = await Groups.create(name, adminCode, member, slug);
    unlockedAdminCode = adminCode; // creator is unlocked immediately
    Session.setGroup(snapshot, member, true);
    lastGroupSnapshot = snapshot;
    GroupData.hydrate(snapshot);
    activeGame = GameStore.getActive();
    if (snapshot.group?.slug) setUrlForGroup(snapshot.group.slug);
    navigateTo('home', { replace: true });
    screenStack.length = 0;
    showToast(`Grupp skapad: ${snapshot.group.slug}`);
  } catch (err) {
    showToast(err.message || 'Kunde inte skapa grupp');
  } finally {
    btn.disabled = false;
  }
}

// Enter a group directly from its slug URL (/?g=slug).
async function enterGroupBySlug(slug) {
  try {
    const snapshot = await Groups.getBySlug(slug);
    enterGroupFromSnapshot(snapshot, Session.memberName || null, false);
    renderHome();
  } catch (err) {
    showToast(err.message || 'Kunde inte öppna gruppen');
    if (!Session.hasChosen()) showWelcome();
    else { navigateTo('home', { replace: true }); screenStack.length = 0; }
  }
}

// ─── Group refresh (pull from central DB) ─────────────────────────────────────
async function refreshGroup(silent = true) {
  if (!Session.isGroup()) return;
  try {
    await Outbox.flush();
    const snapshot = await Groups.pull();
    lastGroupSnapshot = snapshot;
    // Re-derive our role & member id from the members list.
    const members = Array.isArray(snapshot.members) ? snapshot.members : [];
    const meName = Session.memberName;
    const me = members.find(m =>
      (Session.memberId && m.id === Session.memberId) ||
      (meName && m.name.toLowerCase() === meName.toLowerCase()));
    Session.updateGroup({ name: snapshot.group.name, role: me?.role || 'member' });
    if (me?.id) {
      Session._state.memberId = me.id;
      Session.save();
    }
    GroupData.hydrate(snapshot);
    activeGame = GameStore.getActive();
    if (currentScreen === 'group') renderGroup();
    if (currentScreen === 'home') renderHome();
    if (!silent) showToast('Uppdaterat');
  } catch (err) {
    if (!silent) showToast(err.message || 'Kunde inte uppdatera');
  }
}

// ─── Group management screen ──────────────────────────────────────────────────
function updateGroupSyncLine() {
  const el = $('#group-sync-line');
  if (el) el.innerHTML = syncDotHtml();
}

function renderGroup() {
  const container = $('#group-content');
  if (!Session.isGroup()) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state__text">Inte inloggad i någon grupp.</div></div>';
    return;
  }
  const g = Session.group;
  const isAdmin = Session.isAdmin();
  const adminUnlocked = !!unlockedAdminCode;
  const members = lastGroupSnapshot?.members || [];

  const membersHtml = members.length ? members.map(m => {
    const badge = m.role === 'admin'
      ? '<span class="role-badge role-badge--admin">Admin</span>'
      : '<span class="role-badge role-badge--member">Medlem</span>';
    const isSelf = (Session.memberId && m.id === Session.memberId);
    let actions = '';
    if (isAdmin && adminUnlocked && !isSelf) {
      if (m.role === 'admin') {
        actions += `<button class="member-item__action" data-demote="${escHtml(m.id)}">Gör till medlem</button>`;
      } else {
        actions += `<button class="member-item__action" data-promote="${escHtml(m.id)}">Gör till admin</button>`;
        actions += `<button class="member-item__action member-item__action--danger" data-remove-member="${escHtml(m.id)}">Ta bort</button>`;
      }
    }
    return `<li class="member-item">
      <span class="member-item__name">${escHtml(m.name)}${isSelf ? ' (du)' : ''}</span>
      ${badge}
      ${actions}
    </li>`;
  }).join('') : '<div class="empty-state"><div class="empty-state__text">Inga registrerade medlemmar ännu.</div></div>';

  // Admin section
  let adminHtml = '';
  if (isAdmin) {
    if (!adminUnlocked) {
      adminHtml = `
        <div class="panel mb-lg">
          <h3 class="panel__title">Administration</h3>
          <p class="field-hint" style="margin-bottom: var(--space-md)">Lås upp med admin-koden för att hantera gruppen.</p>
          <button class="btn btn--gold btn--full" id="btn-admin-unlock">🔓 Lås upp admin</button>
        </div>`;
    } else {
      adminHtml = `
        <div class="panel mb-lg">
          <h3 class="panel__title">Administration</h3>
          <div class="group-admin-actions">
            <button class="btn btn--ghost btn--full" id="btn-admin-rename">✎ Byt gruppnamn</button>
            <button class="btn btn--ghost btn--full" id="btn-admin-regen">🔁 Ny gruppkod</button>
            <button class="btn btn--ghost btn--full" id="btn-admin-setcode">🔑 Byt admin-kod</button>
            <button class="btn btn--danger btn--full" id="btn-admin-delete">🗑 Radera gruppen</button>
          </div>
        </div>`;
    }
  }

  container.innerHTML = `
    <div class="panel mb-lg">
      <h3 class="panel__title">${escHtml(g.name)}</h3>
      <p class="field-hint">Dela gruppkoden med de som ska logga in. Synkstatus: <span id="group-sync-line">${syncDotHtml()}</span></p>
      <button class="btn btn--gold btn--full" id="btn-invite">📨 Bjud in till grupp</button>
      <label class="field-label" style="margin-top: var(--space-md)">Gruppkod</label>
      <div class="group-code-box">
        <span class="group-code-box__code">${escHtml(g.joinCode)}</span>
        <button class="group-code-box__copy" id="btn-copy-code">Kopiera</button>
      </div>
      ${g.slug ? `
      <label class="field-label">Grupp-URL</label>
      <div class="group-url-box">
        <span class="group-url-box__url">${escHtml(groupUrl(g.slug))}</span>
        <button class="group-code-box__copy" id="btn-copy-url">Kopiera</button>
      </div>` : ''}
      <div class="flex-row" style="gap: var(--space-sm); margin-top: var(--space-md)">
        <button class="btn btn--ghost btn--half" id="btn-group-refresh">↻ Uppdatera</button>
        <button class="btn btn--secondary btn--half" id="btn-group-leave">Lämna grupp</button>
      </div>
    </div>

    <div class="panel mb-lg">
      <h3 class="panel__title">Medlemmar (${members.length})</h3>
      <ul class="member-list">${membersHtml}</ul>
    </div>

    ${adminHtml}
  `;

  // Ensure member list is fresh from the server when opening the screen.
  if (!lastGroupSnapshot) refreshGroup(true);
}

// ─── Admin actions ────────────────────────────────────────────────────────────
function unlockAdmin() {
  showPrompt('Ange admin-koden', { placeholder: 'Admin-kod' }, async (code) => {
    if (!code) return;
    try {
      await Groups.verifyAdmin(code);
      unlockedAdminCode = code;
      Session.setAdminUnlocked(true);
      showToast('Adminläge upplåst');
      renderGroup();
      renderModeBar();
    } catch (err) {
      showToast(err.message || 'Fel admin-kod');
    }
  });
}

function adminRename() {
  showPrompt('Nytt gruppnamn', { value: Session.group.name }, async (name) => {
    if (!name || !name.trim()) return;
    try {
      const snapshot = await Groups.rename(unlockedAdminCode, name.trim());
      lastGroupSnapshot = snapshot;
      Session.updateGroup({ name: snapshot.group.name });
      renderGroup();
      showToast('Gruppnamn uppdaterat');
    } catch (err) { showToast(err.message || 'Misslyckades'); }
  });
}

function adminRegenCode() {
  showConfirm('Skapa en ny gruppkod? Den gamla slutar då att fungera.', async () => {
    try {
      const res = await Groups.regenerateJoinCode(unlockedAdminCode);
      Session.updateGroup({ joinCode: res.joinCode });
      renderGroup();
      showToast(`Ny kod: ${res.joinCode}`);
    } catch (err) { showToast(err.message || 'Misslyckades'); }
  });
}

function adminSetCode() {
  showPrompt('Ny admin-kod (minst 4 tecken)', { placeholder: 'Ny admin-kod' }, async (code) => {
    if (!code || code.trim().length < 4) { showToast('Minst 4 tecken'); return; }
    try {
      await Groups.setAdminCode(unlockedAdminCode, code.trim());
      unlockedAdminCode = code.trim();
      showToast('Admin-kod uppdaterad');
    } catch (err) { showToast(err.message || 'Misslyckades'); }
  });
}

function adminDelete() {
  showConfirm('Radera hela gruppen och all dess data i molnet? Detta kan inte ångras.', async () => {
    try {
      await Groups.deleteGroup(unlockedAdminCode);
      showToast('Gruppen raderad');
      enterLocalMode();
    } catch (err) { showToast(err.message || 'Misslyckades'); }
  });
}

function adminRemoveMember(memberId) {
  showConfirm('Ta bort medlemmen ur gruppen?', async () => {
    try {
      const snapshot = await Groups.removeMember(unlockedAdminCode, memberId);
      lastGroupSnapshot = snapshot;
      renderGroup();
    } catch (err) { showToast(err.message || 'Misslyckades'); }
  });
}

async function adminSetRole(memberId, role) {
  try {
    const snapshot = await Groups.setMemberRole(unlockedAdminCode, memberId, role);
    lastGroupSnapshot = snapshot;
    renderGroup();
  } catch (err) { showToast(err.message || 'Misslyckades'); }
}

function leaveGroup() {
  showConfirm('Lämna gruppen? Du kan logga in igen med gruppkoden. Gruppens data ligger kvar i molnet.', async () => {
    try { await Groups.leave(); } catch { /* best effort */ }
    enterLocalMode();
    showToast('Du lämnade gruppen');
  });
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} kopierad`);
  } catch {
    showToast(`${label}: ${text}`);
  }
}

function copyJoinCode() {
  return copyText(Session.group?.joinCode || '', 'Gruppkod');
}

function copyGroupUrl() {
  return copyText(groupUrl(Session.group?.slug), 'Grupp-URL');
}

// Open the native share sheet if available, otherwise copy to clipboard.
async function shareOrCopy(url, shareData, label) {
  if (url && typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ ...shareData, url }); return; }
    catch (err) { if (err && err.name === 'AbortError') return; }
  }
  return copyText(url, label);
}

// "Bjud in till grupp" — share/copy the group's invite link.
function inviteToGroup() {
  const g = Session.group;
  if (!g) return;
  const url = groupUrl(g.slug);
  if (!url) return copyText(`Gruppkod: ${g.joinCode}`, 'Gruppkod');
  return shareOrCopy(url, {
    title: 'Kille',
    text: `Gå med i "${g.name}" på Kille`
  }, 'Inbjudningslänk');
}

// Share/copy a link to the super-admin console.
function shareAdminLink() {
  return shareOrCopy(adminUrl(), { title: 'Kille super-admin', text: 'Kille super-admin' }, 'Admin-länk');
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPER-ADMIN CONSOLE (login + password; manages all groups and users)
// ═══════════════════════════════════════════════════════════════════════════
let saCred = null;        // in-memory { username, password } — never persisted
let saExists = null;      // whether any super-admin is configured
let saGroups = [];        // cached group list
let saUsersView = null;   // { groupId, name, members, players } when viewing users
let saTab = 'groups';     // 'groups' | 'usage'
let saUsage = null;       // cached usage overview (KPIs + daily series)
let saFeed = [];          // cached activity feed rows
let saFeedFilter = { eventType: null }; // active feed filter

async function openAdmin() {
  screenStack.push(currentScreen);
  currentScreen = 'admin';
  $$('.screen').forEach(el => el.classList.remove('active'));
  $('#screen-admin').classList.add('active');
  updateHeader('admin');
  window.scrollTo(0, 0);
  if (saExists === null) {
    try { saExists = await SuperAdmin.exists(); } catch { saExists = true; }
  }
  renderAdmin();
}

function renderAdmin() {
  const c = $('#admin-content');
  if (!saCred) {
    c.innerHTML = `
      <div class="panel">
        <h3 class="panel__title">Super-admin</h3>
        <p class="field-hint" style="margin-bottom: var(--space-md)">
          Logga in för att hantera alla grupper och användare.</p>
        <label class="field-label" for="sa-user">Användarnamn</label>
        <input type="text" class="input" id="sa-user" autocomplete="off" autocapitalize="off" spellcheck="false">
        <label class="field-label" for="sa-pass">Lösenord</label>
        <input type="password" class="input" id="sa-pass" autocomplete="off">
        <div class="flex-row welcome-form__actions">
          ${saExists === false
            ? '<button class="btn btn--ghost" id="sa-bootstrap">Skapa första admin</button>'
            : ''}
          <button class="btn btn--primary" id="sa-login">Logga in</button>
        </div>
        ${saExists === false
          ? '<p class="field-hint" style="margin-top: var(--space-sm)">Ingen admin finns ännu — skapa den första (lösenord minst 6 tecken).</p>'
          : ''}
        <button class="btn btn--ghost btn--full" id="sa-share-link" style="margin-top: var(--space-md)">🔗 Kopiera/dela admin-länk</button>
      </div>`;
    return;
  }

  c.innerHTML = `
    <div class="panel mb-lg">
      <div class="flex-row" style="justify-content: space-between; align-items: center">
        <span class="mode-bar__title">Inloggad: ${escHtml(saCred.username)}</span>
        <button class="mode-bar__btn" id="sa-logout">Logga ut</button>
      </div>
      <button class="btn btn--ghost btn--full" id="sa-share-link" style="margin-top: var(--space-md)">🔗 Kopiera/dela admin-länk</button>
    </div>

    <div class="admin-tabs">
      <button class="admin-tab ${saTab === 'groups' ? 'admin-tab--active' : ''}" data-sa-tab="groups">Grupper</button>
      <button class="admin-tab ${saTab === 'usage' ? 'admin-tab--active' : ''}" data-sa-tab="usage">Användning</button>
    </div>

    ${saTab === 'usage' ? renderUsageDashboard() : renderGroupsTab()}`;
}

function renderGroupsTab() {
  const groupsHtml = saGroups.length ? saGroups.map(g => `
    <div class="admin-group-item" data-group="${escHtml(g.id)}">
      <div class="admin-group-item__head">
        <span class="admin-group-item__name">${escHtml(g.name)}</span>
        <span class="admin-group-item__slug">/${escHtml(g.slug || '—')}</span>
      </div>
      <div class="admin-group-item__meta">
        ${g.members} medlemmar · ${g.players} spelare · ${g.games} spel · kod ${escHtml(g.joinCode)}
      </div>
      <div class="admin-group-item__meta admin-group-item__usage">
        ${Number(g.activeMembers7d) || 0} aktiva (7d) · ${Number(g.eventsLast7d) || 0} händelser (7d) · senast aktiv ${formatRelativeTime(g.lastActivityAt)}
      </div>
      <div class="admin-group-item__actions">
        <button class="member-item__action" data-sa-rename="${escHtml(g.id)}">Byt namn</button>
        <button class="member-item__action" data-sa-slug="${escHtml(g.id)}">Byt slug</button>
        <button class="member-item__action" data-sa-regen="${escHtml(g.id)}">Ny kod</button>
        <button class="member-item__action" data-sa-users="${escHtml(g.id)}">Användare</button>
        <button class="member-item__action member-item__action--danger" data-sa-delete="${escHtml(g.id)}">Radera</button>
      </div>
      ${renderAdminUsers(g.id)}
    </div>`).join('')
    : '<div class="empty-state"><div class="empty-state__text">Inga grupper ännu.</div></div>';

  return `
    <div class="panel mb-lg">
      <h3 class="panel__title">Skapa grupp</h3>
      <label class="field-label" for="sa-new-name">Gruppnamn</label>
      <input type="text" class="input" id="sa-new-name" autocomplete="off">
      <label class="field-label" for="sa-new-slug">Slug (valfritt)</label>
      <input type="text" class="input" id="sa-new-slug" placeholder="auto från namnet" autocomplete="off" autocapitalize="off" spellcheck="false">
      <label class="field-label" for="sa-new-code">Admin-kod (minst 4 tecken)</label>
      <input type="text" class="input" id="sa-new-code" autocomplete="off">
      <div class="flex-row welcome-form__actions">
        <button class="btn btn--gold" id="sa-create">Skapa grupp</button>
      </div>
    </div>

    <div class="panel">
      <h3 class="panel__title">Grupper (${saGroups.length})</h3>
      <div class="admin-group-list">${groupsHtml}</div>
    </div>`;
}

function renderAdminUsers(groupId) {
  if (!saUsersView || saUsersView.groupId !== groupId) return '';
  const members = saUsersView.members.map(m => `
    <li class="member-item">
      <span class="member-item__name">${escHtml(m.name)}</span>
      <span class="role-badge role-badge--${m.role === 'admin' ? 'admin' : 'member'}">${m.role === 'admin' ? 'Admin' : 'Medlem'}</span>
      <button class="member-item__action member-item__action--danger" data-sa-rmuser="${escHtml(m.id)}">Ta bort</button>
    </li>`).join('') || '<li class="field-hint">Inga medlemmar.</li>';
  const players = saUsersView.players.map(p => `
    <li class="member-item">
      <span class="member-item__name">${escHtml(p.name)}</span>
      <button class="member-item__action member-item__action--danger" data-sa-rmplayer="${escHtml(p.id)}">Ta bort</button>
    </li>`).join('') || '<li class="field-hint">Inga spelare.</li>';
  return `
    <div class="admin-users">
      <div class="field-label">Medlemmar</div>
      <ul class="member-list">${members}</ul>
      <div class="field-label">Spelare</div>
      <ul class="member-list">${players}</ul>
    </div>`;
}

// ─── Användnings-dashboard (super-admin) ─────────────────────────────────────

const EVENT_LABELS = {
  login: '🔑 Inloggning',
  group_created: '✨ Grupp skapad',
  member_left: '👋 Lämnade gruppen',
  game_saved: '🃏 Sparade spel',
  game_updated: '✏️ Uppdaterade spel',
  game_deleted: '🗑️ Raderade spel',
  player_added: '➕ La till spelare',
  player_renamed: '✏️ Bytte spelarnamn',
  player_removed: '➖ Tog bort spelare',
  admin_action: '⚙️ Admin-åtgärd',
  screen_view: '👁️ Skärmvisning',
  feature_used: '⭐ Funktion',
  pwa_install: '📲 Installerade appen'
};

function eventLabel(type) {
  return EVENT_LABELS[type] || type || 'Händelse';
}

/** Relativ tid på svenska ("3 min sedan"). Tom/ogiltig → "aldrig". */
function formatRelativeTime(iso) {
  if (!iso) return 'aldrig';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'aldrig';
  const diff = Date.now() - then;
  if (diff < 60000) return 'nyss';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min} min sedan`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} h sedan`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} d sedan`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mån sedan`;
  return `${Math.floor(months / 12)} år sedan`;
}

function renderUsageDashboard() {
  if (!saUsage) {
    return '<div class="panel"><div class="empty-state"><div class="empty-state__text">Laddar användningsdata…</div></div></div>';
  }
  const t = saUsage.totals || {};
  const tiles = [
    ['Grupper', t.groups], ['Aktiva grupper (7d)', saUsage.activeGroups7d],
    ['Medlemmar', t.members], ['Aktiva medlemmar (7d)', saUsage.activeMembers7d],
    ['Händelser idag', saUsage.eventsToday], ['Händelser (7d)', saUsage.events7d],
    ['Händelser (30d)', saUsage.events30d], ['Spel', t.games]
  ].map(([label, val]) => `
    <div class="kpi-tile">
      <div class="kpi-tile__value">${Number(val) || 0}</div>
      <div class="kpi-tile__label">${label}</div>
    </div>`).join('');

  const series = Array.isArray(saUsage.dailySeries) ? saUsage.dailySeries : [];
  const max = Math.max(1, ...series.map(d => Number(d.count) || 0));
  const bars = series.map(d => {
    const h = Math.round(((Number(d.count) || 0) / max) * 100);
    return `<div class="usage-bar" title="${escHtml(d.day)}: ${Number(d.count) || 0}">
      <div class="usage-bar__fill" style="height:${h}%"></div></div>`;
  }).join('');

  const filterOptions = ['', 'login', 'game_saved', 'game_deleted', 'player_added',
    'admin_action', 'screen_view', 'feature_used', 'pwa_install']
    .map(v => `<option value="${v}" ${saFeedFilter.eventType === (v || null) ? 'selected' : ''}>${v ? eventLabel(v) : 'Alla händelser'}</option>`)
    .join('');

  const feedHtml = saFeed.length ? saFeed.map(ev => `
    <li class="feed-item">
      <span class="feed-item__event">${eventLabel(ev.eventType)}</span>
      <span class="feed-item__meta">${ev.memberName ? escHtml(ev.memberName) + ' · ' : ''}${escHtml(ev.groupName || '—')} · ${formatRelativeTime(ev.createdAt)}</span>
    </li>`).join('')
    : '<li class="field-hint">Ingen aktivitet ännu.</li>';

  return `
    <div class="panel mb-lg">
      <h3 class="panel__title">Översikt</h3>
      <div class="kpi-grid">${tiles}</div>
    </div>

    <div class="panel mb-lg">
      <h3 class="panel__title">Händelser per dag (30 dagar)</h3>
      <div class="usage-chart">${bars || '<div class="field-hint">Ingen data.</div>'}</div>
    </div>

    <div class="panel">
      <div class="flex-row" style="justify-content: space-between; align-items: center; gap: var(--space-sm)">
        <h3 class="panel__title" style="margin: 0">Aktivitet</h3>
        <select class="input" id="sa-feed-filter" style="width: auto">${filterOptions}</select>
      </div>
      <ul class="feed-list">${feedHtml}</ul>
      ${saFeed.length >= 50 ? '<button class="btn btn--ghost btn--full" id="sa-feed-more">Ladda fler</button>' : ''}
    </div>`;
}

function saShowTab(tab) {
  saTab = tab === 'usage' ? 'usage' : 'groups';
  renderAdmin();
  if (saTab === 'usage' && !saUsage) saLoadUsage();
}

async function saLoadUsage() {
  try {
    const [overview, feed] = await Promise.all([
      SuperAdmin.usageOverview(saCred),
      SuperAdmin.activityFeed(saCred, { limit: 50, eventType: saFeedFilter.eventType })
    ]);
    saUsage = overview;
    saFeed = Array.isArray(feed) ? feed : [];
    renderAdmin();
  } catch (err) {
    showToast(err.message || 'Kunde inte hämta användningsdata');
    if (err.code === 'INVALID_ADMIN_LOGIN') { saCred = null; renderAdmin(); }
  }
}

async function saFilterFeed(eventType) {
  saFeedFilter.eventType = eventType || null;
  try {
    saFeed = await SuperAdmin.activityFeed(saCred, { limit: 50, eventType: saFeedFilter.eventType }) || [];
    renderAdmin();
  } catch (err) { showToast(err.message || 'Misslyckades'); }
}

async function saFeedMore() {
  const before = saFeed.length ? saFeed[saFeed.length - 1].createdAt : null;
  try {
    const more = await SuperAdmin.activityFeed(saCred, { limit: 50, before, eventType: saFeedFilter.eventType }) || [];
    saFeed = saFeed.concat(more);
    renderAdmin();
  } catch (err) { showToast(err.message || 'Misslyckades'); }
}

async function saLoadGroups() {
  try {
    saGroups = await SuperAdmin.listGroups(saCred);
    renderAdmin();
  } catch (err) {
    showToast(err.message || 'Kunde inte hämta grupper');
    if (err.code === 'INVALID_ADMIN_LOGIN') { saCred = null; renderAdmin(); }
  }
}

async function saLogin() {
  const username = $('#sa-user').value.trim();
  const password = $('#sa-pass').value;
  try {
    await SuperAdmin.login(username, password);
    saCred = { username: username.toLowerCase(), password };
    await saLoadGroups();
  } catch (err) { showToast(err.message || 'Inloggning misslyckades'); }
}

async function saBootstrap() {
  const username = $('#sa-user').value.trim();
  const password = $('#sa-pass').value;
  if (!username || password.length < 6) { showToast('Lösenord minst 6 tecken'); return; }
  try {
    await SuperAdmin.bootstrap(username, password);
    saExists = true;
    saCred = { username: username.toLowerCase(), password };
    showToast('Admin skapad');
    await saLoadGroups();
  } catch (err) { showToast(err.message || 'Kunde inte skapa admin'); }
}

function saLogout() {
  saCred = null;
  saGroups = [];
  saUsersView = null;
  saTab = 'groups';
  saUsage = null;
  saFeed = [];
  saFeedFilter = { eventType: null };
  renderAdmin();
}

async function saCreateGroup() {
  const name = $('#sa-new-name').value.trim();
  const slug = $('#sa-new-slug').value.trim();
  const code = $('#sa-new-code').value.trim();
  if (!name) { showToast('Ange gruppnamn'); return; }
  if (code.length < 4) { showToast('Admin-kod minst 4 tecken'); return; }
  try {
    const snap = await SuperAdmin.createGroup(saCred, name, code, slug);
    showToast(`Skapade ${snap.group.slug}`);
    await saLoadGroups();
  } catch (err) { showToast(err.message || 'Kunde inte skapa grupp'); }
}

function saRename(id) {
  const g = saGroups.find(x => x.id === id);
  showPrompt('Nytt gruppnamn', { value: g?.name || '' }, async (name) => {
    if (!name || !name.trim()) return;
    try { await SuperAdmin.renameGroup(saCred, id, name.trim()); await saLoadGroups(); }
    catch (err) { showToast(err.message || 'Misslyckades'); }
  });
}

function saSetSlug(id) {
  const g = saGroups.find(x => x.id === id);
  showPrompt('Ny slug (URL)', { value: g?.slug || '' }, async (slug) => {
    if (!slug || !slug.trim()) return;
    try { const r = await SuperAdmin.setSlug(saCred, id, slug.trim()); showToast(`Slug: ${r.slug}`); await saLoadGroups(); }
    catch (err) { showToast(err.message || 'Misslyckades'); }
  });
}

function saRegen(id) {
  showConfirm('Skapa ny gruppkod? Den gamla slutar fungera.', async () => {
    try { const r = await SuperAdmin.regenCode(saCred, id); showToast(`Ny kod: ${r.joinCode}`); await saLoadGroups(); }
    catch (err) { showToast(err.message || 'Misslyckades'); }
  });
}

function saDelete(id) {
  const g = saGroups.find(x => x.id === id);
  showConfirm(`Radera gruppen "${g?.name || ''}" och all dess data? Kan inte ångras.`, async () => {
    try { await SuperAdmin.deleteGroup(saCred, id); if (saUsersView?.groupId === id) saUsersView = null; await saLoadGroups(); }
    catch (err) { showToast(err.message || 'Misslyckades'); }
  });
}

async function saViewUsers(id) {
  if (saUsersView?.groupId === id) { saUsersView = null; renderAdmin(); return; }
  try {
    const res = await SuperAdmin.listUsers(saCred, id);
    saUsersView = { groupId: id, members: res.members || [], players: res.players || [] };
    renderAdmin();
  } catch (err) { showToast(err.message || 'Misslyckades'); }
}

async function saRemoveMember(memberId) {
  if (!saUsersView) return;
  try { await SuperAdmin.removeMember(saCred, saUsersView.groupId, memberId); await saViewUsersReload(); }
  catch (err) { showToast(err.message || 'Misslyckades'); }
}

async function saRemovePlayer(playerId) {
  if (!saUsersView) return;
  try { await SuperAdmin.removePlayer(saCred, saUsersView.groupId, playerId); await saViewUsersReload(); }
  catch (err) { showToast(err.message || 'Misslyckades'); }
}

async function saViewUsersReload() {
  const id = saUsersView.groupId;
  const res = await SuperAdmin.listUsers(saCred, id);
  saUsersView = { groupId: id, members: res.members || [], players: res.players || [] };
  await saLoadGroups();
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════
function renderPlayers() {
  const players = PlayerStore.getAll();
  const list = $('#player-list');
  const empty = $('#players-empty');

  if (players.length === 0) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = players.map(p => `
    <li class="player-item" data-id="${p.id}">
      <div class="player-item__avatar">${avatarInitial(p.name)}</div>
      <span class="player-item__name">${escHtml(p.name)}</span>
      <button class="player-item__action" data-action="remove" data-id="${p.id}" title="Ta bort">✕</button>
    </li>
  `).join('');
}

function addPlayer() {
  const input = $('#input-player-name');
  const name = input.value.trim();
  if (!name) return;
  PlayerStore.add(name);
  input.value = '';
  input.focus();
  renderPlayers();
}

function removePlayer(id) {
  const player = PlayerStore.get(id);
  if (!player) return;
  showConfirm(`Ta bort ${player.name}?`, () => {
    PlayerStore.remove(id);
    renderPlayers();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GAME SETUP
// ═══════════════════════════════════════════════════════════════════════════
function renderSetup() {
  const players = PlayerStore.getAll();
  const grid = $('#setup-grid');

  if (players.length < 2) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state__text">Lägg till minst 2 spelare först.</div></div>`;
    return;
  }

  grid.innerHTML = players.map(p => `
    <div class="setup-player ${selectedPlayerIds.has(p.id) ? 'selected' : ''}" data-id="${p.id}">
      <div class="setup-player__avatar">${avatarInitial(p.name)}</div>
      <div class="setup-player__name">${escHtml(p.name)}</div>
    </div>
  `).join('');

  updateSetupCount();
}

function toggleSetupPlayer(id) {
  if (selectedPlayerIds.has(id)) {
    selectedPlayerIds.delete(id);
  } else {
    if (selectedPlayerIds.size >= 8) return;
    selectedPlayerIds.add(id);
  }
  renderSetup();
}

function updateSetupCount() {
  const count = selectedPlayerIds.size;
  $('#setup-count').textContent = `${count} spelare valda`;
  $('#btn-start-game').disabled = count < 2;
}

function startGame() {
  if (selectedPlayerIds.size < 2) return;
  activeGame = createGame([...selectedPlayerIds]);
  GameStore.save(activeGame);
  GameStore.setActive(activeGame.id);
  selectedPlayerIds.clear();
  navigateTo('game', { replace: true });
  // Clear stack so back goes to home
  screenStack.length = 0;
  screenStack.push('home');
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVE GAME — PROTOCOL TABLE
// ═══════════════════════════════════════════════════════════════════════════

/** Build the <tbody> HTML for a protocol table (oldest round first, newest last). */
function buildProtocolBody(table, players) {
  return table.rounds.map(round => {
    const isVoid = round.counted === false;
    const cells = players.map(p => {
      const s = round.scores[p.id];
      if (s.isStandBy) {
        return `<td><div class="protocol-cell">
          <span class="protocol-cell__round protocol-cell__round--standby">—</span>
          <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        </div></td>`;
      }
      if (s.isWinner) {
        const winnerClass = s.hadNeken ? 'protocol-cell__round--winner protocol-cell__round--winner-neken' : 'protocol-cell__round--winner';
        const winnerCard = s.cardId ? getCardById(s.cardId) : null;
        return `<td><div class="protocol-cell">
          <span class="protocol-cell__round ${winnerClass}">+${s.roundScore}</span>
          <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
          ${winnerCard ? `<span class="protocol-cell__card protocol-cell__card--winner">${escHtml(winnerCard.name)}</span>` : ''}
        </div></td>`;
      }
      const card = s.cardId ? getCardById(s.cardId) : null;
      return `<td><div class="protocol-cell">
        <span class="protocol-cell__round protocol-cell__round--loser">${s.roundScore}</span>
        <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        ${card ? `<span class="protocol-cell__card">${escHtml(card.name)}${s.neken ? ' nek' : ''}</span>` : ''}
      </div></td>`;
    }).join('');
    const rowClass = isVoid ? ' class="protocol-row--void"' : '';
    const marker = isVoid ? '<span class="protocol-void-badge" title="Räknas inte i ställningen">ej räknad</span>' : '';
    return `<tr${rowClass}><td>${round.roundNumber}${marker}</td>${cells}</tr>`;
  }).join('');
}

/** Build the <tfoot> totals row for a protocol table. */
function buildProtocolFoot(table, players) {
  return `<tr>
    <td>Σ</td>
    ${players.map(p => {
      const total = table.totals[p.id] || 0;
      const cls = total > 0 ? 'total-positive' : total < 0 ? 'total-negative' : 'total-zero';
      return `<td class="${cls}">${formatScore(total)}</td>`;
    }).join('')}
  </tr>`;
}

function renderGame() {
  if (!activeGame) return;

  const table = calculateScoreTable(activeGame);
  const players = activeGame.playerIds.map(id => PlayerStore.get(id) || { id, name: '?' });

  // Empty state
  const emptyEl = $('#game-empty');
  const wrapperEl = $('#protocol-wrapper');
  if (table.rounds.length === 0) {
    emptyEl.style.display = '';
    wrapperEl.style.display = 'none';
  } else {
    emptyEl.style.display = 'none';
    wrapperEl.style.display = '';
  }

  // Undo button
  $('#btn-undo-round').style.display = table.rounds.length > 0 ? '' : 'none';

  // Header
  $('#protocol-head').innerHTML = `<tr>
    <th>#</th>
    ${players.map(p => `<th>${escHtml(p.name)}</th>`).join('')}
  </tr>`;

  // Body (newest round at the bottom)
  $('#protocol-body').innerHTML = buildProtocolBody(table, players);

  // Footer (totals)
  $('#protocol-foot').innerHTML = buildProtocolFoot(table, players);

  scrollToLatestRound();
}

/**
 * Keep the newest round and the totals in view — the protocol grows downwards.
 * Deferred so it runs after the navigation's scroll-to-top.
 */
function scrollToLatestRound() {
  const wrapper = $('#protocol-wrapper');
  if (!wrapper || wrapper.style.display === 'none') return;
  requestAnimationFrame(() => {
    if (currentScreen !== 'game') return;
    // The action bar is fixed over the content, so keep clear of it.
    const actionsHeight = $('.game-actions')?.offsetHeight || 0;
    const bottom = wrapper.getBoundingClientRect().bottom + window.scrollY;
    const target = bottom - window.innerHeight + actionsHeight + 16;
    if (target > window.scrollY) window.scrollTo(0, target);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUND ENTRY MODAL
// ═══════════════════════════════════════════════════════════════════════════
function openRoundModal() {
  if (!activeGame) return;

  // Reset state
  roundState = {
    standByIds: new Set(),
    winnerId: null,
    winnerCardId: null,
    loserCards: {},
    nekenIds: new Set()
  };

  const roundNum = activeGame.rounds.length + 1;
  $('#round-modal-title').textContent = `Omgång ${roundNum}`;

  renderStandbyGrid();
  renderWinnerGrid();
  renderWinnerCardAssignment();
  renderLoserAssignments();
  updateRoundPreview();

  $('#modal-round').classList.add('active');
}

function closeRoundModal(skipAnimation = false) {
  const overlay = $('#modal-round');
  if (skipAnimation) {
    overlay.classList.remove('active');
    return;
  }
  overlay.classList.add('closing');
  setTimeout(() => overlay.classList.remove('active', 'closing'), 250);
}

function renderStandbyGrid() {
  const players = activeGame.playerIds.map(id => PlayerStore.get(id) || { id, name: '?' });
  $('#standby-grid').innerHTML = players.map(p => `
    <button class="standby-toggle ${roundState.standByIds.has(p.id) ? 'standby' : ''}" data-id="${p.id}">
      ${escHtml(p.name)}
    </button>
  `).join('');
}

function toggleStandby(playerId) {
  if (roundState.standByIds.has(playerId)) {
    roundState.standByIds.delete(playerId);
  } else {
    roundState.standByIds.add(playerId);
    // If this player was the winner, clear winner
    if (roundState.winnerId === playerId) {
      roundState.winnerId = null;
    }
    // Remove from loser cards and neken
    delete roundState.loserCards[playerId];
    roundState.nekenIds.delete(playerId);
  }
  renderStandbyGrid();
  renderWinnerGrid();
  renderLoserAssignments();
  updateRoundPreview();
}

function getActivePlayers() {
  return activeGame.playerIds.filter(id => !roundState.standByIds.has(id));
}

function renderWinnerGrid() {
  const active = getActivePlayers();
  const players = active.map(id => PlayerStore.get(id) || { id, name: '?' });

  $('#winner-grid').innerHTML = players.map(p => `
    <button class="winner-btn ${roundState.winnerId === p.id ? 'selected' : ''}" data-id="${p.id}">
      <span class="winner-btn__icon">${roundState.winnerId === p.id ? '👑' : '👤'}</span>
      ${escHtml(p.name)}
    </button>
  `).join('');
}

function selectWinner(playerId) {
  roundState.winnerId = playerId;
  roundState.winnerCardId = null;
  // Remove winner from loser cards and neken
  delete roundState.loserCards[playerId];
  roundState.nekenIds.delete(playerId);
  renderWinnerGrid();
  renderWinnerCardAssignment();
  renderLoserAssignments();
  updateRoundPreview();
}

function playMockLaugh() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();

  const bursts = [0, 0.19, 0.38, 0.57]; // four "ha"s
  bursts.forEach((offset, i) => {
    const t = ctx.currentTime + offset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    // Descending pitch per burst for a derisive feel
    const baseFreq = 340 - i * 18;
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.72, t + 0.14);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  });
}

function toggleNeken(playerId) {
  if (roundState.nekenIds.has(playerId)) {
    roundState.nekenIds.delete(playerId);
  } else {
    // Only one player can have neken per round
    roundState.nekenIds.clear();
    roundState.nekenIds.add(playerId);
    playMockLaugh();
  }
  renderLoserAssignments();
  updateRoundPreview();
}

// Returns the auto-assigned card for the neken loser:
// double the worst card played by any loser this round.
function getNekenCards() {
  const losers = getActivePlayers().filter(id => id !== roundState.winnerId);
  const nekenPlayers = losers.filter(id => roundState.nekenIds.has(id));

  if (nekenPlayers.length === 0) return {};

  // Find the worst card among all losers (including the neken player)
  let worstCard = null;
  losers.forEach(id => {
    if (roundState.loserCards[id]) {
      const card = getCardById(roundState.loserCards[id]);
      if (card && (!worstCard || card.points > worstCard.points)) {
        worstCard = card;
      }
    }
  });

  const result = {};
  nekenPlayers.forEach(id => {
    result[id] = worstCard; // null until at least one loser has picked
  });
  return result;
}

// The penalty a neken loser takes: double the worst card, but never below 50.
function nekenPenalty(worstCard) {
  const doubled = worstCard ? worstCard.points * 2 : 0;
  return Math.max(doubled, NEKEN_PENALTY);
}

function renderWinnerCardAssignment() {
  const section = $('#winner-card-section');
  const container = $('#winner-card-assignment');

  if (!roundState.winnerId) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const player = PlayerStore.get(roundState.winnerId) || { id: roundState.winnerId, name: '?' };
  const card = roundState.winnerCardId ? getCardById(roundState.winnerCardId) : null;

  container.innerHTML = `<div class="loser-row">
    <span class="loser-row__name">${escHtml(player.name)} 👑</span>
    <button class="loser-row__card-btn ${card ? 'has-card' : ''}" data-winner-card="${player.id}">
      ${card ? `${escHtml(card.name)} (${card.points}p)` : 'Välj kort...'}
    </button>
  </div>`;
}

function renderLoserAssignments() {
  const section = $('#loser-section');
  const container = $('#loser-assignments');

  if (!roundState.winnerId) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  const losers = getActivePlayers().filter(id => id !== roundState.winnerId);
  const players = losers.map(id => PlayerStore.get(id) || { id, name: '?' });

  const nekenCards = getNekenCards();

  container.innerHTML = players.map(p => {
    const isNeken = roundState.nekenIds.has(p.id);

    if (isNeken) {
      const nekenCard = nekenCards[p.id];
      // A nek is at least 50, or double the worst card if that is higher.
      const points = nekenPenalty(nekenCard);
      const ownCardId = roundState.loserCards[p.id];
      const ownCard = ownCardId ? getCardById(ownCardId) : null;
      const cardLabel = nekenCard
        ? `${escHtml(nekenCard.name)} ×2`
        : `<em>Minst ${NEKEN_PENALTY}</em>`;
      return `<div class="loser-row">
        <span class="loser-row__name">${escHtml(p.name)}</span>
        <button class="loser-row__neken-btn loser-row__neken-btn--active" data-neken-player="${p.id}">Neken ✕</button>
        <button class="loser-row__card-btn ${ownCard ? 'has-card' : ''}" data-player="${p.id}">
          ${ownCard ? `${escHtml(ownCard.name)} (${ownCard.points}p)` : 'Välj kort...'}
        </button>
        <span class="loser-row__neken-card">${cardLabel}</span>
        <span class="loser-row__points loser-row__points--neken">−${points}</span>
      </div>`;
    }

    const cardId = roundState.loserCards[p.id];
    const card = cardId ? getCardById(cardId) : null;
    const points = card ? card.points : 0;

    return `<div class="loser-row">
      <span class="loser-row__name">${escHtml(p.name)}</span>
      <button class="loser-row__neken-btn" data-neken-player="${p.id}">Neken</button>
      <button class="loser-row__card-btn ${card ? 'has-card' : ''}" data-player="${p.id}">
        ${card ? `${escHtml(card.name)} (${card.points}p)` : 'Välj kort...'}
      </button>
      ${card ? `<span class="loser-row__points">−${points}</span>` : ''}
    </div>`;
  }).join('');
}

function updateRoundPreview() {
  const preview = $('#round-preview');
  const scoreEl = $('#round-preview-score');
  const confirmBtn = $('#btn-confirm-round');

  if (!roundState.winnerId) {
    preview.style.display = 'none';
    confirmBtn.disabled = true;
    return;
  }

  const losers = getActivePlayers().filter(id => id !== roundState.winnerId);
  const nekenCards = getNekenCards();
  const allLoserAssigned = losers.length > 0 && losers.every(id => !!roundState.loserCards[id]);
  const winnerCardAssigned = !!roundState.winnerCardId;

  let totalPoints = 0;
  losers.forEach(id => {
    if (roundState.nekenIds.has(id)) {
      totalPoints += nekenPenalty(nekenCards[id]);
    } else {
      const cardId = roundState.loserCards[id];
      if (cardId) {
        const card = getCardById(cardId);
        totalPoints += card ? card.points : 0;
      }
    }
  });

  preview.style.display = '';
  scoreEl.textContent = `+${totalPoints}`;
  confirmBtn.disabled = !(allLoserAssigned && winnerCardAssigned);
}

function confirmRound() {
  if (!roundState.winnerId || !roundState.winnerCardId) return;
  const losers = getActivePlayers().filter(id => id !== roundState.winnerId);
  const nekenCards = getNekenCards();
  if (!losers.every(id => !!roundState.loserCards[id])) return;

  let winnerScore = 0;
  const loserData = losers.map(id => {
    if (roundState.nekenIds.has(id)) {
      winnerScore += nekenPenalty(nekenCards[id]);
      return { playerId: id, cardId: nekenCards[id].id, neken: true };
    }
    const card = getCardById(roundState.loserCards[id]);
    winnerScore += card ? card.points : 0;
    return { playerId: id, cardId: roundState.loserCards[id] };
  });

  const roundData = {
    winnerId: roundState.winnerId,
    winnerCardId: roundState.winnerCardId,
    standByIds: [...roundState.standByIds],
    losers: loserData
  };

  // Low-stake rounds may be recorded without affecting the standings.
  if (winnerScore <= LOW_STAKE_THRESHOLD) {
    showProtocolQuestion(winnerScore, (counted) => {
      finalizeRound({ ...roundData, counted });
    });
    return;
  }

  finalizeRound({ ...roundData, counted: true });
}

function finalizeRound(roundData) {
  activeGame = addRound(activeGame, roundData);
  GameStore.save(activeGame);
  closeRoundModal();
  renderGame();
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD VALUES
// ═══════════════════════════════════════════════════════════════════════════
const CARD_TYPE_LABELS = {
  picture: 'Bildkort',
  number: 'Sifferkort (Lilja)',
  zero: 'Nollkort'
};

function cardVisual(card, modifier) {
  if (card.image) {
    return `<img class="cv-visual${modifier}" src="${card.image}" alt="${escHtml(card.name)}" loading="lazy">`;
  }
  if (card.type === 'number') {
    return `<div class="cv-visual${modifier} cv-visual--number">${card.number}</div>`;
  }
  return `<div class="cv-visual${modifier} cv-visual--number">${escHtml(card.name)}</div>`;
}

function renderCardValues() {
  const sorted = sortCardsByRank(CARDS);
  const numberCards = getCardsByType('number');
  const minPoints = Math.min(...numberCards.map(c => c.points));
  const maxPoints = Math.max(...numberCards.map(c => c.points));

  $('#card-values-overview').innerHTML = sorted.map(c => `
    <div class="cv-tile" data-card-type="${c.type}">
      ${cardVisual(c, '--small')}
      <span class="cv-tile__name">${escHtml(c.name)}</span>
      <span class="cv-tile__points">${c.points} p</span>
    </div>
  `).join('') + `
    <div class="cv-tile cv-tile--liljor-merged">
      <div class="cv-visual--small cv-visual--number">1-12</div>
      <span class="cv-tile__name">Liljor</span>
      <span class="cv-tile__points">${minPoints}-${maxPoints} p</span>
    </div>
  `;

  $('#card-values-detail').innerHTML = sorted.map(c => `
    <div class="cv-detail">
      ${cardVisual(c, '--large')}
      <div class="cv-detail__info">
        <div class="cv-detail__name">${escHtml(c.name)}</div>
        <div class="cv-detail__type">${CARD_TYPE_LABELS[c.type] || ''}</div>
      </div>
      <div class="cv-detail__points">${c.points}<span class="cv-detail__points-unit">p</span></div>
    </div>
  `).join('');

  renderCardValuesPrint();
}

/** Build the printable / PDF reference sheet, grouped by card type. */
function renderCardValuesPrint() {
  const groups = ['picture', 'number', 'zero'];
  $('#card-values-print-groups').innerHTML = groups.map(type => {
    const cards = sortCardsByRank(getCardsByType(type));
    if (!cards.length) return '';
    const rows = cards.map(c => `
      <div class="cv-print__card">
        <span class="cv-print__card-name">${escHtml(c.name)}</span>
        <span class="cv-print__card-points">${c.points} p</span>
      </div>
    `).join('');
    return `
      <div class="cv-print__group">
        <h2 class="cv-print__group-title">${CARD_TYPE_LABELS[type] || ''}</h2>
        <div class="cv-print__cards">${rows}</div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD PICKER
// ═══════════════════════════════════════════════════════════════════════════
function initCardPicker() {
  // Render card grids (static, done once) — same order as everywhere else
  renderCardGroup('#picker-picture-cards', sortCardsByRank(getCardsByType('picture')));
  renderCardGroup('#picker-number-cards', sortCardsByRank(getCardsByType('number')));
  renderCardGroup('#picker-zero-cards', sortCardsByRank(getCardsByType('zero')));
}

function renderCardGroup(selector, cards) {
  $(selector).innerHTML = cards.map(c => {
    let visual = '';
    if (c.image) {
      visual = `<img class="card-tile__image" src="${c.image}" alt="${escHtml(c.name)}" loading="lazy">`;
    } else if (c.type === 'number') {
      visual = `<div class="card-tile__number">${c.number}</div>`;
    }
    return `<div class="card-tile" data-card="${c.id}">
      ${visual}
      <span class="card-tile__name">${escHtml(c.name)}</span>
      <span class="card-tile__points">${c.points}p</span>
    </div>`;
  }).join('');
}

// Sentinel target meaning "assign the winner's card" rather than a loser's.
const WINNER_CARD_TARGET = '__winner__';

function openCardPicker(target) {
  const name = target === WINNER_CARD_TARGET
    ? PlayerStore.get(roundState.winnerId)?.name
    : PlayerStore.get(target)?.name;
  $('#card-picker-title').textContent = `Välj kort för ${name || '?'}`;
  cardPickerTarget = target;
  $('#card-picker-overlay').classList.add('active');
}

function closeCardPicker(skipAnimation = false) {
  cardPickerTarget = null;
  const overlay = $('#card-picker-overlay');
  if (skipAnimation) {
    overlay.classList.remove('active');
    return;
  }
  overlay.classList.add('closing');
  setTimeout(() => overlay.classList.remove('active', 'closing'), 250);
}

function selectCard(cardId) {
  if (cardPickerTarget === WINNER_CARD_TARGET) {
    roundState.winnerCardId = cardId;
    closeCardPicker();
    renderWinnerCardAssignment();
    updateRoundPreview();
  } else if (cardPickerTarget) {
    roundState.loserCards[cardPickerTarget] = cardId;
    closeCardPicker();
    renderLoserAssignments();
    updateRoundPreview();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GAME CONTROLS
// ═══════════════════════════════════════════════════════════════════════════
function undoLastRound() {
  if (!activeGame || activeGame.rounds.length === 0) return;
  showConfirm('Ångra senaste omgången?', () => {
    activeGame = removeLastRound(activeGame);
    GameStore.save(activeGame);
    renderGame();
  });
}

function endGame() {
  if (!activeGame) return;
  showConfirm('Avsluta spelet?', () => {
    activeGame = completeGame(activeGame);
    GameStore.save(activeGame);
    GameStore.clearActive();
    Activity.track('feature_used', { feature: 'complete_game', rounds: activeGame.rounds.length });
    showGameEndLeaderboard(activeGame);
    activeGame = null;
  });
}

function showGameEndLeaderboard(game) {
  const { totals } = calculateScoreTable(game);
  const players = PlayerStore.getAll();
  const ranked = game.playerIds
    .map(pid => ({
      id: pid,
      name: (players.find(p => p.id === pid) || { name: '?' }).name,
      score: totals[pid] || 0
    }))
    .sort((a, b) => b.score - a.score);

  const medals = ['🥇', '🥈', '🥉'];
  // Podium order: 2nd, 1st, 3rd (visual layout)
  const podiumOrder = [1, 0, 2];
  const podiumEl = $('#podium');
  const restEl = $('#leaderboard-rest');

  const podiumPlayers = ranked.slice(0, Math.min(3, ranked.length));
  podiumEl.innerHTML = podiumOrder
    .filter(i => i < podiumPlayers.length)
    .map(i => {
      const p = podiumPlayers[i];
      const place = i + 1;
      const scoreClass = p.score > 0 ? 'positive' : p.score < 0 ? 'negative' : 'zero';
      const scoreStr = p.score > 0 ? `+${p.score}` : String(p.score);
      return `
        <div class="podium__place podium__place--${place}">
          <div class="podium__medal">${medals[i]}</div>
          <div class="podium__name">${escHtml(p.name)}</div>
          <div class="podium__score podium__score--${scoreClass}">${scoreStr}</div>
          <div class="podium__bar"></div>
        </div>`;
    })
    .join('');

  // Remaining players (4th and beyond)
  if (ranked.length > 3) {
    restEl.innerHTML = ranked.slice(3).map((p, i) => {
      const scoreClass = p.score > 0 ? 'positive' : p.score < 0 ? 'negative' : 'zero';
      const scoreStr = p.score > 0 ? `+${p.score}` : String(p.score);
      return `
        <div class="leaderboard-rest__item">
          <span class="leaderboard-rest__rank">${i + 4}.</span>
          <span class="leaderboard-rest__name">${escHtml(p.name)}</span>
          <span class="leaderboard-rest__score podium__score--${scoreClass}">${scoreStr}</span>
        </div>`;
    }).join('');
  } else {
    restEl.innerHTML = '';
  }

  $('#leaderboard-overlay').classList.add('active');
}

function closeLeaderboard() {
  $('#leaderboard-overlay').classList.remove('active');
  navigateTo('home', { replace: true });
  screenStack.length = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════════════════════
function renderHistory() {
  const games = GameStore.getAll().slice().reverse();
  const list = $('#history-list');
  const empty = $('#history-empty');

  if (games.length === 0) {
    list.innerHTML = '';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = games.map(g => {
    const playerNames = g.playerIds
      .map(id => PlayerStore.get(id)?.name || '?')
      .join(', ');
    const date = new Date(g.createdAt).toLocaleDateString('sv-SE', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const badge = g.status === 'active'
      ? '<span class="history-item__badge history-item__badge--active">Pågår</span>'
      : '<span class="history-item__badge history-item__badge--completed">Avslutad</span>';

    return `<div class="history-item" data-game="${g.id}">
      <div class="history-item__date">${date} ${badge}</div>
      <div class="history-item__players">${escHtml(playerNames)}</div>
      <div class="history-item__stats">
        <span>${g.rounds.length} omgångar</span>
        <button class="history-item__delete" data-delete="${g.id}" aria-label="Ta bort spel">✕</button>
      </div>
    </div>`;
  }).join('');
}

function deleteGame(gameId) {
  const game = GameStore.get(gameId);
  if (!game) return;
  showConfirm('Ta bort spelet? Det kan inte återställas.', () => {
    GameStore.remove(gameId);
    renderHistory();
  });
}

function viewGame(gameId) {
  const game = GameStore.get(gameId);
  if (!game) return;

  // If it's the active game, go to game screen
  if (game.status === 'active') {
    activeGame = game;
    navigateTo('game');
    return;
  }

  // Render read-only protocol
  const table = calculateScoreTable(game);
  const players = game.playerIds.map(id => PlayerStore.get(id) || { id, name: '?' });

  $('#view-protocol-head').innerHTML = `<tr>
    <th>#</th>
    ${players.map(p => `<th>${escHtml(p.name)}</th>`).join('')}
  </tr>`;

  $('#view-protocol-body').innerHTML = buildProtocolBody(table, players);
  $('#view-protocol-foot').innerHTML = buildProtocolFoot(table, players);

  navigateTo('view-game');
}

// ═══════════════════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════════════════
function renderStats() {
  const games = GameStore.getAll();
  const players = PlayerStore.getAll();

  const gamesWithRounds = games.filter(g => g.status === 'completed' && g.rounds.length > 0);
  const emptyEl = $('#stats-empty');
  const tabsEl = $('#stats-tabs');

  if (gamesWithRounds.length === 0) {
    emptyEl.style.display = '';
    tabsEl.style.display = 'none';
    $$('.stats-panel').forEach(el => el.style.display = 'none');
    return;
  }

  emptyEl.style.display = 'none';
  tabsEl.style.display = '';
  $$('.stats-panel').forEach(el => el.style.display = '');

  cachedStats = computeAdvancedStats(games, players);

  // Render active tab
  const activeTab = $('.stats-tab.active')?.dataset.tab || 'leaderboard';
  renderStatsTab(activeTab);
}

function switchStatsTab(tab) {
  $$('.stats-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  $$('.stats-panel').forEach(el => el.classList.remove('active'));
  $(`#stats-${tab}`).classList.add('active');
  renderStatsTab(tab);
}

function renderStatsTab(tab) {
  if (!cachedStats) return;
  switch (tab) {
    case 'leaderboard': renderLeaderboard(); break;
    case 'players': renderPlayerStats(); break;
    case 'cards': renderCardStats(); break;
    case 'scores': renderScoreDistribution(); break;
    case 'records': renderRecords(); break;
  }
}

/**
 * Render a score distribution as columns along a horizontal score axis:
 * losses to the left, wins to the right, bar height = share of the values.
 * With two series the second is drawn in front of the first, so a single
 * player can be read against the overall distribution.
 */
function histogramHtml(title, series, unit) {
  const hist = buildHistogram(series);
  if (!hist) return '';

  const primary = hist.series[hist.series.length - 1];
  const reference = hist.series.length > 1 ? hist.series[0] : null;
  const scale = hist.maxShare || 100;

  // Label the axis at the zero boundary and at even intervals from there.
  const zeroIndex = hist.buckets.findIndex(b => b.from === 0);
  const tickEvery = Math.max(1, Math.ceil(hist.buckets.length / 7));

  const columns = hist.buckets.map((b, i) => {
    const tick = Math.abs(i - (zeroIndex < 0 ? 0 : zeroIndex)) % tickEvery === 0
      ? `${formatScore(b.from)}` : '';
    const bars = hist.series.map(s => {
      const entry = b.values[s.key];
      const height = entry.share / scale * 100;
      const kind = s.key === primary.key
        ? (b.from >= 0 ? 'histogram__bar--positive' : 'histogram__bar--negative')
        : 'histogram__bar--reference';
      return `<div class="histogram__bar ${kind}" style="height: ${height.toFixed(1)}%"></div>`;
    }).join('');
    const tip = hist.series.map(s =>
      `${escHtml(s.label)}: ${b.values[s.key].count} (${b.values[s.key].share}%)`).join(' · ');
    return `<div class="histogram__col${b.from === 0 ? ' histogram__col--zero' : ''}"
      title="${formatScore(b.from)}…${formatScore(b.to - 1)} — ${tip}">
      <div class="histogram__bars">${bars}</div>
      <span class="histogram__tick">${tick}</span>
    </div>`;
  }).join('');

  const legend = reference ? `
    <div class="chart-legend">
      <span class="chart-legend__key chart-legend__key--reference"></span>${escHtml(reference.label)}
      <span class="chart-legend__key chart-legend__key--primary"></span>${escHtml(primary.label)}
    </div>` : '';

  return `
    <h3 class="stats-section-title">${escHtml(title)}</h3>
    <div class="histogram">
      <div class="histogram__meta">
        ${primary.total} ${escHtml(unit)} &middot; snitt ${formatScore(primary.average)} &middot;
        lägst ${formatScore(primary.min)} &middot; högst ${formatScore(primary.max)}
      </div>
      ${legend}
      <div class="histogram__scroll">
        <div class="histogram__plot${reference ? '' : ' histogram__plot--single'}">${columns}</div>
      </div>
      <div class="histogram__axis-note">Andel av ${escHtml(unit)} per ${hist.bucketSize} poäng (topp ${hist.maxShare}%)</div>
    </div>`;
}

/**
 * A card frequency list for one player, with everyone else's frequency drawn
 * behind it. Both series are shares of their own totals, so a player with a
 * handful of rounds stays comparable to the whole group. The full deck is
 * listed in canonical order, so cards the player never uses are visible too.
 * @param {string} totalKey - The card stat holding the overall count
 */
function cardFrequencyHtml(title, playerName, playerCounts, totalKey, barClass) {
  const cards = getCardsInDisplayOrder(cachedStats.cards);
  const playerTotal = Object.values(playerCounts).reduce((sum, n) => sum + n, 0);
  const allTotal = cards.reduce((sum, c) => sum + c[totalKey], 0);
  if (playerTotal === 0 && allTotal === 0) return '';

  const rows = cards.map(c => ({
    card: c,
    count: playerCounts[c.id] || 0,
    playerShare: playerTotal ? (playerCounts[c.id] || 0) / playerTotal * 100 : 0,
    allShare: allTotal ? c[totalKey] / allTotal * 100 : 0,
  }));
  const scale = Math.max(...rows.flatMap(r => [r.playerShare, r.allShare]), 1);

  return `
    <h3 class="stats-section-title">${escHtml(title)}</h3>
    <div class="chart-legend">
      <span class="chart-legend__key chart-legend__key--reference"></span>Alla spelare
      <span class="chart-legend__key chart-legend__key--primary"></span>${escHtml(playerName)}
    </div>
    <div class="card-freq-list">
      ${rows.map(r => `<div class="card-freq-item"
        title="Alla spelare: ${r.allShare.toFixed(1)}% &middot; ${escHtml(playerName)}: ${r.playerShare.toFixed(1)}% (${r.count})">
        <span class="card-freq-name">${escHtml(r.card.name)} <span style="color:var(--text-muted);font-size:0.75rem">${r.card.points}p</span></span>
        <div class="card-freq-bar-wrap">
          <div class="card-freq-bar card-freq-bar--reference" style="width: ${(r.allShare / scale * 100).toFixed(1)}%"></div>
          <div class="card-freq-bar card-freq-bar--player ${barClass}" style="width: ${(r.playerShare / scale * 100).toFixed(1)}%"></div>
        </div>
        <span class="card-freq-count">${r.count}</span>
      </div>`).join('')}
    </div>`;
}

function renderScoreDistribution() {
  const container = $('#scores-content');
  const { roundScores, gameScores } = cachedStats.scores;

  const html = histogramHtml('Omgångspoäng — alla spelare',
      [{ key: 'all', label: 'Alla spelare', values: roundScores }], 'omgångar')
    + histogramHtml('Spelpoäng — alla spelare',
      [{ key: 'all', label: 'Alla spelare', values: gameScores }], 'spelresultat');

  container.innerHTML = html
    || '<div class="empty-state"><div class="empty-state__text">Ingen poängdata ännu.</div></div>';
}

function renderLeaderboard() {
  const leaderboard = getLeaderboard(cachedStats.players);
  const container = $('#leaderboard-content');

  if (leaderboard.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state__text">Ingen data ännu.</div></div>';
    return;
  }

  container.innerHTML = `<div class="leaderboard">${leaderboard.map(p => {
    const scoreClass = p.totalScore > 0 ? 'positive' : p.totalScore < 0 ? 'negative' : 'zero';
    return `<div class="leaderboard-item">
      <div class="leaderboard-rank">${p.rank}</div>
      <div class="leaderboard-avatar">${avatarInitial(p.name)}</div>
      <div class="leaderboard-info">
        <button class="leaderboard-name-btn" data-player-goto="${escHtml(p.id)}">${escHtml(p.name)}</button>
        <div class="leaderboard-meta">${p.gamesPlayed} spel &middot; ${p.roundsWon} v/${p.roundsPlayed} r &middot; ${p.gameWinRate}% vinstprocent</div>
      </div>
      <div class="leaderboard-score ${scoreClass}">${p.totalScore > 0 ? '+' : ''}${p.totalScore}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderPlayerStats() {
  const players = PlayerStore.getAll().filter(p => cachedStats.players[p.id]?.gamesPlayed > 0);
  const selector = $('#stats-player-selector');
  const detail = $('#player-detail-content');

  if (players.length === 0) {
    selector.innerHTML = '';
    detail.innerHTML = '<div class="empty-state"><div class="empty-state__text">Ingen spelardata ännu.</div></div>';
    return;
  }

  // Auto-select first player if none selected
  if (!selectedStatsPlayerId || !players.find(p => p.id === selectedStatsPlayerId)) {
    selectedStatsPlayerId = players[0].id;
  }

  selector.innerHTML = players.map(p =>
    `<button class="stats-player-btn ${p.id === selectedStatsPlayerId ? 'active' : ''}" data-player-stats="${p.id}">${escHtml(p.name)}</button>`
  ).join('');

  renderPlayerDetail(selectedStatsPlayerId);
}

function renderPlayerDetail(playerId) {
  const ps = cachedStats.players[playerId];
  const player = PlayerStore.get(playerId);
  if (!ps || !player) return;

  const detail = $('#player-detail-content');
  const commonCard = getMostCommonCard(ps);
  const commonWinnerCard = getMostCommonWinnerCard(ps);
  const avgScore = ps.avgScorePerRound;
  const avgClass = avgScore > 0 ? 'positive' : avgScore < 0 ? 'negative' : '';

  // Score history chart — zero on the middle line, wins up and losses down
  let chartHtml = '';
  if (ps.scoreHistory.length > 1) {
    const scores = ps.scoreHistory.map(h => h.score);
    const maxAbs = Math.max(...scores.map(Math.abs), 1);
    chartHtml = `
      <h3 class="stats-section-title">Poängutveckling</h3>
      <div class="score-chart">
        <div class="score-chart__bars">
          <div class="score-chart__zero-line"></div>
          ${scores.map(s => {
            // Half the chart height is the full scale, so zero stays in the middle.
            const pct = s === 0 ? 0 : Math.max(Math.abs(s) / maxAbs * 50, 2);
            const cls = s >= 0 ? 'score-chart__bar--positive' : 'score-chart__bar--negative';
            return `<div class="score-chart__slot" title="${s > 0 ? '+' : ''}${s}">
              <div class="score-chart__bar ${cls}" style="height: ${pct.toFixed(1)}%"></div>
            </div>`;
          }).join('')}
        </div>
        <div class="score-chart__scale">
          <span>+${maxAbs}</span><span>0</span><span>-${maxAbs}</span>
        </div>
      </div>`;
  }

  // Score distributions, with the overall distribution behind them for comparison
  const roundHistHtml = histogramHtml('Fördelning — omgångspoäng', [
    { key: 'all', label: 'Alla spelare', values: cachedStats.scores.roundScores },
    { key: 'player', label: player.name, values: ps.roundScores },
  ], 'omgångar');
  const gameHistHtml = histogramHtml('Fördelning — spelpoäng', [
    { key: 'all', label: 'Alla spelare', values: cachedStats.scores.gameScores },
    { key: 'player', label: player.name, values: ps.scoreHistory.map(h => h.score) },
  ], 'spelresultat');

  // Card frequencies, each measured against everyone else's
  const winnerCardHtml = cardFrequencyHtml('Vinnarkort', player.name,
    ps.winnerCardFrequency, 'timesWon', 'card-freq-bar--winner');
  const cardHtml = cardFrequencyHtml('Kort som förlorare', player.name,
    ps.cardFrequency, 'timesPlayed', '');

  // Head-to-head — most played opponent first
  let h2hHtml = '';
  const opponents = Object.entries(ps.opponents)
    .sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses) || b[1].wins - a[1].wins);
  if (opponents.length > 0) {
    h2hHtml = `
      <h3 class="stats-section-title">Mot andra spelare</h3>
      <div class="h2h-list">
        ${opponents.map(([oppId, rec]) => {
          const opp = PlayerStore.get(oppId);
          if (!opp) return '';
          const total = rec.wins + rec.losses;
          const winPct = total > 0 ? Math.round(rec.wins / total * 100) : 0;
          return `<div class="h2h-item">
            <span class="h2h-name">${escHtml(opp.name)}</span>
            <span class="h2h-record"><span class="h2h-wins">${rec.wins}V</span> / <span class="h2h-losses">${rec.losses}F</span></span>
            <span class="h2h-pct" title="Vinstprocent mot ${escHtml(opp.name)}">${total > 0 ? winPct + '%' : '—'}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  // Streak
  let streakText = '—';
  if (ps.currentStreak.type === 'win') {
    streakText = `${ps.currentStreak.count} vinst${ps.currentStreak.count > 1 ? 'er' : ''} i rad`;
  } else if (ps.currentStreak.type === 'loss') {
    streakText = `${ps.currentStreak.count} förlust${ps.currentStreak.count > 1 ? 'er' : ''} i rad`;
  }

  detail.innerHTML = `
    <div class="player-detail-header">
      <div class="player-detail-avatar">${avatarInitial(player.name)}</div>
      <div class="player-detail-name">${escHtml(player.name)}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card__value">${ps.gamesPlayed}</div>
        <div class="stat-card__label">Spel</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${ps.gamesWon}</div>
        <div class="stat-card__label">Vunna spel</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${ps.roundsWon}</div>
        <div class="stat-card__label">Vunna rundor</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${ps.winRate}%</div>
        <div class="stat-card__label">Vinstprocent</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value ${ps.totalScore > 0 ? 'positive' : ps.totalScore < 0 ? 'negative' : ''}">${ps.totalScore > 0 ? '+' : ''}${ps.totalScore}</div>
        <div class="stat-card__label">Totalpoäng</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value ${avgClass}">${avgScore > 0 ? '+' : ''}${avgScore}</div>
        <div class="stat-card__label">Snitt/runda</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value positive">${ps.bestRoundScore !== null ? '+' + ps.bestRoundScore : '—'}</div>
        <div class="stat-card__label">Bästa runda</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value negative">${ps.worstRoundScore !== null ? ps.worstRoundScore : '—'}</div>
        <div class="stat-card__label">Sämsta runda</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${ps.nekenGiven}</div>
        <div class="stat-card__label">Neken (fått)</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${ps.nekenAsWinner}</div>
        <div class="stat-card__label">Neken (vunnit)</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${commonCard ? escHtml(commonCard.card.name) : '—'}</div>
        <div class="stat-card__label">Vanligaste kort</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${commonWinnerCard ? escHtml(commonWinnerCard.card.name) : '—'}</div>
        <div class="stat-card__label">Vanligaste vinnarkort</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${streakText}</div>
        <div class="stat-card__label">Streak</div>
      </div>
    </div>

    ${chartHtml}
    ${roundHistHtml}
    ${gameHistHtml}
    ${winnerCardHtml}
    ${cardHtml}
    ${h2hHtml}
  `;
}

function renderCardStats() {
  const container = $('#cards-content');
  // The whole deck, always in the same order: Harlekin first, Blaren last.
  const allCards = getCardsInDisplayOrder(cachedStats.cards);

  if (!allCards.some(c => c.timesPlayed > 0 || c.timesWon > 0)) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state__text">Ingen kortdata ännu.</div></div>';
    return;
  }

  const freqKey = heatmapMode === 'winner' ? 'winnerFrequency' : 'playerFrequency';

  const playerTotals = {};
  allCards.forEach(c => {
    Object.entries(c[freqKey]).forEach(([pid, cnt]) => {
      playerTotals[pid] = (playerTotals[pid] || 0) + cnt;
    });
  });
  const heatmapPlayers = Object.entries(playerTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([pid]) => ({ id: pid, name: PlayerStore.get(pid)?.name || '?' }));

  // Global max cell value for color scaling
  const globalMax = heatmapPlayers.length > 0
    ? Math.max(...allCards.flatMap(c => heatmapPlayers.map(p => c[freqKey][p.id] || 0)), 1)
    : 1;

  function heatColor(val) {
    if (val === 0) return null;
    const t = val / globalMax;
    if (heatmapMode === 'winner') {
      // blue tones for winner
      const r = Math.round(235 - t * (235 - 30));
      const g = Math.round(235 - t * (235 - 100));
      const b = Math.round(245 - t * (245 - 220));
      return `rgb(${r},${g},${b})`;
    }
    const r = Math.round(245 - t * (245 - 26));
    const g = Math.round(239 - t * (239 - 77));
    const b = Math.round(224 - t * (224 - 46));
    return `rgb(${r},${g},${b})`;
  }

  const heatmapHtml = `
    <div class="heatmap-header">
      <h3 class="stats-section-title">Heatmap — spelare vs kort</h3>
      <div class="heatmap-filter">
        <button class="heatmap-filter-btn ${heatmapMode === 'loser' ? 'active' : ''}" data-heatmap-mode="loser">Sista kort</button>
        <button class="heatmap-filter-btn ${heatmapMode === 'winner' ? 'active' : ''}" data-heatmap-mode="winner">Vinnarkort</button>
      </div>
    </div>
    <div class="heatmap-wrap">
      <table class="heatmap-table">
        <thead>
          <tr>
            <th class="hm-card-col">Kort</th>
            <th>p</th>
            ${heatmapPlayers.map(p => `<th>${escHtml(p.name)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${allCards.map(c => {
            return `<tr>
              <td class="hm-card-label">${escHtml(c.name)}</td>
              <td class="hm-card-pts">${c.points}</td>
              ${heatmapPlayers.map(p => {
                const v = c[freqKey][p.id] || 0;
                const bg = heatColor(v);
                const style = bg ? `background:${bg};color:#fff` : '';
                return `<td class="heatmap-cell" data-v="${v}" style="${style}">${v || ''}</td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  // One list per card: how often it won, how often it lost, and the win share.
  // The bar length is the card's total appearances, split into a winning and a
  // losing part, so both stories are readable in the same row.
  const maxTotal = Math.max(...allCards.map(c => c.timesWon + c.timesPlayed), 1);

  const cardListHtml = `
    <div class="card-freq-legend">
      <span class="card-freq-legend-item"><i class="card-freq-swatch card-freq-swatch--winner"></i>Vinnarkort</span>
      <span class="card-freq-legend-item"><i class="card-freq-swatch card-freq-swatch--loser"></i>Kort som förlorare</span>
    </div>
    <div class="card-freq-list">
      ${allCards.map(c => {
        const total = c.timesWon + c.timesPlayed;
        const totalPct = Math.round(total / maxTotal * 100);
        const winShare = total > 0 ? c.timesWon / total * 100 : 0;
        const winPct = Math.round(winShare);
        return `<div class="card-freq-item">
          <span class="card-freq-name">${escHtml(c.name)} <span style="color:var(--text-muted);font-size:0.75rem">${c.points}p</span></span>
          <div class="card-freq-bar-wrap" title="${c.timesWon} vinster / ${c.timesPlayed} förluster">
            <div class="card-freq-stack" style="width: ${totalPct}%">
              <div class="card-freq-seg card-freq-seg--winner" style="width: ${winShare.toFixed(1)}%"></div>
              <div class="card-freq-seg card-freq-seg--loser"></div>
            </div>
          </div>
          <span class="card-freq-count"><span class="card-freq-wins">${c.timesWon}V</span> / <span class="card-freq-losses">${c.timesPlayed}F</span>${c.timesWithNeken > 0 ? ` <span class="neken-badge">N${c.timesWithNeken}</span>` : ''}</span>
          <span class="card-freq-pct">${total > 0 ? winPct + '%' : '—'}</span>
        </div>`;
      }).join('')}
    </div>`;

  container.innerHTML = `
    <h3 class="stats-section-title">Kort — vinster och förluster</h3>
    ${cardListHtml}

    ${heatmapHtml}
  `;
}

function renderRecords() {
  const container = $('#records-content');
  const r = cachedStats.records;

  const items = [
    { icon: '🏆', title: 'Flest vunna spel', record: r.mostGamesWon, format: v => `${v} spel`, valueKey: 'count' },
    { icon: '⚜', title: 'Flest vunna rundor', record: r.mostRoundsWon, format: v => `${v} rundor`, valueKey: 'count' },
    { icon: '🎮', title: 'Flest spelade spel', record: r.mostGamesPlayed, format: v => `${v} spel`, valueKey: 'count' },
    { icon: '🔥', title: 'Bästa runda (poäng)', record: r.highestRoundScore, format: v => `+${v}`, valueKey: 'score' },
    { icon: '💀', title: 'Sämsta runda (poäng)', record: r.lowestRoundScore, format: v => `${v}`, valueKey: 'score' },
    { icon: '📈', title: 'Bästa spel (totalt)', record: r.highestGameScore, format: v => `+${v}`, valueKey: 'score' },
    { icon: '📉', title: 'Sämsta spel (totalt)', record: r.lowestGameScore, format: v => `${v}`, valueKey: 'score' },
    { icon: '😈', title: 'Flest neken', record: r.mostNeken, format: v => `${v} gånger`, valueKey: 'count' },
    { icon: '🔥', title: 'Längsta vinstsvit', record: r.longestWinStreak, format: v => `${v} spel`, valueKey: 'count' },
  ].filter(item => item.record);

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state__text">Inga rekord ännu.</div></div>';
    return;
  }

  container.innerHTML = `<div class="records-list">${items.map(item => {
    const names = item.record.holders.map(h => escHtml(h.name)).join(', ');
    const formattedValue = item.format(item.record.value);
    return `
    <div class="record-item">
      <div class="record-icon">${item.icon}</div>
      <div class="record-info">
        <div class="record-title">${item.title}</div>
        <div class="record-holder">${names}</div>
      </div>
      <div class="record-value">${formattedValue}</div>
    </div>`;
  }).join('')}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════════════════════
let confirmCallback = null;

function showConfirm(message, onConfirm) {
  $('#confirm-text').textContent = message;
  confirmCallback = onConfirm;
  $('#confirm-dialog').classList.add('active');
}

function closeConfirm() {
  $('#confirm-dialog').classList.remove('active');
  confirmCallback = null;
}

// ─── Input prompt dialog ──────────────────────────────────────────────────────
let promptCallback = null;

function showPrompt(message, options = {}, onSubmit) {
  $('#input-dialog-text').textContent = message;
  const field = $('#input-dialog-field');
  field.value = options.value || '';
  field.placeholder = options.placeholder || '';
  promptCallback = onSubmit;
  $('#input-dialog').classList.add('active');
  setTimeout(() => field.focus(), 50);
}

function submitPrompt() {
  const cb = promptCallback;
  const value = $('#input-dialog-field').value;
  closePrompt();
  if (cb) cb(value);
}

function closePrompt() {
  $('#input-dialog').classList.remove('active');
  promptCallback = null;
}

// ─── Protocol question (low-stake round) ──────────────────────────────────────
let protocolCallback = null;

function showProtocolQuestion(winnerScore, onAnswer) {
  $('#protocol-text').textContent =
    `Omgången är värd endast ${winnerScore} poäng. Ska omgången protokollföras (räknas i ställningen)?`;
  protocolCallback = onAnswer;
  $('#protocol-dialog').classList.add('active');
}

function answerProtocolQuestion(counted) {
  const cb = protocolCallback;
  protocolCallback = null;
  $('#protocol-dialog').classList.remove('active');
  if (cb) cb(counted);
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT / EXPORT
// ═══════════════════════════════════════════════════════════════════════════
function handleExport() {
  downloadExport();
  Activity.track('feature_used', { feature: 'export' });
  showToast('Data exporterad');
}

function handleImport() {
  $('#input-import-file').click();
}

async function handleImportFile(file) {
  if (!file) return;
  try {
    const { playersAdded, gamesAdded } = await importFile(file);
    // Invalidate store caches so the app reads fresh data
    PlayerStore.invalidate();
    GameStore.invalidate();
    activeGame = GameStore.getActive();
    renderHome();
    showToast(`Importerat: ${gamesAdded} spel, ${playersAdded} nya spelare`);
  } catch (err) {
    showToast(`Import misslyckades: ${err.message}`);
  }
  // Reset file input so the same file can be imported again if needed
  $('#input-import-file').value = '';
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════════════════════════════
function bindEvents() {
  // Navigation
  $('#btn-back').addEventListener('click', goBack);
  $('#btn-players').addEventListener('click', () => navigateTo('players'));
  $('#btn-new-game').addEventListener('click', () => {
    selectedPlayerIds.clear();
    navigateTo('setup');
  });
  $('#btn-continue-game').addEventListener('click', () => {
    activeGame = GameStore.getActive();
    if (activeGame) navigateTo('game');
  });
  $('#btn-history').addEventListener('click', () => navigateTo('history'));
  $('#btn-stats').addEventListener('click', () => navigateTo('stats'));
  $('#btn-card-values').addEventListener('click', () => navigateTo('cards'));
  $('#btn-rules').addEventListener('click', () => navigateTo('rules'));
  $('#btn-print-cards').addEventListener('click', () => window.print());
  $('#btn-export').addEventListener('click', handleExport);
  $('#btn-import').addEventListener('click', handleImport);
  $('#input-import-file').addEventListener('change', e => handleImportFile(e.target.files[0]));

  // Player management
  $('#btn-add-player').addEventListener('click', addPlayer);
  $('#input-player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPlayer();
  });
  $('#player-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remove"]');
    if (btn) removePlayer(btn.dataset.id);
  });

  // Game setup
  $('#setup-grid').addEventListener('click', (e) => {
    const el = e.target.closest('.setup-player');
    if (el) toggleSetupPlayer(el.dataset.id);
  });
  $('#btn-start-game').addEventListener('click', startGame);

  // Game actions
  $('#btn-new-round').addEventListener('click', openRoundModal);
  $('#btn-undo-round').addEventListener('click', undoLastRound);
  $('#btn-end-game').addEventListener('click', endGame);
  $('#btn-leaderboard-close').addEventListener('click', closeLeaderboard);

  // Round modal
  $('#btn-cancel-round').addEventListener('click', closeRoundModal);
  $('#btn-confirm-round').addEventListener('click', confirmRound);

  // Stand-by toggles
  $('#standby-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.standby-toggle');
    if (btn) toggleStandby(btn.dataset.id);
  });

  // Winner selection
  $('#winner-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.winner-btn');
    if (btn) selectWinner(btn.dataset.id);
  });

  // Winner card assignment
  $('#winner-card-assignment').addEventListener('click', (e) => {
    const cardBtn = e.target.closest('.loser-row__card-btn');
    if (cardBtn) openCardPicker(WINNER_CARD_TARGET);
  });

  // Loser card assignment
  $('#loser-assignments').addEventListener('click', (e) => {
    const nekenBtn = e.target.closest('.loser-row__neken-btn');
    if (nekenBtn) { toggleNeken(nekenBtn.dataset.nekenPlayer); return; }
    const cardBtn = e.target.closest('.loser-row__card-btn');
    if (cardBtn) openCardPicker(cardBtn.dataset.player);
  });

  // Card picker
  $$('#picker-picture-cards, #picker-number-cards, #picker-zero-cards').forEach(grid => {
    grid.addEventListener('click', (e) => {
      const tile = e.target.closest('.card-tile');
      if (tile) selectCard(tile.dataset.card);
    });
  });

  // Close card picker on overlay click
  $('#card-picker-overlay').addEventListener('click', (e) => {
    if (e.target === $('#card-picker-overlay')) closeCardPicker();
  });

  // Close round modal on overlay click
  $('#modal-round').addEventListener('click', (e) => {
    if (e.target === $('#modal-round')) closeRoundModal();
  });

  // Confirm dialog
  $('#confirm-yes').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirm();
  });
  $('#confirm-no').addEventListener('click', closeConfirm);

  // Protocol question (low-stake round)
  $('#protocol-yes').addEventListener('click', () => answerProtocolQuestion(true));
  $('#protocol-no').addEventListener('click', () => answerProtocolQuestion(false));

  // Stats
  $('#stats-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.stats-tab');
    if (tab) switchStatsTab(tab.dataset.tab);
  });
  $('#stats-player-selector').addEventListener('click', (e) => {
    const btn = e.target.closest('.stats-player-btn');
    if (btn) {
      selectedStatsPlayerId = btn.dataset.playerStats;
      renderPlayerStats();
    }
  });

  $('#leaderboard-content').addEventListener('click', (e) => {
    const btn = e.target.closest('.leaderboard-name-btn');
    if (btn) {
      selectedStatsPlayerId = btn.dataset.playerGoto;
      switchStatsTab('players');
    }
  });

  $('#cards-content').addEventListener('click', (e) => {
    const btn = e.target.closest('.heatmap-filter-btn');
    if (btn) {
      heatmapMode = btn.dataset.heatmapMode;
      renderCardStats();
    }
  });

  // History
  $('#history-list').addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.history-item__delete');
    if (deleteBtn) {
      deleteGame(deleteBtn.dataset.delete);
      return;
    }
    const item = e.target.closest('.history-item');
    if (item) viewGame(item.dataset.game);
  });

  // Swipe to dismiss bottom sheets
  addSwipeToDismiss($('.modal'), closeRoundModal);
  addSwipeToDismiss($('.card-picker'), closeCardPicker);

  bindGroupEvents();
}

// ─── Group / welcome event binding ────────────────────────────────────────────
function bindGroupEvents() {
  // Welcome / mode selection
  $('#btn-welcome-join').addEventListener('click', () => {
    resetWelcomeForms();
    $('#welcome-join-form').style.display = '';
    $('#input-join-code').focus();
  });
  $('#btn-welcome-create').addEventListener('click', () => {
    resetWelcomeForms();
    $('#welcome-create-form').style.display = '';
    $('#input-create-name').focus();
  });
  $('#btn-welcome-local').addEventListener('click', enterLocalMode);
  $('#btn-welcome-admin').addEventListener('click', openAdmin);
  $('#btn-do-join').addEventListener('click', doJoin);
  $('#btn-do-create').addEventListener('click', doCreate);
  $('#input-join-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
  $('#btn-welcome-back').addEventListener('click', () => {
    if (Session.hasChosen()) { navigateTo('home', { replace: true }); screenStack.length = 0; }
  });
  $$('[data-welcome-cancel]').forEach(btn =>
    btn.addEventListener('click', resetWelcomeForms));

  // Mode bar (home) → open group screen or welcome
  $('#mode-bar').addEventListener('click', (e) => {
    if (!e.target.closest('#mode-bar-manage')) return;
    if (Session.isGroup()) navigateTo('group');
    else showWelcome();
  });

  // Input prompt dialog
  $('#input-dialog-ok').addEventListener('click', submitPrompt);
  $('#input-dialog-cancel').addEventListener('click', closePrompt);
  $('#input-dialog-field').addEventListener('keydown', e => { if (e.key === 'Enter') submitPrompt(); });

  // Group screen (delegated)
  $('#group-content').addEventListener('click', (e) => {
    if (e.target.closest('#btn-invite')) return inviteToGroup();
    if (e.target.closest('#btn-copy-code')) return copyJoinCode();
    if (e.target.closest('#btn-copy-url')) return copyGroupUrl();
    if (e.target.closest('#btn-group-refresh')) return refreshGroup(false);
    if (e.target.closest('#btn-group-leave')) return leaveGroup();
    if (e.target.closest('#btn-admin-unlock')) return unlockAdmin();
    if (e.target.closest('#btn-admin-rename')) return adminRename();
    if (e.target.closest('#btn-admin-regen')) return adminRegenCode();
    if (e.target.closest('#btn-admin-setcode')) return adminSetCode();
    if (e.target.closest('#btn-admin-delete')) return adminDelete();
    const promote = e.target.closest('[data-promote]');
    if (promote) return adminSetRole(promote.dataset.promote, 'admin');
    const demote = e.target.closest('[data-demote]');
    if (demote) return adminSetRole(demote.dataset.demote, 'member');
    const removeMember = e.target.closest('[data-remove-member]');
    if (removeMember) return adminRemoveMember(removeMember.dataset.removeMember);
  });

  // Super-admin console (delegated)
  $('#admin-content').addEventListener('click', (e) => {
    if (e.target.closest('#sa-share-link')) return shareAdminLink();
    if (e.target.closest('#sa-login')) return saLogin();
    if (e.target.closest('#sa-bootstrap')) return saBootstrap();
    if (e.target.closest('#sa-logout')) return saLogout();
    if (e.target.closest('#sa-create')) return saCreateGroup();
    if (e.target.closest('#sa-feed-more')) return saFeedMore();
    const tab = e.target.closest('[data-sa-tab]'); if (tab) return saShowTab(tab.dataset.saTab);
    const rename = e.target.closest('[data-sa-rename]'); if (rename) return saRename(rename.dataset.saRename);
    const slug = e.target.closest('[data-sa-slug]'); if (slug) return saSetSlug(slug.dataset.saSlug);
    const regen = e.target.closest('[data-sa-regen]'); if (regen) return saRegen(regen.dataset.saRegen);
    const users = e.target.closest('[data-sa-users]'); if (users) return saViewUsers(users.dataset.saUsers);
    const del = e.target.closest('[data-sa-delete]'); if (del) return saDelete(del.dataset.saDelete);
    const rmUser = e.target.closest('[data-sa-rmuser]'); if (rmUser) return saRemoveMember(rmUser.dataset.saRmuser);
    const rmPlayer = e.target.closest('[data-sa-rmplayer]'); if (rmPlayer) return saRemovePlayer(rmPlayer.dataset.saRmplayer);
  });
  $('#admin-content').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.id === 'sa-user' || e.target.id === 'sa-pass')) saLogin();
  });
  $('#admin-content').addEventListener('change', (e) => {
    if (e.target.id === 'sa-feed-filter') saFilterFeed(e.target.value);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════
function init() {
  initCardPicker();
  bindEvents();
  onSyncStatus(handleSyncStatus);

  // Produktanalys: registrera PWA-installation (grupp-läge loggar, lokalt no-op).
  window.addEventListener('appinstalled', () => Activity.track('pwa_install'));

  // Restore active game if any
  activeGame = GameStore.getActive();

  // Group mode: flush any pending changes and refresh from the central DB.
  if (Session.isGroup()) {
    Outbox.flush();
    window.addEventListener('online', () => { Outbox.flush(); refreshGroup(true); });
  }

  // URL routing takes priority: /?admin=1 opens the console, /?g=<slug> a group.
  const urlSlug = SUPABASE_ENABLED ? groupSlugFromUrl() : null;
  if (SUPABASE_ENABLED && isAdminUrl()) {
    renderHome();
    openAdmin();
  } else if (urlSlug && urlSlug !== Session.group?.slug) {
    renderHome();
    enterGroupBySlug(urlSlug);
  } else if (Session.isGroup()) {
    refreshGroup(true);
    renderHome();
  } else if (SUPABASE_ENABLED && !Session.hasChosen()) {
    // First run (or after leaving a group without choosing): show the mode picker.
    showWelcome();
  } else {
    renderHome();
  }
}

document.addEventListener('DOMContentLoaded', init);
