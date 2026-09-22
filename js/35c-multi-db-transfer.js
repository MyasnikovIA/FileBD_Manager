// ============================================================
// Мульти-БД: операции между панелями (в т.ч. между разными БД).
// Универсальный transferBetweenSides('copy' | 'move').
// ============================================================
//
// Модуль подключается ПОСЛЕ 35a и 35b, т.к. использует:
//   - FAR.side[side] (35a)
//   - FAR.readFileBodyFromSide (35b)

/**
 * Универсальная копия/перенос между панелями, учитывающая разные БД.
 * mode: 'copy' | 'move'
 */
FAR.transferBetweenSides = async function (mode) {
    const src = FAR.activePanel;
    const dst = src === 'left' ? 'right' : 'left';
    const sSrc = FAR.side[src];
    const sDst = FAR.side[dst];

    if (!sSrc.db) { FAR.toast('Исходная панель не подключена', 'warning'); return; }
    if (!sDst.db) { FAR.toast('Целевая панель не подключена', 'warning'); return; }

    const selected = FAR.getSelectedItemsFromActivePanel();
    if (selected.length === 0) { FAR.toast('Ничего не выбрано', 'warning'); return; }

    const sameDb = (sSrc.fullUrl && sDst.fullUrl && sSrc.fullUrl === sDst.fullUrl);
    const targetPath = FAR.normPath(sDst.path);

    // ============================================================
    // 1. Разворачиваем выделение в плоский список задач
    // ============================================================
    const srcSelected = FAR.side[src];
    const tasks = [];             // порядок: сначала все папки, потом файлы
    const folderTasks = [];
    const fileTasks = [];
    const srcItemsToRemove = [];  // для mode === 'move'

    for (const sel of selected) {
        const item = sel.item;

        if (item.isFolder) {
            const srcFolderPath = FAR.normPath(item.path);
            const folderName = item.name || srcFolderPath.split('/').pop();
            const dstFolderPath = FAR.normPath(
                targetPath ? targetPath + '/' + folderName : folderName
            );

            // Сама папка
            folderTasks.push({ srcPath: srcFolderPath, dstPath: dstFolderPath });

            // Все вложенные документы (папки и файлы) из индекса источника
            const prefix = srcFolderPath + '/';
            for (const idxItem of srcSelected.fileIndex) {
                const ip = FAR.normPath(idxItem.path);
                if (!ip.startsWith(prefix)) continue;

                const rel = ip.substring(prefix.length);
                const dstPath = FAR.normPath(dstFolderPath + '/' + rel);

                if (idxItem.docType === 'folder') {
                    folderTasks.push({ srcPath: ip, dstPath: dstPath });
                } else if (idxItem.docType === 'file') {
                    fileTasks.push({ srcItem: idxItem, srcPath: ip, dstPath: dstPath });
                }
            }
        } else {
            // Обычный файл
            const fileName = item.name;
            const dstPath = FAR.normPath(
                targetPath ? targetPath + '/' + fileName : fileName
            );
            fileTasks.push({ srcItem: item, srcPath: FAR.normPath(item.path), dstPath: dstPath });
        }
    }

    // Убираем дубли папок (могут пересекаться, если пользователь выделил и родителя, и ребёнка)
    const folderSeen = new Set();
    const uniqueFolders = [];
    for (const f of folderTasks) {
        if (folderSeen.has(f.dstPath)) continue;
        folderSeen.add(f.dstPath);
        uniqueFolders.push(f);
    }
    // Сортируем по длине пути: сначала родители, чтобы вложенные создавались после
    uniqueFolders.sort(function (a, b) { return a.dstPath.length - b.dstPath.length; });

    const totalSteps = uniqueFolders.length + fileTasks.length;

    const actionLabel = mode === 'move' ? 'Перенос' : 'Копирование';
    const sameLabel = sameDb ? ' (одна БД)' : ' (разные БД)';

    FAR.startProgress(
        mode === 'move' ? '✂️' : '📋',
        actionLabel + ': ' + selected.length + ' элем. → ' +
            (dst === 'left' ? 'левая' : 'правая') + ' (' + sDst.conn.db + ')',
        totalSteps,
        function () {}
    );

    let ok = 0, err = 0, step = 0;

    // ============================================================
    // 2. Создаём папки в целевой БД
    // ============================================================
    for (const f of uniqueFolders) {
        if (FAR.progress.cancelled) break;
        step++;
        FAR.updateProgress(step - 1, totalSteps, '📁 ' + f.dstPath, err);
        FAR.progressLog('📁 ' + f.dstPath + sameLabel, 'info');

        try {
            const docId = 'd:' + encodeURIComponent(f.dstPath);
            const folderName = f.dstPath.split('/').pop();

            let rev = null;
            try {
                const existing = await sDst.db.get(docId);
                rev = existing._rev;
            } catch (e) {
                if (e.status !== 404) throw e;
            }

            const doc = {
                _id: docId,
                type: 'folder',
                path: f.dstPath,
                name: folderName,
                mtime: Date.now()
            };
            if (rev) doc._rev = rev;
            await sDst.db.put(doc);

            if (!sDst.fileIndex.find(function (x) { return x._id === docId; })) {
                sDst.fileIndex.push({
                    _id: docId, path: f.dstPath, size: 0, mtime: doc.mtime,
                    binary: false, children: [], docType: 'folder'
                });
            }
            ok++;
            FAR.progressLog('✅ ' + f.dstPath, 'ok');
        } catch (e) {
            err++;
            FAR.progressLog('❌ ' + f.dstPath + ': ' + e.message, 'err');
        }
        FAR.updateProgress(step, totalSteps, '📁 ' + f.dstPath, err);
    }

    // ============================================================
    // 3. Копируем файлы
    // ============================================================
    for (let i = 0; i < fileTasks.length; i++) {
        if (FAR.progress.cancelled) break;
        const t = fileTasks[i];
        step++;
        FAR.updateProgress(step - 1, totalSteps, t.dstPath, err);
        FAR.progressLog((mode === 'move' ? '✂️ ' : '📋 ') + t.dstPath + sameLabel, 'info');

        try {
            // Читаем тело из БД-источника
            const res = await FAR.readFileBodyFromSide(src, t.srcItem);
            const blob = new Blob([res.data], { type: res.contentType });

            const newId = 'f:' + encodeURIComponent(t.dstPath);

            // Удаляем существующий док в целевой БД (если есть)
            try { const ex = await sDst.db.get(newId); await sDst.db.remove(ex); }
            catch (e) { if (e.status !== 404) throw e; }

            const doc = {
                _id: newId, type: 'file', path: t.dstPath,
                name: t.dstPath.split('/').pop(),
                size: res.data.length, mtime: Date.now(),
                binary: t.srcItem.binary || false,
                contentType: res.contentType || 'application/octet-stream'
            };
            await sDst.db.put(doc);
            const fresh = await sDst.db.get(newId);
            await sDst.db.putAttachment(newId, 'b', fresh._rev, blob,
                res.contentType || 'application/octet-stream');

            if (!sDst.fileIndex.find(function (x) { return x._id === newId; })) {
                sDst.fileIndex.push({
                    _id: newId, path: t.dstPath, size: res.data.length, mtime: doc.mtime,
                    binary: t.srcItem.binary || false, children: [],
                    contentType: res.contentType || '', docType: 'file'
                });
            }

            // Запоминаем исходный _id для удаления (mode === 'move')
            if (mode === 'move') {
                srcItemsToRemove.push(t.srcItem._id);
            }

            ok++;
            FAR.progressLog('✅ ' + t.dstPath, 'ok');
        } catch (e) {
            err++;
            FAR.progressLog('❌ ' + t.dstPath + ': ' + e.message, 'err');
        }
        FAR.updateProgress(step, totalSteps, t.dstPath, err);
    }

    // ============================================================
    // 4. Режим move: удаляем исходные документы из БД-источника
    // ============================================================
    if (mode === 'move' && !FAR.progress.cancelled && srcItemsToRemove.length > 0) {
        FAR.progressLog('🗑️ Удаление из источника: ' + srcItemsToRemove.length + ' док.', 'info');

        for (const srcId of srcItemsToRemove) {
            try {
                const doc = await sSrc.db.get(srcId);
                await sSrc.db.remove(doc);
            } catch (e) {
                err++;
                FAR.progressLog('⚠️ не удалён ' + srcId + ': ' + e.message, 'warn');
            }
        }
    }

    // Обновляем индексы обеих сторон
    if (mode === 'move' && srcItemsToRemove.length > 0) {
        const removeSet = new Set(srcItemsToRemove);

        // Удаляем перемещённые файлы
        sSrc.fileIndex = sSrc.fileIndex.filter(function (f) {
            return !removeSet.has(f._id);
        });

        // Удаляем папки, которые теперь пусты (все дети удалены)
        // Проходим несколько раз, чтобы удалить и вложенные пустые папки
        let changed = true;
        let guard = 0;
        while (changed && guard < 50) {
            changed = false;
            guard++;
            const stillHasChild = new Set();
            for (const f of sSrc.fileIndex) {
                if (f.docType !== 'folder') continue;
                const p = FAR.normPath(f.path);
                const prefix = p + '/';
                const hasChild = sSrc.fileIndex.some(function (c) {
                    return c !== f && FAR.normPath(c.path).startsWith(prefix);
                });
                if (hasChild) stillHasChild.add(f._id);
            }
            sSrc.fileIndex = sSrc.fileIndex.filter(function (f) {
                if (f.docType !== 'folder') return true;
                // Папка удаляется, если она была в списке выделенных и не имеет детей
                const wasSelected = removeSet.has(f._id);
                if (wasSelected && !stillHasChild.has(f._id)) {
                    changed = true;
                    return false;
                }
                return true;
            });
        }

        // Отдельно удаляем выбранные папки из БД-источника, если они ещё там
        for (const sel of selected) {
            if (!sel.item.isFolder) continue;
            const folderId = sel.item._id;
            if (!folderId) continue;
            try {
                const doc = await sSrc.db.get(folderId);
                await sSrc.db.remove(doc);
            } catch (e) {
                // уже удалена — ок
            }
        }

        sSrc.selectedIdx.clear();
        sSrc.anchor = -1;
        sSrc.cursor = -1;
    }

    FAR.finishProgress(err);
    FAR.progressLog('━━━ Готово: ' + ok + ', ошибок: ' + err, ok > 0 ? 'ok' : 'err');
    FAR.renderPanel('left');
    FAR.renderPanel('right');
    FAR.setStatus('✅ ' + actionLabel + ': ' + ok + ', ошибок: ' + err);
    FAR.toast(actionLabel + ' ' + ok + ' из ' + totalSteps, ok ? 'success' : 'error');
};