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
FAR.openEmulatorViewer = async function (item) {
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

    FAR._destroyEmulator();
    root.innerHTML = '';
    root.id = 'emulatorRoot';

    // ============ ХУКИ СОСТОЯНИЙ — ДО loader.js ============
    loadingText.textContent = 'Загрузка модуля сохранений…';
    try {
        if (typeof FAR._installEmulatorStateHooks !== 'function') {
            await FAR.loadScriptOnce('js/32-emulator-state-db.js');
        }
        FAR._installEmulatorStateHooks();
    } catch (e) {
        console.warn('[EmuState] Не удалось загрузить модуль состояний:', e);
        // Не критично — эмулятор запустится, но сохраняться будет по-старому
    }
    // ======================================================

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

    // Загружаем loader.js EmulatorJS
    loadingText.textContent = 'Загрузка библиотеки эмулятора…';
    try {
        await FAR._loadEmulatorLoader();
        if (window.EJS_emulator && window.EJS_emulator.config && window.EJS_emulator.config.langJson) {
            window._farEjsLangJson = window.EJS_emulator.config.langJson;
            window.EJS_language = window.EJS_emulator.config.language || 'ru';
        }
    } catch (e) {
        console.error('[EmulatorJS] load failed:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось загрузить эмулятор: ' + e.message, 'error');
        return;
    }

    loadingText.textContent = 'Инициализация…';
    await new Promise(function (resolve) { setTimeout(resolve, 50); });

    window.EJS_player       = '#emulatorRoot';
    window.EJS_core         = core;
    window.EJS_gameUrl      = blobUrl;
    window.EJS_pathtodata   = 'lib/js-emulator/';
    window.EJS_color        = '#89b4fa';
    window.EJS_startOnLoaded = true;

    FAR._emulatorSuppressEnter();

    try {
        await FAR._runEmulatorLoader(root);
        FAR._emulatorInstance = window.EJS_emulator || null;
        loading.classList.add('hidden');
        FAR.setStatus('🕹️ EmulatorJS: ' + item.name + ' (' + core + ')');
        FAR.toast('Игра запущена: ' + core, 'success');
        FAR._emulatorFocus(root);
    } catch (e) {
        console.error('openEmulatorViewer: run failed:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось запустить игру: ' + e.message, 'error');
    }
};

/**
 * Гасит повторный старт эмулятора по Enter/Space.
 * EmulatorJS в некоторых сборках вешает на document обработчик,
 * который по нажатию Enter заново запускает игру (перечитывает ROM).
 * Перехватываем keydown в capture-фазе и, если модалка активна,
 * останавливаем всплытие.
 *
 * ВАЖНО: сами клавиши управления игрой при этом НЕ блокируются —
 * canvas получает их напрямую через свой обработчик.
 */
FAR._emulatorSuppressEnter = function() {
    if (FAR._emulatorKeyHandler) return;

    FAR._emulatorKeyHandler = function(e) {
        const modal = document.getElementById('emulatorViewerModal');
        if (!modal || modal.classList.contains('hidden')) return;

        // Enter и Space на документе могут дёргать «Play» в EmulatorJS.
        // Блокируем только эти два случая, всё остальное пропускаем.
        if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    };

    document.addEventListener('keydown', FAR._emulatorKeyHandler, true);
};

/**
 * Переводит фокус на контейнер эмулятора, чтобы клавиатура
 * уходила в canvas, а не в file-list FAR-менеджера.
 */
FAR._emulatorFocus = function(root) {
    if (!root) return;
    try {
        root.setAttribute('tabindex', '0');
        root.focus();
    } catch (e) { /* ignore */ }
};

/**
 * Создаёт (или пересоздаёт) инстанс EmulatorJS.
 * Библиотека emulator.min.js и loader.js исполняются ровно один раз —
 * повторное <script src="emulator.min.js"> приводит к SyntaxError
 * "Identifier 'EJS_STORAGE' has already been declared".
 *
 * Поэтому:
 *   1. Первый раз — грузим loader.js как обычно.
 *   2. Второй и последующие — просто заново создаём
 *      new window.EmulatorJS(...) с теми же EJS_* настройками.
 */
