// ============================================================
// Редактор точек перехода для панорам (поверх FileBD)
// ============================================================

FAR.peState = {
    hotspots: [],
    editingIndex: -1,
    currentCoords: null,
    previewViewer: null,
    previewBlobUrl: null,
    previewItem: null,
    _bound: false
};

// ============================================================
// Открытие/закрытие редактора
// ============================================================

FAR.openPanoramaEditor = async function() {
    if (!FAR._panoCurrentItem) {
        FAR.toast('Сначала откройте панораму', 'warning');
        return;
    }

    FAR.peState.hotspots = (FAR._panoCurrentHotspots || []).slice();
    FAR.peState.editingIndex = -1;
    FAR.peState.currentCoords = {
        pitch: FAR._panoViewer ? FAR._panoViewer.getPitch() : 0,
        yaw: FAR._panoViewer ? FAR._panoViewer.getYaw() : 0
    };

    const modal = document.getElementById('panoramaEditorModal');
    modal.classList.remove('hidden');

    document.getElementById('panoEditorTitle').textContent =
        '✏️ Точки: ' + FAR._panoCurrentItem.name;
    document.getElementById('peFooterInfo').textContent =
        'Файл: ' + FAR._panoCurrentItem.path;

    FAR.peResetForm();
    FAR.peRenderHotspotsList();
    FAR.peBindHandlersOnce();
};

FAR.closePanoramaEditor = function() {
    const modal = document.getElementById('panoramaEditorModal');
    if (modal) modal.classList.add('hidden');

    if (FAR.peState.previewViewer) {
        try { FAR.peState.previewViewer.destroy(); } catch (e) {}
        FAR.peState.previewViewer = null;
    }
    if (FAR.peState.previewBlobUrl) {
        try { URL.revokeObjectURL(FAR.peState.previewBlobUrl); } catch (e) {}
        FAR.peState.previewBlobUrl = null;
    }
    FAR.peState.previewItem = null;

    document.getElementById('pePreviewWrapper').classList.remove('loaded');
    document.getElementById('pePreviewCanvas').innerHTML = '';
    document.getElementById('pePreviewInfo').textContent = '';
};

FAR.closePanoramaEditorOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closePanoramaEditor();
};

FAR.peBindHandlersOnce = function() {
    if (FAR.peState._bound) return;
    FAR.peState._bound = true;

    const fileInput = document.getElementById('peJsonFileInput');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            FAR.peHandleJsonFile(e);
        });
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const ed = document.getElementById('panoramaEditorModal');
            if (ed && !ed.classList.contains('hidden')) {
                // Если открыт db-picker — сначала его закроем (у него свой обработчик)
                const picker = document.getElementById('dbPickerModal');
                if (picker && !picker.classList.contains('hidden')) return;
                FAR.closePanoramaEditor();
                e.stopPropagation();
            }
        }
    }, true);
};

// ============================================================
// Форма
// ============================================================

FAR.peResetForm = function() {
    document.getElementById('peName').value = '';
    document.getElementById('peType').value = 'scene';
    document.getElementById('peText').value = '';
    document.getElementById('peYaw').value = FAR.peState.currentCoords ?
        FAR.peState.currentCoords.yaw.toFixed(2) : '0';
    document.getElementById('pePitch').value = FAR.peState.currentCoords ?
        FAR.peState.currentCoords.pitch.toFixed(2) : '0';
    document.getElementById('peDbPath').value = '';
    document.getElementById('peUrl').value = '';
    document.getElementById('peTargetYaw').value = '0';
    document.getElementById('peTargetPitch').value = '0';

    FAR.peState.editingIndex = -1;
    FAR.peClearPreview();
};

FAR.peClearPreview = function() {
    document.getElementById('pePreviewWrapper').classList.remove('loaded');
    document.getElementById('pePreviewCanvas').innerHTML = '';
    document.getElementById('pePreviewInfo').textContent = '';
    if (FAR.peState.previewViewer) {
        try { FAR.peState.previewViewer.destroy(); } catch (e) {}
        FAR.peState.previewViewer = null;
    }
    if (FAR.peState.previewBlobUrl) {
        try { URL.revokeObjectURL(FAR.peState.previewBlobUrl); } catch (e) {}
        FAR.peState.previewBlobUrl = null;
    }
    FAR.peState.previewItem = null;
};

// ============================================================
// Обзор файла в БД через новую модалку
// ============================================================

