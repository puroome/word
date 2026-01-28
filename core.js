// ================================================================
// js/core.js : 앱 코어, 상태 관리, API, 캐시
// ================================================================

let firebaseApp, database, auth, db;
let initializeApp, getDatabase, ref, get, update, set;
let getAuth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup;
let getFirestore, doc, getDoc, setDoc, updateDoc, writeBatch;

const app = {
    config: {
        TTS_API_KEY: "AIzaSyAJmQBGY4H9DVMlhMtvAAVMi_4N7__DfKA",
        DEFINITION_API_KEY: "02d1892d-8fb1-4e2d-bc43-4ddd4a47eab3",
        SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzyBM33LzFsAe-mES_0Qw5B8w0ZPyYTDm4K_nLif5y2bXMpiQbD1LX5TTIDA4qX_Rnp/exec",
        ALLOWED_USER_EMAIL: "puroome@gmail.com",
    },
    state: {
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
        favorites: [],
        currentSource: null,
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
    },
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
        noSampleMessage: document.getElementById('no-sample-message'),
        wordContextMenu: document.getElementById('word-context-menu'),
        searchAppContextBtn: document.getElementById('search-app-context-btn'),
        searchDaumContextBtn: document.getElementById('search-daum-context-btn'),
        searchNaverContextBtn: document.getElementById('search-naver-context-btn'),
        searchEtymContextBtn: document.getElementById('search-etym-context-btn'),
        searchLongmanContextBtn: document.getElementById('search-longman-context-btn'),
        selectLearningBtn: document.getElementById('select-learning-btn'),
        selectQuizBtn: document.getElementById('select-quiz-btn'),
        selectDashboardBtn: document.getElementById('select-dashboard-btn'),
        selectMistakesBtn: document.getElementById('select-mistakes-btn'),
        selectFavoritesBtn: document.getElementById('select-favorites-btn'),
        progressBarContainer: document.getElementById('progress-bar-container'),
        translationTooltip: document.getElementById('translation-tooltip'),
        lastUpdatedText: document.getElementById('last-updated-text'),
        practiceModeControl: document.getElementById('practice-mode-control'),
        practiceModeCheckbox: document.getElementById('practice-mode-checkbox'),
    },
    init() {
        this.initializeFirebaseAndAuth();
    },
    initializeFirebaseAndAuth() {
        const firebaseConfig = {
            apiKey: "AIzaSyAX-cFBU45qFZTAtLYPTolSzqqLTfEvjP0",
            authDomain: "word-91148.firebaseapp.com",
            databaseURL: "https://word-91148-default-rtdb.asia-southeast1.firebasedatabase.app",
            projectId: "word-91148",
            storageBucket: "word-91148.firebasestorage.app",
            messagingSenderId: "53576845185",
            appId: "1:53576845185:web:f519aa3ec751e12cb88a80"
        };
        firebaseApp = initializeApp(firebaseConfig);
        database = getDatabase(firebaseApp);
        auth = getAuth(firebaseApp);
        db = getFirestore(firebaseApp);
        writeBatch = window.firebaseSDK.writeBatch;

        onAuthStateChanged(auth, async (user) => {
            if (user && user.email === this.config.ALLOWED_USER_EMAIL) {
                this.state.userId = user.uid;
                const userRef = doc(db, 'users', user.uid);
                await setDoc(userRef, {
                    displayName: user.displayName,
                    email: user.email
                }, { merge: true });

                this.elements.loginScreen.classList.add('hidden');
                this.elements.appWrapper.classList.remove('hidden');
                if (!this.state.isAppStarted) {
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

        this.bindAuthEvents();
    },
    bindAuthEvents() {
        this.elements.googleLoginBtn.addEventListener('click', () => this.signInWithGoogle());
        this.elements.logoutBtn.addEventListener('click', () => signOut(auth));
    },
    async signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        this.elements.loginError.textContent = '';
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Google Sign-In failed:", error);
            if (error.code === 'auth/popup-closed-by-user') {
                this.elements.loginError.textContent = '로그인 팝업이 닫혔습니다.';
            } else {
                this.elements.loginError.textContent = 'Google 로그인 중 오류가 발생했습니다.';
            }
        }
    },
    async startApp() {
        this.state.isAppStarted = true;

        try {
            const savedVoice = localStorage.getItem(this.state.LOCAL_STORAGE_KEYS.TTS_VOICE);
            if (savedVoice) {
                this.state.currentVoiceSet = savedVoice;
                this.elements.ttsToggleText.textContent = savedVoice;
                this.elements.ttsToggleBtn.classList.toggle('bg-indigo-700', savedVoice === 'UK');
                this.elements.ttsToggleBtn.classList.toggle('hover:bg-indigo-800', savedVoice === 'UK');
                this.elements.ttsToggleBtn.classList.toggle('bg-red-500', savedVoice === 'US');
                this.elements.ttsToggleBtn.classList.toggle('hover:bg-red-600', savedVoice === 'US');
            }

            const savedPracticeMode = localStorage.getItem(this.state.LOCAL_STORAGE_KEYS.PRACTICE_MODE);
            if (savedPracticeMode === 'true') {
                 if(window.quizMode) quizMode.state.isPracticeMode = true;
                this.elements.practiceModeCheckbox.checked = true;
            }

        } catch (e) {
            console.error("Error reading settings from localStorage", e);
        }

        try {
            await audioCache.init();
            await translationCache.init();
            await imageDBCache.init();
        } catch (e) {
            console.error("Cache initialization failed.", e);
        }
        this.bindGlobalEvents();
        studyTracker.init();

        await this.syncOfflineData();

        try {
            await api.loadWordList();
            await api.loadUserProgress();
            this.updateLastUpdatedText();
        } catch (e) {
            return;
        }

        this.loadInitialImages();
        if(window.quizMode) quizMode.init();
        if(window.learningMode) learningMode.init();
        if(window.dashboard) dashboard.init();

        if(window.quizMode) quizMode.preloadAllQuizTypesBasedOnSavedRange();

        const initialMode = window.location.hash.replace('#', '') || 'selection';
        history.replaceState({ mode: initialMode, options: {} }, '', window.location.href);
        this._renderMode(initialMode);
    },
    async syncOfflineData() {
        if (!app.state.userId) return;

        try {
            const timeKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME;
            const quizKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ;
            const progressKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;

            const timeToSync = parseInt(localStorage.getItem(timeKey) || '0');
            if (timeToSync > 0) {
                await api.updateStudyTime(timeToSync);
                localStorage.removeItem(timeKey);
            }

            const statsToSync = JSON.parse(localStorage.getItem(quizKey) || 'null');
            if (statsToSync) {
                await api.syncQuizHistory(statsToSync);
                localStorage.removeItem(quizKey);
            }

            const progressToSync = JSON.parse(localStorage.getItem(progressKey) || 'null');
             if (progressToSync && Object.keys(progressToSync).length > 0) {
                 await api.syncProgressUpdates(progressToSync);
                 localStorage.removeItem(progressKey);
             }

        } catch (error) {
            console.error("Offline data sync failed:", error);
        }
    },
    bindGlobalEvents() {
        const unlockAudioContext = async () => {
            if (!app.state.audioContext) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                app.state.audioContext = new AudioContext();
            }
            if (app.state.audioContext.state === 'suspended') {
                try {
                    await app.state.audioContext.resume();
                } catch (e) {
                    console.error("Audio unlock failed", e);
                }
            }
            ['click', 'touchstart', 'keydown'].forEach(event => 
                document.body.removeEventListener(event, unlockAudioContext, { capture: true })
            );
        };

        ['click', 'touchstart', 'keydown'].forEach(event => 
            document.body.addEventListener(event, unlockAudioContext, { capture: true, once: true })
        );

        this.elements.selectQuizBtn.addEventListener('click', () => this.navigateTo('quiz'));
        this.elements.selectLearningBtn.addEventListener('click', () => this.navigateTo('learning'));
        this.elements.selectDashboardBtn.addEventListener('click', () => this.navigateTo('dashboard'));
        this.elements.selectFavoritesBtn.addEventListener('click', () => this.navigateTo('favorites'));

        this.elements.selectMistakesBtn.addEventListener('click', async () => {
            const allWords = app.state.wordList;
            const mistakeWords = allWords
                .filter(wordObj => utils.getWordStatus(wordObj.word) === 'review')
                .map(wordObj => wordObj.word);

            if (mistakeWords.length === 0) {
                app.showToast('오답 노트에 단어가 없습니다.', true);
                return;
            }
            this.navigateTo('mistakeReview', { mistakeWords });
        });

        this.elements.homeBtn.addEventListener('click', () => this.navigateTo('selection'));
        this.elements.refreshBtn.addEventListener('click', () => this.forceReload());
        this.elements.ttsToggleBtn.addEventListener('click', this.toggleVoiceSet.bind(this));
        
        this.elements.practiceModeCheckbox.addEventListener('change', (e) => {
             if(window.quizMode) {
                quizMode.state.isPracticeMode = e.target.checked;
                try {
                    localStorage.setItem(this.state.LOCAL_STORAGE_KEYS.PRACTICE_MODE, quizMode.state.isPracticeMode);
                } catch (err) {
                    console.error("Error saving practice mode state:", err);
                }
                if (history.state?.mode === 'quiz-play') {
                     quizMode.reset(false);
                     quizMode.displayNextQuiz();
                }
             }
        });

        document.addEventListener('click', (e) => {
            if (this.elements.wordContextMenu && !this.elements.wordContextMenu.contains(e.target)) {
                if(window.ui) ui.hideWordContextMenu();
            }
        });

        window.addEventListener('popstate', (e) => {
            this.syncOfflineData();
            const mode = e.state?.mode || 'selection';
            const options = e.state?.options || {};
            this._renderMode(mode, options);
        });

        document.addEventListener('contextmenu', (e) => {
            const target = e.target;
            const isInteractiveTrigger = target.closest('.interactive-word, #word-display');
            const isCustomContextMenu = target.closest('#word-context-menu');
            if (!isInteractiveTrigger && !isCustomContextMenu) {
                e.preventDefault();
            }
        });

        window.addEventListener('beforeunload', (e) => {
             studyTracker.stopAndSave();
             this.syncOfflineDataSync();
        });
    },
    syncOfflineDataSync() {
         if (!app.state.userId) return;
         const timeKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME;
         const quizKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ;
         const progressKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;

         const timeToSync = localStorage.getItem(timeKey);
         const statsToSync = localStorage.getItem(quizKey);
         const progressToSync = localStorage.getItem(progressKey);

         if (timeToSync || statsToSync || progressToSync) {
         }
    },
    async loadInitialImages() {
        const imageSelectors = [
            '#select-learning-btn img', '#select-quiz-btn img',
            '#start-meaning-quiz-btn img', '#start-blank-quiz-btn img', '#start-definition-quiz-btn img'
        ];
        for (const selector of imageSelectors) {
            const img = document.querySelector(selector);
            if (img && img.src) {
                img.src = await imageDBCache.loadImage(img.src);
            }
        }
    },
    navigateTo(mode, options = {}) {
        const currentState = history.state || {};
        const currentMode = currentState.mode;
        const currentOptions = currentState.options || {};

        if (currentMode !== mode) {
            this.syncOfflineData();
        }

        if (currentMode === mode && JSON.stringify(currentOptions) === JSON.stringify(options) && !['learning', 'mistakeReview', 'favorites', 'quiz-play'].includes(mode)) return;


        const newPath = mode === 'selection'
            ? window.location.pathname + window.location.search
            : `#${mode}`;

        history.pushState({ mode, options }, '', newPath);
        this._renderMode(mode, options);
    },
    async _renderMode(mode, options = {}) {
        studyTracker.stopAndSave();
        this.elements.selectionScreen.classList.add('hidden');
        this.elements.quizModeContainer.classList.add('hidden');
        this.elements.learningModeContainer.classList.add('hidden');
        this.elements.dashboardContainer.classList.add('hidden');
        this.elements.homeBtn.classList.add('hidden');
        this.elements.logoutBtn.classList.add('hidden');
        this.elements.ttsToggleBtn.classList.add('hidden');
        this.elements.progressBarContainer.classList.add('hidden');
        this.elements.practiceModeControl.classList.add('hidden');
        
        if(window.learningMode) {
            learningMode.elements.fixedButtons.classList.add('hidden');
            learningMode.elements.appContainer.classList.add('hidden');
            learningMode.elements.startScreen.classList.add('hidden');
        }

        const showCommonButtons = () => {
            this.elements.homeBtn.classList.remove('hidden');
            this.elements.ttsToggleBtn.classList.remove('hidden');
        };

        if (mode === 'quiz-play' || mode === 'learning' || mode === 'mistakeReview' || mode === 'favorites') {
             studyTracker.start();
        }

        if (mode === 'quiz') {
            this.elements.homeBtn.classList.remove('hidden');
            this.elements.quizModeContainer.classList.remove('hidden');
            this.elements.practiceModeControl.classList.remove('hidden');
            if(window.quizMode) {
                quizMode.reset();
                await quizMode.updateRangeInputs();
            }
        } else if (mode === 'quiz-play') {
            showCommonButtons();
            this.elements.quizModeContainer.classList.remove('hidden');
            this.elements.practiceModeControl.classList.remove('hidden');
            if(window.quizMode) {
                quizMode.reset(false);
                if (!app.state.isWordListReady) {
                    await api.loadWordList();
                }
                quizMode.displayNextQuiz();
            }
        } else if (mode === 'learning') {
            showCommonButtons();
            this.elements.learningModeContainer.classList.remove('hidden');
            if (options.startIndex !== undefined && options.startIndex > -1) {
                if(window.learningMode) {
                    learningMode.state.isMistakeMode = false;
                    learningMode.state.isFavoriteMode = false;
                    learningMode.state.currentWordList = app.state.wordList;
                    learningMode.state.currentIndex = options.startIndex;
                    learningMode.launchApp();
                }
            } else {
                this.elements.learningModeContainer.querySelector('#learning-start-screen').classList.remove('hidden');
                if(window.learningMode) learningMode.resetStartScreen();
            }
        } else if (mode === 'mistakeReview') {
            showCommonButtons();
            this.elements.learningModeContainer.classList.remove('hidden');
            if(window.learningMode) learningMode.startMistakeReview(options.mistakeWords);
        } else if (mode === 'favorites') {
            showCommonButtons();
            this.elements.learningModeContainer.classList.remove('hidden');
            if(window.learningMode) learningMode.startFavoriteMode();
        } else if (mode === 'dashboard') {
            this.elements.homeBtn.classList.remove('hidden');
            this.elements.dashboardContainer.classList.remove('hidden');
            if(window.dashboard) dashboard.render();
        } else {
            this.elements.selectionScreen.classList.remove('hidden');
            this.elements.logoutBtn.classList.remove('hidden');
            if(window.quizMode) quizMode.reset();
            if(window.learningMode) learningMode.reset();
        }
    },
    async forceReload() {
        this.elements.globalLoader.classList.remove('hidden');

        const elementsToDisable = [
            this.elements.refreshBtn, this.elements.selectDashboardBtn, this.elements.selectMistakesBtn,
            this.elements.selectLearningBtn, this.elements.selectQuizBtn
        ];

        elementsToDisable.forEach(el => el.classList.add('pointer-events-none', 'opacity-50'));

        try {
            await api.loadWordList(true);
            await api.loadUserProgress();
            this.updateLastUpdatedText();
            this.showToast('데이터를 성공적으로 새로고침했습니다!');
        } catch(e) {
            this.showToast('데이터 새로고침에 실패했습니다: ' + e.message, true);
        } finally {
            elementsToDisable.forEach(el => el.classList.remove('pointer-events-none', 'opacity-50'));
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
        if (this.elements.lastUpdatedText && this.state.lastCacheTimestamp) {
            const d = new Date(this.state.lastCacheTimestamp);
            const dateString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
            this.state.currentVoiceSet = (this.state.currentVoiceSet === 'UK') ? 'US' : 'UK';
            this.elements.ttsToggleText.textContent = this.state.currentVoiceSet;
            btn.classList.toggle('bg-indigo-700', this.state.currentVoiceSet === 'UK');
            btn.classList.toggle('hover:bg-indigo-800', this.state.currentVoiceSet === 'UK');
            btn.classList.toggle('bg-red-500', this.state.currentVoiceSet === 'US');
            btn.classList.toggle('hover:bg-red-600', this.state.currentVoiceSet === 'US');

            try {
                localStorage.setItem(this.state.LOCAL_STORAGE_KEYS.TTS_VOICE, this.state.currentVoiceSet);
            } catch (e) {
                console.error("Error saving TTS settings to localStorage", e);
            }
        }, 250);
    },
    showFatalError(message) {
        const selectionDiv = this.elements.selectionScreen;
        selectionDiv.innerHTML = `<div class="p-8 text-center"><h1 class="text-3xl font-bold text-red-600 mb-4">앱 시작 실패</h1><p class="text-gray-700 mb-6">Firebase에서 데이터를 불러오는 중 문제가 발생했습니다. <br>네트워크 연결을 확인하고 잠시 후 페이지를 새로고침 해주세요.</p><div class="bg-red-50 text-red-700 p-4 rounded-lg text-left text-sm break-all"><p class="font-semibold">오류 정보:</p><p>${message}</p></div></div>`;
        this.elements.appWrapper.classList.remove('hidden');
        this.elements.selectionScreen.classList.remove('hidden');
        this.elements.quizModeContainer.classList.add('hidden');
        this.elements.learningModeContainer.classList.add('hidden');
    },
    showImeWarning() {
        this.elements.imeWarning.classList.remove('hidden');
        clearTimeout(this.imeWarningTimeout);
        this.imeWarningTimeout = setTimeout(() => {
            this.elements.imeWarning.classList.add('hidden');
        }, 2000);
    },
    showNoSampleMessage() {
        const msgEl = this.elements.noSampleMessage;
        msgEl.classList.remove('hidden', 'opacity-0');
        setTimeout(() => {
            msgEl.classList.add('opacity-0');
            setTimeout(() => msgEl.classList.add('hidden'), 500);
        }, 1500);
    },
    searchWordInLearningMode(word) {
        if (!word) return;
        this.navigateTo('learning');
        setTimeout(() => {
            if(window.learningMode) {
                learningMode.elements.startWordInput.value = word;
                learningMode.start();
                if(window.ui) ui.hideWordContextMenu();
            }
        }, 10);
    },
};

