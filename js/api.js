import { config, state } from './config.js';
import { translationCache, utils } from './utils.js';

let db = null; // Firestore
let database = null; // Realtime DB
let activeSpeakId = 0;
const GEMINI_API_KEY = "AIzaSyAdXvE2SkyEbPmU" + "XtLUeVi7f-niGpXUu_0";

export const api = {
    
    init(firestoreInstance, realtimeDbInstance) {
        db = firestoreInstance;
        database = realtimeDbInstance;
    },

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

            const newTimestamp = Date.now();
            const cachePayload = { timestamp: newTimestamp, words: wordsArray };
            localStorage.setItem('wordListCache', JSON.stringify(cachePayload));
            state.lastCacheTimestamp = newTimestamp;
        } catch (error) {
            throw error;
        }
    },

    // ==========================================================================
    // [수정됨] 무료 TTS (Microsoft Natural Voice 우선 적용)
    // 1순위: 요청하신 Christopher(US) / Maisie(UK)
    // 2순위: 그 외 Microsoft 계열
    // 3순위: Google 및 기타 브라우저 기본 음성
    // ==========================================================================
speak(text, contentType = 'word') {
        return new Promise((resolve) => {
            const myRequestId = ++activeSpeakId;
            if (!text || !text.trim()) return resolve();

            if (!window.speechSynthesis) {
                console.warn("이 브라우저는 TTS를 지원하지 않습니다.");
                return resolve();
            }

            window.speechSynthesis.cancel();

            // [유지] 발음 치환
            const processedText = text.replace(/\bsb\b/gi, 'somebody').replace(/\bsth\b/gi, 'something');

            // 발화 객체 생성
            const utterance = new SpeechSynthesisUtterance(processedText);

            // [중요] 목소리 세팅 함수
            const setVoice = () => {
                if (myRequestId !== activeSpeakId) return;
                const voices = window.speechSynthesis.getVoices();
                const isUK = state.currentVoiceSet === 'UK';
                
                // 목표: 영국이면 'en-GB', 미국이면 'en-US'
                // (안드로이드는 en_GB 처럼 언더바를 쓰기도 하므로 정규화 필요)
                const targetLang = isUK ? 'en-gb' : 'en-us';

                // ==============================================================
                // [안드로이드 삼성/구글 TTS 맞춤형 목소리 찾기]
                // 이름(Name)보다 언어코드(Lang) 일치를 최우선으로 봅니다.
                // ==============================================================
                
let selectedVoice = null;

                // [신규] 0단계: UK일 경우 최우선 순위 'Microsoft Ryan' 찾기
                // 정확한 이름: "Microsoft Ryan Online (Natural) - English (United Kingdom)"
                if (isUK) {
                    selectedVoice = voices.find(v => 
                        v.name.includes("Microsoft Ryan") && v.name.includes("United Kingdom")
                    );
                }

                // 1단계: 아직 못 찾았다면, 언어 코드가 정확히 일치하는 것 찾기 (대소문자/언더바 무시)
                // (주의: 0단계에서 찾았다면 이 단계는 건너뛰어야 하므로 if (!selectedVoice) 추가)
                if (!selectedVoice) {
                    selectedVoice = voices.find(v => {
                        const vLang = v.lang.replace('_', '-').toLowerCase();
                        return vLang === targetLang;
                    });
                }

                // 2단계: 만약 못 찾았다면, 해당 국가 코드를 포함하는 것 찾기
                if (!selectedVoice) {
                    selectedVoice = voices.find(v => {
                        const vLang = v.lang.replace('_', '-').toLowerCase();
                        return vLang.includes(targetLang);
                    });
                }

                // 3단계: 그래도 없다면 PC용 Microsoft Natural Voice 시도 (PC 환경 대비)
                if (!selectedVoice) {
                    const naturalName = isUK ? "United Kingdom" : "United States";
                    selectedVoice = voices.find(v => v.name.includes(naturalName) && v.name.includes("Natural"));
                }

                // ==============================================================
                 
                // 목소리 적용
                if (selectedVoice) {
                    utterance.voice = selectedVoice;
                    utterance.lang = selectedVoice.lang;
                    // console.log(`[TTS] 적용된 목소리: ${selectedVoice.name} (${selectedVoice.lang})`);
                } else {
                    // 목소리 객체를 못 찾아도 언어 코드는 강제로 박아넣음
                    utterance.lang = isUK ? 'en-GB' : 'en-US';
                    // console.log(`[TTS] 목소리 못 찾음. 언어 코드만 적용: ${utterance.lang}`);
                }

                utterance.rate = (contentType === 'word') ? 1.0 : 0.9;
                 
                state.isSpeaking = true;

                utterance.onend = () => {
                    state.isSpeaking = false;
                    resolve();
                };

                utterance.onerror = (e) => {
                    console.error("TTS 오류:", e);
                    state.isSpeaking = false;
                    resolve();
                };

                window.speechSynthesis.speak(utterance);
            };

// [안드로이드 필수] voices가 비어있으면 로드될 때까지 대기
            if (window.speechSynthesis.getVoices().length === 0) {
                // [수정됨] 이벤트가 한 번 발생하면 즉시 리스너를 제거하여 중복 실행(3번 반복) 및 섞임 방지
                const voiceChangedHandler = () => {
                    window.speechSynthesis.onvoiceschanged = null; // 중요: 리스너 연결 해제
                    setVoice();
                };
                window.speechSynthesis.onvoiceschanged = voiceChangedHandler;
            } else {
                setVoice();
            }
        });
    },

