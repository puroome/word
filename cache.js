// 공통 DB 생성 헬퍼
const createDBCache = (dbName, storeName) => ({
    db: null, dbName, storeName,
    init() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { console.warn('IndexedDB not supported.'); return resolve(); }
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) { db.createObjectStore(this.storeName); }
            };
            request.onsuccess = e => { this.db = e.target.result; resolve(); };
            request.onerror = e => reject(e.target.error);
        });
    },
    get(key) {
        return new Promise((resolve) => {
            if (!this.db) return resolve(null);
            const request = this.db.transaction([this.storeName], 'readonly').objectStore(this.storeName).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });
    },
    save(key, data) {
        if (!this.db) return;
        try { this.db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).put(data, key); }
        catch (e) { console.error("DB save error", e); }
    }
});

export const imageDBCache = {
    ...createDBCache('imageCacheDB', 'imageStore'),
    async loadImage(url) {
        if (!this.db || !url) return url;
        const cachedBlob = await this.get(url);
        if (cachedBlob) return URL.createObjectURL(cachedBlob);
        try {
            const response = await fetch(url);
            if (!response.ok) return url;
            const blob = await response.blob();
            this.save(url, blob);
            return URL.createObjectURL(blob);
        } catch (e) { return url; }
    }
};

export const audioCache = {
    ...createDBCache('ttsAudioCacheDB', 'audioStore'),
    getAudio: function(key) { return this.get(key); }, // Alias for compatibility
    saveAudio: function(key, data) { return this.save(key, data); }
};

export const translationCache = createDBCache('translationCacheDB', 'translations');