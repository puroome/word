import { config, state } from './config.js';
import { utils, audioCache, translationCache, imageDBCache } from './utils.js';
import { api } from './api.js';
import { ui } from './ui.js';
import { learningMode } from './learning.js';
import { quizMode } from './quiz.js';
import { dashboard } from './dashboard.js';

const studyTracker = {
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
            if (now - this.lastActivityTimestamp < this.INACTIVITY_LIMIT) {
                this.sessionSeconds++;
            }
        }, 1000);
        this.saveInterval = setInterval(() => {
            if (this.sessionSeconds > 0) {
                try {
                    const currentLocalTime = parseInt(localStorage.getItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME) || '0');
                    localStorage.setItem(state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME, currentLocalTime + this.sessionSeconds);
                    this.sessionSeconds = 0;
                } catch (e) { console.error(e); }
            }
        }, 10000);
        ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
            document.addEventListener(evt, () => { this.lastActivityTimestamp = Date.now(); });
        });
        document.addEventListener('visibilitychange', () => {
             if (document.hidden) this.lastActivityTimestamp = 0;
             else this.lastActivityTimestamp = Date.now();
        });
    },
    stop() {
        clearInterval(this.timerInterval);
        clearInterval(this.saveInterval);
        this.timerInterval = null;
    }
};

