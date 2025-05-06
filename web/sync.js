let filesMetadata = {files: {}, timestamps: {}};
const SYNC_STORAGE_KEY = 'files';

async function initFilesMetadata() {
    const savedStates = localStorage.getItem(SYNC_STORAGE_KEY);
    if (savedStates) {
        filesMetadata = JSON.parse(savedStates);
    }
}

function saveFilesMetadata() {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(filesMetadata));
}

function hash(str) {
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        let chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0;
    }
    return hash;
}

async function syncWithServer() {
    console.log("Starting sync with server...");

    let filesToSend = [];
    for (const dir in files) {
        for (const filename in files[dir]) {
            try {
                if (dir === 'img') continue;

                let content = "";
                const file = await files[dir][filename].handle.getFile();
                content = await file.text();

                let path = filesMetadata?.files?.[dir]?.[filename]?.path;
                if (!path) {
                    console.log(`File ${dir}/${filename} not found on server, skipping...`);
                }
                let serverHash = filesMetadata?.files?.[dir]?.[filename]?.hash;
                let serverTime = filesMetadata?.files?.[dir]?.[filename]?.lastModified;
                let fileWasModifiedLocally = serverHash !== hash(content)
                if (fileWasModifiedLocally) {
                    filesToSend.push({
                        content: content,
                        path: path,
                        lastModified: serverTime,
                    });
                }
            } catch (error) {
                console.error(`Error processing ${dir}/${filename}:`, error);
            }
        }
    }

    try {
        const response = await fetch('https://habits.files.md/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('token')},
            body: JSON.stringify({
                files: filesToSend,
                timestamps: filesMetadata['timestamps'] || [],
            })
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        const server = await response.json();
        for (const fileInfo of server.files) {
            const { path, content, lastModified} = fileInfo;

            // What about more than 2 levels nested?
            let dir, filename;
            if (path.includes('/')) {
                const parts = path.split('/');
                filename = parts.pop();
                dir = parts.join('/');
            } else {
                dir = '';
                filename = path;
            }

            // if (!files[dir]) files[dir] = {};

            // if (!files[dir][filename] || !files[dir][filename].handle) {
            //     files[dir][filename] = {
            //         path: path,
            //         content: content,
            //         lastModified: lastModified,
            //     };
            // } else {
            //     // For files with handles, we would write to the file
            //     // But this is commented out in your code
            //     // const writable = await files[dir][filename].handle.createWritable();
            //     // await writable.write(content);
            //     // await writable.close();
            // }

            // TODO for first sync, when we have all the files - we should not rewrite them
            // TODO if file was modified locally, we need to re-read it before writing.
            const dirs = path.split('/');
            dirs.pop() // remove filename
            let currentDirHandle = await getSavedDirectoryHandle();
            for (const dirName of dirs) {
                if (dirName) {
                    currentDirHandle = await currentDirHandle.getDirectoryHandle(dirName, { create: true });
                }
            }

            // TODO create dirs if not exist
            console.log("Syncing " +filename);
            let fileHandle;
            try {
                fileHandle = await currentDirHandle.getFileHandle(filename, { create: true });
            } catch (error) {
                console.error(`Error getting file handle for '${dir}/${filename}':`, error);
                continue;
            }
            let file = await fileHandle.getFile()
            let clientHash = hash(await file.text());
            let serverHash = hash(content);
            if (clientHash !== serverHash) {
                console.log("Hashes do not match, writing file...");
                const writable = await fileHandle.createWritable();
                await writable.write(content);
                await writable.close();
            } else {
                console.log("Hashes match, no need to write file.");
            }
            if (!filesMetadata['files'][dir]) filesMetadata['files'][dir] = {};
            filesMetadata['files'][dir][filename] = {
                hash: hash(content),
                lastModified: lastModified,
                path: path
            };
        }
        filesMetadata['timestamps'] = server.timestamps;
        saveFilesMetadata();
        console.log("Sync completed successfully");

    } catch (error) {
        console.error("Sync failed:", error);
    }
}