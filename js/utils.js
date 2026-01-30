import { state } from './config.js';

// ================================================================
// 1. 일반 유틸리티 (계산, 포맷팅, 셔플)
// ================================================================
export const utils = {
    // 레벤슈타인 거리 계산 (검색 기능용 fuzzy match)
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

    // 피셔-예이츠 셔플 (퀴즈 보기 섞기)
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },

    // 초 -> MM:SS 포맷팅
    formatSeconds(totalSeconds) {
        if (!totalSeconds || totalSeconds < 60) return `${totalSeconds || 0}초`;
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m}분 ${s}초`;
    },

    // 로컬 스토리지에 진행 상황 저장 (동기화 대기열)
    addProgressUpdateToLocalSync(word, type, value) {
        try {
            const key = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const updates = JSON.parse(localStorage.getItem(key) || '{}');
            if (!updates[word]) updates[word] = {};
            updates[word][type] = value;
            updates[word].timestamp = Date.now();
            localStorage.setItem(key, JSON.stringify(updates));
            
            // 메인 스레드에 동기화 요청 이벤트 발송
            window.dispatchEvent(new Event('syncRequest'));
        } catch (e) {
            console.error("로컬 진행상황 저장 실패:", e);
        }
    },

    // 즐겨찾기 목록 가져오기
    getFavoriteWords() {
        if (!state.userId) return [];
        return Object.keys(state.currentProgress || {}).filter(word => {
            return state.currentProgress[word] && state.currentProgress[word].favorite === true;
        });
    },

    // 단어 상태 확인 (unknown, review, correct)
    getWordStatus(word) {
        if (!state.userId || !state.currentProgress[word]) return 'unknown';
        const p = state.currentProgress[word];
        
        // 최근 3번의 퀴즈 결과 확인 (간소화된 로직)
        // 실제로는 Firestore 구조에 따라 다르지만, 여기서는 로컬 state 기준으로 판단
        if (p['MULTIPLE_CHOICE_MEANING'] === 'correct' && 
            p['FILL_IN_THE_BLANK'] === 'correct') {
            return 'correct';
        }
        if (p['MULTIPLE_CHOICE_MEANING'] === 'wrong' || p['FILL_IN_THE_BLANK'] === 'wrong') {
            return 'review';
        }
        return 'unknown';
    },

    isFavorite(word) {
        if (!state.userId || !state.currentProgress[word]) return false;
        return !!state.currentProgress[word].favorite;
    }
};

// ================================================================
// 2. 효과음 (AudioContext Oscillator)
// ================================================================

// 퀴즈 정답 (딩동댕)
export const correctBeep = () => {
    if (!state.audioContext) return;
    if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});

    const ctx = state.audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    // '도' -> '미' (빠르게)
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.1); // E5

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
};

// 퀴즈 오답 (띠~)
export const incorrectBeep = () => {
    if (!state.audioContext) return;
    if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {});

    const ctx = state.audioContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sawtooth'; // 조금 거친 소리
    osc.frequency.setValueAtTime(196.00, ctx.currentTime); // G3
    osc.frequency.linearRampToValueAtTime(185.00, ctx.currentTime + 0.3); // Pitch down

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
};


// ================================================================
// 3. 캐시 시스템 (IndexedDB Wrapper)
// ================================================================

// 오디오 파일 캐싱 (TTS)
export const audioCache = {
    dbName: 'tts_audio_cache',
    storeName: 'audios',
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
            request.onerror = (event) => {
                console.error("AudioDB Error:", event);
                reject(event);
            };
        });
    },

    async saveAudio(key, arrayBuffer) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(arrayBuffer, key);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e);
        });
    },

    async getAudio(key) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (e) => reject(e);
        });
    }
};

// 번역 텍스트 캐싱
export const translationCache = {
    dbName: 'translation_cache',
    storeName: 'texts',
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
            request.onerror = (event) => reject(event);
        });
    },

    async save(key, text) {
        if (!this.db) await this.init();
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        transaction.objectStore(this.storeName).put(text, key);
    },

    async get(key) {
        if (!this.db) await this.init();
        return new Promise((resolve) => {
            const request = this.db.transaction([this.storeName], 'readonly').objectStore(this.storeName).get(key);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = () => resolve(null);
        });
    }
};

// 이미지 캐싱 (고양이 이미지 등)
export const imageDBCache = {
    dbName: 'image_cache_db',
    storeName: 'images',
    db: null,

    async init() {
        return new Promise((resolve) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = () => resolve();
        });
    },

    async loadImage(url) {
        if (!this.db) await this.init();
        
        // 1. 캐시 확인
        const cachedBlob = await new Promise(resolve => {
            const tx = this.db.transaction([this.storeName], 'readonly');
            const req = tx.objectStore(this.storeName).get(url);
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = () => resolve(null);
        });

        if (cachedBlob) {
            return URL.createObjectURL(cachedBlob);
        }

        // 2. 없으면 네트워크 요청
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            
            // 3. 캐시 저장
            const tx = this.db.transaction([this.storeName], 'readwrite');
            tx.objectStore(this.storeName).put(blob, url);
            
            return URL.createObjectURL(blob);
        } catch (e) {
            return url; // 실패 시 원본 URL 반환
        }
    }
};

// 인터랙티브 클릭 제외 단어 목록 (전치사, 관사 등)
export const nonInteractiveWords = new Set([
    'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 
    'is', 'are', 'was', 'were', 'be', 'been', 'and', 'but', 'or', 'so', 
    'it', 'this', 'that', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your'
]);
