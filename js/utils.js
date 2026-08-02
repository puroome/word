import { state } from './config.js';

const QUIZ_TYPES = [
    'MULTIPLE_CHOICE_MEANING',
    'FILL_IN_THE_BLANK',
    'MULTIPLE_CHOICE_DEFINITION',
    'LISTENING_QUIZ'
];

function getStoredJson(key, fallback = {}) {
    const raw = localStorage.getItem(key);
    return {
        raw,
        value: raw ? JSON.parse(raw) : fallback
    };
}

export const utils = {
    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    sanitizeRichHtml(value) {
        const rawHtml = String(value ?? '');
        if (!rawHtml) return '';
        if (typeof document === 'undefined') return this.escapeHtml(rawHtml);

        const template = document.createElement('template');
        template.innerHTML = rawHtml;
        const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN', 'FONT']);
        const colorPattern = /^(#[0-9a-f]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0|1|0?\.\d+)\s*\))$/i;

        const sanitizeNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return document.createTextNode(node.nodeValue);
            }

            if (node.nodeType !== Node.ELEMENT_NODE) {
                return document.createDocumentFragment();
            }

            const tagName = node.tagName;
            const children = document.createDocumentFragment();
            node.childNodes.forEach(child => children.appendChild(sanitizeNode(child)));

            if (!allowedTags.has(tagName)) {
                return children;
            }

            if (tagName === 'BR') return document.createElement('br');

            const normalizedTag = tagName === 'FONT' ? 'span' : tagName.toLowerCase();
            const cleanEl = document.createElement(normalizedTag);
            cleanEl.appendChild(children);

            const rawColor = tagName === 'FONT'
                ? node.getAttribute('color')
                : (node.style && node.style.color);
            const color = (rawColor || '').trim();
            if (color && colorPattern.test(color)) {
                cleanEl.style.color = color;
            }

            return cleanEl;
        };

        const output = document.createElement('div');
        template.content.childNodes.forEach(child => output.appendChild(sanitizeNode(child)));
        return output.innerHTML;
    },

    richHtmlToPlainText(value) {
        const html = this.sanitizeRichHtml(value).replace(/<br\s*\/?>/gi, '\n');
        if (typeof document === 'undefined') {
            return html.replace(/<[^>]+>/g, '');
        }
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent || '';
    },

    toFirebaseKey(word) {
        return word.replace(/[.#$[\]/]/g, '_');
    },

    // 정규식 특수문자 이스케이프 (new RegExp에 안전하게 삽입)
    escapeRegExp(str) {
        return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    },

    _wordIndexMap: null,
    _wordIndexSource: null,

    getWordIndexMap() {
        if (this._wordIndexMap && this._wordIndexSource === state.wordList) {
            return this._wordIndexMap;
        }
        const map = new Map();
        state.wordList.forEach(w => {
            if (w.word) map.set(w.word.toLowerCase(), w.word);
        });
        this._wordIndexMap = map;
        this._wordIndexSource = state.wordList;
        return map;
    },

    invalidateWordIndexMap() {
        this._wordIndexMap = null;
        this._wordIndexSource = null;
    },

    // Date → 로컬 타임존 기준 'YYYY-MM-DD' 문자열
    toLocalDateString(date) {
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().slice(0, 10);
    },

    getLocalDateString() {
        return this.toLocalDateString(new Date());
    },

    getUnsyncedProgress() {
        try {
            const { raw, value } = getStoredJson(state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES);
            if (this._unsyncedCacheRaw === raw) return this._unsyncedCacheParsed;
            this._unsyncedCacheRaw = raw;
            this._unsyncedCacheParsed = value;
            return value;
        } catch (e) {
            console.warn("Error reading unsynced progress:", e);
            return {};
        }
    },

    levenshteinDistance(s, t, limit = Infinity) {
        if (s === t) return 0;
        if (s.length === 0) return t.length;
        if (t.length === 0) return s.length;

        if (Math.abs(s.length - t.length) > limit) return limit + 1;

        let v0 = new Array(t.length + 1);
        let v1 = new Array(t.length + 1);

        for (let i = 0; i < v0.length; i++) v0[i] = i;

        for (let i = 0; i < s.length; i++) {
            v1[0] = i + 1;
            let minRow = v1[0];

            for (let j = 0; j < t.length; j++) {
                const cost = s[i] === t[j] ? 0 : 1;
                v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
                minRow = Math.min(minRow, v1[j + 1]);
            }

            if (minRow > limit) return limit + 1;

            const temp = v0;
            v0 = v1;
            v1 = temp;
        }

        return v0[t.length];
    },

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },

    pickRandomItems(array, count, excludeFilter = () => false) {
        if (count <= 0) return [];
        const candidates = array.filter(item => !excludeFilter(item));
        this.shuffleArray(candidates);
        return candidates.slice(0, count);
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
        const localStatus = this.getUnsyncedProgress()[word] || {};
        const progress = { ...(state.currentProgress[word] || {}), ...localStatus };
        if (Object.keys(progress).length === 0) return 'unseen';

        const statuses = QUIZ_TYPES.map(type => progress[type] || 'unseen');
        if (statuses.includes('incorrect')) return 'review';
        if (statuses.every(s => s === 'correct')) return 'learned';
        if (statuses.some(s => s === 'correct')) return 'learning';
        return 'unseen';
    },

    isFavorite(word) {
        const localUpdates = this.getUnsyncedProgress();
        if (localUpdates[word] && localUpdates[word].favorite !== undefined) {
            return localUpdates[word].favorite;
        }
        return state.currentProgress[word]?.favorite || false;
    },

    getFavoriteWords() {
        const localUpdates = this.getUnsyncedProgress();
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

    getCombinedProgress(word) {
        return {
            ...(state.currentProgress[word] || {}),
            ...(this.getUnsyncedProgress()[word] || {})
        };
    },

    getIncorrectQuizTypes(word) {
        const progress = this.getCombinedProgress(word);
        return QUIZ_TYPES.filter(type => progress[type] === 'incorrect');
    },

    getMistakeReviewItems() {
        return state.wordList
            .filter(wordObj => !wordObj.except)
            .flatMap(wordObj =>
                this.getIncorrectQuizTypes(wordObj.word)
                    .map(quizType => ({ word: wordObj.word, quizType }))
            );
    },

    addProgressUpdateToLocalSync(word, key, value) {
        try {
            const localKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(localKey) || '{}');
            if (!unsynced[word]) unsynced[word] = {};
            unsynced[word][key] = value;
            localStorage.setItem(localKey, JSON.stringify(unsynced));
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                console.warn("로컬 스토리지 용량 초과! WORD_LIST_CACHE를 비우고 다시 시도합니다.");

                localStorage.removeItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE);
                state.isWordListReady = false;

                try {
                    const localKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
                    const unsynced = JSON.parse(localStorage.getItem(localKey) || '{}');
                    if (!unsynced[word]) unsynced[word] = {};
                    unsynced[word][key] = value;
                    localStorage.setItem(localKey, JSON.stringify(unsynced));
                    console.log("✅ 자가 치유 성공: 캐시 삭제 후 학습 데이터 저장 완료!");
                } catch (retryError) {
                    console.error("자가 치유 후에도 저장 실패:", retryError);
                }
            } else {
                console.error("Error adding progress update to localStorage sync", e);
            }
        }
    }
};

