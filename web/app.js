const sidebar = document.getElementById('sidebar');
const content = document.getElementById('content')

const CHAT_PATH = '/Chat.md';
const LATER_PATH = '/Later.md';
const READ_PATH = '/Read.md';
const SHOP_PATH = '/Shop.md';
const WATCH_PATH = '/Watch.md';
const LOG_PATH = '/archive/Log.txt';
const OPEN_CHAT_AFTER_IDLE = 60 * 60 * 1000; // ms

let openChatIdleTimer = null;
let isChat = false;
let isMemFS = false;
let debug = false;
// Per-tab in-memory cache of the current directory handle.
// Prevents cross-tab hijacking: without this, focus/blur handlers
// would re-read the globally-shared _lastUsed IndexedDB key and
// load whatever directory another tab most recently opened.
let _currentTabDirHandle = null;
// let debug = {dir: '', file: 'File.md', loaded: false};

async function init() {
    // Ask the browser to mark our origin as persistent so the quota
    // manager can't evict the auth cookie + localStorage under disk
    // pressure. Chrome auto-grants for installed PWAs / high-engagement
    // sites; otherwise resolves false and we run on best-effort storage.
    // Idempotent - safe to call on every load.
    if (navigator.storage && navigator.storage.persist) {
        const persisted = await navigator.storage.persist();
        log('Storage persisted:', persisted);
    }

    // Authorize if we have one-time token in URL.
    const urlParams = new URLSearchParams(window.location.search);
    const oneTimeToken = urlParams.get('token');
    if (oneTimeToken) {
        try {
            // Exchange one-time token for permanent token
            const response = await fetch(`${API_URL}/issuePermanentToken`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    oneTimeToken: oneTimeToken
                })
            });

            if (response.ok) {
                // Server sets the auth cookie via Set-Cookie on this response.
                markServerOk();
                const url = new URL(window.location);
                url.searchParams.delete('token');
                window.history.replaceState({}, '', url);
            } else {
                alert('The token has expired or is invalid. Please try to request a new link.');
                logError('Token exchange failed:', response.status);
            }
        } catch (error) {
            alert('The token has expired or is invalid. Please try to request a new link.');
            logError('Error exchanging token:', error);
        }
    }

    // Enumerate all saved directories (for TASK-002 multi-directory UI).
    const savedDirs = await listSavedDirHandles();
    log('Saved directories:', savedDirs.map(d => d.folderName));

    const savedDirHandle = await getSavedRootDirHandle();
    const hasSavedLocalDir = savedDirHandle instanceof FileSystemDirectoryHandle;
    if (hasSavedLocalDir) {
        isMemFS = false;
        document.getElementById('open-folder').style.display = 'none';
    } else if (typeof window.showDirectoryPicker === 'function') {
        document.getElementById('open-folder').style.display = 'flex';
        isMemFS = true;
    } else {
        // Safari/Firefox have no File System Access API for now, hide CTA.
        document.getElementById('open-folder').style.display = 'none';
        isMemFS = true;
    }

    // Let's create local-first like experience by preloading images.
    if (isMemFS) {
        prefetchWelcomeImages();
    }

    // Alert if there's no "Allow on every visit" check.
    if (isChrome() && hasSavedLocalDir) {
        const permission = await (await getRootDirHandle()).queryPermission({ mode: 'readwrite' });
        log('PERMISSION', permission);
        if (permission !== 'granted') {
            document.getElementById('open-folder').style.display = 'flex';
            // TODO maybe ask user to check "Allow on every visit" on left part of the sidebar
            // Use the handle's name so the multi-key entry is cleaned up
            // instead of only the legacy key.
            await removeSavedRootDirHandle(savedDirHandle.name);
            alert('Can\'t access folder.\n\nPlease, reopen the folder again and check "Allow on every visit" checkbox');
        }
    }

    let rootDirHandle = await getRootDirHandle();

    let perf = performance.now();
    files = await loadLocalFiles(rootDirHandle);
    log(`Files loaded in ${performance.now() - perf}ms`);

    // If we loaded a local directory on startup, claim it for duplicate detection.
    if (!isMemFS && rootDirHandle instanceof FileSystemDirectoryHandle && rootDirHandle.name) {
        claimDir(rootDirHandle.name);
    }

    initChat();

    perf = performance.now();
    renderSidebar();
    log(`Sidebar built in: ${(performance.now() - perf).toFixed(3)} milliseconds`);

    // Render recent directories list below the sidebar file tree.
    renderRecentDirs(savedDirs);

    const userHasCustomAPIUrl = localStorage.getItem('apiUrl') !== null;
    if (isMemFS && !userHasCustomAPIUrl) {
        // By the time a user has setup custom API, he doesn't need welcome file :)
        await openFile('/🪴 Welcome.md');
    } else {
        openChat();
    }

    perf = performance.now();
    await syncFilesWithServer();
    await renderSidebar();
    await syncMediaFiles();
    log(`Files initialized in: ${(performance.now() - perf).toFixed(3)} milliseconds`);

}