FAR.peBrowseDb = function() {
    FAR.openDbPicker(function(path) {
        // callback: путь подставлен в peDbPath, сразу грузим превью
        FAR.peLoadPreview();
    });
};

// ============================================================
// Предпросмотр целевой сцены
// ============================================================

FAR.peLoadPreview = async function() {
    if (!FAR.ensureDb()) return;

    const dbPath = document.getElementById('peDbPath').value.trim();
    const url = document.getElementById('peUrl').value.trim();

    if (!dbPath && !url) {
        FAR.toast('Укажите путь в БД или URL', 'warning');
        return;
    }

    const wrapper = document.getElementById('pePreviewWrapper');
    const canvas = document.getElementById('pePreviewCanvas');
    const info = document.getElementById('pePreviewInfo');

    FAR.peClearPreview();

    try {
        let imageUrl = '';
        let itemForTarget = null;

        if (dbPath) {
            const norm = FAR.normPath(dbPath);
            itemForTarget = FAR._findDbImageByPath(norm);
            if (!itemForTarget) {
                throw new Error('Файл не найден в БД: ' + dbPath);
            }
            const { data, contentType } = await FAR.readFileBody(itemForTarget);
            const blob = new Blob([data], { type: contentType || 'image/jpeg' });
            imageUrl = URL.createObjectURL(blob);
            FAR.peState.previewBlobUrl = imageUrl;
            FAR.peState.previewItem = itemForTarget;
            info.textContent = itemForTarget.path;
        } else {
            imageUrl = url;
            info.textContent = url;
        }

        let targetHotspots = [];
        if (itemForTarget) {
            try {
                const jsonData = await FAR._findPanoramaJson(itemForTarget);
                if (jsonData && Array.isArray(jsonData.hotSpots)) {
                    targetHotspots = FAR._jsonToPannellumHotspots(jsonData, '', imageUrl);
                }
            } catch (e) { /* ignore */ }
        }

        const config = {
            type: 'equirectangular',
            panorama: imageUrl,
            crossOrigin: 'anonymous',
            autoLoad: true,
            autoRotate: false,
            showControls: true,
            showFullscreenCtrl: false,
            showZoomCtrl: true,
            mouseZoom: true,
            keyboardZoom: false,
            doubleClickZoom: false,
            compass: false,
            hfov: 100,
            pitch: 0,
            yaw: 0,
            hotSpots: targetHotspots,
            onDblClick: function(coords) {
                document.getElementById('peTargetPitch').value = coords.pitch.toFixed(2);
                document.getElementById('peTargetYaw').value = coords.yaw.toFixed(2);
                FAR.toast('Направление: Pitch=' + coords.pitch.toFixed(1) +
                          ', Yaw=' + coords.yaw.toFixed(1), 'info');
            }
        };

        FAR.peState.previewViewer = window.pannellum.viewer('pePreviewCanvas', config);
        wrapper.classList.add('loaded');

    } catch (e) {
        console.error('peLoadPreview:', e);
        FAR.toast('Не удалось загрузить предпросмотр: ' + e.message, 'error');
        document.getElementById('pePreviewPlaceholder').textContent =
            'Ошибка: ' + e.message;
    }
};

// ============================================================
// Сохранение хотспота
// ============================================================

