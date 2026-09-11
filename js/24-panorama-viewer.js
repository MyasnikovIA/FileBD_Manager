// ============================================================
// Просмотр панорам 360° через Pannellum в модальном окне
// ============================================================

FAR._panoViewer = null;
FAR._panoCurrentItem = null;
FAR._panoCurrentUrl = null;
FAR._panoBlobUrls = [];
FAR._panoCurrentHotspots = [];

FAR.PANO_ASPECT_MIN = 1.9;
FAR.PANO_ASPECT_MAX = 2.1;

FAR.isPanorama = async function(item) {
    if (!item || item.isFolder) return false;

    const ext = (item.name.split('.').pop() || '').toLowerCase();
    const imgExts = ['jpg', 'jpeg', 'png', 'webp'];
    if (!imgExts.includes(ext)) return false;

    if (item.width && item.height) {
        const ratio = item.width / item.height;
        return ratio >= FAR.PANO_ASPECT_MIN && ratio <= FAR.PANO_ASPECT_MAX;
    }

    try {
        const { data } = await FAR.readFileBody(item);
        const blob = new Blob([data], { type: item.contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR._panoBlobUrls.push(url);

        const dims = await FAR._measureImage(url);
        URL.revokeObjectURL(url);
        FAR._panoBlobUrls = FAR._panoBlobUrls.filter(u => u !== url);

        if (!dims) return false;
        const ratio = dims.width / dims.height;
        return ratio >= FAR.PANO_ASPECT_MIN && ratio <= FAR.PANO_ASPECT_MAX;
    } catch (e) {
        console.warn('isPanorama: не удалось измерить', item.name, e);
        return false;
    }
};

FAR._measureImage = function(url) {
    return new Promise(function(resolve) {
        const img = new Image();
        img.onload = function() {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = function() { resolve(null); };
        img.src = url;
    });
};

FAR._findPanoramaJson = async function(item) {
    const baseName = item.name.replace(/\.[^/.]+$/, '');
    const dir = item.path.includes('/')
        ? item.path.substring(0, item.path.lastIndexOf('/'))
        : '';
    const jsonPath = dir ? dir + '/' + baseName + '.json' : baseName + '.json';

    let jsonItem = FAR.fileIndex.find(f =>
        f.docType === 'file' && FAR.normPath(f.path) === FAR.normPath(jsonPath)
    );

    if (jsonItem) {
        try {
            const { data } = await FAR.readFileBody(jsonItem);
            const text = new TextDecoder('utf-8').decode(data);
            return JSON.parse(text);
        } catch (e) {
            console.warn('JSON найден, но не распарсен:', jsonPath, e);
        }
    }

    try {
        const url = FAR._panoCurrentUrl && FAR._panoCurrentUrl.startsWith('http')
            ? FAR._panoCurrentUrl.replace(/\.[^/.]+$/, '') + '.json'
            : null;
        if (url) {
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) return await res.json();
        }
    } catch (e) { /* ignore */ }

    return null;
};

FAR._jsonToPannellumHotspots = function(jsonData, basePath, fallbackImageUrl) {
    const result = [];
    if (!jsonData || !Array.isArray(jsonData.hotSpots)) return result;

    jsonData.hotSpots.forEach(function(hs) {
        let relUrl = hs.panorama_url || '';
        let fullUrl = relUrl;

        if (relUrl && !/^https?:\/\//i.test(relUrl)) {
            const cleanBase = (basePath || '').replace(/\/+$/, '');
            const cleanRel = relUrl.replace(/^\/+/, '');
            fullUrl = cleanBase ? cleanBase + '/' + cleanRel : cleanRel;
        }

        result.push({
            pitch: hs.pitch || 0,
            yaw: hs.yaw || 0,
            type: hs.type || 'scene',
            text: hs.text || hs.name || 'Переход',
            panorama_url: fullUrl,
            relativePath: relUrl,
            point_pitch: hs.targetPitch || 0,
            point_yaw: hs.targetYaw || 0,
            targetHfov: hs.targetHfov || 100,
            source: hs.source || 'url',
            dbPath: hs.dbPath || '',
            id: hs.id
        });
    });

    return result;
};

FAR.openPanoramaViewer = async function(item) {
    if (!FAR.ensureDb()) return;

    FAR.closeViewer();

    FAR._panoCurrentItem = item;
    FAR._panoBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._panoBlobUrls = [];
    FAR._panoCurrentHotspots = [];

    const modal = document.getElementById('panoramaViewerModal');
    const title = document.getElementById('panoramaViewerTitle');
    const info = document.getElementById('panoramaViewerInfo');
    const loading = document.getElementById('panoramaLoading');
    const loadingText = document.getElementById('panoramaLoadingText');

    title.textContent = '🌐 ' + item.name;
    info.textContent = '';
    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Загрузка панорамы…';

    if (FAR._panoViewer) {
        try { FAR._panoViewer.destroy(); } catch (e) {}
        FAR._panoViewer = null;
    }

    document.getElementById('panoramaCanvas').innerHTML = '';

    try {
        const { data, contentType } = await FAR.readFileBody(item);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR._panoBlobUrls.push(url);
        FAR._panoCurrentUrl = url;

        const dims = await FAR._measureImage(url);
        if (dims) {
            info.textContent = `📐 ${dims.width}×${dims.height} (${FAR.formatSize(data.length)})`;
        } else {
            info.textContent = `📁 ${FAR.formatSize(data.length)}`;
        }

        const basePath = item.path.includes('/')
            ? item.path.substring(0, item.path.lastIndexOf('/'))
            : '';
        const jsonData = await FAR._findPanoramaJson(item);
        const hotspots = FAR._jsonToPannellumHotspots(jsonData, basePath, url);

        FAR._panoCurrentHotspots = jsonData && Array.isArray(jsonData.hotSpots)
            ? jsonData.hotSpots.slice()
            : [];

        const initialPitch = jsonData && jsonData.pitchCam !== undefined
            ? jsonData.pitchCam
            : 0;
        const initialYaw = jsonData && jsonData.yawCam !== undefined
            ? jsonData.yawCam
            : 0;

        const config = {
            type: 'equirectangular',
            panorama: url,
            crossOrigin: 'anonymous',
            autoLoad: true,
            autoRotate: false,
            showControls: true,
            showFullscreenCtrl: true,
            showZoomCtrl: true,
            mouseZoom: true,
            keyboardZoom: true,
            doubleClickZoom: false,
            compass: false,
            hfov: 100,
            pitch: initialPitch,
            yaw: initialYaw,
            hotSpots: hotspots,
            hotSpotDebug: false,
            onClickHotSpot: function(hs) {
                FAR._onPanoramaHotspotClick(hs);
                return false;
            }
        };

        FAR._panoViewer = window.pannellum.viewer('panoramaCanvas', config);

        FAR._panoViewer.on('load', function() {
            loading.classList.add('hidden');
            FAR.setStatus('🌐 Панорама загружена: ' + item.name);
            FAR._panoUpdateFooter();
        });

        FAR._panoViewer.on('error', function(msg) {
            loading.classList.add('hidden');
            FAR.toast('Ошибка панорамы: ' + msg, 'error');
        });

    } catch (e) {
        console.error('openPanoramaViewer:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось открыть панораму: ' + e.message, 'error');
    }
};

FAR._onPanoramaHotspotClick = async function(hs) {
    if (!hs) return;

    const loading = document.getElementById('panoramaLoading');
    const loadingText = document.getElementById('panoramaLoadingText');
    loading.classList.remove('hidden');

    // === ВАРИАНТ 1: источник — PouchDB ===
    if (hs.source === 'db' && hs.dbPath) {
        loadingText.textContent = 'Загрузка из БД: ' + hs.dbPath;

        try {
            const item = FAR._findDbImageByPath(hs.dbPath);
            if (!item) throw new Error('Файл не найден: ' + hs.dbPath);

            FAR._panoCurrentItem = item;
            FAR._panoCurrentHotspots = [];

            const { data, contentType } = await FAR.readFileBody(item);
            const blob = new Blob([data], { type: contentType || 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            FAR._panoBlobUrls.push(url);
            FAR._panoCurrentUrl = url;

            const jsonData = await FAR._findPanoramaJson(item);
            const hotspots = FAR._jsonToPannellumHotspots(jsonData, '', url);
            FAR._panoCurrentHotspots = jsonData && Array.isArray(jsonData.hotSpots)
                ? jsonData.hotSpots.slice()
                : [];

            document.getElementById('panoramaViewerTitle').textContent = '🌐 ' + item.name;

            const dims = await FAR._measureImage(url);
            const info = document.getElementById('panoramaViewerInfo');
            if (dims) info.textContent = `📐 ${dims.width}×${dims.height} (${FAR.formatSize(data.length)})`;

            if (FAR._panoViewer) {
                try { FAR._panoViewer.destroy(); } catch (e) {}
                FAR._panoViewer = null;
            }
            document.getElementById('panoramaCanvas').innerHTML = '';

            const config = {
                type: 'equirectangular',
                panorama: url,
                crossOrigin: 'anonymous',
                autoLoad: true,
                autoRotate: false,
                showControls: true,
                showFullscreenCtrl: true,
                showZoomCtrl: true,
                mouseZoom: true,
                keyboardZoom: true,
                doubleClickZoom: false,
                compass: false,
                hfov: 100,
                pitch: hs.point_pitch !== undefined ? hs.point_pitch : 0,
                yaw: hs.point_yaw !== undefined ? hs.point_yaw : 0,
                hotSpots: hotspots,
                onClickHotSpot: function(hs2) {
                    FAR._onPanoramaHotspotClick(hs2);
                    return false;
                }
            };

            FAR._panoViewer = window.pannellum.viewer('panoramaCanvas', config);
            FAR._panoViewer.on('load', function() {
                loading.classList.add('hidden');
                FAR.setStatus('🌐 Панорама: ' + item.name);
            });
            FAR._panoViewer.on('error', function(msg) {
                loading.classList.add('hidden');
                FAR.toast('Ошибка панорамы: ' + msg, 'error');
            });

            return;
        } catch (e) {
            console.error('DB hotspot click:', e);
            loading.classList.add('hidden');
            FAR.toast('Переход не выполнен: ' + e.message, 'error');
            return;
        }
    }

    // === ВАРИАНТ 2: URL (поиск файла в БД по panorama_url) ===
    if (!hs.panorama_url) {
        loading.classList.add('hidden');
        FAR.toast('У хотспота не задан panorama_url', 'warning');
        return;
    }

    loadingText.textContent = 'Переход: ' + hs.panorama_url;

    try {
        const normTarget = FAR.normPath(hs.panorama_url);
        let targetItem = FAR.fileIndex.find(f =>
            f.docType === 'file' && FAR.normPath(f.path) === normTarget
        );

        if (!targetItem && FAR._panoCurrentItem) {
            const curPath = FAR.normPath(FAR._panoCurrentItem.path);
            const curDir = curPath.includes('/')
                ? curPath.substring(0, curPath.lastIndexOf('/'))
                : '';
            const altPath = FAR.normPath((curDir ? curDir + '/' : '') +
                hs.panorama_url.replace(/^.*?([^/]+\/[^/]+)$/, '$1'));
            targetItem = FAR.fileIndex.find(f =>
                f.docType === 'file' && FAR.normPath(f.path) === altPath
            );
        }

        if (!targetItem) {
            throw new Error('Файл панорамы не найден в БД: ' + hs.panorama_url);
        }

        FAR._panoCurrentItem = targetItem;
        FAR._panoCurrentHotspots = [];

        const { data, contentType } = await FAR.readFileBody(targetItem);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR._panoBlobUrls.push(url);
        FAR._panoCurrentUrl = url;

        const jsonData = await FAR._findPanoramaJson(targetItem);
        const hotspots = FAR._jsonToPannellumHotspots(jsonData, '', url);
        FAR._panoCurrentHotspots = jsonData && Array.isArray(jsonData.hotSpots)
            ? jsonData.hotSpots.slice()
            : [];

        document.getElementById('panoramaViewerTitle').textContent = '🌐 ' + targetItem.name;

        const dims = await FAR._measureImage(url);
        const info = document.getElementById('panoramaViewerInfo');
        if (dims) info.textContent = `📐 ${dims.width}×${dims.height} (${FAR.formatSize(data.length)})`;

        if (FAR._panoViewer) {
            try { FAR._panoViewer.destroy(); } catch (e) {}
            FAR._panoViewer = null;
        }
        document.getElementById('panoramaCanvas').innerHTML = '';

        const config = {
            type: 'equirectangular',
            panorama: url,
            crossOrigin: 'anonymous',
            autoLoad: true,
            autoRotate: false,
            showControls: true,
            showFullscreenCtrl: true,
            showZoomCtrl: true,
            mouseZoom: true,
            keyboardZoom: true,
            doubleClickZoom: false,
            compass: false,
            hfov: 100,
            pitch: hs.point_pitch !== undefined ? hs.point_pitch : 0,
            yaw: hs.point_yaw !== undefined ? hs.point_yaw : 0,
            hotSpots: hotspots,
            onClickHotSpot: function(hs2) {
                FAR._onPanoramaHotspotClick(hs2);
                return false;
            }
        };

        FAR._panoViewer = window.pannellum.viewer('panoramaCanvas', config);
        FAR._panoViewer.on('load', function() {
            loading.classList.add('hidden');
            FAR.setStatus('🌐 Панорама: ' + targetItem.name);
        });
        FAR._panoViewer.on('error', function(msg) {
            loading.classList.add('hidden');
            FAR.toast('Ошибка панорамы: ' + msg, 'error');
        });

    } catch (e) {
        console.error('hotspot click:', e);
        loading.classList.add('hidden');
        FAR.toast('Переход не выполнен: ' + e.message, 'error');
    }
};

FAR.closePanoramaViewer = function() {
    const modal = document.getElementById('panoramaViewerModal');
    if (modal) modal.classList.add('hidden');

    if (FAR._panoViewer) {
        try { FAR._panoViewer.destroy(); } catch (e) {}
        FAR._panoViewer = null;
    }

    FAR._panoBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._panoBlobUrls = [];

    document.getElementById('panoramaCanvas').innerHTML = '';
    FAR._panoCurrentItem = null;
    FAR._panoCurrentUrl = null;
    FAR._panoCurrentHotspots = [];
};

FAR.closePanoramaViewerOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closePanoramaViewer();
};

FAR.downloadCurrentPanorama = async function() {
    if (!FAR._panoCurrentItem) {
        FAR.toast('Нет активной панорамы', 'warning');
        return;
    }
    try {
        const { data, contentType } = await FAR.readFileBody(FAR._panoCurrentItem);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        FAR.saveBlobAs(blob, FAR.sanitizeFileName(FAR._panoCurrentItem.name));
        FAR.toast('Панорама сохранена', 'success');
    } catch (e) {
        FAR.toast('Ошибка скачивания: ' + e.message, 'error');
    }
};

FAR._panoUpdateFooter = function() {
    const footer = document.querySelector('#panoramaViewerModal .modal-footer');
    if (!footer) return;

    const old = footer.querySelector('.pano-modal-footer-btn');
    if (old) old.remove();

    const btn = document.createElement('button');
    btn.className = 'pano-modal-footer-btn';
    btn.textContent = '✏️ Редактор точек';
    btn.onclick = function() {
        FAR.openPanoramaEditor();
    };

    const downloadBtn = footer.querySelector('button:last-child');
    if (downloadBtn && downloadBtn !== btn) {
        footer.insertBefore(btn, downloadBtn);
    } else {
        footer.appendChild(btn);
    }
};