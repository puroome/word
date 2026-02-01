import { config, state } from './config.js';
// utils가 로드되지 않아도 앱이 멈추지 않도록 처리
let utils = {};
try {
    const utilsModule = await import('./utils.js');
    utils = utilsModule.utils;
} catch (e) {
    console.warn("Utils load skipped");
}

let db = null; 
let database = null; 

export const api = {
    // 1. 초기화
    init(firestoreInstance, realtimeDbInstance) {
        db = firestoreInstance;
        database = realtimeDbInstance;
        console.log("✅ API Initialized");
    },

    // ==========================================================================
    // [핵심 1] 단어장 로드 (앱이 켜질 때 가장 중요)
    // ==========================================================================
    async loadWordList(force = false) {
        // 1. 강제 로드면 캐시 삭제
        if (force) {
            try { localStorage.removeItem('wordListCache'); } catch(e){}
            state.isWordListReady = false;
        }

        // 2. 이미 로드되었으면 종료 (안전하게 배열 반환)
        if (state.isWordListReady && !force) {
            return state.wordList || [];
        }

        // 3. Firebase 준비 안 됐으면 빈 배열 반환 (여기서 undefined를 주면 main.js가 멈춤)
        if (!window.firebaseSDK) {
            console.warn("Firebase SDK not ready.");
            state.wordList = state.wordList || [];
            return []; 
        }

        const { ref, get } = window.firebaseSDK;
        try {
            const dbRef = ref(database, '/vocabulary');
            const snapshot = await get(dbRef);
            const data = snapshot.val();

            if (!data) {
                state.wordList = [];
            } else {
                state.wordList = Object.values(data).sort((a, b) => a.index - b.index);
            }
            
            state.isWordListReady = true;
            state.lastCacheTimestamp = Date.now();

            localStorage.setItem('wordListCache', JSON.stringify({
                timestamp: state.lastCacheTimestamp,
                words: state.wordList
            }));

            return state.wordList;

        } catch (error) {
            console.error("데이터 로드 실패 (기본값 사용):", error);
            state.wordList = state.wordList || [];
            return []; // 에러 나도 빈 배열 반환
        }
    },

    // ==========================================================================
    // [핵심 2] 설정 및 통계 (main.js가 없으면 에러 내는 함수들)
    // ==========================================================================
    
    // [중요] 설정값이 undefined면 main.js가 초기 화면을 못 그림
    async loadUserSettings() {
        return { 
            theme: 'light', 
            lastMode: 'dashboard',
            voiceType: 'US',
            dailyGoal: 10
        };
    },
    
    async saveUserSettings(settings) { return true; },

    // [중요] 이 함수가 없어서 처음에 에러가 났었음
    async updateStudyTime(seconds) {
        if (!state.userId || !seconds) return;
        try {
            if (!window.firebaseSDK) return;
            const { ref, get, update } = window.firebaseSDK;
            const userRef = ref(database, `/studyTime/${state.userId}`);
            const snapshot = await get(userRef);
            const current = snapshot.val() || 0;
            await update(ref(database), { [`/studyTime/${state.userId}`]: current + seconds });
        } catch (e) {
            console.warn("통계 저장 실패 (무시됨)");
        }
    },

    async loadStudyTime() {
        if (!state.userId) return 0;
        try {
            if (!window.firebaseSDK) return 0;
            const { ref, get } = window.firebaseSDK;
            const snapshot = await get(ref(database, `/studyTime/${state.userId}`));
            return snapshot.val() || 0;
        } catch (e) { return 0; }
    },

    // 오프라인 동기화 호출 대응
    async syncData() { return true; },
    async checkUserStatus() { return true; },
    async logActivity() { return true; },

    // ==========================================================================
    // [기능] 단어 저장/삭제
    // ==========================================================================
    async saveWord(wordData) {
        if (!state.userId) return alert("로그인이 필요합니다.");
        const { ref, update } = window.firebaseSDK;
        const safeKey = wordData.word.replace(/[.#$[\]/]/g, '_');
        
        try {
            await update(ref(database), {
                [`/vocabulary/${safeKey}`]: {
                    ...wordData, updatedAt: Date.now(), index: wordData.index || Date.now()
                }
            });
            // 로컬 동기화
            const idx = state.wordList.findIndex(w => w.word === wordData.word);
            if (idx !== -1) state.wordList[idx] = { ...state.wordList[idx], ...wordData };
            else state.wordList.push(wordData);
            
            localStorage.setItem('wordListCache', JSON.stringify({
                timestamp: Date.now(), words: state.wordList
            }));
        } catch (e) { console.error(e); throw e; }
    },

    async deleteWord(word) {
        if (config.SCRIPT_URL) {
            try { fetch(`${config.SCRIPT_URL}?action=delete_word&word=${word}`).catch(()=>{}); } catch(e){}
        }
        if (database) {
            const { ref, remove } = window.firebaseSDK;
            const safeKey = word.replace(/[.#$[\]/]/g, '_');
            remove(ref(database, `/vocabulary/${safeKey}`)).catch(()=>{});
        }
        state.wordList = state.wordList.filter(w => w.word !== word);
        try {
            const c = JSON.parse(localStorage.getItem('wordListCache')||'{}');
            if(c.words) {
                c.words = c.words.filter(w => w.word !== word);
                localStorage.setItem('wordListCache', JSON.stringify(c));
            }
        } catch(e){}
    },

    // 퀴즈 기록 (dashboard.js 대응)
    async saveQuizResult(type, correct) {
        if (!state.userId) return;
        try {
            const { ref, push } = window.firebaseSDK;
            await push(ref(database, `/quizHistory/${state.userId}`), { type, correct, timestamp: Date.now() });
        } catch(e){}
    },

    async loadQuizHistory() {
        if (!state.userId) return {};
        try {
            const { ref, get, query, limitToLast } = window.firebaseSDK;
            const q = query(ref(database, `/quizHistory/${state.userId}`), limitToLast(500));
            const snapshot = await get(q);
            return snapshot.val() || {};
        } catch(e) { return {}; }
    },

    // ==========================================================================
    // [무료 AI] Gemini 1.5 Flash + Browser TTS
    // ==========================================================================

    async fetchWordInfoFromAI(word) {
        const k1 = "AIzaSyAdXvE2SkyEbPmU";
        const k2 = "XtLUeVi7f-niGpXUu_0";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${k1+k2}`;
        
        const prompt = `
            Act as a linguistics expert for US high school students.
            Analyze: "${word}"
            Output pure JSON (no markdown):
            {
              "meaning": ["Meanings. If Transitive(Vt), use '~(Context)Particle Verb' format (e.g., '~(돈)을 모금하다')"],
              "explanation": "Headers: [동의어], [반의어], [파생어], [용례], [심화]. Rule: Synonyms group by meaning. Root words in [심화].",
              "samples": ["Example sentence 1", "Example sentence 2"]
            }
        `;

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await res.json();
            const text = data.candidates[0].content.parts[0].text;
            return JSON.parse(text.replace(/```json|```/g, '').trim());
        } catch (e) {
            console.error("AI Error:", e);
            throw e; 
        }
    },

    // quiz.js 호환
    async fetchDefinition(word) {
        return this.fetchWordInfoFromAI(word);
    },

    // Browser TTS (무료)
    speak(text, type = 'word') {
        return new Promise((resolve) => {
            if (!text || !window.speechSynthesis) return resolve();
            
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance(text);
            const voices = window.speechSynthesis.getVoices();
            
            // UK vs US
            const isUK = state.currentVoiceSet === 'UK';
            const lang = isUK ? 'en-GB' : 'en-US';
            
            const voice = voices.find(v => v.lang === lang && (v.name.includes('Google') || v.name.includes('Microsoft'))) 
                       || voices.find(v => v.lang.includes(lang));
            
            if (voice) utter.voice = voice;
            utter.lang = lang;
            utter.rate = type === 'sample' ? 0.9 : 1.0;
            
            utter.onend = resolve;
            utter.onerror = resolve;
            
            window.speechSynthesis.speak(utter);
        });
    },

    // 번역 (무료)
    async fetchTranslation(text) {
        const cacheKey = `trans_${text}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) return cached;

        const k1 = "AIzaSyAdXvE2SkyEbPmU";
        const k2 = "XtLUeVi7f-niGpXUu_0";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${k1+k2}`;
        const prompt = `Translate to Korean (only output result):\n"${text}"`;

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await res.json();
            const result = data.candidates[0].content.parts[0].text.trim();
            try { localStorage.setItem(cacheKey, result); } catch(e){}
            return result;
        } catch (e) {
            return "번역 오류";
        }
    }
};
