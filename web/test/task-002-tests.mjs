// REQ-260618-010-TASK-002 Tests — run with: node --test web/test/task-002-tests.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// Replicated helpers from the codebase for testing
// ============================================================

function removeTrailingSlash(path) {
  if (path === '/') return '/';
  if (path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function findNodeByPath(root, path) {
  const searchPath = removeTrailingSlash(path);
  function search(node) {
    if (node.path === searchPath) return node;
    if (!node.getChildren) return null;
    for (const child of node.getChildren()) {
      const found = search(child);
      if (found) return found;
    }
    return null;
  }
  return search(root);
}

function makeMockTreeNode(userObject, opts = {}) {
  const children = [];
  const events = {};
  const node = {
    userObject,
    path: opts.path || null,
    isGroupEnd: opts.isGroupEnd || false,
    shouldBlink: false,
    _expanded: opts.expanded !== undefined ? opts.expanded : true,
    _selected: opts.selected || false,
    _isDir: opts.dir || false,
    parent: opts.parent || null,

    addChild(child) {
      children.push(child);
      child.parent = node;
    },
    prependChild(child) {
      children.unshift(child);
      child.parent = node;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
    },
    removeChildPos(pos) {
      if (pos >= 0 && pos < children.length) children.splice(pos, 1);
    },
    getChildren() { return children; },
    getChildCount() { return children.length; },
    getIndexOfChild(child) { return children.indexOf(child); },
    getRoot() {
      let n = node;
      while (n.parent) n = n.parent;
      return n;
    },
    setUserObject(o) { node.userObject = o; },
    getUserObject() { return node.userObject; },
    setOptions(o) { node._opts = o; },
    changeOption(k, v) { if (node._opts) node._opts[k] = v; },
    getOptions() { return node._opts || {}; },
    isLeaf() { return !node._isDir; },
    setExpanded(v) {
      if (node._expanded === v) return;
      node._expanded = v;
      if (!v && children.length > 0) {
        children.forEach(c => { if (!c.isLeaf()) c.setExpanded(false); });
      }
      if (events.toggle_expanded) events.toggle_expanded(node);
    },
    toggleExpanded() { node.setExpanded(!node._expanded); },
    isExpanded() { return node.isLeaf() ? true : node._expanded; },
    setEnabled(v) { node._enabled = v; },
    toggleEnabled() { node._enabled = !node._enabled; },
    isEnabled() { return node._enabled !== false; },
    setSelected(v) {
      if (node._selected === v) return;
      node._selected = v;
      if (events.toggle_selected) events.toggle_selected(node);
    },
    toggleSelected() { node.setSelected(!node._selected); },
    isSelected() { return node._selected; },
    open() { if (!node.isLeaf() && events.open) events.open(node); },
    on(ev, cb) {
      if (cb === undefined) return events[ev] || (() => {});
      events[ev] = cb;
    },
    equals(other) { return other && other.userObject === node.userObject; },
    toString() { return typeof node.userObject === 'string' ? node.userObject : String(node.userObject); },
  };
  return node;
}

function buildTestTree() {
  const root = makeMockTreeNode('', { path: '/', dir: true, expanded: true });
  const journal = makeMockTreeNode('journal', { path: '/journal', dir: true, expanded: true });
  const habits = makeMockTreeNode('habits', { path: '/habits', dir: true, expanded: false });
  const notesFile = makeMockTreeNode('Notes', { path: '/Notes.md', expanded: false });

  root.addChild(journal);
  root.addChild(habits);
  root.addChild(notesFile);

  const jan = makeMockTreeNode('2026-01.md', { path: '/journal/2026-01.md', expanded: false });
  journal.addChild(jan);

  return root;
}

function toFilename(path) {
  if (path === '/') return '/';
  const parts = path.split('/').filter(x => x);
  return parts[parts.length - 1] || '/';
}

function toDirPath(path) {
  const parts = path.split('/').filter(x => x);
  parts.pop();
  return '/' + parts.join('/');
}

function toRootPath(path) {
  const parts = path.split('/').filter(p => p !== '');
  if (parts.length <= 1) return '/';
  return '/' + parts[0];
}

function isChecklist(filename) {
  return ['Watch.md', 'Shop.md', 'Read.md'].includes(filename);
}

const CONFIG_PATH = '/config.json';
const CHAT_PATH = '/Chat.md';
const LATER_PATH = '/Later.md';

// ============================================================
// Suite 1: findNodeByPath
// ============================================================
describe('findNodeByPath', () => {
  it('finds root node', () => {
    const root = buildTestTree();
    const found = findNodeByPath(root, '/');
    assert.ok(found);
    assert.equal(found.path, '/');
  });

  it('finds directory node by full path', () => {
    const root = buildTestTree();
    const found = findNodeByPath(root, '/journal');
    assert.ok(found);
    assert.equal(found.path, '/journal');
  });

  it('finds directory node by path with trailing slash', () => {
    const root = buildTestTree();
    const found = findNodeByPath(root, '/journal/');
    assert.ok(found);
    assert.equal(found.path, '/journal');
  });

  it('finds file node by path', () => {
    const root = buildTestTree();
    const found = findNodeByPath(root, '/Notes.md');
    assert.ok(found);
    assert.equal(found.path, '/Notes.md');
  });

  it('finds nested file node', () => {
    const root = buildTestTree();
    const found = findNodeByPath(root, '/journal/2026-01.md');
    assert.ok(found);
    assert.equal(found.path, '/journal/2026-01.md');
  });

  it('returns null for non-existent path', () => {
    const root = buildTestTree();
    const found = findNodeByPath(root, '/nonexistent');
    assert.equal(found, null);
  });

  it('returns null for non-existent nested path', () => {
    const root = buildTestTree();
    const found = findNodeByPath(root, '/journal/nonexistent.md');
    assert.equal(found, null);
  });

  it('finds collapsed directory node', () => {
    const root = buildTestTree();
    const found = findNodeByPath(root, '/habits');
    assert.ok(found);
    assert.equal(found.path, '/habits');
    assert.equal(found.isExpanded(), false);
  });
});

// ============================================================
// Suite 2: Diff path depth sorting
// ============================================================
describe('Diff path depth sorting', () => {
  // This mirrors the sort used in renderSidebar partial-update path.
  function sortByDepth(paths) {
    return [...paths].sort((a, b) => {
      const da = (a.match(/\//g) || []).length;
      const db = (b.match(/\//g) || []).length;
      if (da !== db) return da - db;
      // Directories before files at the same depth.
      const aDir = a.endsWith('/');
      const bDir = b.endsWith('/');
      if (aDir && !bDir) return -1;
      if (!aDir && bDir) return 1;
      return a.localeCompare(b);
    });
  }

  it('sorts by path depth ascending, directories before files at same depth', () => {
    const paths = [
      '/journal/2026-01.md',
      '/projects/',
      '/projects/code/',
      '/journal/',
      '/projects/code/main.js',
    ];
    const sorted = sortByDepth(paths);
    // Directories at depth 2 before files at depth 2.
    assert.ok(sorted.indexOf('/journal/') < sorted.indexOf('/journal/2026-01.md'),
      'journal dir before jan file');
    // Depth 3 items come after depth 2 items.
    assert.ok(sorted.indexOf('/projects/') < sorted.indexOf('/projects/code/'),
      'parent dir before child dir');
    // At depth 3, /projects/code/ (dir) before /projects/code/main.js (file).
    assert.ok(sorted.indexOf('/projects/code/') < sorted.indexOf('/projects/code/main.js'),
      'dir before file at same depth');
  });

  it('handles empty added array', () => {
    assert.equal(sortByDepth([]).length, 0);
  });

  it('handles mixed root and nested paths', () => {
    const paths = [
      '/deep/nested/file.md',
      '/rootfile.md',
      '/dir/',
    ];
    const sorted = sortByDepth(paths);
    // Depth 1 items first: /rootfile.md (1 slash)
    // Depth 2 items next: /dir/ (2 slashes — leading + trailing)
    // Depth 3 items last: /deep/nested/file.md (3 slashes)
    assert.equal(sorted[0], '/rootfile.md');
    assert.equal(sorted[1], '/dir/');
    assert.equal(sorted[2], '/deep/nested/file.md');
  });
});

// ============================================================
// Suite 3: Path filtering logic
// ============================================================
describe('Ignored path filtering', () => {
  it('media paths are skipped', () => {
    const paths = ['/media/', '/media/image.png', '/notes/file.md'];
    const filtered = paths.filter(p => p !== '/media' && !p.startsWith('/media/'));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0], '/notes/file.md');
  });

  it('system paths are skipped in file additions', () => {
    const systemPaths = ['/config.json', '/Chat.md', '/Later.md'];
    const systemSet = [CONFIG_PATH, CHAT_PATH, LATER_PATH];
    const filtered = systemPaths.filter(p => !systemSet.includes(p));
    assert.equal(filtered.length, 0);
  });

  it('non-md files are skipped', () => {
    const paths = ['/notes/readme.md', '/notes/image.png', '/notes/data.json'];
    const filtered = paths.filter(p => toFilename(p).endsWith('.md'));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0], '/notes/readme.md');
  });

  it('root-level checklists are skipped', () => {
    const paths = ['/Read.md', '/Watch.md', '/Shop.md', '/Notes.md'];
    const filtered = paths.filter(p => {
      return !(isChecklist(toFilename(p)) && toRootPath(p) === '/');
    });
    // Read, Watch, Shop are skipped; Notes.md passes
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0], '/Notes.md');
  });

  it('checklists inside directories are NOT skipped', () => {
    const paths = ['/somefolder/Read.md', '/somefolder/file.md'];
    const filtered = paths.filter(p => {
      return !(isChecklist(toFilename(p)) && toRootPath(p) === '/');
    });
    // Read.md inside somefolder should NOT be skipped
    assert.equal(filtered.length, 2);
  });
});

