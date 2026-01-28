import { state } from "./state.js";
import { LOCAL_STORAGE_KEYS } from "./config.js";
import { db, doc, setDoc, getDoc } from "./firebase-init.js"; // For studyTracker

export const utils = {
    levenshteinDistance(a = '', b = '') {
        const track = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
        for (let i = 0; i <= a.length; i += 1) track[0][i] = i;
        for (let j = 0; j <= b.length; j += 1) track[j][0] = j;
        for (let j = 1; j <= b.length; j += 1) {
            for (let i = 1; i <= a.length; i += 1) {
                const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
                track[j][i] = Math.min(track[j][i - 1] + 1, track[j - 1][i] + 1, track[j - 1][i - 1] + indicator);
            }
        }
        return track[b.length][a.length];
    },
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },
    formatSeconds(totalSeconds) {
        if (!totalSeconds || totalSeconds < 60) return `0분`;
        const d = Math.floor(totalSeconds / 86400);
        const h = Math.floor((totalSeconds % 86400) / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        let result = '';
        if (d > 0) result += `${d}일 `;
        if (h > 0) result += `${h}시간 `;
        if (m > 0) result += `${m}분`;
        return result.trim() || '0분';
    },
    addProgressUpdateToLocalSync(word, key, value) {
        try {
            const localKey = LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(localKey) || '{}');
            if (!unsynced[word]) { unsynced[word] = {}; }
            unsynced[word][key] = value;
            localStorage.setItem(localKey, JSON.stringify(unsynced));
        } catch (e) { console.error("Error adding progress update to localStorage sync", e); }
    },
    getWordStatus(word) {
        let localStatus = {};
        try {
            const key = LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(key) || '{}');
            if (unsynced[word]) { localStatus = unsynced[word]; }
        } catch(e) { console.warn("Error reading local progress:", e); }

        const progress = { ...(state.currentProgress[word] || {}), ...localStatus };
        if (Object.keys(progress).length === 0) return 'unseen';

        const statuses = ['MULTIPLE_CHOICE_MEANING', 'FILL_IN_THE_BLANK', 'MULTIPLE_CHOICE_DEFINITION'].map(type => progress[type] || 'unseen');
        if (statuses.includes('incorrect')) return 'review';
        if (statuses.every(s => s === 'correct')) return 'learned';
        if (statuses.some(s => s === 'correct')) return 'learning';
        return 'unseen';
    },
    isFavorite(word) {
        let isFav = state.currentProgress[word]?.favorite || false;
        try {
            const key = LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            const unsynced = JSON.parse(localStorage.getItem(key) || '{}');
            if (unsynced[word] && unsynced[word].favorite !== undefined) {
                isFav = unsynced[word].favorite;
            }
        } catch (e) { console.warn("Error reading local favorite status:", e); }
        return isFav;
    },
    getFavoriteWords() {
        let localUpdates = {};
        try {
            const key = LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
            localUpdates = JSON.parse(localStorage.getItem(key) || '{}');
        } catch (e) { console.warn("Error reading local favorites:", e); }

        const allProgress = state.currentProgress;
        const combinedKeys = new Set([...Object.keys(allProgress), ...Object.keys(localUpdates)]);

        const favoriteWords = [];
        combinedKeys.forEach(word => {
            const serverState = allProgress[word] || {};
            const localState = localUpdates[word] || {};
            const combinedState = {
                 ...serverState,
                 favorite: localState.favorite !== undefined ? localState.favorite : serverState.favorite,
                 favoritedAt: localState.favoritedAt !== undefined ? localState.favoritedAt : serverState.favoritedAt
             };
            if (combinedState.favorite === true) {
                 favoriteWords.push({ word: word, time: combinedState.favoritedAt || 0 });
            }
        });
        return favoriteWords.sort((a, b) => b.time - a.time).map(item => item.word);
    }
};

export const studyTracker = {
    sessionSeconds: 0,
    lastActivityTimestamp: 0,
    timerInterval: null,
    saveInterval: null,
    INACTIVITY_LIMIT: 30000,
    init() {},
    start() {
        if (this.timerInterval) return;
        this.lastActivityTimestamp = Date.now();
        this.sessionSeconds = 0;
        this.timerInterval = setInterval(() => {
            if (document.hidden) return;
            const now = Date.now();
            if (now - this.lastActivityTimestamp < this.INACTIVITY_LIMIT) { this.sessionSeconds++; }
        }, 1000);
        this.saveInterval = setInterval(() => {
            if (this.sessionSeconds > 0) {
                try {
                    const currentLocalTime = parseInt(localStorage.getItem(LOCAL_STORAGE_KEYS.UNSYNCED_TIME) || '0');
                    localStorage.setItem(LOCAL_STORAGE_KEYS.UNSYNCED_TIME, currentLocalTime + this.sessionSeconds);
                    this.sessionSeconds = 0;
                } catch (e) { console.error("Error saving study time", e); }
            }
        }, 10000);
        ['click', 'keydown', 'touchstart'].forEach(event => document.body.addEventListener(event, this.recordActivity, true));
    },
    stopAndSave() {
        if (!this.timerInterval) return;
        clearInterval(this.timerInterval);
        clearInterval(this.saveInterval);
        this.timerInterval = null;
        this.saveInterval = null;
        try {
            if (this.sessionSeconds > 0) {
                const currentLocalTime = parseInt(localStorage.getItem(LOCAL_STORAGE_KEYS.UNSYNCED_TIME) || '0');
                localStorage.setItem(LOCAL_STORAGE_KEYS.UNSYNCED_TIME, currentLocalTime + this.sessionSeconds);
            }
        } catch (e) { console.error("Error saving remaining study time", e); }
        this.sessionSeconds = 0;
        ['click', 'keydown', 'touchstart'].forEach(event => document.body.removeEventListener(event, this.recordActivity, true));
    },
    recordActivity() { studyTracker.lastActivityTimestamp = Date.now(); }
};

function playSingleBeep({ frequency, duration = 0.1, type = 'sine', gain = 0.3, endFrequency }) {
    if (!state.audioContext) return;
    if (state.audioContext.state === 'suspended') { state.audioContext.resume(); }
    const oscillator = state.audioContext.createOscillator();
    const gainNode = state.audioContext.createGain();
    const now = state.audioContext.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) { oscillator.frequency.linearRampToValueAtTime(endFrequency, now + duration); }
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(gain, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.01);
    oscillator.connect(gainNode);
    gainNode.connect(state.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
}

export function playSequence(soundDefinition) {
    if (soundDefinition.sequence && Array.isArray(soundDefinition.sequence)) {
        soundDefinition.sequence.forEach(note => {
            if (note.delay) { setTimeout(() => { playSingleBeep(note); }, note.delay); } 
            else { playSingleBeep(note); }
        });
    } else { playSingleBeep(soundDefinition); }
}

export const correctBeep = {
    name: '또로롱',
    sequence: [{ frequency: 523, duration: 0.07, type: 'triangle', gain: 0.25 }, { delay: 80, frequency: 659, duration: 0.07, type: 'triangle', gain: 0.25 }, { delay: 160, frequency: 783, duration: 0.07, type: 'triangle', gain: 0.25 }]
};

export const incorrectBeep = {
    name: '삐빅',
    sequence: [{ frequency: 400, duration: 0.07, type: 'square', gain: 0.15 }, { delay: 90, frequency: 400, duration: 0.07, type: 'square', gain: 0.15 }]
};