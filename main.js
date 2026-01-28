import { config, LOCAL_STORAGE_KEYS } from "./config.js";
import { state } from "./state.js";
import { auth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, doc, db, setDoc, writeBatch } from "./firebase-init.js";
import { utils, studyTracker } from "./utils.js";
import { ui } from "./ui.js";
import { api } from "./api.js";
import { cache, imageDBCache, audioCache, translationCache } from "./cache.js";
import { dashboard } from "./dashboard.js";
import { quizMode } from "./quiz.js";
import { learningMode } from "./learning.js";

// Global elements binding
function bindGlobalElements() {
    state.elements = {
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
        progressBarTrack: document.getElementById('progress-bar-track'),
        progressBarFill: document.getElementById('progress-bar-fill'),
        progressBarHandle: document.getElementById('progress-bar-handle'),
        progressBarNumber: document.getElementById('progress-bar-number'),
        translationTooltip: document.getElementById('translation-tooltip'),
        lastUpdatedText: document.getElementById('last-updated-text'),
        practiceModeControl: document.getElementById('practice-mode-control'),
        practiceModeCheckbox: document.getElementById('practice-mode-checkbox'),
        favoriteIcon: document.getElementById('favorite-icon'), // Used in LearningMode but ref in state
    };
}

// Router Logic
function navigateTo(mode, options = {}) {
    const currentState = history.state || {};
    const currentMode = currentState.mode;
    const currentOptions = currentState.options || {};

    if (currentMode !== mode) {
        api.syncOfflineData();
    }

    if (currentMode === mode && JSON.stringify(currentOptions) === JSON.stringify(options) && !['learning', 'mistakeReview', 'favorites', 'quiz-play'].includes(mode)) return;

    const newPath = mode === 'selection'
        ? window.location.pathname + window.location.search
        : `#${mode}`;

    history.pushState({ mode, options }, '', newPath);
    _renderMode(mode, options);
}

// Expose navigation to window for sub-modules to avoid circular dependency
window.appNavigateTo = navigateTo;

async function _renderMode(mode, options = {}) {
    studyTracker.stopAndSave();
    state.elements.selectionScreen.classList.add('hidden');
    state.elements.quizModeContainer.classList.add('hidden');
    state.elements.learningModeContainer.classList.add('hidden');
    state.elements.dashboardContainer.classList.add('hidden');
    state.elements.homeBtn.classList.add('hidden');
    state.elements.logoutBtn.classList.add('hidden');
    state.elements.ttsToggleBtn.classList.add('hidden');
    state.elements.progressBarContainer.classList.add('hidden');
    state.elements.practiceModeControl.classList.add('hidden');
    
    // Learning Mode specific elements hiding
    if(learningMode.elements.fixedButtons) learningMode.elements.fixedButtons.classList.add('hidden');
    if(learningMode.elements.appContainer) learningMode.elements.appContainer.classList.add('hidden');
    if(learningMode.elements.startScreen) learningMode.elements.startScreen.classList.add('hidden');

    const showCommonButtons = () => {
        state.elements.homeBtn.classList.remove('hidden');
        state.elements.ttsToggleBtn.classList.remove('hidden');
    };

    if (mode === 'quiz-play' || mode === 'learning' || mode === 'mistakeReview' || mode === 'favorites') {
         studyTracker.start();
    }

    if (mode === 'quiz') {
        state.elements.homeBtn.classList.remove('hidden');
        state.elements.quizModeContainer.classList.remove('hidden');
        state.elements.practiceModeControl.classList.remove('hidden');
        quizMode.reset();
        await quizMode.updateRangeInputs();
    } else if (mode === 'quiz-play') {
        showCommonButtons();
        state.elements.quizModeContainer.classList.remove('hidden');
        state.elements.practiceModeControl.classList.remove('hidden');
        quizMode.reset(false);
        if (!state.isWordListReady) {
            await api.loadWordList();
        }
        quizMode.displayNextQuiz();
    } else if (mode === 'learning') {
        showCommonButtons();
        state.elements.learningModeContainer.classList.remove('hidden');
        if (options.startIndex !== undefined && options.startIndex > -1) {
            learningMode.state.isMistakeMode = false;
            learningMode.state.isFavoriteMode = false;
            learningMode.state.currentWordList = state.wordList;
            learningMode.state.currentIndex = options.startIndex;
            learningMode.launchApp();
        } else {
            state.elements.learningModeContainer.querySelector('#learning-start-screen').classList.remove('hidden');
            learningMode.resetStartScreen();
        }
    } else if (mode === 'mistakeReview') {
        showCommonButtons();
        state.elements.learningModeContainer.classList.remove('hidden');
        learningMode.startMistakeReview(options.mistakeWords);
    } else if (mode === 'favorites') {
        showCommonButtons();
        state.elements.learningModeContainer.classList.remove('hidden');
        learningMode.startFavoriteMode();
    } else if (mode === 'dashboard') {
        state.elements.homeBtn.classList.remove('hidden');
        state.elements.dashboardContainer.classList.remove('hidden');
        dashboard.render();
    } else {
        state.elements.selectionScreen.classList.remove('hidden');
        state.elements.logoutBtn.classList.remove('hidden');
        quizMode.reset();
        learningMode.reset();
    }
}