// api.js 파일 내의 translate 함수 교체

    async translate(text) {
        if (!text) return "";

        // 1. 캐시 확인 (기존 로직 유지)
        try {
            // 캐시 객체가 있는지 확인 후 가져오기
            if (typeof translationCache !== 'undefined') {
                const cached = await translationCache.get(text);
                if (cached) return cached;
            }
        } catch (e) { 
            console.warn("Cache check failed:", e); 
        }

        // 2. GAS(Google Apps Script) 무료 번역 호출
        try {
            // config.js에 있는 SCRIPT_URL을 가져옵니다.
            const scriptBaseUrl = config.SCRIPT_URL;
            
            if (!scriptBaseUrl) {
                console.error("Config Error: SCRIPT_URL is missing.");
                return "설정 오류: 서버 주소 없음";
            }

            // URL 생성 (action=translate)
            // 주의: 보내주신 GAS 코드에 맞춰 action 이름을 'translate'로 설정했습니다.
            const url = new URL(scriptBaseUrl);
            url.searchParams.append('action', 'translate');
            url.searchParams.append('text', text);

            const response = await fetch(url.toString());

            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }

            const data = await response.json();

            // 3. 결과 처리
            if (data.success) {
                const translatedText = data.translatedText;

                // 캐시에 저장
                try {
                    if (typeof translationCache !== 'undefined' && translatedText) {
                        translationCache.save(text, translatedText);
                    }
                } catch (e) {}

                return translatedText;
            } else {
                throw new Error(data.message || "번역 실패");
            }

        } catch (error) {
            console.error("Translation Error:", error);
            return "번역 서버 연결 실패 (잠시 후 다시 시도)";
        }
    },
    
    // ==========================================================================
    // [아래부터는 원본 코드 100% 동일 유지]
    // ==========================================================================

     async updateWordStatus(word, quizType, result) {
         if (!state.userId || !word || !quizType) return;
         if (!state.currentProgress[word]) state.currentProgress[word] = {};
         state.currentProgress[word][quizType] = result;
         utils.addProgressUpdateToLocalSync(word, quizType, result);
         this.saveQuizHistoryToLocal(quizType, result === 'correct');
     },

    async loadUserProgress() {
        if (!state.userId) return;
        const { doc, getDoc } = window.firebaseSDK;
        const progressRef = doc(db, 'users', state.userId, 'progress', 'main');
        try {
            const docSnap = await getDoc(progressRef);
            state.currentProgress = docSnap.exists() ? docSnap.data() : {};
        } catch (error) {
            state.currentProgress = {};
        }
    },

    async fetchDefinition(word) {
        const apiKey = config.DEFINITION_API_KEY;
        const url = `https://dictionaryapi.com/api/v3/references/learners/json/${encodeURIComponent(word)}?key=${apiKey}`;
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                const firstResult = data[0];
                if (typeof firstResult === 'object' && firstResult !== null && firstResult.shortdef && Array.isArray(firstResult.shortdef) && firstResult.shortdef.length > 0) {
                    return firstResult.shortdef[0];
                }
            }
            return null;
        } catch (e) { return null; }
    },

    async toggleFavorite(word) {
        if (!state.userId || !word) return false;
        const isCurrentlyFavorite = utils.isFavorite(word);
        const newFavoriteStatus = !isCurrentlyFavorite;

        if (!state.currentProgress[word]) state.currentProgress[word] = {};
        state.currentProgress[word].favorite = newFavoriteStatus;
        state.currentProgress[word].favoritedAt = newFavoriteStatus ? Date.now() : 0;

        utils.addProgressUpdateToLocalSync(word, 'favorite', newFavoriteStatus);
        utils.addProgressUpdateToLocalSync(word, 'favoritedAt', state.currentProgress[word].favoritedAt);
        return newFavoriteStatus;
    },

    async updateStudyTime(seconds) {
        if (!state.userId || seconds < 1) return;
        const { doc, setDoc, getDoc } = window.firebaseSDK;
        const today = new Date().toISOString().slice(0, 10);
        const historyRef = doc(db, 'users', state.userId, 'history', 'study');
        try {
            const docSnap = await getDoc(historyRef);
            const currentSeconds = (docSnap.exists() && docSnap.data()[today]) ? docSnap.data()[today] : 0;
            await setDoc(historyRef, { [today]: currentSeconds + seconds }, { merge: true });
        } catch (error) { console.error(error); }
    },

    async getStudyHistory() {
        if (!state.userId) return {};
        try {
            const { doc, getDoc } = window.firebaseSDK;
            if (!db) return {}; 
            const historyRef = doc(db, 'users', state.userId, 'history', 'study');
            const docSnap = await getDoc(historyRef);
            return docSnap.exists() ? docSnap.data() : {};
        } catch(e) { 
            console.warn("학습 기록 로딩 실패:", e);
            return {}; 
        }
    },

    async getQuizHistory() {
        if (!state.userId) return {};
        try {
            const { doc, getDoc } = window.firebaseSDK;
            if (!db) return {};
            const historyRef = doc(db, 'users', state.userId, 'history', 'quiz');
            const docSnap = await getDoc(historyRef);
            return docSnap.exists() ? docSnap.data() : {};
        } catch(e) { 
            console.warn("퀴즈 기록 로딩 실패:", e);
            return {}; 
        }
    },

    saveQuizHistoryToLocal(quizType, isCorrect) {
        try {
            const stats = JSON.parse(localStorage.getItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ) || '{}');
            if (!stats[quizType]) stats[quizType] = { total: 0, correct: 0 };
            stats[quizType].total += 1;
            if (isCorrect) stats[quizType].correct += 1;
            localStorage.setItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ, JSON.stringify(stats));
        } catch (e) {}
    },

    async syncQuizHistory(statsToSync) {
        if (!state.userId || !statsToSync) return;
        const { doc, setDoc, getDoc } = window.firebaseSDK;
        const today = new Date().toISOString().slice(0, 10);
        const historyRef = doc(db, 'users', state.userId, 'history', 'quiz');
        try {
            const docSnap = await getDoc(historyRef);
            const data = docSnap.exists() ? docSnap.data() : {};
            const todayData = data[today] || {};
            for (const type in statsToSync) {
                if (statsToSync.hasOwnProperty(type)) {
                    const typeStats = todayData[type] || { correct: 0, total: 0 };
                    typeStats.total += statsToSync[type].total;
                    typeStats.correct += statsToSync[type].correct;
                    todayData[type] = typeStats;
                }
            }
            await setDoc(historyRef, { [today]: todayData }, { merge: true });
        } catch(e) { console.error(e); }
    },

    async syncProgressUpdates(progressToSync) {
         if (!state.userId || !progressToSync || Object.keys(progressToSync).length === 0) return;
         const { doc, setDoc } = window.firebaseSDK;
         const progressRef = doc(db, 'users', state.userId, 'progress', 'main');
         try { await setDoc(progressRef, progressToSync, { merge: true }); } catch (error) { console.error(error); }
     },