// Logic for click-handling is in click.js => isWikiLink
function createAutocompleteDict() {
    const entries = [];
    const currentPath = currentEditor && currentEditor.path;

    // Collect all files with their metadata
    walkFilesExcludingSystemDirs((path) => {
        if (path === CONFIG_PATH || path === CHAT_PATH || path === LATER_PATH || path === READ_PATH || path === WATCH_PATH || path === SHOP_PATH) {
            return;
        }
        if (path === currentPath) {
            return;
        }

        const filename = toFilename(path);
        const key = `${filename.replace(/\.md$/, '')}`;
        const url = path.replace(/ /g, '%20');
        const filePath = `${filename.replace(/\.md$/, '')}](${url})`;

        entries.push({
            key,
            filePath,
            lastModified: getMemFile(path).lastModified
        });

    });

    // Sort by last modified (most recent first)
    entries.sort((a, b) => b.lastModified - a.lastModified);
    const dict = {};
    entries.forEach(entry => {
        dict[entry.key] = entry.filePath;
    });

    let lowPriorityEntries = [];
    ['_read_/', '_watch_/', '_shop_/', 'today/', 'later/', 'journal/'].forEach(dir => {
        if (!files[dir]) {
            return;
        }

        Object.keys(files[dir]).forEach(filename => {
            if (filename === CONFIG_PATH || filename === CHAT_PATH) {
                return;
            }
            const key = `${filename.replace(/\.md$/, '')}`;
            const url = `${dir}/${filename}`.replace(/ /g, '%20');
            const filePath = `${filename.replace(/\.md$/, '')}](${url})`;

            lowPriorityEntries.push({
                key,
                filePath,
                lastModified: files[dir][filename].lastModified
            });
        });
    });

    lowPriorityEntries.sort((a, b) => b.lastModified - a.lastModified);
    lowPriorityEntries.forEach(entry => {
        dict[entry.key] = entry.filePath;
    });

    return dict;
}

async function newFile(parentDir) {
    log('New file clicked');
    // New files always land at the root. The `parentDir` parameter is still
    // honored (sidebar right-click → New file inside a specific folder).
    const dirPath = parentDir !== undefined
        ? (parentDir === '/' ? '/' : parentDir.replace(/\/$/, ''))
        : '/';

    let filename = 'New file.md';
    let num = 1;
    while (getMemFile(joinPath(dirPath, filename)) !== null) {
        log('file exists', joinPath(dirPath, filename));
        filename = `New file (${num}).md`;
        num++;
    }

    const path = joinPath(dirPath, filename);
    log('PATH', path);
    let handle = await getFileHandle(path, true);
    addMemFile(path, {
        isFile: true,
        content: '',
        lastModified: 0,
        handle: handle,
        path: path,
        imageUrl: null
    });

    log('Creating new file', path);
    await openFile(path);
    log('CURRENT path after new', currentEditor.path);
    editor.setCursor({ line: 1, ch: 0 });
    editor.focus();

    await renderSidebar();
}

async function newFolder() {
    let folderName = prompt('Enter folder name:', 'New Folder');
    if (folderName === null) {
        return;
    }

    folderName = folderName.trim();
    if (!folderName) {
        alert('Folder name cannot be empty');
        return;
    }

    let finalFolderName = folderName;
    let num = 1;
    while (files[finalFolderName + '/']) {
        finalFolderName = `${folderName} (${num})`;
        num++;
    }

    const rootDirHandle = await getRootDirHandle();
    await rootDirHandle.getDirectoryHandle(finalFolderName, { create: true });
    files[finalFolderName + '/'] = {};

    log('CREATED folder', finalFolderName);

    await renderSidebar(finalFolderName);
}

function isMetaKey(event) {
    return event.metaKey || event.ctrlKey || event.altKey;
}

function isSidebarToggleShortcut(event) {
    if (!isMetaKey(event)) {
        return false;
    }

    // Match the physical shortcut key across ANSI/ISO keyboard layouts.
    return event.code === 'Backquote'
        || event.code === 'IntlBackslash'
        || event.key === '`'
        || event.key === '~'
        || event.key === '§'
        || event.key === '±';
}

async function openDir() {
    let dirHandle = null;
    try {
        dirHandle = await window.showDirectoryPicker({ 'mode': 'readwrite' });
    } catch (error) {
        // User pressed Esc (AbortError) or the browser doesn't support
        // the picker (TypeError).
        if (error instanceof TypeError) {
            alert('For now only Chrome browser supports local folders :(');
        }
        return;
    }

    const folderName = dirHandle.name;
    if (folderName) {
        // Duplicate detection: check if this directory is already open (same tab or another tab).
        if (isDirClaimedByOtherTab(folderName)) {
            if (_currentlyOpenDir === folderName) {
                alert('该目录已在当前标签页中打开');
            } else {
                alert('该目录已在其他标签页中打开');
            }
            return;
        }
    }
    // TODO check that permissions are given?

    // Help.md is no longer auto-created in local folders (REQ-260618-001-TASK-002).
    // getHelpContent() is still used by the temporary/demo FS via WELCOME_FILES.
    // await write('/Help.md', getHelpContent());

    // Copy user-created files from the temporary FS into the opened folder.
    try {
        await moveUserFiles(dirHandle);
    } catch (e) {
        logError("Can't move user files from temporary storage:", e);
    }

    // _switchToLocalDirectory handles claimDir internally so that failed
    // switches don't leave orphaned localStorage claims.
    await _switchToLocalDirectory(dirHandle);
}

