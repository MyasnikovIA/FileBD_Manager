FAR.copySelected = async function() {
    if (!FAR.ensureDb()) return;
    const selected = FAR.getSelectedItemsFromActivePanel();
    if (selected.length === 0) { FAR.toast('Ничего не выбрано', 'warning'); return; }
    if (selected.some(x => x.item.isFolder)) {
        FAR.toast('Копирование папок не поддерживается', 'warning');
        return;
    }

    const targetPath = FAR.normPath(FAR.activePanel === 'left' ? FAR.rightPath : FAR.leftPath);
    const targetName = FAR.activePanel === 'left' ? 'правую' : 'левую';

    FAR.startProgress('📋', `Копирование ${selected.length} файлов в ${targetName} панель (/${targetPath})`, selected.length, function() {});

    let ok = 0, err = 0;
    for (let i = 0; i < selected.length; i++) {
        if (FAR.progress.cancelled) break;
        const item = selected[i].item;
        FAR.updateProgress(i, selected.length, item.name, err);
        FAR.progressLog(`📋 ${item.name}`, 'info');
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
            if (!FAR.fileIndex.find(f => f._id === newId)) {
                FAR.fileIndex.push({
                    _id: newId, path: newPath, size: item.size || 0, mtime: Date.now(),
                    binary: item.binary || false, children: [],
                    contentType: item.contentType || '', docType: 'file'
                });
            }
            ok++;
            FAR.progressLog(`✅ ${item.name}`, 'ok');
        } catch (e) {
            err++;
            FAR.progressLog(`❌ ${item.name}: ${e.message}`, 'err');
        }
        FAR.updateProgress(i + 1, selected.length, item.name, err);
    }

    FAR.finishProgress(err);
    FAR.progressLog(`━━━ Готово: ${ok} скопировано, ${err} ошибок`, ok > 0 ? 'ok' : 'err');
    FAR.renderPanel('left');
    FAR.renderPanel('right');
    FAR.setStatus(`✅ Скопировано: ${ok}, ошибок: ${err}`);
    FAR.toast(`Скопировано ${ok} из ${selected.length}`, ok ? 'success' : 'error');
};