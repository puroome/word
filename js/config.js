export const config = {
    TTS_API_KEY: "AIzaSyAJmQBGY4H9DVMlhMtvAAVMi_4N7__DfKA",
    DEFINITION_API_KEY: "02d1892d-8fb1-4e2d-bc43-4ddd4a47eab3",
    SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzyBM33LzFsAe-mES_0Qw5B8w0ZPyYTDm4K_nLif5y2bXMpiQbD1LX5TTIDA4qX_Rnp/exec",
    ALLOWED_USER_EMAIL: "puroome@gmail.com",
    FIREBASE_CONFIG: {
        apiKey: "AIzaSyAX-cFBU45qFZTAtLYPTolSzqqLTfEvjP0",
        authDomain: "word-91148.firebaseapp.com",
        databaseURL: "https://word-91148-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "word-91148",
        storageBucket: "word-91148.firebasestorage.app",
        messagingSenderId: "53576845185",
        appId: "1:53576845185:web:f519aa3ec751e12cb88a80"
    }
};

export const state = {
    isAppStarted: false,
    userId: null,
    isWordListReady: false,
    lastCacheTimestamp: 0,
    wordList: [],
    currentProgress: {},
    currentVoiceSet: 'UK',
    isSpeaking: false,
    audioContext: null,
    currentSource: null,
    activeTranslationTarget: null,
    translationTimer: null,
    longPressTimer: null,
    
    // 오타 방지용 상수 (기능 변경 없음)
    LOCAL_STORAGE_KEYS: {
        TTS_VOICE: 'ttsVoice',
        LAST_INDEX: 'lastIndex',
        PRACTICE_MODE: 'practiceMode',
        UNSYNCED_TIME: 'unsyncedStudyTime',
        UNSYNCED_QUIZ: 'unsyncedQuizHistory',
        UNSYNCED_PROGRESS_UPDATES: 'unsyncedProgressUpdates'
    }
};
