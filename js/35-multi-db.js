// ============================================================
// Мульти-БД: у каждой панели своя база данных
// ============================================================
//
// Модуль подключается ПОСЛЕ 34-context-menu.js и ПЕРЕД 23-main.js.
// Он:
//   1. Создаёт FAR.side.left / FAR.side.right — независимые контексты.
//   2. Подменяет старые FAR.leftPath / FAR.leftFiles / ... на геттеры
//      к сторонам (Object.defineProperty), чтобы существующий код
//      панелей работал без правок.
//   3. Даёт loadFilesForSide / readFileBodyFromSide / listFilesInPathForSide
//      и операции между БД.
//   4. Хранит «последние введённые данные» подключения для каждой панели
//      в localStorage (filebd_conn_left / filebd_conn_right).
//
// Существующие модули не переписываются — только точечно вызываются
// новые функции там, где нужна поддержка двух БД.

// ============================================================
// 0. Константы localStorage для «последних» подключений
// ============================================================

FAR.LS_CONN_LEFT  = 'filebd_conn_left';
FAR.LS_CONN_RIGHT = 'filebd_conn_right';

// ============================================================
// 1. Создание контекстов панелей и алиасы
// ============================================================

FAR.side = {
    left:  null,
    right: null
};

FAR.createSideContext = function (side) {
    return {
        side: side,
        db: null,
        conn: null,          // { url, db, user, pass }
        fullUrl: '',
        fileIndex: [],
        path: '/',
        files: [],
        cursor: -1,
        selectedIdx: new Set(),
        anchor: -1,
        loading: false
    };
};

FAR.side.left  = FAR.createSideContext('left');
FAR.side.right = FAR.createSideContext('right');

// ---- Алиасы: FAR.leftPath <-> FAR.side.left.path и т.п. ----
(function installSideAliases() {
    function alias(prop, side, field) {
        Object.defineProperty(FAR, prop, {
            configurable: true,
            get: function () { return FAR.side[side][field]; },
            set: function (v) { FAR.side[side][field] = v; }
        });
    }
    ['left', 'right'].forEach(function (side) {
        alias(side + 'Path',        side, 'path');
        alias(side + 'Files',       side, 'files');
        alias(side + 'Cursor',      side, 'cursor');
        alias(side + 'SelectedIdx', side, 'selectedIdx');
        alias(side + 'Anchor',      side, 'anchor');
    });
})();

// ---- Совместимость: FAR.db / FAR.fileIndex теперь «активная панель» ----
// Старый код, читающий FAR.db / FAR.fileIndex, продолжит работать —
// он увидит БД и индекс ТОЙ панели, что сейчас активна. Это
// соответствует интуиции «операции применяются к активной панели».
(function installActivePanelAliases() {
    Object.defineProperty(FAR, 'db', {
        configurable: true,
        get: function () {
            const s = FAR.side[FAR.activePanel];
            return s ? s.db : null;
        },
        set: function (v) {
            // Установка FAR.db = X трактуется как «обеим панелям»
            // (обратная совместимость при первичном подключении).
            FAR.side.left.db  = v;
            FAR.side.right.db = v;
        }
    });

    Object.defineProperty(FAR, 'fileIndex', {
        configurable: true,
        get: function () {
            const s = FAR.side[FAR.activePanel];
            return s ? s.fileIndex : [];
        },
        set: function (v) {
            FAR.side.left.fileIndex  = v;
            FAR.side.right.fileIndex = v;
        }
    });
})();

// ============================================================
// 2. Заполнение контекста подключением
// ============================================================

FAR.applyConnectionToSide = function (side, cfg, db, fullUrl) {
    const s = FAR.side[side];
    if (!s) return;
    s.db = db;
    s.conn = cfg;
    s.fullUrl = fullUrl || '';
    s.fileIndex = [];
    s.path = '/';
    s.files = [];
    s.cursor = -1;
    s.selectedIdx.clear();
    s.anchor = -1;
    s.loading = false;
};

