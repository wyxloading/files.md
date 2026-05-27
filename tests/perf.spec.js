const {test, expect} = require('@playwright/test');

// Perf bench: each test seeds a heavy fixture, opens it via the same code
// path a real user hits, and prints `<label>: <median> ms (samples: …)`.
//
// Run locally only - timings vary 2-3x across machines, so absolute
// thresholds aren't useful in CI. The numbers go to stdout; compare a
// run before/after a change to spot regressions.
//
//   make e2es test="perf"
//   make e2esh test="perf"   # headed, to watch

const RUNS = 5;

function median(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

test.beforeEach(async ({page}) => {
    await page.goto('/index.html');
    await page.waitForSelector('#tree', {timeout: 1000});
});

test('open 1k-line plain markdown file', async ({page}) => {
    await page.evaluate(() => {
        window.getTemporaryStorageDirHandle = async function() {
            const root = await navigator.storage.getDirectory();
            const fh = await root.getFileHandle('Big.md', {create: true});
            const w = await fh.createWritable();
            let buf = '';
            for (let i = 0; i < 1000; i++) {
                buf += `Line ${i} with prose, **bold**, *italic*, and \`code\`.\n`;
            }
            await w.write(buf);
            await w.close();
            return root;
        };
    });
    await page.evaluate(() => init(document.getElementById("editor")));
    await page.waitForTimeout(300);

    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        const ms = await page.evaluate(async () => {
            const t = performance.now();
            await openFile('/Big.md');
            return performance.now() - t;
        });
        samples.push(ms);
        // Bounce to another file so the next open isn't a no-op same-file path.
        await page.evaluate(async () => {
            await openFile('/🪴 Welcome.md').catch(() => {});
        });
        await page.waitForTimeout(50);
    }

    console.log(`Big.md: ${median(samples).toFixed(1)} ms (samples: ${samples.map(s => s.toFixed(0)).join(', ')})`);
});

test('open file with 50 mermaid blocks', async ({page}) => {
    await page.evaluate(() => {
        window.getTemporaryStorageDirHandle = async function() {
            const root = await navigator.storage.getDirectory();
            const fh = await root.getFileHandle('Diagrams.md', {create: true});
            const w = await fh.createWritable();
            let buf = '';
            for (let i = 0; i < 50; i++) {
                buf += '```mermaid\nflowchart LR\n';
                buf += `    A${i}[node ${i}] --> B${i}[next]\n`;
                buf += `    B${i} --> C${i}[end]\n`;
                buf += '```\n\n';
            }
            await w.write(buf);
            await w.close();
            return root;
        };
    });
    await page.evaluate(() => init(document.getElementById("editor")));
    await page.waitForTimeout(300);

    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        const ms = await page.evaluate(async () => {
            const t = performance.now();
            await openFile('/Diagrams.md');
            return performance.now() - t;
        });
        samples.push(ms);
        await page.evaluate(async () => {
            await openFile('/🪴 Welcome.md').catch(() => {});
        });
        await page.waitForTimeout(50);
    }

    console.log(`Diagrams.md: ${median(samples).toFixed(1)} ms (samples: ${samples.map(s => s.toFixed(0)).join(', ')})`);
});

test('open file with 200 LaTeX blocks', async ({page}) => {
    await page.evaluate(() => {
        window.getTemporaryStorageDirHandle = async function() {
            const root = await navigator.storage.getDirectory();
            const fh = await root.getFileHandle('Math.md', {create: true});
            const w = await fh.createWritable();
            let buf = '';
            for (let i = 0; i < 200; i++) {
                buf += `Inline math: $F_${i} = m a_${i}$ and another $\\frac{a}{b}$\n\n`;
                buf += `$$\\int_0^${i} e^x \\,dx = e^${i} - 1$$\n\n`;
            }
            await w.write(buf);
            await w.close();
            return root;
        };
    });
    await page.evaluate(() => init(document.getElementById("editor")));
    await page.waitForTimeout(300);

    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        const ms = await page.evaluate(async () => {
            const t = performance.now();
            await openFile('/Math.md');
            return performance.now() - t;
        });
        samples.push(ms);
        await page.evaluate(async () => {
            await openFile('/🪴 Welcome.md').catch(() => {});
        });
        await page.waitForTimeout(50);
    }

    console.log(`Math.md: ${median(samples).toFixed(1)} ms (samples: ${samples.map(s => s.toFixed(0)).join(', ')})`);
});