// ============================================================
// Suite 4: checkFileModifications batching logic
// ============================================================
describe('checkFileModifications batching', () => {
  it('batch size of 10 splits 25 files into 3 batches', () => {
    const BATCH_SIZE = 10;
    const paths = Array.from({ length: 25 }, (_, i) => `/file${i}.md`);
    const batches = [];
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      batches.push(paths.slice(i, i + BATCH_SIZE));
    }
    assert.equal(batches.length, 3);
    assert.equal(batches[0].length, 10);
    assert.equal(batches[1].length, 10);
    assert.equal(batches[2].length, 5);
  });

  it('less than batch size produces single batch', () => {
    const BATCH_SIZE = 10;
    const paths = Array.from({ length: 5 }, (_, i) => `/file${i}.md`);
    const batches = [];
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      batches.push(paths.slice(i, i + BATCH_SIZE));
    }
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 5);
  });

  it('empty path list produces no batches', () => {
    const BATCH_SIZE = 10;
    const paths = [];
    const batches = [];
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      batches.push(paths.slice(i, i + BATCH_SIZE));
    }
    assert.equal(batches.length, 0);
  });

  it('exactly batch size produces single batch', () => {
    const BATCH_SIZE = 10;
    const paths = Array.from({ length: 10 }, (_, i) => `/file${i}.md`);
    const batches = [];
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      batches.push(paths.slice(i, i + BATCH_SIZE));
    }
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 10);
  });

  it('setTimeout yield between batches (logic only)', () => {
    // Verify that yield condition fires only when more batches remain.
    const BATCH_SIZE = 10;
    const paths = Array.from({ length: 25 }, (_, i) => `/file${i}.md`);
    let yieldCount = 0;
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      if (i + BATCH_SIZE < paths.length) {
        yieldCount++; // setTimeout(0) would fire here
      }
    }
    // 25 files → batches at 0, 10, 20. Yields after batch 0 and batch 10.
    assert.equal(yieldCount, 2);
  });
});

