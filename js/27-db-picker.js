// ============================================================
// Модалка выбора изображения из FileBD с превью и запоминанием
// ============================================================

FAR.dbPickerState = {
    currentPath: '/',      // текущая папка
    cursorIdx: -1,         // индекс курсора в видимом списке
    anchorIdx: -1,         // якорь для Shift-выделения
    selectedFile: null,    // выбранный файл (item из fileIndex)
    items: [],             // видимые элементы (папки + файлы)
    filter: '',            // текст фильтра
    previewBlobUrl: null,  // Blob URL текущего превью
    onConfirm: null,       // callback при подтверждении
    _bound: false
};

FAR.DBPICKER_LS_KEY = 'filebd_picker_state';

/**
 * Загружает состояние из localStorage.
 */
FAR._dbPickerLoadState = function() {
    try {
        const raw = localStorage.getItem(FAR.DBPICKER_LS_KEY);
        if (!raw) return { path: '/', file: '' };
        const obj = JSON.parse(raw);
        return {
            path: obj.path || '/',
            file: obj.file || ''
        };
    } catch (e) {
        return { path: '/', file: '' };
    }
};

/**
 * Сохраняет состояние в localStorage.
 */
FAR._dbPickerSaveState = function() {
    try {
        const st = FAR.dbPickerState;
        const filePath = st.selectedFile ? st.selectedFile.path : '';
        localStorage.setItem(FAR.DBPICKER_LS_KEY, JSON.stringify({
            path: st.currentPath,
            file: filePath
        }));
    } catch (e) { /* ignore */ }
};

/**
 * Открывает модалку выбора файла.
 * @param {Function} [onConfirm] — callback(path), вызывается при выборе
 */
FAR.openDbPicker = function(onConfirm) {
    if (!FAR.ensureDb()) return;

    FAR.dbPickerState.onConfirm = onConfirm || null;
    FAR.dbPickerState.filter = '';
    FAR.dbPickerState.selectedFile = null;
    FAR.dbPickerState._bound || FAR._dbPickerBindOnce();

    // Загружаем прошлое состояние
    const saved = FAR._dbPickerLoadState();
    FAR.dbPickerState.currentPath = saved.path || '/';

    // Показываем модалку
    const modal = document.getElementById('dbPickerModal');
    modal.classList.remove('hidden');

    // Сбрасываем фильтр в UI
    const filterEl = document.getElementById('dbPickerFilter');
    if (filterEl) filterEl.value = '';

    // Сбрасываем превью
    FAR._dbPickerClearPreview();

    // Рендерим список
    FAR._dbPickerRenderList();

    // Пытаемся восстановить курсор на последнем выбранном файле
    FAR._dbPickerRestoreCursor(saved.file);

    // Фокус на фильтр
    setTimeout(function() {
        if (filterEl) filterEl.focus();
    }, 50);
};

/**
 * Закрывает модалку.
 */
FAR.closeDbPicker = function() {
    const modal = document.getElementById('dbPickerModal');
    if (modal) modal.classList.add('hidden');

    FAR._dbPickerClearPreview();
};

FAR.closeDbPickerOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closeDbPicker();
};

/**
 * Однократная привязка обработчиков (keydown внутри модалки).
 */
FAR._dbPickerBindOnce = function() {
    if (FAR.dbPickerState._bound) return;
    FAR.dbPickerState._bound = true;

    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('dbPickerModal');
        if (!modal || modal.classList.contains('hidden')) return;

        // Не мешаем, если фокус в поле фильтра и это буквенные клавиши
        const tag = (e.target && e.target.tagName) || '';
        const inFilter = (e.target && e.target.id === 'dbPickerFilter');

        if (e.key === 'Escape') {
            e.preventDefault();
            FAR.closeDbPicker();
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const st = FAR.dbPickerState;
            if (st.selectedFile) {
                FAR.dbPickerConfirm();
            } else if (st.cursorIdx >= 0 && st.cursorIdx < st.items.length) {
                const it = st.items[st.cursorIdx];
                if (it.isFolder) {
                    FAR._dbPickerEnterFolder(it.path);
                } else {
                    FAR.dbPickerSelectFile(it);
                    FAR.dbPickerConfirm();
                }
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            FAR._dbPickerMoveCursor(+1, e.shiftKey);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            FAR._dbPickerMoveCursor(-1, e.shiftKey);
            return;
        }
        if (e.key === 'PageDown') {
            e.preventDefault();
            FAR._dbPickerMoveCursor(+10, e.shiftKey);
            return;
        }
        if (e.key === 'PageUp') {
            e.preventDefault();
            FAR._dbPickerMoveCursor(-10, e.shiftKey);
            return;
        }
        if (e.key === 'Home' && !inFilter) {
            e.preventDefault();
            FAR.dbPickerState.cursorIdx = 0;
            FAR.dbPickerState.anchorIdx = 0;
            FAR._dbPickerRenderList();
            FAR._dbPickerScrollToCursor();
            return;
        }
        if (e.key === 'End' && !inFilter) {
            e.preventDefault();
            const last = FAR.dbPickerState.items.length - 1;
            FAR.dbPickerState.cursorIdx = last;
            FAR.dbPickerState.anchorIdx = last;
            FAR._dbPickerRenderList();
            FAR._dbPickerScrollToCursor();
            return;
        }
        if (e.key === 'Backspace' && !inFilter) {
            e.preventDefault();
            FAR.dbPickerGoUp();
            return;
        }
    }, true);
};

