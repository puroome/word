export const state = {
    isAppStarted: false,
    userId: null,
    currentVoiceSet: 'UK',
    isSpeaking: false,
    audioContext: null,
    currentSource: null,
    wordList: [],
    currentProgress: {},
    isWordListReady: false,
    lastCacheTimestamp: null,
    longPressTimer: null,
    translationTimer: null,
    activeTranslationTarget: null,
    favorites: [],
    // DOM 요소들은 main.js 초기화 시점에 채워집니다.
    elements: {} 
};