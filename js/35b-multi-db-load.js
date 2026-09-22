// ============================================================
// Мульти-БД: ленивая загрузка директории для конкретной стороны,
// чтение тела файла, список файлов в пути.
// ============================================================
//
// Модуль подключается ПОСЛЕ 35a-multi-db-core.js, т.к. использует
// FAR.side[side] / FAR.decryptString / FAR.normPath.
//
// ВАЖНО: раньше loadFilesForSide() тянул ВСЮ базу в s.fileIndex.
// Теперь это ленивая функция: подгружает ТОЛЬКО содержимое
// одной директории (по allDocs с startkey/endkey).

// ============================================================
// 1. Ленивая загрузка директории стороны
// ============================================================
//
// Загружает только непосредственных детей пути `path` в
// s.fileIndex (заменяя его). Для этого используется
// FAR.listDirFromSide(side, path) из 06-files.js.
//
// ВАЖНО: сигнатура сохранена (side, opts), чтобы не ломать
// существующие вызовы в 23-main.js / 10-connection-modal.js.
// Второй аргумент opts теперь может содержать { path, silent }.

FAR.loadFilesForSide = async function (side, opts) {
    opts = opts || {};
    const s = FAR.side[side];
    if (!s || !s.db) return [];

    const path = (opts.path !== undefined) ? opts.path : s.path;
    const norm = FAR.normPath(path);

    s.loading = true;
    if (!opts.silent) {
        FAR.setStatus('📥 Загрузка /' + norm + ' (' + side + ')…');
    }

    try {
        const items = await FAR.listDirFromSide(side, norm, { includeDocs: true });
        s.fileIndex = items;
        s.path = '/' + norm;
        s.loading = false;
        return items;
    } catch (e) {
        s.loading = false;
        console.error('loadFilesForSide(' + side + '):', e);
        throw e;
    }
};

/**
 * Загружает директорию стороны, если путь изменился или кэш пуст.
 * Возвращает true, если что-то грузили.
 */
FAR.ensureDirLoaded = async function (side, path, opts) {
    opts = opts || {};
    const s = FAR.side[side];
    if (!s || !s.db) return false;

    const norm = FAR.normPath(path);
    const cur  = FAR.normPath(s.path);

    if (!opts.force && norm === cur && s.fileIndex && s.fileIndex.length >= 0 && s._loadedDir === norm) {
        return false;
    }

    await FAR.loadFilesForSide(side, { path: norm, silent: opts.silent });
    s._loadedDir = norm;
    return true;
};

/**
 * Полная перезагрузка панели: подтянуть директорию, отрисовать,
 * обновить статус/кнопки.
 */
FAR.reloadPanel = async function (side) {
    const s = FAR.side[side];
    if (!s || !s.db) return;

    await FAR.ensureDirLoaded(side, s.path, { force: true });
    FAR.renderPanel(side);
};

// ============================================================
// 2. Чтение тела файла из БД конкретной стороны
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
// 3. Список файлов в пути для конкретной стороны
// ============================================================
//
// Синхронная функция: возвращает детей пути из УЖЕ ЗАГРУЖЕННОГО
// s.fileIndex. НЕ ходит в БД. Если s.fileIndex пуст — вернёт [].
//
// Правильный async-вариант: FAR.loadFilesForSide(side, {path}) +
// FAR.listFilesInPathForSide(side, path).

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
// 4. Обратная совместимость
// ============================================================

FAR.listFilesInPath = function (path) {
    return FAR.listFilesInPathForSide(FAR.activePanel, path);
};