FAR.applyConnectionToBoth = function (cfg, db, fullUrl) {
    FAR.applyConnectionToSide('left',  cfg, db, fullUrl);
    FAR.applyConnectionToSide('right', cfg, db, fullUrl);
    FAR.currentConn = cfg;
};

// ============================================================
// 3. Хранение «последних введённых данных» для каждой панели
// ============================================================

FAR.saveSideConnToLS = function (side, cfg) {
    try {
        const key = side === 'left' ? FAR.LS_CONN_LEFT : FAR.LS_CONN_RIGHT;
        localStorage.setItem(key, JSON.stringify(cfg));
    } catch (e) { /* ignore */ }
};

FAR.loadSideConnFromLS = function (side) {
    try {
        const key = side === 'left' ? FAR.LS_CONN_LEFT : FAR.LS_CONN_RIGHT;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || !obj.url || !obj.db) return null;
        return obj;
    } catch (e) {
        return null;
    }
};

/**
 * Возвращает «последние данные» для модалки подключения.
 * Приоритет:
 *   1) conn текущего контекста стороны (если side задан)
 *   2) LS этой стороны
 *   3) глобальный LS (filebd_conn)
 *   4) дефолт (хост:5984 / FileBD)
 */
FAR.getConnDefaultsForSide = function (side) {
    if (side && FAR.side[side] && FAR.side[side].conn) {
        return FAR.side[side].conn;
    }
    if (side) {
        const s = FAR.loadSideConnFromLS(side);
        if (s) return s;
    }
    const g = FAR.loadConnFromLS();
    if (g) return g;
    return FAR.getDefaultConn();
};

// ============================================================
// 4. Загрузка индекса для конкретной стороны
// ============================================================

/**
 * Аналог FAR.loadFiles(), но работает с БД конкретной стороны
 * и пишет в fileIndex стороны. Не трогает UI — вызывающий сам решает,
 * что перерисовывать.
 */
FAR.loadFilesForSide = async function (side, opts) {
    opts = opts || {};
    const s = FAR.side[side];
    if (!s || !s.db) return;

    s.loading = true;

    try {
        const all = await s.db.allDocs({ include_docs: true, limit: 50000 });
        const allDocs = all.rows.map(function (r) { return r.doc; }).filter(Boolean);

        const fileIndex = [];
        const fileVersions = {};
        let processed = 0;

        for (const doc of allDocs) {
            if (!doc || !doc._id) continue;
            if (doc._id.startsWith('_design/')) continue;
            if (doc._id.startsWith('_local/')) continue;

            processed++;
            if (!opts.silent) {
                FAR.updateLoadingSub(side + ': ' + processed + ' / ' + allDocs.length);
            }

            if (doc.type === 'chunk') continue;

            if (doc.type === 'folder') {
                fileIndex.push({
                    _id: doc._id,
                    path: FAR.normPath(doc.path || doc.name || doc._id.substring(2)),
                    size: 0, mtime: doc.mtime || 0, binary: false,
                    children: [], docType: 'folder'
                });
                continue;
            }

            if (doc.type === 'file') {
                if (doc.path && typeof doc.path === 'string' && doc.path.length > 0) {
                    fileIndex.push({
                        _id: doc._id, path: FAR.normPath(doc.path),
                        size: doc.size || 0, mtime: doc.mtime || 0,
                        binary: doc.binary || false,
                        children: doc.children || [],
                        contentType: doc.contentType || '',
                        docType: 'file'
                    });
                    continue;
                }

                let resolvedPath = null, metaObj = null;
                if (doc.meta && typeof doc.meta === 'string') {
                    try {
                        const plain = await FAR.decryptString(doc.meta);
                        try { metaObj = JSON.parse(plain); } catch (e) {}
                        if (metaObj && metaObj.path) resolvedPath = metaObj.path;
                        else if (typeof plain === 'string' && plain.includes('/')) resolvedPath = plain;
                    } catch (e) {}
                }

                if (resolvedPath) {
                    fileIndex.push({
                        _id: doc._id, path: FAR.normPath(resolvedPath),
                        size: (metaObj && metaObj.size) || doc.size || 0,
                        mtime: (metaObj && metaObj.mtime) || doc.mtime || 0,
                        binary: (metaObj && metaObj.binary) || doc.binary || false,
                        children: (metaObj && metaObj.children) || doc.children || [],
                        contentType: doc.contentType || '',
                        docType: 'file'
                    });
                } else {
                    const hash = doc._id.startsWith('f:') ? doc._id.substring(2) : doc._id;
                    fileIndex.push({
                        _id: doc._id,
                        path: '[file] ' + hash.substring(0, 20) + '…',
                        size: doc.size || 0, mtime: doc.mtime || 0,
                        binary: false, children: doc.children || [],
                        contentType: doc.contentType || '',
                        docType: 'file', _unresolved: true, _hash: hash
                    });
                }
                continue;
            }

            if (doc.type === 'version') {
                const parts = doc._id.substring(2).split('\n');
                const hash = parts[0];
                const ts = parseInt(parts[1], 10) || 0;
                if (!fileVersions[hash] || fileVersions[hash].ts < ts) {
                    fileVersions[hash] = { ts: ts, doc: doc };
                }
            }
        }

        // Второй проход — расшифровка _unresolved
        for (const item of fileIndex) {
            if (!item._unresolved) continue;
            const ver = fileVersions[item._hash];
            if (!ver) continue;
            try {
                const plain = await FAR.decryptString(ver.doc.meta);
                let metaObj = null;
                try { metaObj = JSON.parse(plain); } catch (e) {}
                if (metaObj && metaObj.path) {
                    item.path = FAR.normPath(metaObj.path);
                    item.size = metaObj.size || item.size;
                    item.mtime = metaObj.mtime || item.mtime;
                    item.binary = metaObj.binary || item.binary;
                    item.children = metaObj.children || item.children;
                    delete item._unresolved;
                    delete item._hash;
                }
            } catch (e) {}
        }

        s.fileIndex = fileIndex;
        s.loading = false;

        return fileIndex;
    } catch (e) {
        s.loading = false;
        throw e;
    }
};