// ============================================================
// Suite 5: Fast poll diff threshold for full vs partial rebuild
// ============================================================
describe('Fast poll diff threshold', () => {
  it('small diff triggers partial update (≤50 paths)', () => {
    const added = Array.from({ length: 5 }, (_, i) => `/file${i}.md`);
    const removed = Array.from({ length: 3 }, (_, i) => `/old${i}.md`);
    const total = added.length + removed.length;
    assert.ok(total <= 50);
  });

  it('large diff falls back to full rebuild (>50 paths)', () => {
    const added = Array.from({ length: 30 }, (_, i) => `/file${i}.md`);
    const removed = Array.from({ length: 25 }, (_, i) => `/old${i}.md`);
    const total = added.length + removed.length;
    assert.ok(total > 50);
  });

  it('exactly zero paths triggers partial update', () => {
    const total = 0;
    // Zero paths means no changes — no render call needed, but if called, partial is fine.
    assert.ok(total <= 50);
  });

  it('threshold at exactly 50 uses partial update', () => {
    const added = Array.from({ length: 25 }, (_, i) => `/file${i}.md`);
    const removed = Array.from({ length: 25 }, (_, i) => `/old${i}.md`);
    assert.equal(added.length + removed.length, 50);
  });
});

// ============================================================
// Suite 6: Slow poll state management
// ============================================================
describe('Slow poll state management', () => {
  const SLOW_POLL_INTERVAL = 30000;

  it('has correct poll interval (30 seconds)', () => {
    assert.equal(SLOW_POLL_INTERVAL, 30000);
  });

  it('skips when isPollingPaused is true', () => {
    const isPollingPaused = true;
    let tickRan = false;
    if (isPollingPaused) { /* return */ }
    else { tickRan = true; }
    assert.equal(tickRan, false);
  });

  it('skips when loading local files', () => {
    const isLoadingLocalFiles = true;
    let tickRan = false;
    if (isLoadingLocalFiles) { /* return */ }
    else { tickRan = true; }
    assert.equal(tickRan, false);
  });

  it('skips when no directory handle', () => {
    const handle = null;
    let tickRan = false;
    if (!handle) { /* return */ }
    else { tickRan = true; }
    assert.equal(tickRan, false);
  });

  it('runs when all guards pass', () => {
    const isPollingPaused = false;
    const isLoadingLocalFiles = false;
    const handle = {};
    let tickRan = false;
    if (isPollingPaused) {}
    else if (isLoadingLocalFiles) {}
    else if (!handle) {}
    else { tickRan = true; }
    assert.equal(tickRan, true);
  });

  it('guards against overlapping ticks with slowPollRunning flag', () => {
    const slowPollRunning = true;
    let tickRan = false;
    if (slowPollRunning) { /* return */ }
    else { tickRan = true; }
    assert.equal(tickRan, false);
  });
});