FAR.peSaveHotspot = async function() {
    if (!FAR._panoCurrentItem) {
        FAR.toast('Нет активной панорамы', 'warning');
        return;
    }

    const name = document.getElementById('peName').value.trim() || 'Без имени';
    const type = document.getElementById('peType').value;
    const text = document.getElementById('peText').value.trim() || 'Точка перехода';
    const yaw = parseFloat(document.getElementById('peYaw').value) || 0;
    const pitch = parseFloat(document.getElementById('pePitch').value) || 0;
    const dbPath = document.getElementById('peDbPath').value.trim();
    const url = document.getElementById('peUrl').value.trim();
    const targetYaw = parseFloat(document.getElementById('peTargetYaw').value) || 0;
    const targetPitch = parseFloat(document.getElementById('peTargetPitch').value) || 0;

    if (!dbPath && !url) {
        FAR.toast('Укажите путь в БД или URL', 'warning');
        return;
    }

    let panoramaUrl = '';
    let source = 'url';
    let finalDbPath = '';

    if (dbPath) {
        source = 'db';
        finalDbPath = dbPath.startsWith('/') ? dbPath : '/' + dbPath;
        panoramaUrl = finalDbPath.replace(/^\/+/, '');
    } else {
        source = 'url';
        panoramaUrl = url;
    }

    const hs = {
        id: Date.now(),
        name: name,
        type: type,
        text: text,
        pitch: pitch,
        yaw: yaw,
        targetPitch: targetPitch,
        targetYaw: targetYaw,
        source: source,
        dbPath: finalDbPath,
        panorama_url: panoramaUrl,
        path: '',
        createdAt: new Date().toISOString()
    };

    if (FAR.peState.editingIndex >= 0) {
        hs.id = FAR.peState.hotspots[FAR.peState.editingIndex].id || hs.id;
        FAR.peState.hotspots[FAR.peState.editingIndex] = hs;
        FAR.toast('Точка обновлена', 'success');
    } else {
        FAR.peState.hotspots.push(hs);
        FAR.toast('Точка добавлена', 'success');
    }

    FAR.peState.editingIndex = -1;
    FAR.peRenderHotspotsList();
    await FAR.peApplyHotspotsToScene();
    FAR.peResetForm();
};

FAR.peApplyHotspotsToScene = async function() {
    if (!FAR._panoCurrentItem) return;
    FAR._panoCurrentHotspots = FAR.peState.hotspots.slice();
    await FAR._panoReloadWithHotspots(FAR._panoCurrentItem, FAR.peState.hotspots);
};

