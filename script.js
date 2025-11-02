let firebaseApp, auth, db, rt_db;
let initializeApp;
let getAuth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup;
let getDatabase, ref, get, set;
let getFirestore, doc, getDoc, setDoc, updateDoc, writeBatch;
document.addEventListener('firebaseSDKLoaded', () => {
    ({
        initializeApp,
        getAuth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup,
        getDatabase, ref, get, set,
        getFirestore, doc, getDoc, setDoc, updateDoc, writeBatch
    } = window.firebaseSDK);
    window.firebaseSDK.writeBatch = writeBatch;
    app.init();
});
const activityTracker = {
    sessionSeconds: 0,
    lastActivityTimestamp: 0,
    timerInterval: null,
    saveInterval: null,
    INACTIVITY_LIMIT: 30000,
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
            if (this.sessionSeconds > 0 && app.state.selectedSheet) {
                try {
                    const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME(app.state.selectedSheet);
                    const currentLocalTime = parseInt(localStorage.getItem(key) || '0');
                    localStorage.setItem(key, currentLocalTime + this.sessionSeconds);
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
        if (this.sessionSeconds > 0 && app.state.selectedSheet) {
             try {
                 const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME(app.state.selectedSheet);
                 const currentLocalTime = parseInt(localStorage.getItem(key) || '0');
                 localStorage.setItem(key, currentLocalTime + this.sessionSeconds);
             } catch (e) {
                 console.error("Error saving remaining study time to localStorage", e);
             }
        }
        this.sessionSeconds = 0;
        ['click', 'keydown', 'touchstart'].forEach(event =>
            document.body.removeEventListener(event, this.recordActivity, true));
    },
    recordActivity() {
        activityTracker.lastActivityTimestamp = Date.now();
    }
};
const app = {
    config: {
        firebaseConfig: {
            apiKey: "AIzaSyBE_Gxd1haPazVK61F9sjCwK0X4Gw5rERM",
            authDomain: "wordapp-91c0a.firebaseapp.com",
            projectId: "wordapp-91c0a",
            storageBucket: "wordapp-91c0a.firebasestorage.app",
            messagingSenderId: "213863780677",
            appId: "1:213863780677:web:78d6b8755866a0c5ddee2c",
            databaseURL: "https://wordapp-91c0a-default-rtdb.asia-southeast1.firebasedatabase.app/"
        },
        SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzmcgauS6eUd2QAncKzX_kQ1K1b7x7xn2k6s1JWwf-FxmrbIt-_9-eAvNrFkr5eDdwr0w/exec",
        MERRIAM_WEBSTER_API_KEY: "02d1892d-8fb1-4e2d-bc43-4ddd4a47eab3",
        sheetLinks: {
            '1y': 'https://docs.google.com/spreadsheets/d/1r7fWUV1ea9CU-s2iSOwLKexEe2_7L8oUKhK0n1DpDUM/edit?usp=sharing',
            '2y': 'https://docs.google.com/spreadsheets/d/1Xydj0im3Cqq9JhjN8IezZ-7DBp1-DV703cCIb3ORdc8/edit?usp=sharing',
            '3y': 'https://docs.google.com/spreadsheets/d/1Z_n9IshFSC5cBBW6IkZNfQsLb2BBrp9QeOlsGsCkn2Y/edit?usp=sharing'
        },
        backgroundImages: [
            'https://res.cloudinary.com/dx07dymqs/image/upload/v1761528368/bg1_mpvyd4.webp',
            'https://res.cloudinary.com/dx07dymqs/image/upload/v1761528368/bg2_e90yys.webp'
        ],
        adminEmail: 'puroome@gmail.com'
    },
    state: {
        user: null,
        currentProgress: {},
        selectedSheet: '',
        isAppReady: false,
        translateDebounceTimeout: null,
        longPressTimer: null,
        lastCacheTimestamp: { '1y': null, '2y': null, '3y': null },
        audioContext: null,
        LOCAL_STORAGE_KEYS: {
            LAST_GRADE: 'student_lastGrade',
            PRACTICE_MODE: 'student_practiceMode',
            LAST_INDEX: (grade) => `student_lastIndex_${grade}`,
            UNSYNCED_TIME: (grade) => `student_unsyncedTime_${grade}`,
            UNSYNCED_QUIZ: (grade) => `student_unsyncedQuizStats_${grade}`,
            UNSYNCED_PROGRESS_UPDATES: (grade) => `student_unsyncedProgress_${grade}`,
            CACHE_TIMESTAMP: (grade) => `wordListCacheTimestamp_${grade}`,
            CACHE_VERSION: (grade) => `wordListVersion_${grade}`,
            QUIZ_RANGE_START: (grade) => `student_quizRangeStart_${grade}`,
            QUIZ_RANGE_END: (grade) => `student_quizRangeEnd_${grade}`
        }
    },
    elements: {
        loginScreen: document.getElementById('login-screen'),
        loginBtn: document.getElementById('login-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        mainContainer: document.getElementById('main-container'),
        gradeSelectionScreen: document.getElementById('grade-selection-screen'),
        selectionScreen: document.getElementById('selection-screen'),
        selectionTitle: document.getElementById('selection-title'),
        sheetLink: document.getElementById('sheet-link'),
        authorCredit: document.getElementById('author-credit'),
        quizModeContainer: document.getElementById('quiz-mode-container'),
        learningModeContainer: document.getElementById('learning-mode-container'),
        dashboardContainer: document.getElementById('dashboard-container'),
        homeBtn: document.getElementById('home-btn'),
        backToGradeSelectionBtn: document.getElementById('back-to-grade-selection-btn'),
        refreshBtn: document.getElementById('refresh-btn'),
        translationTooltip: document.getElementById('translation-tooltip'),
        imeWarning: document.getElementById('ime-warning'),
        noSampleMessage: document.getElementById('no-sample-message'),
        refreshSuccessMessage: document.getElementById('refresh-success-message'),
        confirmationModal: document.getElementById('confirmation-modal'),
        confirmYesBtn: document.getElementById('confirm-yes-btn'),
        confirmNoBtn: document.getElementById('confirm-no-btn'),
        practiceModeControl: document.getElementById('practice-mode-control'),
        practiceModeCheckbox: document.getElementById('practice-mode-checkbox'),
        wordContextMenu: document.getElementById('word-context-menu'),
        searchDaumContextBtn: document.getElementById('search-daum-context-btn'),
        searchNaverContextBtn: document.getElementById('search-naver-context-btn'),
        searchLongmanContextBtn: document.getElementById('search-longman-context-btn'),
        progressBarContainer: document.getElementById('progress-bar-container'),
        selectFavoritesBtn: document.getElementById('select-favorites-btn'),
        lastUpdatedText: document.getElementById('last-updated-text'),
        permissionRequestModal: document.getElementById('permission-request-modal'),
        prNameInput: document.getElementById('pr-name-input'),
        prGradeInput: document.getElementById('pr-grade-input'),
        prSubmitBtn: document.getElementById('pr-submit-btn'),
        permissionStatusModal: document.getElementById('permission-status-modal'),
        psTitle: document.getElementById('ps-title'),
        psMessage: document.getElementById('ps-message'),
        psCloseBtn: document.getElementById('ps-close-btn'),
        prLogoutBtn: document.getElementById('pr-logout-btn'),
      },
    async init() {
        firebaseApp = initializeApp(this.config.firebaseConfig);
        auth = getAuth(firebaseApp);
        db = getFirestore(firebaseApp);
        rt_db = getDatabase(firebaseApp);
        await Promise.all([
            translationDBCache.init(),
            audioDBCache.init(),
            this.fetchAndSetBackgroundImages()
        ]).catch(e => console.error("Cache or image init failed", e));
        this.bindGlobalEvents();
        quizMode.init();
        learningMode.init();
        dashboard.init();
        try {
            const savedPracticeMode = localStorage.getItem(this.state.LOCAL_STORAGE_KEYS.PRACTICE_MODE);
            if (savedPracticeMode === 'true') {
                quizMode.state.isPracticeMode = true;
                this.elements.practiceModeCheckbox.checked = true;
            }
        } catch (e) {
            console.error("Error reading practice mode from localStorage", e);
        }
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                await this.handlePermissionFlow(user);
            } else {
                this.state.user = null;
                this.state.currentProgress = {};
                this.elements.loginScreen.classList.remove('hidden');
                this.elements.mainContainer.classList.add('hidden');
                document.body.classList.add('items-center');
                this._renderView(null);
            }
        });
    },