// --- Recent directories list ---

const MAX_RECENT_DIRS = 10;

/**
 * Render the "Recent Directories" list in the sidebar.
 * Hides the container when there are no saved directories.
 * @param {{folderName: string, handle: FileSystemDirectoryHandle}[]} savedDirs
 */
function renderRecentDirs(savedDirs) {
    const container = document.getElementById('recent-dirs');
    const list = document.getElementById('recent-dirs-list');
    if (!container || !list) return;

    // Clear existing list items.
    list.innerHTML = '';

    if (!savedDirs || savedDirs.length === 0) {
        container.style.display = 'none';
        return;
    }

    // Cap at MAX_RECENT_DIRS, showing most recent first (the array is
    // already in the order returned by listSavedDirHandles, which is
    // insertion order from IndexedDB cursor).
    const dirs = savedDirs.slice(0, MAX_RECENT_DIRS);

    for (const { folderName } of dirs) {
        const li = document.createElement('li');
        li.className = 'recent-dir-item';
        li.title = `Open ${folderName}`;

        // Folder icon (same SVG as toolbar open-folder button).
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('width', '18');
        icon.setAttribute('height', '18');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('viewBox', '0 0 32 32');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('d', 'M28 11v13a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h6c3 0 3 3 5 3h9.003C27.108 9 28 9.895 28 11z');
        icon.appendChild(path);
        li.appendChild(icon);

        // Folder name.
        const span = document.createElement('span');
        span.className = 'recent-dir-name';
        span.textContent = folderName;
        li.appendChild(span);

        li.addEventListener('click', () => openSavedDir(folderName));
        list.appendChild(li);
    }

    container.style.display = 'block';
}

/**
 * Open a previously-saved directory by folder name.
 * Performs duplicate-detection via localStorage before opening.
 * @param {string} folderName
 */
async function openSavedDir(folderName) {
    // --- Duplicate detection ---
    if (isDirClaimedByOtherTab(folderName)) {
        if (_currentlyOpenDir === folderName) {
            alert('该目录已在当前标签页中打开');
        } else {
            alert('该目录已在其他标签页中打开');
        }
        return;
    }

    // Resolve the handle from IndexedDB.
    const handle = await getSavedRootDirHandle(folderName);
    if (!(handle instanceof FileSystemDirectoryHandle)) {
        alert('无法访问该目录，请重新打开。');
        return;
    }

    // Ensure we have readwrite permission.
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
        try {
            perm = await handle.requestPermission({ mode: 'readwrite' });
        } catch (e) {
            logError('Permission request failed:', e);
        }
        if (perm !== 'granted') {
            alert('需要目录访问权限才能打开。');
            return;
        }
    }

    // _switchToLocalDirectory handles claimDir internally so that failed
    // switches don't leave orphaned localStorage claims.
    await _switchToLocalDirectory(handle);
}

/**
 * Shared logic for switching the app to a local directory handle.
 *
 * Guards against concurrent file loads/syncs, persists the handle,
 * refreshes the recent-directories sidebar list, loads files from disk,
 * resets chat state, and re-renders the UI.
 *
 * Called by both openDir() (fresh picker) and openSavedDir() (re-open from
 * IndexedDB) so the two paths stay in sync.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 */
async function _switchToLocalDirectory(dirHandle) {
    // Don't race with existing files loading or syncing.
    while (isLoadingLocalFiles) {
        await new Promise(r => setTimeout(r, 50));
    }
    isLoadingLocalFiles = true;

    while (isSyncingFiles) {
        await new Promise(r => setTimeout(r, 50));
    }
    isSyncingFiles = true;

    // Note: the server state reset (server = {files: {}, …},
    // localStorage.removeItem("server")) from the original openDir() is
    // intentionally omitted here.  The app is frontend-only — there is no
    // server backend — so the in-memory server variable doesn't need to be
    // cleared between directory switches.  Preserving it keeps prior state
    // available for any OPFS/demo-fs flows that reference it.

    let claimMade = false;
    try {
        await saveDirectoryHandle(dirHandle);

        // Claim the directory in localStorage so other tabs can detect it.
        // Must happen after saveDirectoryHandle (which validates the handle)
        // but before loadLocalFiles (which is where failures can occur).
        // Release the claim if loading fails to avoid orphaned claims blocking
        // other tabs from opening this directory.
        const folderName = dirHandle.name;
        if (folderName) {
            claimDir(folderName);
            claimMade = true;
        }

        // Refresh the recent directories list so the folder appears / moves to
        // the top (most-recent) position immediately without a page reload.
        const recentDirs = await listSavedDirHandles();
        renderRecentDirs(recentDirs);
    } catch (e) {
        // If saveDirectoryHandle, claimDir, listSavedDirHandles, or
        // renderRecentDirs throws, reset the guard flags and release
        // any claim we made so the app stays functional.
        isLoadingLocalFiles = false;
        isSyncingFiles = false;
        if (claimMade) {
            releaseCurrentDirClaim();
        }
        throw e;
    }

    isLoadingLocalFiles = false;
    try {
        files = await loadLocalFiles(dirHandle);
    } catch (e) {
        // Release the claim we just set — the directory switch failed.
        releaseCurrentDirClaim();
        throw e;
    } finally {
        isSyncingFiles = false;
    }

    isMemFS = false;
    // Reset in-memory chat state when switching directories,
    // so content from the previous folder doesn't leak into the new one.
    chatContent = '';
    lastChatText = null;
    document.getElementById('open-folder').style.display = 'none';
    renderSidebar();
    await openChat();
}