FAR._panoReloadWithHotspots = async function(item, hotspots) {
    const loading = document.getElementById('panoramaLoading');
    const loadingText = document.getElementById('panoramaLoadingText');
    loading.classList.remove('hidden');
    loadingText.textContent = 'Обновление сцены…';

    // Запоминаем текущую камеру
    let savedPitch = 0, savedYaw = 0, savedHfov = 100;
    try {
        if (FAR._panoViewer) {
            savedPitch = FAR._panoViewer.getPitch();
            savedYaw = FAR._panoViewer.getYaw();
            savedHfov = FAR._panoViewer.getHfov();
        }
    } catch (e) {}

    try {
        if (FAR._panoViewer) {
            try { FAR._panoViewer.destroy(); } catch (e) {}
            FAR._panoViewer = null;
        }
        document.getElementById('panoramaCanvas').innerHTML = '';

        const { data, contentType } = await FAR.readFileBody(item);
        const blob = new Blob([data], { type: contentType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        FAR._panoBlobUrls.push(url);
        FAR._panoCurrentUrl = url;

        const pannellumHotspots = hotspots.map(function(hs) {
            return {
                pitch: hs.pitch || 0,
                yaw: hs.yaw || 0,
                type: hs.type || 'scene',
                text: hs.text || hs.name || 'Переход',
                source: hs.source || 'url',
                dbPath: hs.dbPath || '',
                panorama_url: hs.panorama_url || '',
                point_pitch: hs.targetPitch || 0,
                point_yaw: hs.targetYaw || 0,
                id: hs.id
            };
        });

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
            hfov: savedHfov,
            pitch: savedPitch,
            yaw: savedYaw,
            hotSpots: pannellumHotspots,
            onClickHotSpot: function(hs) {
                FAR._onPanoramaHotspotClick(hs);
                return false;
            }
        };

        FAR._panoViewer = window.pannellum.viewer('panoramaCanvas', config);
        FAR._panoViewer.on('load', function() {
            loading.classList.add('hidden');
        });
        FAR._panoViewer.on('error', function(msg) {
            loading.classList.add('hidden');
            FAR.toast('Ошибка: ' + msg, 'error');
        });

    } catch (e) {
        console.error('_panoReloadWithHotspots:', e);
        loading.classList.add('hidden');
        FAR.toast('Не удалось обновить: ' + e.message, 'error');
    }
};

// ============================================================
// Список хотспотов в редакторе
// ============================================================

FAR.peRenderHotspotsList = function() {
    const container = document.getElementById('peHotspotsList');
    if (!container) return;
    container.innerHTML = '';

    if (FAR.peState.hotspots.length === 0) {
        container.innerHTML = '<p class="pe-empty">Нет созданных точек</p>';
        return;
    }

    FAR.peState.hotspots.forEach(function(hs, idx) {
        const item = document.createElement('div');
        item.className = 'pe-hotspot-item';

        const targetLabel = hs.source === 'db'
            ? 'DB: ' + FAR.escapeHtml(hs.dbPath || hs.panorama_url)
            : 'URL: ' + FAR.escapeHtml(hs.panorama_url);

        item.innerHTML =
            '<div class="pe-hs-info">' +
                '<div class="pe-hs-name">' + FAR.escapeHtml(hs.name) + '</div>' +
                '<div class="pe-hs-detail">' +
                    'Yaw: ' + (hs.yaw || 0).toFixed(2) +
                    ' Pitch: ' + (hs.pitch || 0).toFixed(2) + '<br>' +
                    '→ Yaw: ' + (hs.targetYaw || 0).toFixed(2) +
                    ' Pitch: ' + (hs.targetPitch || 0).toFixed(2) + '<br>' +
                    FAR.escapeHtml(targetLabel) +
                '</div>' +
            '</div>' +
            '<div class="pe-hs-actions">' +
                '<button class="edit" title="Редактировать" data-idx="' + idx + '">✏️</button>' +
                '<button class="delete" title="Удалить" data-idx="' + idx + '">🗑️</button>' +
            '</div>';

        item.querySelector('.edit').addEventListener('click', function() {
            FAR.peEditHotspot(idx);
        });
        item.querySelector('.delete').addEventListener('click', function() {
            FAR.peDeleteHotspot(idx);
        });

        container.appendChild(item);
    });
};

FAR.peEditHotspot = function(idx) {
    const hs = FAR.peState.hotspots[idx];
    if (!hs) return;

    FAR.peState.editingIndex = idx;

    document.getElementById('peName').value = hs.name || '';
    document.getElementById('peType').value = hs.type || 'scene';
    document.getElementById('peText').value = hs.text || '';
    document.getElementById('peYaw').value = (hs.yaw || 0).toFixed(2);
    document.getElementById('pePitch').value = (hs.pitch || 0).toFixed(2);
    document.getElementById('peDbPath').value = hs.dbPath || '';
    document.getElementById('peUrl').value = hs.source === 'url' ? (hs.panorama_url || '') : '';
    document.getElementById('peTargetYaw').value = (hs.targetYaw || 0).toFixed(2);
    document.getElementById('peTargetPitch').value = (hs.targetPitch || 0).toFixed(2);

    FAR.toast('Редактирование: ' + hs.name, 'info');
};

FAR.peDeleteHotspot = function(idx) {
    if (!confirm('Удалить точку "' + FAR.peState.hotspots[idx].name + '"?')) return;
    FAR.peState.hotspots.splice(idx, 1);
    FAR.peRenderHotspotsList();
    FAR.peApplyHotspotsToScene();
};

// ============================================================
// Экспорт JSON
// ============================================================

FAR.peExportJson = async function() {
    if (FAR.peState.hotspots.length === 0) {
        FAR.toast('Нет точек для экспорта', 'warning');
        return;
    }

    let pitchCam = 0, yawCam = 0;
    try {
        if (FAR._panoViewer) {
            pitchCam = FAR._panoViewer.getPitch();
            yawCam = FAR._panoViewer.getYaw();
        }
    } catch (e) {}

    const jsonData = {
        pitchCam: parseFloat(pitchCam.toFixed(12)),
        yawCam: parseFloat(yawCam.toFixed(12)),
        hotSpots: FAR.peState.hotspots.map(function(h) {
            return {
                id: h.id,
                name: h.name,
                type: h.type,
                text: h.text,
                pitch: parseFloat(h.pitch.toFixed(12)),
                yaw: parseFloat(h.yaw.toFixed(12)),
                targetPitch: parseFloat((h.targetPitch || 0).toFixed(12)),
                targetYaw: parseFloat((h.targetYaw || 0).toFixed(12)),
                source: h.source || 'url',
                dbPath: h.dbPath || '',
                panorama_url: h.panorama_url || '',
                path: h.path || '',
                createdAt: h.createdAt
            };
        })
    };

    const jsonString = JSON.stringify(jsonData, null, 2);

    const dbPath = document.getElementById('peDbPath').value.trim();
    const urlInput = document.getElementById('peUrl').value.trim();

    // === ВАРИАНТ 1: работаем с БД — сохраняем/перезаписываем файл на сервере (в PouchDB) ===
    if (dbPath && !urlInput) {
        try {
            await FAR.peSaveJsonToDb(jsonData, dbPath);
            FAR.toast('JSON сохранён в БД', 'success');
        } catch (e) {
            console.error('peSaveJsonToDb:', e);
            FAR.toast('Не удалось сохранить JSON в БД: ' + e.message, 'error');
        }
        return;
    }

    // === ВАРИАНТ 2: внешний URL — скачиваем локально, как раньше ===
    const baseName = FAR._panoCurrentItem
        ? FAR._panoCurrentItem.name.replace(/\.[^/.]+$/, '')
        : 'panorama';
    const fileName = baseName + '.json';

    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);

    FAR.toast('Экспортировано: ' + fileName, 'success');
};

