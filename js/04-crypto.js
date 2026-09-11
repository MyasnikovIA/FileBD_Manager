FAR._encoder = new TextEncoder();
FAR._decoder = new TextDecoder();
FAR._saltCache = new Map();

FAR.deriveKey = async function(passphrase, salt) {
    const cacheKey = btoa(String.fromCharCode(...salt)) + '|' + passphrase;
    if (FAR._saltCache.has(cacheKey)) return FAR._saltCache.get(cacheKey);
    const keyMaterial = await crypto.subtle.importKey(
        'raw', FAR._encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: FAR.MI, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );
    FAR._saltCache.set(cacheKey, key);
    return key;
};

FAR.base64ToUint8Array = function(b64) {
    try {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
    } catch (e) {
        return new Uint8Array(0);
    }
};

FAR.decryptString = async function(encrypted, passphrase) {
    passphrase = passphrase || FAR.PASSPHRASE;
    if (!passphrase) throw new Error('Passphrase required');
    if (typeof encrypted !== 'string') throw new Error('Not a string');
    const parts = encrypted.split(':');
    if (parts.length !== 4 || parts[0] !== FAR.UI) {
        throw new Error('Invalid encrypted payload format');
    }
    const salt = FAR.base64ToUint8Array(parts[1]);
    const iv   = FAR.base64ToUint8Array(parts[2]);
    const data = FAR.base64ToUint8Array(parts[3]);
    const key  = await FAR.deriveKey(passphrase, salt);
    const out  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return FAR._decoder.decode(out);
};