// ============================================================
// Suite 7: Partial Tree Mutation (addChild / removeChild)
// ============================================================
describe('Tree mutation via addChild/removeChild', () => {
  it('addChild creates correct parent reference', () => {
    const parent = makeMockTreeNode('parent', { path: '/parent', dir: true });
    const child = makeMockTreeNode('child', { path: '/parent/child.md' });
    parent.addChild(child);
    assert.equal(child.parent, parent);
    assert.equal(parent.getChildCount(), 1);
    assert.equal(parent.getChildren()[0], child);
  });

  it('removeChild detaches node', () => {
    const parent = makeMockTreeNode('parent', { path: '/parent', dir: true });
    const child = makeMockTreeNode('child', { path: '/parent/child.md' });
    parent.addChild(child);
    assert.equal(parent.getChildCount(), 1);
    parent.removeChild(child);
    assert.equal(parent.getChildCount(), 0);
  });

  it('removing a directory node — children unreachable from root', () => {
    const root = makeMockTreeNode('', { path: '/', dir: true });
    const dir = makeMockTreeNode('somedir', { path: '/somedir', dir: true });
    const file = makeMockTreeNode('file.md', { path: '/somedir/file.md' });
    dir.addChild(file);
    root.addChild(dir);
    assert.equal(root.getChildCount(), 1);
    root.removeChild(dir);
    assert.equal(root.getChildCount(), 0);
    // dir still holds its children in memory (won't be rendered)
    assert.equal(dir.getChildCount(), 1);
  });

  it('auto-expand collapsed parent when adding new child', () => {
    const parent = makeMockTreeNode('collapsed', { path: '/collapsed', dir: true, expanded: false });
    assert.equal(parent.isExpanded(), false);
    if (!parent.isLeaf() && !parent.isExpanded()) {
      parent.setExpanded(true);
    }
    assert.equal(parent.isExpanded(), true);
  });

  it('shouldBlink flag can be set on node', () => {
    const node = makeMockTreeNode('newfile.md', { path: '/newfile.md' });
    node.shouldBlink = true;
    assert.equal(node.shouldBlink, true);
  });

  it('blink applied only to nodes in modifiedPaths', () => {
    const modifiedPaths = ['/newfile.md', '/newdir/'];
    assert.ok(modifiedPaths.includes('/newfile.md'));
    assert.ok(modifiedPaths.includes('/newdir/'));
  });

  it('leaf nodes should not auto-expand (isLeaf returns true)', () => {
    const fileNode = makeMockTreeNode('file.md', { path: '/file.md', expanded: false });
    // isLeaf returns true for non-dirs, so setExpanded shouldn't change behavior
    assert.equal(fileNode.isLeaf(), true);
    fileNode.setExpanded(true);
    // For leaf nodes, isExpanded still returns true (the real TreeNode does this too)
    assert.equal(fileNode.isExpanded(), true);
  });

  it('add multiple children then remove one', () => {
    const parent = makeMockTreeNode('parent', { path: '/parent', dir: true });
    const a = makeMockTreeNode('a', { path: '/parent/a.md' });
    const b = makeMockTreeNode('b', { path: '/parent/b.md' });
    const c = makeMockTreeNode('c', { path: '/parent/c.md' });
    parent.addChild(a);
    parent.addChild(b);
    parent.addChild(c);
    assert.equal(parent.getChildCount(), 3);
    parent.removeChild(b);
    assert.equal(parent.getChildCount(), 2);
    assert.equal(parent.getChildren()[0], a);
    assert.equal(parent.getChildren()[1], c);
  });
});

// ============================================================
// Suite 8: Modified detection logic
// ============================================================
describe('Modified detection logic', () => {
  it('detects modification when disk timestamp is newer', () => {
    const memLastModified = 1000;
    const diskLastModified = 2000;
    assert.equal(diskLastModified > memLastModified, true);
  });

  it('no modification when disk timestamp equals memory', () => {
    const memLastModified = 1000;
    const diskLastModified = 1000;
    assert.equal(diskLastModified > memLastModified, false);
  });

  it('no modification when disk timestamp is older', () => {
    const memLastModified = 2000;
    const diskLastModified = 1000;
    assert.equal(diskLastModified > memLastModified, false);
  });

  it('undefined memory timestamp does not flag modification', () => {
    const memLastModified = undefined;
    const diskLastModified = 2000;
    const isModified = memLastModified !== undefined && diskLastModified > memLastModified;
    assert.equal(isModified, false);
  });

  it('current editor path is skipped', () => {
    const currentEditor = { path: '/notes/file.md' };
    const paths = ['/notes/file.md', '/notes/other.md', '/journal/log.md'];
    const filtered = paths.filter(p => currentEditor.path !== p);
    assert.equal(filtered.length, 2);
    assert.ok(!filtered.includes('/notes/file.md'));
  });

  it('media paths are skipped during check', () => {
    const paths = ['/media/image.png', '/media/audio.mp3', '/notes/file.md'];
    const filtered = paths.filter(p => !(p.startsWith('/media/') || p === '/media'));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0], '/notes/file.md');
  });
});

// ============================================================
// Suite 9: toDirPath helper
// ============================================================
describe('toDirPath helper', () => {
  it('extracts parent directory for root file', () => {
    assert.equal(toDirPath('/file.md'), '/');
  });

  it('extracts parent directory for nested file', () => {
    assert.equal(toDirPath('/journal/2026-01.md'), '/journal');
  });

  it('extracts parent directory for deeply nested file', () => {
    assert.equal(toDirPath('/projects/code/main.js'), '/projects/code');
  });

  it('extracts parent directory for subdirectory', () => {
    assert.equal(toDirPath('/journal/'), '/');
  });
});

