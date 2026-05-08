const { ipcRenderer } = require('electron');
const API_BASE = 'http://localhost:5000/api/torrents';

// DOM Elements
const torrentList = document.getElementById('torrent-list');
const emptyState = document.getElementById('empty-state');
const addTorrentBtn = document.getElementById('add-torrent-btn');
const addMagnetBtn = document.getElementById('add-magnet-btn');
const magnetModal = document.getElementById('magnet-modal');
const modalOverlay = document.getElementById('modal-overlay');
const closeModals = document.querySelectorAll('.close-modal');
const submitMagnet = document.getElementById('submit-magnet');
const magnetUriInput = document.getElementById('magnet-uri');
const outputDirInput = document.getElementById('output-dir');
const browseDirBtn = document.getElementById('browse-dir-btn');
const navItems = document.querySelectorAll('.nav-item');
const pageTitle = document.getElementById('page-title');
const searchInput = document.querySelector('.search-box input');

let currentTab = 'all';
let allTorrents = [];
let selectedTorrentId = null;
let searchQuery = '';
let isBackendOnline = false;
let pollTimer = null;
let isPolling = false;

// Speed tracking: stores previous snapshot for delta computation
let prevSnapshots = {}; // { id: { completedPieces, timestamp, totalSize } }

// ─── Search ───
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderTorrents();
    });
}

// ─── Tab Logic ───
navItems.forEach(item => {
    item.addEventListener('click', () => {
        navItems.forEach(ni => ni.classList.remove('active'));
        item.classList.add('active');
        currentTab = item.dataset.tab;
        pageTitle.textContent = item.textContent.trim();
        renderTorrents();
    });
});

// ─── Add Torrent (File) ───
addTorrentBtn.addEventListener('click', async () => {
    try {
        const filePath = await ipcRenderer.invoke('open-file-dialog');
        if (!filePath) return;
        const dirPath = await ipcRenderer.invoke('open-directory-dialog');
        if (!dirPath) return;

        showToast('Adding torrent…', 'info');
        const response = await fetch(`${API_BASE}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, outputDir: dirPath })
        });
        if (response.ok) {
            showToast('Torrent added!', 'success');
            refreshTorrents();
        } else {
            showToast('Failed to add torrent', 'error');
        }
    } catch (error) {
        console.error('Add torrent error:', error);
        showToast('Error adding torrent', 'error');
    }
});

// ─── Magnet Modal Logic ───
addMagnetBtn.addEventListener('click', () => {
    magnetModal.classList.add('visible');
    modalOverlay.classList.add('visible');
    magnetUriInput.focus();
});

function hideModals() {
    magnetModal.classList.remove('visible');
    modalOverlay.classList.remove('visible');
}

closeModals.forEach(btn => btn.addEventListener('click', hideModals));
modalOverlay.addEventListener('click', hideModals);

browseDirBtn.addEventListener('click', async () => {
    const dirPath = await ipcRenderer.invoke('open-directory-dialog');
    if (dirPath) outputDirInput.value = dirPath;
});

submitMagnet.addEventListener('click', async () => {
    const magnetUri = magnetUriInput.value.trim();
    const outputDir = outputDirInput.value.trim();
    if (!magnetUri) return;

    submitMagnet.disabled = true;
    submitMagnet.textContent = 'Adding…';

    try {
        const response = await fetch(`${API_BASE}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ magnet: magnetUri, outputDir: outputDir })
        });

        hideModals();
        magnetUriInput.value = '';
        if (response.ok) {
            showToast('Magnet added!', 'success');
        } else {
            showToast('Failed to add magnet', 'error');
        }
        refreshTorrents();
    } catch (error) {
        console.error('Submit magnet error:', error);
        showToast('Failed to add magnet. Check console.', 'error');
    } finally {
        submitMagnet.disabled = false;
        submitMagnet.textContent = 'OK';
    }
});

let hasEverConnected = false;

async function fetchTorrents() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(API_BASE, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) throw new Error('Response not OK');
        const data = await response.json();

        // Once connected, stay connected permanently
        if (!hasEverConnected) {
            hasEverConnected = true;
            isBackendOnline = true;
            updateConnectionStatus(true);
        }
        return data;
    } catch (error) {
        // Only show "Connecting..." during initial startup, before we've ever gotten a response
        // Once backend has responded at least once, never flip status back
        return null;
    }
}