/**
 * Возвращает список элементов текущей папки.
 * Возвращает: [{ isFolder, name, path, size, mtime, isImage, ext }]
 */
FAR._dbPickerList = function() {
    const curPath = FAR.normPath(FAR.dbPickerState.currentPath);
    const prefix = curPath ? curPath + '/' : '';

    const folders = new Set();
    const files = [];

    for (const item of FAR.fileIndex) {
        const fp = FAR.normPath(item.path);
        if (!fp) continue;

        if (item.docType === 'folder') {
            if (!curPath) {
                if (!fp.includes('/')) folders.add(fp);
            } else if (fp.startsWith(prefix)) {
                const rest = fp.substring(prefix.length);
                if (rest && !rest.includes('/')) folders.add(rest);
            }
            continue;
        }

        if (item.docType !== 'file') continue;
        if (fp.startsWith('[file] ')) continue;

        const lastSlash = fp.lastIndexOf('/');
        const parent = lastSlash === -1 ? '' : fp.substring(0, lastSlash);
        const name = lastSlash === -1 ? fp : fp.substring(lastSlash + 1);

        if (parent === curPath) {
            const ext = (name.split('.').pop() || '').toLowerCase();
            const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(ext);
            files.push({
                isFolder: false,
                name: name,
                path: fp,
                size: item.size || 0,
                mtime: item.mtime || 0,
                isImage: isImage,
                ext: ext,
                _id: item._id
            });
        } else if (curPath === '' && parent !== '') {
            folders.add(parent.split('/')[0]);
        } else if (parent.startsWith(prefix)) {
            const rest = parent.substring(prefix.length);
            if (rest) folders.add(rest.split('/')[0]);
        }
    }

    return [
        ...Array.from(folders).sort().map(name => ({
            isFolder: true,
            name: name,
            path: curPath ? curPath + '/' + name : name,
            size: 0,
            mtime: 0
        })),
        ...files.sort((a, b) => a.name.localeCompare(b.name))
    ];
};

/**
 * Рендерит список.
 */
FAR._dbPickerRenderList = function() {
    const pathEl = document.getElementById('dbPickerCurrentPath');
    const listEl = document.getElementById('dbPickerList');
    if (!pathEl || !listEl) return;

    pathEl.textContent = '/' + FAR.normPath(FAR.dbPickerState.currentPath);

    let items = FAR._dbPickerList();

    // Применяем фильтр
    const filter = (FAR.dbPickerState.filter || '').toLowerCase().trim();
    if (filter) {
        items = items.filter(function(it) {
            if (it.isFolder) return true; // папки не фильтруем
            return it.name.toLowerCase().includes(filter);
        });
    }

    FAR.dbPickerState.items = items;

    // Корректируем курсор
    let cursor = FAR.dbPickerState.cursorIdx;
    if (items.length === 0) cursor = -1;
    else if (cursor < 0) cursor = 0;
    else if (cursor >= items.length) cursor = items.length - 1;
    FAR.dbPickerState.cursorIdx = cursor;

    let html = '';

    // Кнопка «..» если не в корне
    if (FAR.normPath(FAR.dbPickerState.currentPath) !== '') {
        html += `<div class="db-picker-item parent-dir" data-idx="-1"
            onclick="FAR.dbPickerGoUp()">
            <span class="db-picker-icon">📁</span>
            <span class="db-picker-name">..</span>
            <span class="db-picker-meta"></span>
        </div>`;
    }

    if (items.length === 0) {
        html += '<div class="db-picker-empty">Папка пуста</div>';
    } else {
        items.forEach(function(it, i) {
            const icon = it.isFolder ? '📁' : (it.isImage ? '🖼️' : '📄');
            const cls = it.isFolder ? 'folder' : 'file';
            const isFocused = (i === cursor);
            const isSelected = FAR.dbPickerState.selectedFile
                && FAR.dbPickerState.selectedFile.path === it.path;
            const extra = isFocused ? 'focused' : (isSelected ? 'selected' : '');
            const sizeStr = it.isFolder ? '' : FAR.formatSize(it.size);
            html += `<div class="db-picker-item ${cls} ${extra}" data-idx="${i}"
                onclick="FAR._dbPickerOnItemClick(event, ${i})"
                ondblclick="FAR._dbPickerOnItemDblClick(${i})">
                <span class="db-picker-icon">${icon}</span>
                <span class="db-picker-name">${FAR.escapeHtml(it.name)}</span>
                <span class="db-picker-meta">${sizeStr}</span>
            </div>`;
        });
    }

    listEl.innerHTML = html;
};

