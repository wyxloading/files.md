// Node.js test for conflict dialog logic (REQ-260618-010-TASK-003)
// Mocks DOM APIs to verify showConflictDialog promise resolution, queuing, and
// editor-switch detection.
//
// NOTE: The showConflictDialog and _showConflictDialogInternal functions below
// are replicas of the real implementations in ../modals.js.  When modals.js
// changes, these replicas MUST be updated to match — otherwise tests may pass
// against stale logic.
//
// We inline the functions instead of eval()-ing modals.js because source
// extraction is fragile (refactoring or adding statements above the functions
// in modals.js would silently break the test).

// ============================================================
// Replicated conflict dialog functions (keep in sync with ../modals.js)
// ============================================================

async function showConflictDialog(path) {
    // Already showing for this same path — don't double-show.
    if (global.window.conflictPath === path) {
        return 'mine';
    }

    // Another conflict dialog is open — queue this one.
    if (global.window.conflictPath !== null) {
        return new Promise((resolve) => {
            global.window.conflictQueue.push({ path, resolve });
        });
    }

    return await _showConflictDialogInternal(path);
}

async function _showConflictDialogInternal(path) {
    global.window.conflictPath = path;

    try {
        const overlay = global.document.getElementById('conflict-dialog-overlay');
        const bodyEl = global.document.getElementById('conflict-dialog-body');
        const keepBtn = global.document.getElementById('conflict-keep-mine');
        const loadBtn = global.document.getElementById('conflict-load-external');

        // Guard against missing DOM elements — the conflict dialog HTML template
        // must be present in the page for this function to work correctly.
        if (!overlay || !bodyEl || !keepBtn || !loadBtn) {
            console.error('Conflict dialog: required DOM elements not found.');
            return 'external';
        }

        // Display the file path in the dialog body.
        bodyEl.textContent = path;

        // Show the dialog.
        overlay.style.display = 'flex';

        const result = await new Promise((resolve) => {
            // Poll: if the user switches to a different file while the dialog
            // is open, auto-close with 'external' (the caller handles the
            // editor-switch without reloading from disk).
            const checkInterval = setInterval(() => {
                if (global.window.currentEditor && global.window.currentEditor.path !== path) {
                    clearInterval(checkInterval);
                    overlay.style.display = 'none';
                    keepBtn.removeEventListener('click', onKeep);
                    loadBtn.removeEventListener('click', onLoad);
                    resolve('external');
                }
            }, 200);

            const onKeep = () => {
                clearInterval(checkInterval);
                overlay.style.display = 'none';
                keepBtn.removeEventListener('click', onKeep);
                loadBtn.removeEventListener('click', onLoad);
                resolve('mine');
            };

            const onLoad = () => {
                clearInterval(checkInterval);
                overlay.style.display = 'none';
                keepBtn.removeEventListener('click', onKeep);
                loadBtn.removeEventListener('click', onLoad);
                resolve('external');
            };

            keepBtn.addEventListener('click', onKeep);
            loadBtn.addEventListener('click', onLoad);
        });

        return result;
    } finally {
        global.window.conflictPath = null;

        // Process the next queued conflict, if any.
        if (global.window.conflictQueue.length > 0) {
            const next = global.window.conflictQueue.shift();
            // Kick off the next dialog; chain the stored resolve.
            showConflictDialog(next.path).then(next.resolve);
        }
    }
}

// ============================================================
// Mock DOM helpers
// ============================================================

let mockElements = {};
let mockEventListeners = {};

// Mock document.getElementById
global.document = {
    getElementById(id) {
        return mockElements[id] || null;
    }
};

// Mock window globals used by the conflict dialog functions.
global.window = {
    currentEditor: { path: null },
    conflictPath: null,
    conflictQueue: [],
};

// Global editor references used by openFile when loading external version.
global.editor = {};
global.editor2 = {};

// Suppress console.error during tests — the null-element guard above
// logs there when DOM elements are missing (which is expected in some tests).
const _origConsoleError = console.error;
console.error = () => {};