// App Logic
async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    state.elements.loginError.textContent = '';
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Google Sign-In failed:", error);
        if (error.code === 'auth/popup-closed-by-user') {
            state.elements.loginError.textContent = '로그인 팝업이 닫혔습니다.';
        } else {
            state.elements.loginError.textContent = 'Google 로그인 중 오류가 발생했습니다.';
        }
    }
}

function updateLastUpdatedText() {
    if (state.elements.lastUpdatedText && state.lastCacheTimestamp) {
        const d = new Date(state.lastCacheTimestamp);
        const dateString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        state.elements.lastUpdatedText.textContent = `최종 업데이트 : ${dateString}`;
        state.elements.lastUpdatedText.classList.remove('hidden');
    } else if (state.elements.lastUpdatedText) {
        state.elements.lastUpdatedText.textContent = '업데이트 정보 없음';
        state.elements.lastUpdatedText.classList.remove('hidden');
    }
}

function toggleVoiceSet() {
    const btn = state.elements.ttsToggleBtn;
    btn.classList.toggle('is-flipped');
    setTimeout(() => {
        state.currentVoiceSet = (state.currentVoiceSet === 'UK') ? 'US' : 'UK';
        state.elements.ttsToggleText.textContent = state.currentVoiceSet;
        btn.classList.toggle('bg-indigo-700', state.currentVoiceSet === 'UK');
        btn.classList.toggle('hover:bg-indigo-800', state.currentVoiceSet === 'UK');
        btn.classList.toggle('bg-red-500', state.currentVoiceSet === 'US');
        btn.classList.toggle('hover:bg-red-600', state.currentVoiceSet === 'US');

        try {
            localStorage.setItem(LOCAL_STORAGE_KEYS.TTS_VOICE, state.currentVoiceSet);
        } catch (e) {
            console.error("Error saving TTS settings to localStorage", e);
        }
    }, 250);
}

async function forceReload() {
    state.elements.globalLoader.classList.remove('hidden');
    const elementsToDisable = [
        state.elements.refreshBtn, state.elements.selectDashboardBtn, state.elements.selectMistakesBtn,
        state.elements.selectLearningBtn, state.elements.selectQuizBtn
    ];
    elementsToDisable.forEach(el => el.classList.add('pointer-events-none', 'opacity-50'));
    try {
        await api.loadWordList(true);
        await api.loadUserProgress();
        updateLastUpdatedText();
        ui.showToast('데이터를 성공적으로 새로고침했습니다!');
    } catch(e) {
        ui.showToast('데이터 새로고침에 실패했습니다: ' + e.message, true);
    } finally {
        elementsToDisable.forEach(el => el.classList.remove('pointer-events-none', 'opacity-50'));
        state.elements.globalLoader.classList.add('hidden');
    }
}

async function loadInitialImages() {
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
}