FAR._runEmulatorLoader = function(rootContainer) {
    return new Promise(function(resolve, reject) {
        // Если loader.js уже был загружен ранее — библиотека есть.
        // Не перезагружаем её, а сами создаём инстанс EmulatorJS.
        if (window.EmulatorJS && window._ejsLoaderInjected) {
            try {
                // Страховка: nipplejs должен быть определён (нужен
                // для setVirtualGamepad). Если сборка его потеряла —
                // подгрузим один раз вручную.
                if (typeof window.nipplejs === 'undefined') {
                    FAR._ensureNipplejs().then(function() {
                        FAR._createEmulatorInstance(resolve, reject);
                    }).catch(function(e) {
                        // Если nipplejs не удалось — всё равно пробуем
                        console.warn('[EmulatorJS] nipplejs недоступен:', e);
                        FAR._createEmulatorInstance(resolve, reject);
                    });
                    return;
                }
                FAR._createEmulatorInstance(resolve, reject);
            } catch (e) {
                reject(e);
            }
            return;
        }

        // Первый запуск: грузим loader.js.
        // ID скрипта меняем, чтобы не запутаться при отладке.
        const old = document.getElementById('ejs-loader-script');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        const script = document.createElement('script');
        script.id = 'ejs-loader-script';
        script.src = 'lib/js-emulator/loader.js?ts=' + Date.now();
        script.async = false;
        script.onload = function() {
            window._ejsLoaderInjected = true;
            // Даём EmulatorJS время создать canvas
            setTimeout(resolve, 200);
        };
        script.onerror = function() {
            reject(new Error('Ошибка загрузки loader.js'));
        };
        document.head.appendChild(script);
    });
};

/**
 * Создаёт новый инстанс EmulatorJS с текущими EJS_* настройками.
 * Библиотека уже определена (window.EmulatorJS), поэтому просто
 * вызываем конструктор.
 */
FAR._createEmulatorInstance = function(resolve, reject) {
    try {
        // Отдаём управление EmulatorJS: он сам создаст свой
        // canvas, кнопку Start, меню и т.п. внутри rootContainer.
        const playerSelector = '#' + (rootContainer && rootContainer.id ? rootContainer.id : 'emulatorRoot');

        // Собираем конфиг из тех же EJS_* глобалов, что использует loader.js.
        const config = {
            gameUrl:        window.EJS_gameUrl,
            dataPath:       window.EJS_pathtodata,
            system:         window.EJS_core,
            biosUrl:        window.EJS_biosUrl,
            gameName:       window.EJS_gameName,
            color:          window.EJS_color,
            adUrl:          window.EJS_AdUrl,
            adMode:         window.EJS_AdMode,
            adTimer:        window.EJS_AdTimer,
            adSize:         window.EJS_AdSize,
            alignStartButton: window.EJS_alignStartButton,
            VirtualGamepadSettings: window.EJS_VirtualGamepadSettings,
            buttonOpts:     window.EJS_Buttons,
            volume:         window.EJS_volume,
            defaultControllers: window.EJS_defaultControls,
            startOnLoad:    window.EJS_startOnLoaded,
            fullscreenOnLoad: window.EJS_fullscreenOnLoaded,
            filePaths:      window.EJS_paths,
            loadState:      window.EJS_loadStateURL,
            cacheLimit:     window.EJS_CacheLimit,
            cheats:         window.EJS_cheats,
            defaultOptions: window.EJS_defaultOptions,
            gamePatchUrl:   window.EJS_gamePatchUrl,
            gameParentUrl:  window.EJS_gameParentUrl,
            netplayUrl:     window.EJS_netplayServer,
            gameId:         window.EJS_gameID,
            backgroundImg:  window.EJS_backgroundImage,
            backgroundBlur: window.EJS_backgroundBlur,
            backgroundColor: window.EJS_backgroundColor,
            controlScheme:  window.EJS_controlScheme,
            threads:        window.EJS_threads,
            disableCue:     window.EJS_disableCue,
            startBtnName:   window.EJS_startButtonName,
            softLoad:       window.EJS_softLoad,
            capture:        window.EJS_screenCapture,
            externalFiles:  window.EJS_externalFiles,
            dontExtractBIOS: window.EJS_dontExtractBIOS,
            disableDatabases: window.EJS_disableDatabases,
            disableLocalStorage: window.EJS_disableLocalStorage,
            forceLegacyCores: window.EJS_forceLegacyCores,
            noAutoFocus:    window.EJS_noAutoFocus,
            videoRotation:  window.EJS_videoRotation,
            hideSettings:   window.EJS_hideSettings,
            shaders:        Object.assign({}, window.EJS_SHADERS, window.EJS_shaders || {}),
            language:       window.EJS_language,
            langJson:       window._farEjsLangJson || null
        };

        // Создаём инстанс
        window.EJS_emulator = new window.EmulatorJS(playerSelector, config);

        // Регистрируем хуки сохранения/загрузки состояний (если модуль 32 загружен)
        if (typeof FAR._emuStateOnSave === 'function') {
            try {
                window.EJS_emulator.on('saveState', FAR._emuStateOnSave);
                window.EJS_emulator.on('loadState', FAR._emuStateOnLoad);
                window.EJS_emulator._farStateHooksAttached = true;
                console.log('[EmuState] хуки привязаны к новому инстансу EmulatorJS');
            } catch (e) {
                console.warn('[EmuState] attach failed:', e);
            }
        }

        // Ждём готовности канваса
        setTimeout(resolve, 200);
    } catch (e) {
        reject(e);
    }
};