test('sidebar render with 1000 files in one folder', async ({page}) => {
    await page.evaluate(() => {
        window.getTemporaryStorageDirHandle = async function() {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle('many', {create: true});
            for (let i = 0; i < 1000; i++) {
                const fh = await dir.getFileHandle(`note-${i}.md`, {create: true});
                const w = await fh.createWritable();
                await w.write(`# note ${i}\nbody`);
                await w.close();
            }
            return root;
        };
    });
    await page.evaluate(() => init(document.getElementById("editor")));
    await page.waitForTimeout(500);

    // Trigger a fresh renderSidebar() and time it. selectSidebarItem walks
    // the existing tree; renderSidebar rebuilds it from `files`.
    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        const ms = await page.evaluate(() => {
            const t = performance.now();
            renderSidebar();
            return performance.now() - t;
        });
        samples.push(ms);
    }

    console.log(`renderSidebar (1000 files): ${median(samples).toFixed(1)} ms (samples: ${samples.map(s => s.toFixed(0)).join(', ')})`);
});

test('open file with 50 images', async ({page}) => {
    await page.evaluate(() => {
        window.getTemporaryStorageDirHandle = async function() {
            const root = await navigator.storage.getDirectory();
            const mediaDir = await root.getDirectoryHandle('media', {create: true});
            // 1x1 transparent PNG decoded to a Uint8Array. Tiny, but real
            // binary content so fold-image still has a blob to lay out.
            const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
            const bin = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));
            for (let i = 0; i < 50; i++) {
                const fh = await mediaDir.getFileHandle(`img-${i}.png`, {create: true});
                const w = await fh.createWritable();
                await w.write(bin);
                await w.close();
            }
            const fh = await root.getFileHandle('Images.md', {create: true});
            const w = await fh.createWritable();
            let buf = '';
            for (let i = 0; i < 50; i++) {
                buf += `Image ${i}: ![](media/img-${i}.png)\n\n`;
            }
            await w.write(buf);
            await w.close();
            return root;
        };
    });
    await page.evaluate(() => init(document.getElementById("editor")));
    await page.waitForTimeout(500);

    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        const ms = await page.evaluate(async () => {
            const t = performance.now();
            await openFile('/Images.md');
            return performance.now() - t;
        });
        samples.push(ms);
        await page.evaluate(async () => {
            await openFile('/🪴 Welcome.md').catch(() => {});
        });
        await page.waitForTimeout(50);
    }

    console.log(`Images.md: ${median(samples).toFixed(1)} ms (samples: ${samples.map(s => s.toFixed(0)).join(', ')})`);
});

// Editing perf: seeds a file of `lines` lines, opens it, lets the editor
// settle, then times 100 single-char inserts at the middle of the doc via
// cm.replaceRange (the same path keystrokes hit). The measured number is
// the *synchronous* per-edit cost - it isolates editor work (mode parsing,
// fold scheduling, change handlers) from browser input pacing/paint.
//
// Compare across sizes: if all three are roughly equal, the lag is
// per-keystroke overhead. If big scales much worse, lag is doc-size driven.
async function benchTyping(page, filename, lines, label) {
    await page.evaluate(async ({filename, lines}) => {
        window.getTemporaryStorageDirHandle = async function () {
            const root = await navigator.storage.getDirectory();
            const fh = await root.getFileHandle(filename, {create: true});
            const w = await fh.createWritable();
            let buf = '';
            for (let i = 0; i < lines; i++) {
                buf += `Line ${i} with prose, **bold**, *italic*, and \`code\`.\n`;
            }
            await w.write(buf);
            await w.close();
            return root;
        };
    }, {filename, lines});
    await page.evaluate(() => init(document.getElementById('editor')));
    await page.waitForTimeout(300);
    await page.evaluate(async (filename) => { await openFile('/' + filename); }, filename);
    await page.waitForTimeout(500);

    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        const ms = await page.evaluate((lines) => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            cm.setCursor({line: Math.floor(lines / 2), ch: 0});
            const t = performance.now();
            for (let i = 0; i < 100; i++) {
                cm.replaceRange('x', cm.getCursor());
            }
            return performance.now() - t;
        }, lines);
        samples.push(ms);
        // Undo the inserts so the next sample starts from the same state.
        await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            for (let i = 0; i < 100; i++) cm.undo();
        });
        await page.waitForTimeout(50);
    }

    console.log(`${label} (100 char inserts at line ${Math.floor(lines / 2)}): ${median(samples).toFixed(1)} ms (samples: ${samples.map(s => s.toFixed(0)).join(', ')})`);
}

