// Standalone verification of IGNORED_NAMES filtering logic.
// Run with: node tests/ignored-names-verify.js
// No browser or Playwright required — purely logic verification.

const IGNORED_NAMES = ['.', '..', '.git', '.DS_Store', '.obsidian', '.cargo', '.pytest_cache'];

function isIgnoredName(filename) {
    return IGNORED_NAMES.includes(filename);
}

function isDotFile(filename) {
    return filename.startsWith('.') && !isIgnoredName(filename);
}

// --- Test cases ---
const tests = [
    // --- Directories that SHOULD be visible (not in IGNORED_NAMES) ---
    { name: '.run-task-state',  expectIgnored: false, expectDotFile: true  },
    { name: '.claude',          expectIgnored: false, expectDotFile: true  },
    { name: '.github',          expectIgnored: false, expectDotFile: true  },
    { name: '.daemon',          expectIgnored: false, expectDotFile: true  },
    { name: '.gstack',          expectIgnored: false, expectDotFile: true  },
    { name: '.opencode',        expectIgnored: false, expectDotFile: true  },
    { name: '.githooks',        expectIgnored: false, expectDotFile: true  },

    // --- Directories/files that SHOULD be filtered ---
    { name: '.',                expectIgnored: true,  expectDotFile: false },
    { name: '..',               expectIgnored: true,  expectDotFile: false },
    { name: '.git',             expectIgnored: true,  expectDotFile: false },
    { name: '.DS_Store',        expectIgnored: true,  expectDotFile: false },
    { name: '.obsidian',        expectIgnored: true,  expectDotFile: false },
    { name: '.cargo',           expectIgnored: true,  expectDotFile: false },
    { name: '.pytest_cache',    expectIgnored: true,  expectDotFile: false },

    // --- Dot-prefixed files that SHOULD be visible (not in IGNORED_NAMES) ---
    { name: '.gitignore',       expectIgnored: false, expectDotFile: true  },
    { name: '.codemap-state.json', expectIgnored: false, expectDotFile: true },
    { name: '.env',             expectIgnored: false, expectDotFile: true  },

    // --- Regular files/directories (not dot-prefixed) ---
    { name: 'README.md',        expectIgnored: false, expectDotFile: false },
    { name: 'files.js',         expectIgnored: false, expectDotFile: false },
    { name: 'src',              expectIgnored: false, expectDotFile: false },
    { name: 'config.json',      expectIgnored: false, expectDotFile: false },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
    const actualIgnored = isIgnoredName(t.name);
    const actualDotFile = isDotFile(t.name);

    const ignOk = actualIgnored === t.expectIgnored;
    const dotOk = actualDotFile === t.expectDotFile;

    if (ignOk && dotOk) {
        passed++;
    } else {
        failed++;
        console.error(`FAIL: "${t.name}"`);
        if (!ignOk) console.error(`  isIgnoredName: expected ${t.expectIgnored}, got ${actualIgnored}`);
        if (!dotOk) console.error(`  isDotFile:      expected ${t.expectDotFile}, got ${actualDotFile}`);
    }
}

console.log(`\n${passed}/${tests.length} tests passed`);

if (failed > 0) {
    console.error(`${failed} tests FAILED`);
    process.exit(1);
} else {
    console.log('All IGNORED_NAMES filtering logic tests passed.');
    process.exit(0);
}
