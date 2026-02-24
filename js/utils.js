import { state } from './config.js';

export const utils = {
  levenshteinDistance(s, t, limit = Infinity) {
    if (s === t) return 0;
    if (s.length === 0) return t.length;
    if (t.length === 0) return s.length;
    if (Math.abs(s.length - t.length) > limit) return limit + 1;
    let v0 = new Array(t.length + 1);
    let v1 = new Array(t.length + 1);
    for (let i = 0; i < v0.length; i++) v0[i] = i;
    for (let i = 0; i < s.length; i++) {
      v1[0] = i + 1;
      let minRow = v1[0];
      for (let j = 0; j < t.length; j++) {
        const cost = s[i] === t[j] ? 0 : 1;
        v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
        minRow = Math.min(minRow, v1[j + 1]);
      }
      if (minRow > limit) return limit + 1;
      const temp = v0; v0 = v1; v1 = temp;
    }
    return v0[t.length];
  },

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  },

  pickRandomItems(array, count, excludeFilter = false) {
    const result = [];
    const len = array.length;
    if (len <= count * 3) {
      const shuffled = excludeFilter
        ? [...array.filter(item => !excludeFilter(item))]
        : [...array];
      this.shuffleArray(shuffled);
      return shuffled.slice(0, count);
    }
    const seenIndices = new Set();
    let attempts = 0;
    const maxAttempts = count * 5;
    while (result.length < count && attempts < maxAttempts) {
      attempts++;
      const idx = Math.floor(Math.random() * len);
      if (seenIndices.has(idx)) continue;
      const item = array[idx];
      if (!excludeFilter || !excludeFilter(item)) {
        seenIndices.add(idx);
        result.push(item);
      }
    }
    return result;
  },

  formatSeconds(totalSeconds) {
    if (!totalSeconds || totalSeconds < 60) return '0분';
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    let result = '';
    if (d > 0) result += `${d}일 `;
    if (h > 0) result += `${h}시간 `;
    if (m > 0) result += `${m}분`;
    return result.trim() || '0분';
  },

  getWordStatus(word) {
    let localStatus = {};
    try {
      const key = state.LOCALSTORAGEKEYS.UNSYNCEDPROGRESSUPDATES;
      const item = localStorage.getItem(key);
      if (item) {
        const unsynced = JSON.parse(item);
        if (unsynced[word]) localStatus = unsynced[word];
      }
    } catch(e) { console.warn('Error reading local progress', e); }
    const progress = { ...state.currentProgress[word], ...localStatus };
    if (Object.keys(progress).length === 0) return 'unseen';
    const statuses = ['MULTIPLECHOICEMEANING', 'FILLINTHEBLANK', 'MULTIPLECHOICEDEFINITION']
      .map(type => progress[type] || 'unseen');
    if (statuses.includes('incorrect')) return 'review';
    if (statuses.every(s => s === 'correct')) return 'learned';
    if (statuses.some(s => s === 'correct')) return 'learning';
    return 'unseen';
  },

  isFavorite(word) {
    let isFav = state.currentProgress[word]?.favorite || false;
    try {
      const key = state.LOCALSTORAGEKEYS.UNSYNCEDPROGRESSUPDATES;
      const item = localStorage.getItem(key);
      if (item) {
        const unsynced = JSON.parse(item);
        if (unsynced[word] && unsynced[word].favorite !== undefined) {
          isFav = unsynced[word].favorite;
        }
      }
    } catch(e) { console.warn('Error reading local favorite status', e); }
    return isFav;
  },

  getFavoriteWords() {
    let localUpdates = {};
    try {
      const key = state.LOCALSTORAGEKEYS.UNSYNCEDPROGRESSUPDATES;
      localUpdates = JSON.parse(localStorage.getItem(key)) || {};
    } catch(e) { console.warn('Error reading local favorites', e); }
    const allProgress = state.currentProgress;
    const combinedKeys = new Set([...Object.keys(allProgress), ...Object.keys(localUpdates)]);
    const favoriteWords = [];
    combinedKeys.forEach(word => {
      const serverState = allProgress[word] || {};
      const localState = localUpdates[word] || {};
      const combinedState = {
        ...serverState,
        favorite: localState.favorite !== undefined ? localState.favorite : serverState.favorite,
        favoritedAt: localState.favoritedAt !== undefined ? localState.favoritedAt : serverState.favoritedAt,
      };
      if (combinedState.favorite === true) {
        favoriteWords.push({ word, time: combinedState.favoritedAt || 0 });
      }
    });
    return favoriteWords.sort((a, b) => b.time - a.time).map(item => item.word);
  },

  addProgressUpdateToLocalSync(word, key, value) {
    try {
      const localKey = state.LOCALSTORAGEKEYS.UNSYNCEDPROGRESSUPDATES;
      const unsynced = JSON.parse(localStorage.getItem(localKey) || '{}');
      if (!unsynced[word]) unsynced[word] = {};
      unsynced[word][key] = value;
      localStorage.setItem(localKey, JSON.stringify(unsynced));
    } catch(e) { console.error('Error adding progress update to localStorage sync', e); }
  },

  addProgressUpdatesToLocalSync(word, updates) {
    try {
      const localKey = state.LOCALSTORAGEKEYS.UNSYNCEDPROGRESSUPDATES;
      const unsynced = JSON.parse(localStorage.getItem(localKey) || '{}');
      if (!unsynced[word]) unsynced[word] = {};
      Object.assign(unsynced[word], updates);
      localStorage.setItem(localKey, JSON.stringify(unsynced));
    } catch(e) { console.error(e); }
  },
};