function getCurrentContent() {
    let content = currentEditor.getValue();
    const header = toHeader(toFilename(currentEditor.path)).toLowerCase();
    // Remove header if it exists.
    if (content.toLowerCase().startsWith(header)) {
        content = content.slice(`${header}\n`.length);
    } else if (content.toLowerCase().startsWith('# ')) {
        // Skip header placeholder.
        // What is the case when starts with # '? Empty filename? Header not equal to original header?
        // TODO but do we always have \n?
        content = content.slice(`# \n`.length);
    }

    return content;
}

function toHeader(filename) {
    let header = filename;
    if (filename.endsWith('.md')) {
        header = trimPostfix(filename, '.md');
    }

    return `# ${header}`;
}

function fromHeaderToFilename(header) {
    if (header.startsWith('# ')) {
        return header.slice(2).trim() + '.md';
    }
    return header.trim() + '.md';
}

function ucfirst(val) {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

async function getImageUrl(fileHandle) {
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
}

// Normalize text to use only \n as line endings
function normNewLines(text) {
    return text.replace(/\r\n|\r/g, '\n');
}

function showToast(msg, ms = 1500) {
    const toast = document.createElement('div');
    if (msg instanceof Node) {
        toast.appendChild(msg);
    } else {
        toast.textContent = msg;
    }
    // Center over the editor area (not the whole viewport) so the toast
    // sits above the content rather than drifting onto the sidebar.
    const editorContainer = document.getElementById('editor-container');
    const rect = editorContainer ? editorContainer.getBoundingClientRect() : null;
    const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    toast.style.cssText = `
        position: fixed; top: 8px; left: ${centerX}px; transform: translateX(-50%);
        background: var(--col-bg-alt); color: var(--col-tx); padding: 8px 16px; border-radius: 5px;
        border: 1px solid var(--col-border);
        z-index: 9999; font-size: 14px;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), ms);
}

// --- Cross-tab duplicate directory detection ---
//
// When a directory is opened we write a localStorage marker:
//   openedDir:<folderName> = <Date.now() timestamp>
//
// Other tabs check this marker before opening the same directory.
// Markers older than DUPLICATE_DIR_ZOMBIE_TIMEOUT (10 min) are considered
// zombie and ignored — they're cleaned up on next access.
//
// On tab close (beforeunload), the marker is removed so other tabs can
// open the directory without the alert.

const DUPLICATE_DIR_MARKER_PREFIX = 'openedDir:';
const DUPLICATE_DIR_ZOMBIE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

let _currentlyOpenDir = null;

/**
 * Track the currently-open directory for beforeunload and storage-event cleanup.
 * @param {string|null} folderName
 */
function setCurrentOpenDir(folderName) {
    // Release the previous claim if any.
    if (_currentlyOpenDir && _currentlyOpenDir !== folderName) {
        try { localStorage.removeItem(DUPLICATE_DIR_MARKER_PREFIX + _currentlyOpenDir); } catch (_) {}
    }
    _currentlyOpenDir = folderName;
}

/**
 * Check whether a directory is already claimed by another tab.
 * Zombie markers (older than ZOMBIE_TIMEOUT) are cleaned up and return false.
 * @param {string} folderName
 * @returns {boolean} true if another tab has an active claim
 */
function isDirClaimedByOtherTab(folderName) {
    const key = DUPLICATE_DIR_MARKER_PREFIX + folderName;
    let existing;
    try { existing = localStorage.getItem(key); } catch (_) { return false; }
    if (existing === null) return false;

    const ts = parseInt(existing, 10);
    if (isNaN(ts)) {
        try { localStorage.removeItem(key); } catch (_) {}
        return false;
    }
    if (Date.now() - ts >= DUPLICATE_DIR_ZOMBIE_TIMEOUT) {
        // Zombie marker.
        try { localStorage.removeItem(key); } catch (_) {}
        return false;
    }
    return true;
}

/**
 * Claim a directory in localStorage so other tabs can detect it.
 * @param {string} folderName
 */
function claimDir(folderName) {
    try { localStorage.setItem(DUPLICATE_DIR_MARKER_PREFIX + folderName, Date.now().toString()); } catch (_) {}
    setCurrentOpenDir(folderName);
}

/**
 * Release the claim on the currently-open directory.
 */
function releaseCurrentDirClaim() {
    if (_currentlyOpenDir) {
        try { localStorage.removeItem(DUPLICATE_DIR_MARKER_PREFIX + _currentlyOpenDir); } catch (_) {}
        _currentlyOpenDir = null;
    }
}

// Listen for other tabs claiming the same directory.
window.addEventListener('storage', (event) => {
    if (!event.key || !event.key.startsWith(DUPLICATE_DIR_MARKER_PREFIX)) return;
    // Another tab wrote a marker. If it's the same directory we have open,
    // show a warning toast.
    const folderName = event.key.slice(DUPLICATE_DIR_MARKER_PREFIX.length);
    if (folderName === _currentlyOpenDir && event.newValue !== null) {
        log('Another tab opened the same directory:', folderName);
        showToast(`⚠️ ${folderName} 已在其他标签页中打开`, 4000);
    }
});

// --- IndexedDB multi-key directory handle storage ---
//
// Key scheme (REQ-260618-005):
//   dirHandle:<folderName>  → FileSystemDirectoryHandle   (one per opened directory)
//   _lastUsed               → string (folderName)          (tracks most-recently-used)
//
// Legacy key migrated on first read:
//   savedDirectoryHandle    → migrated to dirHandle:<handle.name>

const DIR_HANDLE_PREFIX = 'dirHandle:';
const LAST_USED_KEY = '_lastUsed';
const LEGACY_HANDLE_KEY = 'savedDirectoryHandle';

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('files', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('handles')) {
                db.createObjectStore('handles');
            }
        };
    });
}

// --- Internal helpers ---

function _readKey(db, key) {
    const tx = db.transaction('handles', 'readonly');
    const store = tx.objectStore('handles');
    return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
}

function _writeKey(db, key, value) {
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    store.put(value, key);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
}

function _deleteKey(db, key) {
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    store.delete(key);
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
}

async function _listSavedDirHandlesInDB(db) {
    const tx = db.transaction('handles', 'readonly');
    const store = tx.objectStore('handles');
    return new Promise((resolve, reject) => {
        const result = [];
        const req = store.openCursor();
        req.onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (cursor) {
                if (typeof cursor.key === 'string'
                    && cursor.key.startsWith(DIR_HANDLE_PREFIX)
                    && cursor.value instanceof FileSystemDirectoryHandle) {
                    result.push({
                        folderName: cursor.key.slice(DIR_HANDLE_PREFIX.length),
                        handle: cursor.value,
                    });
                }
                cursor.continue();
            } else {
                resolve(result);
            }
        };
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
}

async function _migrateLegacyKey(db) {
    try {
        // Guard: only attempt migration if the legacy key actually exists.
        const legacyHandle = await _readKey(db, LEGACY_HANDLE_KEY);
        if (!(legacyHandle instanceof FileSystemDirectoryHandle)) return;

        const folderName = legacyHandle.name;
        if (!folderName) {
            // OPFS root handles have an empty name — skip migration, they are
            // never saved by openDir() anyway.
            await _deleteKey(db, LEGACY_HANDLE_KEY);
            return;
        }

        // Serialise with saveDirectoryHandle / removeSavedRootDirHandle
        // to avoid cross-tab write races during the brief migration window.
        await navigator.locks.request('filesmd-db-write', async () => {
            const newKey = DIR_HANDLE_PREFIX + folderName;
            await _writeKey(db, newKey, legacyHandle);
            await _writeKey(db, LAST_USED_KEY, folderName);
            await _deleteKey(db, LEGACY_HANDLE_KEY);
        });

        log('Migrated legacy directory handle to multi-key format:', folderName);
    } catch (err) {
        // Migration is best-effort — swallowing the error lets the app
        // continue with the in-memory FS fallback instead of failing startup.
        logError('Legacy handle migration failed:', err);
    }
}

// --- Public API ---

/**
 * List all saved directory handles from IndexedDB.
 * @returns {Promise<{folderName: string, handle: FileSystemDirectoryHandle}[]>}
 */
async function listSavedDirHandles() {
    const db = await initDB();
    // Opportunistically run migration so legacy handles show up in the list.
    await _migrateLegacyKey(db);
    return _listSavedDirHandlesInDB(db);
}

/**
 * Persist a directory handle to IndexedDB under the key dirHandle:<folderName>.
 * Uses the Web Locks API to serialise writes across tabs.
 */
async function saveDirectoryHandle(directoryHandle) {
    const folderName = directoryHandle.name;
    if (!folderName) {
        logError('saveDirectoryHandle: handle has empty name, refusing to persist');
        return;
    }
    const key = DIR_HANDLE_PREFIX + folderName;

    // Cache in memory so this tab won't be hijacked by another tab's
    // _lastUsed write.  Memory is per-tab; IndexedDB is shared across tabs.
    _currentTabDirHandle = directoryHandle;

    await navigator.locks.request('filesmd-db-write', async () => {
        const db = await initDB();
        const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');
        store.put(directoryHandle, key);
        store.put(folderName, LAST_USED_KEY);
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
        });
    });

    log('Saved directory handle:', folderName);
}

/**
 * Read a saved directory handle.
 *
 * @param {string} [folderName] — if given, look up that specific directory.
 *   When omitted, return the most-recently-used directory (via _lastUsed marker).
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
async function getSavedRootDirHandle(folderName) {
    const db = await initDB();

    // Migrate legacy data on every read — idempotent once the old key is gone.
    await _migrateLegacyKey(db);

    let key;
    if (folderName !== undefined) {
        key = DIR_HANDLE_PREFIX + folderName;
    } else {
        const lastUsed = await _readKey(db, LAST_USED_KEY);
        if (lastUsed && typeof lastUsed === 'string') {
            key = DIR_HANDLE_PREFIX + lastUsed;
        } else {
            // No last-used marker — pick any saved directory as a fallback.
            const dirs = await _listSavedDirHandlesInDB(db);
            if (dirs.length > 0) {
                key = DIR_HANDLE_PREFIX + dirs[0].folderName;
            } else {
                return null;
            }
        }
    }

    return _readKey(db, key);
}

/**
 * Remove a saved directory handle.
 *
 * @param {string} [folderName] — if given, delete only that directory's handle.
 *   When omitted, delete the legacy key (backward-compat for the permission-denied path).
 */
async function removeSavedRootDirHandle(folderName) {
    // Serialise with saveDirectoryHandle to avoid cross-tab write races.
    await navigator.locks.request('filesmd-db-write', async () => {
        const db = await initDB();
        if (folderName !== undefined) {
            // Delete the directory handle and clear _lastUsed if it points here.
            const key = DIR_HANDLE_PREFIX + folderName;
            await _deleteKey(db, key);

            const lastUsed = await _readKey(db, LAST_USED_KEY);
            if (lastUsed === folderName) {
                // Pick another saved directory as the new _lastUsed so that
                // getSavedRootDirHandle() returns a deterministic result
                // instead of falling through to arbitrary cursor order.
                const remaining = await _listSavedDirHandlesInDB(db);
                if (remaining.length > 0) {
                    await _writeKey(db, LAST_USED_KEY, remaining[0].folderName);
                } else {
                    await _deleteKey(db, LAST_USED_KEY);
                }
            }
        } else {
            // Legacy backward-compat: delete the old single-directory key.
            await _deleteKey(db, LEGACY_HANDLE_KEY);
        }
    });

    // If we just removed this tab's current directory, clear the in-memory
    // cache so the next getRootDirHandle() call falls through to IndexedDB
    // instead of returning a stale revoked handle.
    if (_currentTabDirHandle && folderName !== undefined && _currentTabDirHandle.name === folderName) {
        _currentTabDirHandle = null;
    }

    log('Removed saved directory handle:', folderName || '(legacy)');
}

async function getRootDirHandle() {
    // Use the per-tab in-memory cache when available.  Without this guard,
    // focus/blur handlers would re-read the globally-shared _lastUsed key
    // from IndexedDB and load whatever directory another tab most recently
    // opened, hijacking this tab's view.
    if (_currentTabDirHandle) {
        return _currentTabDirHandle;
    }

    const savedDirHandle = await getSavedRootDirHandle();
    // If the saved handle is from a browser missing createWritable or
    // remove (Safari OPFS, older Chromium), fall back to the in-memory FS
    // instead of letting later writes/deletes blow up.
    if (!(savedDirHandle instanceof FileSystemDirectoryHandle) || !opfsIsFullyUsable()) {
        return await getTemporaryStorageDirHandle();
    }

    // Cache for subsequent focus/blur calls within this tab.
    _currentTabDirHandle = savedDirHandle;
    return savedDirHandle;
}

const resizeHandle = document.querySelector('.resize');
let isResizing = false;
resizeHandle.addEventListener('mousedown', initResize);
document.addEventListener('mousemove', doResize);
document.addEventListener('mouseup', stopResize);

function initResize(e) {
    isResizing = true;
    document.body.classList.add('dragging');
    e.preventDefault();
}

function doResize(e) {
    if (!isResizing) return;

    log(e);
    const width = e.clientX;
    const minWidth = 200;
    const maxWidth = 600;

    const constrainedWidth = Math.min(Math.max(width, minWidth), maxWidth);
    sidebar.style.setProperty('width', constrainedWidth + 'px', 'important');
}

function stopResize() {
    if (!isResizing) return;
    isResizing = false;
    document.body.classList.remove('dragging');
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const openSidebar = document.getElementById('open-sidebar');

    const isHidden = sidebar.style.display === 'none'
        || getComputedStyle(sidebar).display === 'none';

    if (isHidden) {
        sidebar.style.display = 'flex';
        openSidebar.style.display = 'none';
        // Suppresses the mobile media-query that hides the sidebar.
        document.body.classList.add('sidebar-open');
    } else {
        sidebar.style.display = 'none';
        openSidebar.style.display = 'block';
        document.body.classList.remove('sidebar-open');
        if (isChat) {
            chatInput.focus();
        } else {
            currentEditor.focus();
        }
    }
}

function trimPostfix(str, postfix) {
    if (str.endsWith(postfix)) {
        return str.slice(0, -postfix.length);
    }
    return str;
}

function trimPrefix(str, prefix) {
    if (str.startsWith(prefix)) {
        return str.slice(prefix.length);
    }
    return str;
}

function getCurrentVersion() {
    return window.COMMIT_HASH ? window.COMMIT_HASH.replace('?v=', '') : '';
}

function showEditor2() {
    const editor2Container = document.getElementById('editor2-container');
    const alreadyShown = editor2Container.classList.contains('show')
        && editor2Container.style.display !== 'none';
    if (alreadyShown) {
        return;
    }

    rememberEditorPos();

    editor2Container.style.display = 'flex';
    editor2Container.offsetHeight; // Force reflow
    editor2Container.classList.add('show');

    editor.refresh();
    editor2.focus();
    restoreEditorPos();
}

function hideEditor2() {
    if (typeof editor2 === 'undefined') {
        return
    }

    const editor2Container = document.getElementById('editor2-container');

    editor2Container.classList.remove('show');
    restoreEditorPos();

    // Clear editor2's path so a subsequent openFile for the same path
    // doesn't take the isSameFile short-circuit (which skips re-init and
    // would leave the panel visually empty after editor1 re-init nuked
    // editor2's wrapper).
    editor2.path = undefined;
    currentEditor = editor;
    selectSidebarItem(editor.path);

    setTimeout(() => {
        editor2Container.style.display = 'none';
        editor.refresh(); // IT seems we have to refresh once size changes.
    }, 300);
}

function isChrome() {
    var winNav = window.navigator;
    var vendorName = winNav.vendor;

    var isChromium = window.chrome;
    var isOpera = typeof window.opr !== "undefined";
    var isIEedge = winNav.userAgent.indexOf("Edg") > -1;
    var isIOSChrome = winNav.userAgent.match("CriOS");
    var isGoogleChrome = isChromium !== null
        && typeof isChromium !== "undefined"
        && vendorName === "Google Inc."
        && isOpera === false
        && isIEedge === false
        && (typeof winNav.userAgentData === "undefined" || winNav.userAgentData.brands.some(x => x.brand === "Google Chrome"));

    if (isIOSChrome) {
        return true;
    } else if (isGoogleChrome) {
        return true;
    } else {
        return false;
    }
}

function goBack() {
    history.back();
}

function goForward() {
    history.forward();
}

// Returns { json, error }. On success, error is null. On HTTP error,
// json is null and error is a "<status> <statusText>: <body>" string.
async function post(endpoint, data) {
    let response;
    try {
        response = await fetch(`${API_URL}/${endpoint}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Version': getCurrentVersion()
            },
            body: JSON.stringify(data)
        });
    } catch (e) {
        return { json: null, error: `network: ${e.message}` };
    }

    if (!response.ok) {
        let body = '';
        try { body = await response.text(); } catch (_) {}
        return { json: null, error: `${response.status} ${response.statusText}: ${body}`.trim() };
    }
    markServerOk();

    // Some endpoints (e.g. /syncMedia upload) reply 200 with an empty
    // body on success - treat that as `{}` so callers don't have to
    // care about the difference.
    let json;
    try {
        json = await response.json();
    } catch (e) {
        return { json: null, error: `parse: ${e.message}` };
    }

    // Handle special commands from server.
    // We may need to force-update sometimes.
    if (json.status === 'reload') {
        const url = new URL(window.location);
        url.searchParams.set('t', Date.now());
        window.location.href = url.toString();
    } else if (json.status === 'close') {
        window.location.href = "about:blank"
    }

    return { json, error: null };
}

