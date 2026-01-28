import { state } from "./state.js";
import { config, LOCAL_STORAGE_KEYS } from "./config.js";
import { database, ref, get, db, doc, getDoc, setDoc } from "./firebase-init.js";
import { audioCache, translationCache } from "./cache.js";
import { utils } from "./utils.js";
import { ui } from "./ui.js";

export const api = {
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
            if (!state.isWordListReady) ui.showFatalError(error.message);
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
            } catch (e) {
                console.error("Web Audio API is not supported", e);
                return;
            }
        }

        if (state.audioContext.state === 'suspended') {
            try { await state.audioContext.resume(); } catch (e) { console.error("Failed to resume AudioContext", e); }
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
                    if (state.currentSource === source) { state.currentSource = null; }
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
            if (!response.ok) throw new Error(`TTS API Error: ${(await response.json()).error.message}`);

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
            if (cached) { return cached; }
        } catch (e) { console.warn("Translation cache read error:", e); }

        if (!config.SCRIPT_URL || config.SCRIPT_URL === "여기에_배포된_APPS_SCRIPT_URL을_붙여넣으세요") {
            return "번역 스크립트 URL이 설정되지 않았습니다.";
        }

        const url = new URL(config.SCRIPT_URL);
        url.searchParams.append('action', 'translate');
        url.searchParams.append('text', text);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            if (data.success) {
                const translatedText = data.translatedText;
                translationCache.save(text, translatedText);
                return translatedText;
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
         api.saveQuizHistoryToLocal(quizType, result === 'correct');
     },
    async loadUserProgress() {
        if (!state.userId) return;
        const progressRef = doc(db, 'users', state.userId, 'progress', 'main');
        try {
            const docSnap = await getDoc(progressRef);
            state.currentProgress = docSnap.exists() ? docSnap.data() : {};
        } catch (error) {
            console.error("Error loading user progress:", error);
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
        } catch (e) {
            console.error("Error fetching definition:", e);
            return null;
        }
    },
    async loadFavorites() {
        if (!state.userId) return [];
        return utils.getFavoriteWords();
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
        const today = new Date().toISOString().slice(0, 10);
        const historyRef = doc(db, 'users', state.userId, 'history', 'study');
        try {
            const docSnap = await getDoc(historyRef);
            const currentSeconds = (docSnap.exists() && docSnap.data()[today]) ? docSnap.data()[today] : 0;
            await setDoc(historyRef, { [today]: currentSeconds + seconds }, { merge: true });
        } catch (error) {
            console.error("Failed to update study time:", error);
            throw error;
        }
    },
    async getStudyHistory(days) {
        if (!state.userId) return {};
        const historyRef = doc(db, 'users', state.userId, 'history', 'study');
        try {
            const docSnap = await getDoc(historyRef);
            return docSnap.exists() ? docSnap.data() : {};
        } catch(e) {
            console.error("Error fetching study history:", e);
            return {};
        }
    },
    async getQuizHistory() {
        if (!state.userId) return {};
        const historyRef = doc(db, 'users', state.userId, 'history', 'quiz');
        try {
            const docSnap = await getDoc(historyRef);
            return docSnap.exists() ? docSnap.data() : {};
        } catch(e) {
            console.error("Error fetching quiz history:", e);
            return {};
        }
    },
    saveQuizHistoryToLocal(quizType, isCorrect) {
        try {
            const stats = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ) || '{}');
            if (!stats[quizType]) {
                stats[quizType] = { total: 0, correct: 0 };
            }
            stats[quizType].total += 1;
            if (isCorrect) {
                stats[quizType].correct += 1;
            }
            localStorage.setItem(LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ, JSON.stringify(stats));
        } catch (e) {
            console.error("Error saving quiz stats to localStorage", e);
        }
    },
    async syncQuizHistory(statsToSync) {
        if (!state.userId || !statsToSync) return;
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
        } catch(e) {
            console.error("Failed to sync quiz history:", e);
            throw e;
        }
    },
    async syncProgressUpdates(progressToSync) {
         if (!state.userId || !progressToSync || Object.keys(progressToSync).length === 0) return;
         const progressRef = doc(db, 'users', state.userId, 'progress', 'main');
         try {
             await setDoc(progressRef, progressToSync, { merge: true });
         } catch (error) {
             console.error("Firebase progress sync failed:", error);
             throw error;
         }
     },
     // main.js에서 호출하는 syncOfflineData 로직을 여기에 포함
     async syncOfflineData() {
        if (!state.userId) return;
        try {
            const timeKey = LOCAL_STORAGE_KEYS.UNSYNCED_TIME;
            const quizKey = LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ;
            const progressKey = LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;

            const timeToSync = parseInt(localStorage.getItem(timeKey) || '0');
            if (timeToSync > 0) {
                await api.updateStudyTime(timeToSync);
                localStorage.removeItem(timeKey);
            }

            const statsToSync = JSON.parse(localStorage.getItem(quizKey) || 'null');
            if (statsToSync) {
                await api.syncQuizHistory(statsToSync);
                localStorage.removeItem(quizKey);
            }

            const progressToSync = JSON.parse(localStorage.getItem(progressKey) || 'null');
             if (progressToSync && Object.keys(progressToSync).length > 0) {
                 await api.syncProgressUpdates(progressToSync);
                 localStorage.removeItem(progressKey);
             }
        } catch (error) {
            console.error("Offline data sync failed:", error);
        }
    }
};