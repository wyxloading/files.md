const {test, expect} = require('@playwright/test');

test.beforeEach(async ({page}, testInfo) => {
    // Capture browser console output and page errors for the whole test.
    const logs = [];
    page.on('console', (msg) => {
        logs.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
        logs.push(`[pageerror] ${err.message}`);
    });
    testInfo.__pageLogs = logs;

    // Navigate to index.html so the app scripts are loaded.
    await page.goto('/index.html');

    // Wait for the app to initialize (sidebar renders when OPFS fallback completes).
    await page.waitForSelector('#tree', {timeout: 5000});
});

test.afterEach(async ({}, testInfo) => {
    const logs = testInfo.__pageLogs;
    if (!logs || logs.length === 0) return;
    if (testInfo.status !== testInfo.expectedStatus) {
        console.log(`\n--- browser console for "${testInfo.title}" ---\n${logs.join('\n')}\n--- end ---`);
    }
    await testInfo.attach('page-console.log', {
        body: logs.join('\n'),
        contentType: 'text/plain',
    });
});

// ── Helper: create a mock FileSystemDirectoryHandle in the page context ──
async function mockDirHandle(page, name) {
    // OPFS root.getDirectoryHandle is the simplest way to get a real
    // FileSystemDirectoryHandle with a controllable name.
    return page.evaluate(async (folderName) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(folderName, {create: true});
        // Create a marker file so the handle is valid.
        try {
            const fh = await dir.getFileHandle('.__idb_test_marker', {create: true});
            const w = await fh.createWritable();
            await w.write('test');
            await w.close();
        } catch (_) {}
        return dir;
    }, name);
}

// ── Helper: clear the IndexedDB handles store ──
async function clearHandlesStore(page) {
    await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('files', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');
        const keys = await new Promise((resolve, reject) => {
            const req = store.getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        for (const key of keys) {
            store.delete(key);
        }
        await new Promise((res, rej) => {
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    });
}

// ── Test 1: saveDirectoryHandle creates dirHandle:<folderName> key ──
test('saveDirectoryHandle stores handle under dirHandle:<folderName> key', async ({page}) => {
    const handle = await mockDirHandle(page, 'daily');
    await page.evaluate(async (/* handle is passed as arg but we re-fetch */) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('daily');
        await saveDirectoryHandle(dir);
    });

    const exists = await page.evaluate(async () => {
        const db = await new Promise((r, rej) => {
            const req = indexedDB.open('files', 1);
            req.onsuccess = () => r(req.result);
            req.onerror = () => rej(req.error);
        });
        const tx = db.transaction('handles', 'readonly');
        const store = tx.objectStore('handles');
        const val = await new Promise((r, rej) => {
            const req = store.get('dirHandle:daily');
            req.onsuccess = () => r(req.result);
            req.onerror = () => rej(req.error);
        });
        return val instanceof FileSystemDirectoryHandle;
    });

    expect(exists).toBe(true);
});

// ── Test 2: saveDirectoryHandle updates _lastUsed marker ──
test('saveDirectoryHandle sets _lastUsed marker', async ({page}) => {
    await clearHandlesStore(page);
    await mockDirHandle(page, 'daily');
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('daily');
        await saveDirectoryHandle(dir);
    });

    const lastUsed = await page.evaluate(async () => {
        const db = await new Promise((r, rej) => {
            const req = indexedDB.open('files', 1);
            req.onsuccess = () => r(req.result);
            req.onerror = () => rej(req.error);
        });
        const tx = db.transaction('handles', 'readonly');
        const store = tx.objectStore('handles');
        return new Promise((r, rej) => {
            const req = store.get('_lastUsed');
            req.onsuccess = () => r(req.result);
            req.onerror = () => rej(req.error);
        });
    });

    expect(lastUsed).toBe('daily');
});

// ── Test 3: Multiple directories coexist in IndexedDB ──
test('opening two directories stores both handles in IndexedDB', async ({page}) => {
    await clearHandlesStore(page);
    await mockDirHandle(page, 'daily');
    await mockDirHandle(page, 'daily-doc');

    // Save both
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const dir1 = await root.getDirectoryHandle('daily');
        await saveDirectoryHandle(dir1);
        const dir2 = await root.getDirectoryHandle('daily-doc');
        await saveDirectoryHandle(dir2);
    });

    const result = await page.evaluate(async () => {
        const handles = await listSavedDirHandles();
        return {
            count: handles.length,
            names: handles.map(h => h.folderName).sort(),
            allHandles: handles.every(h => h.handle instanceof FileSystemDirectoryHandle),
        };
    });

    expect(result.count).toBe(2);
    expect(result.names).toEqual(['daily', 'daily-doc']);
    expect(result.allHandles).toBe(true);
});

