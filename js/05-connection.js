FAR.getDefaultConn = function() {
    const proto = location.protocol === 'file:' ? 'http:' : location.protocol;
    const host  = location.hostname || 'localhost';
    return {
        url:  proto + '//' + host + ':5984',
        db:   'FileBD',
        user: '',
        pass: ''
    };
};

FAR.loadConnFromLS = function() {
    try {
        const raw = localStorage.getItem(FAR.LS_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || !obj.url || !obj.db) return null;
        return obj;
    } catch (e) {
        return null;
    }
};

FAR.saveConnToLS = function(cfg) {
    localStorage.setItem(FAR.LS_KEY, JSON.stringify(cfg));
};

FAR.clearConnFromLS = function() {
    localStorage.removeItem(FAR.LS_KEY);
};

FAR.ensureDb = function() {
    if (!FAR.db) {
        FAR.toast('Нет подключения к БД. Войдите в систему.', 'warning');
        FAR.openConnModal();
        return false;
    }
    return true;
};

FAR.connectToDb = async function(cfg) {
    const url = String(cfg.url).replace(/\/+$/, '');
    const fullUrl = url + '/' + cfg.db;
    const pouchOpts = {};
    if (cfg.user) {
        pouchOpts.auth = { username: cfg.user, password: cfg.pass || '' };
    }
    const testDb = new PouchDB(fullUrl, pouchOpts);
    const info = await testDb.info();
    await testDb.allDocs({ limit: 1 });
    return { db: testDb, info, fullUrl };
};