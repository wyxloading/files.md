const {test, expect} = require('@playwright/test');

test.beforeEach(async ({page}) => {
    await page.goto('/app.html');

    await page.waitForSelector('.CodeMirror', {timeout: 10000});
    await page.waitForSelector('#sidebar-tree', {timeout: 5000});
});

test('toggle chat mode', async ({ page }) => {
    await page.evaluate(() => {
        window.getRootDirHandle = async function() {
            const opfsRoot = await navigator.storage.getDirectory();
            const testDir = await opfsRoot.getDirectoryHandle('test-files', { create: true });

            const fileHandle = await testDir.getFileHandle('Notes.md', { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write('Some notes content');
            await writable.close();

            return testDir;
        };
    });

    await page.evaluate(() => {
        init(document.getElementById("editor"));
    });

    await page.waitForTimeout(500);

    // Initially should be in editor mode
    expect(await page.isVisible('#content')).toBe(true);
    expect(await page.isVisible('#sidebar-container')).toBe(true);

    // Chat container should not exist yet or be hidden
    const chatContainerExists = await page.locator('#chat-container').count() > 0;
    if (chatContainerExists) {
        expect(await page.isVisible('#chat-container')).toBe(false);
    }

    // Verify isChat is false initially
    const initialChatMode = await page.evaluate(() => isChat);
    expect(initialChatMode).toBe(false);

    // Toggle to chat mode with Meta+Enter
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(200);

    // Verify chat mode is activated
    const chatModeAfterToggle = await page.evaluate(() => isChat);
    expect(chatModeAfterToggle).toBe(true);

    // Check that UI has switched
    expect(await page.isVisible('#sidebar-container')).toBe(false);
    expect(await page.isVisible('#content')).toBe(false);

    // Chat container should be visible now
    const chatContainerVisible = await page.isVisible('#chat-container');
    expect(chatContainerVisible).toBe(true);

    // Toggle back to editor mode with Meta+Enter
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(200);

    // Verify back in editor mode
    const editorModeAfterToggle = await page.evaluate(() => isChat);
    expect(editorModeAfterToggle).toBe(false);

    // UI should be back to editor
    expect(await page.isVisible('#content')).toBe(true);
    expect(await page.isVisible('#sidebar-container')).toBe(true);
    expect(await page.isVisible('#chat-container')).toBe(false);

    // Verify editor has focus after returning from chat
    const editorFocused = await page.evaluate(() => {
        const cm = document.querySelector('.CodeMirror').CodeMirror;
        return cm.hasFocus();
    });
    expect(editorFocused).toBe(true);
});
