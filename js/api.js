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

    async speak(text, contentType = 'word') {
        const voiceSets = {
            'UK': { 'word': { languageCode: 'en-GB', name: 'en-GB-Wavenet-D', ssmlGender: 'MALE' }, 'sample': { languageCode: 'en-GB', name: 'en-GB-Journey-D', ssmlGender: 'MALE' } },
            'US': { 'word': { languageCode: 'en-US', name: 'en-US-Wavenet-F', ssmlGender: 'FEMALE' }, 'sample': { languageCode: 'en-US', name: 'en-US-Journey-F', ssmlGender: 'FEMALE' } }
        };

        if (!text || !text.trim()) return;

        if (state.currentSource) {
            try { state.currentSource.stop(); } catch (e) {}
            state.currentSource = null;
        }

        if (!state.audioContext) {
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                state.audioContext = new AudioContext();
            } catch (e) { console.error(e); return; }
        }

        if (state.audioContext.state === 'suspended') {
            try { await state.audioContext.resume(); } catch (e) { console.error(e); }
        }

        state.isSpeaking = true;
        const textWithoutEmoji = text.replace(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u, '');
        const processedText = textWithoutEmoji.replace(/\bsb\b/g, 'somebody').replace(/\bsth\b/g, 'something');
        const voiceConfig = voiceSets[state.currentVoiceSet][contentType];
        const cacheKey = `${processedText}|${voiceConfig.languageCode}|${voiceConfig.name}`;

        const playAudio = async (audioArrayBuffer) => {
            try {
                const audioBuffer = await state.audioContext.decodeAudioData(audioArrayBuffer);
                const source = state.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(state.audioContext.destination);
                state.currentSource = source;
                source.start(0);
                source.onended = () => {
                    state.isSpeaking = false;
                    if (state.currentSource === source) {
                        state.currentSource = null;
                    }
                };
            } catch (decodeError) {
                 console.error("Error decoding audio data:", decodeError);
                 state.isSpeaking = false;
            }
        };

        try {
            const cachedAudio = await audioCache.getAudio(cacheKey);
            if (cachedAudio) {
                await playAudio(cachedAudio.slice(0));
                return;
            }

            const TTS_URL = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${config.TTS_API_KEY}`;
            const response = await fetch(TTS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: { text: processedText }, voice: voiceConfig, audioConfig: { audioEncoding: 'MP3' } })
            });
            if (!response.ok) throw new Error(`TTS API Error`);

            const data = await response.json();
            const byteCharacters = atob(data.audioContent);
            const byteArray = new Uint8Array(byteCharacters.length).map((_, i) => byteCharacters.charCodeAt(i));
            const audioArrayBuffer = byteArray.buffer;

            audioCache.saveAudio(cacheKey, audioArrayBuffer.slice(0));
            await playAudio(audioArrayBuffer);

        } catch (error) {
            console.error('TTS 재생 또는 캐싱에 실패했습니다:', error);
            state.isSpeaking = false;
        }
    },

    async translate(text) {
        try {
            const cached = await translationCache.get(text);
            if (cached) return cached;
        } catch (e) { console.warn("Translation cache read error:", e); }

        if (!config.SCRIPT_URL) return "번역 스크립트 URL이 설정되지 않았습니다.";

        const url = new URL(config.SCRIPT_URL);
        url.searchParams.append('action', 'translate');
        url.searchParams.append('text', text);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            if (data.success) {
                translationCache.save(text, data.translatedText);
                return data.translatedText;
            } else {
                throw new Error(data.message || '번역 실패');
            }
        } catch (error) {
            console.error("Translation API error:", error);
            return "번역 오류";
        }
    },

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
        const k1 = "AIzaSyAdXvE2SkyEbPmU";
        const k2 = "XtLUeVi7f-niGpXUu_0";
        const apiKey = k1 + k2; 
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

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
    
// [재수정] 예문 개수 로직 (단일 뜻 1개, 다의어 최대 5개)
    async fetchWordInfoFromAI(word) {
        const k1 = "AIzaSyAdXvE2SkyEbPmU";
        const k2 = "XtLUeVi7f-niGpXUu_0";
        const apiKey = k1 + k2; 
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const prompt = `
            Analyze the English word: "${word}"

            Output pure JSON with three fields:
            1. "meaning": The most common Korean meaning(s).
            2. "explanation": 
               - Generate a structured text with these KOREAN headers: [동의어], [반의어], [파생어], [용례].
               - FORMAT RULES:
                 Rule 1: Use the format "English Word : Korean Meaning" (No parentheses, use colon).
                 Rule 2: English items for [동의어]/[반의어] must also have Korean meanings.
                 Rule 3: Insert an empty line between categories.
                 Rule 4: If a category is empty, omit it.
            
            3. "samples": An array of English example sentences.
               - QUANTITY LOGIC (Strictly Follow):
                 Case A: If the word has only ONE common meaning/usage -> Generate EXACTLY 1 sentence.
                 Case B: If the word has DISTINCT meanings (e.g., Noun vs Verb, or totally different definitions) -> Generate 1 sentence per distinct meaning.
                 Max Limit: Up to 5 sentences total.
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
            
            const cleanJson = JSON.parse(textResponse.replace(/```json|```/g, '').trim());

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
            const safeKey = wordData.word.replace(/[.#$\[\]\/]/g, '_');
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
            const safeKey = originalWord.replace(/[.#$\[\]\/]/g, '_');
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

// [수정 1] 새 단어 생성 (즉시 반영: Optimistic Update 적용)
async createWord(cardData, afterWord = null) {
        // 1. 서버 전송 (Google Sheets) - 비동기로 실행 (결과 기다리지 않음)
        if (config.SCRIPT_URL) {
            const scriptUrl = new URL(config.SCRIPT_URL);
            scriptUrl.searchParams.append('action', 'create_word');
            scriptUrl.searchParams.append('word', cardData.word);
            scriptUrl.searchParams.append('pos', cardData.pos || "");
            scriptUrl.searchParams.append('meaning', cardData.meaning || "");
            scriptUrl.searchParams.append('explanation', cardData.explanation || "");
            // 예문 데이터 전송
            scriptUrl.searchParams.append('manual_sample', cardData.manual_sample || cardData.sample || ""); 

            if (afterWord) {
                scriptUrl.searchParams.append('after_word', afterWord);
            }

            // fetch만 날리고 결과는 기다리지 않음 (Fire and Forget)
            fetch(scriptUrl.toString())
                .then(r => r.json())
                .then(d => { if (!d.success) console.warn("시트 생성 실패:", d.message); })
                .catch(e => console.error("시트 통신 에러:", e));
        }

        // 2. [앱 내부 반영] 적절한 인덱스(순서) 계산
        // 단순히 Date.now()를 쓰면 맨 뒤로 가므로, 앞뒤 단어의 사이값(중간값)을 계산해야 함.
        let newIndex;
        let insertPosition = state.wordList.length; // 기본값: 배열 맨 끝

        if (afterWord) {
            const targetIdx = state.wordList.findIndex(w => w.word === afterWord);
            if (targetIdx !== -1) {
                insertPosition = targetIdx + 1; // 끼워 넣을 위치 (타겟 바로 뒤)
                
                const prevIndex = state.wordList[targetIdx].index;
                // 다음 단어가 있으면 그 사이값, 없으면 +1
                const nextIndex = (targetIdx + 1 < state.wordList.length) 
                                  ? state.wordList[targetIdx + 1].index 
                                  : (prevIndex + 2); 
                
                // [핵심] 1번과 2번 사이에 넣으려면 1.5번을 부여 (소수점 인덱스 사용)
                newIndex = (prevIndex + nextIndex) / 2;
            } else {
                // afterWord를 못 찾았으면 맨 뒤로
                const lastIdx = state.wordList.length > 0 ? state.wordList[state.wordList.length - 1].index : 0;
                newIndex = lastIdx + 1;
            }
        } else {
            // 맨 뒤 추가
            const lastIdx = state.wordList.length > 0 ? state.wordList[state.wordList.length - 1].index : 0;
            newIndex = lastIdx + 1;
        }

        // 3. state.wordList 및 LocalStorage 즉시 업데이트
        const newWordObj = {
            ...cardData,
            sample: cardData.manual_sample || cardData.sample || "",
            AISample: null,
            index: newIndex // 계산된 중간값 사용 -> 제자리에 쏙 들어감
        };

        // (1) 현재 메모리(State)에 끼워 넣기
        state.wordList.splice(insertPosition, 0, newWordObj);

        // (2) 로컬 캐시(LocalStorage)에도 끼워 넣기 (새로고침 해도 유지되도록)
        try {
            const cachedData = localStorage.getItem('wordListCache');
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                
                // 캐시에도 동일한 위치에 삽입
                if (afterWord) {
                    const cacheTargetIdx = parsedCache.words.findIndex(w => w.word === afterWord);
                    if (cacheTargetIdx !== -1) {
                        parsedCache.words.splice(cacheTargetIdx + 1, 0, newWordObj);
                    } else {
                        parsedCache.words.push(newWordObj);
                    }
                } else {
                    parsedCache.words.push(newWordObj);
                }
                localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
            }
        } catch (e) {
            console.error("로컬 캐시 추가 실패:", e);
        }

        // 4. Firebase 업데이트 (다른 기기 즉시 동기화용)
        if (database) {
            const { ref, update } = window.firebaseSDK;
            const safeKey = cardData.word.replace(/[.#$\[\]\/]/g, '_');
            const updates = {};
            updates[`/vocabulary/${safeKey}`] = newWordObj;
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
            const safeKey = word.replace(/[.#$\[\]\/]/g, '_');
            const wordRef = ref(database, `/vocabulary/${safeKey}`);
            remove(wordRef).catch(e => console.warn(e));
        }
    }
};