const studyTracker = {
    sessionSeconds: 0,
    lastActivityTimestamp: 0,
    timerInterval: null,
    saveInterval: null,
    INACTIVITY_LIMIT: 30000,

    init() {
    },
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
                    const currentLocalTime = parseInt(localStorage.getItem(app.state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME) || '0');
                    localStorage.setItem(app.state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME, currentLocalTime + this.sessionSeconds);
                    this.sessionSeconds = 0;
                } catch (e) {
                    console.error("Error saving study time to localStorage", e);
                }
            }
        }, 10000);

        ['click', 'keydown', 'touchstart'].forEach(event =>
            document.body.addEventListener(event, this.recordActivity, true));
    },

    stopAndSave() {
        if (!this.timerInterval) return;

        clearInterval(this.timerInterval);
        clearInterval(this.saveInterval);
        this.timerInterval = null;
        this.saveInterval = null;

        try {
            if (this.sessionSeconds > 0) {
                const currentLocalTime = parseInt(localStorage.getItem(app.state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME) || '0');
                localStorage.setItem(app.state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME, currentLocalTime + this.sessionSeconds);
            }
        } catch (e) {
            console.error("Error saving remaining study time to localStorage", e);
        }

        this.sessionSeconds = 0;

        ['click', 'keydown', 'touchstart'].forEach(event =>
            document.body.removeEventListener(event, this.recordActivity, true));
    },

    recordActivity() {
        studyTracker.lastActivityTimestamp = Date.now();
    }
};

