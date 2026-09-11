FAR.setupKeyboard = function() {
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (!FAR.progress.active) FAR.closeViewer();
            return;
        }

        if (FAR.progress.active) return;
        if (!FAR.db) return;

        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            const items = FAR.activePanel === 'left' ? FAR.leftFiles : FAR.rightFiles;
            const selSet = FAR.activePanel === 'left' ? FAR.leftSelectedIdx : FAR.rightSelectedIdx;
            selSet.clear();
            for (let i = 0; i < items.length; i++) selSet.add(i);
            if (FAR.activePanel === 'left') FAR.leftAnchor = 0;
            else FAR.rightAnchor = 0;
            FAR.renderPanel(FAR.activePanel);
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