export const translationCache = {
    db: null, dbName: 'translationCacheDB', storeName: 'translations',
    init() {
        return new Promise((resolve) => {
            if (!('indexedDB' in window)) return resolve();
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = e => { if (!e.target.result.objectStoreNames.contains(this.storeName)) e.target.result.createObjectStore(this.storeName); };
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
        if (this.db) try { this.db.transaction([this.storeName], 'readwrite').objectStore(this.storeName).put(data, key); } catch (e) {}
    }
};

export function playSingleBeep({ frequency, duration = 0.1, type = 'sine', gain = 0.3, endFrequency }) {
    if (!state.audioContext) return;
    if (state.audioContext.state === 'suspended') state.audioContext.resume();
    const osc = state.audioContext.createOscillator();
    const gNode = state.audioContext.createGain();
    const now = state.audioContext.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
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
    sequence: [
        { frequency: 523, duration: 0.07, type: 'triangle', gain: 0.25 },
        { delay: 80, frequency: 659, duration: 0.07, type: 'triangle', gain: 0.25 },
        { delay: 160, frequency: 783, duration: 0.07, type: 'triangle', gain: 0.25 }
    ]
};

export const incorrectBeep = {
    sequence: [
        { frequency: 400, duration: 0.07, type: 'square', gain: 0.15 },
        { delay: 90, frequency: 400, duration: 0.07, type: 'square', gain: 0.15 }
    ]
};

export const nonInteractiveWords = new Set(['a', 'an', 'the', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those', 'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'something', 'anybody', 'anyone', 'anything', 'nobody', 'no one', 'nothing', 'everybody', 'everyone', 'everything', 'all', 'any', 'both', 'each', 'either', 'every', 'few', 'little', 'many', 'much', 'neither', 'none', 'one', 'other', 'several', 'some', 'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'at', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'by', 'down', 'during', 'for', 'from', 'in', 'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto', 'out', 'outside', 'over', 'past', 'since', 'through', 'throughout', 'to', 'toward', 'under', 'underneath', 'until', 'unto', 'up', 'upon', 'with', 'within', 'without', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'after', 'although', 'as', 'because', 'before', 'if', 'once', 'since', 'than', 'that', 'though', 'till', 'unless', 'until', 'when', 'whenever', 'where', 'whereas', 'wherever', 'whether', 'while', 'that', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'what', 'whatever', 'whichever', 'whoever', 'whomever', 'who', 'whom', 'whose', 'what', 'which', 'when', 'where', 'why', 'how', 'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'done', 'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'ought', 'not', 'very', 'too', 'so', 'just', 'well', 'often', 'always', 'never', 'sometimes', 'here', 'there', 'now', 'then', 'again', 'also', 'ever', 'even', 'how', 'quite', 'rather', 'soon', 'still', 'more', 'most', 'less', 'least', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'then', 'there', 'here', "don't", "didn't", "can't", "couldn't", "she's", "he's", "i'm", "you're", "they're", "we're", "it's", "that's"]);