// ============================================================
// 5. Чтение тела файла из БД конкретной стороны
// ============================================================

FAR.readFileBodyFromSide = async function (side, item) {
    const s = FAR.side[side];
    if (!s || !s.db) throw new Error('Нет БД для панели ' + side);

    let data = null;
    let contentType = item.contentType || 'application/octet-stream';

    try {
        const blob = await s.db.getAttachment(item._id, 'b');
        const buf = await blob.arrayBuffer();
        data = new Uint8Array(buf);
        contentType = blob.type || contentType;
        return { data: data, contentType: contentType };
    } catch (e) {
        const doc = await s.db.get(item._id);
        let metaObj = null;
        if (doc.meta && typeof doc.meta === 'string') {
            try {
                const plain = await FAR.decryptString(doc.meta);
                metaObj = JSON.parse(plain);
            } catch (e2) {}
        }
        const children = (metaObj && metaObj.children) || doc.children || item.children || [];
        if (children.length > 0) {
            const chunks = [];
            for (const chunkId of children) {
                try {
                    const blob = await s.db.getAttachment(chunkId, 'b');
                    const buf = new Uint8Array(await blob.arrayBuffer());
                    try {
                        const salt = buf.slice(0, FAR.ET);
                        const iv = buf.slice(FAR.ET, FAR.ET + FAR.IT);
                        const d = buf.slice(FAR.ET + FAR.IT);
                        const key = await FAR.deriveKey(FAR.PASSPHRASE, salt);
                        const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, d);
                        chunks.push(new Uint8Array(dec));
                    } catch (e3) {
                        chunks.push(buf);
                    }
                } catch (e3) {}
            }
            const total = chunks.reduce(function (sum, c) { return sum + c.length; }, 0);
            data = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) { data.set(c, off); off += c.length; }
            return { data: data, contentType: contentType };
        }
    }
    throw new Error('Не удалось получить данные файла');
};

