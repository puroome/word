import { state } from './config.js';

// --- General Utils ---
export const utils = {
    // --- 공통 헬퍼 ---

    // ✨ [버그 수정] 영국 시간(UTC) 대신 사용자의 로컬 시간대(한국 KST) 기준 날짜를 반환 (YYYY-MM-DD)
    getLocalDateString() {
        const now = new Date();
        // 현재 시간대와 UTC의 차이를 분 단위로 구해서 밀리초로 변환 (한국은 -540분)
        const offset = now.getTimezoneOffset() * 60000; 
        // 현재 시간에서 오프셋을 빼서 정확한 로컬 시간을 계산
        return new Date(now.getTime() - offset).toISOString().slice(0, 10);
    },

    // localStorage의 미동기화 진행 데이터를 안전하게 읽어 객체로 반환
    getUnsyncedProgress() {
        try {
            const item = localStorage.getItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES);
            return item ? JSON.parse(item) : {};
        } catch (e) {
            console.warn("Error reading unsynced progress:", e);
            return {};
        }
    },

    // [최적화] 제한된 Levenshtein 거리 계산 (속도 개선)
    // limit을 넘어가면 즉시 중단하여 긴 단어 목록 검색 시 성능 저하 방지
    levenshteinDistance(s, t, limit = Infinity) {
        if (s === t) return 0;
        if (s.length === 0) return t.length;
        if (t.length === 0) return s.length;
        
        // 길이 차이가 limit을 넘으면 계산 불필요
        if (Math.abs(s.length - t.length) > limit) return limit + 1;

        // 메모리 최적화를 위해 2개의 행만 사용 (Two-row approach)
        let v0 = new Array(t.length + 1);
        let v1 = new Array(t.length + 1);

        for (let i = 0; i < v0.length; i++) v0[i] = i;

        for (let i = 0; i < s.length; i++) {
            v1[0] = i + 1;
            let minRow = v1[0]; // 현재 행의 최소값 추적

            for (let j = 0; j < t.length; j++) {
                const cost = s[i] === t[j] ? 0 : 1;
                v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
                minRow = Math.min(minRow, v1[j + 1]);
            }

            // 현재 행의 모든 값이 limit보다 크면 조기 종료
            if (minRow > limit) return limit + 1;

            // 배열 교체 (v0 <-> v1)
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

    // [최적화] 배열에서 N개의 랜덤 요소 추출 (Quiz 오답 생성용)
    // 전체 배열을 섞지 않고 필요한 만큼만 뽑아 성능 향상
    pickRandomItems(array, count, excludeFilter = () => false) {
        const result = [];
        const len = array.length;
        // 배열이 작으면 shuffle 사용 (기존 방식)
        if (len < count * 3) {
            const shuffled = [...array].filter(item => !excludeFilter(item));
            this.shuffleArray(shuffled);
            return shuffled.slice(0, count);
        }

        // 배열이 크면 랜덤 인덱스 접근 (성능 최적화)
        const seenIndices = new Set();
        let attempts = 0;
        const maxAttempts = count * 5; // 무한 루프 방지

        while (result.length < count && attempts < maxAttempts) {
            attempts++;
            const idx = Math.floor(Math.random() * len);
            if (seenIndices.has(idx)) continue;
            
            const item = array[idx];
            if (!excludeFilter(item)) {
                seenIndices.add(idx);
                result.push(item);
            }
        }
        return result;
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

        const statuses = ['MULTIPLE_CHOICE_MEANING', 'FILL_IN_THE_BLANK', 'MULTIPLE_CHOICE_DEFINITION', 'LISTENING_QUIZ']
  .map(type => progress[type] || 'unseen');
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

addProgressUpdateToLocalSync(word, key, value) {
        try {
            const localKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(localKey) || '{}');
            if (!unsynced[word]) unsynced[word] = {};
            unsynced[word][key] = value;
            localStorage.setItem(localKey, JSON.stringify(unsynced));
        } catch (e) { 
            // ✨ [자가 치유 로직] 용량 초과 에러가 발생했을 때
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                console.warn("로컬 스토리지 용량 초과! WORD_LIST_CACHE를 비우고 다시 시도합니다.");
                
                // 1. 용량을 가장 많이 차지하는 단어장 캐시를 삭제하여 공간 확보
                localStorage.removeItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE);
                
                // 2. 캐시를 지웠다는 사실을 앱에 알림 (다음에 다시 다운로드 하도록)
                state.isWordListReady = false; 
                
                // 3. 공간이 확보되었으니, 저장하려던 학습 데이터를 다시 저장 시도
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

// --- Caches ---
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

// --- Audio Effects ---
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