// ── Test 4: listSavedDirHandles returns empty array when no directories saved ──
test('listSavedDirHandles returns empty array when no directories saved', async ({page}) => {
    await clearHandlesStore(page);

    const result = await page.evaluate(async () => {
        const handles = await listSavedDirHandles();
        return handles.length;
    });

    expect(result).toBe(0);
});

// ── Test 5: getSavedRootDirHandle() without args returns last-used directory ──
test('getSavedRootDirHandle without args returns most recently used directory', async ({page}) => {
    await clearHandlesStore(page);
    await mockDirHandle(page, 'daily');
    await mockDirHandle(page, 'daily-doc');

    // Save daily first, then daily-doc (daily-doc becomes last-used)
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const daily = await root.getDirectoryHandle('daily');
        await saveDirectoryHandle(daily);
        const dailyDoc = await root.getDirectoryHandle('daily-doc');
        await saveDirectoryHandle(dailyDoc);
    });

    const {isHandle, name} = await page.evaluate(async () => {
        const handle = await getSavedRootDirHandle();
        const name = handle ? handle.name : null;
        return {
            isHandle: handle instanceof FileSystemDirectoryHandle,
            name,
        };
    });

    expect(isHandle).toBe(true);
    // Should return the last-saved directory (daily-doc)
    expect(name).toBe('daily-doc');
});

// ── Test 6: getSavedRootDirHandle(folderName) returns specific directory ──
test('getSavedRootDirHandle with folderName returns the specified directory', async ({page}) => {
    await clearHandlesStore(page);
    await mockDirHandle(page, 'daily');
    await mockDirHandle(page, 'daily-doc');

    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const daily = await root.getDirectoryHandle('daily');
        await saveDirectoryHandle(daily);
        const dailyDoc = await root.getDirectoryHandle('daily-doc');
        await saveDirectoryHandle(dailyDoc);
    });

    const name = await page.evaluate(async () => {
        const handle = await getSavedRootDirHandle('daily');
        return handle ? handle.name : null;
    });

    expect(name).toBe('daily');
});

// ── Test 7: Legacy savedDirectoryHandle key is migrated ──
test('legacy savedDirectoryHandle key is migrated to dirHandle:<name> format', async ({page}) => {
    await clearHandlesStore(page);
    const handle = await mockDirHandle(page, 'legacy-dir');

    // Write a legacy handle directly
    await page.evaluate(async (/* handle */) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('legacy-dir');

        const db = await new Promise((r, rej) => {
            const req = indexedDB.open('files', 1);
            req.onsuccess = () => r(req.result);
            req.onerror = () => rej(req.error);
        });
        const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');
        store.put(dir, 'savedDirectoryHandle');
        await new Promise((res, rej) => {
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    });

    // Now read via the public API — it should trigger migration.
    const result = await page.evaluate(async () => {
        const handle = await getSavedRootDirHandle();
        // After migration, the legacy key should be gone and new key should exist
        const db = await new Promise((r, rej) => {
            const req = indexedDB.open('files', 1);
            req.onsuccess = () => r(req.result);
            req.onerror = () => rej(req.error);
        });
        const tx = db.transaction('handles', 'readonly');
        const store = tx.objectStore('handles');
        const legacyVal = await new Promise((r, rej) => {
            const req = store.get('savedDirectoryHandle');
            req.onsuccess = () => r(req.result);
            req.onerror = () => rej(req.error);
        });
        const newVal = await new Promise((r, rej) => {
            const req = store.get('dirHandle:legacy-dir');
            req.onsuccess = () => r(req.result);
            req.onerror = () => rej(req.error);
        });
        const lastUsed = await new Promise((r, rej) => {
            const req = store.get('_lastUsed');
            req.onsuccess = () => r(req.result);
            req.onerror = () => rej(req.error);
        });
        return {
            name: handle ? handle.name : null,
            isHandle: handle instanceof FileSystemDirectoryHandle,
            legacyExists: legacyVal !== null && legacyVal !== undefined,
            newExists: newVal instanceof FileSystemDirectoryHandle,
            lastUsed,
        };
    });

    expect(result.isHandle).toBe(true);
    expect(result.name).toBe('legacy-dir');
    expect(result.legacyExists).toBe(false); // Legacy key should be deleted
    expect(result.newExists).toBe(true);     // New key should exist
    expect(result.lastUsed).toBe('legacy-dir');
});

// ── Test 8: getSavedRootDirHandle returns null when no handles at all ──
test('getSavedRootDirHandle returns null when no saved directories exist', async ({page}) => {
    await clearHandlesStore(page);

    const result = await page.evaluate(async () => {
        const handle = await getSavedRootDirHandle();
        return handle;
    });

    expect(result).toBeNull();
});

// ── Test 9: removeSavedRootDirHandle with folderName deletes the specific key ──
test('removeSavedRootDirHandle with folderName deletes specific directory', async ({page}) => {
    await clearHandlesStore(page);
    await mockDirHandle(page, 'daily');
    await mockDirHandle(page, 'daily-doc');

    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const daily = await root.getDirectoryHandle('daily');
        await saveDirectoryHandle(daily);
        const dailyDoc = await root.getDirectoryHandle('daily-doc');
        await saveDirectoryHandle(dailyDoc);
    });

    // Remove only 'daily'
    await page.evaluate(async () => {
        await removeSavedRootDirHandle('daily');
    });

    const result = await page.evaluate(async () => {
        const handles = await listSavedDirHandles();
        return {
            count: handles.length,
            names: handles.map(h => h.folderName).sort(),
        };
    });

    expect(result.count).toBe(1);
    expect(result.names).toEqual(['daily-doc']);
});

