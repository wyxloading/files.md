// Various string functions, ported from Golang bot.

async function addChecklistItem(path, item, checked = false) {
    let md = '';
    try {
        md = await read(path);
        md = normNewLines(md);
    } catch (err) {
        md = '';
    }

    // Remove existing item
    const lines = md.split('\n');
    const filteredLines = [];

    for (const line of lines) {
        const trimmedLine = line.trim();

        if (trimmedLine.length < 6) {
            filteredLines.push(trimmedLine);
            continue;
        }

        const itemText = trimmedLine.substring(6);
        if (hash(itemText) === item || itemText === item) {
            continue;
        }

        filteredLines.push(trimmedLine);
    }

    // Add new item
    if (checked) {
        filteredLines.push('- [x] ' + item);
    } else {
        // Find the last incomplete item and insert before it
        let insertIndex = filteredLines.length;
        for (let i = filteredLines.length - 1; i >= 0; i--) {
            const line = filteredLines[i].trim();
            if (line.startsWith('- [ ] ')) {
                insertIndex = i;
            }
        }

        // Insert the new incomplete item
        if (insertIndex === filteredLines.length) {
            filteredLines.push('- [ ] ' + item);
        } else {
            filteredLines.splice(insertIndex, 0, '- [ ] ' + item);
        }
    }

    const result = filteredLines.join('\n').trim();
    await write(path, result);
}

async function removeChecklistItem(path, itemOrHash) {
    let md = '';
    try {
        md = await read(path);
        md = normNewLines(md);
    } catch (err) {
        md = '';
    }

    let removedItem = '';
    const lines = md.split('\n');
    const newLines = [];

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Preserve invalid lines
        if (trimmedLine.length < 6) {
            newLines.push(trimmedLine);
            continue;
        }

        const itemText = trimmedLine.substring(6);
        if (hash(itemText) === itemOrHash || itemText === itemOrHash) {
            removedItem = itemText;
            continue;
        }

        newLines.push(trimmedLine);
    }

    const result = newLines.join('\n');
    await write(path, result);
    return removedItem;
}

async function addHeaderAndText(path, header, text, atStart = false) {
    const now = new Date();
    const timestamp = `\`${now.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    })}\``;

    let formattedContent;
    if (hasImage(text)) {
        const imgMatch = text.match(IMG_PATTERN);
        if (imgMatch) {
            const imgLink = imgMatch[0];
            const textContent = text.replace(imgLink, '').trim();
            formattedContent = `${imgLink}\n${timestamp} ${textContent}`;
        }
    } else {
        formattedContent = `${timestamp} ${text}`;
    }

    let existingText = '';
    try {
        existingText = await read(path);
        existingText = normNewLines(existingText);
        existingText = existingText.trim();
    } catch (err) {
        existingText = '';
    }

    let result;
    if (!existingText.includes(header)) {
        if (existingText === "") {
            result = `${header}\n${formattedContent}`;
        } else {
            result = atStart
                ? `${header}\n${formattedContent}\n\n${existingText}`
                : `${existingText}\n\n${header}\n${formattedContent}`;
        }
    } else {
        const lines = existingText.split("\n");
        let headerIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === header) {
                headerIndex = i;
                break;
            }
        }

        if (headerIndex === -1) {
            result = atStart
                ? `${header}\n${formattedContent}\n\n${existingText}`
                : `${existingText}\n\n${header}\n${formattedContent}`;
        } else {
            let insertIndex = headerIndex + 1;

            for (let i = headerIndex + 1; i < lines.length; i++) {
                if (lines[i].startsWith("###")) {
                    insertIndex = i;
                    break;
                }
                if (lines[i].trim() === "") {
                    insertIndex = i;
                    break;
                }
                insertIndex = i + 1;
            }

            const newLines = [];
            newLines.push(...lines.slice(0, insertIndex));
            newLines.push(formattedContent);

            if (insertIndex < lines.length && lines[insertIndex].trim() !== "") {
                newLines.push("");
            }

            newLines.push(...lines.slice(insertIndex));
            result = newLines.join("\n");
        }
    }

    await write(path, result);
}

function normNewLines(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function hasImage(text) {
    return IMG_PATTERN.test(text);
}

// Define the image pattern constant
const IMG_PATTERN = /!\[.*?\]\(.*?\)/;