export const translationCache = {
  db: null,
  dbName: 'translationCacheDB',
  storeName: 'translations',
  init() {
    return new Promise(resolve => {
      if (!('indexedDB' in window)) return resolve();
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = e => {
        if (!e.target.result.objectStoreNames.contains(this.storeName))
          e.target.result.createObjectStore(this.storeName);
      };
      request.onsuccess = e => { this.db = e.target.result; resolve(); };
      request.onerror = () => resolve();
    });
  },
  get(key) {
    return new Promise(resolve => {
      if (!this.db) return resolve(null);
      const r = this.db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    });
  },
  save(key, data) {
    if (this.db) try {
      this.db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(data, key);
    } catch(e) {}
  }
};

export function playSingleBeep({ frequency, duration = 0.1, type = 'sine', gain = 0.3, endFrequency } = {}) {
  if (!state.audioContext) return;
  if (state.audioContext.state === 'suspended') state.audioContext.resume();
  const osc = state.audioContext.createOscillator();
  const gNode = state.audioContext.createGain();
  const now = state.audioContext.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  if (endFrequency) osc.frequency.linearRampToValueAtTime(endFrequency, now + duration);
  gNode.gain.setValueAtTime(0, now);
  gNode.gain.linearRampToValueAtTime(gain, now + 0.01);
  gNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.01);
  osc.connect(gNode);
  gNode.connect(state.audioContext.destination);
  osc.start(now);
  osc.stop(now + duration + 0.01);
}

export function playSequence(soundDefinition) {
  if (soundDefinition.sequence && Array.isArray(soundDefinition.sequence)) {
    soundDefinition.sequence.forEach(note => {
      if (note.delay) setTimeout(() => playSingleBeep(note), note.delay);
      else playSingleBeep(note);
    });
  } else {
    playSingleBeep(soundDefinition);
  }
}

export const correctBeep = {
  name: '정답',
  sequence: [
    { frequency: 523, duration: 0.07, type: 'triangle', gain: 0.25 },
    { delay: 80, frequency: 659, duration: 0.07, type: 'triangle', gain: 0.25 },
    { delay: 160, frequency: 783, duration: 0.07, type: 'triangle', gain: 0.25 }
  ]
};

export const incorrectBeep = {
  name: '오답',
  sequence: [
    { frequency: 400, duration: 0.07, type: 'square', gain: 0.15 },
    { delay: 90, frequency: 400, duration: 0.07, type: 'square', gain: 0.15 }
  ]
};

export const nonInteractiveWords = new Set([
  'a', 'an', 'the',
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours',
  'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its',
  'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs',
  'this', 'that', 'these', 'those',
  'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves',
  'something', 'somebody', 'someone', 'anything', 'anybody', 'anyone',
  'nothing', 'nobody', 'no one', 'everything', 'everybody', 'everyone',
  'all', 'any', 'both', 'each', 'either', 'every', 'few', 'little',
  'many', 'much', 'neither', 'none', 'one', 'other', 'several', 'some',
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around',
  'at', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond',
  'by', 'down', 'during', 'for', 'from', 'in', 'inside', 'into', 'like',
  'near', 'of', 'off', 'on', 'onto', 'out', 'outside', 'over', 'past',
  'since', 'through', 'throughout', 'to', 'toward', 'under', 'underneath',
  'until', 'unto', 'up', 'upon', 'with', 'within', 'without',
  'and', 'but', 'or', 'nor', 'yet', 'so',
  'after', 'although', 'as', 'because', 'before', 'if', 'once', 'since',
  'than', 'though', 'till', 'unless', 'until', 'when', 'whenever',
  'where', 'whereas', 'wherever', 'whether', 'while',
  'that', 'which', 'who', 'whom', 'whose',
  'what', 'whatever', 'whichever', 'whoever', 'whomever',
  'when', 'where', 'why', 'how',
  'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'done',
  'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'ought',
  'not', 'very', 'too', 'so', 'just', 'well', 'often', 'always', 'never', 'sometimes',
  'here', 'there', 'now', 'then', 'again', 'also', 'ever', 'even',
  'quite', 'rather', 'soon', 'still', 'more', 'most', 'less', 'least',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  "don't", "didn't", "can't", "couldn't", "won't", "wouldn't", "shouldn't",
  "she's", "he's", "i'm", "you're", "they're", "we're", "it's", "that's",
  "i've", "you've", "we've", "they've", "i'd", "you'd", "he'd", "she'd",
]);