const app = {
    elements: {
        loginScreen: document.getElementById('login-screen'),
        googleLoginBtn: document.getElementById('google-login-btn'),
        loginError: document.getElementById('login-error'),
        appContent: document.getElementById('app-content'),
        userInfo: document.getElementById('user-info'),
        userName: document.getElementById('user-name'),
        userEmail: document.getElementById('user-email'),
        userAvatar: document.getElementById('user-avatar'),
        tabButtons: document.querySelectorAll('.tab-btn'),
        tabContents: document.querySelectorAll('.tab-content'),
        ttsToggleBtn: document.getElementById('tts-toggle-btn'),
        ttsToggleText: document.getElementById('tts-toggle-text'),
        syncStatus: document.getElementById('sync-status'),
        imeWarning: document.getElementById('ime-warning'),
        noSampleMessage: document.getElementById('no-sample-message')
    },
    
    imeWarningTimeout: null,

    async init() {
        await Promise.all([
            audioCache.init(),
            translationCache.init(),
            imageDBCache.init()
        ]);

        const { getFirestore, getDatabase, getAuth, onAuthStateChanged } = window.firebaseSDK;
        const db = getFirestore();
        const database = getDatabase(undefined, config.FIREBASE_CONFIG.databaseURL);
        const auth = getAuth();

        api.init(db, database);
        
        // 하위 모듈 초기화
        learningMode.init();
        quizMode.init();
        dashboard.init();

        this.bindEvents();
        this.setupAuth(auth);
        this.loadSettings();

        // 1초마다 자동 동기화 시도 (Study Time 등)
        setInterval(() => this.syncData(), 10000);
    },

    bindEvents() {
        this.elements.googleLoginBtn.addEventListener('click', () => this.handleLogin());
        
        this.elements.tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                this.switchTab(tabName);
            });
        });

        this.elements.ttsToggleBtn.addEventListener('click', () => this.toggleTTS());

        // [중요] 모듈 간 통신을 위한 중앙 이벤트 리스너
        window.addEventListener('navigate', (e) => {
            const { mode, options } = e.detail;
            if (mode === 'quiz') this.switchTab('quiz');
            else if (mode === 'selection') this.switchTab('learning');
            else if (mode === 'quiz-play') {
                this.switchTab('quiz'); 
                // 퀴즈 탭 안에서 퀴즈 플레이 모드로 전환하는 로직은 quizMode가 처리함
            } else if (mode === 'mistakeReview') {
                this.switchTab('learning');
                learningMode.startMistakeReview(options.mistakeWords);
            }
        });

        window.addEventListener('showToast', (e) => {
            const { message, isError } = e.detail;
            ui.showToast(message, isError);
        });

        window.addEventListener('showImeWarning', () => {
            this.showImeWarning();
        });
        
        window.addEventListener('syncRequest', () => {
             this.syncData();
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#word-context-menu')) ui.hideWordContextMenu();
            if (!e.target.closest('#translation-tooltip') && e.target.id !== 'translation-tooltip') ui.hideTranslationTooltip();
        });
    },

    setupAuth(auth) {
        const { onAuthStateChanged } = window.firebaseSDK;
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                if (user.email !== config.ALLOWED_USER_EMAIL) {
                    this.elements.loginError.textContent = "허용되지 않은 사용자입니다.";
                    this.elements.loginError.classList.remove('hidden');
                    await window.firebaseSDK.signOut(auth);
                    return;
                }
                state.userId = user.uid;
                state.isAppStarted = true;
                this.updateUserInfo(user);
                this.elements.loginScreen.classList.add('hidden');
                this.elements.appContent.classList.remove('hidden');
                
                await api.loadWordList();
                await api.loadUserProgress();
                
                // 앱 시작 시 대시보드 먼저 보여주기
                this.switchTab('dashboard');
                studyTracker.start();

            } else {
                state.userId = null;
                state.isAppStarted = false;
                this.elements.loginScreen.classList.remove('hidden');
                this.elements.appContent.classList.add('hidden');
                studyTracker.stop();
            }
        });
    },

    async handleLogin() {
        const { signInWithPopup, GoogleAuthProvider, getAuth } = window.firebaseSDK;
        const auth = getAuth();
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            this.elements.loginError.textContent = "로그인 실패: " + error.message;
            this.elements.loginError.classList.remove('hidden');
        }
    },

    updateUserInfo(user) {
        this.elements.userName.textContent = user.displayName;
        this.elements.userEmail.textContent = user.email;
        this.elements.userAvatar.src = user.photoURL;
    },

    switchTab(tabName) {
        this.elements.tabButtons.forEach(btn => {
            if (btn.dataset.tab === tabName) {
                btn.classList.add('text-blue-600', 'active');
                btn.classList.remove('text-gray-500');
            } else {
                btn.classList.remove('text-blue-600', 'active');
                btn.classList.add('text-gray-500');
            }
        });

        this.elements.tabContents.forEach(content => content.classList.add('hidden'));
        document.getElementById(`${tabName}-container`).classList.remove('hidden');

        if (tabName === 'learning') {
            if (learningMode.elements.appContainer.classList.contains('hidden')) {
                learningMode.resetStartScreen();
            }
        } else if (tabName === 'quiz') {
            if (quizMode.elements.contentContainer.classList.contains('hidden')) {
                quizMode.reset();
            }
        } else if (tabName === 'dashboard') {
            dashboard.render();
        }
    },

    loadSettings() {
        const savedVoice = localStorage.getItem(state.LOCAL_STORAGE_KEYS.TTS_VOICE);
        if (savedVoice) state.currentVoiceSet = savedVoice;
        this.updateTTSToggleUI();
    },

    toggleTTS() {
        const btn = this.elements.ttsToggleBtn;
        btn.classList.toggle('is-flipped');
        
        setTimeout(() => {
            state.currentVoiceSet = (state.currentVoiceSet === 'UK') ? 'US' : 'UK';
            this.updateTTSToggleUI();
            try { localStorage.setItem(state.LOCAL_STORAGE_KEYS.TTS_VOICE, state.currentVoiceSet); } catch (e) { console.error(e); }
        }, 250);
    },

    updateTTSToggleUI() {
        const btn = this.elements.ttsToggleBtn;
        this.elements.ttsToggleText.textContent = state.currentVoiceSet;
        
        btn.classList.toggle('bg-indigo-700', state.currentVoiceSet === 'UK');
        btn.classList.toggle('hover:bg-indigo-800', state.currentVoiceSet === 'UK');
        btn.classList.toggle('bg-red-500', state.currentVoiceSet === 'US');
        btn.classList.toggle('hover:bg-red-600', state.currentVoiceSet === 'US');
    },

    showImeWarning() {
        this.elements.imeWarning.classList.remove('hidden');
        clearTimeout(this.imeWarningTimeout);
        this.imeWarningTimeout = setTimeout(() => {
            this.elements.imeWarning.classList.add('hidden');
        }, 2000);
    },

    async syncData() {
        if (!state.userId) return;
        this.elements.syncStatus.classList.remove('opacity-0');
        
        let hasUpdates = false;

        // 1. 학습 시간 동기화
        const timeKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME;
        const unsyncedTime = parseInt(localStorage.getItem(timeKey) || '0');
        if (unsyncedTime > 0) {
            await api.updateStudyTime(unsyncedTime);
            localStorage.setItem(timeKey, '0');
            hasUpdates = true;
        }

        // 2. 퀴즈 결과 동기화
        const quizKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ;
        const unsyncedQuiz = JSON.parse(localStorage.getItem(quizKey) || '{}');
        if (Object.keys(unsyncedQuiz).length > 0) {
            await api.syncQuizHistory(unsyncedQuiz);
            localStorage.setItem(quizKey, '{}');
            hasUpdates = true;
        }

        // 3. 진척도(즐겨찾기, 퀴즈성공여부) 동기화
        const progressKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
        const unsyncedProgress = JSON.parse(localStorage.getItem(progressKey) || '{}');
        if (Object.keys(unsyncedProgress).length > 0) {
             await api.syncProgressUpdates(unsyncedProgress);
             localStorage.setItem(progressKey, '{}');
             hasUpdates = true;
        }

        setTimeout(() => {
            this.elements.syncStatus.classList.add('opacity-0');
        }, 1000);
    }
};

// 앱 진입점
window.addEventListener('DOMContentLoaded', () => {
    // Firebase SDK 로드 대기
    if (window.firebaseSDK) {
        app.init();
    } else {
        document.addEventListener('firebaseSDKLoaded', () => app.init());
    }
});
