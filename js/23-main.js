// ============================================================
// Точка входа: загрузка модалок, инициализация, автоподключение
// ============================================================
// Поддерживает мульти-БД (модуль 35-multi-db.js):
//   • при старте подключает ОБЕ панели к одной БД;
//   • при клике по шапке панели можно сменить БД только для неё;
//   • данные подключения каждой панели хранятся отдельно.
// ============================================================

// ============================================================
// Загрузка модальных окон из modals/*.html
// ============================================================
FAR.loadModalFragment = function(path) {
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', path, false);
        xhr.send(null);
        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
            return xhr.responseText;
        }
        throw new Error('HTTP ' + xhr.status);
    } catch (e) {
        console.error('Не удалось загрузить ' + path + ':', e);
        return '<!-- Ошибка загрузки ' + path + ' -->';
    }
};

FAR.injectModals = function() {
    const root = document.getElementById('modalRoot');
    const files = [
        'modals/connection.html',
        'modals/viewer.html',
        'modals/panorama-viewer.html',
        'modals/panorama-editor.html',
        'modals/db-picker.html',
        'modals/jsdos-viewer.html',
        'modals/nes-viewer.html',
        'modals/emulator-viewer.html',
        'modals/pdf-viewer.html',
        'modals/gamepad-setup.html',
        'modals/progress.html',
        'modals/loading.html',
        'modals/debug.html'
    ];
    let html = '';
    for (const f of files) {
        html += FAR.loadModalFragment(f) + '\n';
    }
    root.innerHTML = html;
};

// ============================================================
// Старт
// ============================================================
document.addEventListener('DOMContentLoaded', async function() {
    FAR.injectModals();

    // --- Мульти-БД: переключатели БД в шапках панелей ---
    // (модуль 35-multi-db.js уже загружен к этому моменту,
    //  т.к. подключён в index.html до 23-main.js)
    if (typeof FAR.setupPanelDbSwitcher === 'function') {
        FAR.setupPanelDbSwitcher();
    }
    if (typeof FAR.updateConnIndicators === 'function') {
        FAR.updateConnIndicators();
    }

    FAR.updateAuthUI();
    FAR.renderPanel('left');
    FAR.renderPanel('right');

    FAR.setupPanelDragDrop('panelLeft');
    FAR.setupPanelDragDrop('panelRight');

    window.addEventListener('dragover', function(e) { e.preventDefault(); });
    window.addEventListener('drop',     function(e) { e.preventDefault(); });

    FAR.setupKeyboard();
    FAR.setupGamepadAuto();
    FAR.setupPanelContextMenu();

    // Устанавливаем обёртку Pannellum для загрузки из PouchDB
    FAR._installPannellumDbWrapper();

    // ============================================================
    // Автоподключение
    // ============================================================
    // Приоритет источников для «обеих панелей»:
    //   1) глобальный LS (filebd_conn) — как было раньше;
    //   2) LS левой панели (filebd_conn_left);
    //   3) LS правой панели (filebd_conn_right).
    // Если ничего нет — открываем модалку обязательного подключения.
    // ============================================================

    const savedGlobal = FAR.loadConnFromLS();
    const savedLeft   = (typeof FAR.loadSideConnFromLS === 'function')
                        ? FAR.loadSideConnFromLS('left')  : null;
    const savedRight  = (typeof FAR.loadSideConnFromLS === 'function')
                        ? FAR.loadSideConnFromLS('right') : null;

    const saved = savedGlobal || savedLeft || savedRight;

    if (saved) {
        FAR.setStatus('🔌 Подключение с сохранёнными данными…');
        FAR.showLoading('Подключение к FileBD…', saved.url + '/' + saved.db);
        try {
            const res = await FAR.connectToDb(saved);

            // Ставим подключение ОБЕИМ панелям
            FAR.applyConnectionToBoth(saved, res.db, res.fullUrl);

            FAR.hideLoading();
            FAR.updateAuthUI();
            FAR.setStatus(`✅ Подключено: ${res.fullUrl} (документов: ${res.info.doc_count || 0})`);
            FAR.toast('Подключение восстановлено', 'success');

            await FAR.loadFilesForSide('left');
            await FAR.loadFilesForSide('right');

            FAR.renderPanel('left');
            FAR.renderPanel('right');

            FAR.restoreUiState();

            if (typeof FAR.updateConnIndicators === 'function') {
                FAR.updateConnIndicators();
            }
        } catch (e) {
            FAR.hideLoading();
            console.error('auto-connect error:', e);

            FAR.side.left  = FAR.createSideContext('left');
            FAR.side.right = FAR.createSideContext('right');
            FAR.currentConn = null;

            FAR.updateAuthUI();
            FAR.setStatus('❌ Ошибка автоподключения: ' + e.message);
            FAR.toast('Не удалось подключиться с сохранёнными данными', 'error');
            FAR.openConnModal(true);
        }
    } else {
        FAR.setStatus('🔐 Требуется вход');
        FAR.openConnModal(true);
    }
});