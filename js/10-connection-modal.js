// ============================================================
// Модалка подключения к БД (глобально или для одной панели).
// ============================================================
//
// ЛЕНИВАЯ ЗАГРУЗКА: после успешного подключения грузим только
// корень нужной панели/обеих панелей.

FAR.connModalSide = null;

FAR.openConnModal = function (required, side) {
    FAR.connModalRequired = !!required;
    FAR.connModalSide = side || null;

    const modal = document.getElementById('connModal');

    const def = FAR.getConnDefaultsForSide(FAR.connModalSide);

    document.getElementById('connUrl').value  = def.url  || '';
    document.getElementById('connDb').value   = def.db   || '';
    document.getElementById('connUser').value = def.user || '';
    document.getElementById('connPass').value = def.pass || '';
    document.getElementById('connError').textContent = '';
    document.getElementById('connConnectBtn').disabled = false;
    document.getElementById('connConnectBtn').textContent = 'Подключиться';
    document.getElementById('connCloseBtn').style.display  = required ? 'none' : '';
    document.getElementById('connCancelBtn').style.display = required ? 'none' : '';

    const titleEl = document.getElementById('connTitle');
    const tgtEl = document.getElementById('connTarget');
    const tgtNameEl = document.getElementById('connTargetName');
    if (FAR.connModalSide) {
        if (titleEl) titleEl.textContent = '🔐 Подключение панели';
        if (tgtEl) tgtEl.style.display = '';
        if (tgtNameEl) tgtNameEl.textContent =
            FAR.connModalSide === 'left' ? 'Левая' : 'Правая';
    } else {
        if (titleEl) titleEl.textContent = '🔐 Подключение к FileBD';
        if (tgtEl) tgtEl.style.display = 'none';
    }

    modal.classList.remove('hidden');
    setTimeout(function () { document.getElementById('connUrl').focus(); }, 50);
};

FAR.closeConnModal = function() {
    if (FAR.connModalRequired) return;
    document.getElementById('connModal').classList.add('hidden');
};

FAR.submitConnModal = async function () {
    const url  = document.getElementById('connUrl').value.trim();
    const dbn  = document.getElementById('connDb').value.trim();
    const user = document.getElementById('connUser').value.trim();
    const pass = document.getElementById('connPass').value;

    const errEl = document.getElementById('connError');
    errEl.textContent = '';

    if (!url) { errEl.textContent = 'Укажите адрес БД'; return; }
    if (!dbn) { errEl.textContent = 'Укажите имя базы данных'; return; }

    const cfg = { url: url, db: dbn, user: user, pass: pass };
    const btn = document.getElementById('connConnectBtn');
    btn.disabled = true;
    btn.textContent = 'Подключение…';

    try {
        const res = await FAR.connectToDb(cfg);

        if (FAR.connModalSide) {
            FAR.applyConnectionToSide(FAR.connModalSide, cfg, res.db, res.fullUrl);
            FAR.saveSideConnToLS(FAR.connModalSide, cfg);
        } else {
            FAR.applyConnectionToBoth(cfg, res.db, res.fullUrl);
            FAR.saveConnToLS(cfg);
        }

        FAR.updateAuthUI();
        FAR.connModalRequired = false;
        document.getElementById('connModal').classList.add('hidden');

        FAR.setStatus('✅ Подключено: ' + res.fullUrl);
        FAR.toast('Подключение установлено', 'success');

        // Ленивая загрузка: только корень нужных панелей.
        if (FAR.connModalSide) {
            await FAR.loadFilesForSide(FAR.connModalSide, { path: '/', silent: true });
            FAR.renderPanel(FAR.connModalSide, { skipLoad: true });
        } else {
            await FAR.loadFilesForSide('left',  { path: '/', silent: true });
            await FAR.loadFilesForSide('right', { path: '/', silent: true });
            FAR.renderPanel('left',  { skipLoad: true });
            FAR.renderPanel('right', { skipLoad: true });
        }
        FAR.updateConnIndicators();
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