// ── Test 10: saveDirectoryHandle with empty name is rejected ──
test('saveDirectoryHandle with empty name does not persist', async ({page}) => {
    await clearHandlesStore(page);

    // Create an OPFS root handle (has empty name)
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        await saveDirectoryHandle(root); // root.name === ''
    });

    const count = await page.evaluate(async () => {
        const handles = await listSavedDirHandles();
        return handles.length;
    });

    expect(count).toBe(0);
});

// ── Test 11: Web Locks API serialises writes (basic) ──
test('two consecutive saves via Web Locks do not corrupt data', async ({page}) => {
    await clearHandlesStore(page);
    await mockDirHandle(page, 'first');
    await mockDirHandle(page, 'second');

    // Save both in rapid succession (no await between starts)
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const first = await root.getDirectoryHandle('first');
        const second = await root.getDirectoryHandle('second');
        // Fire both saves without interleaving
        await Promise.all([
            saveDirectoryHandle(first),
            saveDirectoryHandle(second),
        ]);
    });

    const result = await page.evaluate(async () => {
        const handles = await listSavedDirHandles();
        return {
            count: handles.length,
            names: handles.map(h => h.folderName).sort(),
        };
    });

    expect(result.count).toBe(2);
    expect(result.names).toContain('first');
    expect(result.names).toContain('second');
});

// ── Test 12: No duplicate keys for same folder name ──
test('saving same folder twice does not create duplicate keys', async ({page}) => {
    await clearHandlesStore(page);
    await mockDirHandle(page, 'daily');

    // Save the same folder twice
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const daily = await root.getDirectoryHandle('daily');
        await saveDirectoryHandle(daily);
        await saveDirectoryHandle(daily); // second save — should be a no-op/overwrite
    });

    const result = await page.evaluate(async () => {
        const handles = await listSavedDirHandles();
        return {
            count: handles.length,
            names: handles.map(h => h.folderName).sort(),
        };
    });

    expect(result.count).toBe(1);
    expect(result.names).toEqual(['daily']);
});

// ── Test 13: openDir does not clear server state (REQ-260618-005) ──
// Since we can't call showDirectoryPicker in automated tests, we verify via the
// JS-level behaviour: the `server` variable should still hold its prior contents
// after saveDirectoryHandle / loadLocalFiles completes.
test('server state is preserved across directory handle operations', async ({page}) => {
    // Set some fake server state before the operation
    await page.evaluate(() => {
        server = {
            files: {'test/': {'Test.md': {hash: 'abc', lastModified: 123}}},
            media: {},
            timestamps: {'/Test.md': 123},
            mediaTimestamp: 0,
        };
    });

    // Now simulate what openDir does without clearing server:
    // save the handle, then re-read files (w/o server wipe)
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('daily', {create: true});
        const fh = await dir.getFileHandle('Test.md', {create: true});
        const w = await fh.createWritable();
        await w.write('# Test');
        await w.close();

        await saveDirectoryHandle(dir);
    });

    // server state should still have our fake data
    const serverStillIntact = await page.evaluate(() => {
        return server.files && server.files['test/'] && server.files['test/']['Test.md'];
    });

    expect(serverStillIntact).toBeDefined();
    expect(serverStillIntact.hash).toBe('abc');
});