FAR._dbPickerOnItemClick = function(event, idx) {
    event.stopPropagation();
    FAR.dbPickerState.cursorIdx = idx;
    FAR.dbPickerState.anchorIdx = idx;

    const it = FAR.dbPickerState.items[idx];
    if (!it) return;

    if (it.isFolder) {
        FAR.dbPickerState.selectedFile = null;
        FAR._dbPickerClearPreview();
    } else {
        FAR.dbPickerSelectFile(it);
    }

    FAR._dbPickerRenderList();
};

FAR._dbPickerOnItemDblClick = function(idx) {
    const it = FAR.dbPickerState.items[idx];
    if (!it) return;

    if (it.isFolder) {
        FAR._dbPickerEnterFolder(it.path);
    } else {
        FAR.dbPickerSelectFile(it);
        FAR.dbPickerConfirm();
    }
};

FAR._dbPickerMoveCursor = function(delta, shift) {
    const items = FAR.dbPickerState.items;
    if (items.length === 0) return;

    let cursor = FAR.dbPickerState.cursorIdx;
    if (cursor < 0) cursor = 0;

    let newCursor = cursor + delta;
    if (newCursor < 0) newCursor = 0;
    if (newCursor > items.length - 1) newCursor = items.length - 1;
    if (newCursor === cursor) return;

    FAR.dbPickerState.cursorIdx = newCursor;
    if (!shift) FAR.dbPickerState.anchorIdx = newCursor;

    // Автовыбор файла при перемещении курсора
    const it = items[newCursor];
    if (it && !it.isFolder) {
        FAR.dbPickerSelectFile(it);
    } else if (it && it.isFolder) {
        FAR.dbPickerState.selectedFile = null;
        FAR._dbPickerClearPreview();
    }

    FAR._dbPickerRenderList();
    FAR._dbPickerScrollToCursor();
};

FAR._dbPickerScrollToCursor = function() {
    const listEl = document.getElementById('dbPickerList');
    if (!listEl) return;
    const cursor = FAR.dbPickerState.cursorIdx;
    if (cursor < 0) return;
    const el = listEl.querySelector('.db-picker-item[data-idx="' + cursor + '"]');
    if (el && el.scrollIntoView) {
        el.scrollIntoView({ block: 'nearest' });
    }
};

/**
 * Восстанавливает курсор на последнем выбранном файле.
 */
FAR._dbPickerRestoreCursor = function(filePath) {
    if (!filePath) {
        FAR.dbPickerState.cursorIdx = 0;
        FAR._dbPickerRenderList();
        return;
    }

    const norm = FAR.normPath(filePath);
    const idx = FAR.dbPickerState.items.findIndex(function(it) {
        return FAR.normPath(it.path) === norm;
    });

    if (idx >= 0) {
        FAR.dbPickerState.cursorIdx = idx;
        FAR.dbPickerState.anchorIdx = idx;
        const it = FAR.dbPickerState.items[idx];
        if (it && !it.isFolder) {
            FAR.dbPickerSelectFile(it);
        }
        FAR._dbPickerRenderList();
        FAR._dbPickerScrollToCursor();
    } else {
        FAR.dbPickerState.cursorIdx = 0;
        FAR._dbPickerRenderList();
    }
};

FAR._dbPickerEnterFolder = function(path) {
    FAR.dbPickerState.currentPath = '/' + FAR.normPath(path);
    FAR.dbPickerState.cursorIdx = 0;
    FAR.dbPickerState.anchorIdx = 0;
    FAR.dbPickerState.selectedFile = null;
    FAR._dbPickerClearPreview();
    FAR._dbPickerRenderList();
    FAR._dbPickerScrollToCursor();
};

