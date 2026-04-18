import { config, state } from './config.js';
import { translationCache, utils } from './utils.js';

let db = null; // Firestore
let database = null; // Realtime DB
let activeSpeakId = 0;

export const api = {
    
    init(firestoreInstance, realtimeDbInstance) {
        db = firestoreInstance;
        database = realtimeDbInstance;
    },

    async loadWordList(force = false) {
        if (force) {
            localStorage.removeItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE);
            state.isWordListReady = false;
        }

        if (!state.isWordListReady) {
            try {
                const cachedData = localStorage.getItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE);
                if (cachedData) {
                    const { timestamp, words } = JSON.parse(cachedData);
                    state.wordList = words.sort((a, b) => a.index - b.index);
                    state.isWordListReady = true;
                    state.lastCacheTimestamp = timestamp;
                }
            } catch (e) {
                localStorage.removeItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE);
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
            localStorage.setItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE, JSON.stringify(cachePayload));
            state.lastCacheTimestamp = newTimestamp;
        } catch (error) {
            throw error;
        }
    },

    // ==========================================================================
    // 무료 TTS (Microsoft Natural Voice 우선 적용)
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

            const processedText = text.replace(/\bsb\b/gi, 'somebody').replace(/\bsth\b/gi, 'something');
            const utterance = new SpeechSynthesisUtterance(processedText);

            // ✨ [최적화] 긴 문장 읽을 때 브라우저가 메모리에서 날려버려 뚝 끊기는 버그 방지
            state.currentUtterance = utterance;

            const setVoice = () => {
    if (myRequestId !== activeSpeakId) return;
    const voices = window.speechSynthesis.getVoices();
    const isUK = state.currentVoiceSet === 'UK';
    const targetLang = isUK ? 'en-gb' : 'en-us';
    
    let selectedVoice = null;

    if (isUK) {
        // ✅ 영국: 원래 코드 그대로 복원
        selectedVoice = voices.find(v => 
            v.name.includes("Microsoft Ryan") && v.name.includes("United Kingdom")
        );
    } else {
        // ✅ 미국: Natural/Neural 목소리 우선순위 지정
        const usNaturalVoices = [
            "Microsoft Aria",   // Edge Neural (여성)
            "Microsoft Jenny",      // Edge Neural (여성)
            "Microsoft Davis",    // Edge Neural (남성)
            "Microsoft Tony",     // Edge Neural (남성)
            "Microsoft Eric",     // Edge Neural (남성)
            "Microsoft Guy",     // Edge Neural (남성)
            "Microsoft Andrew",    // Edge Neural (남성)
        ];
        
        for (const name of usNaturalVoices) {
            selectedVoice = voices.find(v => v.name.includes(name));
            if (selectedVoice) break;
        }
    }

    // 공통 폴백: 언어 코드로 찾기
    if (!selectedVoice) {
        selectedVoice = voices.find(v => {
            const vLang = v.lang.replace('_', '-').toLowerCase();
            return vLang === targetLang;
        });
    }

    if (!selectedVoice) {
        selectedVoice = voices.find(v => {
            const vLang = v.lang.replace('_', '-').toLowerCase();
            return vLang.includes(targetLang);
        });
    }

    if (!selectedVoice) {
        const naturalName = isUK ? "United Kingdom" : "United States";
        selectedVoice = voices.find(v => v.name.includes(naturalName) && v.name.includes("Natural"));
    }
                 
                if (selectedVoice) {
                    utterance.voice = selectedVoice;
                    utterance.lang = selectedVoice.lang;
                } else {
                    utterance.lang = isUK ? 'en-GB' : 'en-US';
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

            if (window.speechSynthesis.getVoices().length === 0) {
                const voiceChangedHandler = () => {
                    window.speechSynthesis.onvoiceschanged = null;
                    setVoice();
                };
                window.speechSynthesis.onvoiceschanged = voiceChangedHandler;
            } else {
                setVoice();
            }
        });
    },

    async translate(text) {
        if (!text) return "";

        try {
            if (typeof translationCache !== 'undefined') {
                const cached = await translationCache.get(text);
                if (cached) return cached;
            }
        } catch (e) { 
            console.warn("Cache check failed:", e); 
        }

        try {
            const scriptBaseUrl = config.SCRIPT_URL;
            
            if (!scriptBaseUrl) {
                console.error("Config Error: SCRIPT_URL is missing.");
                return "설정 오류: 서버 주소 없음";
            }

            const url = new URL(scriptBaseUrl);
            url.searchParams.append('action', 'translate');
            url.searchParams.append('text', text);

            const response = await fetch(url.toString());

            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                const translatedText = data.translatedText;
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
    // 기존 로직 유지
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

    async toggleExcept(word) {
    if (!word) return false;

    // wordList에서 현재 except 상태 확인
    const wordObj = state.wordList.find(w => w.word === word);
    if (!wordObj) return false;

    const newExceptStatus = !wordObj.except;

    // 로컬 wordList 즉시 업데이트
    wordObj.except = newExceptStatus;

    // 캐시 업데이트
    try {
        const cachedData = localStorage.getItem(state.LOCALSTORAGEKEYS.WORDLISTCACHE);
        if (cachedData) {
            const parsedCache = JSON.parse(cachedData);
            const target = parsedCache.words.find(w => w.word === word);
            if (target) target.except = newExceptStatus;
            localStorage.setItem(state.LOCALSTORAGEKEYS.WORDLISTCACHE, JSON.stringify(parsedCache));
        }
    } catch (e) { console.error('캐시 업데이트 오류', e); }

    // Firebase Realtime DB 직접 업데이트
    if (typeof database !== 'undefined' && database) {
        const { ref, update } = window.firebaseSDK;
        const safeKey = word.replace(/\./g, ',');
        update(ref(database), { [`vocabulary/${safeKey}/except`]: newExceptStatus })
            .catch(e => console.warn('Firebase except 업데이트 오류', e));
    }

    // GAS(구글시트)에도 반영
    if (config.SCRIPTURL) {
        const scriptUrl = new URL(config.SCRIPTURL);
        scriptUrl.searchParams.append('action', 'toggleexcept');
        scriptUrl.searchParams.append('word', word);
        scriptUrl.searchParams.append('value', newExceptStatus ? '1' : '');
        fetch(scriptUrl.toString())
            .then(r => r.json())
            .then(d => { if (!d.success) console.warn('GAS except 업데이트 오류', d.message); })
            .catch(e => console.error('GAS except 오류', e));
    }

    return newExceptStatus;
},
    
    async updateStudyTime(seconds) {
        if (!state.userId || seconds < 1) return;
        const { doc, setDoc, getDoc } = window.firebaseSDK;
        const today = utils.getLocalDateString();
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
        const today = utils.getLocalDateString();
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

    // ==========================================================================
    // [보안 패치] 1. AI 예문 생성 (GAS 경유 방식으로 완전 수정)
    // ==========================================================================
    async generateAIExamples(wordData, currentMeaning, count = 2) {
        const word = wordData.word;
        if (!word) return [];

        console.log(`🚀 AI 예문 생성 요청 (GAS 경유): ${word}`);

        try {
            const scriptBaseUrl = config.SCRIPT_URL;
            if (!scriptBaseUrl) {
                console.error("Config Error: SCRIPT_URL is missing.");
                return [];
            }

            const url = new URL(scriptBaseUrl);
            url.searchParams.append('action', 'generate_ai_examples');
            url.searchParams.append('word', word);
            url.searchParams.append('count', count);

            const response = await fetch(url.toString());
            
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                console.log("✅ 예문 생성 완료 (GAS 응답):", data.results);
                return data.results;
            } else {
                console.warn("AI 응답 형식 오류(GAS 측):", data.message);
                return [];
            }
        } catch (error) {
            console.error("AI 예문 생성 실패:", error);
            return [];
        }
    },
    
    // ==========================================================================
    // [보안 패치] 2. 단어 정보 가져오기 (GAS 경유 방식으로 완전 수정)
    // ==========================================================================
    async fetchWordInfoFromAI(word) {
        try {
            const scriptBaseUrl = config.SCRIPT_URL;
            if (!scriptBaseUrl) {
                throw new Error("Config Error: SCRIPT_URL is missing.");
            }

            const url = new URL(scriptBaseUrl);
            url.searchParams.append('action', 'fetch_word_info_from_ai');
            url.searchParams.append('word', word);

            const response = await fetch(url.toString());
            
            if (!response.ok) {
                throw new Error(`API Error (${response.status})`);
            }

            const data = await response.json();
            
            if (data.success) {
                const cleanJson = data.result;
                
                // 배열로 들어온 뜻(meaning)을 줄바꿈 문자(\n)로 합쳐서 문자열로 변환
                if (Array.isArray(cleanJson.meaning)) {
                    cleanJson.meaning = cleanJson.meaning.join('\n');
                }
                return cleanJson;
            } else {
                throw new Error(data.message || "AI 정보 가져오기 실패");
            }

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
            const cachedData = localStorage.getItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE);
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                const targetIndex = parsedCache.words.findIndex(w => w.word === wordData.word);
                if (targetIndex !== -1) {
                    parsedCache.words[targetIndex].AISample = aiSampleObj;
                    localStorage.setItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE, JSON.stringify(parsedCache));
                    console.log("✅ 로컬 캐시 업데이트 완료");
                }
            }
        } catch (e) {
            console.error("로컬 캐시 업데이트 실패:", e);
        }
    },

    async updateWordDetails(originalWord, updateData) {
        if (config.SCRIPT_URL) {
            const scriptUrl = new URL(config.SCRIPT_URL);
            scriptUrl.searchParams.append('action', 'update_word_data');
            scriptUrl.searchParams.append('original_word', originalWord);
            
            if (updateData.word !== undefined) scriptUrl.searchParams.append('word', updateData.word);
            if (updateData.pos !== undefined) scriptUrl.searchParams.append('pos', updateData.pos);
            if (updateData.meaning !== undefined) scriptUrl.searchParams.append('meaning', updateData.meaning);
            if (updateData.explanation !== undefined) scriptUrl.searchParams.append('explanation', updateData.explanation);
            
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

        const updateLocalList = (list) => {
             const targetIndex = list.findIndex(w => w.word === originalWord);
             if (targetIndex !== -1) {
                const targetWord = list[targetIndex];
                
                if (updateData.word !== undefined) targetWord.word = updateData.word;
                if (updateData.pos !== undefined) targetWord.pos = updateData.pos;
                if (updateData.meaning !== undefined) targetWord.meaning = updateData.meaning;
                if (updateData.explanation !== undefined) targetWord.explanation = updateData.explanation;
                
                if (updateData.sample !== undefined) targetWord.sample = updateData.sample;
                if (updateData.manual_sample !== undefined) targetWord.sample = updateData.manual_sample;
             }
        };

        updateLocalList(state.wordList);

        try {
            const cachedData = localStorage.getItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE);
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                updateLocalList(parsedCache.words);
                localStorage.setItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE, JSON.stringify(parsedCache));
            }
        } catch (e) {
            console.error("캐시 업데이트 오류:", e);
        }
        
        if (typeof database !== 'undefined' && database) {
            const { ref, update } = window.firebaseSDK;
            const safeKey = originalWord.replace(/[.#$[\]/]/g, '_');
            const firebaseUpdates = { ...updateData };
            // manual_sample이 undefined가 아닌 경우에만 변환
            if (firebaseUpdates.manual_sample !== undefined) {
                firebaseUpdates.sample = firebaseUpdates.manual_sample;
                delete firebaseUpdates.manual_sample;
            }
            if (!updateData.word || updateData.word === originalWord) {
                 update(ref(database, `/vocabulary/${safeKey}`), firebaseUpdates).catch(e => console.warn(e));
            }
        }
    },

async createWord(cardData, afterWord = null) {
    if (!cardData.pos || !cardData.pos.trim()) {
        cardData.pos = "n/a";
    }

    let newFirebaseIndex = 0;
    
    const sortedList = [...state.wordList].sort((a, b) => (a.index || 0) - (b.index || 0));

    if (afterWord) {
        const prevIdx = sortedList.findIndex(w => w.word === afterWord);
        
        if (prevIdx !== -1) {
            const prevVal = sortedList[prevIdx].index || 0;
            
            if (prevIdx < sortedList.length - 1) {
                const nextVal = sortedList[prevIdx + 1].index || (prevVal + 1);
                newFirebaseIndex = (prevVal + nextVal) / 2;
            } else {
                newFirebaseIndex = prevVal + 1;
            }
        } else {
            newFirebaseIndex = (sortedList.length > 0 ? sortedList[sortedList.length - 1].index : 0) + 1;
        }
    } else {
        newFirebaseIndex = (sortedList.length > 0 ? sortedList[sortedList.length - 1].index : 0) + 1;
    }

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

    try {
        const cachedData = localStorage.getItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE);
        if (cachedData) {
            const parsedCache = JSON.parse(cachedData);
            const words = parsedCache.words || [];

            let localInsertPos = words.length;
            if (afterWord) {
                const fIndex = words.findIndex(w => w.word === afterWord);
                if (fIndex !== -1) localInsertPos = fIndex + 1;
            }

            const newWordObj = {
                ...cardData,
                sample: cardData.manual_sample || cardData.sample || "",
                AISample: null,
                index: newFirebaseIndex 
            };

            words.splice(localInsertPos, 0, newWordObj);
            
            parsedCache.words = words;
            localStorage.setItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE, JSON.stringify(parsedCache));
            
            state.wordList = words;
        }
    } catch (e) {
        console.error("로컬 캐시 업데이트 중 오류:", e);
    }

    if (database) {
        const { ref, update } = window.firebaseSDK;
        const safeKey = cardData.word.replace(/[.#$[\]/]/g, '_');
        
        const updates = {};
        updates[`/vocabulary/${safeKey}`] = {
            ...cardData,
            sample: cardData.manual_sample || cardData.sample || "", 
            AISample: null,
            index: newFirebaseIndex 
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
            const cachedData = localStorage.getItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE);
            if (cachedData) {
                const parsedCache = JSON.parse(cachedData);
                parsedCache.words = parsedCache.words.filter(w => w.word !== word);
                localStorage.setItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE, JSON.stringify(parsedCache));
            }
        } catch (e) {}

        if (database) {
            const { ref, remove } = window.firebaseSDK;
            const safeKey = word.replace(/[.#$[\]/]/g, '_');
            
            remove(ref(database, `/vocabulary/${safeKey}`))
                .then(() => console.log("✅ Firebase 삭제 성공"))
                .catch(e => console.warn("Firebase 삭제 실패:", e));
        }
    }
};
