export const config = {
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
    currentVoiceSet: 'UK',
    isSpeaking: false,
    audioContext: null,
    wordList: [],
    currentProgress: {},
    isWordListReady: false,
    lastCacheTimestamp: null,
    longPressTimer: null,
    translationTimer: null,
    activeTranslationTarget: null,
    LOCAL_STORAGE_KEYS: {
        TTS_VOICE: 'student_ttsVoice',
        LAST_INDEX: 'student_lastIndex_main',
        UNSYNCED_TIME: 'student_unsyncedTime_main',
        UNSYNCED_QUIZ: 'student_unsyncedQuizStats_main',
        UNSYNCED_PROGRESS_UPDATES: 'student_unsyncedProgress_main',
        PRACTICE_MODE: 'student_practiceMode_main',
        QUIZ_RANGE_START: 'student_quizRangeStart_main',
        QUIZ_RANGE_END: 'student_quizRangeEnd_main'
    }
};