// Custom global log() function that display immediate values and writes to a file.
// Logging a JavaScript object to the console isn't logging that object's state, it is logging an object reference.
// We make a deep copy of the object at the moment of calling so to display its true value.
function log(...args) {
    logf('', '#4CAF50', args);
}

function logError(...args) {
    logf('Error: ', '#F44336', args);
}

async function logf(prefix, color, args) {
    // Capture real caller from stack (skip 2 levels: _logInternal and log/error)
    const stack = new Error().stack;

    // Extract 3 and 4 lines from stack trace
    const callerFull = stack.split('\n')[3].trim(); // Real caller line
    // Extract only the last path segment
    const callerMatch = callerFull.match(/([^\/\\]+:\d+:\d+)/);
    let caller = callerMatch ? callerMatch[1] : callerFull;

    // Extract 4 if exists
    const callerFull2 = stack.split('\n')[4]?.trim();
    const caller2Match = callerFull2 ? callerFull2.match(/([^\/\\]+:\d+:\d+)/) : null;
    const caller2 = caller2Match ? caller2Match[1] : null;
    if (caller2) {
        // Append second caller for better context
        caller += ` <- ${caller2}`;
    }

    // Format message
    const msg = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');

    // Get time for console
    const date = new Date();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const time = `${hours}:${minutes}:${seconds}`;

    // Compact console output with colors
    console.log(
        `%c[${time}]%c ${msg}%c ${caller}`,
        'color: #888; font-size: 0.9em',      // Time in gray
        `color: ${color}; font-weight: bold`, // Message in specified color
        'color: #888; font-size: 0.9em'       // Stack trace in gray
    );

    // File logging with full timestamp
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();

    const now = `${day}.${month}.${year} ${time}`;
    const logMsg = `${now} ${prefix}[${callerFull}] ${msg}\n`;

    try {
        await writeAtEnd(LOG_PATH, logMsg);
    } catch (error) {
    }
}