async handlePermissionFlow(user) {
        this.elements.loginScreen.classList.add('hidden');
        this.elements.mainContainer.classList.add('hidden');
        document.body.classList.add('items-center');
        const userRef = doc(db, 'users', user.uid);
        
        // 1. Firestore에 기본 사용자 정보만 저장 (통계 문서 연결용)
        // RTDB로 전환했으므로, Firestore에는 통계 연결에 필수적인 email/displayName만 남깁니다.
        await setDoc(userRef, { displayName: user.displayName, email: user.email }, { merge: true });

        try {
            // 2. RTDB에서 권한 상태 확인 (RTDB로 전환된 로직)
            const permissionStatus = await api.checkPermission(user.email); 
            
            // Firestore에서 permissionRequested 플래그를 미리 가져옴
            const userDoc = await getDoc(userRef);
            const isRequested = userDoc.exists() && userDoc.data().permissionRequested === true;

            if (permissionStatus === 'approved') {
                this.state.user = user;
                
                this.elements.mainContainer.classList.remove('hidden');
                document.body.classList.remove('items-center');
                await utils.loadUserProgress();
                await this.syncOfflineData();
                if (!this.state.isAppReady) {
                    this.state.isAppReady = true;
                    await quizMode.preloadInitialQuizzesBasedOnSavedRange();
                }
                const hash = window.location.hash.substring(1);
                const [view, gradeFromHash] = hash.split('-');
                let initialState = { view: 'grade' };
                try {
                    const lastGrade = localStorage.getItem(this.state.LOCAL_STORAGE_KEYS.LAST_GRADE);
                    if (gradeFromHash && ['1y', '2y', '3y'].includes(gradeFromHash)) {
                        if (['mode', 'quiz', 'learning', 'dashboard', 'mistakeReview', 'favoriteReview'].includes(view)) {
                            initialState = { view: view, grade: gradeFromHash };
                        }
                    } else if (['1y', '2y', '3y'].includes(view)) {
                         initialState = { view: 'mode', grade: view };
                    } else if (lastGrade && ['1y', '2y', '3y'].includes(lastGrade)) {
                        initialState = { view: 'mode', grade: lastGrade };
                    }
                } catch(e) {
                    console.error("Error reading last grade from localStorage", e);
                    initialState = { view: 'grade' };
                }
                history.replaceState(initialState, '');
                this._renderView(initialState.view, initialState.grade);
            } else if (permissionStatus === 'denied') {
                this.showStatusModal(
                    '접근 제한', 
                    '관리자에 의해 앱 접근이 제한되었습니다.', 
                    'text-red-500',
                    () => signOut(auth)
                );
            } else if (permissionStatus === 'pending') { 
                this.showStatusModal(
                    '확인 중', 
                    '관리자가 확인 중이니 기다려주세요.', 
                    'text-blue-500',
                    () => signOut(auth)
                );
            } else { // 'not_found'
                this.state.user = user;
                
                if (isRequested) {
                    // 2차 접속: 이전에 요청했으나 RTDB에 아직 미동기화된 경우 -> Pending 처리
                    this.showStatusModal(
                        '확인 중', 
                        '관리자가 확인 중이니 기다려주세요.', 
                        'text-blue-500',
                        () => signOut(auth)
                    );
                } else {
                    // 1차 접속: Name/Grade 요청이 필요한 경우
                    this.showRequestModal();
                }
            }
        } catch (error) {
            console.error("Permission Check Error:", error);
            this.showToast("권한 확인 중 오류가 발생했습니다. 다시 시도해 주세요.", true);
            signOut(auth);
        }
    },
    async submitPermissionRequest() {
        if (!this.state.user) return;
        const name = this.elements.prNameInput.value.trim();
        const gradeStr = this.elements.prGradeInput.value.trim();
        const gradeNum = parseInt(gradeStr);
        if (!name) {
            this.elements.prNameInput.focus();
            return;
        }
        if (isNaN(gradeNum) || ![1, 2, 3].includes(gradeNum)) {
            this.elements.prGradeInput.focus();
            return;
        }

        const gradeWithSuffix = gradeNum + 'y'; // 숫자에 'y'를 붙여 '1y', '2y' 문자열로 만듭니다.
        
        // Firestore users 문서에 name과 grade 필드 업데이트 로직은 RTDB 전환으로 인해 제거됨.

        this.elements.prSubmitBtn.disabled = true;
        this.elements.prSubmitBtn.textContent = '요청 중...';
        
        try {
            const result = await api.requestPermission(this.state.user.email, name, gradeWithSuffix);
            
            if (result.success) {
                // 권한 요청 성공 시, Firestore에 플래그를 설정하여 재접속 시 pending 처리의 근거로 사용
                await updateDoc(doc(db, 'users', this.state.user.uid), { permissionRequested: true });
            }

            this.elements.permissionRequestModal.classList.add('hidden');
            if (result.success) {
                this.showStatusModal(
                    '요청 완료',
                    '관리자에게 요청하였으니 기다려주세요.',
                    'text-blue-500',
                    () => signOut(auth)
                );
            } else {
                this.showToast(result.message || "권한 요청에 실패했습니다. 다시 시도해 주세요.", true);
                this.elements.prSubmitBtn.disabled = false;
                this.elements.prSubmitBtn.textContent = '권한 요청';
            }
        } catch (error) {
            console.error("Permission Request API Error:", error);
            this.elements.permissionRequestModal.classList.add('hidden');
            this.showToast("서버 오류로 인해 요청에 실패했습니다. 다시 시도해 주세요.", true);
            signOut(auth);
        }
    },
    showStatusModal(title, message, titleClass = 'text-green-500', onClose = null) {
        this.elements.psTitle.textContent = title;
        this.elements.psTitle.className = `text-2xl font-bold mb-4 ${titleClass}`;
        this.elements.psMessage.textContent = message;
        this.elements.permissionStatusModal.classList.remove('hidden');
        const closeHandler = () => {
             this.elements.permissionStatusModal.classList.add('hidden');
             this.elements.psCloseBtn.removeEventListener('click', closeHandler);
             if (onClose) onClose();
        };
        this.elements.psCloseBtn.addEventListener('click', closeHandler);
    },
    showRequestModal() {
        this.elements.prNameInput.value = ''; 
        this.elements.prGradeInput.value = '';
        this.elements.prSubmitBtn.disabled = false;
        this.elements.prSubmitBtn.textContent = '권한 요청';
        this.elements.permissionRequestModal.classList.remove('hidden');
    },
    async syncOfflineData() {
        if (!app.state.user) return;
        const userRef = doc(db, 'users', app.state.user.uid);
        for (const grade of ['1y', '2y', '3y']) {
            try {
                const timeKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME(grade);
                const timeToSync = parseInt(localStorage.getItem(timeKey) || '0');
                if (timeToSync > 0) {
                    await utils.saveStudyHistory(timeToSync, grade);
                    localStorage.removeItem(timeKey);
                }
                const quizKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ(grade);
                const statsToSync = JSON.parse(localStorage.getItem(quizKey) || 'null');
                if (statsToSync) {
                    await utils.syncQuizHistory(statsToSync, grade);
                    localStorage.removeItem(quizKey);
                }
                 const progressKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES(grade);
                 const progressToSync = JSON.parse(localStorage.getItem(progressKey) || 'null');
                 if (progressToSync && Object.keys(progressToSync).length > 0) {
                     await utils.syncProgressUpdates(progressToSync, grade);
                     localStorage.removeItem(progressKey);
                 }
            } catch (error) {
                console.error(`Offline data sync failed for grade ${grade}:`, error);
            }
        }
        await utils.loadUserProgress();
    },
    bindGlobalEvents() {
        this.elements.loginBtn.addEventListener('click', () => {
            const provider = new GoogleAuthProvider();
            signInWithPopup(auth, provider).catch(error => {
                console.error("Google Sign-In Error:", error);
                this.showToast("로그인에 실패했습니다. 다시 시도해 주세요.", true);
            });
        });
        this.elements.logoutBtn.addEventListener('click', () => signOut(auth));
        document.querySelectorAll('.grade-select-card').forEach(card => {
            card.addEventListener('click', () => {
                const grade = card.dataset.sheet;
                try {
                    localStorage.setItem(this.state.LOCAL_STORAGE_KEYS.LAST_GRADE, grade);
                } catch (e) {
                    console.error("Error saving last grade to localStorage", e);
                }
                this.navigateTo('mode', grade);
            });
        });
        document.getElementById('select-quiz-btn').addEventListener('click', () => this.navigateTo('quiz', this.state.selectedSheet));
        document.getElementById('select-learning-btn').addEventListener('click', () => this.navigateTo('learning', this.state.selectedSheet));
        document.getElementById('select-dashboard-btn').addEventListener('click', () => this.navigateTo('dashboard', this.state.selectedSheet));
        document.getElementById('select-mistakes-btn').addEventListener('click', () => this.navigateTo('mistakeReview', this.state.selectedSheet));
        this.elements.selectFavoritesBtn.addEventListener('click', () => this.navigateTo('favoriteReview', this.state.selectedSheet));
        this.elements.homeBtn.addEventListener('click', () => this.navigateTo('mode', this.state.selectedSheet));
        this.elements.backToGradeSelectionBtn.addEventListener('click', () => this.navigateTo('grade'));
        this.elements.refreshBtn.addEventListener('click', () => {
            if (!this.state.selectedSheet) return;
            this.elements.confirmationModal.classList.remove('hidden');
        });
        this.elements.confirmNoBtn.addEventListener('click', () => this.elements.confirmationModal.classList.add('hidden'));
        this.elements.confirmYesBtn.addEventListener('click', () => {
            this.elements.confirmationModal.classList.add('hidden');
            this.forceRefreshData();
        });
        this.elements.practiceModeCheckbox.addEventListener('change', (e) => {
            quizMode.state.isPracticeMode = e.target.checked;
            try {
                localStorage.setItem(this.state.LOCAL_STORAGE_KEYS.PRACTICE_MODE, quizMode.state.isPracticeMode);
            } catch (err) {
                console.error("Error saving practice mode state:", err);
            }
            if (history.state?.view === 'quiz-play') {
                 quizMode.reset(false);
                 quizMode.displayNextQuiz();
            }
        });
        document.addEventListener('click', (e) => {
            if (this.elements.wordContextMenu && !this.elements.wordContextMenu.contains(e.target)) {
                ui.hideWordContextMenu();
            }
        });
        document.addEventListener('contextmenu', (e) => {
            const isWhitelisted = e.target.closest('.interactive-word, #word-display');
            if (!isWhitelisted) e.preventDefault();
        });
        window.addEventListener('popstate', (e) => {
            this.syncOfflineData();
            const state = e.state || { view: 'grade' };
            this._renderView(state.view, state.grade);
        });
        window.addEventListener('beforeunload', (e) => {
            activityTracker.stopAndSave();
            this.syncOfflineDataSync();
        });
        const initAudioForBeep = () => {
            if (!this.state.audioContext) {
                 try {
                     this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                 } catch (e) {
                     console.error("Web Audio API is not supported in this browser", e);
                 }
            }
            document.body.removeEventListener('click', initAudioForBeep, { capture: true });
            document.body.removeEventListener('touchstart', initAudioForBeep, { capture: true, passive: true });
        };
        document.body.addEventListener('click', initAudioForBeep, { capture: true, once: true });
        document.body.addEventListener('touchstart', initAudioForBeep, { capture: true, passive: true, once: true });
        this.elements.prSubmitBtn.addEventListener('click', () => this.submitPermissionRequest());
        this.elements.prGradeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.submitPermissionRequest();
        });
        this.elements.prLogoutBtn.addEventListener('click', () => { 
            this.elements.permissionRequestModal.classList.add('hidden');
            signOut(auth);
        });
    },
     syncOfflineDataSync() {
         if (!app.state.user) return;
         const grade = app.state.selectedSheet;
         if (!grade) return;
         const timeKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_TIME(grade);
         const quizKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ(grade);
         const progressKey = this.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES(grade);
         const timeToSync = localStorage.getItem(timeKey);
         const statsToSync = localStorage.getItem(quizKey);
         const progressToSync = localStorage.getItem(progressKey);
         if (timeToSync || statsToSync || progressToSync) {
         }
     },
    navigateTo(view, grade, options = {}) {
        const currentState = history.state || {};
        if (currentState.view !== view || currentState.grade !== grade) {
            this.syncOfflineData();
        }
        if (currentState.view === view && currentState.grade === grade && view !== 'mistakeReview' && view !== 'favoriteReview') return;
        let hash = '';
        if (view !== 'grade' && view !== null) {
            hash = grade ? `#${grade}` : '';
            if (view !== 'mode') {
                hash = `#${view}-${grade}`;
            }
        }
        history.pushState({ view, grade, options }, '', window.location.pathname + window.location.search + hash);
        this._renderView(view, grade, options);
    },
    async _renderView(view, grade, options = {}) {
        activityTracker.stopAndSave();
        learningMode.unbindModeEvents();
        quizMode.unbindQuizPlayEvents();

        this.elements.gradeSelectionScreen.classList.add('hidden');
        this.elements.selectionScreen.classList.add('hidden');
        this.elements.quizModeContainer.classList.add('hidden');
        this.elements.learningModeContainer.classList.add('hidden');
        this.elements.dashboardContainer.classList.add('hidden');
        learningMode.elements.fixedButtons.classList.add('hidden');
        this.elements.progressBarContainer.classList.add('hidden');
        this.elements.homeBtn.classList.add('hidden');
        this.elements.backToGradeSelectionBtn.classList.add('hidden');
        this.elements.refreshBtn.classList.add('hidden');
        this.elements.practiceModeControl.classList.add('hidden');
        this.elements.sheetLink.classList.add('hidden');
        this.elements.logoutBtn.classList.add('hidden');
        this.elements.lastUpdatedText.classList.add('hidden');
        this.elements.permissionRequestModal.classList.add('hidden');
        this.elements.permissionStatusModal.classList.add('hidden');
        if (!this.state.user) return;
        this.elements.logoutBtn.classList.remove('hidden');
        if (grade) {
            const needsProgressLoad = this.state.selectedSheet !== grade;
            this.state.selectedSheet = grade;
            if (needsProgressLoad) await utils.loadUserProgress();
            this.elements.sheetLink.href = this.config.sheetLinks[grade];
            this.elements.sheetLink.classList.remove('hidden');
            const gradeText = grade.replace('y', '학년');
            this.elements.selectionTitle.textContent = `${gradeText} 어휘`;
            this.updateLastUpdatedText();
        } else {
            this.state.selectedSheet = '';
            this.state.currentProgress = {};
        }
        const startModes = ['quiz-play', 'learning', 'mistakeReview', 'favoriteReview'];
        if (startModes.includes(view)) {
             activityTracker.start();
        }
        switch (view) {
            case 'quiz':
                this.elements.quizModeContainer.classList.remove('hidden');
                this.elements.homeBtn.classList.remove('hidden');
                this.elements.backToGradeSelectionBtn.classList.remove('hidden');
                this.elements.practiceModeControl.classList.remove('hidden');
                quizMode.reset();
                await quizMode.updateRangeInputs();
                break;
            case 'quiz-play':
                this.elements.quizModeContainer.classList.remove('hidden');
                this.elements.homeBtn.classList.remove('hidden');
                this.elements.backToGradeSelectionBtn.classList.remove('hidden');
                this.elements.practiceModeControl.classList.remove('hidden');
                quizMode.bindQuizPlayEvents();
                quizMode.reset(false);
                if (!learningMode.state.isWordListReady[app.state.selectedSheet]) {
                    await learningMode.loadWordList();
                }
                quizMode.displayNextQuiz();
                break;
            case 'learning':
                this.elements.learningModeContainer.classList.remove('hidden');
                this.elements.homeBtn.classList.remove('hidden');
                this.elements.backToGradeSelectionBtn.classList.remove('hidden');
                learningMode.resetStartScreen();
                break;
            case 'dashboard':
                this.elements.dashboardContainer.classList.remove('hidden');
                this.elements.homeBtn.classList.remove('hidden');
                this.elements.backToGradeSelectionBtn.classList.remove('hidden');
                await dashboard.show();
                break;
            case 'mistakeReview':
            case 'favoriteReview':
                this.elements.learningModeContainer.classList.remove('hidden');
                this.elements.homeBtn.classList.remove('hidden');
                this.elements.backToGradeSelectionBtn.classList.remove('hidden');
                if (view === 'mistakeReview') {
                    learningMode.startMistakeReview(options.mistakeWords);
                } else {
                    learningMode.startFavoriteReview();
                }
                break;
            case 'mode':
                this.elements.selectionScreen.classList.remove('hidden');
                this.elements.backToGradeSelectionBtn.classList.remove('hidden');
                if (this.state.user && this.state.user.email === this.config.adminEmail) {
                    this.elements.refreshBtn.classList.remove('hidden');
                }
                this.elements.lastUpdatedText.classList.remove('hidden');
                this.loadModeImages();
                quizMode.reset();
                learningMode.reset();
                break;
            case 'grade':
            default:
                this.elements.gradeSelectionScreen.classList.remove('hidden');
                this.fetchAndSetBackgroundImages();
                this.loadGradeImages();
                quizMode.reset();
                learningMode.reset();
                break;
        }
    },
    async forceRefreshData() {
        const sheet = this.state.selectedSheet;
        if (!sheet) return;
        const elementsToDisable = [
            this.elements.homeBtn, this.elements.refreshBtn, this.elements.backToGradeSelectionBtn,
            document.getElementById('select-learning-btn'), document.getElementById('select-quiz-btn'),
            document.getElementById('select-dashboard-btn'), document.getElementById('select-mistakes-btn'),
            this.elements.selectFavoritesBtn
        ].filter(el => el);
        elementsToDisable.forEach(el => el.classList.add('pointer-events-none', 'opacity-50'));
        const refreshIconHTML = this.elements.refreshBtn.innerHTML;
        this.elements.refreshBtn.innerHTML = `<div class="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>`;
        try {
            const versionRef = ref(rt_db, `app_config/vocab_version_${sheet}`);
            const snapshot = await get(versionRef);
            const currentVersion = snapshot.val() || 0;
            const newVersion = currentVersion + 1;
            const newTimestamp = Date.now();
            await set(versionRef, newVersion);
            const timestampRef = ref(rt_db, `app_config/vocab_timestamp_${sheet}`);
            await set(timestampRef, newTimestamp);
            await learningMode.loadWordList(true);
            this.updateLastUpdatedText();
            this.showRefreshSuccessMessage();
        } catch(err) {
            this.showToast("데이터 새로고침(버전 업데이트)에 실패했습니다: " + err.message, true);
        } finally {
            elementsToDisable.forEach(el => el.classList.remove('pointer-events-none', 'opacity-50'));
            this.elements.refreshBtn.innerHTML = refreshIconHTML;
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
    showRefreshSuccessMessage() {
        const msgEl = this.elements.refreshSuccessMessage;
        msgEl.classList.remove('hidden', 'opacity-0');
        setTimeout(() => {
            msgEl.classList.add('opacity-0');
            setTimeout(() => msgEl.classList.add('hidden'), 500);
        }, 1500);
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
    updateLastUpdatedText() {
        const grade = this.state.selectedSheet;
        if (this.elements.lastUpdatedText && grade) {
            const timestamp = this.state.lastCacheTimestamp[grade];
            if (timestamp) {
                const d = new Date(timestamp);
                const dateString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                this.elements.lastUpdatedText.textContent = `최종 업데이트 : ${dateString}`;
                this.elements.lastUpdatedText.classList.remove('hidden');
            } else {
                this.elements.lastUpdatedText.textContent = '업데이트 정보 없음';
                this.elements.lastUpdatedText.classList.remove('hidden');
            }
        } else if (this.elements.lastUpdatedText) {
             this.elements.lastUpdatedText.classList.add('hidden');
        }
    },
    async fetchAndSetBackgroundImages() {
        const images = this.config.backgroundImages;
        if (images.length === 0) return;
        const randomIndex = Math.floor(Math.random() * images.length);
        const imageUrl = images[randomIndex];
        document.documentElement.style.setProperty('--bg-image', `url('${imageUrl}')`);
    },
    async loadGradeImages() {
        document.querySelectorAll('.grade-select-card img').forEach(async (img) => {
            img.src = img.src;
        });
    },
    async loadModeImages() {
        const ids = ['#select-learning-btn img', '#select-quiz-btn img', '#start-meaning-quiz-btn img', '#start-blank-quiz-btn img', '#start-definition-quiz-btn img'];
        ids.forEach(async (id) => {
            const img = document.querySelector(id);
            if (img) img.src = img.src;
        });
    }
};
function playSingleBeep({ frequency, duration = 0.1, type = 'sine', gain = 0.3, endFrequency }) {
    if (!app.state.audioContext) {
        console.warn("AudioContext not initialized. Cannot play beep.");
        return;
    }
    const oscillator = app.state.audioContext.createOscillator();
    const gainNode = app.state.audioContext.createGain();
    const now = app.state.audioContext.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) {
        oscillator.frequency.linearRampToValueAtTime(endFrequency, now + duration);
    }
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(gain, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.01);
    oscillator.connect(gainNode);
    gainNode.connect(app.state.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
}
function playSequence(soundDefinition) {
    if (soundDefinition.sequence && Array.isArray(soundDefinition.sequence)) {
        soundDefinition.sequence.forEach(note => {
            if (note.delay) {
                setTimeout(() => { playSingleBeep(note); }, note.delay);
            } else {
                playSingleBeep(note);
            }
        });
    } else {
        playSingleBeep(soundDefinition);
    }
}
const correctBeep = {
    name: '또로롱 (물방울)',
    sequence: [
        { frequency: 523, duration: 0.07, type: 'triangle', gain: 0.25 },
        { delay: 80, frequency: 659, duration: 0.07, type: 'triangle', gain: 0.25 },
        { delay: 160, frequency: 783, duration: 0.07, type: 'triangle', gain: 0.25 }
    ]
};
const incorrectBeep = {
    name: '삐빅 (경고)',
    sequence: [
        { frequency: 400, duration: 0.07, type: 'square', gain: 0.15 },
        { delay: 90, frequency: 400, duration: 0.07, type: 'square', gain: 0.15 }
    ]
};
const audioDBCache = {
    db: null, dbName: 'ttsAudioCacheDB_voca', storeName: 'audioStore',
    init() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { console.warn('IndexedDB not supported, TTS caching disabled.'); return resolve(); }
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = event => { const db = event.target.result; if (!db.objectStoreNames.contains(this.storeName)) { db.createObjectStore(this.storeName); } };
            request.onsuccess = event => { this.db = event.target.result; resolve(); };
            request.onerror = event => { console.error("IndexedDB error:", event.target.error); reject(event.target.error); };
        });
    },
    getAudio: key => new Promise((resolve) => {
        if (!audioDBCache.db) return resolve(null);
         try {
            const request = audioDBCache.db.transaction([audioDBCache.storeName]).objectStore(audioDBCache.storeName).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => { console.error("IndexedDB getAudio error:", e.target.error); resolve(null); };
        } catch (e) {
            console.error("IndexedDB transaction error (getAudio):", e); resolve(null);
        }
    }),
    saveAudio: (key, audioData) => {
        if (!audioDBCache.db) return;
        try {
            const tx = audioDBCache.db.transaction([audioDBCache.storeName], 'readwrite');
            tx.objectStore(audioDBCache.storeName).put(audioData, key);
            tx.onerror = (e) => console.error("IndexedDB saveAudio transaction error:", e.target.error);
        }
        catch (e) { console.error("IndexedDB save audio error:", e); }
    }
};
const translationDBCache = {
    db: null, dbName: 'translationCacheDB_B', storeName: 'translationStore',
    init() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { console.warn('IndexedDB not supported for translation cache.'); return resolve(); }
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = event => { const db = event.target.result; if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName); };
            request.onsuccess = event => { this.db = event.target.result; resolve(); };
            request.onerror = event => { console.error("IndexedDB error (translation):", event.target.error); reject(event.target.error); };
        });
    },
    get: key => new Promise((resolve, reject) => {
        if (!translationDBCache.db) return resolve(null);
        try {
            const request = translationDBCache.db.transaction([translationDBCache.storeName], 'readonly').objectStore(translationDBCache.storeName).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = event => { console.error("IndexedDB get translation error:", event.target.error); reject(event.target.error); };
        } catch (e) {
            console.error("IndexedDB transaction error (get translation):", e); reject(e);
        }
    }),
    save: (key, data) => {
        if (!translationDBCache.db) return;
        try {
            const tx = translationDBCache.db.transaction([translationDBCache.storeName], 'readwrite');
            tx.objectStore(translationDBCache.storeName).put(data, key);
            tx.onerror = (e) => console.error("IndexedDB save translation transaction error:", e.target.error);
        }
        catch (e) { console.error("IndexedDB save translation error:", e); }
    }
};
const api = {
    async translateText(text) {
        if (!text || !text.trim()) return '';
        try {
            const cached = await translationDBCache.get(text);
            if (cached) return cached;
            const url = new URL(app.config.SCRIPT_URL);
            url.searchParams.append('action', 'translateText');
            url.searchParams.append('text', text);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if (data.success) {
                translationDBCache.save(text, data.translatedText);
                return data.translatedText;
            }
            console.error("Translation API Error:", data.message);
            return '번역 실패';
        } catch (error) {
            console.error("Translation Fetch Error:", error);
            return '번역 오류';
        }
    },
    googleTtsApiKey: 'AIzaSyAJmQBGY4H9DVMlhMtvAAVMi_4N7__DfKA',
    async speak(text) {
        if (!text || !text.trim()) return;
        activityTracker.recordActivity();
        const processedText = text.replace(/\bsb\b/g, 'somebody').replace(/\bsth\b/g, 'something');
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (!isIOS && 'speechSynthesis' in window) {
            try {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(processedText);
                utterance.lang = 'en-US'; 
                const TARGET_VOICE_NAME = "Microsoft Ana Online (Natural) - English (United States)";
                const voices = window.speechSynthesis.getVoices();
                const selectedVoice = voices.find(v => v.name === TARGET_VOICE_NAME);
                if (selectedVoice) {
                    utterance.voice = selectedVoice;
                }
                window.speechSynthesis.speak(utterance);
                return;
            } catch (error) {
                console.warn("Native TTS failed, falling back to Google TTS API:", error);
            }
        }
        const cacheKey = processedText;
        let ttsAudioContext = null;
        try {
            const cachedAudio = await audioDBCache.getAudio(cacheKey);
            if (cachedAudio) {
                ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                if(ttsAudioContext.state === 'suspended') await ttsAudioContext.resume();
                const audioBuffer = await ttsAudioContext.decodeAudioData(cachedAudio.slice(0));
                const source = ttsAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ttsAudioContext.destination);
                source.start(0);
                source.onended = () => ttsAudioContext.close();
                return;
            }
            const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.googleTtsApiKey}`;
            const requestBody = {
                input: { text: processedText },
                voice: { languageCode: 'en-US', name: 'en-US-Standard-C' },
                audioConfig: { audioEncoding: 'MP3' }
            };
            const response = await fetch(ttsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            if (!response.ok) {
                 const errorData = await response.json();
                 throw new Error(`Google TTS API Error: ${errorData.error?.message || response.statusText}`);
            }
            const data = await response.json();
            if (data.audioContent) {
                const audioBlob = new Blob([Uint8Array.from(atob(data.audioContent), c => c.charCodeAt(0))], { type: 'audio/mp3' });
                const arrayBuffer = await audioBlob.arrayBuffer();
                audioDBCache.saveAudio(cacheKey, arrayBuffer.slice(0));
                ttsAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                if(ttsAudioContext.state === 'suspended') await ttsAudioContext.resume();
                const audioBuffer = await ttsAudioContext.decodeAudioData(arrayBuffer);
                const source = ttsAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ttsAudioContext.destination);
                source.start(0);
                source.onended = () => ttsAudioContext.close();
            } else {
                 throw new Error("No audio content received from Google TTS API");
            }
        } catch (error) {
            console.error('Error fetching/playing TTS audio:', error);
             if (ttsAudioContext && ttsAudioContext.state !== 'closed') {
                 ttsAudioContext.close();
             }
        }
    },
    async copyToClipboard(text) {
        if (navigator.clipboard && text) {
            try { await navigator.clipboard.writeText(text); }
            catch (err) { console.warn("Clipboard write failed:", err); }
        }
    },
    async fetchDefinition(word) {
        if (!word) return null;
        const apiKey = app.config.MERRIAM_WEBSTER_API_KEY;
        const url = `https://dictionaryapi.com/api/v3/references/learners/json/${encodeURIComponent(word)}?key=${apiKey}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`Definition fetch failed for ${word}: Status ${response.status}`);
                return null;
            }
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                const firstResult = data[0];
                if (typeof firstResult === 'object' && firstResult !== null && firstResult.shortdef && Array.isArray(firstResult.shortdef) && firstResult.shortdef.length > 0) {
                    return firstResult.shortdef[0].split(';')[0].trim();
                }
            }
            return null;
        } catch (e) {
            console.error(`Error fetching definition for ${word}:`, e);
            return null;
        }
    },
    // 권한 확인을 RTDB에서 수행하도록 변경
    async checkPermission(email) {
        const rtdbKey = email.toLowerCase().replace(/\./g, '_');
        const rtdbRef = ref(rt_db, `roster/${rtdbKey}`);

        try {
            const snapshot = await get(rtdbRef);
            const data = snapshot.val();

            if (data && data.permissions) {
                return data.permissions; // approved, denied, pending
            }
            // RTDB에 명단 자체가 없으면 not_found
            return 'not_found';
        } catch (error) {
            console.error("RTDB Permission Check Error:", error);
            // 오류 발생 시 앱 사용을 막기 위해 denied나 pending으로 처리하는 대신, not_found를 반환하여 권한 요청을 유도합니다.
            return 'not_found';
        }
    },
    // 명단시트 Apps Script로 요청을 보내는 기능은 유지
    async requestPermission(email, name, grade) {
        const url = new URL(app.config.SCRIPT_URL);
        url.searchParams.append('action', 'requestPermission');
        url.searchParams.append('email', email);
        url.searchParams.append('name', name);
        url.searchParams.append('grade', grade); 
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
    }
};
const ui = {
    nonInteractiveWords: new Set(['a', 'an', 'the', 'I', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those', 'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'something', 'anybody', 'anyone', 'anything', 'nobody', 'no one', 'nothing', 'everybody', 'everyone', 'everything', 'all', 'any', 'both', 'each', 'either', 'every', 'few', 'little', 'many', 'much', 'neither', 'none', 'one', 'other', 'several', 'some', 'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'at', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'by', 'down', 'during', 'for', 'from', 'in', 'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto', 'out', 'outside', 'over', 'past', 'since', 'through', 'throughout', 'to', 'toward', 'under', 'underneath', 'until', 'unto', 'up', 'upon', 'with', 'within', 'without', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'after', 'although', 'as', 'because', 'before', 'if', 'once', 'since', 'than', 'that', 'though', 'till', 'unless', 'until', 'when', 'whenever', 'where', 'whereas', 'wherever', 'whether', 'while', 'that', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'what', 'whatever', 'whichever', 'whoever', 'whomever', 'who', 'whom', 'whose', 'what', 'which', 'when', 'where', 'why', 'how', 'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'done', 'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'ought', 'not', 'very', 'too', 'so', 'just', 'well', 'often', 'always', 'never', 'sometimes', 'here', 'there', 'now', 'then', 'again', 'also', 'ever', 'even', 'how', 'quite', 'rather', 'soon', 'still', 'more', 'most', 'less', 'least', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'then', 'there', 'here', "don't", "didn't", "can't", "couldn't", "she's", "he's", "i'm", "you're", "they're", "we're", "it's", "that's"]),
    adjustFontSize(element) {
        if (!element || !element.parentElement) return;
        element.style.fontSize = '';
        const defaultFontSize = parseFloat(window.getComputedStyle(element).fontSize);
        let currentFontSize = defaultFontSize;
        const container = element.parentElement;
        while (element.scrollWidth > container.clientWidth - 80 && currentFontSize > 12) {
            currentFontSize -= 1;
            element.style.fontSize = `${currentFontSize}px`;
        }
    },
    renderInteractiveText(targetElement, text) {
        if (!targetElement) return;
        targetElement.innerHTML = '';
        if (!text || !text.trim()) return;
        const regex = /(\[.*?\]|\bS\+V\b)|([a-zA-Z0-9'-]+(?:[\s'-]*[a-zA-Z0-9'-]+)*)/g;
        text.split('\n').forEach(line => {
            let lastIndex = 0;
            let match;
            while ((match = regex.exec(line))) {
                if (match.index > lastIndex) targetElement.appendChild(document.createTextNode(line.substring(lastIndex, match.index)));
                const [_, nonClickable, englishPhrase] = match;
                if (englishPhrase) {
                    const span = document.createElement('span');
                    span.textContent = englishPhrase;
                    if (!this.nonInteractiveWords.has(englishPhrase.toLowerCase())) {
                        span.className = 'interactive-word';
                        span.onclick = () => { clearTimeout(app.state.longPressTimer); api.speak(englishPhrase); };
                        span.oncontextmenu = e => { e.preventDefault(); this.showWordContextMenu(e, englishPhrase); };
                        let touchMove = false;
                        span.addEventListener('touchstart', e => { touchMove = false; clearTimeout(app.state.longPressTimer); app.state.longPressTimer = setTimeout(() => { if (!touchMove) this.showWordContextMenu(e, englishPhrase); }, 700); }, { passive: true });
                        span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(app.state.longPressTimer); });
                        span.addEventListener('touchend', () => { clearTimeout(app.state.longPressTimer); });
                    }
                    targetElement.appendChild(span);
                } else if (nonClickable) {
                    targetElement.appendChild(document.createTextNode(nonClickable));
                }
                lastIndex = regex.lastIndex;
            }
            if (lastIndex < line.length) targetElement.appendChild(document.createTextNode(line.substring(lastIndex)));
            targetElement.appendChild(document.createElement('br'));
        });
        if (targetElement.lastChild && targetElement.lastChild.tagName === 'BR') {
            targetElement.removeChild(targetElement.lastChild);
        }
    },
    handleSentenceMouseOver(event, sentence) {
        clearTimeout(app.state.translateDebounceTimeout);
        app.state.translateDebounceTimeout = setTimeout(async () => {
            const tooltip = app.elements.translationTooltip;
            const targetRect = event.target.getBoundingClientRect();
            Object.assign(tooltip.style, { left: `${targetRect.left + window.scrollX}px`, top: `${targetRect.bottom + window.scrollY + 5}px` });
            tooltip.textContent = '번역 중...';
            tooltip.classList.remove('hidden');
            tooltip.textContent = await api.translateText(sentence);
        }, 1000);
    },
    handleSentenceMouseOut() {
        clearTimeout(app.state.translateDebounceTimeout);
        app.elements.translationTooltip.classList.add('hidden');
    },
    createInteractiveFragment(text, isForSampleSentence = false) {
        const fragment = document.createDocumentFragment();
        if (!text || !text.trim()) return fragment;
        const parts = text.split(/([a-zA-Z0-9'-]+)/g);
        parts.forEach(part => {
            if (/([a-zA-Z0-9'-]+)/.test(part) && !this.nonInteractiveWords.has(part.toLowerCase())) {
                const span = document.createElement('span');
                span.textContent = part;
                span.className = 'interactive-word';
                span.onclick = (e) => {
                    if (isForSampleSentence) e.stopPropagation();
                    clearTimeout(app.state.longPressTimer);
                    api.speak(part);
                };
                span.oncontextmenu = (e) => {
                    e.preventDefault();
                    if (isForSampleSentence) e.stopPropagation();
                    this.showWordContextMenu(e, part);
                };
                 let touchMove = false;
                span.addEventListener('touchstart', (e) => {
                    if (isForSampleSentence) e.stopPropagation();
                    touchMove = false;
                    clearTimeout(app.state.longPressTimer);
                    app.state.longPressTimer = setTimeout(() => { if (!touchMove) { this.showWordContextMenu(e, part); } }, 700);
                }, { passive: true });
                span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(app.state.longPressTimer); });
                span.addEventListener('touchend', () => { clearTimeout(app.state.longPressTimer); });
                fragment.appendChild(span);
            } else {
                const span = document.createElement('span');
                span.textContent = part;
                span.onclick = (e) => e.stopPropagation();
                fragment.appendChild(span);
            }
        });
        return fragment;
    },
    displaySentences(sentences, containerElement) {
        if (!containerElement) return;
        containerElement.innerHTML = '';
        sentences.filter(s => s && s.trim()).forEach(sentence => {
            const p = document.createElement('p');
            p.className = 'p-2 rounded transition-colors sample-sentence';
            p.onclick = (e) => {
                if (e.target.closest('.sentence-content-area .interactive-word')) return;
                api.speak(p.textContent);
                this.handleSentenceMouseOver(e, p.textContent);
            };
            p.addEventListener('mouseover', (e) => {
                if (!e.target.closest('.sentence-content-area')) {
                     this.handleSentenceMouseOver(e, p.textContent);
                }
            });
            p.addEventListener('mouseout', this.handleSentenceMouseOut);
            const sentenceContent = document.createElement('span');
            sentenceContent.className = 'sentence-content-area';
             sentenceContent.addEventListener('mouseenter', () => {
                clearTimeout(app.state.translateDebounceTimeout);
                this.handleSentenceMouseOut();
            });
            const sentenceParts = sentence.split(/(\*.*?\*)/g);
            sentenceParts.forEach(part => {
                if (part.startsWith('*') && part.endsWith('*')) {
                    const strong = document.createElement('strong');
                    strong.appendChild(this.createInteractiveFragment(part.slice(1, -1), true));
                    sentenceContent.appendChild(strong);
                } else if (part) {
                    sentenceContent.appendChild(this.createInteractiveFragment(part, true));
                }
            });
            p.appendChild(sentenceContent);
            containerElement.appendChild(p);
        });
    },
    showWordContextMenu(event, word) {
        event.preventDefault();
        const menu = app.elements.wordContextMenu;
        const touch = event.touches ? event.touches[0] : null;
        const x = touch ? touch.clientX : event.clientX;
        const y = touch ? touch.clientY : event.clientY;
        Object.assign(menu.style, { top: `${y}px`, left: `${x}px` });
        menu.classList.remove('hidden');
        const encodedWord = encodeURIComponent(word);
        app.elements.searchDaumContextBtn.onclick = () => { window.open(`https://dic.daum.net/search.do?q=${encodedWord}`, 'daum-dictionary'); this.hideWordContextMenu(); };
        app.elements.searchNaverContextBtn.onclick = () => { window.open(`https://en.dict.naver.com/#/search?query=${encodedWord}`, 'naver-dictionary'); this.hideWordContextMenu(); };
        app.elements.searchLongmanContextBtn.onclick = () => { window.open(`https://www.ldoceonline.com/dictionary/${encodedWord}`, 'longman-dictionary'); this.hideWordContextMenu(); };
    },
    hideWordContextMenu() {
        if (app.elements.wordContextMenu) app.elements.wordContextMenu.classList.add('hidden');
    }
};
const utils = {
    _getProgressRef(grade = app.state.selectedSheet) {
        if (!app.state.user || !grade) return null;
        return doc(db, 'users', app.state.user.uid, 'progress', grade);
    },
    addProgressUpdateToLocalSync(word, key, value, grade = app.state.selectedSheet) {
        if (!grade) return;
        try {
            const localKey = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES(grade);
            const unsynced = JSON.parse(localStorage.getItem(localKey) || '{}');
            if (!unsynced[word]) {
                unsynced[word] = {};
            }
            unsynced[word][key] = value;
            localStorage.setItem(localKey, JSON.stringify(unsynced));
        } catch (e) {
            console.error("Error adding progress update to localStorage sync", e);
        }
    },
    async loadUserProgress() {
        const currentGrade = app.state.selectedSheet;
        if (!currentGrade) {
            app.state.currentProgress = {};
            return;
        }
        const docRef = this._getProgressRef(currentGrade);
        if (!docRef) {
            app.state.currentProgress = {};
            return;
        }
        try {
            const docSnap = await getDoc(docRef);
            app.state.currentProgress = docSnap.exists() ? docSnap.data() : {};
        } catch (error) {
            console.error(`Error loading progress for grade ${currentGrade}:`, error);
            app.state.currentProgress = {};
        }
    },
    getWordStatus(word) {
        const grade = app.state.selectedSheet;
        let localStatus = {};
        if (grade) {
            try {
                const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES(grade);
                const unsynced = JSON.parse(localStorage.getItem(key) || '{}');
                if (unsynced[word]) {
                    localStatus = unsynced[word];
                }
            } catch(e) { console.warn("Error reading local progress updates:", e); }
        }
        const progress = { ...(app.state.currentProgress[word] || {}), ...localStatus };
        const quizTypes = ['MULTIPLE_CHOICE_MEANING', 'FILL_IN_THE_BLANK', 'MULTIPLE_CHOICE_DEFINITION'];
        const statuses = quizTypes.map(type => progress[type] || 'unseen');
        if (Object.keys(progress).length === 0 && Object.keys(localStatus).length === 0) return 'unseen';
        if (statuses.includes('incorrect')) return 'review';
        if (statuses.every(s => s === 'correct')) return 'learned';
        if (statuses.some(s => s === 'correct')) return 'learning';
        return 'unseen';
    },
    async updateWordStatus(word, quizType, result) {
        const grade = app.state.selectedSheet;
        if (!word || !quizType || !app.state.user || !grade) return;
        const isCorrect = result === 'correct';
        if (!app.state.currentProgress[word]) app.state.currentProgress[word] = {};
        app.state.currentProgress[word][quizType] = result;
        this.addProgressUpdateToLocalSync(word, quizType, result, grade);
        this.saveQuizHistoryToLocal(quizType, isCorrect, grade);
    },
    getCorrectlyAnsweredWords(quizType, grade = app.state.selectedSheet) {
        if (!quizType || !grade) return [];
        let localUpdates = {};
         try {
             const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES(grade);
             localUpdates = JSON.parse(localStorage.getItem(key) || '{}');
         } catch(e) { console.warn("Error reading local progress for correct words check:", e); }
        const allProgress = app.state.currentProgress;
        const combinedKeys = new Set([...Object.keys(allProgress), ...Object.keys(localUpdates)]);
        const correctWords = [];
        combinedKeys.forEach(word => {
            const serverState = allProgress[word]?.[quizType];
            const localState = localUpdates[word]?.[quizType];
            const finalStatus = localState !== undefined ? localState : serverState;
            if (finalStatus === 'correct') {
                correctWords.push(word);
            }
        });
        return correctWords;
    },
    getIncorrectWords() {
        const grade = app.state.selectedSheet;
        if (!grade || !learningMode.state.wordList[grade]) return [];
        const allWords = learningMode.state.wordList[grade];
        return allWords
            .filter(wordObj => this.getWordStatus(wordObj.word) === 'review')
            .map(wordObj => wordObj.word);
    },
    async toggleFavorite(word) {
        const grade = app.state.selectedSheet;
        if (!word || !app.state.user || !grade) return false;
        let isCurrentlyFavorite = app.state.currentProgress[word]?.favorite || false;
        try {
            const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES(grade);
            const unsynced = JSON.parse(localStorage.getItem(key) || '{}');
            if (unsynced[word] && unsynced[word].favorite !== undefined) {
                isCurrentlyFavorite = unsynced[word].favorite;
            }
        } catch(e) {}
        const newFavoriteStatus = !isCurrentlyFavorite;
        if (!app.state.currentProgress[word]) app.state.currentProgress[word] = {};
        app.state.currentProgress[word].favorite = newFavoriteStatus;
        this.addProgressUpdateToLocalSync(word, 'favorite', newFavoriteStatus, grade);
        return newFavoriteStatus;
    },
    getFavoriteWords() {
        const grade = app.state.selectedSheet;
        let localUpdates = {};
        if (grade) {
            try {
                const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES(grade);
                localUpdates = JSON.parse(localStorage.getItem(key) || '{}');
            } catch (e) { console.warn("Error reading local progress updates for favorites:", e); }
        }
        const allProgress = app.state.currentProgress;
        const combinedKeys = new Set([...Object.keys(allProgress), ...Object.keys(localUpdates)]);
        const favoriteWords = [];
        combinedKeys.forEach(word => {
            const serverState = allProgress[word] || {};
            const localState = localUpdates[word] || {};
            const combinedState = { ...serverState, ...localState };
            if (combinedState.favorite === true) {
                favoriteWords.push(word);
            }
        });
        return favoriteWords;
    },
    async saveStudyHistory(seconds, grade) {
        if (!app.state.user || seconds < 1 || !grade) return;
        const today = new Date().toISOString().slice(0, 10);
        const historyRef = doc(db, 'users', app.state.user.uid, 'history', 'study');
        try {
            const docSnap = await getDoc(historyRef);
            const data = docSnap.exists() ? docSnap.data() : {};
            const dailyData = data[today] || {};
            const currentSeconds = dailyData[grade] || 0;
            // setDoc 대신 updateDoc을 사용하여 문서가 존재할 때만 업데이트되도록 합니다. (성능상 이점 없음, 코딩 스타일 유지)
            await setDoc(historyRef, { [today]: { [grade]: currentSeconds + seconds } }, { merge: true });
        } catch(e) {
            console.error("Failed to update study history:", e);
            throw e;
        }
    },
    saveQuizHistoryToLocal(quizType, isCorrect, grade) {
        if (!grade || !quizType) return;
        try {
            const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_QUIZ(grade);
            const stats = JSON.parse(localStorage.getItem(key) || '{}');
            if (!stats[quizType]) {
                stats[quizType] = { total: 0, correct: 0 };
            }
            stats[quizType].total += 1;
            if (isCorrect) {
                stats[quizType].correct += 1;
            }
            localStorage.setItem(key, JSON.stringify(stats));
        } catch (e) {
            console.error("Error saving quiz stats to localStorage", e);
        }
    },
    async syncQuizHistory(statsToSync, grade) {
        if (!app.state.user || !statsToSync || !grade) return;
        const today = new Date().toISOString().slice(0, 10);
        const historyRef = doc(db, 'users', app.state.user.uid, 'history', 'quiz');
        try {
            const docSnap = await getDoc(historyRef);
            const data = docSnap.exists() ? docSnap.data() : {};
            const todayData = data[today] || {};
            const gradeData = todayData[grade] || {};
            for (const type in statsToSync) {
                if (statsToSync.hasOwnProperty(type)) {
                    const typeStats = gradeData[type] || { correct: 0, total: 0 };
                    typeStats.total += statsToSync[type].total;
                    typeStats.correct += statsToSync[type].correct;
                    gradeData[type] = typeStats;
                }
            }
            await setDoc(historyRef, { [today]: { [grade]: gradeData } }, { merge: true });
        } catch(e) {
            console.error("Failed to sync quiz history:", e);
            throw e;
        }
    },
    async syncProgressUpdates(progressToSync, grade) {
         if (!app.state.user || !progressToSync || Object.keys(progressToSync).length === 0 || !grade) return;
         const progressRef = this._getProgressRef(grade);
         if (!progressRef) return;
         try {
             // progress 문서가 존재하지 않으면 setDoc으로 생성, 존재하면 updateDoc과 동일하게 작동
             await setDoc(progressRef, progressToSync, { merge: true }); 
         } catch (error) {
             console.error("Firebase progress sync (setDoc merge) failed:", error);
             throw error;
         }
     },
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
};
const dashboard = {
    elements: {
        container: document.getElementById('dashboard-container'),
        content: document.getElementById('dashboard-content'),
        stats7DayContainer: document.getElementById('dashboard-stats-7day-container'),
        stats30DayContainer: document.getElementById('dashboard-stats-30day-container'),
        statsTotalContainer: document.getElementById('dashboard-stats-total-container'),
    },
    state: {
        studyTimeChart: null,
        quiz1Chart: null,
        quiz2Chart: null,
        quiz3Chart: null,
    },
    init() {},
    async show() {
        this.destroyCharts();
        this.elements.content.innerHTML = `<div class="text-center p-4"><div class="loader mx-auto"></div></div>`;
        this.elements.stats30DayContainer.innerHTML = '';
        this.elements.statsTotalContainer.innerHTML = '';
        if (!learningMode.state.isWordListReady[app.state.selectedSheet]) {
            await learningMode.loadWordList();
        }
        this.renderBaseStats();
        setTimeout(async () => {
            await this.renderAdvancedStats();
        }, 1);
    },
    renderBaseStats() {
        const grade = app.state.selectedSheet;
        if (!grade || !learningMode.state.wordList[grade]) {
             this.elements.content.innerHTML = `<p class="text-center text-gray-600">데이터를 불러올 수 없습니다.</p>`;
             return;
        }
        const allWords = learningMode.state.wordList[grade] || [];
        const totalWords = allWords.length;
        if (totalWords === 0) {
            this.elements.content.innerHTML = `<p class="text-center text-gray-600">학습할 단어가 없습니다.</p>`;
            return;
        }
        const counts = { learned: 0, learning: 0, review: 0, unseen: 0 };
        allWords.forEach(wordObj => {
            counts[utils.getWordStatus(wordObj.word)]++;
        });
        const stats = [
            { name: '미학습', description: '아직 어떤 퀴즈도 풀지 않음', count: counts.unseen, color: 'bg-gray-400' },
            { name: '학습 중', description: '최소 1종류의 퀴즈를 풀어서 맞힘, 아직 틀리지 않음', count: counts.learning, color: 'bg-blue-500' },
            { name: '복습 필요', description: '최소 1종류의 퀴즈에서 틀림', count: counts.review, color: 'bg-orange-500' },
            { name: '학습 완료', description: '모든 종류의 퀴즈에서 정답을 맞힘', count: counts.learned, color: 'bg-green-500' }
        ];
        let contentHTML = `<div class="bg-gray-50 p-4 rounded-lg shadow-inner text-center"><p class="text-lg text-gray-600">총 단어 수</p><p class="text-4xl font-bold text-gray-800">${totalWords}</p></div><div><h2 class="text-xl font-bold text-gray-700 mb-3 text-center">학습 단계별 분포</h2><div class="space-y-4">`;
        stats.forEach(stat => {
            const percentage = totalWords > 0 ? ((stat.count / totalWords) * 100).toFixed(1) : 0;
            contentHTML += `<div class="w-full"><div class="flex justify-between items-center mb-1"><span class="text-base font-semibold text-gray-700" title="${stat.description}">${stat.name}</span><span class="text-sm font-medium text-gray-500">${stat.count}개 (${percentage}%)</span></div><div class="w-full bg-gray-200 rounded-full h-4"><div class="${stat.color} h-4 rounded-full" style="width: ${percentage}%"></div></div></div>`;
        });
        contentHTML += `</div></div>`;
        this.elements.content.innerHTML = contentHTML;
    },
    async renderAdvancedStats() {
        if (!app.state.user || !app.state.selectedSheet) return;
        const grade = app.state.selectedSheet;
        try {
            const studyHistoryDoc = await getDoc(doc(db, 'users', app.state.user.uid, 'history', 'study'));
            const quizHistoryDoc = await getDoc(doc(db, 'users', app.state.user.uid, 'history', 'quiz'));
            const studyHistory = studyHistoryDoc.exists() ? studyHistoryDoc.data() : {};
            const quizHistory = quizHistoryDoc.exists() ? quizHistoryDoc.data() : {};
            this.render7DayCharts(studyHistory, quizHistory, grade);
            this.renderSummaryCards(studyHistory, quizHistory, grade);
        } catch (e) {
            console.error("Error rendering advanced stats:", e);
            this.elements.content.innerHTML += `<p class="text-red-500 text-center mt-4">추가 통계 정보를 불러오는 데 실패했습니다.</p>`;
        }
    },
    destroyCharts() {
        if (this.state.studyTimeChart) this.state.studyTimeChart.destroy();
        if (this.state.quiz1Chart) this.state.quiz1Chart.destroy();
        if (this.state.quiz2Chart) this.state.quiz2Chart.destroy();
        if (this.state.quiz3Chart) this.state.quiz3Chart.destroy();
        this.state.studyTimeChart = this.state.quiz1Chart = this.state.quiz2Chart = this.state.quiz3Chart = null;
    },
    render7DayCharts(studyHistory, quizHistory, grade) {
        const today = new Date();
        const labels = [];
        const studyData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateString = d.toISOString().slice(0, 10);
            labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
            studyData.push(Math.round(((studyHistory[dateString] && studyHistory[dateString][grade]) || 0) / 60));
        }
        const studyTimeCtx = document.getElementById('study-time-chart')?.getContext('2d');
        if (studyTimeCtx) {
            this.state.studyTimeChart = new Chart(studyTimeCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: '학습 시간 (분)',
                        data: studyData,
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true, suggestedMax: 60 } },
                    plugins: { legend: { display: false } }
                }
            });
        }
        const quizStats7Days = {
            'MULTIPLE_CHOICE_MEANING': { correct: 0, total: 0 },
            'FILL_IN_THE_BLANK': { correct: 0, total: 0 },
            'MULTIPLE_CHOICE_DEFINITION': { correct: 0, total: 0 },
        };
        for (let i = 0; i < 7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateString = d.toISOString().slice(0, 10);
            if (quizHistory[dateString] && quizHistory[dateString][grade]) {
                for(const type in quizStats7Days){
                    if(quizHistory[dateString][grade][type]){
                        quizStats7Days[type].correct += quizHistory[dateString][grade][type].correct || 0;
                        quizStats7Days[type].total += quizHistory[dateString][grade][type].total || 0;
                    }
                }
            }
        }
        this.state.quiz1Chart = this.createDoughnutChart('quiz1-chart', 'quiz1-label', '영한 뜻', quizStats7Days['MULTIPLE_CHOICE_MEANING']);
        this.state.quiz2Chart = this.createDoughnutChart('quiz2-chart', 'quiz2-label', '빈칸 추론', quizStats7Days['FILL_IN_THE_BLANK']);
        this.state.quiz3Chart = this.createDoughnutChart('quiz3-chart', 'quiz3-label', '영영 풀이', quizStats7Days['MULTIPLE_CHOICE_DEFINITION']);
    },
    createDoughnutChart(elementId, labelId, labelText, stats) {
        const ctx = document.getElementById(elementId)?.getContext('2d');
        if (!ctx) return null;
        const correct = stats.correct || 0;
        const total = stats.total || 0;
        const incorrect = total - correct;
        const hasAttempts = total > 0;
        const accuracy = hasAttempts ? Math.round((correct / total) * 100) : 0;
        const chartColors = hasAttempts ? ['#34D399', '#F87171'] : ['#E5E7EB', '#E5E7EB'];
        const chartData = hasAttempts ? [correct, incorrect > 0 ? incorrect : 0.0001] : [0, 1];
        const centerText = hasAttempts ? `${accuracy}%` : '-';
        const labelEl = document.getElementById(labelId);
        if (labelEl) {
            labelEl.textContent = `${labelText} (${correct}/${total})`;
        }
        return new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: hasAttempts ? ['정답', '오답'] : ['기록 없음'],
                datasets: [{ data: chartData, backgroundColor: chartColors, hoverBackgroundColor: chartColors, borderWidth: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: true, cutout: '70%',
                plugins: { legend: { display: false }, tooltip: { enabled: false } }
            },
            plugins: [{
                id: 'doughnutLabel',
                beforeDraw: (chart) => {
                    const { ctx, width, height } = chart;
                    ctx.restore();
                    const fontSize = (height / 114).toFixed(2);
                    ctx.font = `bold ${fontSize}em sans-serif`;
                    ctx.textBaseline = 'middle';
                    const text = centerText;
                    const textX = Math.round((width - ctx.measureText(text).width) / 2);
                    const textY = height / 2;
                    ctx.fillStyle = hasAttempts ? '#374151' : '#9CA3AF';
                    ctx.fillText(text, textX, textY);
                    ctx.save();
                }
            }]
        });
    },
    renderSummaryCards(studyHistory, quizHistory, grade) {
        const today = new Date();
        const quizTypes = [
            { id: 'MULTIPLE_CHOICE_MEANING', name: '영한 뜻' },
            { id: 'FILL_IN_THE_BLANK', name: '빈칸 추론' },
            { id: 'MULTIPLE_CHOICE_DEFINITION', name: '영영 풀이' }
        ];
        const getStatsForPeriod = (days) => {
            let totalSeconds = 0;
            const quizStats = { };
             Object.keys(quizTypes).forEach(key => quizStats[quizTypes[key].id] = { correct: 0, total: 0 });
            for (let i = 0; i < days; i++) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const dateString = d.toISOString().slice(0, 10);
                if(studyHistory[dateString]){
                    totalSeconds += studyHistory[dateString][grade] || 0;
                }
                if (quizHistory[dateString] && quizHistory[dateString][grade]) {
                    for(const type in quizStats){
                        if(quizHistory[dateString][grade][type]){
                            quizStats[type].correct += quizHistory[dateString][grade][type].correct || 0;
                            quizStats[type].total += quizHistory[dateString][grade][type].total || 0;
                        }
                    }
                }
            }
            return { totalSeconds, quizStats };
        };
        const totalStats = (() => {
            let totalSeconds = 0;
            const quizStats = { };
             Object.keys(quizTypes).forEach(key => quizStats[quizTypes[key].id] = { correct: 0, total: 0 });
            Object.values(quizHistory).forEach(dailyStats => {
                if (dailyStats[grade]) {
                    for(const type in quizStats){
                        if(dailyStats[grade][type]){
                            quizStats[type].correct += dailyStats[grade][type].correct || 0;
                            quizStats[type].total += dailyStats[grade][type].total || 0;
                        }
                    }
                }
            });
            Object.values(studyHistory).forEach(dailyData => {
                totalSeconds += dailyData[grade] || 0;
            });
            return { totalSeconds, quizStats };
        })();
        const stats30 = getStatsForPeriod(30);
        const createCardHTML = (title, time, stats) => {
            let cards = '';
            quizTypes.forEach(type => {
                const { correct, total } = stats[type.id] || { correct: 0, total: 0 };
                const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
                cards += `
                    <div class="bg-white p-2 rounded-lg shadow-sm text-center">
                        <p class="text-sm font-semibold text-gray-500">${type.name}</p>
                        <p class="font-bold text-gray-800 text-xl">${accuracy}%</p>
                        <p class="text-xs text-gray-400">(${correct}/${total})</p>
                    </div>
                `;
            });
            return `
                <div class="bg-gray-50 p-4 rounded-xl shadow-inner">
                    <h4 class="font-bold text-gray-700 mb-4 text-lg text-center">
                        ${title}
                        <span class="font-normal text-gray-500">(${this.formatSeconds(time)})</span>
                    </h4>
                    <div class="grid grid-cols-3 gap-1">
                        ${cards}
                    </div>
                </div>
            `;
        };
        this.elements.stats30DayContainer.innerHTML = createCardHTML('최근 30일 기록', stats30.totalSeconds, stats30.quizStats);
        this.elements.statsTotalContainer.innerHTML = createCardHTML('누적 총학습 기록', totalStats.totalSeconds, totalStats.quizStats);
    },
    formatSeconds(totalSeconds) {
        if (!totalSeconds || totalSeconds < 60) return `0분`;
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        let result = '';
        if (h > 0) result += `${h}시간 `;
        if (m > 0) result += `${m}분`;
        return result.trim() || '0분';
    },
};
const quizMode = {
     state: {
        currentQuiz: {},
        currentQuizType: null,
        isPracticeMode: false,
        practiceLearnedWords: [],
        sessionAnsweredInSet: 0,
        sessionCorrectInSet: 0,
        sessionMistakes: [],
        answeredWords: new Set(),
        preloadedQuizzes: {
            '1y': { 'MULTIPLE_CHOICE_MEANING': null, 'FILL_IN_THE_BLANK': null, 'MULTIPLE_CHOICE_DEFINITION': null },
            '2y': { 'MULTIPLE_CHOICE_MEANING': null, 'FILL_IN_THE_BLANK': null, 'MULTIPLE_CHOICE_DEFINITION': null },
            '3y': { 'MULTIPLE_CHOICE_MEANING': null, 'FILL_IN_THE_BLANK': null, 'MULTIPLE_CHOICE_DEFINITION': null }
        },
        isPreloading: {
            '1y': {}, '2y': {}, '3y': {}
        },
        currentRangeInputTarget: null,
    },
    elements: {},
    init() {
        this.elements = {
            quizSelectionScreen: document.getElementById('quiz-selection-screen'),
            startMeaningQuizBtn: document.getElementById('start-meaning-quiz-btn'),
            startBlankQuizBtn: document.getElementById('start-blank-quiz-btn'),
            startDefinitionQuizBtn: document.getElementById('start-definition-quiz-btn'),
            quizRangeStart: document.getElementById('quiz-range-start'),
            quizRangeEnd: document.getElementById('quiz-range-end'),
            loader: document.getElementById('quiz-loader'),
            loaderText: document.getElementById('quiz-loader-text'),
            contentContainer: document.getElementById('quiz-content-container'),
            questionDisplay: document.getElementById('quiz-question-display'),
            choices: document.getElementById('quiz-choices'),
            finishedScreen: document.getElementById('quiz-finished-screen'),
            finishedMessage: document.getElementById('quiz-finished-message'),
            quizResultModal: document.getElementById('quiz-result-modal'),
            quizResultScore: document.getElementById('quiz-result-score'),
            quizResultMistakesBtn: document.getElementById('quiz-result-mistakes-btn'),
            quizResultContinueBtn: document.getElementById('quiz-result-continue-btn'),
            rangeInputModal: document.getElementById('range-input-modal'),
            rangeInputLabel: document.getElementById('range-input-label'),
            quizRangeLabel: document.getElementById('quiz-range-label'),
            rangeInputField: document.getElementById('range-input-field'),
            rangeInputCancelBtn: document.getElementById('range-input-cancel-btn'),
            rangeInputConfirmBtn: document.getElementById('range-input-confirm-btn'),
        };
        this.bindEvents();
    },
    quizKeydownHandler(e) {
        const isQuizModeActive = !quizMode.elements.contentContainer.classList.contains('hidden') && !quizMode.elements.choices.classList.contains('disabled');
        if (!isQuizModeActive) return;
        activityTracker.recordActivity();
        const choiceCount = Array.from(quizMode.elements.choices.children).filter(el => !el.textContent.includes('PASS')).length;
        if (e.key.toLowerCase() === 'p' || e.key === '0') {
             e.preventDefault();
             const passButton = Array.from(quizMode.elements.choices.children).find(el => el.textContent.includes('PASS'));
             if(passButton) passButton.click();
        } else {
            const choiceIndex = parseInt(e.key);
            if (choiceIndex >= 1 && choiceIndex <= choiceCount) {
                e.preventDefault();
                const targetLi = quizMode.elements.choices.children[choiceIndex - 1];
                targetLi.classList.add('bg-gray-200');
                setTimeout(() => targetLi.classList.remove('bg-gray-200'), 150);
                targetLi.click();
            }
        }
    },
    bindQuizPlayEvents() {
        document.addEventListener('keydown', this.quizKeydownHandler);
    },
    unbindQuizPlayEvents() {
        document.removeEventListener('keydown', this.quizKeydownHandler);
    },
    bindEvents() {
        this.elements.startMeaningQuizBtn.addEventListener('click', () => this.start('MULTIPLE_CHOICE_MEANING'));
        this.elements.startBlankQuizBtn.addEventListener('click', () => this.start('FILL_IN_THE_BLANK'));
        this.elements.startDefinitionQuizBtn.addEventListener('click', () => this.start('MULTIPLE_CHOICE_DEFINITION'));
        this.elements.quizRangeStart.addEventListener('click', (e) => this.promptForRangeValue(e.target));
        this.elements.quizRangeEnd.addEventListener('click', (e) => this.promptForRangeValue(e.target));
        this.elements.rangeInputConfirmBtn.addEventListener('click', () => this.confirmRangeInput());
        this.elements.rangeInputCancelBtn.addEventListener('click', () => this.hideRangeInput());
        this.elements.rangeInputModal.addEventListener('click', () => this.hideRangeInput());
        this.elements.rangeInputField.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.confirmRangeInput();
            if (e.key === 'Escape') this.hideRangeInput();
        });
        this.elements.quizRangeLabel.addEventListener('click', () => this.resetQuizRange());
        this.elements.quizResultContinueBtn.addEventListener('click', () => this.continueAfterResult());
        this.elements.quizResultMistakesBtn.addEventListener('click', () => this.reviewSessionMistakes());
    },
    promptForRangeValue(targetButton) {
        if (!targetButton) return;
        this.state.currentRangeInputTarget = targetButton;
        const isStart = targetButton.id === 'quiz-range-start';
        const grade = app.state.selectedSheet;
        const min = parseInt(targetButton.dataset.min) || 1;
        const max = parseInt(targetButton.dataset.max) || (learningMode.state.wordList[grade]?.length || 1);
        const labelText = isStart ? `시작번호 (1-${max}) :` : `마지막번호 (1-${max}) :`;
        this.elements.rangeInputLabel.textContent = labelText;
        this.elements.rangeInputField.value = targetButton.textContent;
        this.elements.rangeInputField.min = min;
        this.elements.rangeInputField.max = max;
        this.elements.rangeInputModal.classList.remove('hidden');
        this.elements.rangeInputField.focus();
        this.elements.rangeInputField.select();
    },
    hideRangeInput() {
        this.elements.rangeInputModal.classList.add('hidden');
        this.state.currentRangeInputTarget = null;
    },
    confirmRangeInput() {
        const targetButton = this.state.currentRangeInputTarget;
        if (!targetButton) return;
        const grade = app.state.selectedSheet;
        const min = parseInt(targetButton.dataset.min) || 1;
        const max = parseInt(targetButton.dataset.max) || (learningMode.state.wordList[grade]?.length || 1);
        const newValueStr = this.elements.rangeInputField.value;
        if (newValueStr !== null && newValueStr.trim() !== '') {
            let newValue = parseInt(newValueStr);
            if (!isNaN(newValue)) {
                newValue = Math.max(min, Math.min(max, newValue));
                targetButton.textContent = newValue;
                if (grade) {
                    const storageKey = targetButton.id === 'quiz-range-start'
                                       ? app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START(grade)
                                       : app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END(grade);
                    try {
                        localStorage.setItem(storageKey, newValue);
                        this.clearAndPreloadQuizzesForNewRange(grade);
                    } catch (e) {
                        console.error("Error saving quiz range to localStorage", e);
                    }
                }
            } else {
                app.showToast("숫자만 입력 가능합니다.", true);
            }
        }
        this.hideRangeInput();
    },
    resetQuizRange() {
        const grade = app.state.selectedSheet;
        if (!grade) return;
        const allWords = learningMode.state.wordList[grade] || [];
        const totalWords = allWords.length > 0 ? allWords.length : 1;
        this.elements.quizRangeStart.textContent = 1;
        this.elements.quizRangeEnd.textContent = totalWords;
        try {
            localStorage.setItem(app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START(grade), 1);
            localStorage.setItem(app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END(grade), totalWords);
            this.clearAndPreloadQuizzesForNewRange(grade);
        } catch (e) {
            console.error("Error saving reset quiz range to localStorage", e);
        }
    },
    clearAndPreloadQuizzesForNewRange(grade) {
        if (!grade || !this.state.preloadedQuizzes[grade]) return;
        const quizTypes = Object.keys(this.state.preloadedQuizzes[grade]);
        quizTypes.forEach(type => {
            this.state.preloadedQuizzes[grade][type] = null;
            if (this.state.isPreloading[grade]) this.state.isPreloading[grade][type] = false;
            this.preloadNextQuiz(grade, type);
        });
    },
    async start(quizType) {
        this.state.currentQuizType = quizType;
        app.navigateTo('quiz-play', app.state.selectedSheet);
    },
    reset(showSelection = true) {
        this.state.currentQuiz = {};
        this.state.practiceLearnedWords = [];
        this.state.sessionAnsweredInSet = 0;
        this.state.sessionCorrectInSet = 0;
        this.state.sessionMistakes = [];
        if (showSelection) {
            this.state.currentQuizType = null;
            this.state.answeredWords.clear();
        }
        this.elements.loader.querySelector('.loader').style.display = 'block';
        this.elements.loaderText.textContent = "퀴즈 데이터를 불러오는 중...";
        if (showSelection) {
            this.elements.quizSelectionScreen.classList.remove('hidden');
            this.elements.loader.classList.add('hidden');
        } else {
            this.showLoader(true);
        }
        this.elements.contentContainer.classList.add('hidden');
        this.elements.finishedScreen.classList.add('hidden');
        if (this.elements.quizResultModal) this.elements.quizResultModal.classList.add('hidden');
    },
    async updateRangeInputs() {
        const grade = app.state.selectedSheet;
        if (!grade) return;
        let startValue = 1;
        let endValue = 1;
        let totalWords = 1;
        try {
            if (!learningMode.state.isWordListReady[grade]) {
                await learningMode.loadWordList();
            }
            totalWords = learningMode.state.wordList[grade]?.length || 1;
            endValue = totalWords;
            const startStorageKey = app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START(grade);
            const endStorageKey = app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END(grade);
            const savedStart = localStorage.getItem(startStorageKey);
            const savedEnd = localStorage.getItem(endStorageKey);
            if (savedStart !== null) {
                const parsedStart = parseInt(savedStart);
                if (!isNaN(parsedStart) && parsedStart >= 1 && parsedStart <= totalWords) {
                    startValue = parsedStart;
                } else {
                    localStorage.removeItem(startStorageKey);
                }
            } else {
                localStorage.setItem(startStorageKey, '1');
            }
            if (savedEnd !== null) {
                const parsedEnd = parseInt(savedEnd);
                if (!isNaN(parsedEnd) && parsedEnd >= 1 && parsedEnd <= totalWords) {
                    endValue = parsedEnd;
                } else {
                     localStorage.removeItem(endStorageKey);
                }
            } else {
                 localStorage.setItem(endStorageKey, totalWords.toString());
            }
        } catch (error) {
            console.error("Error updating quiz range inputs:", error);
            startValue = 1;
            endValue = 1;
            totalWords = 1;
        } finally {
            this.elements.quizRangeStart.textContent = startValue;
            this.elements.quizRangeStart.dataset.min = 1;
            this.elements.quizRangeStart.dataset.max = totalWords;
            this.elements.quizRangeEnd.textContent = endValue;
            this.elements.quizRangeEnd.dataset.min = 1;
            this.elements.quizRangeEnd.dataset.max = totalWords;
        }
    },
    async displayNextQuiz() {
        this.showLoader(true, '다음 문제 생성 중...');
        let nextQuiz = null;
        const grade = app.state.selectedSheet;
        const type = this.state.currentQuizType;
        let preloaded = this.state.preloadedQuizzes[grade]?.[type];
        if (preloaded) {
            const allWords = learningMode.state.wordList[grade] || [];
            const startVal = parseInt(this.elements.quizRangeStart.textContent) || 1;
            const endVal = parseInt(this.elements.quizRangeEnd.textContent) || allWords.length;
            const startNum = Math.min(startVal, endVal);
            const endNum = Math.max(startVal, endVal);
            const startIndex = Math.max(0, startNum - 1);
            const endIndex = Math.min(allWords.length - 1, endNum - 1);
            const wordIndex = allWords.findIndex(w => w.word === preloaded.question.word);
            if (wordIndex < startIndex || wordIndex > endIndex) {
                preloaded = null;
            }
            if (preloaded && this.state.answeredWords.has(preloaded.question.word)) {
                preloaded = null;
            }
            if (preloaded && !this.state.isPracticeMode) {
                const learnedWordsInType = utils.getCorrectlyAnsweredWords(this.state.currentQuizType);
                if (learnedWordsInType.includes(preloaded.question.word)) {
                    preloaded = null;
                }
            }
        }
        if (preloaded) {
            nextQuiz = preloaded;
            this.state.preloadedQuizzes[grade][type] = null;
            this.preloadNextQuiz(grade, type, nextQuiz.question.word);
        }
        if (!nextQuiz) {
            nextQuiz = await this.generateSingleQuiz();
            if (nextQuiz) {
                this.preloadNextQuiz(grade, type, nextQuiz.question.word);
            }
        }
        if (nextQuiz) {
            this.state.currentQuiz = nextQuiz;
            this.showLoader(false);
            this.renderQuiz(nextQuiz);
        } else {
            if (this.state.sessionAnsweredInSet > 0) {
                this.showSessionResultModal(true);
            } else {
                this.showFinishedScreen("No more quizzes!");
                setTimeout(() => app.navigateTo('quiz', grade), 800);
            }
        }
    },
    async generateSingleQuiz() {
        const grade = app.state.selectedSheet;
        if (!grade || !learningMode.state.wordList[grade]) return null;
        const allWords = learningMode.state.wordList[grade] || [];
        if (allWords.length === 0) return null;
        const startVal = parseInt(this.elements.quizRangeStart.textContent) || 1;
        const endVal = parseInt(this.elements.quizRangeEnd.textContent) || allWords.length;
        const startNum = Math.min(startVal, endVal);
        const endNum = Math.max(startVal, endVal);
        const startIndex = Math.max(0, startNum - 1);
        const endIndex = Math.min(allWords.length - 1, endNum - 1);
        const wordsInRange = allWords.slice(startIndex, endIndex + 1);
        if (wordsInRange.length === 0) return null;
        const learnedWordsInType = this.state.isPracticeMode ?
            this.state.practiceLearnedWords :
            utils.getCorrectlyAnsweredWords(this.state.currentQuizType);
        let candidates = wordsInRange.filter(wordObj => {
             if (this.state.answeredWords.has(wordObj.word)) {
                 return false;
             }
             if (this.state.isPracticeMode) {
                 return true;
             }
             const status = utils.getWordStatus(wordObj.word);
             return status !== 'learned' && !learnedWordsInType.includes(wordObj.word);
        });
        if (this.state.currentQuizType === 'FILL_IN_THE_BLANK') {
            candidates = candidates.filter(word => {
                if (!word.sample || word.sample.trim() === '') return false;
                const firstLine = word.sample.split('\n')[0];
                const placeholderRegex = /\*(.*?)\*/;
                const wordRegex = new RegExp(`\\b${word.word}\\b`, 'i');
                return placeholderRegex.test(firstLine) || wordRegex.test(firstLine);
            });
        }
        if (candidates.length === 0) return null;
        candidates.sort(() => 0.5 - Math.random());
        const usableAllWordsForChoices = allWords.length >= 4 ? allWords : [...allWords, {word: 'dummy1', meaning: '오답1'}, {word: 'dummy2', meaning: '오답2'}, {word: 'dummy3', meaning: '오답3'}];
        for (const wordData of candidates) {
            let quiz = null;
            if (this.state.currentQuizType === 'MULTIPLE_CHOICE_MEANING') {
                quiz = this.createMeaningQuiz(wordData, usableAllWordsForChoices);
            } else if (this.state.currentQuizType === 'FILL_IN_THE_BLANK') {
                quiz = this.createBlankQuiz(wordData, usableAllWordsForChoices);
            } else if (this.state.currentQuizType === 'MULTIPLE_CHOICE_DEFINITION') {
                const definition = await api.fetchDefinition(wordData.word);
                if (definition) {
                    quiz = this.createDefinitionQuiz(wordData, usableAllWordsForChoices, definition);
                }
            }
            if (quiz) return quiz;
        }
        return null;
    },
    renderQuiz(quizData) {
        const { type, question, choices } = quizData;
        const questionDisplay = this.elements.questionDisplay;
        questionDisplay.innerHTML = '';
        if (type === 'MULTIPLE_CHOICE_DEFINITION') {
            questionDisplay.classList.remove('justify-center', 'items-center');
            ui.displaySentences([question.definition], questionDisplay);
            const sentenceElement = questionDisplay.querySelector('p');
            if(sentenceElement) sentenceElement.className = 'text-lg sm:text-xl text-left text-gray-800 leading-relaxed';
        } else if (type === 'FILL_IN_THE_BLANK') {
            questionDisplay.classList.remove('justify-center', 'items-center');
            const p = document.createElement('p');
            p.className = 'text-xl sm:text-2xl text-left text-gray-800 leading-relaxed';
            const sentenceParts = question.sentence_with_blank.split(/(\*.*?\*|＿＿＿＿)/g);
            sentenceParts.forEach(part => {
                if (part === '＿＿＿＿') {
                    const blankSpan = document.createElement('span');
                    blankSpan.style.whiteSpace = 'nowrap'; blankSpan.textContent = '＿＿＿＿';
                    p.appendChild(blankSpan);
                } else if (part && part.startsWith('*') && part.endsWith('*')) {
                    const strong = document.createElement('strong');
                    strong.appendChild(ui.createInteractiveFragment(part.slice(1, -1), true));
                    p.appendChild(strong);
                } else if (part) {
                    p.appendChild(ui.createInteractiveFragment(part, true));
                }
            });
            questionDisplay.appendChild(p);
        } else {
            questionDisplay.classList.add('justify-center', 'items-center');
            const h1 = document.createElement('h1');
            h1.className = 'text-3xl sm:text-4xl font-bold text-center text-gray-800 cursor-pointer';
            h1.title = "클릭하여 발음 듣기";
            h1.textContent = question.word;
            h1.onclick = () => api.speak(question.word);
            questionDisplay.appendChild(h1);
            ui.adjustFontSize(h1);
        }
        this.elements.choices.innerHTML = '';
        choices.forEach((choice, index) => {
            const li = document.createElement('li');
            li.className = 'choice-item border-2 border-gray-300 py-3 px-4 rounded-lg cursor-pointer flex items-start transition-all text-lg hover:bg-blue-50';
            li.innerHTML = `<span class="font-bold mr-3">${index + 1}.</span> <span>${choice}</span>`;
            li.onclick = () => this.checkAnswer(li, choice);
            this.elements.choices.appendChild(li);
        });
        const passLi = document.createElement('li');
        passLi.className = 'choice-item border-2 border-red-500 bg-red-500 hover:bg-red-600 text-white p-4 rounded-lg cursor-pointer flex items-center justify-center transition-all font-bold text-lg';
        passLi.innerHTML = `<span>PASS</span>`;
        passLi.onclick = () => this.checkAnswer(passLi, 'USER_PASSED');
        this.elements.choices.appendChild(passLi);
        this.elements.choices.classList.remove('disabled');
    },
    async checkAnswer(selectedLi, selectedChoice) {
        activityTracker.recordActivity();
        this.elements.choices.classList.add('disabled');
        const isCorrect = selectedChoice === this.state.currentQuiz.answer;
        const isPass = selectedChoice === 'USER_PASSED';
        const word = this.state.currentQuiz.question.word;
        const quizType = this.state.currentQuiz.type;
        this.state.answeredWords.add(word);
        selectedLi.classList.add(isCorrect ? 'correct' : 'incorrect');
        if (isCorrect && !isPass) {
            playSequence(correctBeep);
        } else {
            playSequence(incorrectBeep);
        }
        this.state.sessionAnsweredInSet++;
        if (isCorrect) {
            this.state.sessionCorrectInSet++;
        } else {
            this.state.sessionMistakes.push(word);
        }
        if (!this.state.isPracticeMode) {
            await utils.updateWordStatus(word, quizType, (isCorrect && !isPass) ? 'correct' : 'incorrect');
        } else if (isCorrect) {
             this.state.practiceLearnedWords.push(word);
        }
        if (!isCorrect || isPass) {
            const correctAnswerEl = Array.from(this.elements.choices.children).find(li => {
                const choiceSpan = li.querySelector('span:last-child');
                return choiceSpan && choiceSpan.textContent === this.state.currentQuiz.answer;
            });
            correctAnswerEl?.classList.add('correct');
        }
        setTimeout(() => {
            if (this.state.sessionAnsweredInSet >= 10) {
                this.showSessionResultModal(true);
            } else {
                this.displayNextQuiz();
            }
        }, 600);
    },
    showSessionResultModal(isFinal = false) {
        this.elements.quizResultScore.textContent = `${this.state.sessionAnsweredInSet}문제 중 ${this.state.sessionCorrectInSet}개 정답!`;
        this.elements.quizResultMistakesBtn.classList.toggle('hidden', this.state.sessionMistakes.length === 0);
        this.elements.quizResultContinueBtn.textContent = isFinal ? "퀴즈 유형으로" : "다음 퀴즈 계속";
        this.elements.quizResultModal.classList.remove('hidden');
    },
    continueAfterResult() {
        this.elements.quizResultModal.classList.add('hidden');
        if (this.elements.quizResultContinueBtn.textContent === "퀴즈 유형으로") {
            app.syncOfflineData();
            this.unbindQuizPlayEvents();
            app.navigateTo('quiz', app.state.selectedSheet);
            return;
        }
        this.state.sessionAnsweredInSet = 0;
        this.state.sessionCorrectInSet = 0;
        this.state.sessionMistakes = [];
        this.displayNextQuiz();
    },
    reviewSessionMistakes() {
        this.elements.quizResultModal.classList.add('hidden');
        const mistakes = [...new Set(this.state.sessionMistakes)];
        this.state.sessionAnsweredInSet = 0;
        this.state.sessionCorrectInSet = 0;
        this.state.sessionMistakes = [];
        app.syncOfflineData();
        this.unbindQuizPlayEvents();
        app.navigateTo('mistakeReview', app.state.selectedSheet, { mistakeWords: mistakes });
    },
    async preloadInitialQuizzesBasedOnSavedRange() {
        for (const grade of ['1y', '2y', '3y']) {
            if (!learningMode.state.isWordListReady[grade]) {
                try { await learningMode.loadWordList(false, grade); } catch(e) { continue; }
            }
            if (!learningMode.state.isWordListReady[grade]) continue;
            let startValue = 1;
            let endValue = learningMode.state.wordList[grade]?.length || 1;
             try {
                 const savedStart = localStorage.getItem(app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START(grade));
                 const savedEnd = localStorage.getItem(app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END(grade));
                 const totalWords = learningMode.state.wordList[grade]?.length || 1;
                 if (savedStart !== null) {
                     const parsedStart = parseInt(savedStart);
                     if (!isNaN(parsedStart) && parsedStart >= 1 && parsedStart <= totalWords) startValue = parsedStart;
                 }
                 if (savedEnd !== null) {
                     const parsedEnd = parseInt(savedEnd);
                     if (!isNaN(parsedEnd) && parsedEnd >= 1 && parsedEnd <= totalWords) endValue = parsedEnd;
                 }
             } catch(e) { console.warn(`Error reading saved range for ${grade} initial preload:`, e); }
            for (const type of ['MULTIPLE_CHOICE_MEANING', 'FILL_IN_THE_BLANK', 'MULTIPLE_CHOICE_DEFINITION']) {
                this.preloadNextQuiz(grade, type, null, { start: startValue, end: endValue });
            }
        }
    },
    async preloadNextQuiz(grade, type, wordToExclude = null, rangeOverride = null) {
        if (!grade || !type || this.state.isPreloading[grade]?.[type] || this.state.preloadedQuizzes[grade]?.[type]) {
            return;
        }
        if (!this.state.isPreloading[grade]) this.state.isPreloading[grade] = {};
        this.state.isPreloading[grade][type] = true;
        try {
            const quiz = await this._generateSingleQuizForPreload(grade, type, wordToExclude, rangeOverride);
            if (quiz) {
                if (!this.state.preloadedQuizzes[grade]) this.state.preloadedQuizzes[grade] = {};
                 this.state.preloadedQuizzes[grade][type] = quiz;
            }
        } catch(e) {
            console.error(`Preloading ${grade}-${type} failed:`, e);
        } finally {
            if (this.state.isPreloading[grade]) this.state.isPreloading[grade][type] = false;
        }
    },
    async _generateSingleQuizForPreload(grade, quizType, wordToExclude = null, rangeOverride = null) {
        const allWords = learningMode.state.wordList[grade] || [];
        if (allWords.length === 0) return null;
        let startVal, endVal;
        if (rangeOverride) {
            startVal = rangeOverride.start;
            endVal = rangeOverride.end;
        } else {
             startVal = parseInt(this.elements.quizRangeStart.textContent) || 1;
             endVal = parseInt(this.elements.quizRangeEnd.textContent) || allWords.length;
        }
        const startNum = Math.min(startVal, endVal);
        const endNum = Math.max(startVal, endVal);
        const startIndex = Math.max(0, startNum - 1);
        const endIndex = Math.min(allWords.length - 1, endNum - 1);
        const wordsInRange = allWords.slice(startIndex, endIndex + 1);
        if (wordsInRange.length === 0) return null;
        let localUpdates = {};
        try {
            const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES(grade);
            localUpdates = JSON.parse(localStorage.getItem(key) || '{}');
        } catch(e) { console.warn(`Error reading local progress for ${grade} preload:`, e); }
        const learnedWordsInType = utils.getCorrectlyAnsweredWords(quizType, grade);
        let candidates = wordsInRange.filter(wordObj => {
            const word = wordObj.word;
            if (word === wordToExclude) return false;
            if (this.state.answeredWords.has(word)) return false;
            if (this.state.isPracticeMode) return true;
            const serverStatus = app.state.currentProgress[word]?.[quizType];
            const localStatus = localUpdates[word]?.[quizType];
            const finalStatus = localStatus !== undefined ? localStatus : serverStatus;
            return finalStatus !== 'correct';
        });
        if (quizType === 'FILL_IN_THE_BLANK') {
            candidates = candidates.filter(word => {
                if (!word.sample || word.sample.trim() === '') return false;
                const firstLine = word.sample.split('\n')[0];
                const placeholderRegex = /\*(.*?)\*/;
                const wordRegex = new RegExp(`\\b${word.word}\\b`, 'i');
                return placeholderRegex.test(firstLine) || wordRegex.test(firstLine);
            });
        }
        if (candidates.length === 0) return null;
        candidates.sort(() => 0.5 - Math.random());
        const usableAllWordsForChoices = allWords.length >= 4 ? allWords : [...allWords, {word: 'dummy1', meaning: '오답1'}, {word: 'dummy2', meaning: '오답2'}, {word: 'dummy3', meaning: '오답3'}];
        const wordData = candidates[0];
        let quiz = null;
        if (quizType === 'MULTIPLE_CHOICE_MEANING') quiz = this.createMeaningQuiz(wordData, usableAllWordsForChoices);
        else if (quizType === 'FILL_IN_THE_BLANK') quiz = this.createBlankQuiz(wordData, usableAllWordsForChoices);
        else if (quizType === 'MULTIPLE_CHOICE_DEFINITION') {
             const definition = await api.fetchDefinition(wordData.word);
             if (definition) quiz = this.createDefinitionQuiz(wordData, usableAllWordsForChoices, definition);
        }
        return quiz;
    },
    createMeaningQuiz(correctWordData, allWordsData) {
        const wrongAnswers = new Set();
        let candidates = allWordsData.filter(w => w.word !== correctWordData.word && w.meaning !== correctWordData.meaning);
        utils.shuffleArray(candidates);
        candidates.slice(0, 3).forEach(w => wrongAnswers.add(w.meaning));
        while (wrongAnswers.size < 3 && allWordsData.length > 4) {
            const randomWord = allWordsData[Math.floor(Math.random() * allWordsData.length)];
            if (randomWord.word !== correctWordData.word && randomWord.meaning !== correctWordData.meaning && !wrongAnswers.has(randomWord.meaning)) wrongAnswers.add(randomWord.meaning);
        }
        if(wrongAnswers.size < 3) return null;
        const choices = [correctWordData.meaning, ...Array.from(wrongAnswers)];
        utils.shuffleArray(choices);
        return { type: 'MULTIPLE_CHOICE_MEANING', question: { word: correctWordData.word }, choices, answer: correctWordData.meaning };
    },
    createBlankQuiz(correctWordData, allWordsData) {
        if (!correctWordData.sample || correctWordData.sample.trim() === '') return null;
        const firstLineSentence = correctWordData.sample.split('\n')[0];
        let sentenceWithBlank = "";
        const placeholderRegex = /\*(.*?)\*/;
        const wordRegex = new RegExp(`\\b${correctWordData.word}\\b`, 'i');
        const match = firstLineSentence.match(placeholderRegex);
        if (match) {
            sentenceWithBlank = firstLineSentence.replace(placeholderRegex, "＿＿＿＿").trim();
        } else if (firstLineSentence.match(wordRegex)) {
            sentenceWithBlank = firstLineSentence.replace(wordRegex, "＿＿＿＿").trim();
        } else {
            return null;
        }
        const wrongAnswers = new Set();
        let candidates = allWordsData.filter(w => w.word !== correctWordData.word);
        utils.shuffleArray(candidates);
        candidates.slice(0, 3).forEach(w => wrongAnswers.add(w.word));
        while (wrongAnswers.size < 3 && allWordsData.length > 4) {
            const randomWord = allWordsData[Math.floor(Math.random() * allWordsData.length)];
            if (randomWord.word !== correctWordData.word && !wrongAnswers.has(randomWord.word)) wrongAnswers.add(randomWord.word);
        }
        if(wrongAnswers.size < 3) return null;
        const choices = [correctWordData.word, ...Array.from(wrongAnswers)];
        utils.shuffleArray(choices);
        return { type: 'FILL_IN_THE_BLANK', question: { sentence_with_blank: sentenceWithBlank, word: correctWordData.word }, choices, answer: correctWordData.word };
    },
    createDefinitionQuiz(correctWordData, allWordsData, definition) {
        if (!definition) return null;
        const wrongAnswers = new Set();
        let candidates = allWordsData.filter(w => w.word !== correctWordData.word);
        utils.shuffleArray(candidates);
        candidates.slice(0, 3).forEach(w => wrongAnswers.add(w.word));
        while (wrongAnswers.size < 3 && allWordsData.length > 4) {
            const randomWord = allWordsData[Math.floor(Math.random() * allWordsData.length)];
            if (randomWord.word !== correctWordData.word && !wrongAnswers.has(randomWord.word)) wrongAnswers.add(randomWord.word);
        }
        if(wrongAnswers.size < 3) return null;
        const choices = [correctWordData.word, ...Array.from(wrongAnswers)];
        utils.shuffleArray(choices);
        return { type: 'MULTIPLE_CHOICE_DEFINITION', question: { definition, word: correctWordData.word }, choices, answer: correctWordData.word };
    },
    showLoader(isLoading, message = "퀴즈 데이터를 불러오는 중...") {
        this.elements.loader.classList.toggle('hidden', !isLoading);
        this.elements.loaderText.textContent = message;
        this.elements.quizSelectionScreen.classList.add('hidden');
        this.elements.contentContainer.classList.toggle('hidden', isLoading);
        this.elements.finishedScreen.classList.add('hidden');
    },
    showFinishedScreen(message) {
        this.showLoader(false);
        this.elements.contentContainer.classList.add('hidden');
        this.elements.finishedScreen.classList.remove('hidden');
        this.elements.finishedMessage.textContent = message;
    },
};
const learningMode = {
     state: {
        wordList: { '1y': [], '2y': [], '3y': [] },
        isWordListReady: { '1y': false, '2y': false, '3y': false },
        currentIndex: 0,
        isMistakeMode: false,
        isFavoriteMode: false,
        touchstartX: 0, touchstartY: 0,
        currentDisplayList: [],
        isDragging: false,
    },
    elements: {},
    init() {
        this.elements = {
            startScreen: document.getElementById('learning-start-screen'),
            startInputContainer: document.getElementById('learning-start-input-container'),
            startWordInput: document.getElementById('learning-start-word-input'),
            startBtn: document.getElementById('learning-start-btn'),
            suggestionsContainer: document.getElementById('learning-suggestions-container'),
            suggestionsTitle: document.getElementById('learning-suggestions-title'),
            suggestionsVocabList: document.getElementById('learning-suggestions-vocab-list'),
            suggestionsExplanationList: document.getElementById('learning-suggestions-explanation-list'),
            backToStartBtn: document.getElementById('learning-back-to-start-btn'),
            loader: document.getElementById('learning-loader'),
            loaderText: document.getElementById('learning-loader-text'),
            appContainer: document.getElementById('learning-app-container'),
            cardBack: document.getElementById('learning-card-back'),
            wordDisplay: document.getElementById('word-display'),
            meaningDisplay: document.getElementById('meaning-display'),
            explanationDisplay: document.getElementById('explanation-display'),
            explanationContainer: document.getElementById('explanation-container'),
            fixedButtons: document.getElementById('learning-fixed-buttons'),
            nextBtn: document.getElementById('next-btn'),
            prevBtn: document.getElementById('prev-btn'),
            sampleBtn: document.getElementById('sample-btn'),
            sampleBtnImg: document.getElementById('sample-btn-img'),
            backTitle: document.getElementById('learning-back-title'),
            backContent: document.getElementById('learning-back-content'),
            progressBarTrack: document.getElementById('progress-bar-track'),
            progressBarFill: document.getElementById('progress-bar-fill'),
            progressBarHandle: document.getElementById('progress-bar-handle'),
            progressBarNumber: document.getElementById('progress-bar-number'),
            favoriteBtn: document.getElementById('favorite-btn'),
            favoriteIcon: document.getElementById('favorite-icon'),
        };
        this.bindEvents();
    },
    handleMiddleClick(e) { if (learningMode.isLearningModeActive() && e.button === 1) { e.preventDefault(); learningMode.elements.sampleBtn.click(); } },
    handleKeyDown(e) {
        if (!learningMode.isLearningModeActive() || document.activeElement.tagName.match(/INPUT|TEXTAREA/)) return;
        activityTracker.recordActivity();
        const keyMap = { 'ArrowLeft': -1, 'ArrowRight': 1, 'ArrowUp': 1, 'ArrowDown': -1 };
        if (keyMap[e.key] !== undefined) { e.preventDefault(); learningMode.navigate(keyMap[e.key]); }
        else if (e.key === 'Enter') { e.preventDefault(); learningMode.handleFlip(); }
        else if (e.key === ' ') { e.preventDefault(); if (!learningMode.elements.cardBack.classList.contains('is-slid-up')) api.speak(learningMode.elements.wordDisplay.textContent); }
    },
    handleTouchStart(e) {
        if (!learningMode.isLearningModeActive() || e.target.closest('.interactive-word, #word-display, #favorite-btn, #progress-bar-track, #sample-btn, #prev-btn, #next-btn')) return;
        learningMode.state.touchstartX = e.changedTouches[0].screenX; learningMode.state.touchstartY = e.changedTouches[0].screenY;
    },
    handleTouchEnd(e) {
        if (!learningMode.isLearningModeActive() || learningMode.state.touchstartX === 0 || e.target.closest('button, a, input, [onclick], #progress-bar-track')) { learningMode.state.touchstartX = learningMode.state.touchstartY = 0; return; }
        const deltaX = e.changedTouches[0].screenX - learningMode.state.touchstartX;
        const deltaY = e.changedTouches[0].screenY - learningMode.state.touchstartY;
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) learningMode.navigate(deltaX > 0 ? -1 : 1);
        learningMode.state.touchstartX = learningMode.state.touchstartY = 0;
    },
    bindModeEvents() {
        this.elements.nextBtn.addEventListener('click', this.navigate.bind(this, 1));
        this.elements.prevBtn.addEventListener('click', this.navigate.bind(this, -1));
        this.elements.sampleBtn.addEventListener('click', this.handleFlip.bind(this));
        this.elements.favoriteBtn.addEventListener('click', this.toggleFavorite.bind(this));
        this.elements.wordDisplay.addEventListener('click', this.wordDisplaySpeak.bind(this));
        this.elements.wordDisplay.addEventListener('contextmenu', this.wordDisplayContextMenu.bind(this));
        this.elements.wordDisplay.addEventListener('touchstart', this.wordDisplayTouchStart.bind(this), { passive: true });
        this.elements.wordDisplay.addEventListener('touchmove', this.wordDisplayTouchMove.bind(this));
        this.elements.wordDisplay.addEventListener('touchend', this.wordDisplayTouchEnd.bind(this));
        this.elements.progressBarTrack.addEventListener('mousedown', this.handleProgressBarInteraction.bind(this));
        document.addEventListener('mousemove', this.handleProgressBarInteraction.bind(this));
        document.addEventListener('mouseup', this.handleProgressBarInteraction.bind(this));
        this.elements.progressBarTrack.addEventListener('touchstart', this.handleProgressBarInteraction.bind(this), { passive: false });
        document.addEventListener('touchmove', this.handleProgressBarInteraction.bind(this));
        document.addEventListener('touchend', this.handleProgressBarInteraction.bind(this));

        document.addEventListener('mousedown', this.handleMiddleClick.bind(this));
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        document.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        document.addEventListener('touchend', this.handleTouchEnd.bind(this));
    },
    unbindModeEvents() {
        this.elements.nextBtn.removeEventListener('click', this.navigate.bind(this, 1));
        this.elements.prevBtn.removeEventListener('click', this.navigate.bind(this, -1));
        this.elements.sampleBtn.removeEventListener('click', this.handleFlip.bind(this));
        this.elements.favoriteBtn.removeEventListener('click', this.toggleFavorite.bind(this));
        this.elements.wordDisplay.removeEventListener('click', this.wordDisplaySpeak.bind(this));
        this.elements.wordDisplay.removeEventListener('contextmenu', this.wordDisplayContextMenu.bind(this));
        this.elements.wordDisplay.removeEventListener('touchstart', this.wordDisplayTouchStart.bind(this));
        this.elements.wordDisplay.removeEventListener('touchmove', this.wordDisplayTouchMove.bind(this));
        this.elements.wordDisplay.removeEventListener('touchend', this.wordDisplayTouchEnd.bind(this));
        this.elements.progressBarTrack.removeEventListener('mousedown', this.handleProgressBarInteraction.bind(this));
        document.removeEventListener('mousemove', this.handleProgressBarInteraction.bind(this));
        document.removeEventListener('mouseup', this.handleProgressBarInteraction.bind(this));
        this.elements.progressBarTrack.removeEventListener('touchstart', this.handleProgressBarInteraction.bind(this));
        document.removeEventListener('touchmove', this.handleProgressBarInteraction.bind(this));
        document.removeEventListener('touchend', this.handleProgressBarInteraction.bind(this));

        document.removeEventListener('mousedown', this.handleMiddleClick.bind(this));
        document.removeEventListener('keydown', this.handleKeyDown.bind(this));
        document.removeEventListener('touchstart', this.handleTouchStart.bind(this));
        document.removeEventListener('touchend', this.handleTouchEnd.bind(this));
    },
    wordDisplaySpeak() {
        const word = this.state.currentDisplayList[this.state.currentIndex]?.word;
        if (word) { api.speak(word); }
    },
    wordDisplayContextMenu(e) {
        e.preventDefault();
        const wordData = this.state.currentDisplayList[this.state.currentIndex];
        if(wordData) ui.showWordContextMenu(e, wordData.word);
    },
    wordDisplayTouchStart(e) {
        this.state.wordDisplayTouchMove = false; 
        clearTimeout(app.state.longPressTimer); 
        app.state.longPressTimer = setTimeout(() => { 
            const wordData = this.state.currentDisplayList[this.state.currentIndex]; 
            if (!this.state.wordDisplayTouchMove && wordData) {
                ui.showWordContextMenu(e, wordData.word);
            }
        }, 700);
    },
    wordDisplayTouchMove() { 
        this.state.wordDisplayTouchMove = true; 
        clearTimeout(app.state.longPressTimer); 
    },
    wordDisplayTouchEnd() { 
        clearTimeout(app.state.longPressTimer); 
    },
    bindEvents() {
        this.elements.startBtn.addEventListener('click', () => this.start());
        this.elements.startWordInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.start(); });
        this.elements.startWordInput.addEventListener('input', e => {
            const originalValue = e.target.value;
            const sanitizedValue = originalValue.replace(/[^a-zA-Z\s'-]/g, '');
            if (originalValue !== sanitizedValue) app.showImeWarning();
            e.target.value = sanitizedValue;
        });
        this.elements.backToStartBtn.addEventListener('click', () => this.resetStartScreen());
    },
    async loadWordList(force = false, grade = app.state.selectedSheet) {
        if (!grade) return;
        if (!force && this.state.isWordListReady[grade]) return;
        const cacheKey = `wordListCache_${grade}`;
        const timestampKey = app.state.LOCAL_STORAGE_KEYS.CACHE_TIMESTAMP(grade);
        const versionKey = app.state.LOCAL_STORAGE_KEYS.CACHE_VERSION(grade);
        let forceRefreshDueToVersion = false;
        if (!force) {
            try {
                const versionRef = ref(rt_db, `app_config/vocab_version_${grade}`);
                const snapshot = await get(versionRef);
                const remoteVersion = snapshot.val() || 0;
                const localVersion = parseInt(localStorage.getItem(versionKey) || '0');
                if (remoteVersion > localVersion) {
                    forceRefreshDueToVersion = true;
                }
            } catch (e) {
                console.error("버전 확인 중 오류 발생:", e);
                forceRefreshDueToVersion = true;
            }
        }
        const shouldForceRefresh = force || forceRefreshDueToVersion;
        if (shouldForceRefresh) {
            try {
                localStorage.removeItem(cacheKey);
                localStorage.removeItem(timestampKey);
                localStorage.removeItem(versionKey);
            } catch(e) {}
            this.state.isWordListReady[grade] = false;
        }
        try {
            const cachedData = localStorage.getItem(cacheKey);
            const savedTimestamp = localStorage.getItem(timestampKey);
            if (!shouldForceRefresh && cachedData && savedTimestamp) {
                const { words } = JSON.parse(cachedData);
                this.state.wordList[grade] = words.sort((a, b) => a.id - b.id);
                this.state.isWordListReady[grade] = true;
                app.state.lastCacheTimestamp[grade] = parseInt(savedTimestamp);
                app.updateLastUpdatedText();
                return;
            }
        } catch (e) {
            console.warn("Error reading or parsing word list cache:", e);
            try {
                localStorage.removeItem(cacheKey);
                localStorage.removeItem(timestampKey);
                localStorage.removeItem(versionKey);
            } catch(e2) {}
        }
        try {
            const dbRef = ref(rt_db, `${grade}/vocabulary`);
            const snapshot = await get(dbRef);
            const data = snapshot.val();
            if (!data) throw new Error(`Firebase에 '${grade}' 단어 데이터가 없습니다.`);
            const wordsArray = Object.values(data).sort((a, b) => a.id - b.id);
            this.state.wordList[grade] = wordsArray;
            this.state.isWordListReady[grade] = true;
            const timestampRef = ref(rt_db, `app_config/vocab_timestamp_${grade}`);
            const timestampSnapshot = await get(timestampRef);
            const newTimestamp = timestampSnapshot.val() || Date.now();
            const versionRef = ref(rt_db, `app_config/vocab_version_${grade}`);
            const versionSnapshot = await get(versionRef);
            const currentRemoteVersion = versionSnapshot.val() || 1;
            const cachePayload = { words: wordsArray };
             try {
                localStorage.setItem(cacheKey, JSON.stringify(cachePayload));
                localStorage.setItem(timestampKey, newTimestamp.toString());
                app.state.lastCacheTimestamp[grade] = newTimestamp;
                localStorage.setItem(versionKey, currentRemoteVersion.toString());
                app.updateLastUpdatedText();
             } catch(e) { console.error("Error saving word list cache:", e); }
        } catch (error) {
            this.showError(error.message);
            throw error;
        }
    },
    async start() {
        activityTracker.recordActivity();
        const grade = app.state.selectedSheet;
        if (!this.state.isWordListReady[grade]) {
            this.elements.loaderText.textContent = "단어 목록을 동기화하는 중...";
            this.elements.loader.classList.remove('hidden');
            this.elements.startScreen.classList.add('hidden');
            await this.loadWordList(false, grade);
            this.elements.loader.classList.add('hidden');
            this.elements.startScreen.classList.remove('hidden');
            if (!this.state.isWordListReady[grade]) return;
        }
        this.state.isMistakeMode = false;
        this.state.isFavoriteMode = false;
        const currentWordList = this.state.wordList[grade];
        const startWord = this.elements.startWordInput.value.trim().toLowerCase();
        if (!startWord) {
            this.elements.startScreen.classList.add('hidden');
            try {
                const key = app.state.LOCAL_STORAGE_KEYS.LAST_INDEX(grade);
                const savedIndex = parseInt(localStorage.getItem(key) || '0');
                this.state.currentIndex = (savedIndex >= 0 && savedIndex < currentWordList.length) ? savedIndex : 0;
            } catch(e) {
                this.state.currentIndex = 0;
            }
            this.launchApp(currentWordList);
            return;
        }
        const exactMatchIndex = currentWordList.findIndex(item => item.word.toLowerCase() === startWord);
        if (exactMatchIndex !== -1) {
            this.elements.startScreen.classList.add('hidden');
            this.state.currentIndex = exactMatchIndex;
            this.launchApp(currentWordList);
            return;
        }
        const searchRegex = new RegExp(`\\b${startWord}\\b`, 'i');
        const explanationMatches = currentWordList
            .map((item, index) => ({ word: item.word, index }))
            .filter((item, index) => {
                const explanation = currentWordList[index].explanation;
                if (!explanation) return false;
                const cleanedExplanation = explanation.replace(/\[.*?\]/g, '');
                return searchRegex.test(cleanedExplanation);
            });
        const levenshteinSuggestions = currentWordList
            .map((item, index) => ({
                word: item.word, index,
                distance: levenshteinDistance(startWord, item.word.toLowerCase())
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 5)
            .filter(s => s.distance < s.word.length / 2 + 1);
        if (levenshteinSuggestions.length > 0 || explanationMatches.length > 0) {
            const title = `<strong>'${startWord}'</strong>(을)를 찾을 수 없습니다. 혹시 이 단어인가요?`;
            this.displaySuggestions(levenshteinSuggestions, explanationMatches, currentWordList, title);
        } else {
            const title = `<strong>'${startWord}'</strong>에 대한 검색 결과가 없습니다.`;
            this.displaySuggestions([], [], currentWordList, title);
        }
    },
    async startMistakeReview(mistakeWordsFromQuiz) {
        this.state.isMistakeMode = true;
        this.state.isFavoriteMode = false;
        const grade = app.state.selectedSheet;
        if (!this.state.isWordListReady[grade]) { await this.loadWordList(false, grade); if (!this.state.isWordListReady[grade]) return; }
        const incorrectWords = mistakeWordsFromQuiz || utils.getIncorrectWords();
        if (incorrectWords.length === 0) {
            app.showToast("오답 노트에 단어가 없습니다!", false);
            app.navigateTo('mode', grade);
            return;
        }
        const mistakeWordList = this.state.wordList[grade].filter(wordObj => incorrectWords.includes(wordObj.word));
        this.state.currentIndex = 0;
        this.launchApp(mistakeWordList);
    },
    async startFavoriteReview() {
        this.state.isMistakeMode = false;
        this.state.isFavoriteMode = true;
        const grade = app.state.selectedSheet;
        if (!this.state.isWordListReady[grade]) { await this.loadWordList(false, grade); if (!this.state.isWordListReady[grade]) return; }
        const favoriteWords = utils.getFavoriteWords();
        if (favoriteWords.length === 0) {
            app.showToast("즐겨찾기에 등록된 단어가 없습니다!", false);
            app.navigateTo('mode', grade);
            return;
        }
        const favoriteWordList = favoriteWords.map(word => this.state.wordList[grade].find(wordObj => wordObj.word === word)).filter(Boolean);
        this.state.currentIndex = 0;
        this.launchApp(favoriteWordList);
    },
    displaySuggestions(vocabSuggestions, explanationSuggestions, sourceList, title) {
        this.elements.startInputContainer.classList.add('hidden');
        this.elements.suggestionsTitle.innerHTML = title;
        const populateList = (listElement, suggestions) => {
            listElement.innerHTML = '';
            if (suggestions.length === 0) {
                listElement.innerHTML = '<p class="text-gray-400 text-sm p-3">결과 없음</p>';
                return;
            }
            suggestions.forEach(({ word, index }) => {
                const btn = document.createElement('button');
                btn.className = 'w-full text-left bg-gray-100 hover:bg-gray-200 py-3 px-4 rounded-lg transition-colors';
                btn.textContent = word;
                btn.onclick = () => { this.state.currentIndex = index; this.launchApp(sourceList); };
                listElement.appendChild(btn);
            });
        };
        populateList(this.elements.suggestionsVocabList, vocabSuggestions);
        populateList(this.elements.suggestionsExplanationList, explanationSuggestions);
        this.elements.suggestionsContainer.classList.remove('hidden');
    },
    reset() {
        this.unbindModeEvents();
        this.elements.appContainer.classList.add('hidden');
        this.elements.loader.classList.add('hidden');
        this.elements.fixedButtons.classList.add('hidden');
        app.elements.progressBarContainer.classList.add('hidden');
        this.state.currentDisplayList = [];
    },
    resetStartScreen() {
        this.reset();
        this.elements.startScreen.classList.remove('hidden');
        this.elements.startInputContainer.classList.remove('hidden');
        this.elements.suggestionsContainer.classList.add('hidden');
        this.elements.startWordInput.value = '';
        this.elements.startWordInput.focus();
        if (app.state.selectedSheet) {
            this.loadWordList(false, app.state.selectedSheet);
        }
    },
    showError(message) {
        this.elements.loader.querySelector('.loader').style.display = 'none';
        this.elements.loaderText.innerHTML = `<p class="text-red-500 font-bold">오류 발생</p><p class="text-sm text-gray-600 mt-2 break-all">${message}</p>`;
    },
    launchApp(wordList) {
        this.state.currentDisplayList = wordList;
        app.elements.refreshBtn.classList.add('hidden');
        this.elements.startScreen.classList.add('hidden');
        this.elements.loader.classList.add('hidden');
        this.elements.appContainer.classList.remove('hidden');
        this.elements.fixedButtons.classList.remove('hidden');
        app.elements.progressBarContainer.classList.remove('hidden');
        this.bindModeEvents();
        this.displayWord(this.state.currentIndex);
    },
    async displayWord(index) {
        activityTracker.recordActivity();
        this.updateProgressBar(index);
        this.elements.cardBack.classList.remove('is-slid-up');
        const wordData = this.state.currentDisplayList[index];
        if (!wordData) return;
        if (!this.state.isMistakeMode && !this.state.isFavoriteMode) {
             try {
                const key = app.state.LOCAL_STORAGE_KEYS.LAST_INDEX(app.state.selectedSheet);
                localStorage.setItem(key, index);
            } catch (e) {
                console.error("Error saving last index to localStorage", e);
            }
        }
        this.elements.wordDisplay.textContent = wordData.word;
        ui.adjustFontSize(this.elements.wordDisplay);
        this.elements.meaningDisplay.innerHTML = wordData.meaning.replace(/\n/g, '<br>');
        ui.renderInteractiveText(this.elements.explanationDisplay, wordData.explanation);
        this.elements.explanationContainer.classList.toggle('hidden', !wordData.explanation || !wordData.explanation.trim());
        const hasSample = wordData.sample && wordData.sample.trim() !== '';
        const defaultImg = 'https://images.icon-icons.com/1055/PNG/128/19-add-cat_icon-icons.com_76695.png';
        const sampleImg = 'https://images.icon-icons.com/1055/PNG/128/14-delivery-cat_icon-icons.com_76690.png';
        const backImgUrl = 'https://images.icon-icons.com/1055/PNG/128/5-remove-cat_icon-icons.com_76681.png';
        this.elements.sampleBtnImg.src = this.elements.cardBack.classList.contains('is-slid-up') ? backImgUrl : (hasSample ? sampleImg : defaultImg);
        
        const grade = app.state.selectedSheet;
        let isFavorite = app.state.currentProgress[wordData.word]?.favorite || false;
        if (grade) {
            try {
                const key = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES(grade);
                const unsynced = JSON.parse(localStorage.getItem(key) || '{}');
                if (unsynced[wordData.word] && unsynced[wordData.word].favorite !== undefined) {
                    isFavorite = unsynced[wordData.word].favorite;
                }
            } catch (e) { console.warn("Error reading local favorite status:", e); }
        }
        this.updateFavoriteIcon(isFavorite);
    },
    updateFavoriteIcon(isFavorite) {
        const icon = this.elements.favoriteIcon;
        icon.classList.toggle('fill-current', isFavorite);
        icon.classList.toggle('text-yellow-400', isFavorite);
        icon.classList.toggle('text-gray-400', !isFavorite);
    },
    async toggleFavorite() {
        activityTracker.recordActivity();
        const wordData = this.state.currentDisplayList[this.state.currentIndex];
        if (!wordData) return;
        const isFavorite = await utils.toggleFavorite(wordData.word);
        this.updateFavoriteIcon(isFavorite);
        if (this.state.isFavoriteMode && !isFavorite) {
             this.state.currentDisplayList.splice(this.state.currentIndex, 1);
             if (this.state.currentDisplayList.length === 0) {
                 app.showToast("즐겨찾기 목록이 비었습니다.", false);
                 app.navigateTo('mode', app.state.selectedSheet);
                 return;
             }
             if(this.state.currentIndex >= this.state.currentDisplayList.length) {
                 this.state.currentIndex = this.state.currentDisplayList.length - 1;
             }
             this.displayWord(this.state.currentIndex);
        }
    },
    navigate(direction) {
        activityTracker.recordActivity();
        const isBackVisible = this.elements.cardBack.classList.contains('is-slid-up');
        const len = this.state.currentDisplayList.length;
        if (len === 0) return;
        const navigateAction = () => { this.state.currentIndex = (this.state.currentIndex + direction + len) % len; this.displayWord(this.state.currentIndex); };
        if (isBackVisible) { this.handleFlip(); setTimeout(navigateAction, 300); }
        else { navigateAction(); }
    },
    async handleFlip() {
        activityTracker.recordActivity();
        const isBackVisible = this.elements.cardBack.classList.contains('is-slid-up');
        const wordData = this.state.currentDisplayList[this.state.currentIndex];
        const hasSample = wordData && wordData.sample && wordData.sample.trim() !== '';
        const backImgUrl = 'https://images.icon-icons.com/1055/PNG/128/5-remove-cat_icon-icons.com_76681.png';
        const sampleImgUrl = 'https://images.icon-icons.com/1055/PNG/128/14-delivery-cat_icon-icons.com_76690.png';
        const noSampleImgUrl = 'https://images.icon-icons.com/1055/PNG/128/19-add-cat_icon-icons.com_76695.png';
        if (!isBackVisible) {
            if (!hasSample) { app.showNoSampleMessage(); return; }
            this.elements.backTitle.textContent = wordData.word;
            ui.displaySentences(wordData.sample.split('\n'), this.elements.backContent);
            this.elements.cardBack.classList.add('is-slid-up');
            this.elements.sampleBtnImg.src = backImgUrl;
        } else {
            this.elements.cardBack.classList.remove('is-slid-up');
            this.displayWord(this.state.currentIndex);
        }
    },
    isLearningModeActive() { return !this.elements.appContainer.classList.contains('hidden'); },
    updateProgressBar(index) {
        const total = this.state.currentDisplayList.length;
        if (total <= 1) {
            this.elements.progressBarFill.style.width = '100%';
            this.elements.progressBarHandle.style.left = '100%';
            if (this.elements.progressBarNumber) {
                this.elements.progressBarNumber.textContent = total > 0 ? '1' : '';
                this.elements.progressBarNumber.style.left = '100%';
            }
            return;
        }
        const percentage = (index / (total - 1)) * 100;
        this.elements.progressBarFill.style.width = `${percentage}%`;
        this.elements.progressBarHandle.style.left = `calc(${percentage}% - ${this.elements.progressBarHandle.offsetWidth / 2}px)`;
        if (this.elements.progressBarNumber) {
            this.elements.progressBarNumber.textContent = index + 1;
            this.elements.progressBarNumber.style.left = `${percentage}%`;
        }
    },
    handleProgressBarInteraction(e) {
        if (!this.isLearningModeActive()) return;
        const track = this.elements.progressBarTrack;
        const totalWords = this.state.currentDisplayList.length;
        if (totalWords <= 1) return;
        const handleInteraction = (clientX) => {
            activityTracker.recordActivity();
            const rect = track.getBoundingClientRect();
            const x = clientX - rect.left;
            const percentage = Math.max(0, Math.min(1, x / rect.width));
            const newIndex = Math.round(percentage * (totalWords - 1));
            if (newIndex !== this.state.currentIndex) {
                this.state.currentIndex = newIndex;
                this.displayWord(newIndex);
            }
        };
        switch (e.type) {
            case 'mousedown':
            case 'touchstart':
                e.preventDefault();
                this.state.isDragging = true;
                handleInteraction(e.type === 'touchstart' ? e.touches[0].clientX : e.clientX);
                break;
            case 'mousemove':
            case 'touchmove':
                if (this.state.isDragging) {
                    handleInteraction(e.type === 'touchmove' ? e.touches[0].clientX : e.clientX);
                }
                break;
            case 'mouseup':
            case 'mouseleave':
            case 'touchend':
                this.state.isDragging = false;
                break;
        }
    },
};
function levenshteinDistance(a = '', b = '') {
    const track = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= a.length; i += 1) track[0][i] = i;
    for (let j = 0; j <= b.length; j += 1) track[j][0] = j;
    for (let j = 1; j <= b.length; j += 1) {
        for (let i = 1; i <= a.length; i += 1) {
            const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
            track[j][i] = Math.min(
                track[j][i - 1] + 1,
                track[j - 1][i] + 1,
                track[j - 1][i - 1] + indicator,
            );
        }
    }
    return track[b.length][a.length];
}
