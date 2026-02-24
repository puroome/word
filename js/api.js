import { config, state } from './config.js';
import { translationCache, utils } from './utils.js';

let db = null;
let database = null;
let activeSpeakId = 0;
let cachedVoices = null;

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
      } catch(e) {
        localStorage.removeItem('wordListCache');
      }
    }
    if (state.isWordListReady && !force) return;
    const { ref, get } = window.firebaseSDK;
    try {
      const dbRef = ref(database, 'vocabulary');
      const snapshot = await get(dbRef);
      const data = snapshot.val();
      if (!data) throw new Error('Firebase 데이터가 비어있습니다.');
      const wordsArray = Object.values(data).sort((a, b) => a.index - b.index);
      state.wordList = wordsArray;
      state.isWordListReady = true;
      const newTimestamp = Date.now();
      localStorage.setItem('wordListCache', JSON.stringify({ timestamp: newTimestamp, words: wordsArray }));
      state.lastCacheTimestamp = newTimestamp;
    } catch(error) {
      throw error;
    }
  },

  speak(text, contentType = 'word') {
    return new Promise(resolve => {
      const myRequestId = ++activeSpeakId;
      if (!text || !text.trim()) return resolve();
      if (!window.speechSynthesis) {
        console.warn('TTS를 지원하지 않는 브라우저입니다.');
        return resolve();
      }
      window.speechSynthesis.cancel();
      const processedText = text
        .replace(/\bsomebody\b/gi, 'somebody')
        .replace(/\bsomething\b/gi, 'something');
      const utterance = new SpeechSynthesisUtterance(processedText);

      const setVoice = () => {
        if (myRequestId !== activeSpeakId) return;
        if (!cachedVoices || cachedVoices.length === 0) {
          cachedVoices = window.speechSynthesis.getVoices();
        }
        const voices = cachedVoices;
        const isUK = state.currentVoiceSet === 'UK';
        const targetLang = isUK ? 'en-gb' : 'en-us';
        let selectedVoice = null;
        if (isUK) {
          selectedVoice = voices.find(v =>
            v.name.includes('Microsoft Ryan') || v.name.includes('United Kingdom')
          );
        }
        if (!selectedVoice) {
          selectedVoice = voices.find(v =>
            v.lang.replace('_', '-').toLowerCase() === targetLang
          );
        }
        if (!selectedVoice) {
          selectedVoice = voices.find(v =>
            v.lang.replace('_', '-').toLowerCase().includes(targetLang)
          );
        }
        if (!selectedVoice) {
          const naturalName = isUK ? 'United Kingdom' : 'United States';
          selectedVoice = voices.find(v =>
            v.name.includes(naturalName) && v.name.includes('Natural')
          );
        }
        if (selectedVoice) {
          utterance.voice = selectedVoice;
          utterance.lang = selectedVoice.lang;
        } else {
          utterance.lang = isUK ? 'en-GB' : 'en-US';
        }
        utterance.rate = contentType === 'word' ? 1.0 : 0.9;
        utterance.onend = () => resolve();
        utterance.onerror = e => { console.error('TTS 오류:', e); resolve(); };
        window.speechSynthesis.speak(utterance);
      };

      const voiceList = window.speechSynthesis.getVoices();
      if (voiceList.length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
          cachedVoices = null;
          window.speechSynthesis.onvoiceschanged = () => { cachedVoices = null; };
          setVoice();
        };
      } else {
        if (!cachedVoices || cachedVoices.length === 0) cachedVoices = voiceList;
        setVoice();
      }
    });
  },

  async translate(text) {
    if (!text) return;
    try {
      const cached = await translationCache.get(text);
      if (cached) return cached;
    } catch(e) { console.warn('Cache check failed', e); }
    try {
      const scriptBaseUrl = config.SCRIPTURL;
      if (!scriptBaseUrl) { console.error('Config Error: SCRIPTURL이 없습니다.'); return; }
      const url = new URL(scriptBaseUrl);
      url.searchParams.append('action', 'translate');
      url.searchParams.append('text', text);
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      const data = await response.json();
      if (data.success) {
        const translatedText = data.translatedText;
        try { translationCache.save(text, translatedText); } catch(e) {}
        return translatedText;
      } else {
        throw new Error(data.message);
      }
    } catch(error) {
      console.error('Translation Error:', error);
      return;
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
    } catch(error) {
      state.currentProgress = {};
    }
  },

  async fetchDefinition(word) {
    const apiKey = config.DEFINITIONAPIKEY;
    const url = `https://dictionaryapi.com/api/v3/references/learners/json/${encodeURIComponent(word)}?key=${apiKey}`;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const firstResult = data[0];
        if (typeof firstResult === 'object' && firstResult !== null &&
          Array.isArray(firstResult.shortdef) && firstResult.shortdef.length > 0) {
          return firstResult.shortdef[0];
        }
      }
      return null;
    } catch(e) {
      return null;
    }
  },

  async toggleFavorite(word) {
    if (!state.userId || !word) return false;
    const isCurrentlyFavorite = utils.isFavorite(word);
    const newFavoriteStatus = !isCurrentlyFavorite;
    if (!state.currentProgress[word]) state.currentProgress[word] = {};
    state.currentProgress[word].favorite = newFavoriteStatus;
    state.currentProgress[word].favoritedAt = newFavoriteStatus ? Date.now() : 0;
    utils.addProgressUpdatesToLocalSync(word, {
      favorite: newFavoriteStatus,
      favoritedAt: state.currentProgress[word].favoritedAt,
    });
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
    } catch(error) {
      console.error('공부 시간 업데이트 실패:', error);
      throw error;
    }
  },

  async getStudyHistory() {
    if (!state.userId) return;
    try {
      const { doc, getDoc } = window.firebaseSDK;
      if (!db) return;
      const historyRef = doc(db, 'users', state.userId, 'history', 'study');
      const docSnap = await getDoc(historyRef);
      return docSnap.exists() ? docSnap.data() : {};
    } catch(e) {
      console.warn('공부 기록 조회 실패:', e);
      return {};
    }
  },

  async getQuizHistory() {
    if (!state.userId) return;
    try {
      const { doc, getDoc } = window.firebaseSDK;
      if (!db) return;
      const historyRef = doc(db, 'users', state.userId, 'history', 'quiz');
      const docSnap = await getDoc(historyRef);
      return docSnap.exists() ? docSnap.data() : {};
    } catch(e) {
      console.warn('퀴즈 기록 조회 실패:', e);
      return {};
    }
  },

  saveQuizHistoryToLocal(quizType, isCorrect) {
    try {
      const stats = JSON.parse(localStorage.getItem(state.LOCALSTORAGEKEYS.UNSYNCEDQUIZ) || '{}');
      if (!stats[quizType]) stats[quizType] = { total: 0, correct: 0 };
      stats[quizType].total += 1;
      if (isCorrect) stats[quizType].correct += 1;
      localStorage.setItem(state.LOCALSTORAGEKEYS.UNSYNCEDQUIZ, JSON.stringify(stats));
    } catch(e) {}
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
      for (const [type, { total, correct }] of Object.entries(statsToSync)) {
        const prev = todayData[type] ?? { correct: 0, total: 0 };
        todayData[type] = { total: prev.total + total, correct: prev.correct + correct };
      }
      await setDoc(historyRef, { [today]: todayData }, { merge: true });
    } catch(e) {
      console.error('퀴즈 기록 동기화 실패:', e);
      throw e;
    }
  },

  async syncProgressUpdates(progressToSync) {
    if (!state.userId || !progressToSync || Object.keys(progressToSync).length === 0) return;
    const { doc, setDoc } = window.firebaseSDK;
    const progressRef = doc(db, 'users', state.userId, 'progress', 'main');
    try {
      await setDoc(progressRef, progressToSync, { merge: true });
    } catch(error) {
      console.error('Firebase 진행 상황 동기화 실패:', error);
      throw error;
    }
  },

  async generateAIExamples(wordData, currentMeaning, count = 2) {
    const word = wordData.word;
    if (!word) return;
    try {
      const scriptBaseUrl = config.SCRIPTURL;
      if (!scriptBaseUrl) { console.error('Config Error: SCRIPTURL이 없습니다.'); return; }
      const url = new URL(scriptBaseUrl);
      url.searchParams.append('action', 'generateaiexamples');
      url.searchParams.append('word', word);
      url.searchParams.append('count', count);
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      const data = await response.json();
      if (data.success) return data.results;
      else { console.warn('AI 예문 GAS 실패:', data.message); return; }
    } catch(error) {
      console.error('AI 예문 생성 오류:', error);
      return;
    }
  },

  async fetchWordInfoFromAI(word) {
    try {
      const scriptBaseUrl = config.SCRIPTURL;
      if (!scriptBaseUrl) throw new Error('Config Error: SCRIPTURL이 없습니다.');
      const url = new URL(scriptBaseUrl);
      url.searchParams.append('action', 'fetchwordinfofromai');
      url.searchParams.append('word', word);
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      if (data.success) {
        const cleanJson = data.result;
        if (Array.isArray(cleanJson.meaning)) cleanJson.meaning = cleanJson.meaning.join('\n');
        return cleanJson;
      } else {
        throw new Error(data.message);
      }
    } catch(error) {
      console.error('AI 단어 정보 조회 오류:', error);
      throw error;
    }
  },

  async saveAISamplesToSheet(wordData, fullEnText) {
    if (config.SCRIPTURL) {
      const scriptUrl = new URL(config.SCRIPTURL);
      scriptUrl.searchParams.append('action', 'saveaisample');
      scriptUrl.searchParams.append('word', wordData.word);
      scriptUrl.searchParams.append('aitext', fullEnText);
      fetch(scriptUrl.toString())
        .then(r => r.json())
        .then(d => { if (!d.success) console.warn('AI 샘플 저장 실패:', d.message); })
        .catch(e => { console.error(e); });
    }
    const aiSampleObj = { en: fullEnText, ko: '' };
    if (database) {
      const { ref, update } = window.firebaseSDK;
      const safeKey = wordData.word.replace(/[.#$[\]]/g, '_');
      update(ref(database), { [`vocabulary/${safeKey}/AISample`]: aiSampleObj })
        .catch(e => console.warn('Firebase AI 샘플 저장 실패:', e));
    }
    try {
      const cachedData = localStorage.getItem('wordListCache');
      if (cachedData) {
        const parsedCache = JSON.parse(cachedData);
        const targetIndex = parsedCache.words.findIndex(w => w.word === wordData.word);
        if (targetIndex !== -1) {
          parsedCache.words[targetIndex].AISample = aiSampleObj;
          localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
        }
      }
    } catch(e) { console.error(e); }
  },

  async updateWordDetails(originalWord, updateData) {
    if (config.SCRIPTURL) {
      const scriptUrl = new URL(config.SCRIPTURL);
      scriptUrl.searchParams.append('action', 'updateworddata');
      scriptUrl.searchParams.append('originalword', originalWord);
      if (updateData.word !== undefined) scriptUrl.searchParams.append('word', updateData.word);
      if (updateData.pos !== undefined) scriptUrl.searchParams.append('pos', updateData.pos);
      if (updateData.meaning !== undefined) scriptUrl.searchParams.append('meaning', updateData.meaning);
      if (updateData.explanation !== undefined) scriptUrl.searchParams.append('explanation', updateData.explanation);
      if (updateData.sample !== undefined || updateData.manualsample !== undefined)
        scriptUrl.searchParams.append('manualsample', updateData.manualsample ?? updateData.sample);
      fetch(scriptUrl.toString())
        .then(r => r.json())
        .then(d => { if (!d.success) console.warn('GAS 업데이트 실패:', d.message); })
        .catch(e => { console.error(e); });
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
        if (updateData.manualsample !== undefined) targetWord.sample = updateData.manualsample;
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
    } catch(e) { console.error(e); }
    if (database) {
      const { ref, update } = window.firebaseSDK;
      const safeKey = originalWord.replace(/[.#$[\]]/g, '_');
      const firebaseUpdates = { ...updateData };
      if (firebaseUpdates.manualsample) {
        firebaseUpdates.sample = firebaseUpdates.manualsample;
        delete firebaseUpdates.manualsample;
      }
      if (!firebaseUpdates.word) firebaseUpdates.word = originalWord;
      update(ref(database), { [`vocabulary/${safeKey}`]: firebaseUpdates })
        .catch(e => console.warn(e));
    }
  },

  async createWord(cardData, afterWord = null) {
    if (!cardData.pos || !cardData.pos.trim()) cardData.pos = 'na';
    let newFirebaseIndex = 0;
    const sortedList = [...state.wordList].sort((a, b) => (a.index || 0) - (b.index || 0));
    const prevIdx = afterWord ? sortedList.findIndex(w => w.word === afterWord) : -1;
    if (afterWord && prevIdx !== -1) {
      const prevVal = sortedList[prevIdx].index || 0;
      if (prevIdx < sortedList.length - 1) {
        const nextVal = sortedList[prevIdx + 1].index || prevVal + 1;
        newFirebaseIndex = (prevVal + nextVal) / 2;
      } else {
        newFirebaseIndex = prevVal + 1;
      }
    } else {
      newFirebaseIndex = sortedList.length > 0
        ? (sortedList[sortedList.length - 1].index || 0) + 1
        : 0;
    }
    if (config.SCRIPTURL) {
      const scriptUrl = new URL(config.SCRIPTURL);
      scriptUrl.searchParams.append('action', 'createword');
      scriptUrl.searchParams.append('word', cardData.word);
      scriptUrl.searchParams.append('pos', cardData.pos);
      scriptUrl.searchParams.append('meaning', cardData.meaning);
      scriptUrl.searchParams.append('explanation', cardData.explanation);
      scriptUrl.searchParams.append('manualsample', cardData.manualsample || cardData.sample || '');
      if (afterWord) scriptUrl.searchParams.append('afterword', afterWord);
      fetch(scriptUrl.toString())
        .then(r => r.json())
        .then(d => { if (!d.success) console.warn('새 카드 GAS 생성 실패:', d.message); })
        .catch(e => { console.error(e); });
    }
    try {
      const cachedData = localStorage.getItem('wordListCache');
      if (cachedData) {
        const parsedCache = JSON.parse(cachedData);
        const words = parsedCache.words;
        let localInsertPos = words.length;
        if (afterWord) {
          const fIndex = words.findIndex(w => w.word === afterWord);
          if (fIndex !== -1) localInsertPos = fIndex + 1;
        }
        const newWordObj = {
          ...cardData,
          sample: cardData.manualsample || cardData.sample || '',
          AISample: null,
          index: newFirebaseIndex,
        };
        words.splice(localInsertPos, 0, newWordObj);
        parsedCache.words = words;
        localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
        state.wordList = words;
      }
    } catch(e) { console.error(e); }
    if (database) {
      const { ref, update } = window.firebaseSDK;
      const safeKey = cardData.word.replace(/[.#$[\]]/g, '_');
      update(ref(database), {
        [`vocabulary/${safeKey}`]: {
          ...cardData,
          sample: cardData.manualsample || cardData.sample || '',
          AISample: null,
          index: newFirebaseIndex,
        }
      }).catch(e => console.warn(e));
    }
  },

  async deleteWord(word) {
    if (config.SCRIPTURL) {
      const scriptUrl = new URL(config.SCRIPTURL);
      scriptUrl.searchParams.append('action', 'deleteword');
      scriptUrl.searchParams.append('word', word);
      fetch(scriptUrl.toString())
        .then(r => r.json())
        .then(d => { if (!d.success) console.warn('GAS 삭제 실패:', d.message); })
        .catch(e => { console.error(e); });
    }
    state.wordList = state.wordList.filter(w => w.word !== word);
    try {
      const cachedData = localStorage.getItem('wordListCache');
      if (cachedData) {
        const parsedCache = JSON.parse(cachedData);
        parsedCache.words = parsedCache.words.filter(w => w.word !== word);
        localStorage.setItem('wordListCache', JSON.stringify(parsedCache));
      }
    } catch(e) {}
    if (database) {
      const { ref, remove } = window.firebaseSDK;
      const safeKey = word.replace(/[.#$[\]]/g, '_');
      remove(ref(database, `vocabulary/${safeKey}`))
        .catch(e => console.warn('Firebase 삭제 실패:', e));
    }
  },
};