async function refreshTorrents() {
    if (isPolling) return; // prevent overlapping requests
    isPolling = true;

    try {
        const data = await fetchTorrents();
        if (data === null) {
            isPolling = false;
            return; // backend unreachable, keep stale data
        }

        const now = Date.now();

        // Compute speeds by comparing with previous snapshot
        data.forEach(t => {
            const prev = prevSnapshots[t.id];
            if (prev && prev.totalPieces > 0) {
                const dtSeconds = (now - prev.timestamp) / 1000;
                if (dtSeconds > 0 && t.totalSize > 0) {
                    const pieceSize = t.totalSize / t.totalPieces;
                    const deltaPieces = t.completedPieces - prev.completedPieces;
                    t._speed = Math.max(0, (deltaPieces * pieceSize) / dtSeconds);
                    
                    // ETA
                    const remaining = t.totalSize - (t.completedPieces * pieceSize);
                    t._eta = t._speed > 0 ? remaining / t._speed : -1;
                } else {
                    t._speed = 0;
                    t._eta = -1;
                }
            } else {
                t._speed = 0;
                t._eta = -1;
            }

            prevSnapshots[t.id] = {
                completedPieces: t.completedPieces,
                totalPieces: t.totalPieces,
                totalSize: t.totalSize,
                timestamp: now
            };
        });

        // Remove snapshots for torrents that no longer exist
        const currentIds = new Set(data.map(t => t.id));
        for (const key of Object.keys(prevSnapshots)) {
            if (!currentIds.has(key)) delete prevSnapshots[key];
        }

        allTorrents = data;
        renderTorrents();

        // Auto-update details if a torrent is selected
        if (selectedTorrentId) {
            updateDetails(selectedTorrentId);
        }
    } finally {
        isPolling = false;
    }
}

// ─── Filtering ───
function getFilteredTorrents() {
    let filtered = allTorrents;

    // Tab filter
    if (currentTab === 'downloading') {
        filtered = filtered.filter(t => {
            const s = (t.status || '').toLowerCase();
            return s === 'downloading' || s.includes('starting') || s === 'queued' || s.includes('metadata');
        });
    } else if (currentTab === 'completed') {
        filtered = filtered.filter(t => {
            const s = (t.status || '').toLowerCase();
            return s === 'completed' || s === 'seeding' || s === 'finished' || t.progress >= 100;
        });
    }

    // Search filter
    if (searchQuery) {
        filtered = filtered.filter(t => (t.name || '').toLowerCase().includes(searchQuery));
    }

    return filtered;
}

// ─── Incremental DOM Rendering ───
// Instead of blowing away innerHTML every second, we diff and patch individual cells.
const rowMap = new Map(); // id -> <tr> element

function renderTorrents() {
    const filtered = getFilteredTorrents();

    if (filtered.length === 0) {
        torrentList.innerHTML = '';
        rowMap.clear();
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    const filteredIds = new Set(filtered.map(t => t.id));

    // Remove rows no longer in filtered set
    for (const [id, row] of rowMap) {
        if (!filteredIds.has(id)) {
            row.classList.add('removing');
            setTimeout(() => {
                if (row.parentNode) row.parentNode.removeChild(row);
                rowMap.delete(id);
            }, 200);
        }
    }

    // Create or update rows
    filtered.forEach((t, index) => {
        const isMetadata = t.name === 'Initializing...';
        const statusClass = isMetadata ? 'metadata' : t.status.toLowerCase().replace(/[^a-z]/g, '');
        const displayStatus = isMetadata ? 'Fetching Metadata' : t.status;
        const progressValue = isMetadata ? 0 : (t.progress || 0);
        const progressText = isMetadata ? 'Searching Peers…' : t.progress.toFixed(1) + '%';
        const speedStr = (t.status === 'Downloading' && t._speed > 0) ? formatSpeed(t._speed) : '';
        const icon = t.status === 'Completed' ? '✅' : (isMetadata ? '⏳' : (t.status === 'Stopped' ? '⏸️' : '⬇️'));

        let isNewRow = false;
        let row = rowMap.get(t.id);

        if (!row) {
            isNewRow = true;
            row = document.createElement('tr');
            row.dataset.id = t.id;
            row.classList.add('appearing');
            row.addEventListener('click', () => selectRow(t.id));
            row.addEventListener('contextmenu', (e) => showContextMenu(e, t.id));

            // Build 5 cells (no actions column)
            for (let i = 0; i < 5; i++) {
                row.appendChild(document.createElement('td'));
            }

            rowMap.set(t.id, row);
            torrentList.appendChild(row);

            requestAnimationFrame(() => row.classList.remove('appearing'));
        }

        // Update selection
        row.classList.toggle('selected', selectedTorrentId === t.id);

        const cells = row.children;

        // Cell 0: Name
        const nameHtml = `<span class="icon">${icon}</span>${t.name || 'Initializing…'}`;
        if (cells[0].innerHTML !== nameHtml) cells[0].innerHTML = nameHtml;

        // Cell 1: Status
        const statusHtml = `<span class="status-text ${statusClass}">${displayStatus}</span>`;
        if (cells[1].innerHTML !== statusHtml) cells[1].innerHTML = statusHtml;

        // Cell 2: Size
        const sizeText = formatBytes(t.totalSize);
        if (cells[2].textContent !== sizeText) cells[2].textContent = sizeText;

        // Cell 3: Progress + Speed
        if (isNewRow) {
            updateProgressCell(cells[3], 0, '0.0%', '', isMetadata);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    updateProgressCell(cells[3], progressValue, progressText, speedStr, isMetadata);
                });
            });
        } else {
            updateProgressCell(cells[3], progressValue, progressText, speedStr, isMetadata);
        }

        // Cell 4: Peers
        const peersText = String(t.activePeers);
        if (cells[4].textContent !== peersText) cells[4].textContent = peersText;

        // Ensure correct order
        if (torrentList.children[index] !== row) {
            torrentList.insertBefore(row, torrentList.children[index]);
        }
    });
}

