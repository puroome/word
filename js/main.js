import { config, state } from './config.js';
import { utils, translationCache } from './utils.js';
import { api } from './api.js';
import { ui } from './ui.js';
import { learningMode } from './learning.js';
import { quizMode } from './quiz.js';
import { dashboard } from './dashboard.js';
import { features } from './features.js';
import { statsStore } from './stats-store.js';

const studyTracker = {
    sessionSecondsByDate: {},
    partialMilliseconds: 0,
    lastActivityTimestamp: 0,
    lastCountTimestamp: 0,
    timerInterval: null,
    saveInterval: null,
    INACTIVITY_LIMIT: 120000,

    _recordElapsed(now = Date.now()) {
        if (!this.lastCountTimestamp) {
            this.lastCountTimestamp = now;
            return;
        }
        if (document.hidden) {
            this.lastCountTimestamp = now;
            return;
        }
        const activeUntil = Math.min(now, this.lastActivityTimestamp + this.INACTIVITY_LIMIT);
        const elapsed = Math.max(0, activeUntil - this.lastCountTimestamp);
        this.partialMilliseconds += elapsed;
        const wholeSeconds = Math.floor(this.partialMilliseconds / 1000);
        if (wholeSeconds > 0) {
            const date = utils.getLocalDateString();
            this.sessionSecondsByDate[date] =
                Number(this.sessionSecondsByDate[date] || 0) + wholeSeconds;
            this.partialMilliseconds -= wholeSeconds * 1000;
        }
        this.lastCountTimestamp = now;
    },

    _flushSessionTime() {
        try {
            Object.entries(this.sessionSecondsByDate).forEach(([date, seconds]) => {
                statsStore.addStudySeconds(date, seconds);
            });
            this.sessionSecondsByDate = {};
        } catch (e) { console.error(e); }
    },

    start() {
        if (this.timerInterval) return;
        const now = Date.now();
        this.lastActivityTimestamp = now;
        this.lastCountTimestamp = now;
        this.partialMilliseconds = 0;
        this.sessionSecondsByDate = {};
        this.timerInterval = setInterval(() => this._recordElapsed(), 1000);
        this.saveInterval = setInterval(() => {
            this._recordElapsed();
            this._flushSessionTime();
        }, 10000);
        ['click', 'keydown', 'touchstart'].forEach(event => document.body.addEventListener(event, this.recordActivity, true));
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    },
    stopAndSave() {
        if (!this.timerInterval) return;
        this._recordElapsed();
        clearInterval(this.timerInterval);
        clearInterval(this.saveInterval);
        this.timerInterval = null;
        this.saveInterval = null;
        this._flushSessionTime();
        ['click', 'keydown', 'touchstart'].forEach(event => document.body.removeEventListener(event, this.recordActivity, true));
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    },
    recordActivity() {
        studyTracker._recordElapsed();
        studyTracker.lastActivityTimestamp = Date.now();
    },
    handleVisibilityChange() {
        const now = Date.now();
        studyTracker._recordElapsed(now);
        if (!document.hidden) studyTracker.lastActivityTimestamp = now;
        studyTracker.lastCountTimestamp = now;
    }
};

