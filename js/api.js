import { config, state } from './config.js';
// audioCache import는 유지하되 사용하지 않음 (에러 방지)
import { utils } from './utils.js';

let db = null; // Firestore
let database = null; // Realtime DB

export const api = {
    // 1. 초기화
    init(firestoreInstance, realtimeDbInstance) {
        db = firestoreInstance;
        database = realtimeDbInstance;
        console.log("✅ API Initialized");
    },

    // 2. 단어장 관리 (핵심 기능)
    async loadWordList(force = false) {
        // 강제 로드 시 캐시 초기화
        if (force) {
            try { localStorage.removeItem('wordListCache'); } catch(e){}
            state.isWordListReady = false;
        }

        // 이미 로드되어 있으면 패스
        if (state.isWordListReady && !force) return;

        // Firebase SDK가 아직 없으면 안전하게 리턴 (앱 멈춤 방지)
        if (!window.firebaseSDK) {
            console.warn("Firebase SDK not ready yet. Skipping load.");
            state.wordList = state.wordList || [];
            return;
        }

        const { ref, get } = window.firebaseSDK;
        try {
            const dbRef = ref(database, '/vocabulary');
            const snapshot = await get(dbRef);
            const data = snapshot.val();

            if (!data) {
                state.wordList = [];
            } else {
                // 데이터 배열 변환
                state.wordList = Object.values(data).sort((a, b) => a.index - b.index);
            }
            
            state.isWordListReady = true;
            state.lastCacheTimestamp = Date.now();

            // 로컬 캐시 저장
            localStorage.setItem('wordListCache', JSON.stringify({
                timestamp: state.lastCacheTimestamp,
                words: state.wordList
            }));

        } catch (error) {
            console.error("데이터 로드 실패 (기본값 사용):", error);
            // 에러가 나도 빈 배열로 설정하여 앱이 멈추지 않게 함
            state.wordList = state.wordList || [];
            state.isWordListReady = true;
        }
    },

    async saveWord(wordData) {
        if (!state.userId) return alert("로그인이 필요합니다.");
        
        const { ref, update } = window.firebaseSDK;
        const safeKey = wordData.word.replace(/[.#$[\]/]/g, '_');
        
        const updates = {};
        updates[`/vocabulary/${safeKey}`] = {
            ...wordData,
            updatedAt: Date.now(),
            index: wordData.index || Date.now()
        };

        try {
            await update(ref(database), updates);
            
            // 상태 업데이트
            const existingIndex = state.wordList.findIndex(w => w.word === wordData.word);
            if (existingIndex !== -1) {
                state.wordList[existingIndex] = { ...state.wordList[existingIndex], ...wordData };
            } else {
                state.wordList.push(wordData);
            }
            // 캐시 업데이트
            localStorage.setItem('wordListCache', JSON.stringify({
                timestamp: Date.now(),
                words: state.wordList
            }));
        } catch (error) {
            console.error("저장 실패:", error);
            throw error;
        }
    },

    async deleteWord(word) {
        // GAS 연동 (에러 무시)
        if (config.SCRIPT_URL) {
            try {
                const url = new URL(config.SCRIPT_URL);
                url.searchParams.append('action', 'delete_word');
                url.searchParams.append('word', word);
                fetch(url.toString()).catch(() => {});
            } catch(e) {}
        }
        
        // Firebase 삭제
        if (database) {
            const { ref, remove } = window.firebaseSDK;
            const safeKey = word.replace(/[.#$[\]/]/g, '_');
            remove(ref(database, `/vocabulary/${safeKey}`)).catch(() => {});
        }

        // 로컬 상태 업데이트
        state.wordList = state.wordList.filter(w => w.word !== word);
        try {
            const cached = JSON.parse(localStorage.getItem('wordListCache') || '{}');
            if (cached.words) {
                cached.words = cached.words.filter(w => w.word !== word);
                localStorage.setItem('wordListCache', JSON.stringify(cached));
            }
        } catch(e) {}
    },

    // 3. 통계 및 사용자 설정 (main.js 에러 방지용 필수 함수들)
    
    // [중요] 앱 시작 시 호출되는 함수. 없으면 앱이 멈춤.
    async updateStudyTime(seconds) {
        if (!state.userId || !seconds) return;
        try {
            const { ref, get, update } = window.firebaseSDK;
            const userRef = ref(database, `/studyTime/${state.userId}`);
            const snapshot = await get(userRef);
            const current = snapshot.val() || 0;
            await update(ref(database), { [`/studyTime/${state.userId}`]: current + seconds });
        } catch (e) {
            console.warn("학습 시간 업데이트 실패 (무시됨)", e);
        }
    },

    async loadStudyTime() {
        if (!state.userId) return 0;
        try {
            const { ref, get } = window.firebaseSDK;
            const snapshot = await get(ref(database, `/studyTime/${state.userId}`));
            return snapshot.val() || 0;
        } catch (e) { return 0; }
    },

    async saveQuizResult(type, correct) {
        if (!state.userId) return;
        try {
            const { ref, push } = window.firebaseSDK;
            await push(ref(database, `/quizHistory/${state.userId}`), {
                type, correct, timestamp: Date.now()
            });
        } catch (e) {}
    },

    async loadQuizHistory() {
        if (!state.userId) return {};
        try {
            const { ref, get, query, limitToLast } = window.firebaseSDK;
            const q = query(ref(database, `/quizHistory/${state.userId}`), limitToLast(500));
            const snapshot = await get(q);
            return snapshot.val() || {};
        } catch (e) { return {}; }
    },

    // [중요] 설정 로드 함수가 없거나 실패하면 main.js가 초기 화면을 못 찾을 수 있음
    async loadUserSettings() {
        // 빈 객체라도 반환해야 main.js가 'undefined' 에러를 안 냄
        return { theme: 'light', lastMode: 'dashboard' };
    },
    
    async saveUserSettings(settings) {
        return true;
    },

    async syncData() {
        return true;
    },

    // 4. 무료 AI 기능 (Gemini 1.5 Flash + Browser TTS)

    async fetchWordInfoFromAI(word) {
        const k1 = "AIzaSyAdXvE2SkyEbPmU";
        const k2 = "XtLUeVi7f-niGpXUu_0";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${k1+k2}`;
        
        // 타동사 처리 및 문맥 괄호 적용 프롬프트
        const prompt = `
            Act as a linguistics expert for US high school students.
            Analyze: "${word}"
            Output pure JSON (no markdown):
            {
              "meaning": ["Most common Korean meanings. If Transitive(Vt), start with '~을/를' or use '~(Context)Particle' format like '~(돈)을 모금하다'"],
              "explanation": "Headers: [동의어], [반의어], [파생어], [용례], [심화]. Rule: Synonyms group by meaning. Usage focuses on collocations. Root words in [심화].",
              "samples": ["English sentence 1", "English sentence 2"]
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
            throw e; // 에러 발생 시 UI에서 처리하도록 던짐
        }
    },

    // quiz.js 호환용
    async fetchDefinition(word) {
        return this.fetchWordInfoFromAI(word);
    },

    // 브라우저 TTS (무료)
    speak(text, type = 'word') {
        return new Promise((resolve) => {
            if (!text || !window.speechSynthesis) return resolve();
            
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance(text);
            const voices = window.speechSynthesis.getVoices();
            
            // UK vs US 설정 확인
            const isUK = state.currentVoiceSet === 'UK';
            const lang = isUK ? 'en-GB' : 'en-US';
            
            // 목소리 찾기
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

    // Gemini 번역 (무료)
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
