// ============================================================
// Настройка джойстика: маппинг кнопок → действия + LocalStorage
// ============================================================

FAR.GAMEPAD_LS_KEY = 'filebd_gamepad_map';

/**
 * Действия, которые можно назначить.
 * 'kind' — 'button' | 'axis-neg' | 'axis-pos'.
 * 'code' — индекс кнопки/оси.
 */
FAR.GAMEPAD_ACTIONS = [
    { id: 'up',      label: '⬆️ Курсор вверх',        kind: 'axis-neg', code: 1 },
    { id: 'down',    label: '⬇️ Курсор вниз',         kind: 'axis-pos', code: 1 },
    { id: 'left',    label: '⬅️ Предыдущая панель',   kind: 'axis-neg', code: 0 },
    { id: 'right',   label: '➡️ Следующая панель',    kind: 'axis-pos', code: 0 },
    { id: 'enter',   label: '⏎ Войти в папку / открыть', kind: 'button',   code: 0 },
    { id: 'back',    label: '⬆ Вверх (Backspace)',    kind: 'button',   code: 1 },
    { id: 'toggle',  label: '☑ Выделить/снять',       kind: 'button',   code: 2 },
    { id: 'refresh', label: '🔄 Обновить (F5)',       kind: 'button',   code: 3 },
    { id: 'pageUp',  label: '⤒ Страница вверх',       kind: 'button',   code: null },
    { id: 'pageDown',label: '⤓ Страница вниз',        kind: 'button',   code: null },
    { id: 'delete',  label: '🗑️ Удалить (F8)',       kind: 'button',   code: null },
    { id: 'auth',    label: '🔐 LogIn / LogOut',      kind: 'button',   code: 9 }
];

/**
 * Возвращает текущую карту (из localStorage или по умолчанию).
 */
FAR.getGamepadMap = function() {
    try {
        const raw = localStorage.getItem(FAR.GAMEPAD_LS_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            if (obj && typeof obj === 'object') {
                // Дополняем недостающие действия дефолтными
                FAR.GAMEPAD_ACTIONS.forEach(function(a) {
                    if (!(a.id in obj)) obj[a.id] = { kind: a.kind, code: a.code };
                });
                return obj;
            }
        }
    } catch (e) { /* ignore */ }
    const def = {};
    FAR.GAMEPAD_ACTIONS.forEach(function(a) {
        def[a.id] = { kind: a.kind, code: a.code };
    });
    return def;
};

/**
 * Сохраняет карту в localStorage.
 */
FAR.saveGamepadMapToLS = function(map) {
    try {
        localStorage.setItem(FAR.GAMEPAD_LS_KEY, JSON.stringify(map));
    } catch (e) { /* ignore */ }
};

/**
 * Сбрасывает карту к значениям по умолчанию.
 */
FAR.resetGamepadMap = function() {
    if (!confirm('Сбросить раскладку джойстика по умолчанию?')) return;
    try { localStorage.removeItem(FAR.GAMEPAD_LS_KEY); } catch (e) {}
    FAR._gamepadMap = FAR.getGamepadMap();
    FAR._gamepadSetupRender();
    FAR.toast('Раскладка сброшена', 'info');
};

/**
 * Сохраняет текущую карту из UI в localStorage.
 */
FAR.saveGamepadMap = function() {
    if (!FAR._gamepadSetupDraft) return;
    FAR._gamepadMap = JSON.parse(JSON.stringify(FAR._gamepadSetupDraft));
    FAR.saveGamepadMapToLS(FAR._gamepadMap);
    FAR.toast('Раскладка сохранена', 'success');
    FAR.closeGamepadSetup();
};

// ============================================================
// Открытие / закрытие окна настройки
// ============================================================

FAR.openGamepadSetup = function() {
    FAR._gamepadSetupDraft = FAR.getGamepadMap();
    FAR._gamepadSetupCapturing = null;   // id действия, для которого ждём нажатие
    FAR._gamepadSetupCaptureTimer = null;

    const modal = document.getElementById('gamepadSetupModal');
    modal.classList.remove('hidden');

    FAR._gamepadSetupRender();
    FAR._gamepadSetupStartLive();
    FAR._gamepadSetStatus('Нажмите любую кнопку на джойстике для назначения.', 'waiting');
};

FAR.closeGamepadSetup = function() {
    FAR._gamepadSetupCapturing = null;
    if (FAR._gamepadSetupCaptureTimer) {
        clearTimeout(FAR._gamepadSetupCaptureTimer);
        FAR._gamepadSetupCaptureTimer = null;
    }
    FAR._gamepadSetupStopLive();

    const modal = document.getElementById('gamepadSetupModal');
    if (modal) modal.classList.add('hidden');
};

