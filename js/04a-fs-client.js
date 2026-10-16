// ============================================================
// 04a-fs-client.js — PouchDB-совместимый клиент к FileServer.
// ============================================================
//
// Реализует подмножество PouchDB API, которое использует проект:
//   info(), allDocs({startkey,endkey,keys,include_docs,limit,recursive}),
//   get(id), put(doc), remove(doc),
//   getAttachment(id,name,{binary}), putAttachment(id,name,rev,blob,ct)
//
// ID-конвенция как в PouchDB-версии проекта:
//   'd:' + encodeURIComponent(path)   — папка
//   'f:' + encodeURIComponent(path)   — файл
// ============================================================

FAR.FsClient = function(baseUrl) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.type = 'filesystem';
    this.id = 'fsdb-' + this.baseUrl;
    this._eventSource = null;
    this.onFileEvent = null;   // необязательный callback(eventJson)
};

// ---------- helpers ----------

FAR.FsClient.prototype._kindFromId = function(id) {
    if (typeof id !== 'string' || id.length < 2) return null;
    const c = id.charAt(0);
    if (c === 'd') return 'folder';
    if (c === 'f') return 'file';
    return null;
};

FAR.FsClient.prototype._pathFromId = function(id) {
    if (typeof id !== 'string' || id.length < 2) return '';
    return FAR.normPath(decodeURIComponent(id.substring(2)));
};

FAR.FsClient.prototype._pathFromKey = function(key) {
    if (typeof key !== 'string' || key.length < 2) return '';
    let enc = key.substring(2);
    if (enc.endsWith('\ufff0')) enc = enc.slice(0, -1);
    let decoded;
    try { decoded = decodeURIComponent(enc); } catch (e) { decoded = enc; }
    return FAR.normPath(decoded);
};

FAR.FsClient.prototype._entryToDoc = function(entry, kind) {
    const norm = FAR.normPath(entry.path);
    const name = entry.name || (norm.includes('/') ? norm.split('/').pop() : norm);
    if (kind === 'folder' || entry.isFolder) {
        return {
            _id: 'd:' + encodeURIComponent(norm),
            _rev: '1-' + (entry.mtime || 0),
            type: 'folder',
            path: norm,
            name: name,
            mtime: entry.mtime || 0
        };
    }
    const ct = entry.contentType || 'application/octet-stream';
    return {
        _id: 'f:' + encodeURIComponent(norm),
        _rev: '1-' + (entry.mtime || 0),
        type: 'file',
        path: norm,
        name: name,
        size: entry.size || 0,
        mtime: entry.mtime || 0,
        binary: !!entry.binary,
        contentType: ct,
        _attachments: {
            b: { content_type: ct, length: entry.size || 0, stub: true }
        }
    };
};

// ---------- info ----------

FAR.FsClient.prototype.info = async function() {
    const res = await fetch(this.baseUrl + '/api/info');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const info = await res.json();
    return {
        db_name: 'filesystem',
        doc_count: 0,
        update_seq: Date.now(),
        backend_adapter: 'FileServer',
        root: info.root,
        version: info.version
    };
};

// ---------- allDocs ----------

FAR.FsClient.prototype.allDocs = async function(opts) {
    opts = opts || {};

    // Режим {keys: [...]}
    if (opts.keys && Array.isArray(opts.keys)) {
        const rows = [];
        for (const key of opts.keys) {
            try {
                const doc = await this.get(key);
                const row = { id: key, key: key, value: { rev: doc._rev } };
                if (opts.include_docs) row.doc = doc;
                rows.push(row);
            } catch (e) {
                rows.push({ id: key, key: key, error: 'not_found' });
            }
        }
        return { rows: rows, total_rows: rows.length, offset: 0 };
    }

    // Режим «без ключей» — список от корня (используется info()/debug)
    if (!opts.startkey && !opts.endkey) {
        const url = this.baseUrl + '/api/list?path=&recursive=1';
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        let entries = data.entries || [];
        if (opts.limit) entries = entries.slice(0, opts.limit);

        const rows = [];
        for (const entry of entries) {
            const docId = (entry.isFolder ? 'd:' : 'f:') + encodeURIComponent(FAR.normPath(entry.path));
            const row = { id: docId, key: docId, value: { rev: '1-' + (entry.mtime || 0) } };
            if (opts.include_docs) {
                row.doc = this._entryToDoc(entry, entry.isFolder ? 'folder' : 'file');
            }
            rows.push(row);
        }
        return { rows: rows, total_rows: rows.length, offset: 0 };
    }

    // Обычный диапазонный режим (startkey/endkey)
    const kind = this._kindFromId(opts.startkey);
    const prefix = this._pathFromKey(opts.startkey);

    // По умолчанию — только прямые дети. Клиент listRecursiveFromSide
    // добавляет opts.recursive = true.
    const recursive = !!opts.recursive;

    const url = this.baseUrl + '/api/list?path=' + encodeURIComponent(prefix)
        + '&recursive=' + (recursive ? '1' : '0');
    const res = await fetch(url);
    if (!res.ok) {
        if (res.status === 404) return { rows: [], total_rows: 0, offset: 0 };
        throw new Error('HTTP ' + res.status);
    }
    const data = await res.json();
    const entries = data.entries || [];

    const rows = [];
    for (const entry of entries) {
        const eKind = entry.isFolder ? 'folder' : 'file';
        if (kind && eKind !== kind) continue;
        const docId = (entry.isFolder ? 'd:' : 'f:') + encodeURIComponent(FAR.normPath(entry.path));
        const row = { id: docId, key: docId, value: { rev: '1-' + (entry.mtime || 0) } };
        if (opts.include_docs) row.doc = this._entryToDoc(entry, eKind);
        rows.push(row);
    }
    return { rows: rows, total_rows: rows.length, offset: 0 };
};

