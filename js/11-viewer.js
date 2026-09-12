FAR.openFile = async function(item) {
    if (!FAR.ensureDb()) return;

    // ===== ПРОВЕРКА 1: JSDOS-файл =====
    try {
        if (typeof FAR.isJsdos === 'function' && FAR.isJsdos(item)) {
            await FAR.openJsdosViewer(item);
            return;
        }
    } catch (e) {
        console.warn('Ошибка проверки JSDOS:', e);
    }

    // ===== ПРОВЕРКА 2: NES-файл =====
    try {
        if (typeof FAR.isNes === 'function' && FAR.isNes(item)) {
            await FAR.openNesViewer(item);
            return;
        }
    } catch (e) {
        console.warn('Ошибка проверки NES:', e);
    }

    // ===== ПРОВЕРКА 3: EmulatorJS-файл =====
    try {
        if (typeof FAR.isEmulatorFile === 'function' && FAR.isEmulatorFile(item)) {
            await FAR.openEmulatorViewer(item);
            return;
        }
    } catch (e) {
        console.warn('Ошибка проверки EmulatorJS:', e);
    }

  // ===== ПРОВЕРКА 4: PDF =====
    try {
        if (typeof FAR.isPdf === 'function' && FAR.isPdf(item)) {
            await FAR.openPdfViewer(item);
            return;
        }
    } catch (e) {
        console.warn('Ошибка проверки PDF:', e);
    }

    // Проверяем, является ли файл панорамой 360°
    // (по соотношению сторон ~2:1)
    try {
        const isPano = await FAR.isPanorama(item);
        if (isPano) {
            await FAR.openPanoramaViewer(item);
            return;
        }
    } catch (e) {
        console.warn('Ошибка проверки на панораму:', e);
    }

    // === Обычный просмотрщик ===
    const modal = document.getElementById('viewerModal');
    const title = document.getElementById('viewerTitle');
    const body  = document.getElementById('viewerBody');
    const info  = document.getElementById('viewerInfo');

    modal.classList.remove('hidden');
    title.textContent = `📄 ${item.name}`;
    body.innerHTML = '<div style="text-align:center;padding:40px;color:#a6adc8;">Загрузка…</div>';
    info.textContent = '';

    try {
        const { data, contentType } = await FAR.readFileBody(item);
        FAR.currentFileData = data;
        FAR.currentFileName = item.name;
        FAR.currentFileType = contentType;

        const ext = (item.name.split('.').pop() || '').toLowerCase();
        const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico'];
        const txtExts = ['txt','md','json','xml','csv','log','html','css','js','py','java','c','cpp','h','ini','cfg','yaml','yml'];

        if (imgExts.includes(ext)) {
            const blob = new Blob([data], {
                type: contentType.startsWith('image/')
                    ? contentType
                    : 'image/' + (ext === 'jpg' ? 'jpeg' : ext)
            });
            const url = URL.createObjectURL(blob);
            body.innerHTML = `<img src="${url}" alt="${FAR.escapeHtml(item.name)}">`;
            info.textContent = `📷 ${FAR.formatSize(data.length)}`;
        } else if (txtExts.includes(ext) || !item.binary) {
            try {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
                body.innerHTML = `<pre>${FAR.escapeHtml(text)}</pre>`;
                info.textContent = `📝 ${FAR.formatSize(data.length)}`;
            } catch (e) {
                body.innerHTML = `<div style="color:#f9e2af;margin-bottom:8px;">Бинарные данные</div><pre>${FAR.hexPreview(data)}</pre>`;
                info.textContent = `📁 ${FAR.formatSize(data.length)}`;
            }
        } else {
            body.innerHTML = `<div style="color:#f9e2af;margin-bottom:8px;">Бинарный файл (${FAR.formatSize(data.length)})</div><pre>${FAR.hexPreview(data)}</pre>`;
            info.textContent = `📁 ${FAR.formatSize(data.length)}`;
        }
    } catch (e) {
        console.error('openFile:', e);
        body.innerHTML = `<div style="color:#f38ba8;">Ошибка: ${FAR.escapeHtml(e.message)}</div>`;
        info.textContent = 'Ошибка';
    }
};

FAR.closeViewer = function() {
    document.getElementById('viewerModal').classList.add('hidden');
    document.getElementById('viewerBody').innerHTML = '';
    FAR.currentFileData = null;
};

FAR.closeViewerOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closeViewer();
};

FAR.downloadCurrentFile = async function() {
    if (!FAR.currentFileData) { FAR.toast('Нет данных', 'warning'); return; }

    FAR.startProgress('📥', `Скачивание "${FAR.currentFileName}" (${FAR.formatSize(FAR.currentFileData.length)})`, 1, function() {});
    FAR.progressLog(`📥 Подготовка ${FAR.currentFileName}`, 'info');
    FAR.updateProgress(0, 1, FAR.currentFileName, 0);

    try {
        const blob = new Blob([FAR.currentFileData], { type: FAR.currentFileType });
        FAR.saveBlobAs(blob, FAR.sanitizeFileName(FAR.currentFileName));

        FAR.updateProgress(1, 1, FAR.currentFileName, 0);
        FAR.progressLog(`✅ ${FAR.currentFileName} — сохранено`, 'ok');
        FAR.finishProgress(0);
        FAR.progressLog(`━━━ Готово`, 'ok');

        FAR.toast('Файл сохранён', 'success');
    } catch (e) {
        FAR.progressLog(`❌ ${FAR.currentFileName}: ${e.message}`, 'err');
        FAR.finishProgress(1);
        FAR.toast('Ошибка скачивания: ' + e.message, 'error');
    }
};