// 1. AI 예문 생성 (GAS 안 거치고 바로 Gemini 호출)
// --------------------------------------------------------------------------
async generateAIExamples(wordData, currentMeaning, count = 2) {
    const word = wordData.word;
    if (!word) return [];

    console.log(`🚀 AI 예문 생성 요청 (Direct Gemini): ${word}`);

    // 모델명: gemini-1.5-flash (빠르고 저렴함)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const prompt = `
        Word: "${word}"
        Task: Write ${count} simple sentences suitable for children using this word.
        Format: Return ONLY a JSON array of strings. Example: ["Sentence 1.", "Sentence 2."]
        No markdown, no explanations.
    `;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const data = await response.json();

        // 응답 데이터 검증
        if (!data.candidates || !data.candidates[0].content) {
            console.warn("AI 응답 형식 오류:", data);
            return [];
        }

        const text = data.candidates[0].content.parts[0].text;
        
        // 마크다운 제거 및 JSON 파싱
        const cleanJson = JSON.parse(text.replace(/```json|```/g, '').trim());

        // 배열인지 확인 후 반환
        const results = Array.isArray(cleanJson) ? cleanJson : [cleanJson];
        console.log("✅ 예문 생성 완료:", results);
        
        return results;

    } catch (error) {
        console.error("AI 예문 생성 실패:", error);
        return [];
    }
},
    
// [Gemini 2.5 Flash] 타동사 조사 포함, 뜻 번호 매기기 + [줄바꿈 해결]
    async fetchWordInfoFromAI(word) {
        
        // 품질을 위해 2.5-flash 모델 유지
       const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

        const prompt = `
            Act as a linguistics expert for US high school students.
            Analyze the English word: "${word}"

            Output pure JSON with three fields:
            
            1. "meaning": 
               - Return an ARRAY of strings.
               - FORMATTING RULES:
                 1. If there are multiple meanings, number them clearly (e.g., "1. ...", "2. ...").
                 2. **DO NOT** use part-of-speech tags like (vt), (vi), (n), (adj).
                 3. Instead, use the Korean particle to imply the verb type:
                    * Transitive (Vt): MUST start with "~(Object)Particle" (e.g., "1. ~을 관찰하다", "2. ~(법)을 준수하다").
                    * Intransitive (Vi): Do not use a particle (e.g., "1. 살아남다").
                    * If a word is both Vi and Vt (like 'survive'), list BOTH separately:
                      (e.g., "1. 살아남다", "2. ~에서 살아남다").
                 4. Mark (slang) or (informal) if applicable.

            2. "explanation": 
               - Generate a structured text with these KOREAN headers: [동의어], [반의어], [파생어], [용례], [심화].
               - FORMAT RULES:
                 Rule 1 [동의어/반의어]: Group by specific meanings. 
                        Format: "word1, word2, ... : [Korean Definition]"
                        Max 7 words per group.
                        * Ensure the Korean definition follows the 'meaning' formatting rules (particles included, no POS tags).
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
            
            // JSON 파싱
            const cleanJson = JSON.parse(textResponse.replace(/```json|```/g, '').trim());

            // [핵심 수정] 배열로 들어온 뜻(meaning)을 줄바꿈 문자(\n)로 합쳐서 문자열로 변환
            // 이렇게 해야 화면에서 1번, 2번이 아래로 떨어져서 보입니다.
            if (Array.isArray(cleanJson.meaning)) {
                cleanJson.meaning = cleanJson.meaning.join('\n');
            }

            return cleanJson;

        } catch (error) {
            console.error("AI 단어 정보 가져오기 실패:", error);
            throw error;
        }
    },

    // AI 생성 버튼 결과 저장 (AISample 열)
    async saveAISamplesToSheet(wordData, fullEnText) {
        if (config.SCRIPT_URL) {
            const scriptUrl = new URL(config.SCRIPT_URL);
            scriptUrl.searchParams.append('action', 'save_ai_sample');
            scriptUrl.searchParams.append('word', wordData.word);
            scriptUrl.searchParams.append('ai_text', fullEnText); 
            
            fetch(scriptUrl.toString())
                .then(r => r.json())
                .then(d => {
                    if(!d.success) console.warn("시트 저장 실패:", d.message);
                    else console.log("✅ 시트 저장 성공");
                })
                .catch(e => console.error("시트 통신 에러:", e));
        }

        const aiSampleObj = { en: fullEnText, ko: "" };

        if (database) {
            const { ref, update } = window.firebaseSDK;
            const safeKey = wordData.word.replace(/[.#$[\]/]/g, '_');
            const updates = {};
            updates[`/vocabulary/${safeKey}/AISample`] = aiSampleObj;
            
            update(ref(database), updates).then(() => {
                console.log("✅ Firebase 저장 완료");
            }).catch(e => console.warn("Firebase 저장 실패:", e));
        }

        try {
            const cachedData = localStorage.getItem('wordListCache');
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                const targetIndex = parsedCache.words.findIndex(w => w.word === wordData.word);
                if (targetIndex !== -1) {
                    parsedCache.words[targetIndex].AISample = aiSampleObj;
                    localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
                    console.log("✅ 로컬 캐시 업데이트 완료");
                }
            }
        } catch (e) {
            console.error("로컬 캐시 업데이트 실패:", e);
        }
    },

    // [수정] 단어 정보 수정 (Source 개념 제거, sample로 통일)
    async updateWordDetails(originalWord, updateData) {
        // 1. Google Sheets 저장 (백엔드)
        if (config.SCRIPT_URL) {
            const scriptUrl = new URL(config.SCRIPT_URL);
            scriptUrl.searchParams.append('action', 'update_word_data');
            scriptUrl.searchParams.append('original_word', originalWord);
            
            if (updateData.word !== undefined) scriptUrl.searchParams.append('word', updateData.word);
            if (updateData.pos !== undefined) scriptUrl.searchParams.append('pos', updateData.pos);
            if (updateData.meaning !== undefined) scriptUrl.searchParams.append('meaning', updateData.meaning);
            if (updateData.explanation !== undefined) scriptUrl.searchParams.append('explanation', updateData.explanation);
            
            // [핵심 Fix] sample 또는 manual_sample 키가 들어오면 manual_sample 파라미터로 전송
            // learning.js에서 manual_sample로 보내는 경우를 대비하여 OR 연산(||) 추가
            if (updateData.sample !== undefined || updateData.manual_sample !== undefined) {
                scriptUrl.searchParams.append('manual_sample', updateData.manual_sample || updateData.sample);
            }

            fetch(scriptUrl.toString())
                .then(r => r.json())
                .then(d => {
                    if(!d.success) console.warn("시트 수정 실패:", d.message);
                    else console.log("✅ 시트 수정 성공");
                })
                .catch(e => console.error("시트 통신 에러:", e));
        }

        // 2. 로컬 메모리 & 캐시 업데이트 (프론트엔드)
        const updateLocalList = (list) => {
             const targetIndex = list.findIndex(w => w.word === originalWord);
             if (targetIndex !== -1) {
                const targetWord = list[targetIndex];
                
                if (updateData.word !== undefined) targetWord.word = updateData.word;
                if (updateData.pos !== undefined) targetWord.pos = updateData.pos;
                if (updateData.meaning !== undefined) targetWord.meaning = updateData.meaning;
                if (updateData.explanation !== undefined) targetWord.explanation = updateData.explanation;
                
                // [핵심 Fix] Sample 수정 (manual_sample도 반영)
                if (updateData.sample !== undefined) targetWord.sample = updateData.sample;
                if (updateData.manual_sample !== undefined) targetWord.sample = updateData.manual_sample;
             }
        };

        updateLocalList(state.wordList);

        try {
            const cachedData = localStorage.getItem('wordListCache');
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                updateLocalList(parsedCache.words);
                localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
            }
        } catch (e) {
            console.error("캐시 업데이트 오류:", e);
        }
        
        // 3. Firebase 업데이트 (혹시 모를 동기화 누락 방지)
        if (typeof database !== 'undefined' && database) {
            const { ref, update } = window.firebaseSDK;
            const safeKey = originalWord.replace(/[.#$[\]/]/g, '_');
            // updateData를 그대로 활용하되 manual_sample을 sample로 매핑
            const firebaseUpdates = { ...updateData };
            if (firebaseUpdates.manual_sample) {
                firebaseUpdates.sample = firebaseUpdates.manual_sample;
                delete firebaseUpdates.manual_sample;
            }
            // word 키가 바뀌는 경우는 복잡하므로 여기서는 필드 업데이트만 수행
            if (!updateData.word || updateData.word === originalWord) {
                 update(ref(database, `/vocabulary/${safeKey}`), firebaseUpdates).catch(e => console.warn(e));
            }
        }
    },

    // [수정 1] 새 단어 생성 (캐시 도미노 업데이트 적용 완료)
    // [수정] 새 단어 생성 (소수점 인덱싱 적용: 100% 위치 보장)
async createWord(cardData, afterWord = null) {
    
    // POS가 없으면 자동으로 'n/a' 설정
    if (!cardData.pos || !cardData.pos.trim()) {
        cardData.pos = "n/a";
    }

    // ============================================================
    // [핵심 수정] 소수점 인덱스 계산 (사이값 찾기)
    // ============================================================
    let newFirebaseIndex = 0;
    
    // 정확한 계산을 위해 현재 리스트를 순서대로 정렬
    const sortedList = [...state.wordList].sort((a, b) => (a.index || 0) - (b.index || 0));

    if (afterWord) {
        const prevIdx = sortedList.findIndex(w => w.word === afterWord);
        
        if (prevIdx !== -1) {
            const prevVal = sortedList[prevIdx].index || 0;
            
            // 다음 단어가 있는지 확인
            if (prevIdx < sortedList.length - 1) {
                const nextVal = sortedList[prevIdx + 1].index || (prevVal + 1);
                // [핵심] 5와 6 사이면 5.5를 부여 (절대 안 겹침)
                newFirebaseIndex = (prevVal + nextVal) / 2;
            } else {
                // 맨 마지막 단어 뒤라면 그냥 +1
                newFirebaseIndex = prevVal + 1;
            }
        } else {
            // 기준 단어를 못 찾았으면 맨 뒤로
            newFirebaseIndex = (sortedList.length > 0 ? sortedList[sortedList.length - 1].index : 0) + 1;
        }
    } else {
        // 기준 단어가 없으면(맨 뒤 추가)
        newFirebaseIndex = (sortedList.length > 0 ? sortedList[sortedList.length - 1].index : 0) + 1;
    }
    // ============================================================

    // 1. 서버로 보낼 URL 파라미터 구성 (Google Sheet)
    if (config.SCRIPT_URL) {
        const scriptUrl = new URL(config.SCRIPT_URL);
        scriptUrl.searchParams.append('action', 'create_word');
        scriptUrl.searchParams.append('word', cardData.word);
        scriptUrl.searchParams.append('pos', cardData.pos || ""); 
        scriptUrl.searchParams.append('meaning', cardData.meaning || "");
        scriptUrl.searchParams.append('explanation', cardData.explanation || "");
        scriptUrl.searchParams.append('manual_sample', cardData.manual_sample || cardData.sample || ""); 

        if (afterWord) {
            scriptUrl.searchParams.append('after_word', afterWord);
        }

        fetch(scriptUrl.toString())
            .then(r => r.json())
            .then(d => {
                if (!d.success) console.warn("시트 생성 실패:", d.message);
            })
            .catch(e => console.error("시트 통신 에러:", e));
    }

    // 2. LocalStorage 캐시 업데이트 (로컬에서는 도미노 방식 유지해도 됨)
    // 하지만 일관성을 위해 로컬 상태도 업데이트
    try {
        const cachedData = localStorage.getItem('wordListCache');
        if (cachedData) {
            const parsedCache = JSON.parse(cachedData);
            const words = parsedCache.words || [];

            // 로컬 배열에서의 삽입 위치 찾기
            let localInsertPos = words.length;
            if (afterWord) {
                const fIndex = words.findIndex(w => w.word === afterWord);
                if (fIndex !== -1) localInsertPos = fIndex + 1;
            }

            // 새 객체 생성 (Firebase용 인덱스 사용)
            const newWordObj = {
                ...cardData,
                sample: cardData.manual_sample || cardData.sample || "",
                AISample: null,
                index: newFirebaseIndex // 계산된 소수점 인덱스 저장
            };

            // 배열 삽입
            words.splice(localInsertPos, 0, newWordObj);
            
            // 저장
            parsedCache.words = words;
            localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
            
            // 앱 상태 즉시 동기화 (화면 갱신용)
            state.wordList = words;
        }
    } catch (e) {
        console.error("로컬 캐시 업데이트 중 오류:", e);
    }

    // 3. Firebase 업데이트 (소수점 인덱스로 저장)
    if (database) {
        const { ref, update } = window.firebaseSDK;
        const safeKey = cardData.word.replace(/[.#$[\]/]/g, '_');
        
        const updates = {};
        updates[`/vocabulary/${safeKey}`] = {
            ...cardData,
            sample: cardData.manual_sample || cardData.sample || "", 
            AISample: null,
            index: newFirebaseIndex // [5.5] 같은 소수점 값이 저장됨 -> 정렬 보장
        };
        update(ref(database), updates).catch(e => console.warn(e));
    }
},

    async deleteWord(word) {
        // 1. Google Sheets 삭제 요청 (백엔드)
        if (config.SCRIPT_URL) {
            const scriptUrl = new URL(config.SCRIPT_URL);
            scriptUrl.searchParams.append('action', 'delete_word');
            scriptUrl.searchParams.append('word', word);
            
            fetch(scriptUrl.toString())
                .then(r => r.json())
                .then(d => {
                    if(!d.success) console.warn("시트 삭제 실패:", d.message);
                    else console.log("✅ 시트 삭제 성공");
                })
                .catch(e => console.error("시트 통신 에러:", e));
        }

        // 2. 로컬 메모리(State)에서 즉시 삭제 (UI 반영용)
        state.wordList = state.wordList.filter(w => w.word !== word);

        // 3. 로컬 캐시(LocalStorage) 삭제
        try {
            const cachedData = localStorage.getItem('wordListCache');
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                parsedCache.words = parsedCache.words.filter(w => w.word !== word);
                localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
            }
        } catch (e) {}

        // ============================================================
        // [누락된 코드 추가] Firebase에서도 즉시 삭제해야 다시 안 살아남
        // ============================================================
        if (database) {
            const { ref, remove } = window.firebaseSDK;
            const safeKey = word.replace(/[.#$[\]/]/g, '_');
            
            // Firebase의 해당 단어 경로를 찾아서 제거
            remove(ref(database, `/vocabulary/${safeKey}`))
                .then(() => console.log("✅ Firebase 삭제 성공"))
                .catch(e => console.warn("Firebase 삭제 실패:", e));
        }
    }
};
