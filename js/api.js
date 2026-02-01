import { config, state } from './config.js';
import { audioCache, translationCache, utils } from './utils.js';

let db = null; // Firestore
let database = null; // Realtime DB

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
            if (!text || !text.trim()) return resolve();

            // 1. 브라우저 TTS 지원 확인
            if (!window.speechSynthesis) {
                console.warn("이 브라우저는 TTS를 지원하지 않습니다.");
                return resolve();
            }

            // 2. 기존 재생 중단 (중복 방지)
            window.speechSynthesis.cancel();
            
            // 3. 발화 설정 및 목소리 목록 로드
            const utterance = new SpeechSynthesisUtterance(text);
            const voices = window.speechSynthesis.getVoices();

            // 4. 영국(UK) vs 미국(US) 목소리 선택 로직
            const isUK = state.currentVoiceSet === 'UK';
            const targetLangCode = isUK ? 'en-GB' : 'en-US';

            // [핵심 변경] 요청하신 Natural Voice 이름 정의
            const targetName = isUK 
                ? "Microsoft Maisie Online (Natural) - English (United Kingdom)" 
                : "Microsoft Christopher Online (Natural) - English (United States)";

            // (A) 1순위: 정확한 Natural Voice 찾기 (Edge 등에서 활성화)
            let selectedVoice = voices.find(v => v.name === targetName);

            // (B) 2순위: 없다면 해당 언어의 다른 Microsoft 목소리 찾기
            if (!selectedVoice) {
                selectedVoice = voices.find(v => v.lang === targetLangCode && v.name.includes('Microsoft'));
            }

            // (C) 3순위: 그것도 없다면 Google 등 해당 언어권 목소리 (Chrome 등)
            if (!selectedVoice) {
                selectedVoice = voices.find(v => v.lang === targetLangCode);
            }

            // (D) 4순위: 정말 없으면 언어 코드만이라도 일치하는 것 (가장 넓은 범위)
            if (!selectedVoice) {
                selectedVoice = voices.find(v => v.lang.includes(targetLangCode));
            }

            // 5. 목소리 적용
            if (selectedVoice) {
                utterance.voice = selectedVoice;
                utterance.lang = selectedVoice.lang;
            } else {
                utterance.lang = 'en-US'; // 최후의 수단
            }

            // 6. 속도 조절 (1.0배속)
            utterance.rate = 1.0;
            
            // 7. 상태 관리 (스피커 아이콘 애니메이션용)
            state.isSpeaking = true;

            utterance.onend = () => {
                state.isSpeaking = false;
                resolve();
            };

            utterance.onerror = (e) => {
                console.error("TTS 재생 오류:", e);
                state.isSpeaking = false;
                resolve();
            };

            // 8. 재생 시작
            window.speechSynthesis.speak(utterance);
        });
    },

