// ============================================================
// Обёртка над Pannellum: загрузка панорам из PouchDB (FileBD)
// ============================================================

FAR._pannellumBlobUrls = FAR._pannellumBlobUrls || [];

FAR._findDbImageByPath = function(dbPath) {
    const norm = FAR.normPath(dbPath);

    let item = FAR.fileIndex.find(f =>
        f.docType === 'file' && FAR.normPath(f.path) === norm
    );
    if (item) return item;

    const prefix = norm ? norm + '/' : '';
    const imgExts = ['jpg', 'jpeg', 'png', 'webp'];
    item = FAR.fileIndex.find(f => {
        if (f.docType !== 'file') return false;
        if (prefix && !FAR.normPath(f.path).startsWith(prefix)) return false;
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        return imgExts.includes(ext);
    });
    return item || null;
};

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

FAR._revokePannellumBlobUrls = function() {
    FAR._pannellumBlobUrls.forEach(function(u) {
        try { URL.revokeObjectURL(u); } catch (e) {}
    });
    FAR._pannellumBlobUrls = [];
};

FAR._installPannellumDbWrapper = function() {
    if (!window.pannellum || window.pannellum._dbWrapped) return;
    const originalViewer = window.pannellum.viewer;

    window.pannellum.viewer = function(container, config) {
        const prep = async function() {
            const cfg = JSON.parse(JSON.stringify(config));

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