const app = {
    elements: {
        loginScreen: document.getElementById('login-screen'),
        googleLoginBtn: document.getElementById('google-login-btn'),
        loginError: document.getElementById('login-error'),
        logoutBtn: document.getElementById('logout-btn'),
        appWrapper: document.getElementById('app-wrapper'),
        selectionScreen: document.getElementById('selection-screen'),
        homeBtn: document.getElementById('home-btn'),
        refreshBtn: document.getElementById('refresh-btn'),
        ttsToggleBtn: document.getElementById('tts-toggle-btn'),
        ttsToggleText: document.getElementById('tts-toggle-text'),
        quizModeContainer: document.getElementById('quiz-mode-container'),
        learningModeContainer: document.getElementById('learning-mode-container'),
        dashboardContainer: document.getElementById('dashboard-container'),
        imeWarning: document.getElementById('ime-warning'),
        globalLoader: document.getElementById('global-loader'),
        wordContextMenu: document.getElementById('word-context-menu'),
        selectLearningBtn: document.getElementById('select-learning-btn'),
        selectQuizBtn: document.getElementById('select-quiz-btn'),
        selectDashboardBtn: document.getElementById('select-dashboard-btn'),
        selectMistakesBtn: document.getElementById('select-mistakes-btn'),
        selectFavoritesBtn: document.getElementById('select-favorites-btn'),
        progressBarContainer: document.getElementById('progress-bar-container'),
        lastUpdatedText: document.getElementById('last-updated-text'),
        practiceModeControl: document.getElementById('practice-mode-control'),
        practiceModeCheckbox: document.getElementById('practice-mode-checkbox'),
        mistakeModeModal: document.getElementById('mistake-mode-modal'),
        mistakeModeCount: document.getElementById('mistake-mode-count'),
        mistakeVocabBtn: document.getElementById('mistake-vocab-btn'),
        mistakeQuizBtn: document.getElementById('mistake-quiz-btn'),
        mistakeModeCancelBtn: document.getElementById('mistake-mode-cancel-btn'),
    },
    _pendingMistakeItems: [],

    init() {
        const startFirebaseApp = () => {
            const { initializeApp, getDatabase, getAuth, getFirestore, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } = window.firebaseSDK;

            const firebaseApp = initializeApp(config.FIREBASE_CONFIG);
            const database = getDatabase(firebaseApp);
            const auth = getAuth(firebaseApp);
            const db = getFirestore(firebaseApp);

            api.init(db, database, auth);

            onAuthStateChanged(auth, async (user) => {
                if (user && user.email === config.ALLOWED_USER_EMAIL) {
                    state.userId = user.uid;
                    const { doc, setDoc } = window.firebaseSDK;
                    const userRef = doc(db, 'users', user.uid);
                    await setDoc(userRef, { displayName: user.displayName, email: user.email }, { merge: true });

                    this.elements.loginScreen.classList.add('hidden');
                    this.elements.appWrapper.classList.remove('hidden');
                    if (!state.isAppStarted) {
                        await this.startApp();
                    }
                } else {
                    this.elements.loginScreen.classList.remove('hidden');
                    this.elements.appWrapper.classList.add('hidden');
                    if (user) {
                        signOut(auth);
                    }
                }
            });

            this.bindGlobalEvents(auth, signInWithPopup, GoogleAuthProvider, signOut);
        };

        if (window.firebaseSDK) {
            startFirebaseApp();
        } else {
            document.addEventListener('firebaseSDKLoaded', startFirebaseApp);
        }
    },

    async startApp() {
        state.isAppStarted = true;

        try {
            const savedVoice = localStorage.getItem(state.LOCAL_STORAGE_KEYS.TTS_VOICE);
            if (savedVoice) {
                state.currentVoiceSet = savedVoice;
                this.elements.ttsToggleText.textContent = savedVoice;
                this.elements.ttsToggleBtn.classList.toggle('bg-blue-100', savedVoice === 'UK');   // bg-blue-200/80 → bg-blue-100
                this.elements.ttsToggleBtn.classList.toggle('bg-red-100', savedVoice === 'US');
            }
            const savedPracticeMode = localStorage.getItem(state.LOCAL_STORAGE_KEYS.PRACTICE_MODE);
            if (savedPracticeMode === 'true') {
                quizMode.state.isPracticeMode = true;
                this.elements.practiceModeCheckbox.checked = true;
            }
        } catch (e) { console.error(e); }

        try {
            await Promise.all([translationCache.init()]);
        } catch (e) { console.error(e); }

        await this.syncOfflineData();

        try {
            await api.loadWordList();
            await api.loadUserProgress();
            this.updateLastUpdatedText();
        } catch (e) { return; }

        quizMode.init();
        learningMode.init();
        dashboard.init();
        features.init();

        quizMode.preloadAllQuizTypesBasedOnSavedRange();

        const initialMode = window.location.hash.replace('#', '') || 'selection';
        history.replaceState({ mode: initialMode, options: {} }, '', window.location.href);
        this._renderMode(initialMode);
    },

    bindGlobalEvents(auth, signInWithPopup, GoogleAuthProvider, signOut) {
        this.elements.googleLoginBtn.addEventListener('click', async () => {
             const provider = new GoogleAuthProvider();
             this.elements.loginError.textContent = '';
             try { await signInWithPopup(auth, provider); }
             catch (error) { this.elements.loginError.textContent = '로그인 실패'; }
        });

        this.elements.logoutBtn.addEventListener('click', () => signOut(auth));

        const unlockAudioContext = async () => {
            if (!state.audioContext) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                state.audioContext = new AudioContext();
            }
            if (state.audioContext.state === 'suspended') {
                try { await state.audioContext.resume(); } catch (e) {}
            }
            ['click', 'touchstart', 'keydown'].forEach(event => document.body.removeEventListener(event, unlockAudioContext, { capture: true }));
        };
        ['click', 'touchstart', 'keydown'].forEach(event => document.body.addEventListener(event, unlockAudioContext, { capture: true, once: true }));

        this.elements.selectQuizBtn.addEventListener('click', () => this.navigateTo('quiz'));
        this.elements.selectLearningBtn.addEventListener('click', () => this.navigateTo('learning'));
        this.elements.selectDashboardBtn.addEventListener('click', () => this.navigateTo('dashboard'));
        this.elements.selectFavoritesBtn.addEventListener('click', () => this.navigateTo('favorites'));
        this.elements.selectMistakesBtn.addEventListener('click', () => {
            const reviewItems = utils.getMistakeReviewItems();
            if (reviewItems.length === 0) {
                this.showToast('오답 노트에 단어가 없습니다.', true);
                return;
            }
            this._pendingMistakeItems = reviewItems;
            const wordCount = new Set(reviewItems.map(item => item.word)).size;
            this.elements.mistakeModeCount.textContent =
                `${wordCount}개 단어 · ${reviewItems.length}개 오답 유형`;
            this.elements.mistakeModeModal.classList.remove('hidden');
        });
        this.elements.mistakeVocabBtn.addEventListener('click', () => {
            const mistakeWords = [...new Set(this._pendingMistakeItems.map(item => item.word))];
            this.elements.mistakeModeModal.classList.add('hidden');
            this.navigateTo('mistakeReview', { mistakeWords });
        });
        this.elements.mistakeQuizBtn.addEventListener('click', () => {
            const reviewItems = [...this._pendingMistakeItems];
            this.elements.mistakeModeModal.classList.add('hidden');
            this.navigateTo('quiz-play', { reviewItems });
        });
        this.elements.mistakeModeCancelBtn.addEventListener('click', () =>
            this.elements.mistakeModeModal.classList.add('hidden')
        );
        this.elements.mistakeModeModal.addEventListener('click', event => {
            if (event.target === this.elements.mistakeModeModal) {
                this.elements.mistakeModeModal.classList.add('hidden');
            }
        });

        this.elements.homeBtn.addEventListener('click', () => this.navigateTo('selection'));
        this.elements.refreshBtn.addEventListener('click', () => this.forceReload());
        this.elements.ttsToggleBtn.addEventListener('click', () => this.toggleVoiceSet());
        this.elements.practiceModeCheckbox.addEventListener('change', (e) => {
            quizMode.state.isPracticeMode = e.target.checked;
            localStorage.setItem(state.LOCAL_STORAGE_KEYS.PRACTICE_MODE, quizMode.state.isPracticeMode);
            if (history.state?.mode === 'quiz-play') {
                 quizMode.reset(false);
                 quizMode.displayNextQuiz();
            }
        });

        document.addEventListener('click', (e) => {
            if (this.elements.wordContextMenu && !this.elements.wordContextMenu.contains(e.target)) {
                ui.hideWordContextMenu();
            }
        });

        window.addEventListener('popstate', (e) => {
            // [편집-뒤로가기] 편집 중이면 화면 이동 대신 '편집 종료(필요 시 저장 확인)'로 처리
            if (learningMode.state.isEditing) {
                learningMode.handleBackWhileEditing();
                return;
            }
            this.syncOfflineData();
            const mode = e.state?.mode || 'selection';
            const options = e.state?.options || {};
            this._renderMode(mode, options);
        });

        document.addEventListener('contextmenu', (e) => {
            const target = e.target;
            const isInteractiveTrigger = target.closest('.interactive-word, #word-display');
            const isCustomContextMenu = target.closest('#word-context-menu');
            const isEditContextMenu = target.closest('#edit-context-menu');
            const isEditTrigger = target.closest('#meaning-container, #explanation-container');

            if (!isInteractiveTrigger && !isCustomContextMenu && !isEditContextMenu && !isEditTrigger) {
                e.preventDefault();
            }
        });

        window.addEventListener('beforeunload', () => {
             studyTracker.stopAndSave();
        });

        window.addEventListener('navigate', (e) => this.navigateTo(e.detail.mode, e.detail.options));
        window.addEventListener('showToast', (e) => this.showToast(e.detail.message, e.detail.isError));
        window.addEventListener('showImeWarning', () => this.showImeWarning());
        window.addEventListener('syncRequest', () => this.syncOfflineData());
        document.addEventListener('searchWord', (e) => this.searchWordInLearningMode(e.detail));
    },

    async syncOfflineData() {
        if (!state.userId) return;
        if (this._syncPromise) return this._syncPromise;

        const progressKey = state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
        this._syncPromise = (async () => {
            const readJson = (key) => {
                try {
                    return JSON.parse(localStorage.getItem(key) || 'null');
                } catch (error) {
                    console.warn(`로컬 동기화 데이터가 손상되어 초기화합니다: ${key}`, error);
                    localStorage.removeItem(key);
                    return null;
                }
            };
            const statsSnapshot = statsStore.snapshot();
            const progressToSync = readJson(progressKey);
            const syncedSnapshot = { study: {}, quiz: {} };

            try {
                if (Object.keys(statsSnapshot.study).length > 0) {
                    await api.syncStudyHistory(statsSnapshot.study);
                    syncedSnapshot.study = statsSnapshot.study;
                }
            } catch (error) {
                console.error("학습 시간 동기화 실패:", error);
            }

            try {
                if (Object.keys(statsSnapshot.quiz).length > 0) {
                    await api.syncQuizHistory(statsSnapshot.quiz);
                    syncedSnapshot.quiz = statsSnapshot.quiz;
                }
            } catch (error) {
                console.error("퀴즈 기록 동기화 실패:", error);
            }
            statsStore.subtractSnapshot(syncedSnapshot);

            try {
                if (progressToSync && Object.keys(progressToSync).length > 0) {
                    await api.syncProgressUpdates(progressToSync);
                    const cur = JSON.parse(localStorage.getItem(progressKey) || '{}');
                    for (const word in progressToSync) {
                        if (!cur[word]) continue;
                        for (const key in progressToSync[word]) {
                            if (cur[word][key] === progressToSync[word][key]) delete cur[word][key];
                        }
                        if (Object.keys(cur[word]).length === 0) delete cur[word];
                    }
                    if (Object.keys(cur).length > 0) localStorage.setItem(progressKey, JSON.stringify(cur));
                    else localStorage.removeItem(progressKey);
                }
            } catch (error) {
                console.error("단어 진행도 동기화 실패:", error);
            }
        })();

        try {
            await this._syncPromise;
        } finally {
            this._syncPromise = null;
        }
    },

    navigateTo(mode, options = {}) {
        const currentState = history.state || {};
        if (currentState.mode !== mode) {
        studyTracker._flushSessionTime();
        this.syncOfflineData();
        }
        if (currentState.mode === mode && JSON.stringify(currentState.options) === JSON.stringify(options) && !['learning', 'mistakeReview', 'favorites', 'quiz-play'].includes(mode)) return;

        const newPath = mode === 'selection' ? window.location.pathname + window.location.search : `#${mode}`;
        history.pushState({ mode, options }, '', newPath);
        this._renderMode(mode, options);
    },

    // 화면 전환 시 모든 모드 컨테이너/상단 버튼을 숨긴다(이후 모드별로 필요한 것만 다시 표시).
    _hideAllScreens() {
        [
            this.elements.refreshBtn,
            this.elements.selectionScreen,
            this.elements.quizModeContainer,
            this.elements.learningModeContainer,
            this.elements.dashboardContainer,
            this.elements.homeBtn,
            this.elements.logoutBtn,
            this.elements.ttsToggleBtn,
            this.elements.progressBarContainer,
            this.elements.practiceModeControl,
            learningMode.elements.fixedButtons,
            learningMode.elements.appContainer,
            learningMode.elements.startScreen,
        ].forEach(el => el && el.classList.add('hidden'));
    },

    async _renderMode(mode, options = {}) {
        studyTracker.stopAndSave();

        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }

        this._hideAllScreens();

        const showCommonButtons = () => {
            this.elements.homeBtn.classList.remove('hidden');
            this.elements.ttsToggleBtn.classList.remove('hidden');
        };

        if (['quiz-play', 'learning', 'mistakeReview', 'favorites'].includes(mode)) {
             studyTracker.start();
        }

        if (mode === 'quiz') {
            this.elements.homeBtn.classList.remove('hidden');
            this.elements.quizModeContainer.classList.remove('hidden');
            this.elements.practiceModeControl.classList.remove('hidden');
            quizMode.reset();
        } else if (mode === 'quiz-play') {
            showCommonButtons();
            this.elements.quizModeContainer.classList.remove('hidden');
            this.elements.practiceModeControl.classList.remove('hidden');
            if (options.mixed || options.reviewItems) {
                quizMode.configureSession(options);
            }
            quizMode.reset(false);
            if (!state.isWordListReady) await api.loadWordList();
            quizMode.displayNextQuiz();
        } else if (mode === 'learning') {
            showCommonButtons();
            this.elements.learningModeContainer.classList.remove('hidden');
            if (options.startIndex !== undefined && options.startIndex > -1) {
                learningMode.state.isMistakeMode = false;
                learningMode.state.isFavoriteMode = false;
                learningMode.state.currentWordList = state.wordList;
                learningMode.state.currentIndex = options.startIndex;
                learningMode.launchApp();
            } else {
                this.elements.learningModeContainer.querySelector('#learning-start-screen').classList.remove('hidden');
                learningMode.resetStartScreen();
            }
        } else if (mode === 'mistakeReview') {
            showCommonButtons();
            this.elements.learningModeContainer.classList.remove('hidden');
            learningMode.startMistakeReview(options.mistakeWords);
        } else if (mode === 'favorites') {
            showCommonButtons();
            this.elements.learningModeContainer.classList.remove('hidden');
            learningMode.startFavoriteMode();
        } else if (mode === 'dashboard') {
            this.elements.homeBtn.classList.remove('hidden');
            this.elements.dashboardContainer.classList.remove('hidden');
            await this.syncOfflineData();
            await dashboard.render();
        } else {
            this.elements.selectionScreen.classList.remove('hidden');
            this.elements.logoutBtn.classList.remove('hidden');

            if (this.elements.refreshBtn) {
                this.elements.refreshBtn.classList.remove('hidden');
            }

            quizMode.reset();
            learningMode.reset();
            await this.syncOfflineData();
            await features.render();
        }
    },
    async forceReload() {
        this.elements.globalLoader.classList.remove('hidden');
        const elementsToDisable = [
            this.elements.refreshBtn,
            this.elements.selectDashboardBtn,
            this.elements.selectMistakesBtn,
            this.elements.selectLearningBtn,
            this.elements.selectQuizBtn
        ];
        elementsToDisable.forEach(el => {
            if(el) el.classList.add('pointer-events-none', 'opacity-50');
        });

        try {
            await api.loadWordList(true);
            await api.loadUserProgress();
            this.updateLastUpdatedText();
            this.showToast('데이터를 성공적으로 새로고침했습니다!');
        } catch(e) {
            this.showToast('데이터 새로고침에 실패했습니다: ' + e.message, true);
        } finally {
            elementsToDisable.forEach(el => {
                if(el) el.classList.remove('pointer-events-none', 'opacity-50');
            });
            this.elements.globalLoader.classList.add('hidden');
        }
    },
    showToast(message, isError = false) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.className = `fixed top-20 left-1/2 -translate-x-1/2 text-white py-2 px-5 rounded-lg shadow-xl z-[200] text-lg font-semibold ${isError ? 'bg-red-500' : 'bg-green-500'}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.transition = 'opacity 0.5s';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 500);
        }, 2500);
    },
    updateLastUpdatedText() {
        if (this.elements.lastUpdatedText && state.lastCacheTimestamp) {
            const cacheDate = new Date(state.lastCacheTimestamp);
            const dateString = `${cacheDate.getFullYear()}-${String(cacheDate.getMonth() + 1).padStart(2, '0')}-${String(cacheDate.getDate()).padStart(2, '0')} ${String(cacheDate.getHours()).padStart(2, '0')}:${String(cacheDate.getMinutes()).padStart(2, '0')}`;
            this.elements.lastUpdatedText.textContent = `최종 업데이트 : ${dateString}`;
            this.elements.lastUpdatedText.classList.remove('hidden');
        } else if (this.elements.lastUpdatedText) {
            this.elements.lastUpdatedText.textContent = '업데이트 정보 없음';
            this.elements.lastUpdatedText.classList.remove('hidden');
        }
    },
    toggleVoiceSet() {
        const btn = this.elements.ttsToggleBtn;
        btn.classList.toggle('is-flipped');
        setTimeout(() => {
            state.currentVoiceSet = (state.currentVoiceSet === 'UK') ? 'US' : 'UK';
            this.elements.ttsToggleText.textContent = state.currentVoiceSet;
            btn.classList.toggle('bg-blue-100', state.currentVoiceSet === 'UK');
            btn.classList.toggle('bg-red-100', state.currentVoiceSet === 'US');
            try { localStorage.setItem(state.LOCAL_STORAGE_KEYS.TTS_VOICE, state.currentVoiceSet); } catch (e) { console.error(e); }
        }, 250);
    },
    showImeWarning() {
        this.elements.imeWarning.classList.remove('hidden');
        clearTimeout(this.imeWarningTimeout);
        this.imeWarningTimeout = setTimeout(() => {
            this.elements.imeWarning.classList.add('hidden');
        }, 2000);
    },

    searchWordInLearningMode(word) {
        if (!word) return;
        this.navigateTo('learning');
        setTimeout(() => {
            learningMode.elements.startWordInput.value = word;
            learningMode.start();
            ui.hideWordContextMenu();
        }, 10);
    }
};

app.init();
