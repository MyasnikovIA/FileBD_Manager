FAR.renderPanel = function(side) {
    const path = side === 'left' ? FAR.leftPath : FAR.rightPath;
    const listEl   = document.getElementById(side === 'left' ? 'listLeft'   : 'listRight');
    const pathEl   = document.getElementById(side === 'left' ? 'pathLeft'   : 'pathRight');
    const statusEl = document.getElementById(side === 'left' ? 'statusLeft' : 'statusRight');

    const safePath = '/' + FAR.normPath(path);
    if (side === 'left') FAR.leftPath = safePath;
    else FAR.rightPath = safePath;
    pathEl.textContent = safePath;

    const items = FAR.listFilesInPath(safePath);
    if (side === 'left') FAR.leftFiles = items;
    else FAR.rightFiles = items;

    // --- Корректировка курсора под текущий список ---
    let cursor = side === 'left' ? FAR.leftCursor : FAR.rightCursor;
    if (items.length === 0) {
        cursor = -1;
    } else if (cursor >= items.length) {
        cursor = items.length - 1;
    } else if (cursor < 0) {
        cursor = 0;
    }
    if (side === 'left') FAR.leftCursor = cursor;
    else FAR.rightCursor = cursor;

    const selSet = side === 'left' ? FAR.leftSelectedIdx : FAR.rightSelectedIdx;
    for (const idx of Array.from(selSet)) if (idx >= items.length) selSet.delete(idx);

    let html = '';
    if (safePath !== '/') {
        html += `<div class="file-item parent-dir" data-index="-1" data-side="${side}"
            ondblclick="FAR.goToParent('${side}')"
            title="Перейти в родительский каталог">
            <span class="name">📁 ..</span><span class="meta"></span>
        </div>`;
    }

    if (items.length === 0 && safePath === '/') {
        html += '<div style="padding:10px;color:#a6adc8;text-align:center;">Папка пуста</div>';
    } else {
        items.forEach(function(item, i) {
            const icon = item.isFolder ? '📁' : '📄';
            const cls = item.isFolder ? 'folder' : 'file';
            const sizeStr = item.size ? FAR.formatSize(item.size) : '';
            const isSelected = selSet.has(i);
            const isFocused = (side === FAR.activePanel) && (cursor === i);
            const extraClass = isFocused ? 'focused' : (isSelected ? 'selected' : '');
            html += `<div class="file-item ${extraClass}" data-index="${i}" data-side="${side}"
                onclick="FAR.handleItemClick(event, '${side}', ${i})"
                ondblclick="FAR.handleItemDblClick('${side}', ${i})">
                <span class="name ${cls}">${icon} ${FAR.escapeHtml(item.name)}</span>
                <span class="meta">${sizeStr}</span>
            </div>`;
        });
    }

    listEl.innerHTML = html;
    statusEl.textContent = `${side === 'left' ? 'Левая' : 'Правая'}: ${items.length}`;
    FAR.updateSelectionInfo();
    FAR.updateButtons();
    FAR.updateTotalSize();
};

FAR.setActivePanel = function(side) {
    if (FAR.activePanel === side) return;
    FAR.activePanel = side;
    document.getElementById('panelLeft').classList.toggle('active', side === 'left');
    document.getElementById('panelRight').classList.toggle('active', side === 'right');
    // Перерисовываем обе панели, чтобы обновить класс .focused
    FAR.renderPanel('left');
    FAR.renderPanel('right');
    FAR.updateSelectionInfo();
    FAR.updateButtons();
};

FAR.goToParent = function(side) {
    const currentPath = side === 'left' ? FAR.leftPath : FAR.rightPath;
    const cur = FAR.normPath(currentPath);
    if (!cur) return;
    const parts = cur.split('/').filter(Boolean);
    parts.pop();
    const newPath = parts.length ? '/' + parts.join('/') : '/';
    if (side === 'left') {
        FAR.leftPath = newPath;
        FAR.leftSelectedIdx.clear();
        FAR.leftAnchor = -1;
        FAR.leftCursor = -1;
    } else {
        FAR.rightPath = newPath;
        FAR.rightSelectedIdx.clear();
        FAR.rightAnchor = -1;
        FAR.rightCursor = -1;
    }
    FAR.renderPanel(side);
};

