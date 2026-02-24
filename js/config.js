export const config = {
  FIREBASECONFIG: {
    apiKey:            "AIzaSyAX-cFBU45qFZTAtLYPTolSzqqLTfEvjP0",
    authDomain:        "word-91148.firebaseapp.com",
    databaseURL:       "https://word-91148-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "word-91148",
    storageBucket:     "word-91148.firebasestorage.app",
    messagingSenderId: "53576845185",
    appId:             "1:53576845185:web:f519aa3ec751e12cb88a80",
  },
  TTSAPIKEY:        "AIzaSyAJmQBGY4H9DVMlhMtvAAVMi4N7DfKA",
  DEFINITIONAPIKEY: "02d1892d-8fb1-4e2d-bc43-4ddd4a47eab3",
  SCRIPTURL:        "https://script.google.com/macros/s/AKfycbzyBM33LzFsAe-mES0Qw5B8w0ZPyYTDm4KnLif5y2bXMpiQbD1LX5TTIDA4qXRnpexec/exec",
  ALLOWEDUSEREMAIL: "puroome@gmail.com",
};


export const state = {
  isAppStarted: false,
  userId: null,
  currentVoiceSet: 'UK',
  audioContext: null,
  wordList: [],
  currentProgress: {},
  isWordListReady: false,
  lastCacheTimestamp: null,
  longPressTimer: null,
  translationTimer: null,
  activeTranslationTarget: null,
  LOCALSTORAGEKEYS: {
    TTSVOICE: 'studentttsVoice',
    LASTINDEX: 'studentlastIndexmain',
    UNSYNCEDTIME: 'studentunsyncedTimemain',
    UNSYNCEDQUIZ: 'studentunsyncedQuizStatsmain',
    UNSYNCEDPROGRESSUPDATES: 'studentunsyncedProgressmain',
    PRACTICEMODE: 'studentpracticeModemain',
    QUIZRANGESTART: 'studentquizRangeStartmain',
    QUIZRANGEEND: 'studentquizRangeEndmain'
  }
};
