// ============================================================
// Обёртка над Pannellum: загрузка панорам из PouchDB (FileBD)
// ============================================================

FAR._pannellumBlobUrls = FAR._pannellumBlobUrls || [];

/**
 * Достраивает поле name у элемента fileIndex, если его нет.
 * Экспортируется как FAR._ensureItemName, используется в других модулях.
 */
FAR._ensureItemName = function(item) {
    if (!item) return item;
    if (!item.name && item.path) {
        const p = FAR.normPath(item.path);
        item.name = p.includes('/') ? p.substring(p.lastIndexOf('/') + 1) : p;
    }
    return item;
};

/**
 * Ищет файл в fileIndex по пути внутри БД.
 * Принимает либо полный путь к файлу, либо путь к папке —
 * тогда берём первый файл-изображение из неё.
 * Всегда возвращает элемент с заполненным полем name.
 */
FAR._findDbImageByPath = function(dbPath) {
    const norm = FAR.normPath(dbPath);

    // 1. Точное совпадение
    let item = FAR.fileIndex.find(f =>
        f.docType === 'file' && FAR.normPath(f.path) === norm
    );

    // 2. Если это папка — ищем первое изображение внутри
    if (!item) {
        const prefix = norm ? norm + '/' : '';
        const imgExts = ['jpg', 'jpeg', 'png', 'webp'];
        item = FAR.fileIndex.find(f => {
            if (f.docType !== 'file') return false;
            if (prefix && !FAR.normPath(f.path).startsWith(prefix)) return false;
            const ext = ((f.name || f.path || '').split('.').pop() || '').toLowerCase();
            return imgExts.includes(ext);
        });
    }

    if (!item) return null;

    // Достраиваем name, если его нет
    FAR._ensureItemName(item);
    return item;
};

/**
 * Загружает файл из PouchDB и возвращает Blob URL.
 */
FAR._loadDbImageAsBlobUrl = async function(dbPath) {
    const item = FAR._findDbImageByPath(dbPath);
    if (!item) {
        throw new Error('Файл не найден в БД: ' + dbPath);
    }
    const { data, contentType } = await FAR.readFileBody(item);
    const blob = new Blob([data], { type: contentType || 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    FAR._pannellumBlobUrls.push(url);
    return url;
};

/**
 * Освобождает все Blob URL, созданные для Pannellum.
 */
FAR._revokePannellumBlobUrls = function() {
    FAR._pannellumBlobUrls.forEach(function(u) {
        try { URL.revokeObjectURL(u); } catch (e) {}
    });
    FAR._pannellumBlobUrls = [];
};

/**
 * Обёртка над window.pannellum.viewer.
 * Поддерживает:
 *  - scene.source === 'db' + scene.dbPath
 *  - scene.panorama, начинающийся с 'db:'
 *  - hotSpots[] с source === 'db' (загружает картинки заранее, до создания viewer)
 */
FAR._installPannellumDbWrapper = function() {
    if (!window.pannellum || window.pannellum._dbWrapped) return;
    const originalViewer = window.pannellum.viewer;

    window.pannellum.viewer = function(container, config) {
        // Асинхронная подготовка: подменяем panorama / hotSpots.panorama_url
        // на Blob URL из PouchDB.
        const prep = async function() {
            const cfg = JSON.parse(JSON.stringify(config));

            // --- Сцены ---
            if (cfg.scenes) {
                for (const sceneId of Object.keys(cfg.scenes)) {
                    const sc = cfg.scenes[sceneId];
                    if (!sc) continue;

                    const wantsDb = sc.source === 'db'
                        || (typeof sc.panorama === 'string' && sc.panorama.startsWith('db:'));

                    if (wantsDb) {
                        const dbPath = sc.dbPath
                            || (sc.panorama || '').replace(/^db:/, '');
                        try {
                            sc.panorama = await FAR._loadDbImageAsBlobUrl(dbPath);
                            sc.crossOrigin = 'anonymous';
                            delete sc.source;
                            delete sc.dbPath;
                        } catch (e) {
                            console.error('Не удалось загрузить панораму из БД:', dbPath, e);
                        }
                    }

                    // --- Хотспоты ---
                    if (Array.isArray(sc.hotSpots)) {
                        for (const hs of sc.hotSpots) {
                            if (hs.source === 'db' && hs.dbPath) {
                                try {
                                    hs.panorama_url = await FAR._loadDbImageAsBlobUrl(hs.dbPath);
                                    hs._origDbPath = hs.dbPath;
                                    hs.source = 'db';
                                } catch (e) {
                                    console.error('Не удалось загрузить хотспот из БД:', hs.dbPath, e);
                                }
                            }
                        }
                    }
                }
            }

            // --- Одиночная сцена (без scenes) ---
            if (!cfg.scenes && cfg.panorama) {
                const wantsDb = cfg.source === 'db'
                    || (typeof cfg.panorama === 'string' && cfg.panorama.startsWith('db:'));
                if (wantsDb) {
                    const dbPath = cfg.dbPath || cfg.panorama.replace(/^db:/, '');
                    try {
                        cfg.panorama = await FAR._loadDbImageAsBlobUrl(dbPath);
                        cfg.crossOrigin = 'anonymous';
                        delete cfg.source;
                        delete cfg.dbPath;
                    } catch (e) {
                        console.error('Не удалось загрузить панораму из БД:', dbPath, e);
                    }
                }
                if (Array.isArray(cfg.hotSpots)) {
                    for (const hs of cfg.hotSpots) {
                        if (hs.source === 'db' && hs.dbPath) {
                            try {
                                hs.panorama_url = await FAR._loadDbImageAsBlobUrl(hs.dbPath);
                                hs._origDbPath = hs.dbPath;
                            } catch (e) {
                                console.error('Не удалось загрузить хотспот из БД:', hs.dbPath, e);
                            }
                        }
                    }
                }
            }

            return originalViewer(container, cfg);
        };

        const queue = [];
        const proxy = {
            _isProxy: true,
            _ready: false,
            _real: null
        };

        ['on','off','loadScene','getScene','addScene','removeScene',
         'addHotSpot','removeHotSpot','lookAt','getPitch','setPitch',
         'getYaw','setYaw','getHfov','setHfov','getConfig','getContainer',
         'resize','destroy','toggleFullscreen','startAutoRotate',
         'stopAutoRotate','stopMovement','renderHotSpots','viewScene',
         'isLoaded','getNorthOffset','setNorthOffset','startOrientation',
         'stopOrientation','isOrientationActive','isOrientationSupported',
         'getPitchBounds','setPitchBounds','getYawBounds','setYawBounds',
         'getHfovBounds','setHfovBounds','zoomOut','getRenderer','setUpdate',
         'mouseEventToCoords','getLastClick','getLastSceneId'
        ].forEach(function(method) {
            proxy[method] = function() {
                if (proxy._real) {
                    return proxy._real[method].apply(proxy._real, arguments);
                }
                queue.push({ method: method, args: Array.from(arguments) });
                return proxy;
            };
        });

        prep().then(function(real) {
            proxy._real = real;
            proxy._ready = true;
            queue.forEach(function(call) {
                try {
                    real[call.method].apply(real, call.args);
                } catch (e) {
                    console.warn('Отложенный вызов упал:', call.method, e);
                }
            });
            queue.length = 0;
        }).catch(function(e) {
            console.error('Pannellum DB wrapper: не удалось инициализировать viewer:', e);
        });

        return proxy;
    };

    window.pannellum._dbWrapped = true;
    window.pannellum._originalViewer = originalViewer;
};