const api = {
    async loadWordList(force = false) {
        if (force) {
            localStorage.removeItem('wordListCache');
            app.state.isWordListReady = false;
        }

        if (!app.state.isWordListReady) {
            try {
                const cachedData = localStorage.getItem('wordListCache');
                if (cachedData) {
                    const { timestamp, words } = JSON.parse(cachedData);
                    app.state.wordList = words.sort((a, b) => a.index - b.index);
                    app.state.isWordListReady = true;
                    app.state.lastCacheTimestamp = timestamp;
                }
            } catch (e) {
                localStorage.removeItem('wordListCache');
            }
        }

        if (app.state.isWordListReady && !force) return;

        try {
            const dbRef = ref(database, '/vocabulary');
            const snapshot = await get(dbRef);
            const data = snapshot.val();
            if (!data) throw new Error("Firebase에 단어 데이터가 없습니다.");

            const wordsArray = Object.values(data).sort((a, b) => a.index - b.index);

            app.state.wordList = wordsArray;
            app.state.isWordListReady = true;

            const newTimestamp = Date.now();
            const cachePayload = { timestamp: newTimestamp, words: wordsArray };
            localStorage.setItem('wordListCache', JSON.stringify(cachePayload));
            app.state.lastCacheTimestamp = newTimestamp;
        } catch (error) {
            if (!app.state.isWordListReady) app.showFatalError(error.message);
            throw error;
        }
    },
    async speak(text, contentType = 'word') {
        const voiceSets = {
            'UK': { 'word': { languageCode: 'en-GB', name: 'en-GB-Wavenet-D', ssmlGender: 'MALE' }, 'sample': { languageCode: 'en-GB', name: 'en-GB-Journey-D', ssmlGender: 'MALE' } },
            'US': { 'word': { languageCode: 'en-US', name: 'en-US-Wavenet-F', ssmlGender: 'FEMALE' }, 'sample': { languageCode: 'en-US', name: 'en-US-Journey-F', ssmlGender: 'FEMALE' } }
        };

        if (!text || !text.trim()) return;

        if (app.state.currentSource) {
            try {
                app.state.currentSource.stop();
            } catch (e) {
            }
            app.state.currentSource = null;
        }

        if (!app.state.audioContext) {
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                app.state.audioContext = new AudioContext();
            } catch (e) {
                console.error("Web Audio API is not supported", e);
                return;
            }
        }

        if (app.state.audioContext.state === 'suspended') {
            try {
                await app.state.audioContext.resume();
            } catch (e) {
                console.error("Failed to resume AudioContext", e);
            }
        }

        app.state.isSpeaking = true;
        const textWithoutEmoji = text.replace(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u, '');
        const processedText = textWithoutEmoji.replace(/\bsb\b/g, 'somebody').replace(/\bsth\b/g, 'something');
        const voiceConfig = voiceSets[app.state.currentVoiceSet][contentType];

        const cacheKey = `${processedText}|${voiceConfig.languageCode}|${voiceConfig.name}`;

        const playAudio = async (audioArrayBuffer) => {
            try {
                const audioBuffer = await app.state.audioContext.decodeAudioData(audioArrayBuffer);
                const source = app.state.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(app.state.audioContext.destination);

                app.state.currentSource = source;

                source.start(0);
                source.onended = () => {
                    app.state.isSpeaking = false;
                    if (app.state.currentSource === source) {
                        app.state.currentSource = null;
                    }
                };
            } catch (decodeError) {
                 console.error("Error decoding audio data:", decodeError);
                 app.state.isSpeaking = false;
            }
        };

        try {
            const cachedAudio = await audioCache.getAudio(cacheKey);
            if (cachedAudio) {
                await playAudio(cachedAudio.slice(0));
                return;
            }

            const TTS_URL = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${app.config.TTS_API_KEY}`;
            const response = await fetch(TTS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: { text: processedText }, voice: voiceConfig, audioConfig: { audioEncoding: 'MP3' } })
            });
            if (!response.ok) throw new Error(`TTS API Error: ${(await response.json()).error.message}`);

            const data = await response.json();
            const byteCharacters = atob(data.audioContent);
            const byteArray = new Uint8Array(byteCharacters.length).map((_, i) => byteCharacters.charCodeAt(i));
            const audioArrayBuffer = byteArray.buffer;

            audioCache.saveAudio(cacheKey, audioArrayBuffer.slice(0));
            await playAudio(audioArrayBuffer);

        } catch (error) {
            console.error('TTS 재생 또는 캐싱에 실패했습니다:', error);
            app.state.isSpeaking = false;
        }
    },
    async translate(text) {
        try {
            const cached = await translationCache.get(text);
            if (cached) {
                return cached;
            }
        } catch (e) {
            console.warn("Translation cache read error:", e);
        }

        if (!app.config.SCRIPT_URL || app.config.SCRIPT_URL === "여기에_배포된_APPS_SCRIPT_URL을_붙여넣으세요") {
            return "번역 스크립트 URL이 설정되지 않았습니다.";
        }

        const url = new URL(app.config.SCRIPT_URL);
        url.searchParams.append('action', 'translate');
        url.searchParams.append('text', text);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            if (data.success) {
                const translatedText = data.translatedText;
                translationCache.save(text, translatedText);
                return translatedText;
            } else {
                throw new Error(data.message || '번역 실패');
            }
        } catch (error) {
            console.error("Translation API error:", error);
            return "번역 오류";
        }
    },
     async updateWordStatus(word, quizType, result) {
         if (!app.state.userId || !word || !quizType) return;

         if (!app.state.currentProgress[word]) app.state.currentProgress[word] = {};
         app.state.currentProgress[word][quizType] = result;

         if(window.utils) utils.addProgressUpdateToLocalSync(word, quizType, result);
         api.saveQuizHistoryToLocal(quizType, result === 'correct');
     },
    async loadUserProgress() {
        if (!app.state.userId) return;
        const progressRef = doc(db, 'users', app.state.userId, 'progress', 'main');
        try {
            const docSnap = await getDoc(progressRef);
            app.state.currentProgress = docSnap.exists() ? docSnap.data() : {};
        } catch (error) {
            console.error("Error loading user progress:", error);
            app.state.currentProgress = {};
        }
    },
    async fetchDefinition(word) {
        const apiKey = app.config.DEFINITION_API_KEY;
        const url = `https://dictionaryapi.com/api/v3/references/learners/json/${encodeURIComponent(word)}?key=${apiKey}`;
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                const firstResult = data[0];
                if (typeof firstResult === 'object' && firstResult !== null && firstResult.shortdef && Array.isArray(firstResult.shortdef) && firstResult.shortdef.length > 0) {
                    return firstResult.shortdef[0];
                }
            }
            return null;
        } catch (e) {
            console.error("Error fetching definition:", e);
            return null;
        }
    },
    async loadFavorites() {
        if (!app.state.userId) return [];
        return window.utils ? utils.getFavoriteWords() : [];
    },
    async toggleFavorite(word) {
        if (!app.state.userId || !word) return false;

        const isCurrentlyFavorite = window.utils ? utils.isFavorite(word) : false;
        const newFavoriteStatus = !isCurrentlyFavorite;

        if (!app.state.currentProgress[word]) app.state.currentProgress[word] = {};
        app.state.currentProgress[word].favorite = newFavoriteStatus;
        app.state.currentProgress[word].favoritedAt = newFavoriteStatus ? Date.now() : 0;

        if(window.utils) {
            utils.addProgressUpdateToLocalSync(word, 'favorite', newFavoriteStatus);
            utils.addProgressUpdateToLocalSync(word, 'favoritedAt', app.state.currentProgress[word].favoritedAt);
        }

        return newFavoriteStatus;
    },
    async updateStudyTime(seconds) {
        if (!app.state.userId || seconds < 1) return;
        const today = new Date().toISOString().slice(0, 10);
        const historyRef = doc(db, 'users', app.state.userId, 'history', 'study');

        try {
            const docSnap = await getDoc(historyRef);
            const currentSeconds = (docSnap.exists() && docSnap.data()[today]) ? docSnap.data()[today] : 0;
            await setDoc(historyRef, { [today]: currentSeconds + seconds }, { merge: true });
        } catch (error) {
            console.error("Failed to update study time:", error);
            throw error;
        }
    },
    async getStudyHistory(days) {
        if (!app.state.userId) return {};
        const historyRef = doc(db, 'users', app.state.userId, 'history', 'study');
        try {
            const docSnap = await getDoc(historyRef);
            return docSnap.exists() ? docSnap.data() : {};
        } catch(e) {
            console.error("Error fetching study history:", e);
            return {};
        }
    },
    async getQuizHistory() {
        if (!app.state.userId) return {};
        const historyRef = doc(db, 'users', app.state.userId, 'history', 'quiz');
        try {
            const docSnap = await getDoc(historyRef);
            return docSnap.exists() ? docSnap.data() : {};
        } catch(e) {
            console.error("Error fetching quiz history:", e);
            return {};
        }
    },
    saveQuizHistoryToLocal(quizType, isCorrect) {
        try {
            const stats = JSON.parse(localStorage.getItem(app.state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ) || '{}');
            if (!stats[quizType]) {
                stats[quizType] = { total: 0, correct: 0 };
            }
            stats[quizType].total += 1;
            if (isCorrect) {
                stats[quizType].correct += 1;
            }
            localStorage.setItem(app.state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ, JSON.stringify(stats));
        } catch (e) {
            console.error("Error saving quiz stats to localStorage", e);
        }
    },
    async syncQuizHistory(statsToSync) {
        if (!app.state.userId || !statsToSync) return;
        const today = new Date().toISOString().slice(0, 10);
        const historyRef = doc(db, 'users', app.state.userId, 'history', 'quiz');

        try {
            const docSnap = await getDoc(historyRef);
            const data = docSnap.exists() ? docSnap.data() : {};
            const todayData = data[today] || {};

            for (const type in statsToSync) {
                if (statsToSync.hasOwnProperty(type)) {
                    const typeStats = todayData[type] || { correct: 0, total: 0 };
                    typeStats.total += statsToSync[type].total;
                    typeStats.correct += statsToSync[type].correct;
                    todayData[type] = typeStats;
                }
            }

            await setDoc(historyRef, { [today]: todayData }, { merge: true });
        } catch(e) {
            console.error("Failed to sync quiz history:", e);
            throw e;
        }
    },
    async syncProgressUpdates(progressToSync) {
         if (!app.state.userId || !progressToSync || Object.keys(progressToSync).length === 0) return;
         const progressRef = doc(db, 'users', app.state.userId, 'progress', 'main');

         try {
             await setDoc(progressRef, progressToSync, { merge: true });
         } catch (error) {
             console.error("Firebase progress sync failed:", error);
             throw error;
         }
     }
};