// Mock setInterval / clearInterval for the editor-switch polling in
// _showConflictDialogInternal.
const _origSetInterval = global.setInterval;
const _origClearInterval = global.clearInterval;
global.setInterval = (fn, ms) => _origSetInterval(fn, ms);
global.clearInterval = (id) => _origClearInterval(id);

// --- Mock element setup ---
function setupMockElements() {
    mockElements = {
        'conflict-dialog-overlay': { style: { display: 'none' } },
        'conflict-dialog-body': { textContent: '' },
        'conflict-keep-mine': {
            addEventListener: (event, fn) => {
                if (!mockEventListeners['keep-mine']) mockEventListeners['keep-mine'] = [];
                mockEventListeners['keep-mine'].push({ event, fn });
            },
            removeEventListener: (event, fn) => {
                if (mockEventListeners['keep-mine']) {
                    mockEventListeners['keep-mine'] = mockEventListeners['keep-mine']
                        .filter(l => !(l.event === event && l.fn === fn));
                }
            }
        },
        'conflict-load-external': {
            addEventListener: (event, fn) => {
                if (!mockEventListeners['load-external']) mockEventListeners['load-external'] = [];
                mockEventListeners['load-external'].push({ event, fn });
            },
            removeEventListener: (event, fn) => {
                if (mockEventListeners['load-external']) {
                    mockEventListeners['load-external'] = mockEventListeners['load-external']
                        .filter(l => !(l.event === event && l.fn === fn));
                }
            }
        }
    };
    mockEventListeners = {};
}

function clickKeepMine() {
    mockEventListeners['keep-mine']?.forEach(l => { if (l.event === 'click') l.fn(); });
}

function clickLoadExternal() {
    mockEventListeners['load-external']?.forEach(l => { if (l.event === 'click') l.fn(); });
}

function switchEditor(newPath) {
    global.window.currentEditor.path = newPath;
}

// --- Test runner ---
let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail) {
    if (condition) {
        passed++;
        console.log(`  PASS: ${name}${detail ? ' — ' + detail : ''}`);
    } else {
        failed++;
        const msg = `  FAIL: ${name}${detail ? ' — ' + detail : ''}`;
        console.log(msg);
        failures.push(msg);
    }
}

