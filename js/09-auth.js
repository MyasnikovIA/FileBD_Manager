FAR.updateAuthUI = function() {
    const btn = document.getElementById('btnAuth');
    if (FAR.db) {
        btn.textContent = '🔓 LogOut';
        btn.title = 'Выйти и очистить сохранённые данные подключения';
    } else {
        btn.textContent = '🔐 LogIn';
        btn.title = 'Войти в базу данных';
    }
    const ids = ['btnUpload','btnMkdir','btnCopy','btnMove','btnDownload',
                 'btnZip','btnDelete','btnRefresh','btnDebug','btnMigrate'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (id === 'btnRefresh' || id === 'btnDebug' || id === 'btnMigrate'
            || id === 'btnUpload' || id === 'btnMkdir') {
            el.disabled = !FAR.db;
        } else {
            if (!FAR.db) el.disabled = true;
        }
    }
    if (FAR.db) FAR.updateButtons();
};

FAR.onAuthButton = function() {
    if (FAR.db) {
        if (!confirm('Выйти из системы?\nСохранённые данные подключения будут удалены.')) return;
        FAR.clearConnFromLS();
        FAR.db = null;
        FAR.currentConn = null;
        FAR.fileIndex = [];
        FAR.leftPath = '/';
        FAR.rightPath = '/';
        FAR.leftSelectedIdx.clear();
        FAR.rightSelectedIdx.clear();
        FAR.leftAnchor = -1;
        FAR.rightAnchor = -1;
        FAR.renderPanel('left');
        FAR.renderPanel('right');
        FAR.updateAuthUI();
        FAR.updateTotalSize();
        FAR.setStatus('🔓 Вы вышли из системы');
        FAR.openConnModal();
    } else {
        FAR.openConnModal();
    }
};