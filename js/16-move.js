FAR.moveSelected = async function() {
    if (!FAR.ensureDb()) return;
    const selected = FAR.getSelectedItemsFromActivePanel();
    if (selected.length === 0) { FAR.toast('Ничего не выбрано', 'warning'); return; }
    if (selected.some(x => x.item.isFolder)) {
        FAR.toast('Перенос папок не поддерживается', 'warning');
        return;
    }

    const targetPath = FAR.normPath(FAR.activePanel === 'left' ? FAR.rightPath : FAR.leftPath);
    const targetName = FAR.activePanel === 'left' ? 'правую' : 'левую';

    FAR.startProgress('✂️', `Перенос ${selected.length} файлов в ${targetName} панель (/${targetPath})`, selected.length, function() {});

    let ok = 0, err = 0;
    const movedIds = [];

    for (let i = 0; i < selected.length; i++) {
        if (FAR.progress.cancelled) break;
        const item = selected[i].item;
        FAR.updateProgress(i, selected.length, item.name, err);
        FAR.progressLog(`✂️ ${item.name}`, 'info');
        try {
            const blob = await FAR.db.getAttachment(item._id, 'b');
            const newPath = FAR.normPath(targetPath === '' ? item.name : targetPath + '/' + item.name);
            const newId = 'f:' + encodeURIComponent(newPath);
            try { const ex = await FAR.db.get(newId); await FAR.db.remove(ex); }
            catch (e) { if (e.status !== 404) throw e; }
            await FAR.db.put({
                _id: newId, type: 'file', path: newPath, name: item.name,
                size: item.size || 0, mtime: Date.now(),
                binary: item.binary || false,
                contentType: item.contentType || 'application/octet-stream'
            });
            const fresh = await FAR.db.get(newId);
            await FAR.db.putAttachment(newId, 'b', fresh._rev, blob,
                item.contentType || 'application/octet-stream');
            try {
                const srcDoc = await FAR.db.get(item._id);
                await FAR.db.remove(srcDoc);
            } catch (e) { console.warn('source remove failed:', e.message); }

            if (!FAR.fileIndex.find(f => f._id === newId)) {
                FAR.fileIndex.push({
                    _id: newId, path: newPath, size: item.size || 0, mtime: Date.now(),
                    binary: item.binary || false, children: [],
                    contentType: item.contentType || '', docType: 'file'
                });
            }
            movedIds.push(item._id);
            ok++;
            FAR.progressLog(`✅ ${item.name}`, 'ok');
        } catch (e) {
            err++;
            FAR.progressLog(`❌ ${item.name}: ${e.message}`, 'err');
        }
        FAR.updateProgress(i + 1, selected.length, item.name, err);
    }

    FAR.fileIndex = FAR.fileIndex.filter(f => !movedIds.includes(f._id));
    if (FAR.activePanel === 'left') { FAR.leftSelectedIdx.clear(); FAR.leftAnchor = -1; }
    else { FAR.rightSelectedIdx.clear(); FAR.rightAnchor = -1; }

    FAR.finishProgress(err);
    FAR.progressLog(`━━━ Готово: ${ok} перенесено, ${err} ошибок`, ok > 0 ? 'ok' : 'err');
    FAR.renderPanel('left');
    FAR.renderPanel('right');
    FAR.setStatus(`✅ Перенесено: ${ok}, ошибок: ${err}`);
    FAR.toast(`Перенесено ${ok} из ${selected.length}`, ok ? 'success' : 'error');
};