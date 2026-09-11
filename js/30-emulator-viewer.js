// ============================================================
// Просмотр игр через EmulatorJS в полноэкранной модалке
// ============================================================

FAR._emulatorInstance = null;     // Ссылка на созданный EJS-инстанс (если нужна)
FAR._emulatorCurrentItem = null;  // fileIndex-элемент текущей игры
FAR._emulatorBlobUrls = [];       // Созданные Blob URL для очистки
FAR._ejsLoadPromise = null;       // Promise загрузки loader.js
FAR._ejsLoaderInjected = false;   // Флаг: loader.js уже вставлен в DOM
FAR._ejsOriginalGameUrl = null;   // Оригинальный EJS_gameUrl (если был)

// --- Карта расширений → ядро EmulatorJS (без NES!) ---
FAR.EMULATOR_EXT_TO_CORE = {
    // SNES
    'smc': 'snes', 'fig': 'snes', 'sfc': 'snes', 'gd3': 'snes',
    'gd7': 'snes', 'dx2': 'snes', 'bsx': 'snes', 'swc': 'snes',
    // N64
    'z64': 'n64', 'n64': 'n64',
    // PC Engine
    'pce': 'pce',
    // NeoGeo Pocket
    'ngp': 'ngp', 'ngc': 'ngp',
    // WonderSwan
    'ws': 'ws', 'wsc': 'ws',
    // ColecoVision
    'col': 'coleco', 'cv': 'coleco',
    // Commodore 64
    'd64': 'vice_x64sc',
    // Nintendo DS / GBA / GB
    'nds': 'nds', 'gba': 'gba', 'gb': 'gb',
    // Из выпадающего меню EmulatorJS (по системам)
    'psx': 'psx', 'bin': 'psx', 'cue': 'psx', 'img': 'psx',
    'iso': 'psx', 'pbp': 'psx', 'chd': 'psx',
    'vb': 'vb', 'vboy': 'vb',
    'md': 'segaMD', 'gen': 'segaMD', 'smd': 'segaMD',
    'sms': 'segaMS',
    '32x': 'sega32x',
    'gg': 'segaGG',
    'lnx': 'lynx',
    'j64': 'jaguar', 'jag': 'jaguar',
    'a78': 'atari7800',
    'a26': 'atari2600',
    'zip': 'arcade',
    'pcfx': 'pcfx',
    'x128': 'vice_x128',
    'xvic': 'vice_xvic',
    'xplus4': 'vice_xplus4',
    'xpet': 'vice_xpet'
};

/**
 * Возвращает ядро EmulatorJS для файла, либо null.
 * NES обрабатывается отдельным модулем 29-nes-viewer.js.
 */
FAR._getEmulatorCore = function(item) {
    if (!item || item.isFolder) return null;
    const ext = (item.name.split('.').pop() || '').toLowerCase();
    if (ext === 'nes') return null;  // NES — отдельный просмотрщик
    return FAR.EMULATOR_EXT_TO_CORE[ext] || null;
};

/**
 * Проверяет, поддерживается ли файл EmulatorJS.
 */
FAR.isEmulatorFile = function(item) {
    return FAR._getEmulatorCore(item) !== null;
};

/**
 * Динамически подгружает loader.js EmulatorJS (один раз).
 * Возвращает Promise<void>.
 */
FAR._loadEmulatorLoader = function() {
    if (FAR._ejsLoaderInjected) {
        return Promise.resolve();
    }
    if (FAR._ejsLoadPromise) {
        return FAR._ejsLoadPromise;
    }

    FAR._ejsLoadPromise = new Promise(function(resolve, reject) {
        const script = document.createElement('script');
        script.src = 'lib/js-emulator/loader.js';
        script.async = true;
        script.onload = function() {
            FAR._ejsLoaderInjected = true;
            console.log('[EmulatorJS] loader.js загружен');
            resolve();
        };
        script.onerror = function() {
            FAR._ejsLoadPromise = null;
            reject(new Error('Не удалось загрузить lib/js-emulator/loader.js'));
        };
        document.head.appendChild(script);
    });

    return FAR._ejsLoadPromise;
};

/**
 * Открывает игру в полноэкранной модалке EmulatorJS.
 */
