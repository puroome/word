import { state } from './config.js';

// --- General Utils ---
export const utils = {
    levenshteinDistance(a = '', b = '') {
        const track = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
        for (let i = 0; i <= a.length; i += 1) track[0][i] = i;
        for (let j = 0; j <= b.length; j += 1) track[j][0] = j;
        for (let j = 1; j <= b.length; j += 1) {
            for (let i = 1; i <= a.length; i += 1) {
                const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
                track[j][i] = Math.min(track[j][i - 1] + 1, track[j - 1][i] + 1, track[j - 1][i - 1] + indicator);
            }
        }
        return track[b.length][a.length];
    },
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },
    formatSeconds(totalSeconds) {
        if (!totalSeconds || totalSeconds < 60) return `0분`;
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        let result = '';
        if (d > 0) result += `${d}일 `;
        if (h > 0) result += `${h}시간 `;
        if (m > 0) result += `${m}분`;
        return result.trim() || '0분';
    },
    getWordStatus(word) {
        let localStatus = {};
        try {
            const key = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(key) || '{}');
            if (unsynced[word]) localStatus = unsynced[word];
        } catch(e) { console.warn("Error reading local progress:", e); }

        const progress = { ...(state.currentProgress[word] || {}), ...localStatus };
        if (Object.keys(progress).length === 0) return 'unseen';

        const statuses = ['MULTIPLE_CHOICE_MEANING', 'FILL_IN_THE_BLANK', 'MULTIPLE_CHOICE_DEFINITION'].map(type => progress[type] || 'unseen');
        if (statuses.includes('incorrect')) return 'review';
        if (statuses.every(s => s === 'correct')) return 'learned';
        if (statuses.some(s => s === 'correct')) return 'learning';
        return 'unseen';
    },
    isFavorite(word) {
        let isFav = state.currentProgress[word]?.favorite || false;
        try {
            const key = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(key) || '{}');
            if (unsynced[word] && unsynced[word].favorite !== undefined) {
                isFav = unsynced[word].favorite;
            }
        } catch (e) { console.warn("Error reading local favorite status:", e); }
        return isFav;
    },
    getFavoriteWords() {
        let localUpdates = {};
        try {
            const key = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            localUpdates = JSON.parse(localStorage.getItem(key) || '{}');
        } catch (e) { console.warn("Error reading local favorites:", e); }

        const allProgress = state.currentProgress;
        const combinedKeys = new Set([...Object.keys(allProgress), ...Object.keys(localUpdates)]);
        const favoriteWords = [];
        combinedKeys.forEach(word => {
            const serverState = allProgress[word] || {};
            const localState = localUpdates[word] || {};
            const combinedState = {
                 ...serverState,
                 favorite: localState.favorite !== undefined ? localState.favorite : serverState.favorite,
                 favoritedAt: localState.favoritedAt !== undefined ? localState.favoritedAt : serverState.favoritedAt
             };
            if (combinedState.favorite === true) {
                 favoriteWords.push({ word: word, time: combinedState.favoritedAt || 0 });
            }
        });
        return favoriteWords.sort((a, b) => b.time - a.time).map(item => item.word);
    },
    addProgressUpdateToLocalSync(word, key, value) {
        try {
            const localKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(localKey) || '{}');
            if (!unsynced[word]) unsynced[word] = {};
            unsynced[word][key] = value;
            localStorage.setItem(localKey, JSON.stringify(unsynced));
        } catch (e) { console.error("Error adding progress update to localStorage sync", e); }
    }
};

// --- Caches ---
export const audioCache = {
    db: null, dbName: 'ttsAudioCacheDB', storeName: 'audioStore',
    init() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { console.warn('IndexedDB not supported'); return resolve(); }
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = event => { const db = event.target.result; if (!db.objectStoreNames.contains(this.storeName)) { db.createObjectStore(this.storeName); } };
            request.onsuccess = event => { this.db = event.target.result; resolve(); };
            request.onerror = event => { reject(event.target.error); };
        });
    },
    getAudio(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve(null);
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },
    saveAudio(key, data) {
        if (!this.db) return;
        try { this.db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).put(data, key); } catch(e){}
    }
};

export const translationCache = {
    db: null, dbName: 'translationCacheDB', storeName: 'translations',
    init() {
         return new Promise((resolve) => {
            if (!('indexedDB' in window)) return resolve();
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = e => { if(!e.target.result.objectStoreNames.contains(this.storeName)) e.target.result.createObjectStore(this.storeName); };
            request.onsuccess = e => { this.db = e.target.result; resolve(); };
            request.onerror = () => resolve(); 
        });
    },
    get(key) { 
        return new Promise((resolve) => {
            if (!this.db) return resolve(null);
            const r = this.db.transaction([this.storeName], 'readonly').objectStore(this.storeName).get(key);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => resolve(null);
        });
    },
    save(key, data) {
        if(this.db) try { this.db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).put(data, key); } catch(e){}
    }
};