// ---------- get ----------

FAR.FsClient.prototype.get = async function(id) {
    const kind = this._kindFromId(id);
    if (!kind) {
        const err = new Error('Invalid ID: ' + id);
        err.status = 400; err.name = 'bad_request';
        throw err;
    }
    const path = this._pathFromId(id);

    const url = this.baseUrl + '/api/stat?path=' + encodeURIComponent(path);
    const res = await fetch(url);

    if (res.status === 404) {
        const err = new Error('missing');
        err.status = 404; err.name = 'not_found';
        throw err;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const entry = await res.json();
    const actualKind = entry.isFolder ? 'folder' : 'file';
    if (actualKind !== kind) {
        // Тип не совпал с запрошенным префиксом — как в PouchDB 404
        const err = new Error('missing');
        err.status = 404; err.name = 'not_found';
        throw err;
    }
    return this._entryToDoc(entry, actualKind);
};

// ---------- put ----------

FAR.FsClient.prototype.put = async function(doc) {
    if (!doc || !doc._id) throw new Error('put: _id is required');
    const kind = this._kindFromId(doc._id);
    const path = this._pathFromId(doc._id);

    // Папка
    if (kind === 'folder') {
        const url = this.baseUrl + '/api/mkdir?path=' + encodeURIComponent(path);
        const res = await fetch(url, { method: 'POST' });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const e = new Error('HTTP ' + res.status + ' ' + body);
            e.status = res.status;
            throw e;
        }
        return { ok: true, id: doc._id, rev: '1-' + Date.now() };
    }

    // Файл
    let data = new Uint8Array(0);

    if (doc._attachments && doc._attachments.b && doc._attachments.b.data) {
        // Инлайн base64 (используется в peSaveJsonToDb)
        try {
            const bin = atob(doc._attachments.b.data);
            data = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        } catch (e) {
            throw new Error('Invalid base64 in _attachments.b.data: ' + e.message);
        }
    }

    const url = this.baseUrl + '/api/write?path=' + encodeURIComponent(path);
    const ct = (doc._attachments && doc._attachments.b && doc._attachments.b.content_type)
        || doc.contentType
        || 'application/octet-stream';

    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': ct },
        body: data
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        const e = new Error('HTTP ' + res.status + ' ' + body);
        e.status = res.status;
        throw e;
    }
    return { ok: true, id: doc._id, rev: '1-' + Date.now() };
};

// ---------- remove ----------

FAR.FsClient.prototype.remove = async function(doc) {
    const id = typeof doc === 'string' ? doc : (doc && doc._id);
    if (!id) throw new Error('remove: _id is required');
    const path = this._pathFromId(id);

    const url = this.baseUrl + '/api/delete?path=' + encodeURIComponent(path);
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
        throw new Error('HTTP ' + res.status);
    }
    return { ok: true };
};

// ---------- getAttachment ----------

FAR.FsClient.prototype.getAttachment = async function(id, name, opts) {
    opts = opts || {};
    const path = this._pathFromId(id);

    const url = this.baseUrl + '/api/read?path=' + encodeURIComponent(path);
    const res = await fetch(url);
    if (res.status === 404) {
        const err = new Error('missing');
        err.status = 404; err.name = 'not_found';
        throw err;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);

    // PouchDB с binary:true возвращает Blob, иначе string
    if (opts.binary) return await res.blob();
    return await res.text();
};

// ---------- putAttachment ----------

FAR.FsClient.prototype.putAttachment = async function(id, name, rev, blob, contentType) {
    const path = this._pathFromId(id);

    // Blob может быть: Blob, ArrayBuffer, Uint8Array, string
    let body = blob;
    if (blob && typeof blob.arrayBuffer === 'function') {
        body = await blob.arrayBuffer();
    }

    const url = this.baseUrl + '/api/write?path=' + encodeURIComponent(path);
    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType || 'application/octet-stream' },
        body: body
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { ok: true, id: id, rev: '1-' + Date.now() };
};

// ---------- close ----------

FAR.FsClient.prototype.close = async function() {
    if (this._eventSource) {
        try { this._eventSource.close(); } catch (e) {}
        this._eventSource = null;
    }
};

// ---------- SSE ----------

/**
 * Подключает EventSource к /api/events.
 * При каждом событии вызывает this.onFileEvent(evt) (если задан).
 */
FAR.FsClient.prototype.startWatching = function() {
    if (this._eventSource) return;
    if (typeof EventSource === 'undefined') return;

    const url = this.baseUrl + '/api/events';
    const es = new EventSource(url);
    this._eventSource = es;

    const self = this;
    es.addEventListener('change', function(e) {
        let payload = null;
        try { payload = JSON.parse(e.data); } catch (err) { return; }
        if (typeof self.onFileEvent === 'function') {
            try { self.onFileEvent(payload); } catch (err) { /* ignore */ }
        }
    });

    es.addEventListener('error', function() {
        // Автоматическое переподключение делает сам браузер
    });

    es.addEventListener('ready', function() {
        console.log('[FsClient] SSE ready');
    });
};

FAR.FsClient.prototype.stopWatching = function() {
    if (this._eventSource) {
        try { this._eventSource.close(); } catch (e) {}
        this._eventSource = null;
    }
};