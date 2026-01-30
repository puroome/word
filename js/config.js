// 환경 설정 및 API 키 관리
export const config = {
    // Google Cloud Text-to-Speech API Key
    TTS_API_KEY: "AIzaSyAJmQBGY4H9DVMlhMtvAAVMi_4N7__DfKA",
    
    // Merriam-Webster Dictionary API Key
    DEFINITION_API_KEY: "02d1892d-8fb1-4e2d-bc43-4ddd4a47eab3",
    
    // Google Apps Script Web App URL (Backend)
    SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzyBM33LzFsAe-mES_0Qw5B8w0ZPyYTDm4K_nLif5y2bXMpiQbD1LX5TTIDA4qX_Rnp/exec",
    
    // 관리자 이메일 (로그인 허용 대상)
    ALLOWED_USER_EMAIL: "puroome@gmail.com",
    
    // Firebase Configuration
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

// 전역 상태 관리 (Global State)
export const state = {
    // 앱 상태
    isAppStarted: false,
    userId: null,
    isWordListReady: false,
    lastCacheTimestamp: 0,
    
    // 데이터
    wordList: [],      // 전체 단어 리스트
    currentProgress: {}, // 사용자 학습 기록 (Firebase 동기화됨)
    
    // 오디오 및 UI 상태
    currentVoiceSet: 'UK', // 'UK' or 'US'
    isSpeaking: false,
    audioContext: null,
    currentSource: null, // 현재 재생 중인 오디오 소스 (중단용)
    
    // 인터랙션 상태
    activeTranslationTarget: null, // 현재 번역 툴팁이 떠있는 요소
    translationTimer: null,        // 툴팁 표시 딜레이 타이머
    longPressTimer: null,          // 모바일 롱프레스 감지 타이머
    
    // [신규] 로컬 스토리지 키 관리 (오타 방지용 상수)
    LOCAL_STORAGE_KEYS: {
        TTS_VOICE: 'ttsVoice',
        LAST_INDEX: 'lastIndex',
        PRACTICE_MODE: 'practiceMode',
        UNSYNCED_TIME: 'unsyncedStudyTime',
        UNSYNCED_QUIZ: 'unsyncedQuizHistory',
        UNSYNCED_PROGRESS_UPDATES: 'unsyncedProgressUpdates',
        QUIZ_RANGE_START: 'quizRangeStart',
        QUIZ_RANGE_END: 'quizRangeEnd'
    }
};
