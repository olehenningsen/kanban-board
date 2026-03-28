// State
let boardData = null;
let editingCardId = null;

// Elements
const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const board = document.getElementById('board');
const modal = document.getElementById('card-modal');
const cardForm = document.getElementById('card-form');
const addCardBtn = document.getElementById('add-card-btn');
const logoutBtn = document.getElementById('logout-btn');
const modalClose = document.getElementById('modal-close');
const modalCancel = document.getElementById('modal-cancel');
const deleteBtn = document.getElementById('delete-card-btn');
const modalTitle = document.getElementById('modal-title');
const columnSelectRow = document.getElementById('column-select-row');

// API helpers
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Auth
async function checkAuth() {
  try {
    const { authenticated } = await api('/api/auth-check');
    if (authenticated) {
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  app.classList.add('hidden');
  document.getElementById('login-password').focus();
}

function showApp() {
  loginScreen.classList.add('hidden');
  app.classList.remove('hidden');
  loadBoard();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const password = document.getElementById('login-password').value;
  try {
    await api('/api/login', { method: 'POST', body: { password } });
    showApp();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

// Board
async function loadBoard() {
  boardData = await api('/api/board');
  renderBoard();
}

function renderBoard() {
  board.innerHTML = '';
  boardData.columns.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.innerHTML = `
      <div class="column-header">
        <span>${col.title}</span>
        <span class="column-count">${col.cards.length}</span>
      </div>
      <div class="column-cards" data-column="${col.id}"></div>
    `;

    const cardsContainer = colEl.querySelector('.column-cards');

    if (col.cards.length === 0) {
      cardsContainer.innerHTML = '<div class="empty-state">Ingen kort endnu</div>';
    } else {
      col.cards.forEach(card => {
        cardsContainer.appendChild(createCardEl(card, col.id));
      });
    }

    // Drag & drop on column
    setupColumnDrop(cardsContainer, col.id);
    board.appendChild(colEl);
  });
}

function createCardEl(card, columnId) {
  const el = document.createElement('div');
  el.className = `card priority-${card.priority}`;
  el.draggable = true;
  el.dataset.cardId = card.id;
  el.dataset.columnId = columnId;

  const priorityLabels = { low: 'Lav', medium: 'Medium', high: 'Høj' };
  const dateStr = new Date(card.createdAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });

  el.innerHTML = `
    <button class="card-edit-btn" title="Rediger">✏️</button>
    <div class="card-title">${escHtml(card.title)}</div>
    ${card.description ? `<div class="card-description">${escHtml(card.description)}</div>` : ''}
    <div class="card-meta">
      <span class="card-assignee">👤 ${escHtml(card.assignee)}</span>
      <span class="card-priority-badge ${card.priority}">${priorityLabels[card.priority]}</span>
      <span>${dateStr}</span>
    </div>
  `;

  // Edit button
  el.querySelector('.card-edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(card, columnId);
  });

  // Touch: tap to edit
  el.addEventListener('click', () => openEditModal(card, columnId));

  // Drag events
  el.addEventListener('dragstart', (e) => {
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ cardId: card.id, fromColumnId: columnId }));
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  // Touch drag
  setupTouchDrag(el, card.id, columnId);

  return el;
}

function setupColumnDrop(container, columnId) {
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    container.classList.add('drag-over');
  });

  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) {
      container.classList.remove('drag-over');
    }
  });

  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    container.classList.remove('drag-over');

    try {
      const { cardId, fromColumnId } = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (fromColumnId === columnId) {
        // Reorder within column
        const cards = [...container.querySelectorAll('.card')];
        const dropY = e.clientY;
        let toIndex = cards.length;
        for (let i = 0; i < cards.length; i++) {
          const rect = cards[i].getBoundingClientRect();
          if (dropY < rect.top + rect.height / 2) {
            toIndex = i;
            break;
          }
        }
        await api('/api/move', { method: 'PUT', body: { cardId, fromColumnId, toColumnId: columnId, toIndex } });
      } else {
        await api('/api/move', { method: 'PUT', body: { cardId, fromColumnId, toColumnId: columnId } });
      }
      await loadBoard();
    } catch (err) {
      console.error('Drop failed:', err);
    }
  });
}

// Touch drag support for mobile
let touchDragData = null;
let touchClone = null;
let touchStartTime = 0;
let touchMoved = false;

function setupTouchDrag(el, cardId, columnId) {
  let longPressTimer = null;

  el.addEventListener('touchstart', (e) => {
    touchStartTime = Date.now();
    touchMoved = false;
    longPressTimer = setTimeout(() => {
      e.preventDefault();
      startTouchDrag(e, el, cardId, columnId);
    }, 400);
  }, { passive: false });

  el.addEventListener('touchmove', (e) => {
    touchMoved = true;
    if (touchDragData) {
      e.preventDefault();
      moveTouchDrag(e);
    } else if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }, { passive: false });

  el.addEventListener('touchend', (e) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (touchDragData) {
      e.preventDefault();
      endTouchDrag(e);
    }
  });
}

