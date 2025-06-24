const {test, expect} = require('@playwright/test');

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        window.API_HOST = 'http://localhost:8080'; // Your test server
        localStorage.setItem('token', 'token');

    });

    await page.goto('/app.html');

    await page.evaluate(()=> {
        window.getRootDirHandle = async function() {
            const root = await navigator.storage.getDirectory();
            const subdir = await root.getDirectoryHandle('subdir', { create: true });

            const files = [
                { name: 'README.md', content: 'Hello world' },
                { name: 'Notes.md', content: '**Bold text**' }
            ];

            for (const file of files) {
                try {
                    await subdir.getFileHandle(file.name);
                } catch (error) {
                    const fileHandle = await subdir.getFileHandle(file.name, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(file.content);
                    await writable.close();
                }
            }

            return root;
        };
    })
    await page.evaluate(() => {
        init(document.getElementById('editor'));
    });

    await page.waitForSelector('.CodeMirror', {timeout: 10000});
    await page.waitForSelector('#sidebar-tree', {timeout: 5000});
});

test('sync', async ({ page }) => {
    await page.pause();
});

