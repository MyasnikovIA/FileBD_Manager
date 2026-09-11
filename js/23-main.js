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

    FAR.updateAuthUI();
    FAR.renderPanel('left');
    FAR.renderPanel('right');

    FAR.setupPanelDragDrop('panelLeft');
    FAR.setupPanelDragDrop('panelRight');

    window.addEventListener('dragover', function(e) { e.preventDefault(); });
    window.addEventListener('drop',     function(e) { e.preventDefault(); });

    FAR.setupKeyboard();

    // Устанавливаем обёртку Pannellum для загрузки из PouchDB
    FAR._installPannellumDbWrapper();

    const saved = FAR.loadConnFromLS();
    if (saved) {
        FAR.setStatus('🔌 Подключение с сохранёнными данными…');
        FAR.showLoading('Подключение к FileBD…', saved.url + '/' + saved.db);
        try {
            const res = await FAR.connectToDb(saved);
            FAR.db = res.db;
            FAR.currentConn = saved;
            FAR.hideLoading();
            FAR.updateAuthUI();
            FAR.setStatus(`✅ Подключено: ${res.fullUrl} (документов: ${res.info.doc_count || 0})`);
            FAR.toast('Подключение восстановлено', 'success');
            await FAR.loadFiles();
            FAR.renderPanel('left');
            FAR.renderPanel('right');
        } catch (e) {
            FAR.hideLoading();
            console.error('auto-connect error:', e);
            FAR.db = null;
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