/**
 * Один раз подгружает nipplejs.js, если сборка EmulatorJS его не
 * предоставила. nipplejs нужен для setVirtualGamepad.
 */
FAR._ensureNipplejs = function() {
    if (typeof window.nipplejs !== 'undefined') return Promise.resolve();
    if (FAR._nipplejsPromise) return FAR._nipplejsPromise;

    FAR._nipplejsPromise = new Promise(function(resolve, reject) {
        const s = document.createElement('script');
        s.src = 'lib/js-emulator/src/nipplejs.js';
        s.async = true;
        s.onload = function() { resolve(); };
        s.onerror = function() { reject(new Error('nipplejs.js не найден')); };
        document.head.appendChild(s);
    });

    return FAR._nipplejsPromise;
};

/**
 * Полностью выгружает текущий инстанс эмулятора EmulatorJS из памяти.
 * ВАЖНО: не удаляет глобальные классы EmulatorJS (EJS_STORAGE,
 * EJS_GameManager, EJS_COMPRESSION, EmulatorJS) — они определены
 * один раз и повторно не объявляются.
 */
FAR._destroyEmulator = function() {
    const emu = window.EJS_emulator;

    if (emu) {
        // Отключаем звук
        try {
            if (emu.Module && emu.Module.AL && emu.Module.AL.currentCtx &&
                emu.Module.AL.currentCtx.audioCtx) {
                emu.Module.AL.currentCtx.audioCtx.close();
            }
        } catch (e) {}

        // Приостанавливаем главный цикл
        try {
            if (emu.gameManager && typeof emu.gameManager.toggleMainLoop === 'function') {
                emu.gameManager.toggleMainLoop(0);
            }
        } catch (e) {}
        try {
            if (emu.Module && typeof emu.Module.pauseMainLoop === 'function') {
                emu.Module.pauseMainLoop();
            }
        } catch (e) {}

        // Штатный destroy
        try { if (typeof emu.pause === 'function') emu.pause(true); } catch (e) {}
        try { if (typeof emu.destroy === 'function') emu.destroy(); } catch (e) {}

        // Жёстко убиваем WASM-инстанс
        try {
            if (emu.Module && typeof emu.Module.abort === 'function') {
                emu.Module.abort();
            }
        } catch (e) {}
    }

    // Снимаем наш keydown-перехватчик
    if (FAR._emulatorKeyHandler) {
        try {
            document.removeEventListener('keydown', FAR._emulatorKeyHandler, true);
        } catch (e) {}
        FAR._emulatorKeyHandler = null;
    }

    // Обнуляем сам инстанс — при следующем открытии создадим новый
    try { window.EJS_emulator = null; } catch (e) {}

    FAR._emulatorInstance = null;

    // Чистим Blob URL
    if (FAR._emulatorBlobUrls && FAR._emulatorBlobUrls.length) {
        FAR._emulatorBlobUrls.forEach(function(u) {
            try { URL.revokeObjectURL(u); } catch (e) {}
        });
        FAR._emulatorBlobUrls = [];
    }

    // Очищаем контейнер — EmulatorJS создаст в нём новый canvas
    // при следующем запуске.
    const root = document.getElementById('emulatorRoot');
    if (root) {
        try {
            const canvases = root.querySelectorAll('canvas');
            for (let i = 0; i < canvases.length; i++) {
                try { canvases[i].width = 0; canvases[i].height = 0; } catch (e) {}
            }
            const media = root.querySelectorAll('audio, video, iframe');
            for (let i = 0; i < media.length; i++) {
                try { media[i].src = ''; media[i].remove(); } catch (e) {}
            }
        } catch (e) {}
        root.innerHTML = '';
    }

    try { if (root) root.blur(); } catch (e) {}
    try { document.body.focus(); } catch (e) {}
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
/**
 * Закрывает модалку EmulatorJS и полностью выгружает эмулятор
 * из памяти браузера.
 */
FAR.closeEmulatorViewer = function() {
    const modal = document.getElementById('emulatorViewerModal');
    if (modal) modal.classList.add('hidden');

    // Полная выгрузка эмулятора
    FAR._destroyEmulator();

    // На случай, если что-то осталось — чистим ещё раз
    FAR._emulatorBlobUrls.forEach(function(u) {
        try { URL.revokeObjectURL(u); } catch (e) {}
    });
    FAR._emulatorBlobUrls = [];

    FAR._emulatorCurrentItem = null;

    // Возвращаем фокус в документ, чтобы стрелки/Enter снова
    // обрабатывались файловым менеджером
    try { document.body.focus(); } catch (e) {}
};