test('edit small file (10 lines)', async ({page}) => {
    await benchTyping(page, 'Small.md', 10, 'Small.md');
});

test('edit medium file (500 lines)', async ({page}) => {
    await benchTyping(page, 'Medium.md', 500, 'Medium.md');
});

test('edit big file (5000 lines)', async ({page}) => {
    test.setTimeout(60000);
    await benchTyping(page, 'Big5k.md', 5000, 'Big5k.md');
});

// Reference run for comparison: same setup as 'edit big file', but the
// viewportMargin: Infinity that files.js sets ~200ms after open is reset
// to a finite value. Demonstrates that rendering all 5000 lines in the DOM
// is the dominant per-keystroke cost (~11x slower with Infinity).
test('edit big file (5000 lines) - no :has() selectors', async ({page}) => {
    test.setTimeout(60000);
    await page.evaluate(async ({filename, lines}) => {
        window.getTemporaryStorageDirHandle = async function () {
            const root = await navigator.storage.getDirectory();
            const fh = await root.getFileHandle(filename, {create: true});
            const w = await fh.createWritable();
            let buf = '';
            for (let i = 0; i < lines; i++) {
                buf += `Line ${i} with prose, **bold**, *italic*, and \`code\`.\n`;
            }
            await w.write(buf);
            await w.close();
            return root;
        };
    }, {filename: 'Big5kNH.md', lines: 5000});
    await page.evaluate(() => init(document.getElementById('editor')));
    await page.waitForTimeout(300);
    await page.evaluate(async () => { await openFile('/Big5kNH.md'); });
    await page.waitForTimeout(500);
    // Walk all loaded CSSStyleSheets and delete every rule that contains :has().
    await page.evaluate(() => {
        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            if (!rules) continue;
            for (let i = rules.length - 1; i >= 0; i--) {
                if (rules[i].cssText && rules[i].cssText.includes(':has(')) {
                    sheet.deleteRule(i);
                }
            }
        }
    });

    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        const ms = await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            cm.setCursor({line: 2500, ch: 0});
            const t = performance.now();
            for (let i = 0; i < 100; i++) cm.replaceRange('x', cm.getCursor());
            return performance.now() - t;
        });
        samples.push(ms);
        await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            for (let i = 0; i < 100; i++) cm.undo();
        });
        await page.waitForTimeout(50);
    }
    console.log(`Big5k.md (no :has() rules) (100 char inserts at line 2500): ${median(samples).toFixed(1)} ms (samples: ${samples.map(s => s.toFixed(0)).join(', ')})`);
});

test('edit big file (5000 lines) - finite viewportMargin', async ({page}) => {
    test.setTimeout(60000);
    await page.evaluate(async ({filename, lines}) => {
        window.getTemporaryStorageDirHandle = async function () {
            const root = await navigator.storage.getDirectory();
            const fh = await root.getFileHandle(filename, {create: true});
            const w = await fh.createWritable();
            let buf = '';
            for (let i = 0; i < lines; i++) {
                buf += `Line ${i} with prose, **bold**, *italic*, and \`code\`.\n`;
            }
            await w.write(buf);
            await w.close();
            return root;
        };
    }, {filename: 'Big5kFV.md', lines: 5000});
    await page.evaluate(() => init(document.getElementById('editor')));
    await page.waitForTimeout(300);
    await page.evaluate(async () => { await openFile('/Big5kFV.md'); });
    // Override the viewportMargin set 100ms after open in files.js.
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        const cm = document.querySelector('.CodeMirror').CodeMirror;
        cm.setOption('viewportMargin', 10);
    });
    await page.waitForTimeout(300);

    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        const ms = await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            cm.setCursor({line: 2500, ch: 0});
            const t = performance.now();
            for (let i = 0; i < 100; i++) cm.replaceRange('x', cm.getCursor());
            return performance.now() - t;
        });
        samples.push(ms);
        await page.evaluate(() => {
            const cm = document.querySelector('.CodeMirror').CodeMirror;
            for (let i = 0; i < 100; i++) cm.undo();
        });
        await page.waitForTimeout(50);
    }
    console.log(`Big5k.md (viewportMargin=10) (100 char inserts at line 2500): ${median(samples).toFixed(1)} ms (samples: ${samples.map(s => s.toFixed(0)).join(', ')})`);
});
