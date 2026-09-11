FAR.deleteSelected = async function() {
    if (!FAR.ensureDb()) return;
    const selected = FAR.getSelectedItemsFromActivePanel();
    if (selected.length === 0) { FAR.toast('Ничего не выбрано', 'warning'); return; }

    let totalToDelete = 0;
    const filesToDelete = [];
    for (const sel of selected) {
        const item = sel.item;
        if (item.isFolder) {
            const prefix = item.path + '/';
            const children = FAR.fileIndex.filter(f =>
                f.path === item.path || f.path.startsWith(prefix)
            );
            totalToDelete += children.length;
            filesToDelete.push(...children);
        } else {
            totalToDelete++;
            filesToDelete.push(item);
        }
    }

    if (!confirm(`Удалить ${selected.length} элемент(ов)?\n(Всего будет удалено ${totalToDelete} документов)`)) return;

    FAR.startProgress('🗑️', `Удаление ${totalToDelete} документов`, totalToDelete, function() {});

    let ok = 0, err = 0;
    const deletedIds = new Set();

    for (let i = 0; i < filesToDelete.length; i++) {
        if (FAR.progress.cancelled) break;
        const f = filesToDelete[i];
        FAR.updateProgress(i, filesToDelete.length, f.path, err);
        try {
            const d = await FAR.db.get(f._id);
            await FAR.db.remove(d);
            deletedIds.add(f._id);
            ok++;
            FAR.progressLog(`✅ ${f.path}`, 'ok');
        } catch (e) {
            err++;
            FAR.progressLog(`❌ ${f.path}: ${e.message}`, 'err');
        }
        FAR.updateProgress(i + 1, filesToDelete.length, f.path, err);
    }

    FAR.fileIndex = FAR.fileIndex.filter(f => !deletedIds.has(f._id));
    if (FAR.activePanel === 'left') { FAR.leftSelectedIdx.clear(); FAR.leftAnchor = -1; }
    else { FAR.rightSelectedIdx.clear(); FAR.rightAnchor = -1; }

    FAR.finishProgress(err);
    FAR.progressLog(`━━━ Готово: ${ok} удалено, ${err} ошибок`, ok > 0 ? 'ok' : 'err');
    FAR.renderPanel('left');
    FAR.renderPanel('right');
    FAR.setStatus(`✅ Удалено: ${ok}, ошибок: ${err}`);
    FAR.toast(`Удалено ${ok} из ${filesToDelete.length}`, ok ? 'success' : 'error');
};