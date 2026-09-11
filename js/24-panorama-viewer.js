// ============================================================
// Просмотр панорам 360° через Pannellum в модальном окне
// ============================================================

FAR._panoViewer = null;               // Текущий инстанс Pannellum
FAR._panoCurrentItem = null;          // Текущий элемент fileIndex (для скачивания)
FAR._panoCurrentUrl = null;           // URL текущей панорамы (blob или внешний)
FAR._panoBlobUrls = [];               // Список созданных Blob URL для очистки

// Порог соотношения сторон (2:1)
FAR.PANO_ASPECT_MIN = 1.9;
FAR.PANO_ASPECT_MAX = 2.1;

/**
 * Проверка, является ли файл панорамой 360°.
 * Основной критерий: соотношение сторон ~2:1 (например, 7744x3872).
 */
FAR.isPanorama = async function(item) {
    if (!item || item.isFolder) return false;

    // 1. Расширение файла должно быть изображением
    const ext = (item.name.split('.').pop() || '').toLowerCase();
    const imgExts = ['jpg', 'jpeg', 'png', 'webp'];
    if (!imgExts.includes(ext)) return false;

    // 2. Быстрая проверка по имени (часто панорамы имеют специальные префиксы)
    //    Но НЕ используем как единственный критерий — только как ранний return true.
    //    Основной критерий — размеры.

    // 3. Если известны размеры из fileIndex — используем их
    if (item.width && item.height) {
        const ratio = item.width / item.height;
        return ratio >= FAR.PANO_ASPECT_MIN && ratio <= FAR.PANO_ASPECT_MAX;
    }

    // 4. Иначе — загружаем изображение и измеряем
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

/**
 * Измеряет размеры изображения по URL.
 */
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

/**
 * Ищет JSON с хотспотами для панорамы.
 * Сначала — в БД (f:путь/имя.json), потом — рядом с файлом.
 */
FAR._findPanoramaJson = async function(item) {
    const baseName = item.name.replace(/\.[^/.]+$/, '');
    const dir = item.path.includes('/')
        ? item.path.substring(0, item.path.lastIndexOf('/'))
        : '';
    const jsonPath = dir ? dir + '/' + baseName + '.json' : baseName + '.json';

    // 1. Ищем в fileIndex
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

    // 2. Пробуем через fetch (если это внешний URL или сервер отдаёт статику)
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

/**
 * Преобразует JSON с хотспотами FileBD в конфиг Pannellum.
 */
FAR._jsonToPannellumHotspots = function(jsonData, basePath, fallbackImageUrl) {
    const result = [];
    if (!jsonData || !Array.isArray(jsonData.hotSpots)) return result;

    jsonData.hotSpots.forEach(function(hs) {
        // panorama_url в JSON — относительный путь к целевой панораме
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
            // Специальные поля для нашей навигации:
            panorama_url: fullUrl,
            relativePath: relUrl,
            point_pitch: hs.targetPitch || 0,
            point_yaw: hs.targetYaw || 0,
            targetHfov: hs.targetHfov || 100,
            id: hs.id
        });
    });

    return result;
};

/**
 * Открывает панораму в модалке.
 */
FAR.openPanoramaViewer = async function(item) {
    if (!FAR.ensureDb()) return;

    // Закрываем обычный просмотрщик, если открыт
    FAR.closeViewer();

    FAR._panoCurrentItem = item;
    FAR._panoBlobUrls.forEach(function(u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    FAR._panoBlobUrls = [];

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

    // Уничтожаем старый viewer
    if (FAR._panoViewer) {
        try { FAR._panoViewer.destroy(); } catch (e) {}
        FAR._panoViewer = null;
    }

    const canvasEl = document.getElementById('panoramaCanvas');
    canvasEl.innerHTML = '';

    try {
        // Загружаем данные файла
        const { data, contentType } = await FAR.readFileBody(item);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR._panoBlobUrls.push(url);
        FAR._panoCurrentUrl = url;

        // Измеряем размеры
        const dims = await FAR._measureImage(url);
        if (dims) {
            info.textContent = `📐 ${dims.width}×${dims.height} (${FAR.formatSize(data.length)})`;
        } else {
            info.textContent = `📁 ${FAR.formatSize(data.length)}`;
        }

        // Ищем JSON с хотспотами
        const basePath = item.path.includes('/')
            ? item.path.substring(0, item.path.lastIndexOf('/'))
            : '';
        const jsonData = await FAR._findPanoramaJson(item);
        const hotspots = FAR._jsonToPannellumHotspots(jsonData, basePath, url);

        // Углы камеры из JSON
        const initialPitch = jsonData && jsonData.pitchCam !== undefined
            ? jsonData.pitchCam
            : 0;
        const initialYaw = jsonData && jsonData.yawCam !== undefined
            ? jsonData.yawCam
            : 0;

        // Создаём Pannellum
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
            // Колбэк клика по хотспоту — переход на другую сцену
            onClickHotSpot: function(hs) {
                FAR._onPanoramaHotspotClick(hs);
                return false; // не даём Pannellum обрабатывать самому
            }
        };

        FAR._panoViewer = window.pannellum.viewer('panoramaCanvas', config);

        FAR._panoViewer.on('load', function() {
            loading.classList.add('hidden');
            FAR.setStatus('🌐 Панорама загружена: ' + item.name);
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

/**
 * Клик по хотспоту в панораме — переход на новую сцену.
 */
FAR._onPanoramaHotspotClick = async function(hs) {
    if (!hs || !hs.panorama_url) {
        FAR.toast('У хотспота не задан panorama_url', 'warning');
        return;
    }

    const loading = document.getElementById('panoramaLoading');
    const loadingText = document.getElementById('panoramaLoadingText');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Переход: ' + hs.panorama_url;

    try {
        // Ищем файл панорамы в БД по пути
        const normTarget = FAR.normPath(hs.panorama_url);
        let targetItem = FAR.fileIndex.find(f =>
            f.docType === 'file' && FAR.normPath(f.path) === normTarget
        );

        // Если не нашли — возможно, panorama_url содержит полный путь с basePath.
        // Пробуем отрезать basePath и найти по «хвосту».
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

        // Загружаем данные
        const { data, contentType } = await FAR.readFileBody(targetItem);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR._panoBlobUrls.push(url);
        FAR._panoCurrentUrl = url;
        FAR._panoCurrentItem = targetItem;

        // Ищем JSON для новой сцены
        const basePath = targetItem.path.includes('/')
            ? targetItem.path.substring(0, targetItem.path.lastIndexOf('/'))
            : '';
        const jsonData = await FAR._findPanoramaJson(targetItem);
        const hotspots = FAR._jsonToPannellumHotspots(jsonData, basePath, url);

        // Обновляем заголовок
        document.getElementById('panoramaViewerTitle').textContent = '🌐 ' + targetItem.name;

        // Обновляем информацию
        const dims = await FAR._measureImage(url);
        const info = document.getElementById('panoramaViewerInfo');
        if (dims) info.textContent = `📐 ${dims.width}×${dims.height} (${FAR.formatSize(data.length)})`;

        // Пересоздаём viewer (проще и надёжнее, чем менять сцену на лету)
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
            // Стартовые углы — из хотспота, которым сюда пришли
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

/**
 * Закрывает модалку панорамы.
 */
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
};

FAR.closePanoramaViewerOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closePanoramaViewer();
};

/**
 * Скачивает оригинал текущей панорамы.
 */
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