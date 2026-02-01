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

    // [데이터 로드] Firebase -> 로컬 동기화 (기존 로직 100% 유지)
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

    // --------------------------------------------------------------------------
    // [기능 1] Gemini 1.5 Flash (무료) - 단어 정보 생성
    // --------------------------------------------------------------------------
    async fetchWordInfoFromAI(word) {
        const k1 = "AIzaSyAdXvE2SkyEbPmU";
        const k2 = "XtLUeVi7f-niGpXUu_0";
        const apiKey = k1 + k2; 
        
        // 1.5-flash 모델 사용 (안정적, 무료 티어)
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        // 사용자 요청 사항(타동사 조사, 문맥 괄호 등) 완벽 반영 프롬프트
        const prompt = `
            Act as a linguistics expert for US high school students.
            Analyze the English word: "${word}"

            Output pure JSON with three fields:
            1. "meaning": 
               - The most common Korean meaning(s).
               - CRITICAL FOR VERBS: Distinguish Transitive (vt) vs Intransitive (vi). 
                 * If Vi (Intransitive): Format as "[뜻]하다" or include preposition like "~에 [뜻]하다".
                 * If Vt (Transitive): You MUST include the Korean particle (~을, ~에, ~와, etc.) before the verb.
                   [IMPORTANT FORMATTING RULE for Vt]:
                   - General case: "~을 [뜻]하다"
                   - If specific object context is needed: Insert context in parentheses between tilde and particle.
                     Format: "~(Context)Particle Verb"
                   - Examples:
                     * 'raise' (money) -> "~(자금 등)을 모금하다"
                     * 'raise' (issue) -> "~(문제·이의 등)을 제기하다"
                     * 'enter' -> "~에 들어가다"
                     * 'marry' -> "~와 결혼하다"
               - Mark (slang) or (informal) if applicable.

            2. "explanation": 
               - Generate a structured text with these KOREAN headers: [동의어], [반의어], [파생어], [용례], [심화].
               - FORMAT RULES:
                 Rule 1 [동의어/반의어]: Group by specific meanings. 
                        Format: "word1, word2, ... : [Korean Definition]"
                        Max 7 words per group.
                        * Ensure the Korean definition follows the Vt formatting rules above.
                 Rule 2 [용례]: Focus on Collocations or Idioms. Format: "Expression : Korean Meaning".
                 Rule 3 [심화]: List high-frequency words sharing the SAME ETYMOLOGICAL ROOT. 
                        Format: "Word : Korean Meaning".
                        Example: "preserve : ~을 보존하다"
                 Rule 4: Insert an empty line between categories. If a category is empty, omit it.
            
            3. "samples": An array of English example sentences.
               - QUANTITY LOGIC:
                 Case A: Single meaning -> 1 sentence.
                 Case B: Distinct meanings -> 1 sentence per meaning (Max 5).
               - No translations.

            Do not include Markdown code blocks. Just the JSON string.
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
            
            // JSON 파싱 전처리 (마크다운 제거)
            const cleanJson = JSON.parse(textResponse.replace(/```json|```/g, '').trim());

            return cleanJson;

        } catch (error) {
            console.error("AI 단어 정보 가져오기 실패:", error);
            throw error;
        }
    },

    // --------------------------------------------------------------------------
    // [호환성 패치] quiz.js가 호출하는 함수 이름 연결 (매우 중요!)
    // --------------------------------------------------------------------------
    async fetchDefinition(word) {
        // quiz.js는 이 이름으로 호출하므로, 위에서 만든 메인 함수로 토스해줍니다.
        return this.fetchWordInfoFromAI(word);
    },

    // --------------------------------------------------------------------------
    // [기능 2] 브라우저 TTS (무료) - main.js의 UK/US 설정 연동
    // --------------------------------------------------------------------------
    speak(text, type = 'word') {
        return new Promise((resolve) => {
            if (!text) return resolve();

            // 브라우저 지원 여부 체크
            if (!window.speechSynthesis) {
                console.warn("TTS 미지원 브라우저");
                return resolve();
            }

            // 기존 음성 중단 (겹침 방지)
            window.speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            const voices = window.speechSynthesis.getVoices();
            
            // main.js에서 사용자가 선택한 발음 설정 가져오기 ('UK' or 'US')
            // state.currentVoiceSet 값이 없으면 기본값 'US'
            const currentSet = state.currentVoiceSet || 'US';
            const targetLangCode = (currentSet === 'UK') ? 'en-GB' : 'en-US';

            // 1. 완벽하게 일치하는 목소리 찾기 (Google/Microsoft 우선)
            let selectedVoice = voices.find(v => v.lang === targetLangCode && v.name.includes('Google')) ||
                                voices.find(v => v.lang === targetLangCode && v.name.includes('Microsoft')) ||
                                voices.find(v => v.lang === targetLangCode);

            // 2. 없으면 해당 국가 코드 포함하는 아무 목소리나 (예: en-US-Standard)
            if (!selectedVoice) {
                selectedVoice = voices.find(v => v.lang.includes(targetLangCode));
            }

            // 목소리 설정
            if (selectedVoice) {
                utterance.voice = selectedVoice;
                utterance.lang = selectedVoice.lang;
            } else {
                utterance.lang = 'en-US'; // 최후의 수단
            }

            // 예문(sample)일 경우 조금 천천히 읽기 (학습 효과 증대)
            utterance.rate = type === 'sample' ? 0.9 : 1.0;
            utterance.pitch = 1.0;

            utterance.onend = () => resolve();
            utterance.onerror = (e) => {
                console.error("TTS Error:", e);
                resolve(); // 에러가 나도 앱이 멈추지 않게 함
            };

            window.speechSynthesis.speak(utterance);
        });
    },

    // --------------------------------------------------------------------------
    // [기능 3] Gemini 1.5 Flash (무료) - 번역 기능
    // --------------------------------------------------------------------------
    async fetchTranslation(text) {
        // 캐시 확인 (중복 호출 비용 절약)
        const cacheKey = `trans_${text}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) return cached;

        const k1 = "AIzaSyAdXvE2SkyEbPmU";
        const k2 = "XtLUeVi7f-niGpXUu_0";
        const apiKey = k1 + k2; 
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const prompt = `Translate the following English text into natural Korean. Output ONLY the Korean translation, no extra text.\n\nText: "${text}"`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            if (!response.ok) throw new Error('Translation Failed');

            const data = await response.json();
            const translatedText = data.candidates[0].content.parts[0].text.trim();

            // 로컬 스토리지에 저장 (캐싱)
            try {
                localStorage.setItem(cacheKey, translatedText);
            } catch (e) {}

            return translatedText;

        } catch (error) {
            console.error("번역 실패:", error);
            return "번역 서버 연결 실패";
        }
    },

    // --------------------------------------------------------------------------
    // [기능 4] 단어 저장 및 삭제 (기존 로직 유지)
    // --------------------------------------------------------------------------
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
        // 1. Google Sheets(GAS) 연동 (옵션)
        if (config.SCRIPT_URL) {
            try {
                const scriptUrl = new URL(config.SCRIPT_URL);
                scriptUrl.searchParams.append('action', 'delete_word');
                scriptUrl.searchParams.append('word', word);
                
                // Fire and forget 방식 (결과 기다리지 않음)
                fetch(scriptUrl.toString()).catch(e => console.warn("GAS 통신 오류", e));
            } catch(e) {}
        }

        // 2. Firebase DB 삭제
        if (database) {
            const { ref, remove } = window.firebaseSDK;
            const safeKey = word.replace(/[.#$[\]/]/g, '_');
            const wordRef = ref(database, `/vocabulary/${safeKey}`);
            remove(wordRef).catch(e => console.error(e));
        }

        // 3. 로컬 상태 업데이트
        state.wordList = state.wordList.filter(w => w.word !== word);
        
        try {
            const cachedData = localStorage.getItem('wordListCache');
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                parsedCache.words = parsedCache.words.filter(w => w.word !== word);
                localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
            }
        } catch (e) {}
    }
};