FAR.openEmulatorViewer = async function(item) {
    if (!FAR.ensureDb()) return;
    if (typeof FAR._ensureItemName === 'function') {
        FAR._ensureItemName(item);
    }

    const core = FAR._getEmulatorCore(item);
    if (!core) {
        FAR.toast('Формат не поддерживается эмулятором', 'warning');
        return;
    }

    // Закрываем другие модалки
    try { FAR.closeViewer(); } catch (e) {}
    try { FAR.closePanoramaViewer(); } catch (e) {}
    try { if (typeof FAR.closeJsdosViewer === 'function') FAR.closeJsdosViewer(); } catch (e) {}
    try { if (typeof FAR.closeNesViewer === 'function') FAR.closeNesViewer(); } catch (e) {}

    FAR._emulatorCurrentItem = item;
    FAR._emulatorBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._emulatorBlobUrls = [];

    const modal = document.getElementById('emulatorViewerModal');
    const title = document.getElementById('emulatorViewerTitle');
    const info = document.getElementById('emulatorViewerInfo');
    const coreHint = document.getElementById('emulatorCoreHint');
    const loading = document.getElementById('emulatorLoading');
    const loadingText = document.getElementById('emulatorLoadingText');
    const root = document.getElementById('emulatorRoot');

    title.textContent = '🕹️ ' + item.name;
    info.textContent = '';
    coreHint.textContent = 'Ядро: ' + core;
    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Загрузка библиотеки эмулятора…';

    // Сбрасываем старый инстанс
    FAR._destroyEmulator();

    // Очищаем контейнер
    root.innerHTML = '';
    root.id = 'emulatorRoot';

    // Загружаем ROM
    let blobUrl = null;
    try {
        const { data, contentType } = await FAR.readFileBody(item);
        const blob = new Blob([data], { type: contentType || 'application/octet-stream' });
        blobUrl = URL.createObjectURL(blob);
        FAR._emulatorBlobUrls.push(blobUrl);
        info.textContent = `💾 ${FAR.formatSize(data.length)}`;
    } catch (e) {
        console.error('openEmulatorViewer: readFileBody failed:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось загрузить ROM: ' + e.message, 'error');
        return;
    }

    // Загружаем loader.js динамически
    try {
        await FAR._loadEmulatorLoader();
    } catch (e) {
        console.error('[EmulatorJS] load failed:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось загрузить эмулятор: ' + e.message, 'error');
        return;
    }

    loadingText.textContent = 'Инициализация…';

    // Даём модалке отрисоваться
    await new Promise(function(resolve) { setTimeout(resolve, 50); });

    // Настраиваем глобальные переменные EmulatorJS ДО запуска
    // loader.js сам вызовет EJS_emulator при наличии EJS_player и т.п.
    window.EJS_player       = '#emulatorRoot';
    window.EJS_core         = core;
    window.EJS_gameUrl      = blobUrl;
    window.EJS_pathtodata   = 'lib/js-emulator/';
    window.EJS_color        = '#89b4fa';
    window.EJS_startOnLoaded = true;

    // Если loader.js поддерживает «перезапуск» — сохраняем оригинальный,
    // чтобы можно было вызвать повторно.
    if (typeof window.EJS_emulator !== 'undefined' && window.EJS_emulator) {
        try { window.EJS_emulator.textElem = null; } catch (e) {}
    }

    // Повторно вставляем loader.js, чтобы он создал новый инстанс
    // (в оригинале он запускается один раз при загрузке).
    try {
        await FAR._runEmulatorLoader(root);
        FAR._emulatorInstance = window.EJS_emulator || null;
        loading.classList.add('hidden');
        FAR.setStatus('🕹️ EmulatorJS: ' + item.name + ' (' + core + ')');
        FAR.toast('Игра запущена: ' + core, 'success');
    } catch (e) {
        console.error('openEmulatorViewer: run failed:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось запустить игру: ' + e.message, 'error');
    }
};

/**
 * Повторно запускает loader.js EmulatorJS, пересоздавая инстанс.
 * Делается через клонирование оригинального тега script и его
 * повторную вставку. Если loader.js уже выполнен и повторный запуск
 * не даёт эффекта — используется window.EJS_emulator (если есть).
 */
FAR._runEmulatorLoader = function(rootContainer) {
    return new Promise(function(resolve, reject) {
        // Если loader.js уже был загружен ранее и EJS_emulator доступен —
        // пробуем пересоздать эмулятор через публичный API.
        if (window.EJS_emulator && typeof window.EJS_emulator.restart === 'function') {
            try {
                window.EJS_emulator.restart();
                return resolve();
            } catch (e) { /* fallthrough */ }
        }

        // Иначе — повторно исполняем loader.js
        // (ID скрипта меняем, чтобы браузер не закешировал результат)
        const old = document.getElementById('ejs-loader-script');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        const script = document.createElement('script');
        script.id = 'ejs-loader-script';
        script.src = 'lib/js-emulator/loader.js?ts=' + Date.now();
        script.async = false;
        script.onload = function() {
            // Даём EmulatorJS время создать canvas
            setTimeout(resolve, 200);
        };
        script.onerror = function() {
            reject(new Error('Ошибка повторного запуска loader.js'));
        };
        document.head.appendChild(script);
    });
};

/**
 * Уничтожает текущий инстанс эмулятора (если есть).
 */
FAR._destroyEmulator = function() {
    try {
        if (window.EJS_emulator && typeof window.EJS_emulator.destroy === 'function') {
            window.EJS_emulator.destroy();
        }
    } catch (e) { /* ignore */ }
    FAR._emulatorInstance = null;

    // Иногда EmulatorJS оставляет мусор в window
    try { window.EJS_emulator = null; } catch (e) {}
};

/**
 * Закрывает модалку EmulatorJS.
 */
FAR.closeEmulatorViewer = function() {
    const modal = document.getElementById('emulatorViewerModal');
    if (modal) modal.classList.add('hidden');

    FAR._destroyEmulator();

    FAR._emulatorBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._emulatorBlobUrls = [];

    const root = document.getElementById('emulatorRoot');
    if (root) root.innerHTML = '';

    FAR._emulatorCurrentItem = null;
};

FAR.closeEmulatorViewerOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closeEmulatorViewer();
};

/**
 * Скачивает оригинальный ROM-файл.
 */
FAR.downloadCurrentEmulator = async function() {
    if (!FAR._emulatorCurrentItem) {
        FAR.toast('Нет активной игры', 'warning');
        return;
    }
    try {
        const { data, contentType } = await FAR.readFileBody(FAR._emulatorCurrentItem);
        const blob = new Blob([data], { type: contentType || 'application/octet-stream' });
        FAR.saveBlobAs(blob, FAR.sanitizeFileName(FAR._emulatorCurrentItem.name));
        FAR.toast('Файл сохранён', 'success');
    } catch (e) {
        FAR.toast('Ошибка скачивания: ' + e.message, 'error');
    }
};