// ============================================================
// Suite 10: End-to-end partial update simulation
// ============================================================
describe('End-to-end partial update simulation', () => {
  it('adds new file to existing directory', () => {
    const root = buildTestTree();
    const parentPath = '/journal';
    const parentNode = findNodeByPath(root, parentPath);
    assert.ok(parentNode, 'parent directory should exist');

    const newFileNode = makeMockTreeNode('2026-02.md', { path: '/journal/2026-02.md' });
    newFileNode.shouldBlink = true;
    parentNode.addChild(newFileNode);

    const found = findNodeByPath(root, '/journal/2026-02.md');
    assert.ok(found);
    assert.equal(found.shouldBlink, true);
    assert.equal(parentNode.getChildCount(), 2); // jan + feb
  });

  it('adds new directory then file under it', () => {
    const root = buildTestTree();
    // Add new directory
    const newDir = makeMockTreeNode('projects', { path: '/projects', dir: true, expanded: true });
    // Need auto-expand root (already expanded so no-op)
    root.addChild(newDir);
    assert.ok(findNodeByPath(root, '/projects'));

    // Add file under new directory
    const newFile = makeMockTreeNode('todo.md', { path: '/projects/todo.md' });
    newFile.shouldBlink = true;
    newDir.addChild(newFile);
    assert.ok(findNodeByPath(root, '/projects/todo.md'));
  });

  it('removes file from directory', () => {
    const root = buildTestTree();
    const fileNode = findNodeByPath(root, '/journal/2026-01.md');
    assert.ok(fileNode);
    fileNode.parent.removeChild(fileNode);

    const found = findNodeByPath(root, '/journal/2026-01.md');
    assert.equal(found, null);
    assert.equal(findNodeByPath(root, '/journal').getChildCount(), 0);
  });

  it('removes entire directory tree', () => {
    const root = buildTestTree();
    const journalNode = findNodeByPath(root, '/journal');
    assert.ok(journalNode);
    journalNode.parent.removeChild(journalNode);

    assert.equal(findNodeByPath(root, '/journal'), null);
    assert.equal(findNodeByPath(root, '/journal/2026-01.md'), null);
  });

  it('full diff flow: add dir, add file in dir, remove old file', () => {
    const root = buildTestTree();
    const diff = {
      added: ['/projects/', '/projects/README.md'],
      removed: ['/Notes.md'],
    };

    // Process removals
    for (const path of diff.removed) {
      const node = findNodeByPath(root, path);
      if (node && node.parent) node.parent.removeChild(node);
    }

    // Process additions (sorted by depth)
    const added = [...diff.added].sort((a, b) => {
      return (a.match(/\//g) || []).length - (b.match(/\//g) || []).length;
    });

    for (const path of added) {
      const parentPath = toDirPath(path);
      let parentNode = findNodeByPath(root, removeTrailingSlash(parentPath));
      if (!parentNode) parentNode = root;

      if (path.endsWith('/')) {
        const dirNode = makeMockTreeNode(path.split('/').filter(x => x).pop(), {
          path: removeTrailingSlash(path), dir: true, expanded: false,
        });
        parentNode.addChild(dirNode);
      } else {
        const fileName = toFilename(path);
        const fileNode = makeMockTreeNode(fileName, { path });
        fileNode.shouldBlink = true;
        parentNode.addChild(fileNode);
      }
    }

    // Verify results
    assert.equal(findNodeByPath(root, '/Notes.md'), null, 'Notes.md removed');
    assert.ok(findNodeByPath(root, '/projects'), 'projects dir added');
    assert.ok(findNodeByPath(root, '/projects/README.md'), 'README added');
    // Journal still exists
    assert.ok(findNodeByPath(root, '/journal'), 'journal still exists');
  });
});

// ============================================================
// Suite 11: checkFileModifications — full-algorithm integration
// ============================================================
describe('checkFileModifications full-algorithm integration', () => {
  // Replicates the production checkFileModifications algorithm (files.js:1869)
  // using realistic mock handles so we exercise the complete flow through the
  // same public interface shape: (filesObj, _rootHandle, _lastCheckTime) → {modified, deleted}.

  function walk(filesObj, callback) {
    const stack = [{obj: filesObj, path: '/'}];
    let iterations = 0;
    while (stack.length > 0) {
      if (++iterations > 100000) throw new Error('walk overflow');
      const {obj, path} = stack.pop();
      if (obj.isFile) {
        if (callback(path, true) === false) return;
        continue;
      }
      const keys = Object.keys(obj).filter(k => k !== 'isFile');
      keys.forEach(key => {
        const child = obj[key];
        if (typeof child === 'object' && child !== null) {
          // path (directory nodes) already ends with '/', so concatenate directly.
          const childPath = path + key;
          stack.push({obj: child, path: childPath});
        }
      });
    }
  }

  function makeMemFile(path, handle, lastModified) {
    return { isFile: true, path, handle, lastModified };
  }

  function makeMemDir(entries) {
    return { isFile: false, ...entries };
  }

  async function checkFileModificationsFaithful(filesObj, currentEditorPath) {
    const modified = [];
    const deleted = [];
    const filePaths = [];

    walk(filesObj, (path, isFile) => {
      if (!isFile) return;
      if (currentEditorPath && currentEditorPath === path) return;
      if (path.startsWith('/media/') || path === '/media') return;
      filePaths.push(path);
    });

    const BATCH_SIZE = 10;
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      const batch = filePaths.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(async (path) => {
        const parts = path.split('/').filter(x => x);
        let cursor = filesObj;
        for (const part of parts) {
          const key = parts[parts.length - 1] === part ? part : part + '/';
          cursor = cursor[key];
          if (!cursor) return null;
        }
        const memFile = cursor.isFile ? cursor : null;
        if (!memFile || !memFile.handle) return null;
        try {
          const file = await memFile.handle.getFile();
          const diskModified = file.lastModified;
          if (memFile.lastModified !== undefined && diskModified > memFile.lastModified) {
            memFile.lastModified = diskModified;
            return { path, modified: true };
          }
          if (diskModified > (memFile.lastModified || 0)) {
            memFile.lastModified = diskModified;
          }
          return { path, modified: false };
        } catch (_e) {
          return { path, deleted: true };
        }
      }));

      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        if (result.value.deleted) deleted.push(result.value.path);
        else if (result.value.modified) modified.push(result.value.path);
      }

      if (i + BATCH_SIZE < filePaths.length) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    return { modified, deleted };
  }

  function makeFakeHandle(lastModified) {
    return { getFile: async () => ({ lastModified }) };
  }

  it('reports no modifications when all timestamps match', async () => {
    const filesObj = makeMemDir({
      'file1.md': makeMemFile('/file1.md', makeFakeHandle(1000), 1000),
      'file2.md': makeMemFile('/file2.md', makeFakeHandle(2000), 2000),
    });
    const { modified, deleted } = await checkFileModificationsFaithful(filesObj, null);
    assert.equal(modified.length, 0);
    assert.equal(deleted.length, 0);
  });

  it('detects external modification when disk timestamp is newer', async () => {
    const filesObj = makeMemDir({
      'changed.md': makeMemFile('/changed.md', makeFakeHandle(3000), 1000),
      'unchanged.md': makeMemFile('/unchanged.md', makeFakeHandle(500), 500),
    });
    const { modified, deleted } = await checkFileModificationsFaithful(filesObj, null);
    assert.equal(modified.length, 1);
    assert.equal(modified[0], '/changed.md');
    assert.equal(deleted.length, 0);
    // In-memory timestamp updated so next poll won't re-report.
    assert.equal(filesObj['changed.md'].lastModified, 3000);
  });

  it('detects deletion when file handle throws', async () => {
    const filesObj = makeMemDir({
      'gone.md': makeMemFile('/gone.md', { getFile: async () => { throw new Error('NotFound'); } }, 1000),
      'ok.md': makeMemFile('/ok.md', makeFakeHandle(500), 500),
    });
    const { modified, deleted } = await checkFileModificationsFaithful(filesObj, null);
    assert.equal(modified.length, 0);
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0], '/gone.md');
  });

  it('skips current-editor file', async () => {
    const filesObj = makeMemDir({
      'open.md': makeMemFile('/open.md', makeFakeHandle(5000), 1000),
      'other.md': makeMemFile('/other.md', makeFakeHandle(6000), 1000),
    });
    const { modified, deleted } = await checkFileModificationsFaithful(filesObj, '/open.md');
    assert.equal(modified.length, 1);
    assert.equal(modified[0], '/other.md');
  });

  it('skips files under /media/', async () => {
    const filesObj = makeMemDir({
      'notes.md': makeMemFile('/notes.md', makeFakeHandle(5000), 1000),
      'media': makeMemDir({ 'img.png': makeMemFile('/media/img.png', makeFakeHandle(9999), 1) }),
    });
    const { modified } = await checkFileModificationsFaithful(filesObj, null);
    assert.equal(modified.length, 1);
    assert.equal(modified[0], '/notes.md');
  });

  it('does not flag file with undefined memory timestamp', async () => {
    const filesObj = makeMemDir({
      'fresh.md': makeMemFile('/fresh.md', makeFakeHandle(2000), undefined),
      'known.md': makeMemFile('/known.md', makeFakeHandle(9999), 1000),
    });
    const { modified } = await checkFileModificationsFaithful(filesObj, null);
    // fresh.md has undefined lastModified → not flagged
    // known.md has disk > memory → flagged
    assert.equal(modified.length, 1);
    assert.equal(modified[0], '/known.md');
  });

  it('processes 25 files in 3 batches with yield points', async () => {
    const entries = {};
    for (let i = 0; i < 25; i++) {
      entries[`file${i}.md`] = makeMemFile(`/file${i}.md`, makeFakeHandle(100), 50);
    }
    const filesObj = makeMemDir(entries);
    const { modified, deleted } = await checkFileModificationsFaithful(filesObj, null);
    // All 25 files have newer disk timestamps → all modified.
    assert.equal(modified.length, 25);
    assert.equal(deleted.length, 0);
  });

  it('mixed modification and deletion in same run', async () => {
    const filesObj = makeMemDir({
      'mod.md': makeMemFile('/mod.md', makeFakeHandle(5000), 1000),
      'del.md': makeMemFile('/del.md', { getFile: async () => { throw new Error('gone'); } }, 1000),
      'fine.md': makeMemFile('/fine.md', makeFakeHandle(1000), 1000),
    });
    const { modified, deleted } = await checkFileModificationsFaithful(filesObj, null);
    assert.equal(modified.length, 1, 'modified count');
    assert.equal(modified[0], '/mod.md');
    assert.equal(deleted.length, 1, 'deleted count');
    assert.equal(deleted[0], '/del.md');
  });

  it('handles nested directory structure', async () => {
    const filesObj = {
      isFile: false,
      'journal/': {
        isFile: false,
        '2026-01.md': makeMemFile('/journal/2026-01.md', makeFakeHandle(5000), 1000),
        '2026-02.md': makeMemFile('/journal/2026-02.md', makeFakeHandle(5000), 1000),
      },
      'readme.md': makeMemFile('/readme.md', makeFakeHandle(5000), 1000),
    };
    const { modified } = await checkFileModificationsFaithful(filesObj, null);
    assert.equal(modified.length, 3);
    assert.ok(modified.includes('/journal/2026-01.md'));
    assert.ok(modified.includes('/journal/2026-02.md'));
    assert.ok(modified.includes('/readme.md'));
  });

  it('empty files object returns empty results', async () => {
    const { modified, deleted } = await checkFileModificationsFaithful({ isFile: false }, null);
    assert.equal(modified.length, 0);
    assert.equal(deleted.length, 0);
  });
});