// ============================================================
// 6. UI: индикаторы БД в заголовках панелей
// ============================================================

FAR.updateConnIndicators = function () {
    ['left', 'right'].forEach(function (side) {
        const pathEl = document.getElementById(side === 'left' ? 'pathLeft' : 'pathRight');
        if (!pathEl) return;
        const s = FAR.side[side];
        const label = s && s.conn
            ? (s.conn.db + '@' + (s.conn.url || '').replace(/^https?:\/\//, ''))
            : '— не подключено —';
        pathEl.title = 'БД: ' + label + '\nКлик — сменить БД для этой панели';
    });
};

/**
 * Клик по «пути» в шапке панели — открывает модалку подключения
 * для этой панели (одной).
 */
FAR.setupPanelDbSwitcher = function () {
    ['left', 'right'].forEach(function (side) {
        const panel = document.getElementById(side === 'left' ? 'panelLeft' : 'panelRight');
        if (!panel || panel._farDbSwitchBound) return;
        panel._farDbSwitchBound = true;

        const pathEl = panel.querySelector('.path');
        if (!pathEl) return;

        pathEl.style.cursor = 'pointer';
        pathEl.title = 'Клик — сменить БД для этой панели';
        pathEl.addEventListener('click', function (e) {
            e.stopPropagation();
            FAR.openConnModal(false, side);
        });
    });
};

// ============================================================
// 7. Операции между разными БД
// ============================================================

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

// ============================================================
// 8. Список файлов в пути для конкретной стороны
// ============================================================
// Полный аналог старого FAR.listFilesInPath, но работает с
// fileIndex конкретной панели (FAR.side[side].fileIndex).

FAR.listFilesInPathForSide = function (side, path) {
    const ctx = FAR.side[side];
    if (!ctx) return [];

    const curPath = FAR.normPath(path);
    const prefix = curPath ? curPath + '/' : '';

    const folders = new Set();
    const files = [];

    for (const item of ctx.fileIndex) {
        if (item.docType !== 'folder') continue;
        const fp = FAR.normPath(item.path);
        if (!fp) continue;
        if (!curPath) {
            if (!fp.includes('/')) folders.add(fp);
        } else if (fp.startsWith(prefix)) {
            const rest = fp.substring(prefix.length);
            if (rest && !rest.includes('/')) folders.add(rest);
        }
    }

    for (const item of ctx.fileIndex) {
        if (item.docType !== 'file') continue;
        const fp = FAR.normPath(item.path);
        if (!fp) continue;
        if (fp.startsWith('[file] ')) continue;

        const lastSlash = fp.lastIndexOf('/');
        const parent = lastSlash === -1 ? '' : fp.substring(0, lastSlash);
        const name   = lastSlash === -1 ? fp : fp.substring(lastSlash + 1);

        if (parent === curPath) {
            files.push(Object.assign({}, item, { name: name, isFolder: false }));
        } else if (curPath === '' && parent !== '') {
            folders.add(parent.split('/')[0]);
        } else if (parent.startsWith(prefix)) {
            const rest = parent.substring(prefix.length);
            if (rest) folders.add(rest.split('/')[0]);
        }
    }

    return [
        ...Array.from(folders).sort().map(function (name) {
            return {
                isFolder: true, name: name,
                path: curPath ? curPath + '/' + name : name,
                size: 0, mtime: 0
            };
        }),
        ...files.sort(function (a, b) { return a.name.localeCompare(b.name); })
    ];
};

// ============================================================
// 9. Обратная совместимость: старый FAR.listFilesInPath
// ============================================================
// Оставляем возможность вызывать старую функцию — она теперь
// работает с индексом активной панели.

FAR.listFilesInPath = function (path) {
    return FAR.listFilesInPathForSide(FAR.activePanel, path);
};

// ============================================================
// 10. Хелпер: получить контекст стороны (на будущее)
// ============================================================

FAR.getSideContext = function (side) {
    return FAR.side[side] || null;
};

FAR.getActiveContext = function () {
    return FAR.side[FAR.activePanel] || null;
};