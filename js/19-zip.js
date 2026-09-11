FAR.downloadSelectedAsZip = async function() {
    if (!FAR.ensureDb()) return;
    const selected = FAR.getSelectedItemsFromActivePanel();
    if (selected.length === 0) { FAR.toast('Ничего не выбрано', 'warning'); return; }

    const toZip = [];
    for (const sel of selected) {
        const item = sel.item;
        if (item.isFolder) {
            const prefix = item.path + '/';
            const children = FAR.fileIndex.filter(f =>
                f.docType === 'file' && f.path.startsWith(prefix)
            );
            const folderName = FAR.sanitizeFileName(item.name || item.path.split('/').pop());
            for (const child of children) {
                const relPath = child.path.substring(prefix.length);
                const zipPath = folderName + '/' + relPath.split('/').map(FAR.sanitizeFileName).join('/');
                toZip.push({ zipPath, item: child });
            }
        } else {
            toZip.push({ zipPath: FAR.sanitizeFileName(item.name), item });
        }
    }

    if (toZip.length === 0) { FAR.toast('Нет файлов для архивации', 'warning'); return; }

    const zipName = selected.length === 1 && selected[0].item.isFolder
        ? FAR.sanitizeFileName(selected[0].item.name) + '.zip'
        : 'files.zip';

    FAR.startProgress('🗜️', `Упаковка ${toZip.length} файлов в ${zipName}`, toZip.length, function() {});

    let ok = 0, err = 0;
    const zip = new JSZip();

    for (let i = 0; i < toZip.length; i++) {
        if (FAR.progress.cancelled) break;
        const zipPath = toZip[i].zipPath;
        const item = toZip[i].item;
        FAR.updateProgress(i, toZip.length, zipPath, err);
        FAR.progressLog(`🗜️ + ${zipPath}`, 'info');
        try {
            const res = await FAR.readFileBody(item);
            zip.file(zipPath, res.data, {
                binary: true,
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });
            ok++;
            FAR.progressLog(`✅ ${zipPath} (${FAR.formatSize(res.data.length)})`, 'ok');
        } catch (e) {
            err++;
            FAR.progressLog(`❌ ${zipPath}: ${e.message}`, 'err');
        }
        FAR.updateProgress(i + 1, toZip.length, zipPath, err);
    }

    if (ok === 0) {
        FAR.finishProgress(err);
        FAR.progressLog(`━━━ Нечего сохранять`, 'err');
        FAR.setStatus('❌ Архив пуст');
        FAR.toast('Архив пуст', 'error');
        return;
    }

    FAR.progressLog(`📦 Генерация архива…`, 'info');
    document.getElementById('progressCurrent').textContent = 'Генерация архива…';

    try {
        const blob = await zip.generateAsync(
            {
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            },
            function(metadata) {
                const pct = Math.round(metadata.percent);
                document.getElementById('progressPercent').textContent = pct + '%';
                document.getElementById('progressFill').style.width = pct + '%';
                document.getElementById('miniPercent').textContent = pct + '%';
                document.getElementById('miniFill').style.width = pct + '%';
                document.getElementById('progressCurrent').textContent =
                    `Генерация архива… ${pct}%`;
            }
        );

        FAR.saveBlobAs(blob, zipName);
        FAR.progressLog(`✅ ${zipName} (${FAR.formatSize(blob.size)})`, 'ok');
        FAR.progressLog(`━━━ Готово: ${ok} файлов упаковано, ${err} ошибок`, ok > 0 ? 'ok' : 'err');

        FAR.finishProgress(err);
        FAR.setStatus(`✅ Архив ${zipName}: ${ok} файлов`);
        FAR.toast(`Архив ${zipName} сохранён`, 'success');
    } catch (e) {
        FAR.progressLog(`❌ Ошибка генерации архива: ${e.message}`, 'err');
        FAR.finishProgress(err + 1);
        FAR.setStatus('❌ Ошибка архива');
        FAR.toast('Ошибка генерации архива: ' + e.message, 'error');
    }
};