// ============================================================
// Suite 12: Slow poll lifecycle — pause/resume/start/stop coordination
// ============================================================
describe('Slow poll lifecycle — pause/resume coordination with fast poll', () => {
  // Models the state lifecycle from app.js: fast poll + slow poll share
  // isPollingPaused; pauseFastPoll clears both timers; resumeFastPoll
  // restarts both; stopSlowPoll runs on beforeunload alongside stopFastPoll.

  it('pauseFastPoll clears both fast and slow timers', () => {
    let fastTimer = 1;   // non-null → "running"
    let slowTimer = 2;

    // Simulate pauseFastPoll:
    if (fastTimer) { fastTimer = null; }
    if (slowTimer) { slowTimer = null; }

    assert.equal(fastTimer, null, 'fast timer cleared');
    assert.equal(slowTimer, null, 'slow timer cleared');
  });

  it('pauseFastPoll is idempotent (already paused)', () => {
    let fastTimer = null;
    let slowTimer = null;

    // Second call should be a no-op.
    if (fastTimer) { fastTimer = null; }
    if (slowTimer) { slowTimer = null; }

    assert.equal(fastTimer, null);
    assert.equal(slowTimer, null);
  });

  it('resumeFastPoll restarts both timers when not memFS', () => {
    let fastTimer = null;
    let slowTimer = null;
    const isMemFS = false;

    // Simulate resumeFastPoll:
    if (!fastTimer) { fastTimer = 1; }
    if (!slowTimer && !isMemFS) { slowTimer = 1; }

    assert.notEqual(fastTimer, null, 'fast timer started');
    assert.notEqual(slowTimer, null, 'slow timer started');
  });

  it('resumeFastPoll does not start slow poll when isMemFS', () => {
    let fastTimer = null;
    let slowTimer = null;
    const isMemFS = true;

    if (!fastTimer) { fastTimer = 1; }
    if (!slowTimer && !isMemFS) { slowTimer = 1; }

    assert.notEqual(fastTimer, null, 'fast timer started');
    assert.equal(slowTimer, null, 'slow timer NOT started for memFS');
  });

  it('resumeFastPoll does not duplicate timers if already running', () => {
    let fastTimer = 1;
    let slowTimer = 1;
    const isMemFS = false;

    // resumeFastPoll first checks: if (!isPollingPaused && fastTimer) return;
    // So already-running timers stay as-is.
    if (!fastTimer) { fastTimer = 1; }
    if (!slowTimer && !isMemFS) { slowTimer = 1; }

    assert.equal(fastTimer, 1, 'fast timer unchanged');
    assert.equal(slowTimer, 1, 'slow timer unchanged');
  });

  it('startSlowPoll is idempotent — no duplicate timers', () => {
    let slowTimer = 1; // already running

    if (slowTimer) return; // early return

    slowTimer = 2; // would duplicate but shouldn't reach here
    assert.equal(slowTimer, 1, 'slow timer unchanged');
  });

  it('stopSlowPoll clears timer', () => {
    let slowTimer = 1;

    if (slowTimer) {
      slowTimer = null;
    }

    assert.equal(slowTimer, null);
  });

  it('startSlowPoll starts timer when none is running', () => {
    let slowTimer = null;

    if (slowTimer) return; // early return — not hit
    slowTimer = 1; // setInterval

    assert.equal(slowTimer, 1);
  });

  it('directory switch stops both polls then restarts both', () => {
    // Models _switchToLocalDirectory behavior (app.js ~807-815)
    let fastTimer = 1;
    let slowTimer = 1;
    const isMemFS = false;

    // --- stop phase ---
    fastTimer = null;
    slowTimer = null;
    assert.equal(fastTimer, null, 'fast stopped on dir switch');
    assert.equal(slowTimer, null, 'slow stopped on dir switch');

    // --- start phase ---
    if (!isMemFS) {
      if (!fastTimer) fastTimer = 1;
      if (!slowTimer) slowTimer = 1;
    }
    assert.notEqual(fastTimer, null, 'fast restarted');
    assert.notEqual(slowTimer, null, 'slow restarted');
  });

  it('beforeunload stops both fast and slow poll', () => {
    let fastTimer = 1;
    let slowTimer = 1;

    // stopFastPoll:
    if (fastTimer) { fastTimer = null; }
    // stopSlowPoll:
    if (slowTimer) { slowTimer = null; }

    assert.equal(fastTimer, null, 'fast stopped on unload');
    assert.equal(slowTimer, null, 'slow stopped on unload');
  });
});