export const imageDBCache = {
    db: null, dbName: 'imageCacheDB', storeName: 'imageStore',
    init() {
        return new Promise((resolve) => {
            if (!('indexedDB' in window)) return resolve();
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = e => e.target.result.createObjectStore(this.storeName);
            request.onsuccess = e => { this.db = e.target.result; resolve(); };
            request.onerror = () => resolve();
        });
    },
    async loadImage(url) {
        if (!this.db || !url) return url;
        const cached = await new Promise(r => {
             const req = this.db.transaction([this.storeName]).objectStore(this.storeName).get(url);
             req.onsuccess = () => r(req.result);
             req.onerror = () => r(null);
        });
        if (cached) return URL.createObjectURL(cached);
        try {
            const res = await fetch(url);
            if (!res.ok) return url;
            const blob = await res.blob();
            this.db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).put(blob, url);
            return URL.createObjectURL(blob);
        } catch (e) { return url; }
    }
};

// --- Audio Effects ---
export function playSingleBeep({ frequency, duration = 0.1, type = 'sine', gain = 0.3, endFrequency }) {
    if (!state.audioContext) return;
    if (state.audioContext.state === 'suspended') state.audioContext.resume();
    const osc = state.audioContext.createOscillator();
    const gNode = state.audioContext.createGain();
    const now = state.audioContext.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (endFrequency) osc.frequency.linearRampToValueAtTime(endFrequency, now + duration);
    gNode.gain.setValueAtTime(0, now);
    gNode.gain.linearRampToValueAtTime(gain, now + 0.01);
    gNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.01);
    osc.connect(gNode);
    gNode.connect(state.audioContext.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
}

export function playSequence(soundDefinition) {
    if (soundDefinition.sequence && Array.isArray(soundDefinition.sequence)) {
        soundDefinition.sequence.forEach(note => {
            if (note.delay) setTimeout(() => playSingleBeep(note), note.delay);
            else playSingleBeep(note);
        });
    } else {
        playSingleBeep(soundDefinition);
    }
}

export const correctBeep = {
    name: '또로롱 (물방울)',
    sequence: [
        { frequency: 523, duration: 0.07, type: 'triangle', gain: 0.25 },
        { delay: 80, frequency: 659, duration: 0.07, type: 'triangle', gain: 0.25 },
        { delay: 160, frequency: 783, duration: 0.07, type: 'triangle', gain: 0.25 }
    ]
};

export const incorrectBeep = {
    name: '삐빅 (경고)',
    sequence: [
        { frequency: 400, duration: 0.07, type: 'square', gain: 0.15 },
        { delay: 90, frequency: 400, duration: 0.07, type: 'square', gain: 0.15 }
    ]
};

// --- Non Interactive Words Set ---
export const nonInteractiveWords = new Set(['a', 'an', 'the', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those', 'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'something', 'anybody', 'anyone', 'anything', 'nobody', 'no one', 'nothing', 'everybody', 'everyone', 'everything', 'all', 'any', 'both', 'each', 'either', 'every', 'few', 'little', 'many', 'much', 'neither', 'none', 'one', 'other', 'several', 'some', 'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'at', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'by', 'down', 'during', 'for', 'from', 'in', 'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto', 'out', 'outside', 'over', 'past', 'since', 'through', 'throughout', 'to', 'toward', 'under', 'underneath', 'until', 'unto', 'up', 'upon', 'with', 'within', 'without', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'after', 'although', 'as', 'because', 'before', 'if', 'once', 'since', 'than', 'that', 'though', 'till', 'unless', 'until', 'when', 'whenever', 'where', 'whereas', 'wherever', 'whether', 'while', 'that', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'what', 'whatever', 'whichever', 'whoever', 'whomever', 'who', 'whom', 'whose', 'what', 'which', 'when', 'where', 'why', 'how', 'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'done', 'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'ought', 'not', 'very', 'too', 'so', 'just', 'well', 'often', 'always', 'never', 'sometimes', 'here', 'there', 'now', 'then', 'again', 'also', 'ever', 'even', 'how', 'quite', 'rather', 'soon', 'still', 'more', 'most', 'less', 'least', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'then', 'there', 'here', "don't", "didn't", "can't", "couldn't", "she's", "he's", "i'm", "you're", "they're", "we're", "it's", "that's"]);
