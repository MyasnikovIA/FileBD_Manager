FAR.createFolder = async function() {
    if (!FAR.ensureDb()) return;
    const name = prompt('Имя папки:');
    if (!name || !name.trim()) return;
    const folderName = name.trim();
    const basePath = FAR.normPath(FAR.activePanel === 'left' ? FAR.leftPath : FAR.rightPath);
    const folderPath = FAR.normPath(basePath === '' ? folderName : basePath + '/' + folderName);
    const docId = 'd:' + encodeURIComponent(folderPath);
    try {
        await FAR.db.put({
            _id: docId, type: 'folder', path: folderPath,
            name: folderName, mtime: Date.now()
        });
        FAR.fileIndex.push({
            _id: docId, path: folderPath, size: 0, mtime: Date.now(),
            binary: false, children: [], docType: 'folder'
        });
        FAR.toast(`Папка "${folderName}" создана`, 'success');
        FAR.renderPanel('left');
        FAR.renderPanel('right');
    } catch (e) {
        if (e.status === 409) FAR.toast('Папка уже существует', 'warning');
        else FAR.toast('Ошибка: ' + e.message, 'error');
    }
};