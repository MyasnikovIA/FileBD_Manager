FAR.setupKeyboard = function() {
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (!FAR.progress.active) FAR.closeViewer();
            return;
        }

        if (FAR.progress.active) return;
        if (!FAR.db) return;

        // Не перехватываем навигацию, когда фокус в поле ввода / textarea / contenteditable
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

        // Если открыта модалка подключения — не мешаем
        const connModal = document.getElementById('connModal');
        if (connModal && !connModal.classList.contains('hidden')) return;

        // Если открыт просмотрщик — не перехватываем (Esc обработан выше)
        const viewerModal = document.getElementById('viewerModal');
        if (viewerModal && !viewerModal.classList.contains('hidden')) return;

        const side  = FAR.activePanel;
        const items = side === 'left' ? FAR.leftFiles : FAR.rightFiles;
        const shift = e.shiftKey;

        // --- Навигация курсором ---
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            FAR.moveCursor(side, +1, { shift });
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            FAR.moveCursor(side, -1, { shift });
            return;
        }
        if (e.key === 'PageDown') {
            e.preventDefault();
            FAR.moveCursor(side, +1, { shift, page: true });
            return;
        }
        if (e.key === 'PageUp') {
            e.preventDefault();
            FAR.moveCursor(side, -1, { shift, page: true });
            return;
        }
        if (e.key === 'Home') {
            e.preventDefault();
            FAR.moveCursor(side, 0, { shift, toEdge: 'home' });
            return;
        }
        if (e.key === 'End') {
            e.preventDefault();
            FAR.moveCursor(side, 0, { shift, toEdge: 'end' });
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const cursor = side === 'left' ? FAR.leftCursor : FAR.rightCursor;
            if (cursor === -1) {
                FAR.goToParent(side);
                return;
            }
            if (cursor >= 0 && cursor < items.length) {
                FAR.handleItemDblClick(side, cursor);
            }
            return;
        }
        if (e.key === 'Backspace') {
            e.preventDefault();
            FAR.navigatePanel(side, '..');
            return;
        }

        // --- Существующие хоткеи ---
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            const selSet = side === 'left' ? FAR.leftSelectedIdx : FAR.rightSelectedIdx;
            selSet.clear();
            for (let i = 0; i < items.length; i++) selSet.add(i);
            if (side === 'left') FAR.leftAnchor = 0;
            else FAR.rightAnchor = 0;
            FAR.renderPanel(side);
            e.preventDefault();
            return;
        }

        if (e.key === 'F5') { e.preventDefault(); FAR.refreshFiles(); return; }
        if (e.key === 'F6') { e.preventDefault(); FAR.moveSelected(); return; }
        if (e.key === 'F7') { e.preventDefault(); FAR.createFolder(); return; }
        if (e.key === 'F8' || e.key === 'Delete') { e.preventDefault(); FAR.deleteSelected(); return; }
        if (e.key === 'Insert' && e.ctrlKey) { e.preventDefault(); FAR.copySelected(); return; }
    });
};