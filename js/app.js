/**
 * Kille Score Calculator — App UI
 * Handles all screen navigation, rendering, and user interactions.
 */
import { CARDS, getCardById, getCardsByType } from './cards.js';
import {
  PlayerStore, GameStore,
  createGame, addRound, removeLastRound, completeGame, calculateScoreTable
} from './game.js';

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
  loserCards: {} // { playerId: cardId }
};

// Card picker
let cardPickerTarget = null; // playerId being assigned
let cardPickerCallback = null;

// ═══════════════════════════════════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════════════════════════════════
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

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
}

function goBack() {
  const prev = screenStack.pop() || 'home';
  currentScreen = prev;
  $$('.screen').forEach(el => el.classList.remove('active'));
  $(`#screen-${prev}`).classList.add('active');
  updateHeader(prev);
  renderScreen(prev);
}

function updateHeader(screenId) {
  const titles = {
    home: 'Kille',
    players: 'Spelare',
    setup: 'Nytt Spel',
    game: 'Protokoll',
    history: 'Historik',
    'view-game': 'Spelprotokoll'
  };
  $('#header-title').textContent = titles[screenId] || 'Kille';
  const backBtn = $('#btn-back');
  if (screenId === 'home') {
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
    case 'view-game': break; // rendered when entering
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME SCREEN
// ═══════════════════════════════════════════════════════════════════════════
function renderHome() {
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
      <div class="player-item__avatar">${p.name.charAt(0).toUpperCase()}</div>
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
      <div class="setup-player__avatar">${p.name.charAt(0).toUpperCase()}</div>
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
  selectedPlayerIds.clear();
  navigateTo('game', { replace: true });
  // Clear stack so back goes to home
  screenStack.length = 0;
  screenStack.push('home');
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVE GAME — PROTOCOL TABLE
// ═══════════════════════════════════════════════════════════════════════════
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

  // Body (newest round at top)
  const reversedRounds = [...table.rounds].reverse();
  $('#protocol-body').innerHTML = reversedRounds.map(round => {
    const cells = players.map(p => {
      const s = round.scores[p.id];
      if (s.isStandBy) {
        return `<td><div class="protocol-cell">
          <span class="protocol-cell__round protocol-cell__round--standby">—</span>
          <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        </div></td>`;
      }
      if (s.isWinner) {
        return `<td><div class="protocol-cell">
          <span class="protocol-cell__round protocol-cell__round--winner">+${s.roundScore}</span>
          <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        </div></td>`;
      }
      const card = s.cardId ? getCardById(s.cardId) : null;
      return `<td><div class="protocol-cell">
        <span class="protocol-cell__round protocol-cell__round--loser">${s.roundScore}</span>
        <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        ${card ? `<span class="protocol-cell__card">${escHtml(card.name)}</span>` : ''}
      </div></td>`;
    }).join('');
    return `<tr><td>${round.roundNumber}</td>${cells}</tr>`;
  }).join('');

  // Footer (totals)
  $('#protocol-foot').innerHTML = `<tr>
    <td>Σ</td>
    ${players.map(p => {
      const total = table.totals[p.id] || 0;
      const cls = total > 0 ? 'total-positive' : total < 0 ? 'total-negative' : 'total-zero';
      return `<td class="${cls}">${formatScore(total)}</td>`;
    }).join('')}
  </tr>`;
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
    loserCards: {}
  };

  const roundNum = activeGame.rounds.length + 1;
  $('#round-modal-title').textContent = `Omgång ${roundNum}`;

  renderStandbyGrid();
  renderWinnerGrid();
  renderLoserAssignments();
  updateRoundPreview();

  $('#modal-round').classList.add('active');
}

function closeRoundModal() {
  $('#modal-round').classList.remove('active');
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
    // Remove from loser cards
    delete roundState.loserCards[playerId];
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
  // Remove winner from loser cards
  delete roundState.loserCards[playerId];
  renderWinnerGrid();
  renderLoserAssignments();
  updateRoundPreview();
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

  container.innerHTML = players.map(p => {
    const cardId = roundState.loserCards[p.id];
    const card = cardId ? getCardById(cardId) : null;
    const points = card ? card.points : 0;

    return `<div class="loser-row">
      <span class="loser-row__name">${escHtml(p.name)}</span>
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
  const allAssigned = losers.length > 0 && losers.every(id => roundState.loserCards[id]);

  let totalPoints = 0;
  losers.forEach(id => {
    const cardId = roundState.loserCards[id];
    if (cardId) {
      const card = getCardById(cardId);
      totalPoints += card ? card.points : 0;
    }
  });

  preview.style.display = '';
  scoreEl.textContent = `+${totalPoints}`;
  confirmBtn.disabled = !allAssigned;
}

function confirmRound() {
  if (!roundState.winnerId) return;
  const losers = getActivePlayers().filter(id => id !== roundState.winnerId);
  if (!losers.every(id => roundState.loserCards[id])) return;

  const roundData = {
    winnerId: roundState.winnerId,
    standByIds: [...roundState.standByIds],
    losers: losers.map(id => ({ playerId: id, cardId: roundState.loserCards[id] }))
  };

  activeGame = addRound(activeGame, roundData);
  closeRoundModal();
  renderGame();
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD PICKER
// ═══════════════════════════════════════════════════════════════════════════
function initCardPicker() {
  // Render card grids (static, done once)
  renderCardGroup('#picker-picture-cards', getCardsByType('picture'));
  renderCardGroup('#picker-number-cards', getCardsByType('number'));
  renderCardGroup('#picker-zero-cards', getCardsByType('zero'));
}

function renderCardGroup(selector, cards) {
  $(selector).innerHTML = cards.map(c => {
    let visual = '';
    if (c.image) {
      visual = `<img class="card-tile__image" src="${c.image}" alt="${c.name}" loading="lazy">`;
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

function openCardPicker(playerId) {
  const player = PlayerStore.get(playerId);
  $('#card-picker-title').textContent = `Välj kort för ${player?.name || '?'}`;
  cardPickerTarget = playerId;
  $('#card-picker-overlay').classList.add('active');
}

function closeCardPicker() {
  $('#card-picker-overlay').classList.remove('active');
  cardPickerTarget = null;
}

function selectCard(cardId) {
  if (cardPickerTarget) {
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
    renderGame();
  });
}

function endGame() {
  if (!activeGame) return;
  showConfirm('Avsluta spelet?', () => {
    activeGame = completeGame(activeGame);
    activeGame = null;
    navigateTo('home', { replace: true });
    screenStack.length = 0;
  });
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
      </div>
    </div>`;
  }).join('');
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

  const reversedRounds = [...table.rounds].reverse();
  $('#view-protocol-body').innerHTML = reversedRounds.map(round => {
    const cells = players.map(p => {
      const s = round.scores[p.id];
      if (s.isStandBy) {
        return `<td><div class="protocol-cell">
          <span class="protocol-cell__round protocol-cell__round--standby">—</span>
          <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        </div></td>`;
      }
      if (s.isWinner) {
        return `<td><div class="protocol-cell">
          <span class="protocol-cell__round protocol-cell__round--winner">+${s.roundScore}</span>
          <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        </div></td>`;
      }
      const card = s.cardId ? getCardById(s.cardId) : null;
      return `<td><div class="protocol-cell">
        <span class="protocol-cell__round protocol-cell__round--loser">${s.roundScore}</span>
        <span class="protocol-cell__total">${formatScore(s.runningTotal)}</span>
        ${card ? `<span class="protocol-cell__card">${escHtml(card.name)}</span>` : ''}
      </div></td>`;
    }).join('');
    return `<tr><td>${round.roundNumber}</td>${cells}</tr>`;
  }).join('');

  $('#view-protocol-foot').innerHTML = `<tr>
    <td>Σ</td>
    ${players.map(p => {
      const total = table.totals[p.id] || 0;
      const cls = total > 0 ? 'total-positive' : total < 0 ? 'total-negative' : 'total-zero';
      return `<td class="${cls}">${formatScore(total)}</td>`;
    }).join('')}
  </tr>`;

  navigateTo('view-game');
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

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatScore(score) {
  if (score > 0) return `+${score}`;
  return String(score);
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

  // Loser card assignment
  $('#loser-assignments').addEventListener('click', (e) => {
    const btn = e.target.closest('.loser-row__card-btn');
    if (btn) openCardPicker(btn.dataset.player);
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

  // History
  $('#history-list').addEventListener('click', (e) => {
    const item = e.target.closest('.history-item');
    if (item) viewGame(item.dataset.game);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════
function init() {
  initCardPicker();
  bindEvents();

  // Restore active game if any
  activeGame = GameStore.getActive();
  renderHome();
}

document.addEventListener('DOMContentLoaded', init);