FAR.dbPickerGoUp = function() {
    const cur = FAR.normPath(FAR.dbPickerState.currentPath);
    if (!cur) return;
    const parts = cur.split('/').filter(Boolean);
    parts.pop();
    FAR.dbPickerState.currentPath = parts.length ? '/' + parts.join('/') : '/';
    FAR.dbPickerState.cursorIdx = 0;
    FAR.dbPickerState.anchorIdx = 0;
    FAR.dbPickerState.selectedFile = null;
    FAR._dbPickerClearPreview();
    FAR._dbPickerRenderList();
};

FAR.dbPickerGoRoot = function() {
    FAR.dbPickerState.currentPath = '/';
    FAR.dbPickerState.cursorIdx = 0;
    FAR.dbPickerState.anchorIdx = 0;
    FAR.dbPickerState.selectedFile = null;
    FAR._dbPickerClearPreview();
    FAR._dbPickerRenderList();
};

FAR.dbPickerApplyFilter = function() {
    const el = document.getElementById('dbPickerFilter');
    FAR.dbPickerState.filter = el ? el.value : '';
    FAR.dbPickerState.cursorIdx = 0;
    FAR._dbPickerRenderList();
};

/**
 * Показывает превью выбранного файла.
 */
FAR.dbPickerSelectFile = async function(item) {
    FAR.dbPickerState.selectedFile = item;

    const btn = document.getElementById('dbPickerSelectBtn');
    if (btn) btn.disabled = false;

    FAR._dbPickerClearPreview();

    if (!item.isImage) {
        const info = document.getElementById('dbPickerInfo');
        if (info) info.textContent = item.path + ' — не изображение';
        const canvas = document.getElementById('dbPickerPreviewCanvas');
        if (canvas) {
            canvas.innerHTML = '<pre>Файл не является изображением.\nПревью недоступно.</pre>';
        }
        document.getElementById('dbPickerPreviewWrapper').classList.add('loaded');
        return;
    }

    const canvas = document.getElementById('dbPickerPreviewCanvas');
    const info = document.getElementById('dbPickerInfo');
    const wrapper = document.getElementById('dbPickerPreviewWrapper');

    if (canvas) canvas.innerHTML = '<div style="color:#6c7086;">Загрузка…</div>';

    try {
        const itemForDb = FAR.fileIndex.find(f => f._id === item._id);
        if (!itemForDb) throw new Error('Элемент не найден в индексе');

        const { data, contentType } = await FAR.readFileBody(itemForDb);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR.dbPickerState.previewBlobUrl = url;

        if (canvas) {
            canvas.innerHTML = '<img src="' + url + '" alt="">';
        }
        if (info) {
            info.textContent = item.path + ' (' + FAR.formatSize(item.size) + ')';
        }
        if (wrapper) wrapper.classList.add('loaded');
    } catch (e) {
        console.error('dbPickerSelectFile:', e);
        if (canvas) {
            canvas.innerHTML = '<div style="color:#f38ba8;">Ошибка: ' + FAR.escapeHtml(e.message) + '</div>';
        }
        if (wrapper) wrapper.classList.add('loaded');
    }
};

FAR._dbPickerClearPreview = function() {
    const canvas = document.getElementById('dbPickerPreviewCanvas');
    const info = document.getElementById('dbPickerInfo');
    const wrapper = document.getElementById('dbPickerPreviewWrapper');
    const btn = document.getElementById('dbPickerSelectBtn');

    if (canvas) canvas.innerHTML = '';
    if (info) info.textContent = '';
    if (wrapper) wrapper.classList.remove('loaded');
    if (btn) btn.disabled = true;

    if (FAR.dbPickerState.previewBlobUrl) {
        try { URL.revokeObjectURL(FAR.dbPickerState.previewBlobUrl); } catch (e) {}
        FAR.dbPickerState.previewBlobUrl = null;
    }
};

/**
 * Подтверждает выбор файла.
 */
FAR.dbPickerConfirm = function() {
    const st = FAR.dbPickerState;
    if (!st.selectedFile) {
        FAR.toast('Выберите файл', 'warning');
        return;
    }

    // Сохраняем состояние
    FAR._dbPickerSaveState();

    // Заполняем поле в редакторе
    const input = document.getElementById('peDbPath');
    if (input) {
        input.value = '/' + st.selectedFile.path;
    }

    // Чистим поле URL, чтобы было понятно, что источник — БД
    const urlInput = document.getElementById('peUrl');
    if (urlInput) urlInput.value = '';

    // Вызываем callback, если был
    if (typeof st.onConfirm === 'function') {
        try { st.onConfirm('/' + st.selectedFile.path); } catch (e) {}
    }

    FAR.toast('Выбран файл: ' + st.selectedFile.name, 'success');
    FAR.closeDbPicker();
};