// ============================================================
// Модалка подключения к БД (глобально или для одной панели).
// ============================================================
//
// ЛЕНИВАЯ ЗАГРУЗКА: после успешного подключения грузим только
// корень нужной панели/обеих панелей.
//
// МУЛЬТИ-ТИП: поддерживается выбор источника:
//   • couchdb    — удалённый CouchDB/PouchDB-сервер (PouchDB-клиент)
//   • filesystem — локальный FileServer.java (FAR.FsClient)
// Тип передаётся в cfg.type и учитывается в FAR.connectToDb.
// ============================================================

FAR.connModalSide = null;

FAR.openConnModal = function (required, side) {
    FAR.connModalRequired = !!required;
    FAR.connModalSide = side || null;

    const modal = document.getElementById('connModal');

    const def = FAR.getConnDefaultsForSide(FAR.connModalSide);

    // ---- Тип источника ----
    const typeSel = document.getElementById('connType');
    if (typeSel) {
        typeSel.value = def.type || 'couchdb';
    }

    // ---- Поля ----
    document.getElementById('connUrl').value  = def.url  || '';
    document.getElementById('connDb').value   = def.db   || '';
    document.getElementById('connUser').value = def.user || '';
    document.getElementById('connPass').value = def.pass || '';
    document.getElementById('connError').textContent = '';
    document.getElementById('connConnectBtn').disabled = false;
    document.getElementById('connConnectBtn').textContent = 'Подключиться';
    document.getElementById('connCloseBtn').style.display  = required ? 'none' : '';
    document.getElementById('connCancelBtn').style.display = required ? 'none' : '';

    // ---- Показ/скрытие полей под выбранный тип ----
    FAR._connModalUpdateFields();

    // ============================================================
    // Выбор режима работы
    // ============================================================
    // Показываем select режима ТОЛЬКО для глобального подключения
    // (side === null). Для side-only подключения режим не имеет
    // смысла — он не меняет глобальное состояние UI.
    const modeRow = document.getElementById('connUiModeRow');
    const modeSel = document.getElementById('connUiMode');
    if (modeRow && modeSel) {
        if (FAR.connModalSide) {
            modeRow.style.display = 'none';
        } else {
            modeRow.style.display = '';
            // Предзаполняем сохранённым режимом (или дефолт 'panel')
            let saved = 'panel';
            if (typeof FAR.WM !== 'undefined' && typeof FAR.WM.getSavedMode === 'function') {
                saved = FAR.WM.getSavedMode();
            }
            modeSel.value = saved;
        }
    }

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

/**
 * Обновляет видимость и подписи полей в зависимости от типа источника.
 * Вызывается:
 *   • при открытии модалки (openConnModal);
 *   • при смене <select id="connType">.
 */
FAR._connModalUpdateFields = function () {
    const typeSel = document.getElementById('connType');
    const type = typeSel ? (typeSel.value || 'couchdb') : 'couchdb';

    const dbRow   = document.getElementById('connDbRow');
    const userRow = document.getElementById('connUserRow');
    const passRow = document.getElementById('connPassRow');
    const urlLbl  = document.getElementById('connUrlLabel');
    const urlIn   = document.getElementById('connUrl');

    if (type === 'filesystem') {
        if (dbRow)   dbRow.style.display   = 'none';
        if (userRow) userRow.style.display = 'none';
        if (passRow) passRow.style.display = 'none';
        if (urlLbl)  urlLbl.textContent    = 'Адрес FileServer';
        if (urlIn)   urlIn.placeholder     = 'http://localhost:8080';
    } else {
        if (dbRow)   dbRow.style.display   = '';
        if (userRow) userRow.style.display = '';
        if (passRow) passRow.style.display = '';
        if (urlLbl)  urlLbl.textContent    = 'Адрес БД (с портом)';
        if (urlIn)   urlIn.placeholder     = 'http://192.168.15.20:5984';
    }
};

FAR.closeConnModal = function() {
    if (FAR.connModalRequired) return;
    document.getElementById('connModal').classList.add('hidden');
};

FAR.submitConnModal = async function () {
    // ---- Тип источника ----
    const typeSel = document.getElementById('connType');
    const type = typeSel ? (typeSel.value || 'couchdb') : 'couchdb';

    // ---- Поля ----
    const url  = document.getElementById('connUrl').value.trim();
    const dbn  = type === 'filesystem'
        ? ''
        : document.getElementById('connDb').value.trim();
    const user = type === 'filesystem'
        ? ''
        : document.getElementById('connUser').value.trim();
    const pass = type === 'filesystem'
        ? ''
        : document.getElementById('connPass').value;

    // Читаем выбранный режим (только для глобального подключения)
    let uiMode = 'panel';
    if (!FAR.connModalSide) {
        const modeSel = document.getElementById('connUiMode');
        if (modeSel) uiMode = modeSel.value || 'panel';
    }

    const errEl = document.getElementById('connError');
    errEl.textContent = '';

    if (!url) { errEl.textContent = 'Укажите адрес'; return; }
    if (type === 'couchdb' && !dbn) {
        errEl.textContent = 'Укажите имя базы данных';
        return;
    }

    const cfg = { type: type, url: url, db: dbn, user: user, pass: pass };
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

        // ============================================================
        // Применяем выбранный режим (только для глобального подключения).
        // ============================================================
        if (!FAR.connModalSide && typeof FAR.WM !== 'undefined') {
            // Сохраняем выбор
            if (typeof FAR.WM.saveMode === 'function') {
                FAR.WM.saveMode(uiMode);
            }
            // Применяем
            if (uiMode === 'wm') {
                if (!FAR.WM.state.active) FAR.WM.enter();
            } else {
                if (FAR.WM.state.active) FAR.WM.exit();
            }
        }
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