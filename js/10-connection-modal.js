FAR.openConnModal = function(required) {
    FAR.connModalRequired = !!required;
    const modal = document.getElementById('connModal');
    const saved = FAR.loadConnFromLS();
    const def = saved || FAR.getDefaultConn();

    document.getElementById('connUrl').value  = def.url  || '';
    document.getElementById('connDb').value   = def.db   || '';
    document.getElementById('connUser').value = def.user || '';
    document.getElementById('connPass').value = def.pass || '';
    document.getElementById('connError').textContent = '';
    document.getElementById('connConnectBtn').disabled = false;
    document.getElementById('connConnectBtn').textContent = 'Подключиться';
    document.getElementById('connCloseBtn').style.display  = required ? 'none' : '';
    document.getElementById('connCancelBtn').style.display = required ? 'none' : '';
    modal.classList.remove('hidden');
    setTimeout(function() { document.getElementById('connUrl').focus(); }, 50);
};

FAR.closeConnModal = function() {
    if (FAR.connModalRequired) return;
    document.getElementById('connModal').classList.add('hidden');
};

FAR.submitConnModal = async function() {
    const url  = document.getElementById('connUrl').value.trim();
    const dbn  = document.getElementById('connDb').value.trim();
    const user = document.getElementById('connUser').value.trim();
    const pass = document.getElementById('connPass').value;

    const errEl = document.getElementById('connError');
    errEl.textContent = '';

    if (!url) { errEl.textContent = 'Укажите адрес БД'; return; }
    if (!dbn) { errEl.textContent = 'Укажите имя базы данных'; return; }

    const cfg = { url, db: dbn, user, pass };
    const btn = document.getElementById('connConnectBtn');
    btn.disabled = true;
    btn.textContent = 'Подключение…';

    try {
        const res = await FAR.connectToDb(cfg);
        FAR.db = res.db;
        FAR.currentConn = cfg;
        FAR.saveConnToLS(cfg);
        FAR.updateAuthUI();
        FAR.connModalRequired = false;
        document.getElementById('connModal').classList.add('hidden');
        FAR.setStatus(`✅ Подключено: ${res.fullUrl} (документов: ${res.info.doc_count || 0})`);
        FAR.toast('Подключение установлено', 'success');
        await FAR.loadFiles();
        FAR.renderPanel('left');
        FAR.renderPanel('right');
    } catch (e) {
        console.error('connect error:', e);
        let msg = e && e.message ? e.message : String(e);
        if (e && e.status === 401) msg = 'Неверный логин или пароль (401)';
        if (e && e.status === 404) msg = 'База данных не найдена (404). Проверьте имя.';
        if (e && e.name === 'TypeError') msg = 'Не удалось подключиться (сеть/CORS). Проверьте адрес.';
        errEl.textContent = '❌ ' + msg;
        btn.disabled = false;
        btn.textContent = 'Подключиться';
    }
};