/**
 * Сохраняет JSON в PouchDB рядом с панорамой.
 * @param {Object} jsonData — объект для сохранения
 * @param {string} dbPath   — путь к панораме (например /img/scene.jpg или img/scene.jpg)
 */
FAR.peSaveJsonToDb = async function(jsonData, dbPath) {
    if (!FAR.db) throw new Error('Нет подключения к БД');

    const jsonString = JSON.stringify(jsonData, null, 2);

    // Извлекаем базовое имя и папку из пути панорамы
    let cleanPath = FAR.normPath(dbPath);
    if (!cleanPath) throw new Error('Пустой путь');

    // Убираем расширение у файла панорамы и добавляем .json
    const jsonPath = cleanPath.replace(/\.[^/.]+$/, '') + '.json';

    // Формируем ID документа
    const docId = 'f:' + encodeURIComponent(jsonPath);

    // Проверяем, существует ли документ — берём _rev для перезаписи
    let rev = null;
    try {
        const existing = await FAR.db.get(docId);
        rev = existing._rev;
    } catch (e) {
        if (e.status !== 404) throw e;
    }

    // Создаём/обновляем документ
    const doc = {
        _id: docId,
        type: 'file',
        path: jsonPath,
        name: jsonPath.split('/').pop(),
        size: new Blob([jsonString]).size,
        mtime: Date.now(),
        binary: false,
        contentType: 'application/json'
    };
    if (rev) doc._rev = rev;

    await FAR.db.put(doc);

    // Прикрепляем содержимое как вложение 'b'
    const fresh = await FAR.db.get(docId);
    const blob = new Blob([jsonString], { type: 'application/json' });
    await FAR.db.putAttachment(docId, 'b', fresh._rev, blob, 'application/json');

    // Обновляем fileIndex
    const existingIdx = FAR.fileIndex.find(f => f._id === docId);
    if (existingIdx) {
        existingIdx.size = doc.size;
        existingIdx.mtime = doc.mtime;
        existingIdx.contentType = 'application/json';
    } else {
        FAR.fileIndex.push({
            _id: docId,
            path: jsonPath,
            size: doc.size,
            mtime: doc.mtime,
            binary: false,
            children: [],
            contentType: 'application/json',
            docType: 'file'
        });
    }

    console.log('JSON сохранён в БД:', jsonPath);
    return jsonPath;
};

// ============================================================
// Импорт JSON (загрузка с компьютера — как было)
// ============================================================

FAR.peImportJson = function() {
    document.getElementById('peJsonFileInput').click();
};

FAR.peHandleJsonFile = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            let arr = [];
            if (data && Array.isArray(data.hotSpots)) arr = data.hotSpots;
            else if (Array.isArray(data)) arr = data;
            else throw new Error('Ожидается поле hotSpots');

            arr = arr.map(function(h) {
                return {
                    id: h.id || Date.now() + Math.random(),
                    name: h.name || 'Без имени',
                    type: h.type || 'scene',
                    text: h.text || 'Переход',
                    pitch: h.pitch || 0,
                    yaw: h.yaw || 0,
                    targetPitch: h.targetPitch || 0,
                    targetYaw: h.targetYaw || 0,
                    source: h.source || (h.dbPath ? 'db' : 'url'),
                    dbPath: h.dbPath || '',
                    panorama_url: h.panorama_url || '',
                    path: h.path || '',
                    createdAt: h.createdAt || new Date().toISOString()
                };
            });

            FAR.peState.hotspots = arr;
            FAR.peRenderHotspotsList();
            FAR.peApplyHotspotsToScene();

            FAR.toast('Импортировано: ' + arr.length + ' точек', 'success');
        } catch (err) {
            FAR.toast('Ошибка импорта: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
};