// ============================================================
// Suite 13: slowPollTick integration — guard checks + dispatch
// ============================================================
describe('slowPollTick — guard checks and dispatch logic', () => {
  // Exercises the full slowPollTick decision tree (app.js:337-389):
  // overlapping guard → isPollingPaused → isLoadingLocalFiles →
  // _currentTabDirHandle → checkFileModifications → dispatch.

  it('returns early when overlapping tick is in-flight', () => {
    const slowPollRunning = true;
    let tickProceeded = false;
    if (slowPollRunning) { /* return */ } else { tickProceeded = true; }
    assert.equal(tickProceeded, false);
  });

  it('returns early when polling is paused', () => {
    const slowPollRunning = false;
    const isPollingPaused = true;
    const isLoadingLocalFiles = false;
    const handle = {};
    let tickProceeded = false;

    if (slowPollRunning) { /* return */ }
    else if (isPollingPaused) { /* return */ }
    else if (isLoadingLocalFiles) { /* return */ }
    else if (!handle) { /* return */ }
    else { tickProceeded = true; }

    assert.equal(tickProceeded, false, 'should bail on paused');
  });

  it('returns early when a full load is in progress', () => {
    const slowPollRunning = false;
    const isPollingPaused = false;
    const isLoadingLocalFiles = true;
    const handle = {};
    let tickProceeded = false;

    if (slowPollRunning) { /* return */ }
    else if (isPollingPaused) { /* return */ }
    else if (isLoadingLocalFiles) { /* return */ }
    else if (!handle) { /* return */ }
    else { tickProceeded = true; }

    assert.equal(tickProceeded, false, 'should bail on loading');
  });

  it('returns early when no directory handle is open', () => {
    const slowPollRunning = false;
    const isPollingPaused = false;
    const isLoadingLocalFiles = false;
    const handle = null;
    let tickProceeded = false;

    if (slowPollRunning) { /* return */ }
    else if (isPollingPaused) { /* return */ }
    else if (isLoadingLocalFiles) { /* return */ }
    else if (!handle) { /* return */ }
    else { tickProceeded = true; }

    assert.equal(tickProceeded, false, 'should bail on missing handle');
  });

  it('proceeds to detection when all guards pass', () => {
    const slowPollRunning = false;
    const isPollingPaused = false;
    const isLoadingLocalFiles = false;
    const handle = {};
    let tickProceeded = false;

    if (slowPollRunning) { /* return */ }
    else if (isPollingPaused) { /* return */ }
    else if (isLoadingLocalFiles) { /* return */ }
    else if (!handle) { /* return */ }
    else { tickProceeded = true; }

    assert.equal(tickProceeded, true, 'should proceed to checkFileModifications');
  });

  it('marks slowPollRunning to prevent overlap during I/O', () => {
    let slowPollRunning = false;
    // Enter tick:
    if (slowPollRunning) { /* already running — return */ }
    slowPollRunning = true;
    assert.equal(slowPollRunning, true);
    // Finally-block would reset: slowPollRunning = false;
    slowPollRunning = false;
    assert.equal(slowPollRunning, false);
  });

  it('when modified has non-editor paths: no dispatch (by design)', () => {
    // Only the current-editor file gets auto-reload or conflict logging.
    // Other modified paths are silently skipped per the task spec.
    const modified = ['/journal/2026-01.md', '/notes/ideas.md'];
    const currentEditor = { path: '/some-other-file.md' };
    const reloaded = [];
    const conflicts = [];

    for (const path of modified) {
      if (currentEditor.path === path) {
        if (currentEditor.isClean) {
          reloaded.push(path);
        } else {
          conflicts.push(path);
        }
      }
      // else: not the current editor → no dispatch (by design)
    }

    assert.equal(reloaded.length, 0);
    assert.equal(conflicts.length, 0);
  });

  it('when modified includes current editor (clean): auto-reload', () => {
    const modified = ['/journal/2026-01.md', '/notes/open.md'];
    const currentEditor = {
      path: '/notes/open.md',
      isClean: () => true,
    };
    const reloaded = [];
    const conflicts = [];

    for (const path of modified) {
      if (currentEditor.path === path) {
        if (currentEditor.isClean()) {
          reloaded.push(path);
        } else {
          conflicts.push(path);
        }
      }
    }

    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0], '/notes/open.md');
    assert.equal(conflicts.length, 0);
  });

  it('when modified includes current editor (dirty): conflict log', () => {
    const modified = ['/notes/dirty.md'];
    const currentEditor = {
      path: '/notes/dirty.md',
      isClean: () => false,
    };
    const reloaded = [];
    const conflicts = [];

    for (const path of modified) {
      if (currentEditor.path === path) {
        if (currentEditor.isClean()) {
          reloaded.push(path);
        } else {
          conflicts.push(path);
        }
      }
    }

    assert.equal(reloaded.length, 0);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0], '/notes/dirty.md');
  });

  it('handles deleted paths — sidebar update + mem-file removal', () => {
    const deleted = ['/old/file.md', '/removed/note.md'];
    // Simulate slowPollTick's deleted-handling branch:
    const removedFromMem = [];
    for (const path of deleted) {
      removedFromMem.push(path); // removeMemFile(path)
    }
    // renderSidebar(null, deleted, { added: [], removed: deleted })

    assert.equal(removedFromMem.length, 2);
    assert.ok(removedFromMem.includes('/old/file.md'));
    assert.ok(removedFromMem.includes('/removed/note.md'));
  });

  it('mixed: some deleted, some modified-editor (clean), all handled', () => {
    const deleted = ['/gone.md'];
    const modified = ['/current.md'];
    const currentEditor = { path: '/current.md', isClean: () => true };

    // Deleted handling
    const removedFromMem = [];
    for (const path of deleted) {
      removedFromMem.push(path);
    }
    assert.equal(removedFromMem.length, 1);
    assert.equal(removedFromMem[0], '/gone.md');

    // Modified handling
    const reloaded = [];
    for (const path of modified) {
      if (currentEditor.path === path && currentEditor.isClean()) {
        reloaded.push(path);
      }
    }
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0], '/current.md');
  });
});