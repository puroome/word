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
        const { doc, getDoc } = window.firebaseSDK;
        const historyRef = doc(db, 'users', state.userId, 'history', 'study');
        try {
            const docSnap = await getDoc(historyRef);
            return docSnap.exists() ? docSnap.data() : {};
        } catch(e) { return {}; }
    },

    async getQuizHistory() {
        if (!state.userId) return {};
        const { doc, getDoc } = window.firebaseSDK;
        const historyRef = doc(db, 'users', state.userId, 'history', 'quiz');
        try {
            const docSnap = await getDoc(historyRef);
            return docSnap.exists() ? docSnap.data() : {};
        } catch(e) { return {}; }
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
            
            // sample 수정 시 무조건 manual_sample 파라미터 사용 (앱스스크립트에서 매핑됨)
            if (updateData.sample !== undefined) scriptUrl.searchParams.append('manual_sample', updateData.sample);

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
                
                // Sample 수정
                if (updateData.sample !== undefined) {
                     targetWord.sample = updateData.sample;
                     // Source 업데이트 로직 제거됨
                }
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
    },

    // [수정] 새 단어 생성 (Source 초기화 제거)
    async createWord(wordData, afterWord) {
        if (config.SCRIPT_URL) {
            const scriptUrl = new URL(config.SCRIPT_URL);
            scriptUrl.searchParams.append('action', 'create_word');
            scriptUrl.searchParams.append('word', wordData.word);
            scriptUrl.searchParams.append('pos', wordData.pos || "");
            scriptUrl.searchParams.append('meaning', wordData.meaning || "");
            scriptUrl.searchParams.append('explanation', wordData.explanation || "");
            if (afterWord) scriptUrl.searchParams.append('after_word', afterWord);

            fetch(scriptUrl.toString())
                .then(r => r.json())
                .then(d => {
                    if(!d.success) console.warn("시트 생성 실패:", d.message);
                    else console.log("✅ 시트 생성 성공 (삽입)");
                })
                .catch(e => console.error("시트 통신 에러:", e));
        }

        // 로컬 데이터에 중간 삽입
        let insertIndex = state.wordList.length;
        let prevIndexVal = 0;

        if (afterWord) {
            const idx = state.wordList.findIndex(w => w.word === afterWord);
            if (idx !== -1) {
                insertIndex = idx + 1;
                prevIndexVal = state.wordList[idx].index;
            } else if (state.wordList.length > 0) {
                prevIndexVal = Math.max(...state.wordList.map(w => w.index));
            }
        } else if (state.wordList.length > 0) {
            prevIndexVal = Math.max(...state.wordList.map(w => w.index));
        }

        const localNewWordObj = {
            index: prevIndexVal + 1,
            word: wordData.word,
            pos: wordData.pos || "",
            meaning: wordData.meaning || "",
            explanation: wordData.explanation || "",
            sample: "",
            AISample: null
            // sampleSource 제거됨
        };
        
        state.wordList.splice(insertIndex, 0, localNewWordObj);
        
        for (let i = insertIndex + 1; i < state.wordList.length; i++) {
             state.wordList[i].index += 1;
        }

         try {
            const cachedData = localStorage.getItem('wordListCache');
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                let cacheInsertIdx = parsedCache.words.length;
                if (afterWord) {
                    const cIdx = parsedCache.words.findIndex(w => w.word === afterWord);
                    if (cIdx !== -1) cacheInsertIdx = cIdx + 1;
                }
                parsedCache.words.splice(cacheInsertIdx, 0, localNewWordObj);
                for(let i = cacheInsertIdx + 1; i < parsedCache.words.length; i++) {
                    parsedCache.words[i].index += 1;
                }
                localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
            }
        } catch (e) {}

        // Firebase 저장 (Index 포함)
        if (database) {
            const { ref, update } = window.firebaseSDK;
            const safeKey = wordData.word.replace(/[.#$\[\]\/]/g, '_');
            const firebasePayload = { ...localNewWordObj };
            delete firebasePayload.isNew; 

            const updates = {};
            updates[`/vocabulary/${safeKey}`] = firebasePayload;
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