// ============================================================
// Мульти-БД: загрузка данных для конкретной стороны —
// индекс файлов (loadFilesForSide), чтение тела файла
// (readFileBodyFromSide), список файлов в пути
// (listFilesInPathForSide + обратная совместимость).
// ============================================================
//
// Модуль подключается ПОСЛЕ 35a-multi-db-core.js, т.к.
// использует FAR.side[side] / FAR.decryptString / FAR.normPath.

// ============================================================
// 1. Загрузка индекса для конкретной стороны
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
// 4. Обратная совместимость: старый FAR.listFilesInPath
// ============================================================
// Оставляем возможность вызывать старую функцию — она теперь
// работает с индексом активной панели.

FAR.listFilesInPath = function (path) {
    return FAR.listFilesInPathForSide(FAR.activePanel, path);
};