import { config, state } from './config.js';
import { translationCache, utils } from './utils.js';
import { statsStore } from './stats-store.js';

let db = null;
let database = null;
let auth = null;
let activeSpeakId = 0;
let cachedVoice = null;
let cachedVoiceSet = null;
let loadWordListPromise = null;   // 진행 중인 단어목록 fetch (중복 요청 방지)

const timingNow = () => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
);

const roundedMs = value => (
    Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : null
);

const SAVE_CONFIRMATION_TIMEOUT_MS = 30000;

function createSaveRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `save_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function toFirebaseKey(word) {
    return String(word || '').replace(/[.#$[\]/]/g, '_');
}

// Apps Script의 HTTP 응답이 늦더라도, 서버가 마지막으로 기록한 Firebase
// 완료 마커를 직접 감지하면 시트 flush + Firebase 반영이 모두 끝난 것이다.
function createFirebaseSaveConfirmation(word, requestId) {
    let unsubscribe = null;
    let settled = false;

    const promise = new Promise((resolve, reject) => {
        try {
            if (!database) throw new Error('Firebase 데이터베이스가 준비되지 않았습니다.');

            const { ref, onValue } = window.firebaseSDK || {};
            if (typeof ref !== 'function' || typeof onValue !== 'function') {
                throw new Error('Firebase 완료 감시 기능을 불러오지 못했습니다.');
            }

            const markerRef = ref(
                database,
                `/vocabulary/${toFirebaseKey(word)}/_sync`
            );

            const finish = (handler, value) => {
                if (settled) return;
                settled = true;
                if (unsubscribe) unsubscribe();
                handler(value);
            };

            unsubscribe = onValue(
                markerRef,
                snapshot => {
                    const marker = snapshot.val();
                    if (!marker || marker.requestId !== requestId) return;
                    finish(resolve, {
                        source: 'firebase',
                        completedAt: marker.completedAt || null,
                    });
                },
                error => finish(reject, error)
            );
        } catch (error) {
            settled = true;
            reject(error);
        }
    });

    return {
        promise,
        cancel() {
            if (settled) return;
            settled = true;
            if (unsubscribe) unsubscribe();
        },
    };
}

// Firebase 완료 마커 또는 Apps Script 성공 응답 중 먼저 확인되는 성공을 사용한다.
// 명시적인 서버 실패는 즉시 전달하고, 전송 오류는 다른 확인 경로를 기다린다.
function waitForSaveConfirmation(scriptPromise, firebasePromise, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let failedPaths = 0;
        let lastError = null;

        const finish = (handler, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            handler(value);
        };

        const onFailure = error => {
            if (settled) return;
            lastError = error;

            if (error?.code === 'SCRIPT_REJECTED') {
                finish(reject, error);
                return;
            }

            failedPaths += 1;
            if (failedPaths >= 2) finish(reject, lastError);
        };

        const timeoutId = setTimeout(() => {
            const error = new Error(
                '원격 저장 완료를 30초 안에 확인하지 못했습니다. 새로고침하여 저장 여부를 확인해주세요.'
            );
            error.code = 'SAVE_CONFIRMATION_TIMEOUT';
            finish(reject, error);
        }, timeoutMs);

        Promise.resolve(scriptPromise).then(value => finish(resolve, value), onFailure);
        Promise.resolve(firebasePromise).then(value => finish(resolve, value), onFailure);
    });
}

function logUpdateWordTimingDiagnostics(data, localUpdateMs) {
    const server = data?.debugTimings || {};
    const client = data?.clientTimings || {};
    const rows = [
        ['브라우저: 인증 토큰 + 요청 URL 준비', client.buildUrlMs],
        ['브라우저: Apps Script 왕복(fetch)', client.fetchMs],
        ['브라우저: 응답 JSON 해석', client.responseJsonMs],
        ['브라우저: 원격 요청 전체', client.totalMs],
        ['서버: 사용자 인증', server.authMs],
        ['서버: 스크립트 락 대기', server.lockWaitMs],
        ['서버: 시트/헤더 조회', server.sheetContextMs],
        ['서버: 단어 행 검색', server.findRowMs],
        ['서버: 시트 쓰기 호출', server.sheetWriteCallsMs],
        ['서버: 시트 실제 반영(flush)', server.sheetFlushMs],
        ['서버: Firebase PATCH', server.firebasePatchMs],
        ['서버: Firebase 기존 단어 GET', server.firebaseGetMs],
        ['서버: Firebase 단어명 이전(원자적 PATCH)', server.firebaseRenamePatchMs],
        ['서버: Firebase 새 단어 PUT', server.firebasePutMs],
        ['서버: Firebase 기존 단어 DELETE', server.firebaseDeleteMs],
        ['서버: update 핸들러 전체', server.updateHandlerMs],
        ['서버: 인증부터 응답 직전까지', server.serverBeforeResponseMs],
        ['브라우저: 로컬 목록/캐시 갱신', localUpdateMs],
    ]
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([구간, value]) => ({ 구간, '시간(ms)': roundedMs(value) }));

    console.group(`⏱️ 단어 저장 구간별 시간 (${new Date().toLocaleTimeString()})`);
    if (rows.length > 0) {
        console.table(rows);
    } else {
        console.warn('서버 debugTimings가 없습니다. 계측용 Code.gs가 배포되었는지 확인하세요.');
    }
    console.log('원본 계측값:', { server, client, localUpdateMs: roundedMs(localUpdateMs) });
    console.groupEnd();
}

async function getAuthToken() {
    if (!auth?.currentUser) {
        throw new Error('로그인이 필요합니다.');
    }
    return auth.currentUser.getIdToken();
}

// GAS(Apps Script) 요청 URL 빌더 (action + 쿼리 파라미터). undefined 값은 생략.
async function buildScriptUrl(action, params = {}) {
    const url = new URL(config.SCRIPT_URL);
    url.searchParams.append('action', action);
    url.searchParams.append('id_token', await getAuthToken());
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.append(key, value);
    }
    return url.toString();
}

async function callScript(action, params = {}, { successLog, failWarn } = {}) {
    if (!config.SCRIPT_URL) throw new Error('서버 주소가 설정되지 않았습니다.');

    const totalStartedAt = timingNow();
    const buildUrlStartedAt = timingNow();
    const requestUrl = await buildScriptUrl(action, params);
    const buildUrlFinishedAt = timingNow();

    const fetchStartedAt = timingNow();
    const response = await fetch(requestUrl);
    const fetchFinishedAt = timingNow();
    if (!response.ok) {
        throw new Error(`서버 통신 실패 (${response.status})`);
    }

    const responseJsonStartedAt = timingNow();
    const data = await response.json();
    const responseJsonFinishedAt = timingNow();
    data.clientTimings = {
        buildUrlMs: buildUrlFinishedAt - buildUrlStartedAt,
        fetchMs: fetchFinishedAt - fetchStartedAt,
        responseJsonMs: responseJsonFinishedAt - responseJsonStartedAt,
        totalMs: responseJsonFinishedAt - totalStartedAt,
    };
    if (!data.success) {
        if (failWarn) console.warn(failWarn, data.message);
        const error = new Error(data.message || '서버 요청 실패');
        error.code = 'SCRIPT_REJECTED';
        error.serverData = data;
        throw error;
    }

    if (successLog) console.log(successLog);
    return data;
}

// WORD_LIST_CACHE를 읽어 words 배열을 변형한 뒤 다시 저장
function updateWordListCache(mutate, errorMsg) {
    try {
        const cachedData = localStorage.getItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE);
        if (!cachedData) return;
        const parsedCache = JSON.parse(cachedData);
        mutate(parsedCache.words, parsedCache);
        localStorage.setItem(state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE, JSON.stringify(parsedCache));
    } catch (e) {
        if (errorMsg) console.error(errorMsg, e);
    }
}

export const api = {

    init(firestoreInstance, realtimeDbInstance, authInstance) {
        db = firestoreInstance;
        database = realtimeDbInstance;
        auth = authInstance;
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

        // 이미 같은 요청이 진행 중이면 그 Promise를 재사용 (Firebase 중복 호출 방지)
        if (loadWordListPromise) return loadWordListPromise;

        loadWordListPromise = (async () => {
            const { ref, get } = window.firebaseSDK;
            const dbRef = ref(database, '/vocabulary');
            const snapshot = await get(dbRef);
            const data = snapshot.val();
            if (!data) throw new Error("Firebase에 단어 데이터가 없습니다.");

            const wordsArray = Object.values(data).sort((a, b) => a.index - b.index);
            state.wordList = wordsArray;
            state.isWordListReady = true;

            const newTimestamp = Date.now();
            localStorage.setItem(
                state.LOCAL_STORAGE_KEYS.WORD_LIST_CACHE,
                JSON.stringify({ timestamp: newTimestamp, words: wordsArray })
            );
            state.lastCacheTimestamp = newTimestamp;
        })();

        try {
            await loadWordListPromise;
        } finally {
            loadWordListPromise = null;
        }
    },

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

            state.currentUtterance = utterance;

            const setVoice = () => {
                if (myRequestId !== activeSpeakId) return;
                const isUK = state.currentVoiceSet === 'UK';

                let selectedVoice;
                if (cachedVoice && cachedVoiceSet === state.currentVoiceSet) {
                    selectedVoice = cachedVoice;
                } else {
                    const voices = window.speechSynthesis.getVoices();
                    const targetLang = isUK ? 'en-gb' : 'en-us';
                    selectedVoice = null;

                    if (isUK) {
                        selectedVoice = voices.find(v =>
                            v.name.includes("Microsoft Ryan") && v.name.includes("United Kingdom")
                        );
                    } else {
                        const usNaturalVoices = [
                            "Microsoft Aria",
                            "Microsoft Jenny",
                            "Microsoft Davis",
                            "Microsoft Tony",
                            "Microsoft Eric",
                            "Microsoft Guy",
                            "Microsoft Andrew",
                        ];

                        for (const name of usNaturalVoices) {
                            selectedVoice = voices.find(v => v.name.includes(name));
                            if (selectedVoice) break;
                        }
                    }

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
                        cachedVoice = selectedVoice;
                        cachedVoiceSet = state.currentVoiceSet;
                    }
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
                    // 'interrupted'/'canceled'는 다음 발음이 이전 발음을 취소할 때
                    // 정상적으로 발생하는 이벤트이므로 오류로 취급하지 않는다.
                    if (e.error !== 'interrupted' && e.error !== 'canceled') {
                        console.error("TTS 오류:", e);
                    }
                    state.isSpeaking = false;
                    resolve();
                };

                window.speechSynthesis.speak(utterance);
            };

            if (window.speechSynthesis.getVoices().length === 0) {
                let voiceReady = false;                           // ↓ 이 블록 전체 교체
                const runOnce = () => {
                    if (voiceReady) return;
                    voiceReady = true;
                    window.speechSynthesis.onvoiceschanged = null;
                    setVoice();
                };
                window.speechSynthesis.onvoiceschanged = runOnce;
                setTimeout(runOnce, 1000);
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

            const data = await callScript('translate', { text });
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

        const wordObj = state.wordList.find(w => w.word === word);
        if (!wordObj) return false;

        const newExceptStatus = !wordObj.except;

        await callScript('toggle_except', { word, value: newExceptStatus ? '1' : '' }, {
            failWarn: 'GAS except 오류',
        });

        wordObj.except = newExceptStatus;

        updateWordListCache(words => {
            const target = words.find(w => w.word === word);
            if (target) target.except = newExceptStatus;
        }, '캐시 업데이트 오류');

        return newExceptStatus;
    },

    async syncStudyHistory(studyByDate) {
        if (!state.userId || !studyByDate || Object.keys(studyByDate).length === 0) return;
        const { doc, setDoc, increment } = window.firebaseSDK;
        const historyRef = doc(db, 'users', state.userId, 'history', 'study');
        try {
            const payload = {};
            Object.entries(studyByDate).forEach(([date, seconds]) => {
                const amount = Math.max(0, Math.floor(Number(seconds) || 0));
                if (amount > 0) payload[date] = increment(amount);
            });
            if (Object.keys(payload).length > 0) {
                await setDoc(historyRef, payload, { merge: true });
            }
        } catch (error) {
            console.error(error);
            throw error;   // 실패를 syncOfflineData에 전달해 로컬 데이터 보존
        }
    },

    async getStudyHistory() {
        if (!state.userId) return {};
        try {
            const { doc, getDoc } = window.firebaseSDK;
            if (!db) return {};
            const historyRef = doc(db, 'users', state.userId, 'history', 'study');
            const docSnap = await getDoc(historyRef);
            return docSnap.exists() ? docSnap.data() : {};
        } catch (e) {
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
        } catch (e) {
            console.warn("퀴즈 기록 로딩 실패:", e);
            return {};
        }
    },

    saveQuizHistoryToLocal(quizType, isCorrect) {
        try {
            statsStore.addQuizResult(utils.getLocalDateString(), quizType, isCorrect);
        } catch (e) {}
    },

    async syncQuizHistory(statsByDate) {
        if (!state.userId || !statsByDate || Object.keys(statsByDate).length === 0) return;
        const { doc, setDoc, increment } = window.firebaseSDK;
        const historyRef = doc(db, 'users', state.userId, 'history', 'quiz');
        try {
            const payload = {};
            Object.entries(statsByDate).forEach(([date, daily]) => {
                payload[date] = {};
                Object.entries(daily || {}).forEach(([type, stats]) => {
                    const total = Math.max(0, Number(stats.total || 0));
                    const correct = Math.max(0, Number(stats.correct || 0));
                    if (total > 0) {
                        payload[date][type] = {
                            total: increment(total),
                            correct: increment(correct)
                        };
                    }
                });
                if (Object.keys(payload[date]).length === 0) delete payload[date];
            });
            if (Object.keys(payload).length > 0) {
                await setDoc(historyRef, payload, { merge: true });
            }
        } catch (e) { console.error(e); throw e; }
    },

    async syncProgressUpdates(progressToSync) {
        if (!state.userId || !progressToSync || Object.keys(progressToSync).length === 0) return;
        const { doc, setDoc } = window.firebaseSDK;
        const progressRef = doc(db, 'users', state.userId, 'progress', 'main');
        try { await setDoc(progressRef, progressToSync, { merge: true }); } catch (error) { console.error(error); throw error; }
    },

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

            const data = await callScript('generate_ai_examples', { word, count });
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

    async fetchWordInfoFromAI(word) {
        try {
            const scriptBaseUrl = config.SCRIPT_URL;
            if (!scriptBaseUrl) {
                throw new Error("Config Error: SCRIPT_URL is missing.");
            }

            const data = await callScript('fetch_word_info_from_ai', { word });
            if (data.success) {
                const cleanJson = data.result;

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

    async saveAISamplesToSheet(wordData, fullEnText) {
        await callScript('save_ai_sample', { word: wordData.word, ai_text: fullEnText }, {
            successLog: "✅ 시트 저장 성공",
            failWarn: "시트 저장 실패:",
        });

        const aiSampleObj = { en: fullEnText, ko: "" };

        updateWordListCache(words => {
            const targetIndex = words.findIndex(w => w.word === wordData.word);
            if (targetIndex !== -1) {
                words[targetIndex].AISample = aiSampleObj;
                console.log("✅ 로컬 캐시 업데이트 완료");
            }
        }, "로컬 캐시 업데이트 실패:");
    },

    async updateWordDetails(originalWord, updateData) {
        const requestId = createSaveRequestId();
        const targetWord = updateData.word || originalWord;
        const params = {
            original_word: originalWord,
            word: updateData.word,
            pos: updateData.pos,
            meaning: updateData.meaning,
            explanation: updateData.explanation,
            request_id: requestId,
        };
        if (updateData.sample !== undefined || updateData.manual_sample !== undefined) {
            params.manual_sample = updateData.manual_sample !== undefined
                ? updateData.manual_sample
                : updateData.sample;
        }

        // 완료 감시는 요청 전부터 시작해 매우 빠른 Firebase 이벤트도 놓치지 않는다.
        const firebaseConfirmation = createFirebaseSaveConfirmation(targetWord, requestId);
        const confirmationStartedAt = timingNow();
        const scriptPromise = callScript('update_word_data', params, {
            successLog: "✅ 시트·Firebase 수정 성공",
            failWarn: "원격 수정 실패:",
        }).then(data => ({ source: 'apps-script', data }));

        let confirmation;
        try {
            confirmation = await waitForSaveConfirmation(
                scriptPromise,
                firebaseConfirmation.promise,
                SAVE_CONFIRMATION_TIMEOUT_MS
            );
        } finally {
            firebaseConfirmation.cancel();
        }

        const confirmedInMs = timingNow() - confirmationStartedAt;

        const localUpdateStartedAt = timingNow();
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

        updateWordListCache(words => updateLocalList(words), "캐시 업데이트 오류:");
        if (updateData.word && updateData.word !== originalWord) {
            utils.invalidateWordIndexMap();
        }
        const localUpdateMs = timingNow() - localUpdateStartedAt;

        if (confirmation.source === 'apps-script') {
            logUpdateWordTimingDiagnostics(confirmation.data, localUpdateMs);
        } else {
            console.log(
                `✅ 시트·Firebase 저장 완료 ` +
                `(Firebase 신호 ${roundedMs(confirmedInMs)}ms)`
            );

            // 늦게 도착하는 Apps Script 응답은 진단용으로만 처리한다.
            // Firebase 마커가 확인됐다면 양쪽 저장은 이미 완료된 상태다.
            scriptPromise.then(
                result => logUpdateWordTimingDiagnostics(result.data, localUpdateMs),
                error => console.warn(
                    'Firebase에서 저장 완료를 확인했지만 Apps Script 응답 전달은 실패했습니다.',
                    error
                )
            );
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

        const newWordObj = {
            word: cardData.word,
            pos: cardData.pos || "",
            meaning: cardData.meaning || "",
            explanation: cardData.explanation || "",
            sample: cardData.manual_sample || cardData.sample || "",
            AISample: null,
            except: false,
            index: newFirebaseIndex
        };

        await callScript('create_word', {
            word: cardData.word,
            pos: cardData.pos || "",
            meaning: cardData.meaning || "",
            explanation: cardData.explanation || "",
            manual_sample: cardData.manual_sample || cardData.sample || "",
            after_word: afterWord || undefined,
            index: newFirebaseIndex,
        }, { failWarn: "시트 생성 실패:" });

        const upsertWordIntoList = (list) => {
            const arr = Array.isArray(list) ? list : [];
            const existingIndex = arr.findIndex(w => w.word === newWordObj.word);
            if (existingIndex !== -1) {
                Object.assign(arr[existingIndex], newWordObj);
                return arr;
            }

            const tempIndex = arr.findIndex(w => w.isNew && !w.word);
            if (tempIndex !== -1) {
                Object.assign(arr[tempIndex], newWordObj);
                delete arr[tempIndex].isNew;
                return arr;
            }

            let localInsertPos = arr.length;
            if (afterWord) {
                const fIndex = arr.findIndex(w => w.word === afterWord);
                if (fIndex !== -1) localInsertPos = fIndex + 1;
            }

            arr.splice(localInsertPos, 0, newWordObj);
            return arr;
        };

        upsertWordIntoList(state.wordList);

        updateWordListCache((words, cache) => {
            cache.words = upsertWordIntoList(words);
        }, "로컬 캐시 업데이트 중 오류:");

        utils.invalidateWordIndexMap();
        return newWordObj;
    },

    async deleteWord(word) {
        await callScript('delete_word', { word }, {
            successLog: "✅ 시트 삭제 성공",
            failWarn: "시트 삭제 실패:",
        });

        state.wordList = state.wordList.filter(w => w.word !== word);
        utils.invalidateWordIndexMap();

        updateWordListCache((words, cache) => {
            cache.words = words.filter(w => w.word !== word);
        });
    }
};
