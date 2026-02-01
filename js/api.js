import { config, state } from './config.js';
// audioCache는 브라우저 TTS 사용 시 필요 없으나 import 에러 방지용으로 유지
import { audioCache, translationCache, utils } from './utils.js';

let db = null; // Firestore
let database = null; // Realtime DB

export const api = {
    // [초기화] main.js에서 Firebase 인스턴스를 주입받음
    init(firestoreInstance, realtimeDbInstance) {
        db = firestoreInstance;
        database = realtimeDbInstance;
    },

    // ==========================================================================
    // [기본 데이터] 단어장 로드/저장/삭제
    // ==========================================================================
    async loadWordList(force = false) {
        if (force) {
            localStorage.removeItem('wordListCache');
            state.isWordListReady = false;
        }

        if (!state.isWordListReady) {
            try {
                const cachedData = localStorage.getItem('wordListCache');
                if (cachedData) {
                    const { timestamp, words } = JSON.parse(cachedData);
                    state.wordList = words.sort((a, b) => a.index - b.index);
                    state.isWordListReady = true;
                    state.lastCacheTimestamp = timestamp;
                }
            } catch (e) {
                localStorage.removeItem('wordListCache');
            }
        }

        if (state.isWordListReady && !force) return;

        const { ref, get } = window.firebaseSDK;
        try {
            const dbRef = ref(database, '/vocabulary');
            const snapshot = await get(dbRef);
            const data = snapshot.val();
            if (!data) throw new Error("Firebase에 단어 데이터가 없습니다.");

            const wordsArray = Object.values(data).sort((a, b) => a.index - b.index);

            state.wordList = wordsArray;
            state.isWordListReady = true;
            state.lastCacheTimestamp = Date.now();

            localStorage.setItem('wordListCache', JSON.stringify({
                timestamp: state.lastCacheTimestamp,
                words: state.wordList
            }));

        } catch (error) {
            console.error("데이터 로드 실패:", error);
        }
    },

    async saveWord(wordData) {
        if (!state.userId) {
            alert("로그인이 필요합니다.");
            return;
        }

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

            // 로컬 상태 동기화
            const existingIndex = state.wordList.findIndex(w => w.word === wordData.word);
            if (existingIndex !== -1) {
                state.wordList[existingIndex] = { ...state.wordList[existingIndex], ...wordData };
            } else {
                state.wordList.push(wordData);
            }
            
            localStorage.setItem('wordListCache', JSON.stringify({
                timestamp: Date.now(),
                words: state.wordList
            }));

        } catch (error) {
            console.error("단어 저장 실패:", error);
            throw error;
        }
    },

    async deleteWord(word) {
        if (config.SCRIPT_URL) {
            try {
                const scriptUrl = new URL(config.SCRIPT_URL);
                scriptUrl.searchParams.append('action', 'delete_word');
                scriptUrl.searchParams.append('word', word);
                fetch(scriptUrl.toString()).catch(e => console.warn("GAS 통신 오류", e));
            } catch(e) {}
        }

        if (database) {
            const { ref, remove } = window.firebaseSDK;
            const safeKey = word.replace(/[.#$[\]/]/g, '_');
            const wordRef = ref(database, `/vocabulary/${safeKey}`);
            remove(wordRef).catch(e => console.error(e));
        }

        state.wordList = state.wordList.filter(w => w.word !== word);
        try {
            const cachedData = localStorage.getItem('wordListCache');
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                parsedCache.words = parsedCache.words.filter(w => w.word !== word);
                localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
            }
        } catch (e) {}
    },

    // ==========================================================================
    // [복구됨] 학습 통계 및 기록 (이 부분이 없어서 에러가 났습니다!)
    // ==========================================================================
    
    // 1. 학습 시간 업데이트 (main.js가 호출함)
    async updateStudyTime(seconds) {
        if (!state.userId || !seconds) return;
        const { ref, get, update } = window.firebaseSDK;
        try {
            const userRef = ref(database, `/studyTime/${state.userId}`);
            const snapshot = await get(userRef);
            const current = snapshot.val() || 0;
            
            const updates = {};
            updates[`/studyTime/${state.userId}`] = current + seconds;
            await update(ref(database), updates);
        } catch (e) {
            console.error("학습 시간 저장 실패:", e);
        }
    },

    // 2. 학습 시간 불러오기 (dashboard.js가 호출할 수 있음)
    async loadStudyTime() {
        if (!state.userId) return 0;
        const { ref, get } = window.firebaseSDK;
        try {
            const snapshot = await get(ref(database, `/studyTime/${state.userId}`));
            return snapshot.val() || 0;
        } catch (e) {
            return 0;
        }
    },

    // 3. 퀴즈 결과 저장 (dashboard 차트용 데이터)
    async saveQuizResult(quizType, isCorrect) {
        if (!state.userId) return;
        const { ref, push } = window.firebaseSDK;
        try {
            await push(ref(database, `/quizHistory/${state.userId}`), {
                type: quizType,
                correct: isCorrect,
                timestamp: Date.now()
            });
        } catch (e) {
            console.error("퀴즈 기록 저장 실패:", e);
        }
    },

    // 4. 퀴즈 기록 불러오기 (dashboard 차트용)
    async loadQuizHistory() {
        if (!state.userId) return {};
        const { ref, get, query, limitToLast } = window.firebaseSDK;
        try {
            // 최근 1000개 정도만 가져오기 (데이터 과부하 방지)
            const q = query(ref(database, `/quizHistory/${state.userId}`), limitToLast(1000));
            const snapshot = await get(q);
            return snapshot.val() || {};
        } catch (e) {
            return {};
        }
    },

    // ==========================================================================
    // [기능 1] Gemini 1.5 Flash (무료) - 단어 정보 생성
    // ==========================================================================
    async fetchWordInfoFromAI(word) {
        const k1 = "AIzaSyAdXvE2SkyEbPmU";
        const k2 = "XtLUeVi7f-niGpXUu_0";
        const apiKey = k1 + k2; 
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const prompt = `
            Act as a linguistics expert for US high school students.
            Analyze the English word: "${word}"
            Output pure JSON with three fields:
            1. "meaning": 
               - The most common Korean meaning(s).
               - CRITICAL FOR VERBS: Distinguish Transitive (vt) vs Intransitive (vi). 
                 * If Vi: Format as "[뜻]하다" or include preposition.
                 * If Vt: MUST include Korean particle (~을, ~에, etc.).
                   Rule: "~(Context)Particle Verb" (e.g., 'raise' (money) -> "~(자금 등)을 모금하다").
               - Mark (slang/informal).
            2. "explanation": 
               - Headers: [동의어], [반의어], [파생어], [용례], [심화].
               - Rule 1 [Synonyms]: Group by meaning. Format: "word1, word2 : [Meaning]".
               - Rule 2 [Usage]: Collocations/Idioms.
               - Rule 3 [Root]: Same etymological root words.
            3. "samples": English example sentences (1 per meaning, max 5).
            Do not include Markdown.
        `;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            if (!response.ok) throw new Error(`API Error (${response.status})`);
            const data = await response.json();
            const textResponse = data.candidates[0].content.parts[0].text;
            return JSON.parse(textResponse.replace(/```json|```/g, '').trim());
        } catch (error) {
            console.error("AI Error:", error);
            throw error;
        }
    },

    // [호환성 연결] quiz.js가 사용하는 함수 이름
    async fetchDefinition(word) {
        return this.fetchWordInfoFromAI(word);
    },

    // ==========================================================================
    // [기능 2] 브라우저 TTS (무료) - main.js의 UK/US 설정 연동
    // ==========================================================================
    speak(text, type = 'word') {
        return new Promise((resolve) => {
            if (!text) return resolve();
            if (!window.speechSynthesis) return resolve();

            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            const voices = window.speechSynthesis.getVoices();
            
            const currentSet = state.currentVoiceSet || 'US';
            const targetLangCode = (currentSet === 'UK') ? 'en-GB' : 'en-US';

            let selectedVoice = voices.find(v => v.lang === targetLangCode && v.name.includes('Google')) ||
                                voices.find(v => v.lang === targetLangCode && v.name.includes('Microsoft')) ||
                                voices.find(v => v.lang === targetLangCode);

            if (!selectedVoice) selectedVoice = voices.find(v => v.lang.includes(targetLangCode));

            if (selectedVoice) {
                utterance.voice = selectedVoice;
                utterance.lang = selectedVoice.lang;
            } else {
                utterance.lang = 'en-US';
            }

            utterance.rate = type === 'sample' ? 0.9 : 1.0;
            utterance.onend = () => resolve();
            utterance.onerror = () => resolve();
            window.speechSynthesis.speak(utterance);
        });
    },

    // ==========================================================================
    // [기능 3] Gemini 1.5 Flash (무료) - 번역 기능
    // ==========================================================================
    async fetchTranslation(text) {
        const cacheKey = `trans_${text}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) return cached;

        const k1 = "AIzaSyAdXvE2SkyEbPmU";
        const k2 = "XtLUeVi7f-niGpXUu_0";
        const apiKey = k1 + k2; 
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const prompt = `Translate this to natural Korean (output only Korean):\n"${text}"`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            if (!response.ok) throw new Error('Translation Failed');
            const data = await response.json();
            const result = data.candidates[0].content.parts[0].text.trim();
            try { localStorage.setItem(cacheKey, result); } catch (e) {}
            return result;
        } catch (error) {
            return "번역 서버 연결 실패";
        }
    }
};