FAR.closeGamepadSetupOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closeGamepadSetup();
};

FAR._gamepadSetStatus = function(text, cls) {
    const el = document.getElementById('gamepadSetupStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'gamepad-status' + (cls ? ' ' + cls : '');
};

// ============================================================
// Рендер списка действий
// ============================================================

FAR._gamepadSetupRender = function() {
    const box = document.getElementById('gamepadActionsList');
    if (!box) return;
    box.innerHTML = '';

    FAR.GAMEPAD_ACTIONS.forEach(function(action) {
        const map = FAR._gamepadSetupDraft[action.id] || { kind: null, code: null };
        const row = document.createElement('div');
        const assigned = map.code !== null && map.code !== undefined;
        const capturing = FAR._gamepadSetupCapturing === action.id;
        row.className = 'gamepad-action-row' +
            (assigned ? ' assigned' : '') +
            (capturing ? ' capturing' : '');

        const label = document.createElement('span');
        label.className = 'ga-label';
        label.textContent = action.label;

        const mapping = document.createElement('span');
        mapping.className = 'ga-mapping';
        mapping.textContent = FAR._gamepadMapToString(map);

        const btnCap = document.createElement('button');
        btnCap.className = 'ga-btn' + (capturing ? ' capture' : '');
        btnCap.textContent = capturing ? '⏳ Нажмите…' : '🎯 Назначить';
        btnCap.onclick = function() { FAR._gamepadSetupStartCapture(action.id); };

        const btnClear = document.createElement('button');
        btnClear.className = 'ga-btn clear';
        btnClear.textContent = '✕';
        btnClear.title = 'Очистить';
        btnClear.onclick = function() {
            FAR._gamepadSetupDraft[action.id] = { kind: null, code: null };
            FAR._gamepadSetupRender();
        };

        row.appendChild(label);
        row.appendChild(mapping);
        row.appendChild(btnCap);
        row.appendChild(btnClear);
        box.appendChild(row);
    });
};

FAR._gamepadMapToString = function(map) {
    if (!map || map.code === null || map.code === undefined) return '— не задано —';
    if (map.kind === 'button')   return 'Кнопка #' + map.code;
    if (map.kind === 'axis-neg') return 'Ось ' + map.code + ' → «−»';
    if (map.kind === 'axis-pos') return 'Ось ' + map.code + ' → «+»';
    return '—';
};

// ============================================================
// Захват нажатия
// ============================================================

FAR._gamepadSetupStartCapture = function(actionId) {
    FAR._gamepadSetupCapturing = actionId;
    FAR._gamepadSetStatus('Нажмите нужную кнопку или двиньте ось…', 'waiting');
    FAR._gamepadSetupRender();
};

/**
 * Вызывается из live-цикла, когда зафиксировано изменение состояния
 * кнопки или оси. Возвращает true, если захват состоялся.
 */
FAR._gamepadSetupHandleInput = function(kind, code) {
    if (!FAR._gamepadSetupCapturing) return false;

    const actionId = FAR._gamepadSetupCapturing;
    FAR._gamepadSetupDraft[actionId] = { kind: kind, code: code };
    FAR._gamepadSetupCapturing = null;

    FAR._gamepadSetStatus('Назначено: ' + FAR._gamepadMapToString({ kind: kind, code: code }), '');
    FAR._gamepadSetupRender();
    return true;
};

// ============================================================
// Live-отображение состояния геймпада + перехват нажатий
// ============================================================

FAR._gamepadSetupStartLive = function() {
    if (FAR._gamepadSetupLiveRaf) return;
    FAR._gamepadSetupPrev = { buttons: null, axes: null };
    FAR._gamepadSetupLiveLoop();
};

FAR._gamepadSetupStopLive = function() {
    if (FAR._gamepadSetupLiveRaf) {
        cancelAnimationFrame(FAR._gamepadSetupLiveRaf);
        FAR._gamepadSetupLiveRaf = null;
    }
};

FAR._gamepadSetupLiveLoop = function() {
    const modal = document.getElementById('gamepadSetupModal');
    if (!modal || modal.classList.contains('hidden')) {
        FAR._gamepadSetupStopLive();
        return;
    }

    const pad = FAR._getFirstGamepad();
    if (pad) {
        FAR._gamepadSetupUpdateLive(pad);
    } else {
        FAR._gamepadSetStatus('Джойстик не найден. Нажмите любую кнопку.', 'waiting');
    }

    FAR._gamepadSetupLiveRaf = requestAnimationFrame(FAR._gamepadSetupLiveLoop);
};

/**
 * Возвращает первый активный геймпад (для live-отображения и захвата).
 */
FAR._getFirstGamepad = function() {
    try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < pads.length; i++) if (pads[i]) return pads[i];
    } catch (e) { /* ignore */ }
    return null;
};