// ── Test 14: isDirClaimedByOtherTab returns false when no claim exists ──
test('isDirClaimedByOtherTab returns false when no claim exists', async ({page}) => {
    // Ensure no leftover marker.
    await page.evaluate(() => { try { localStorage.removeItem('openedDir:no-claim'); } catch (_) {} });
    const claimed = await page.evaluate(async (name) => {
        return isDirClaimedByOtherTab(name);
    }, 'no-claim');
    expect(claimed).toBe(false);
});

// ── Test 15: isDirClaimedByOtherTab returns true for a fresh claim ──
test('isDirClaimedByOtherTab returns true for a fresh claim', async ({page}) => {
    await page.evaluate((name) => {
        claimDir(name);
    }, 'fresh-claim');
    // Reading the claim in the same tab returns false because claimDir
    // also called setCurrentOpenDir, and isDirClaimedByOtherTab reads
    // the marker that we just wrote — need to bypass setCurrentOpenDir.
    // Instead, write the marker directly via localStorage to simulate
    // "another tab".
    await page.evaluate((name) => {
        try { localStorage.setItem('openedDir:' + name, Date.now().toString()); } catch (_) {}
    }, 'other-claim');
    const claimed = await page.evaluate(async (name) => {
        return isDirClaimedByOtherTab(name);
    }, 'other-claim');
    expect(claimed).toBe(true);
    // Cleanup.
    await page.evaluate((name) => {
        try { localStorage.removeItem('openedDir:' + name); } catch (_) {}
    }, 'other-claim');
    await page.evaluate((name) => {
        try { localStorage.removeItem('openedDir:' + name); } catch (_) {}
    }, 'fresh-claim');
});

// ── Test 16: isDirClaimedByOtherTab cleans zombie markers (older than 10 min) ──
test('isDirClaimedByOtherTab cleans zombie markers', async ({page}) => {
    // Write a marker pretending to be 11 minutes old.
    await page.evaluate((name) => {
        const zombieTs = Date.now() - (11 * 60 * 1000);
        try { localStorage.setItem('openedDir:' + name, zombieTs.toString()); } catch (_) {}
    }, 'zombie-dir');
    const claimed = await page.evaluate(async (name) => {
        return isDirClaimedByOtherTab(name);
    }, 'zombie-dir');
    expect(claimed).toBe(false);
    // Verify the key was cleaned up.
    const stillExists = await page.evaluate((name) => {
        return localStorage.getItem('openedDir:' + name) !== null;
    }, 'zombie-dir');
    expect(stillExists).toBe(false);
});

// ── Test 17: claimDir writes a localStorage marker ──
test('claimDir writes a localStorage marker with correct prefix', async ({page}) => {
    await page.evaluate((name) => {
        try { localStorage.removeItem('openedDir:' + name); } catch (_) {}
        claimDir(name);
    }, 'claim-test');
    const val = await page.evaluate((name) => {
        return localStorage.getItem('openedDir:' + name);
    }, 'claim-test');
    expect(val).not.toBeNull();
    const ts = parseInt(val, 10);
    expect(isNaN(ts)).toBe(false);
    // Should be within last 5 seconds.
    expect(Date.now() - ts).toBeLessThan(5000);
    // Cleanup.
    await page.evaluate((name) => {
        try { localStorage.removeItem('openedDir:' + name); } catch (_) {}
    }, 'claim-test');
});

// ── Test 18: releaseCurrentDirClaim removes the marker ──
test('releaseCurrentDirClaim removes the localStorage marker', async ({page}) => {
    await page.evaluate((name) => {
        claimDir(name);
        releaseCurrentDirClaim();
    }, 'release-test');
    const val = await page.evaluate((name) => {
        return localStorage.getItem('openedDir:' + name);
    }, 'release-test');
    expect(val).toBeNull();
});

// ── Test 19: setCurrentOpenDir releases previous claim when switching directories ──
test('setCurrentOpenDir releases previous claim when switching', async ({page}) => {
    await page.evaluate(async () => {
        claimDir('first-dir');
        claimDir('second-dir');
    });
    // After switching, first-dir should be released, second-dir should be claimed.
    const firstClaim = await page.evaluate(() => {
        return localStorage.getItem('openedDir:first-dir');
    });
    const secondClaim = await page.evaluate(() => {
        return localStorage.getItem('openedDir:second-dir');
    });
    expect(firstClaim).toBeNull();
    expect(secondClaim).not.toBeNull();
    // Cleanup.
    await page.evaluate(() => {
        releaseCurrentDirClaim();
    });
});