// Global Event Binding
function bindGlobalEvents() {
    const unlockAudioContext = async () => {
        if (!state.audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            state.audioContext = new AudioContext();
        }
        if (state.audioContext.state === 'suspended') {
            try { await state.audioContext.resume(); } catch (e) { console.error("Audio unlock failed", e); }
        }
        ['click', 'touchstart', 'keydown'].forEach(event => 
            document.body.removeEventListener(event, unlockAudioContext, { capture: true })
        );
    };

    ['click', 'touchstart', 'keydown'].forEach(event => 
        document.body.addEventListener(event, unlockAudioContext, { capture: true, once: true })
    );

    state.elements.selectQuizBtn.addEventListener('click', () => navigateTo('quiz'));
    state.elements.selectLearningBtn.addEventListener('click', () => navigateTo('learning'));
    state.elements.selectDashboardBtn.addEventListener('click', () => navigateTo('dashboard'));
    state.elements.selectFavoritesBtn.addEventListener('click', () => navigateTo('favorites'));

    state.elements.selectMistakesBtn.addEventListener('click', async () => {
        const allWords = state.wordList;
        const mistakeWords = allWords
            .filter(wordObj => utils.getWordStatus(wordObj.word) === 'review')
            .map(wordObj => wordObj.word);

        if (mistakeWords.length === 0) {
            ui.showToast('오답 노트에 단어가 없습니다.', true);
            return;
        }
        navigateTo('mistakeReview', { mistakeWords });
    });

    state.elements.homeBtn.addEventListener('click', () => navigateTo('selection'));
    state.elements.refreshBtn.addEventListener('click', () => forceReload());
    state.elements.ttsToggleBtn.addEventListener('click', toggleVoiceSet);
    
    state.elements.practiceModeCheckbox.addEventListener('change', (e) => {
        quizMode.state.isPracticeMode = e.target.checked;
        try {
            localStorage.setItem(LOCAL_STORAGE_KEYS.PRACTICE_MODE, quizMode.state.isPracticeMode);
        } catch (err) {
            console.error("Error saving practice mode state:", err);
        }
        if (history.state?.mode === 'quiz-play') {
             quizMode.reset(false);
             quizMode.displayNextQuiz();
        }
    });

    document.addEventListener('click', (e) => {
        if (state.elements.wordContextMenu && !state.elements.wordContextMenu.contains(e.target)) {
            ui.hideWordContextMenu();
        }
    });

    window.addEventListener('popstate', (e) => {
        api.syncOfflineData();
        const mode = e.state?.mode || 'selection';
        const options = e.state?.options || {};
        _renderMode(mode, options);
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
         api.syncOfflineData();
    });
    
    state.elements.googleLoginBtn.addEventListener('click', signInWithGoogle);
    state.elements.logoutBtn.addEventListener('click', () => signOut(auth));
}

// Function exposed for UI (Context Menu search)
window.searchWordInLearningMode = (word) => {
    if (!word) return;
    navigateTo('learning');
    setTimeout(() => {
        const input = document.getElementById('learning-start-word-input');
        if(input) {
            input.value = word;
            learningMode.start();
            ui.hideWordContextMenu();
        }
    }, 10);
};

async function startApp() {
    state.isAppStarted = true;

    try {
        const savedVoice = localStorage.getItem(LOCAL_STORAGE_KEYS.TTS_VOICE);
        if (savedVoice) {
            state.currentVoiceSet = savedVoice;
            state.elements.ttsToggleText.textContent = savedVoice;
            state.elements.ttsToggleBtn.classList.toggle('bg-indigo-700', savedVoice === 'UK');
            state.elements.ttsToggleBtn.classList.toggle('hover:bg-indigo-800', savedVoice === 'UK');
            state.elements.ttsToggleBtn.classList.toggle('bg-red-500', savedVoice === 'US');
            state.elements.ttsToggleBtn.classList.toggle('hover:bg-red-600', savedVoice === 'US');
        }

        const savedPracticeMode = localStorage.getItem(LOCAL_STORAGE_KEYS.PRACTICE_MODE);
        if (savedPracticeMode === 'true') {
            quizMode.state.isPracticeMode = true;
            state.elements.practiceModeCheckbox.checked = true;
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
    bindGlobalEvents();
    studyTracker.init();

    await api.syncOfflineData();

    try {
        await api.loadWordList();
        await api.loadUserProgress();
        updateLastUpdatedText();
    } catch (e) {
        return;
    }

    loadInitialImages();
    quizMode.init();
    learningMode.init();
    dashboard.init();

    quizMode.preloadAllQuizTypesBasedOnSavedRange();

    const initialMode = window.location.hash.replace('#', '') || 'selection';
    history.replaceState({ mode: initialMode, options: {} }, '', window.location.href);
    _renderMode(initialMode);
}

// Auth State Listener
onAuthStateChanged(auth, async (user) => {
    if (user && user.email === config.ALLOWED_USER_EMAIL) {
        state.userId = user.uid;
        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, {
            displayName: user.displayName,
            email: user.email
        }, { merge: true });

        // Ensure elements are bound before accessing them in Auth Logic
        if(Object.keys(state.elements).length === 0) bindGlobalElements();

        state.elements.loginScreen.classList.add('hidden');
        state.elements.appWrapper.classList.remove('hidden');
        if (!state.isAppStarted) {
            await startApp();
        }
    } else {
        if(Object.keys(state.elements).length === 0) bindGlobalElements();
        state.elements.loginScreen.classList.remove('hidden');
        state.elements.appWrapper.classList.add('hidden');
        if (user) {
            signOut(auth);
        }
    }
});

// Initial binding (will be run when script loads)
bindGlobalElements();