const imageDBCache = {
    db: null, dbName: 'imageCacheDB', storeName: 'imageStore',
    init() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { console.warn('IndexedDB for images not supported.'); return resolve(); }
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = e => e.target.result.createObjectStore(this.storeName);
            request.onsuccess = e => { this.db = e.target.result; resolve(); };
            request.onerror = e => reject(e.target.error);
        });
    },
    async loadImage(url) {
        if (!this.db || !url) return url;
        const cachedBlob = await this.getImage(url);
        if (cachedBlob) return URL.createObjectURL(cachedBlob);

        try {
            const response = await fetch(url);
            if (!response.ok) return url;
            const blob = await response.blob();
            this.saveImage(url, blob);
            return URL.createObjectURL(blob);
        } catch (e) {
            return url;
        }
    },
    getImage: key => new Promise((resolve) => {
        if (!imageDBCache.db) return resolve(null);
        const request = imageDBCache.db.transaction([imageDBCache.storeName]).objectStore(imageDBCache.storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    }),
    saveImage: (key, blob) => {
        if (!imageDBCache.db) return;
        try { imageDBCache.db.transaction([imageDBCache.storeName], 'readwrite').objectStore(imageDBCache.storeName).put(blob, key); }
        catch (e) { console.error("Failed to save image to IndexedDB", e); }
    }
};

