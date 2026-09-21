// ============================================================
// Рендер панелей, выделение, навигация курсором
// ============================================================
// В мульти-БД режиме каждая панель читает свой контекст
// из FAR.side[side] (модуль 35-multi-db.js). Старые имена
// FAR.leftPath / FAR.leftFiles / ... работают как алиасы
// к этим контекстам — их можно использовать без изменений.
// ============================================================

FAR.renderPanel = function(side) {
    const ctx = FAR.side[side];
    if (!ctx) return;

    const listEl   = document.getElementById(side === 'left' ? 'listLeft'   : 'listRight');
    const pathEl   = document.getElementById(side === 'left' ? 'pathLeft'   : 'pathRight');
    const statusEl = document.getElementById(side === 'left' ? 'statusLeft' : 'statusRight');

    const safePath = '/' + FAR.normPath(ctx.path);
    ctx.path = safePath;
    pathEl.textContent = safePath;

    // Подсказка с текущей БД (какая база у этой панели)
    const dbLabel = ctx.conn
        ? (ctx.conn.db + '@' + (ctx.conn.url || '').replace(/^https?:\/\//, ''))
        : '— нет подключения —';
    pathEl.title = 'БД: ' + dbLabel + '\nКлик — сменить БД для этой панели';

    // Индекс файлов этой панели
    const items = FAR.listFilesInPathForSide(side, safePath);
    ctx.files = items;

    // Есть ли виртуальный элемент ".." (индекс -1)
    const hasParent = (safePath !== '/');
    const minCursor = hasParent ? -1 : 0;
    const maxCursor = items.length - 1;

    // --- Корректировка курсора под текущий список ---
    let cursor = ctx.cursor;
    if (items.length === 0) {
        cursor = -1;
    } else if (cursor < minCursor) {
        cursor = minCursor;
    } else if (cursor > maxCursor) {
        cursor = maxCursor;
    }
    ctx.cursor = cursor;

    const selSet = ctx.selectedIdx;
    for (const idx of Array.from(selSet)) {
        if (idx < 0 || idx >= items.length) selSet.delete(idx);
    }

    // === Стилизация активной панели ===
    const panelEl = document.getElementById(side === 'left' ? 'panelLeft' : 'panelRight');
    if (panelEl) {
        panelEl.classList.toggle('active', side === FAR.activePanel);
    }

    // === Рендер ===
    let html = '';
    if (hasParent) {
        const isFocused = (side === FAR.activePanel) && (cursor === -1);
        const extraClass = isFocused ? 'focused' : '';
        html += `<div class="file-item parent-dir ${extraClass}" data-index="-1" data-side="${side}"
            onclick="FAR.handleItemClick(event, '${side}', -1)"
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
    FAR.renderPanel('left');
    FAR.renderPanel('right');
    FAR.updateSelectionInfo();
    FAR.updateButtons();
    FAR.saveUiState();
};

FAR.goToParent = function(side) {
    const ctx = FAR.side[side];
    if (!ctx) return;
    const cur = FAR.normPath(ctx.path);
    if (!cur) return;
    const parts = cur.split('/').filter(Boolean);
    parts.pop();
    const newPath = parts.length ? '/' + parts.join('/') : '/';
    ctx.path = newPath;
    ctx.selectedIdx.clear();
    ctx.anchor = -1;
    ctx.cursor = -1;
    FAR.renderPanel(side);
    FAR.saveUiState();
};

FAR.navigatePanel = function(side, action) {
    const ctx = FAR.side[side];
    if (!ctx) return;
    let path = ctx.path;
    if (action === '..') {
        const cur = FAR.normPath(path);
        if (!cur) return;
        const parts = cur.split('/').filter(Boolean);
        parts.pop();
        path = parts.length ? '/' + parts.join('/') : '/';
    } else if (action === '/') {
        path = '/';
    }
    ctx.path = path;
    ctx.selectedIdx.clear();
    ctx.anchor = -1;
    ctx.cursor = -1;
    FAR.renderPanel(side);
    FAR.saveUiState();
};

FAR.handleItemClick = function(event, side, index) {
    event.stopPropagation();
    FAR.setActivePanel(side);

    const ctx = FAR.side[side];
    if (!ctx) return;

    // Клик по ".." — не выделяем, но ставим курсор
    if (index === -1) {
        ctx.cursor = -1;
        ctx.selectedIdx.clear();
        ctx.anchor = -1;
        FAR.renderPanel(side);
        FAR.saveUiState();
        return;
    }

    const selSet = ctx.selectedIdx;
    const anchor = ctx.anchor;
    const ctrl   = event.ctrlKey || event.metaKey;
    const shift  = event.shiftKey;

    if (!shift) {
        ctx.cursor = index;
    }

    if (ctrl) {
        if (selSet.has(index)) selSet.delete(index);
        else selSet.add(index);
        ctx.anchor = index;
    } else if (shift && anchor !== -1) {
        selSet.clear();
        const from = Math.min(anchor, index);
        const to   = Math.max(anchor, index);
        for (let i = from; i <= to; i++) selSet.add(i);
    } else {
        selSet.clear();
        selSet.add(index);
        ctx.anchor = index;
    }
    FAR.renderPanel(side);
    FAR.saveUiState();
};

FAR.handleItemDblClick = async function(side, index) {
    // Двойной клик по ".." — на уровень выше
    if (index === -1) {
        FAR.goToParent(side);
        return;
    }
    const ctx = FAR.side[side];
    if (!ctx) return;
    const items = ctx.files;
    if (index < 0 || index >= items.length) return;
    const item = items[index];

    if (item.isFolder) {
        const newPath = '/' + FAR.normPath(item.path);
        ctx.path = newPath;
        ctx.selectedIdx.clear();
        ctx.anchor = -1;
        ctx.cursor = -1;
        FAR.renderPanel(side);
        FAR.saveUiState();
    } else {
        await FAR.openFile(item, side);
    }
};

FAR.updateSelectionInfo = function() {
    const el = document.getElementById('selInfo');
    const leftSel  = FAR.side.left  ? FAR.side.left.selectedIdx.size  : 0;
    const rightSel = FAR.side.right ? FAR.side.right.selectedIdx.size : 0;
    const total = leftSel + rightSel;
    if (total === 0) { el.textContent = ''; return; }
    const parts = [];
    if (leftSel > 0)  parts.push(`Л: ${leftSel}`);
    if (rightSel > 0) parts.push(`П: ${rightSel}`);
    el.textContent = `Выделено — ${parts.join(', ')}`;
};

FAR.getSelectedItemsFromActivePanel = function() {
    const ctx = FAR.side[FAR.activePanel];
    if (!ctx) return [];
    const items = ctx.files;
    const selSet = ctx.selectedIdx;
    const result = [];
    for (const i of Array.from(selSet).sort((a, b) => a - b)) {
        if (i >= 0 && i < items.length) result.push({ item: items[i], index: i });
    }
    return result;
};

FAR.updateButtons = function() {
    const hasDb = !!FAR.db;   // алиас: БД активной панели
    const ctx = FAR.side[FAR.activePanel];
    const selCount = ctx ? ctx.selectedIdx.size : 0;
    document.getElementById('btnCopy').disabled     = !hasDb || selCount === 0;
    document.getElementById('btnMove').disabled     = !hasDb || selCount === 0;
    document.getElementById('btnDelete').disabled   = !hasDb || selCount === 0;
    document.getElementById('btnDownload').disabled = !hasDb || selCount === 0;
    document.getElementById('btnZip').disabled      = !hasDb || selCount === 0;
};

// ============================================================
// Навигация курсором (стрелки, Home/End, PageUp/PageDown, Shift)
// Учитывает виртуальный элемент ".." с индексом -1.
// ============================================================

FAR.getPageSize = function(side) {
    const listEl = document.getElementById(side === 'left' ? 'listLeft' : 'listRight');
    if (!listEl) return 15;
    const rowH = 22;
    const h = listEl.clientHeight;
    return Math.max(1, Math.floor(h / rowH) - 1);
};

FAR.scrollCursorIntoView = function(side) {
    const listEl = document.getElementById(side === 'left' ? 'listLeft' : 'listRight');
    if (!listEl) return;
    const ctx = FAR.side[side];
    if (!ctx) return;
    const cursor = ctx.cursor;
    if (cursor < -1) return;
    const el = listEl.querySelector(`.file-item[data-index="${cursor}"]`);
    if (el && el.scrollIntoView) {
        el.scrollIntoView({ block: 'nearest' });
    }
};

FAR.moveCursor = function(side, delta, options) {
    options = options || {};
    const isPage = !!options.page;
    const toEdge = options.toEdge;

    const ctx = FAR.side[side];
    if (!ctx) return;

    const hasParent = (FAR.normPath(ctx.path) !== '');
    const items = ctx.files;

    const minCursor = hasParent ? -1 : 0;
    const maxCursor = items.length - 1;

    if (maxCursor < minCursor) return;

    const selSet = ctx.selectedIdx;
    const anchor = ctx.anchor;
    let cursor = ctx.cursor;

    if (cursor < minCursor) cursor = minCursor;
    if (cursor > maxCursor) cursor = maxCursor;
    if (cursor < 0 && !hasParent) cursor = 0;

    let newCursor = cursor;

    if (toEdge === 'home') {
        newCursor = minCursor;
    } else if (toEdge === 'end') {
        newCursor = maxCursor;
    } else if (isPage) {
        const pageSize = FAR.getPageSize(side);
        newCursor = cursor + delta * pageSize;
    } else {
        newCursor = cursor + delta;
    }

    if (newCursor < minCursor) newCursor = minCursor;
    if (newCursor > maxCursor) newCursor = maxCursor;

    if (newCursor === cursor && !options.force) {
        FAR.scrollCursorIntoView(side);
        return;
    }

    const shift = !!options.shift;

    if (shift) {
        if (newCursor === -1) {
            selSet.clear();
        } else if (anchor === -1 || anchor === undefined) {
            selSet.clear();
            selSet.add(newCursor);
            ctx.anchor = newCursor;
        } else {
            selSet.clear();
            const from = Math.min(anchor, newCursor);
            const to   = Math.max(anchor, newCursor);
            for (let i = from; i <= to; i++) selSet.add(i);
        }
    } else {
        if (newCursor === -1) {
            selSet.clear();
            ctx.anchor = -1;
        } else {
            selSet.clear();
            selSet.add(newCursor);
            ctx.anchor = newCursor;
        }
    }

    ctx.cursor = newCursor;

    FAR.renderPanel(side);
    FAR.scrollCursorIntoView(side);
    FAR.saveUiState();
};