FAR.navigatePanel = function(side, action) {
    let path = side === 'left' ? FAR.leftPath : FAR.rightPath;
    if (action === '..') {
        const cur = FAR.normPath(path);
        if (!cur) return;
        const parts = cur.split('/').filter(Boolean);
        parts.pop();
        path = parts.length ? '/' + parts.join('/') : '/';
    } else if (action === '/') {
        path = '/';
    }
    if (side === 'left') {
        FAR.leftPath = path;
        FAR.leftSelectedIdx.clear();
        FAR.leftAnchor = -1;
        FAR.leftCursor = -1;
    } else {
        FAR.rightPath = path;
        FAR.rightSelectedIdx.clear();
        FAR.rightAnchor = -1;
        FAR.rightCursor = -1;
    }
    FAR.renderPanel(side);
};

FAR.handleItemClick = function(event, side, index) {
    event.stopPropagation();
    FAR.setActivePanel(side);

    const selSet = side === 'left' ? FAR.leftSelectedIdx : FAR.rightSelectedIdx;
    const anchor = side === 'left' ? FAR.leftAnchor : FAR.rightAnchor;
    const ctrl   = event.ctrlKey || event.metaKey;
    const shift  = event.shiftKey;

    // Клик мышью двигает курсор (кроме Shift+клика — там курсор оставляем на месте,
    // чтобы соответствовать поведению Windows Explorer)
    if (index >= 0 && !shift) {
        if (side === 'left') FAR.leftCursor = index;
        else FAR.rightCursor = index;
    }

    if (ctrl) {
        if (selSet.has(index)) selSet.delete(index);
        else selSet.add(index);
        if (side === 'left') FAR.leftAnchor = index;
        else FAR.rightAnchor = index;
    } else if (shift && anchor !== -1) {
        selSet.clear();
        const from = Math.min(anchor, index);
        const to   = Math.max(anchor, index);
        for (let i = from; i <= to; i++) selSet.add(i);
    } else {
        selSet.clear();
        selSet.add(index);
        if (side === 'left') FAR.leftAnchor = index;
        else FAR.rightAnchor = index;
    }
    FAR.renderPanel(side);
};

FAR.handleItemDblClick = async function(side, index) {
    const items = side === 'left' ? FAR.leftFiles : FAR.rightFiles;
    if (index < 0 || index >= items.length) return;
    const item = items[index];

    if (item.isFolder) {
        const newPath = '/' + FAR.normPath(item.path);
        if (side === 'left') {
            FAR.leftPath = newPath;
            FAR.leftSelectedIdx.clear();
            FAR.leftAnchor = -1;
            FAR.leftCursor = -1;
        } else {
            FAR.rightPath = newPath;
            FAR.rightSelectedIdx.clear();
            FAR.rightAnchor = -1;
            FAR.rightCursor = -1;
        }
        FAR.renderPanel(side);
    } else {
        await FAR.openFile(item);
    }
};

FAR.updateSelectionInfo = function() {
    const el = document.getElementById('selInfo');
    const total = FAR.leftSelectedIdx.size + FAR.rightSelectedIdx.size;
    if (total === 0) { el.textContent = ''; return; }
    const parts = [];
    if (FAR.leftSelectedIdx.size > 0) parts.push(`Л: ${FAR.leftSelectedIdx.size}`);
    if (FAR.rightSelectedIdx.size > 0) parts.push(`П: ${FAR.rightSelectedIdx.size}`);
    el.textContent = `Выделено — ${parts.join(', ')}`;
};