async function runAllTests() {
    console.log('\n=== Conflict Dialog Tests ===\n');

    // Reset state before each test
    function reset() {
        setupMockElements();
        global.window.conflictPath = null;
        global.window.conflictQueue = [];
    }

    // Test 1: Keep mine button
    {
        reset();
        global.window.currentEditor.path = '/test/file1.md';
        const promise = showConflictDialog('/test/file1.md');
        await new Promise(r => setTimeout(r, 10));
        assert('Overlay becomes visible',
            mockElements['conflict-dialog-overlay'].style.display === 'flex');
        assert('Body shows file path',
            mockElements['conflict-dialog-body'].textContent === '/test/file1.md');
        clickKeepMine();
        const result = await promise;
        assert('Keep mine returns "mine"', result === 'mine',
            `got "${result}"`);
        assert('Overlay hidden after keep',
            mockElements['conflict-dialog-overlay'].style.display === 'none');
        assert('conflictPath reset after keep', global.window.conflictPath === null);
    }

    // Test 2: Load external button
    {
        reset();
        global.window.currentEditor.path = '/test/file2.md';
        const promise = showConflictDialog('/test/file2.md');
        await new Promise(r => setTimeout(r, 10));
        clickLoadExternal();
        const result = await promise;
        assert('Load external returns "external"', result === 'external',
            `got "${result}"`);
        assert('Overlay hidden after load',
            mockElements['conflict-dialog-overlay'].style.display === 'none');
    }

    // Test 3: Editor switch auto-closes
    {
        reset();
        global.window.currentEditor.path = '/test/switch-test.md';
        const promise = showConflictDialog('/test/switch-test.md');
        await new Promise(r => setTimeout(r, 10));
        // Simulate editor switch
        switchEditor('/test/other.md');
        // Wait for polling to detect
        await new Promise(r => setTimeout(r, 250));
        const result = await promise;
        assert('Editor switch returns "external"', result === 'external',
            `got "${result}"`);
        assert('Overlay hidden after switch',
            mockElements['conflict-dialog-overlay'].style.display === 'none');
    }

    // Test 4: Duplicate call for same path
    {
        reset();
        global.window.currentEditor.path = '/test/dup.md';
        const promise1 = showConflictDialog('/test/dup.md');
        await new Promise(r => setTimeout(r, 10));
        const promise2 = showConflictDialog('/test/dup.md');
        const result2 = await promise2;
        assert('Duplicate call returns "mine"', result2 === 'mine',
            `got "${result2}"`);
        // Clean up
        clickKeepMine();
        await promise1;
    }

    // Test 5: Queue — second conflict for different path
    {
        reset();
        global.window.currentEditor.path = '/test/first.md';
        const promise1 = showConflictDialog('/test/first.md');
        await new Promise(r => setTimeout(r, 10));

        // Start second conflict
        const promise2 = showConflictDialog('/test/second.md');

        // First dialog still shows first path
        assert('Queue: first dialog shows first path',
            mockElements['conflict-dialog-body'].textContent === '/test/first.md');

        // Resolve first
        clickKeepMine();
        const result1 = await promise1;
        assert('Queue: first resolves to "mine"', result1 === 'mine');

        // Wait for second dialog to appear
        await new Promise(r => setTimeout(r, 150));

        // Second should now show the second path
        assert('Queue: second dialog shows second path',
            mockElements['conflict-dialog-body'].textContent === '/test/second.md');

        // Resolve second
        global.window.currentEditor.path = '/test/second.md';
        clickKeepMine();
        const result2 = await promise2;
        assert('Queue: second resolves to "mine"', result2 === 'mine',
            `got "${result2}"`);
    }

    // Test 6: conflictPath blocks re-entry
    {
        reset();
        global.window.currentEditor.path = '/test/block.md';
        const promise = showConflictDialog('/test/block.md');
        await new Promise(r => setTimeout(r, 10));
        assert('conflictPath is set during dialog', global.window.conflictPath === '/test/block.md');
        clickKeepMine();
        await promise;
        assert('conflictPath is null after dialog', global.window.conflictPath === null);
    }

    // Test 7: Overlay hidden after resolution (timing)
    {
        reset();
        global.window.currentEditor.path = '/test/visible.md';
        const promise = showConflictDialog('/test/visible.md');
        await new Promise(r => setTimeout(r, 10));
        clickKeepMine();
        await promise;
        assert('Overlay display is none after keep',
            mockElements['conflict-dialog-overlay'].style.display === 'none');
    }

    // Test 8: conflictQueue is empty after all conflicts resolve
    {
        reset();
        assert('conflictQueue starts empty', global.window.conflictQueue.length === 0);

        global.window.currentEditor.path = '/test/a.md';
        const p1 = showConflictDialog('/test/a.md');
        await new Promise(r => setTimeout(r, 10));
        const p2 = showConflictDialog('/test/b.md');
        await new Promise(r => setTimeout(r, 10));

        assert('conflictQueue has 1 entry while dialog open', global.window.conflictQueue.length === 1);

        clickKeepMine();
        await p1;
        await new Promise(r => setTimeout(r, 150));

        assert('conflictQueue empty after first resolves', global.window.conflictQueue.length === 0);

        global.window.currentEditor.path = '/test/b.md';
        clickKeepMine();
        await p2;
    }

    // Test 9: DOM elements missing — fallback to 'external'
    {
        reset();
        // Remove mock elements to simulate missing HTML template.
        mockElements = {};
        global.window.currentEditor.path = '/test/missing-elements.md';
        const result = await showConflictDialog('/test/missing-elements.md');
        assert('Missing DOM elements returns "external"', result === 'external',
            `got "${result}"`);
        assert('conflictPath is null after missing-elements fallback',
            global.window.conflictPath === null);
    }

    // Summary
    console.log('\n=== Results ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    if (failures.length > 0) {
        console.log('\nFailures:');
        failures.forEach(f => console.log(f));
    }

    process.exit(failed > 0 ? 1 : 0);
}

runAllTests();