function updateProgressCell(cell, value, text, speedStr, isPulsing) {
    let container = cell.querySelector('.progress-cell');
    if (!container) {
        cell.innerHTML = `
            <div class="progress-cell">
                <div class="progress-mini">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
                <div class="progress-meta">
                    <span class="progress-text"></span>
                    <span class="speed-text"></span>
                </div>
            </div>`;
        container = cell.querySelector('.progress-cell');
    }

    const fill = container.querySelector('.progress-fill');
    const textEl = container.querySelector('.progress-text');
    const speedEl = container.querySelector('.speed-text');

    fill.style.width = value + '%';
    fill.classList.toggle('pulsing', isPulsing);

    if (textEl.textContent !== text) textEl.textContent = text;
    if (speedEl.textContent !== speedStr) speedEl.textContent = speedStr;
}

// ─── Row Selection ───
function selectRow(id) {
    selectedTorrentId = (selectedTorrentId === id) ? null : id; // toggle
    
    // Update selection classes without full re-render
    for (const [rowId, row] of rowMap) {
        row.classList.toggle('selected', rowId === selectedTorrentId);
    }
    
    updateDetails(selectedTorrentId);
}
window.selectRow = selectRow;

// ─── Details Pane ───
function updateDetails(id) {
    const details = document.getElementById('details-content');
    if (!id) {
        details.innerHTML = `
            <div class="info-grid">
                <div class="info-item"><span class="label">Time Elapsed:</span> <span class="val">--</span></div>
                <div class="info-item"><span class="label">Remaining:</span> <span class="val">--</span></div>
                <div class="info-item"><span class="label">Downloaded:</span> <span class="val">--</span></div>
                <div class="info-item"><span class="label">Uploaded:</span> <span class="val">--</span></div>
            </div>`;
        return;
    }

    const torrent = allTorrents.find(t => t.id === id);
    if (!torrent) return;

    const downloaded = torrent.totalPieces > 0
        ? torrent.completedPieces * (torrent.totalSize / torrent.totalPieces)
        : 0;

    const etaStr = (torrent._eta && torrent._eta > 0) ? formatDuration(torrent._eta) : '∞';
    const speedStr = torrent._speed > 0 ? formatSpeed(torrent._speed) : '0 B/s';
    
    // For demo/placeholder since we don't track uploaded/time yet in backend
    const timeElapsed = '--'; 

    details.innerHTML = `
        <div class="info-grid">
            <div class="info-item"><span class="label">Name:</span> <span class="val">${torrent.name}</span></div>
            <div class="info-item"><span class="label">Status:</span> <span class="val status-text ${torrent.status.toLowerCase().replace(/[^a-z]/g, '')}">${torrent.status}</span></div>
            <div class="info-item"><span class="label">Size:</span> <span class="val">${formatBytes(torrent.totalSize)}</span></div>
            <div class="info-item"><span class="label">Downloaded:</span> <span class="val">${formatBytes(downloaded)}</span></div>
            <div class="info-item"><span class="label">Speed:</span> <span class="val">${speedStr}</span></div>
            <div class="info-item"><span class="label">ETA:</span> <span class="val">${etaStr}</span></div>
            <div class="info-item"><span class="label">Remaining:</span> <span class="val">${formatBytes(torrent.totalSize - downloaded)}</span></div>
            <div class="info-item"><span class="label">Peers:</span> <span class="val">${torrent.activePeers}</span></div>
            <div class="info-item"><span class="label">Time Elapsed:</span> <span class="val">${timeElapsed}</span></div>
            <div class="info-item"><span class="label">Location:</span> <span class="val">${torrent.outputDir || '--'}</span></div>
        </div>
    `;
}