FAR.getSelectedItemsFromActivePanel = function() {
    const items = FAR.activePanel === 'left' ? FAR.leftFiles : FAR.rightFiles;
    const selSet = FAR.activePanel === 'left' ? FAR.leftSelectedIdx : FAR.rightSelectedIdx;
    const result = [];
    for (const i of Array.from(selSet).sort((a, b) => a - b)) {
        if (i >= 0 && i < items.length) result.push({ item: items[i], index: i });
    }
    return result;
};

FAR.updateButtons = function() {
    const hasDb = !!FAR.db;
    const selCount = FAR.activePanel === 'left' ? FAR.leftSelectedIdx.size : FAR.rightSelectedIdx.size;
    document.getElementById('btnCopy').disabled     = !hasDb || selCount === 0;
    document.getElementById('btnMove').disabled     = !hasDb || selCount === 0;
    document.getElementById('btnDelete').disabled   = !hasDb || selCount === 0;
    document.getElementById('btnDownload').disabled = !hasDb || selCount === 0;
    document.getElementById('btnZip').disabled      = !hasDb || selCount === 0;
};

// ============================================================
// Навигация курсором (стрелки, Home/End, PageUp/PageDown, Shift)
// ============================================================

FAR.getPageSize = function(side) {
    const listEl = document.getElementById(side === 'left' ? 'listLeft' : 'listRight');
    if (!listEl) return 15;
    // Высота строки ~ 22px (padding 3+3 + font 12 + border 1)
    const rowH = 22;
    const h = listEl.clientHeight;
    return Math.max(1, Math.floor(h / rowH) - 1);
};

FAR.scrollCursorIntoView = function(side) {
    const listEl = document.getElementById(side === 'left' ? 'listLeft' : 'listRight');
    if (!listEl) return;
    const cursor = side === 'left' ? FAR.leftCursor : FAR.rightCursor;
    if (cursor < 0) return;
    const el = listEl.querySelector(`.file-item[data-index="${cursor}"]`);
    if (el && el.scrollIntoView) {
        el.scrollIntoView({ block: 'nearest' });
    }
};

FAR.moveCursor = function(side, delta, options) {
    options = options || {};
    const isPage = !!options.page;
    const toEdge = options.toEdge; // 'home' | 'end' | undefined

    const items = side === 'left' ? FAR.leftFiles : FAR.rightFiles;
    if (items.length === 0) return;

    const selSet = side === 'left' ? FAR.leftSelectedIdx : FAR.rightSelectedIdx;
    const anchor = side === 'left' ? FAR.leftAnchor : FAR.rightAnchor;
    let cursor = side === 'left' ? FAR.leftCursor : FAR.rightCursor;

    if (cursor < 0) cursor = 0;

    let newCursor = cursor;

    if (toEdge === 'home') {
        newCursor = 0;
    } else if (toEdge === 'end') {
        newCursor = items.length - 1;
    } else if (isPage) {
        const pageSize = FAR.getPageSize(side);
        newCursor = cursor + delta * pageSize;
    } else {
        newCursor = cursor + delta;
    }

    if (newCursor < 0) newCursor = 0;
    if (newCursor > items.length - 1) newCursor = items.length - 1;
    if (newCursor === cursor && !options.force) {
        // Даже если позиция не изменилась — обновим скролл на всякий случай
        FAR.scrollCursorIntoView(side);
        return;
    }

    const shift = !!options.shift;

    if (shift) {
        // Расширяем выделение от anchor до newCursor (как в Windows Explorer)
        const a = anchor === -1 ? cursor : anchor;
        selSet.clear();
        const from = Math.min(a, newCursor);
        const to   = Math.max(a, newCursor);
        for (let i = from; i <= to; i++) selSet.add(i);
        // anchor не меняем — «якорь» остаётся на месте
    } else {
        // Обычное перемещение — выделяем только новый элемент
        selSet.clear();
        selSet.add(newCursor);
        if (side === 'left') FAR.leftAnchor = newCursor;
        else FAR.rightAnchor = newCursor;
    }

    if (side === 'left') FAR.leftCursor = newCursor;
    else FAR.rightCursor = newCursor;

    FAR.renderPanel(side);
    FAR.scrollCursorIntoView(side);
};