let operationCounter = 0;
function opId() {
    return `${++operationCounter}`;
}

// Event listeners

// Hotkeys
window.addEventListener('keydown', async (event) => {
    if (isMetaKey(event) && event.key == 'w') {
        hideEditor2();
    }

    if (isMetaKey(event) && event.key === 'p') {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('search-input').value = ''
        searchModal.open();
    }

    if (isMetaKey(event) && event.key === 'k') {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('search-input').value = ''
        searchModal.open();
    }

    if (isMetaKey(event) && event.key === 'm') {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('move-input').value = ''
        moveModal.open();
    }

    if (isMetaKey(event) && event.key === 'd') {
        log('cmd+d');
        event.preventDefault();
        event.stopPropagation();
        removeCurrentFile();
    }

    if (isMetaKey(event) && event.key === 'n') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (event.shiftKey) {
            await newFolder();
        } else {
            await newFile();
        }
    }
}, true);

document.addEventListener('keydown', (event) => {
    // TODO cursor shouldn't jump to top once we hit "esc".
    if (event.key === 'Escape') {
        if (chatContainer.style.display !== 'none') {
            const selectedMessages = chat.querySelectorAll('.message.selected');
            if (selectedMessages.length > 0) {
                selectedMessages.forEach(message => message.classList.remove('selected'));
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            closeChatModal();
            editor.focus();
            return;
        }

        hideEditor2();
        editor.focus();

        const allMessages = chat.querySelectorAll('.message');
        allMessages.forEach(message => message.classList.remove('selected'));
        // If in chat, focus chat input
        if (isChat) {
            chatInput.focus();
        }
    }
});

// Toggle focus mode
document.addEventListener('keydown', function(event) {
    // Cmd+shift+enter toggle chat modal.
    if (event.shiftKey && isMetaKey(event) && event.key === 'Enter') {
        event.preventDefault();
        if (isChat) {
            history.back();
        } else {
            event.preventDefault();
            toggleChatModal();
        }
        return;
    }
    if (isSidebarToggleShortcut(event)) {
        event.preventDefault();
        toggleSidebar();
    }
    if (isMetaKey(event) && event.key === 'Enter') {
        openChat();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) {
        document.body.classList.add('cmd-pressed');
    }
});

document.addEventListener('keyup', (e) => {
    if (!e.metaKey && !e.ctrlKey) {
        document.body.classList.remove('cmd-pressed');
    }
});

window.addEventListener('popstate', (event) => {
    const state = event.state;
    if (state) {
        openFile(state.path, false, state.el);
    }
});

// Reload files once the app gains focus.
window.addEventListener('focus', async () => {
    // Clear any pending chat open timer.
    if (openChatIdleTimer) {
        clearTimeout(openChatIdleTimer);
        openChatIdleTimer = null;
    }

    // We don't want to do heavy stuff when chat is open.
    const userHasCustomAPIUrl = localStorage.getItem('apiUrl') !== null;
    if (isChat || (isMemFS && !userHasCustomAPIUrl)) {
        if (isChat) {
            document.getElementById('chat-input').focus();
        }
        return false;
    }

    log('FOCUS');

    if (currentEditor.path === undefined) {
        return;
    }

    document.getElementById('chat-input').focus();

    const savedDirectoryHandle = await getRootDirHandle();
    // TODO check if access granted

    // Sync media first, so that new images for current file would be loaded
    await syncMediaFiles();
    await syncCurrentFile();

    const start = performance.now();
    files = await loadLocalFiles(savedDirectoryHandle, true);
    const end = performance.now();
    log(`Files loaded in: ${(end - start).toFixed(3)} milliseconds`);
    await syncFilesWithServer()
    await renderSidebar();
    log('Sync completed');
});

// Sync files on chat focus lose.
window.addEventListener('blur', async function() {
    log('BLUR');
    editor.refresh();

    // Start timer to open chat after idle.
    openChatIdleTimer = setTimeout(() => {
        openChat();
    }, OPEN_CHAT_AFTER_IDLE);

    // Sync media first, so that new images for current file would be loaded
    // if files is not empty object
    if (Object.keys(files).length === 0) {
        return;
    }
    await syncMediaFiles();
    await syncCurrentFile();

    const savedDirectoryHandle = await getRootDirHandle();

    // Benchmark time took
    const start = performance.now();
    files = await loadLocalFiles(savedDirectoryHandle);
    const end = performance.now();
    log(`Files loaded in: ${(end - start).toFixed(3)} milliseconds`);
    await syncFilesWithServer()
    await renderSidebar();
    log('Sync completed');
});

document.addEventListener('keydown', (e) => {
    // If search or move dialog is focused - return
    if (document.getElementById('search').style.display !== 'none' ||
        document.getElementById('move').style.display !== 'none') {
        return;
    }

    if (isChat) {
        return;
    }
}, true);

window.addEventListener('beforeunload', function() {
    clearInterval(window.saver);
    releaseCurrentDirClaim();
});

// Worker to process the saving queue
window.saver = setInterval(() => {
    if (document.hasFocus()) {
        syncCurrentFile();
    }
}, CURRENT_FILE_SYNC_INTERVAL);