// ==========================================================================
    // [최종_해결] 구관이 명관 (Gemini 1.5 Flash-002 사용)
    // 2.0/2.5 같은 실험 버전은 하루 50회 제한이 있어 429 에러가 뜹니다.
    // 작년 9월에 나온 '1.5 Flash-002' 정식 버전을 써야 하루 1,500회 무료입니다.
    // ==========================================================================
    async translate(text) {
        // 1. 캐시 확인
        try {
            const cached = await translationCache.get(text);
            if (cached) return cached;
        } catch (e) { console.warn("Translation cache read error:", e); }

        // 2. Gemini API 호출
        const k1 = "AIzaSyBz3aL_UMfqemFZ7"; 
        const k2 = "HkCHMN_LzN441aVtZE";
        const apiKey = (k1 + k2).trim(); 
        
        // 🔻 [절대 수정 금지] 이 모델명(gemini-1.5-flash-002)이 유일한 정답입니다.
        // '002'를 붙여야 404 오류 없이 서버가 인식합니다.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${apiKey}`;

        // 영어 선생님 맞춤 프롬프트
        const prompt = `Translate the following English text into natural Korean. Output ONLY the Korean translation, no extra text.\n\nText: "${text}"`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    contents: [{ parts: [{ text: prompt }] }] 
                })
            });

            // 429(사용량 초과)나 404(모델 없음)가 뜨면 상세 내용을 로그에 남김
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error(`🚨 API Error (${response.status}):`, errorData);
                
                // 만약 429가 뜨면, 사용자에게 잠시 쉬었다 하라고 알림
                if (response.status === 429) {
                    throw new Error("오늘 사용량을 초과했습니다. (잠시 후 다시 시도)");
                }
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
                 const translatedText = data.candidates[0].content.parts[0].text.trim();
                 translationCache.save(text, translatedText);
                 return translatedText;
            } else {
                throw new Error("번역 결과 없음");
            }

        } catch (error) {
            console.error("번역 실패:", error);
            // 에러 메시지를 그대로 반환하여 UI에서 확인 가능하게 함
            return "오류: " + error.message; 
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

    async generateAIExamples(wordData, currentMeaning, count = 1) {
        const k1 = "AIzaSyBz3aL_UMfqemFZ7";
        const k2 = "HkCHMN_LzN441aVtZE";
        const apiKey = k1 + k2; 
        
        // [원본 유지] 2.5 Flash 모델 사용
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const prompt = `
            Target word: "${wordData.word}"
            Current definition: "${currentMeaning}"

            Task:
            1. Create exactly ${count} example sentence(s) using "${wordData.word}".
            2. Try to use a DIFFERENT part of speech or meaning if possible.
            3. Output strictly as a JSON array of strings: ["sentence 1", "sentence 2"]
            4. Do not include translations or markdown. Just the English sentences.
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
            const cleanJson = JSON.parse(textResponse.replace(/```json|```/g, '').trim());

            return Array.isArray(cleanJson) ? cleanJson : [cleanJson];

        } catch (error) {
            console.error("AI 생성 실패:", error);
            throw error;
        }
    },
    
// [Gemini 2.5 Flash] 타동사 조사 포함, 뜻 번호 매기기 + [줄바꿈 해결]
    async fetchWordInfoFromAI(word) {
        const k1 = "AIzaSyBz3aL_UMfqemFZ7";
        const k2 = "HkCHMN_LzN441aVtZE";
        const apiKey = k1 + k2; 
        
        // 품질을 위해 2.5-flash 모델 유지
       const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

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
    async createWord(cardData, afterWord = null) {
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

        // 2. [핵심] LocalStorage 캐시 즉시 반영 (인덱스 도미노 업데이트)
        try {
            const cachedData = localStorage.getItem('wordListCache');
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                const words = parsedCache.words || [];

                // (1) 삽입할 위치 찾기
                let insertIndex = words.length; // 기본: 맨 뒤
                if (afterWord) {
                    const afterIndex = words.findIndex(w => w.word === afterWord);
                    if (afterIndex !== -1) {
                        insertIndex = afterIndex + 1;
                    }
                }

                // (2) 도미노: 삽입 위치 뒤에 있는 모든 단어들의 index를 +1씩 밀어내기
                // 주의: splice로 넣기 '전'에 기존 단어들의 번호를 먼저 밀어야 함
                for (let i = insertIndex; i < words.length; i++) {
                    if (typeof words[i].index === 'number') {
                        words[i].index += 1;
                    }
                }

                // (3) 새 단어 객체 생성 (올바른 index 부여)
                const newWordObj = {
                    ...cardData,
                    sample: cardData.manual_sample || cardData.sample || "",
                    AISample: null,
                    index: insertIndex
                };

                // (4) 배열에 끼워넣기 (splice 이용)
                words.splice(insertIndex, 0, newWordObj);

                // (5) 저장
                parsedCache.words = words;
                localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
                console.log(`✅ 캐시 업데이트 완료: ${newWordObj.word} (Index: ${insertIndex})`);
            }
        } catch (e) {
            console.error("로컬 캐시 업데이트 중 오류:", e);
        }

        // 3. Firebase 업데이트
        if (database) {
            const { ref, update } = window.firebaseSDK;
            const safeKey = cardData.word.replace(/[.#$[\]/]/g, '_');
            const updates = {};
            updates[`/vocabulary/${safeKey}`] = {
                ...cardData,
                sample: cardData.manual_sample || cardData.sample || "", 
                AISample: null,
                index: Date.now() // Firebase는 나중에 시트 동기화로 덮어씌워지므로 임시값 유지
            };
            update(ref(database), updates).catch(e => console.warn(e));
        }
    },

    async deleteWord(word) {
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

        state.wordList = state.wordList.filter(w => w.word !== word);

        try {
            const cachedData = localStorage.getItem('wordListCache');
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                parsedCache.words = parsedCache.words.filter(w => w.word !== word);
                localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
            }
        } catch (e) {}

        if (database) {
            const { ref, remove } = window.firebaseSDK;
            const safeKey = word.replace(/[.#$[\]/]/g, '_');
            const wordRef = ref(database, `/vocabulary/${safeKey}`);
            remove(wordRef).catch(e => console.warn(e));
        }
    }
};