// ─── Folder & Remove Actions ───
async function openFolder(path) {
    if (!path) return;
    fetch(`${API_BASE}/open-folder?path=${encodeURIComponent(path)}`, { method: 'POST' });
}
window.openFolder = openFolder;

async function removeTorrent(id, deleteData = false) {
    showToast('Removing torrent…', 'info');
    try {
        const res = await fetch(`${API_BASE}/${id}?deleteData=${deleteData}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Torrent removed', 'success');
            if (selectedTorrentId === id) selectedTorrentId = null;
            refreshTorrents();
        } else {
            showToast('Failed to remove torrent', 'error');
        }
    } catch (e) {
        showToast('Error removing torrent', 'error');
    }
}
window.removeTorrent = removeTorrent;

// ─── Context Menu ───
const contextMenu = document.getElementById('context-menu');
let contextTorrentId = null;

function showContextMenu(e, torrentId) {
    e.preventDefault();
    contextTorrentId = torrentId;

    const torrent = allTorrents.find(t => t.id === torrentId);
    if (!torrent) return;

    // Show/hide resume vs stop based on current status
    const resumeBtn = contextMenu.querySelector('[data-action="resume"]');
    const stopBtn = contextMenu.querySelector('[data-action="stop"]');
    
    const isActive = torrent.status === 'Downloading' || torrent.status === 'Starting...' || torrent.status === 'Queued';
    resumeBtn.style.display = isActive ? 'none' : 'flex';
    stopBtn.style.display = isActive ? 'flex' : 'none';

    // Position the menu
    contextMenu.style.display = 'block';
    
    const menuWidth = contextMenu.offsetWidth;
    const menuHeight = contextMenu.offsetHeight;
    let x = e.clientX;
    let y = e.clientY;

    // Keep menu within viewport
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 5;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 5;

    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
}

function hideContextMenu() {
    contextMenu.style.display = 'none';
    contextTorrentId = null;
}

// Close context menu on click anywhere else
document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
    // Close if right-clicking outside a torrent row
    if (!e.target.closest('.torrent-table tbody tr')) {
        hideContextMenu();
    }
});

// Context menu actions
contextMenu.addEventListener('click', async (e) => {
    const btn = e.target.closest('.ctx-item');
    if (!btn || !contextTorrentId) return;

    const action = btn.dataset.action;
    const id = contextTorrentId;
    hideContextMenu();

    switch (action) {
        case 'resume':
            await fetch(`${API_BASE}/${id}/resume`, { method: 'POST' });
            showToast('Torrent resumed', 'success');
            refreshTorrents();
            break;
        case 'stop':
            await fetch(`${API_BASE}/${id}/stop`, { method: 'POST' });
            showToast('Torrent stopped', 'info');
            refreshTorrents();
            break;
        case 'open-folder': {
            const t = allTorrents.find(t => t.id === id);
            if (t) openFolder(t.outputDir);
            break;
        }
        case 'remove':
            showConfirmDialog('Remove this torrent from the list?', () => removeTorrent(id, false));
            break;
        case 'remove-data':
            showConfirmDialog('Remove torrent AND delete all downloaded files?', () => removeTorrent(id, true));
            break;
    }
});

// ─── Connection Status ───
function updateConnectionStatus(online) {
    const dot = document.querySelector('.status-dot');
    const text = document.querySelector('.sidebar-footer .status-text');
    if (dot && text) {
        dot.classList.toggle('online', online);
        dot.classList.toggle('offline', !online);
        text.textContent = online ? 'Engine: Connected' : 'Engine: Connecting…';
    }
}

// ─── Non-blocking Confirm Dialog ───
function showConfirmDialog(message, onConfirm) {
    // Remove any existing confirm dialog
    const existing = document.querySelector('.confirm-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay visible';
    overlay.innerHTML = `
        <div class="confirm-dialog">
            <div class="confirm-message">${message}</div>
            <div class="confirm-actions">
                <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                <button class="btn btn-danger" data-action="confirm">Remove</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
        overlay.remove();
        onConfirm();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

// ─── Toast Notifications ───
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
        toast.classList.remove('visible');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 2500);
}

// ─── Formatters ───
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond <= 0) return '';
    return formatBytes(bytesPerSecond) + '/s';
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '∞';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ─── Startup ───
updateConnectionStatus(false);
refreshTorrents();
pollTimer = setInterval(refreshTorrents, 1000);
