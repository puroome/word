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
        // 인증 관련
        loginScreen: document.getElementById('login-screen'),
        googleLoginBtn: document.getElementById('google-login-btn'),
        loginError: document.getElementById('login-error'),
        
        // 메인 컨테이너
        appWrapper: document.getElementById('app-wrapper'), // ID 수정됨
        
        // 상단 바 버튼
        homeBtn: document.getElementById('home-btn'),
        refreshBtn: document.getElementById('refresh-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        ttsToggleBtn: document.getElementById('tts-toggle-btn'),
        ttsToggleText: document.getElementById('tts-toggle-text'),
        
        // 메인 화면(선택 화면) 및 버튼들
        selectionScreen: document.getElementById('selection-screen'),
        selectLearningBtn: document.getElementById('select-learning-btn'),
        selectQuizBtn: document.getElementById('select-quiz-btn'),
        selectDashboardBtn: document.getElementById('select-dashboard-btn'),
        selectMistakesBtn: document.getElementById('select-mistakes-btn'),
        selectFavoritesBtn: document.getElementById('select-favorites-btn'),

        // 각 기능별 컨테이너 (화면들)
        dashboardContainer: document.getElementById('dashboard-container'),
        quizModeContainer: document.getElementById('quiz-mode-container'),
        learningModeContainer: document.getElementById('learning-mode-container'),

        // 정보 표시
        userInfo: document.getElementById('user-info'),
        userName: document.getElementById('user-name'),
        userEmail: document.getElementById('user-email'),
        userAvatar: document.getElementById('user-avatar'),
        syncStatus: document.getElementById('sync-status'),
        imeWarning: document.getElementById('ime-warning'),
        noSampleMessage: document.getElementById('no-sample-message')
    },
    
    imeWarningTimeout: null,
    authInstance: null, // 로그아웃을 위해 auth 객체 저장

    async init() {
        await Promise.all([
            audioCache.init(),
            translationCache.init(),
            imageDBCache.init()
        ]);

        const { initializeApp, getFirestore, getDatabase, getAuth } = window.firebaseSDK;
        
        const firebaseApp = initializeApp(config.FIREBASE_CONFIG);
        const db = getFirestore(firebaseApp);
        const database = getDatabase(firebaseApp, config.FIREBASE_CONFIG.databaseURL);
        this.authInstance = getAuth(firebaseApp);

        api.init(db, database);
        
        learningMode.init();
        quizMode.init();
        dashboard.init();

        this.bindEvents();
        this.setupAuth(this.authInstance);
        this.loadSettings();

        setInterval(() => this.syncData(), 10000);
    },

    bindEvents() {
        // 로그인
        if (this.elements.googleLoginBtn) {
            this.elements.googleLoginBtn.addEventListener('click', () => this.handleLogin());
        }

        // --- 상단 네비게이션 버튼 ---
        if (this.elements.homeBtn) {
            this.elements.homeBtn.addEventListener('click', () => this.navigateTo('home'));
        }
        if (this.elements.refreshBtn) {
            this.elements.refreshBtn.addEventListener('click', async () => {
                const icon = this.elements.refreshBtn.querySelector('svg');
                if(icon) icon.classList.add('animate-spin');
                await api.loadWordList(true);
                await api.loadUserProgress();
                if(icon) icon.classList.remove('animate-spin');
                ui.showToast("데이터를 새로고침했습니다.");
            });
        }
        if (this.elements.logoutBtn) {
            this.elements.logoutBtn.addEventListener('click', () => {
                if (confirm("로그아웃 하시겠습니까?")) {
                    window.firebaseSDK.signOut(this.authInstance);
                }
            });
        }
        if (this.elements.ttsToggleBtn) {
            this.elements.ttsToggleBtn.addEventListener('click', () => this.toggleTTS());
        }

        // --- 메인 선택 화면 버튼 (기능 연결 복구) ---
        if (this.elements.selectLearningBtn) {
            this.elements.selectLearningBtn.addEventListener('click', () => {
                this.navigateTo('learning');
                learningMode.resetStartScreen();
            });
        }
        if (this.elements.selectQuizBtn) {
            this.elements.selectQuizBtn.addEventListener('click', () => {
                this.navigateTo('quiz');
                quizMode.reset();
            });
        }
        if (this.elements.selectDashboardBtn) {
            this.elements.selectDashboardBtn.addEventListener('click', () => {
                this.navigateTo('dashboard');
            });
        }
        if (this.elements.selectMistakesBtn) {
            this.elements.selectMistakesBtn.addEventListener('click', () => {
                const mistakes = Object.keys(state.currentProgress).filter(word => {
                    const prog = state.currentProgress[word];
                    return Object.values(prog).includes('incorrect');
                });
                
                if (mistakes.length === 0) {
                    ui.showToast("오답 기록이 없습니다.", true);
                    return;
                }
                this.navigateTo('learning');
                learningMode.startMistakeReview(mistakes);
            });
        }
        if (this.elements.selectFavoritesBtn) {
            this.elements.selectFavoritesBtn.addEventListener('click', () => {
                this.navigateTo('learning');
                learningMode.startFavoriteMode();
            });
        }

        // --- 모듈 간 네비게이션 이벤트 수신 ---
        window.addEventListener('navigate', (e) => {
            const { mode, options } = e.detail;
            if (mode === 'selection' || mode === 'home') this.navigateTo('home');
            else if (mode === 'quiz') this.navigateTo('quiz');
            else if (mode === 'quiz-play') this.navigateTo('quiz'); // 퀴즈 컨테이너 유지
            else if (mode === 'learning') this.navigateTo('learning');
            else if (mode === 'mistakeReview') {
                this.navigateTo('learning');
                learningMode.startMistakeReview(options.mistakeWords);
            }
        });

        window.addEventListener('showToast', (e) => ui.showToast(e.detail.message, e.detail.isError));
        window.addEventListener('showImeWarning', () => this.showImeWarning());
        window.addEventListener('syncRequest', () => this.syncData());

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#word-context-menu')) ui.hideWordContextMenu();
            if (!e.target.closest('#translation-tooltip') && e.target.id !== 'translation-tooltip') ui.hideTranslationTooltip();
        });
    },

    // [핵심 수정] 화면 겹침 방지: 모든 화면을 숨기고 타겟만 보여줌
    navigateTo(screenName) {
        // 1. 모든 메인 컨테이너 숨기기
        const containers = [
            this.elements.selectionScreen,
            this.elements.dashboardContainer,
            this.elements.quizModeContainer,
            this.elements.learningModeContainer
        ];
        containers.forEach(el => {
            if (el) el.classList.add('hidden');
        });

        // 2. 상단 홈 버튼 표시 여부 (홈 화면이 아닐 때만 표시)
        if (this.elements.homeBtn) {
            if (screenName === 'home') this.elements.homeBtn.classList.add('hidden');
            else this.elements.homeBtn.classList.remove('hidden');
        }
        if (this.elements.refreshBtn) {
             if (screenName === 'home') this.elements.refreshBtn.classList.remove('hidden');
             else this.elements.refreshBtn.classList.add('hidden');
        }

        // 3. 타겟 화면 보여주기
        switch (screenName) {
            case 'home':
                if (this.elements.selectionScreen) this.elements.selectionScreen.classList.remove('hidden');
                break;
            case 'dashboard':
                if (this.elements.dashboardContainer) {
                    this.elements.dashboardContainer.classList.remove('hidden');
                    dashboard.render();
                }
                break;
            case 'quiz':
                if (this.elements.quizModeContainer) this.elements.quizModeContainer.classList.remove('hidden');
                break;
            case 'learning':
                if (this.elements.learningModeContainer) this.elements.learningModeContainer.classList.remove('hidden');
                break;
        }
    },

    setupAuth(auth) {
        const { onAuthStateChanged } = window.firebaseSDK;
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                if (user.email !== config.ALLOWED_USER_EMAIL) {
                    if (this.elements.loginError) {
                        this.elements.loginError.textContent = "허용되지 않은 사용자입니다.";
                        this.elements.loginError.classList.remove('hidden');
                    }
                    await window.firebaseSDK.signOut(auth);
                    return;
                }
                state.userId = user.uid;
                state.isAppStarted = true;
                this.updateUserInfo(user);
                
                if (this.elements.loginScreen) this.elements.loginScreen.classList.add('hidden');
                if (this.elements.appWrapper) this.elements.appWrapper.classList.remove('hidden');
                
                await api.loadWordList();
                await api.loadUserProgress();
                
                // 로그인 성공 시 홈 화면(선택 화면)으로 이동
                this.navigateTo('home');
                studyTracker.start();

            } else {
                state.userId = null;
                state.isAppStarted = false;
                if (this.elements.loginScreen) this.elements.loginScreen.classList.remove('hidden');
                if (this.elements.appWrapper) this.elements.appWrapper.classList.add('hidden');
                studyTracker.stop();
            }
        });
    },

    async handleLogin() {
        const { signInWithPopup, GoogleAuthProvider } = window.firebaseSDK;
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(this.authInstance, provider);
        } catch (error) {
            if (this.elements.loginError) {
                this.elements.loginError.textContent = "로그인 실패: " + error.message;
                this.elements.loginError.classList.remove('hidden');
            } else {
                alert("로그인 실패: " + error.message);
            }
        }
    },

    updateUserInfo(user) {
        if (this.elements.userName) this.elements.userName.textContent = user.displayName;
        if (this.elements.userEmail) this.elements.userEmail.textContent = user.email;
        if (this.elements.userAvatar) this.elements.userAvatar.src = user.photoURL;
    },

    loadSettings() {
        const savedVoice = localStorage.getItem(state.LOCAL_STORAGE_KEYS.TTS_VOICE);
        if (savedVoice) state.currentVoiceSet = savedVoice;
        this.updateTTSToggleUI();
    },

    toggleTTS() {
        const btn = this.elements.ttsToggleBtn;
        if (!btn) return;
        btn.classList.toggle('is-flipped');
        
        setTimeout(() => {
            state.currentVoiceSet = (state.currentVoiceSet === 'UK') ? 'US' : 'UK';
            this.updateTTSToggleUI();
            try { localStorage.setItem(state.LOCAL_STORAGE_KEYS.TTS_VOICE, state.currentVoiceSet); } catch (e) { console.error(e); }
        }, 250);
    },

    updateTTSToggleUI() {
        const btn = this.elements.ttsToggleBtn;
        if (!btn) return;
        if (this.elements.ttsToggleText) this.elements.ttsToggleText.textContent = state.currentVoiceSet;
        
        btn.classList.toggle('bg-indigo-700', state.currentVoiceSet === 'UK');
        btn.classList.toggle('hover:bg-indigo-800', state.currentVoiceSet === 'UK');
        btn.classList.toggle('bg-red-500', state.currentVoiceSet === 'US');
        btn.classList.toggle('hover:bg-red-600', state.currentVoiceSet === 'US');
    },

    showImeWarning() {
        if (!this.elements.imeWarning) return;
        this.elements.imeWarning.classList.remove('hidden');
        clearTimeout(this.imeWarningTimeout);
        this.imeWarningTimeout = setTimeout(() => {
            this.elements.imeWarning.classList.add('hidden');
        }, 2000);
    },

    async syncData() {
        if (!state.userId) return;
        
        if (this.elements.syncStatus) {
            this.elements.syncStatus.classList.remove('opacity-0');
        }
        
        let hasUpdates = false;

        const timeKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME;
        const unsyncedTime = parseInt(localStorage.getItem(timeKey) || '0');
        if (unsyncedTime > 0) {
            await api.updateStudyTime(unsyncedTime);
            localStorage.setItem(timeKey, '0');
            hasUpdates = true;
        }

        const quizKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ;
        const unsyncedQuiz = JSON.parse(localStorage.getItem(quizKey) || '{}');
        if (Object.keys(unsyncedQuiz).length > 0) {
            await api.syncQuizHistory(unsyncedQuiz);
            localStorage.setItem(quizKey, '{}');
            hasUpdates = true;
        }

        const progressKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
        const unsyncedProgress = JSON.parse(localStorage.getItem(progressKey) || '{}');
        if (Object.keys(unsyncedProgress).length > 0) {
             await api.syncProgressUpdates(unsyncedProgress);
             localStorage.setItem(progressKey, '{}');
             hasUpdates = true;
        }

        setTimeout(() => {
            if (this.elements.syncStatus) {
                this.elements.syncStatus.classList.add('opacity-0');
            }
        }, 1000);
    }
};

window.addEventListener('DOMContentLoaded', () => {
    if (window.firebaseSDK) {
        app.init();
    } else {
        document.addEventListener('firebaseSDKLoaded', () => app.init());
    }
});