function startTouchDrag(e, el, cardId, columnId) {
  touchDragData = { cardId, fromColumnId: columnId };
  el.classList.add('dragging');

  touchClone = el.cloneNode(true);
  touchClone.style.position = 'fixed';
  touchClone.style.zIndex = '9999';
  touchClone.style.width = el.offsetWidth + 'px';
  touchClone.style.pointerEvents = 'none';
  touchClone.style.opacity = '0.85';
  touchClone.style.transform = 'rotate(3deg) scale(1.05)';
  touchClone.style.boxShadow = '0 8px 25px rgba(0,0,0,0.2)';
  document.body.appendChild(touchClone);

  const touch = e.touches[0];
  touchClone.style.left = (touch.clientX - el.offsetWidth / 2) + 'px';
  touchClone.style.top = (touch.clientY - 30) + 'px';

  navigator.vibrate && navigator.vibrate(30);
}

function moveTouchDrag(e) {
  if (!touchClone) return;
  const touch = e.touches[0];
  touchClone.style.left = (touch.clientX - touchClone.offsetWidth / 2) + 'px';
  touchClone.style.top = (touch.clientY - 30) + 'px';

  // Highlight target column
  document.querySelectorAll('.column-cards').forEach(c => c.classList.remove('drag-over'));
  const target = document.elementFromPoint(touch.clientX, touch.clientY);
  if (target) {
    const col = target.closest('.column-cards');
    if (col) col.classList.add('drag-over');
  }
}

async function endTouchDrag(e) {
  if (!touchDragData) return;

  const touch = e.changedTouches[0];
  const target = document.elementFromPoint(touch.clientX, touch.clientY);
  const col = target ? target.closest('.column-cards') : null;

  if (col && col.dataset.column) {
    const toColumnId = col.dataset.column;
    try {
      await api('/api/move', {
        method: 'PUT',
        body: {
          cardId: touchDragData.cardId,
          fromColumnId: touchDragData.fromColumnId,
          toColumnId
        }
      });
      await loadBoard();
    } catch (err) {
      console.error('Touch drop failed:', err);
    }
  }

  // Cleanup
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (touchClone) { touchClone.remove(); touchClone = null; }
  touchDragData = null;
}

// Modal
function openModal() {
  modal.classList.remove('hidden');
  document.getElementById('card-title').focus();
}

function closeModal() {
  modal.classList.add('hidden');
  cardForm.reset();
  editingCardId = null;
  document.getElementById('card-id').value = '';
}

addCardBtn.addEventListener('click', () => {
  editingCardId = null;
  modalTitle.textContent = 'Nyt kort';
  deleteBtn.classList.add('hidden');
  columnSelectRow.classList.remove('hidden');
  cardForm.reset();
  document.getElementById('card-target-column').value = 'backlog';
  openModal();
});

function openEditModal(card, columnId) {
  // Don't open edit if we were doing a touch drag
  if (touchDragData) return;
  if (touchMoved && Date.now() - touchStartTime > 200) return;

  editingCardId = card.id;
  modalTitle.textContent = 'Rediger kort';
  deleteBtn.classList.remove('hidden');
  columnSelectRow.classList.remove('hidden');
  document.getElementById('card-id').value = card.id;
  document.getElementById('card-column').value = columnId;
  document.getElementById('card-title').value = card.title;
  document.getElementById('card-description').value = card.description || '';
  document.getElementById('card-priority').value = card.priority;
  document.getElementById('card-assignee').value = card.assignee;
  document.getElementById('card-target-column').value = columnId;
  openModal();
}

modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
document.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
});

// Save card
cardForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const cardData = {
    title: document.getElementById('card-title').value.trim(),
    description: document.getElementById('card-description').value.trim(),
    priority: document.getElementById('card-priority').value,
    assignee: document.getElementById('card-assignee').value
  };

  const targetColumn = document.getElementById('card-target-column').value;

  try {
    if (editingCardId) {
      const currentColumn = document.getElementById('card-column').value;
      await api(`/api/cards/${editingCardId}`, { method: 'PUT', body: cardData });
      // Move if column changed
      if (targetColumn !== currentColumn) {
        await api('/api/move', {
          method: 'PUT',
          body: { cardId: editingCardId, fromColumnId: currentColumn, toColumnId: targetColumn }
        });
      }
    } else {
      await api('/api/cards', { method: 'POST', body: { columnId: targetColumn, card: cardData } });
    }
    closeModal();
    await loadBoard();
  } catch (err) {
    alert('Fejl: ' + err.message);
  }
});

// Delete card
deleteBtn.addEventListener('click', async () => {
  if (!editingCardId) return;
  if (!confirm('Er du sikker på at du vil slette dette kort?')) return;
  try {
    await api(`/api/cards/${editingCardId}`, { method: 'DELETE' });
    closeModal();
    await loadBoard();
  } catch (err) {
    alert('Fejl: ' + err.message);
  }
});

// Helpers
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Init
checkAuth();
