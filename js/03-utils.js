FAR.setStatus = function(t) {
    document.getElementById('statusText').textContent = t;
};

FAR.showLoading = function(text, sub) {
    document.getElementById('loadingOverlay').classList.remove('hidden');
    document.getElementById('loadingText').textContent = text || '';
    document.getElementById('loadingSub').textContent = sub || '';
};
FAR.updateLoadingSub = function(text) {
    document.getElementById('loadingSub').textContent = text || '';
};
FAR.hideLoading = function() {
    document.getElementById('loadingOverlay').classList.add('hidden');
};

FAR.formatSize = function(b) {
    if (!b) return '0 B';
    if (b > 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b > 1048576) return (b / 1048576).toFixed(2) + ' MB';
    if (b > 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
};

FAR.escapeHtml = function(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
};

FAR.hexPreview = function(data) {
    return Array.from(data.slice(0, 256))
        .map(b => b.toString(16).padStart(2, '0')).join(' ');
};

FAR.toast = function(msg, type) {
    type = type || 'info';
    const c = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3000);
};

FAR.sanitizeFileName = function(name) {
    return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '_');
};

FAR.normPath = function(p) {
    if (p === null || p === undefined) return '';
    let s = String(p).trim();
    if (!s) return '';
    s = s.replace(/\\/g, '/');
    s = s.replace(/^\/+|\/+$/g, '');
    s = s.replace(/\/+/g, '/');
    return s;
};

/**
 * Загружает внешний скрипт ровно один раз.
 * Возвращает Promise, который резолвится после загрузки.
 * Повторные вызовы с тем же src возвращают тот же Promise.
 */
FAR._loadedScripts = FAR._loadedScripts || {};

FAR.loadScriptOnce = function (src) {
    if (FAR._loadedScripts[src]) return FAR._loadedScripts[src];

    FAR._loadedScripts[src] = new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = function () { resolve(); };
        s.onerror = function () {
            delete FAR._loadedScripts[src];
            reject(new Error('Не удалось загрузить ' + src));
        };
        document.head.appendChild(s);
    });

    return FAR._loadedScripts[src];
};