const audioCache = {
    db: null, dbName: 'ttsAudioCacheDB', storeName: 'audioStore',
    init() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { console.warn('IndexedDB not supported, TTS caching disabled.'); return resolve(); }
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = event => { const db = event.target.result; if (!db.objectStoreNames.contains(this.storeName)) { db.createObjectStore(this.storeName); } };
            request.onsuccess = event => { this.db = event.target.result; resolve(); };
            request.onerror = event => { console.error("IndexedDB error:", event.target.error); reject(event.target.error); };
        });
    },
    getAudio(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve(null);
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => { console.error("IndexedDB get error:", event.target.error); reject(event.target.error); };
        });
    },
    saveAudio(key, audioData) {
        if (!this.db) return;
        try { const transaction = this.db.transaction([this.storeName], 'readwrite'); transaction.objectStore(this.storeName).put(audioData, key); }
        catch (e) { console.error("IndexedDB save error:", e); }
    }
};

const translationCache = {
    db: null, dbName: 'translationCacheDB', storeName: 'translations',
    init() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { console.warn('IndexedDB not supported, translation caching disabled.'); return resolve(); }
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = event => { const db = event.target.result; if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName); };
            request.onsuccess = event => { this.db = event.target.result; resolve(); };
            request.onerror = event => { console.error("IndexedDB error for translation cache:", event.target.error); reject(event.target.error); };
        });
    },
    get(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve(null);
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => { console.error("IndexedDB get error:", event.target.error); reject(event.target.error); };
        });
    },
    save(key, data) {
        if (!this.db) return;
        try { const transaction = this.db.transaction([this.storeName], 'readwrite'); transaction.objectStore(this.storeName).put(data, key); }
        catch (e) { console.error("IndexedDB save error:", e); }
    }
};