FAR._gamepadSetupUpdateLive = function(pad) {
    const buttons = pad.buttons.map(function(b) { return b.pressed; });
    const axes    = pad.axes.slice();

    // --- Захват изменения: сначала кнопки, потом оси ---
    if (FAR._gamepadSetupCapturing && FAR._gamepadSetupPrev.buttons) {
        for (let i = 0; i < buttons.length; i++) {
            if (buttons[i] && !FAR._gamepadSetupPrev.buttons[i]) {
                if (FAR._gamepadSetupHandleInput('button', i)) {
                    // сбрасываем историю, чтобы не срабатывало дважды
                    FAR._gamepadSetupPrev.buttons = buttons.slice();
                    FAR._gamepadSetupPrev.axes = axes.slice();
                    return;
                }
            }
        }
    }

    if (FAR._gamepadSetupCapturing && FAR._gamepadSetupPrev.axes) {
        const TH = 0.5;
        for (let i = 0; i < axes.length; i++) {
            const cur = axes[i];
            const old = FAR._gamepadSetupPrev.axes[i] || 0;
            if (cur < -TH && old >= -TH) {
                if (FAR._gamepadSetupHandleInput('axis-neg', i)) {
                    FAR._gamepadSetupPrev.buttons = buttons.slice();
                    FAR._gamepadSetupPrev.axes = axes.slice();
                    return;
                }
            }
            if (cur > TH && old <= TH) {
                if (FAR._gamepadSetupHandleInput('axis-pos', i)) {
                    FAR._gamepadSetupPrev.buttons = buttons.slice();
                    FAR._gamepadSetupPrev.axes = axes.slice();
                    return;
                }
            }
        }
    }

    FAR._gamepadSetupPrev.buttons = buttons.slice();
    FAR._gamepadSetupPrev.axes    = axes.slice();

    // --- Живое отображение ---
    const btnBox = document.getElementById('gamepadSetupButtons');
    if (btnBox) {
        let html = '';
        for (let i = 0; i < buttons.length; i++) {
            const cls = buttons[i] ? 'pressed' : '';
            html += '<span class="gp-pill ' + cls + '">#' + i + '</span>';
        }
        btnBox.innerHTML = html;
    }

    const axBox = document.getElementById('gamepadSetupAxes');
    if (axBox) {
        let html = '';
        for (let i = 0; i < axes.length; i++) {
            const v = axes[i];
            const active = Math.abs(v) > 0.3;
            const cls = active ? 'pressed' : '';
            html += '<span class="gp-pill ' + cls + '">a' + i + '=' + v.toFixed(2) + '</span>';
        }
        axBox.innerHTML = html;
    }

    // Обновляем статус: показываем ID геймпада
    if (!FAR._gamepadSetupCapturing) {
        FAR._gamepadSetStatus('🎮 ' + pad.id + ' (index ' + pad.index + ')', '');
    }
};

// ============================================================
// Автоматическое определение и инициализация
// ============================================================

/**
 * Запускается при старте приложения. Подтягивает карту из LS
 * и, если геймпад есть, включает его обработку.
 */
FAR.setupGamepadAuto = function() {
    FAR._gamepadMap = FAR.getGamepadMap();

    if (!FAR._gamepadState.running) {
        FAR._gamepadState.running = true;
        window.addEventListener('gamepadconnected', function(e) {
            FAR.toast('🎮 Геймпад подключён: ' + e.gamepad.id, 'info');
            console.log('[Gamepad] connected:', e.gamepad.id, 'index:', e.gamepad.index);
        });
        window.addEventListener('gamepaddisconnected', function(e) {
            FAR.toast('🎮 Геймпад отключён', 'warning');
            console.log('[Gamepad] disconnected:', e.gamepad.id);
        });
        FAR._gamepadLoop();
    }
};

/**
 * Возвращает true, если у действия есть назначение.
 */
FAR._gamepadHasMapping = function(map, actionId) {
    const m = map && map[actionId];
    return m && m.code !== null && m.code !== undefined;
};