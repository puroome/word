import { config, state } from './config.js';
import { utils, translationCache } from './utils.js';
import { api } from './api.js';
import { ui } from './ui.js';
import { learningMode } from './learning.js';
import { quizMode } from './quiz.js';
import { dashboard } from './dashboard.js';

const imageDBCache = {
  db: null,
  dbName: 'imageCacheDB',
  storeName: 'imageStore',
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
    } catch(e) { return url; }
  },
  getImage(key) {
    return new Promise(resolve => {
      if (!imageDBCache.db) return resolve(null);
      const request = imageDBCache.db.transaction(imageDBCache.storeName).objectStore(imageDBCache.storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  },
  saveImage(key, blob) {
    if (!imageDBCache.db) return;
    try {
      imageDBCache.db.transaction(imageDBCache.storeName, 'readwrite').objectStore(imageDBCache.storeName).put(blob, key);
    } catch(e) { console.error('Failed to save image to IndexedDB', e); }
  }
};

window.imageDBCache = imageDBCache;

const studyTracker = {
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
      if (now - this.lastActivityTimestamp < this.INACTIVITY_LIMIT) this.sessionSeconds += 1;
    }, 1000);
    this.saveInterval = setInterval(() => {
      if (this.sessionSeconds > 0) {
        try {
          const currentLocalTime = parseInt(localStorage.getItem(state.LOCALSTORAGEKEYS.UNSYNCEDTIME) || '0', 10);
          localStorage.setItem(state.LOCALSTORAGEKEYS.UNSYNCEDTIME, currentLocalTime + this.sessionSeconds);
          this.sessionSeconds = 0;
        } catch(e) { console.error(e); }
      }
    }, 10000);
    ['click', 'keydown', 'touchstart'].forEach(event => {
      document.body.addEventListener(event, this.recordActivity, true);
    });
  },
  stopAndSave() {
    if (!this.timerInterval) return;
    clearInterval(this.timerInterval);
    clearInterval(this.saveInterval);
    this.timerInterval = null;
    this.saveInterval = null;
    try {
      if (this.sessionSeconds > 0) {
        const currentLocalTime = parseInt(localStorage.getItem(state.LOCALSTORAGEKEYS.UNSYNCEDTIME) || '0', 10);
        localStorage.setItem(state.LOCALSTORAGEKEYS.UNSYNCEDTIME, currentLocalTime + this.sessionSeconds);
      }
    } catch(e) { console.error(e); }
    this.sessionSeconds = 0;
    ['click', 'keydown', 'touchstart'].forEach(event => {
      document.body.removeEventListener(event, this.recordActivity, true);
    });
  },
  recordActivity() {
    studyTracker.lastActivityTimestamp = Date.now();
  }
};

const app = {
  _toastTimeout: null,
  imeWarningTimeout: null,

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
  },

  init() {
    const startFirebaseApp = () => {
      const {
        initializeApp, getDatabase, getAuth, getFirestore,
        onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup
      } = window.firebaseSDK;
      const firebaseApp = initializeApp(config.FIREBASE_CONFIG);
      const database = getDatabase(firebaseApp);
      const auth = getAuth(firebaseApp);
      const db = getFirestore(firebaseApp);
      api.init(db, database);

      onAuthStateChanged(auth, async (user) => {
        if (user && user.email === config.ALLOWED_USER_EMAIL) {
          state.userId = user.uid;
          if (!state.isAppStarted) {
            const { doc, setDoc } = window.firebaseSDK;
            const userRef = doc(db, 'users', user.uid);
            await setDoc(userRef, { displayName: user.displayName, email: user.email }, { merge: true });
          }
          this.elements.loginScreen.classList.add('hidden');
          this.elements.appWrapper.classList.remove('hidden');
          if (!state.isAppStarted) await this.startApp();
        } else {
          this.elements.loginScreen.classList.remove('hidden');
          this.elements.appWrapper.classList.add('hidden');
          if (user) {
            signOut(auth);
            this.elements.loginError.textContent = '허가되지 않은 계정입니다.';
            setTimeout(() => { this.elements.loginError.textContent = ''; }, 3000);
          }
        }
      });

      this.bindGlobalEvents(auth, signInWithPopup, GoogleAuthProvider, signOut);
    };

    if (window.firebaseSDK) startFirebaseApp();
    else document.addEventListener('firebaseSDKLoaded', startFirebaseApp);
  },

  async startApp() {
    state.isAppStarted = true;
    try {
      const savedVoice = localStorage.getItem(state.LOCALSTORAGEKEYS.TTSVOICE);
      if (savedVoice) {
        state.currentVoiceSet = savedVoice;
        this.elements.ttsToggleText.textContent = savedVoice;
        this.elements.ttsToggleBtn.classList.toggle('bg-indigo-700', savedVoice === 'UK');
        this.elements.ttsToggleBtn.classList.toggle('hover:bg-indigo-800', savedVoice === 'UK');
        this.elements.ttsToggleBtn.classList.toggle('bg-red-500', savedVoice === 'US');
        this.elements.ttsToggleBtn.classList.toggle('hover:bg-red-600', savedVoice === 'US');
      }
      const savedPracticeMode = localStorage.getItem(state.LOCALSTORAGEKEYS.PRACTICEMODE);
      if (savedPracticeMode === 'true') {
        quizMode.state.isPracticeMode = true;
        this.elements.practiceModeCheckbox.checked = true;
      }
    } catch(e) { console.error('설정 로딩 오류:', e); }

    try {
      await Promise.all([translationCache.init(), imageDBCache.init()]);
    } catch(e) { console.error('캐시 초기화 실패:', e); }

    await this.syncOfflineData();

    try {
      await Promise.all([api.loadWordList(), api.loadUserProgress()]);
      this.updateLastUpdatedText();
    } catch(e) { return; }

    quizMode.init();
    learningMode.init();
    dashboard.init();
    quizMode.preloadAllQuizTypesBasedOnSavedRange();
    this.loadInitialImages();

    const initialMode = window.location.hash.replace('#', '') || 'selection';
    history.replaceState({ mode: initialMode, options: {} }, '', window.location.href);
    this.renderMode(initialMode);
  },

  bindGlobalEvents(auth, signInWithPopup, GoogleAuthProvider, signOut) {
    this.elements.googleLoginBtn.addEventListener('click', async () => {
      const provider = new GoogleAuthProvider();
      this.elements.loginError.textContent = '';
      try {
        await signInWithPopup(auth, provider);
      } catch(error) {
        if (error.code !== 'auth/popup-closed-by-user') {
          this.elements.loginError.textContent = 'Google 로그인에 실패했습니다.';
        }
      }
    });
    this.elements.logoutBtn.addEventListener('click', () => signOut(auth));

    const unlockAudioContext = async () => {
      if (!state.audioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        state.audioContext = new AudioContext();
      }
      if (state.audioContext.state === 'suspended') {
        try { await state.audioContext.resume(); } catch(e) { console.error('Audio unlock failed', e); }
      }
      ['click', 'touchstart', 'keydown'].forEach(event => {
        document.body.removeEventListener(event, unlockAudioContext, { capture: true });
      });
    };
    ['click', 'touchstart', 'keydown'].forEach(event => {
      document.body.addEventListener(event, unlockAudioContext, { capture: true, once: true });
    });

    this.elements.selectQuizBtn.addEventListener('click', () => this.navigateTo('quiz'));
    this.elements.selectLearningBtn.addEventListener('click', () => this.navigateTo('learning'));
    this.elements.selectDashboardBtn.addEventListener('click', () => this.navigateTo('dashboard'));
    this.elements.selectFavoritesBtn.addEventListener('click', () => this.navigateTo('favorites'));
    this.elements.selectMistakesBtn.addEventListener('click', async () => {
      const allWords = state.wordList;
      const mistakeWords = allWords
        .filter(wordObj => utils.getWordStatus(wordObj.word) === 'review')
        .map(wordObj => wordObj.word);
      if (mistakeWords.length === 0) { this.showToast('오답 단어가 없습니다.', true); return; }
      this.navigateTo('mistakeReview', { mistakeWords });
    });
    this.elements.homeBtn.addEventListener('click', () => this.navigateTo('selection'));
    this.elements.refreshBtn.addEventListener('click', () => this.forceReload());
    this.elements.ttsToggleBtn.addEventListener('click', () => this.toggleVoiceSet());
    this.elements.practiceModeCheckbox.addEventListener('change', e => {
      quizMode.state.isPracticeMode = e.target.checked;
      try {
        localStorage.setItem(state.LOCALSTORAGEKEYS.PRACTICEMODE, quizMode.state.isPracticeMode);
      } catch(err) { console.error(err); }
      if (history.state?.mode === 'quiz-play') { quizMode.reset(false); quizMode.displayNextQuiz(); }
    });

    document.addEventListener('click', e => {
      if (this.elements.wordContextMenu && !this.elements.wordContextMenu.contains(e.target)) {
        ui.hideWordContextMenu();
      }
    });

    window.addEventListener('popstate', e => {
      this.syncOfflineData();
      const mode = e.state?.mode || 'selection';
      const options = e.state?.options;
      this.renderMode(mode, options);
    });

    document.addEventListener('contextmenu', e => {
      const target = e.target;
      const isInteractiveTrigger = target.closest('.interactive-word, #word-display');
      const isCustomContextMenu = target.closest('#word-context-menu, #edit-context-menu, #card-context-menu');
      const isEditTrigger = target.closest('#meaning-container, #explanation-container');
      if (!isInteractiveTrigger && !isCustomContextMenu && !isEditTrigger) e.preventDefault();
    });

    window.addEventListener('beforeunload', () => studyTracker.stopAndSave());
    window.addEventListener('navigate', e => this.navigateTo(e.detail.mode, e.detail.options));
    window.addEventListener('showToast', e => this.showToast(e.detail.message, e.detail.isError));
    window.addEventListener('showImeWarning', () => this.showImeWarning());
    window.addEventListener('syncRequest', () => this.syncOfflineData());
    document.addEventListener('searchWord', e => this.searchWordInLearningMode(e.detail));
  },

  async syncOfflineData() {
    if (!state.userId) return;
    try {
      const timeKey = state.LOCALSTORAGEKEYS.UNSYNCEDTIME;
      const quizKey = state.LOCALSTORAGEKEYS.UNSYNCEDQUIZ;
      const progressKey = state.LOCALSTORAGEKEYS.UNSYNCEDPROGRESSUPDATES;
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
    } catch(error) { console.error('오프라인 데이터 동기화 실패:', error); }
  },

  navigateTo(mode, options = {}) {
    const currentState = history.state;
    if (currentState?.mode !== mode) this.syncOfflineData();
    if (currentState?.mode === mode &&
      JSON.stringify(currentState?.options) === JSON.stringify(options) &&
      !['learning', 'mistakeReview', 'favorites', 'quiz-play'].includes(mode)) return;
    const newPath = mode === 'selection'
      ? window.location.pathname + window.location.search
      : '#' + mode;
    history.pushState({ mode, options }, '', newPath);
    this.renderMode(mode, options);
  },

  async renderMode(mode, options = {}) {
    studyTracker.stopAndSave();
    if (this.elements.refreshBtn) this.elements.refreshBtn.classList.add('hidden');

    this.elements.selectionScreen.classList.add('hidden');
    this.elements.quizModeContainer.classList.add('hidden');
    this.elements.learningModeContainer.classList.add('hidden');
    this.elements.dashboardContainer.classList.add('hidden');
    this.elements.homeBtn.classList.add('hidden');
    this.elements.logoutBtn.classList.add('hidden');
    this.elements.ttsToggleBtn.classList.add('hidden');
    this.elements.progressBarContainer.classList.add('hidden');
    this.elements.practiceModeControl.classList.add('hidden');
    learningMode.elements.fixedButtons.classList.add('hidden');
    learningMode.elements.appContainer.classList.add('hidden');
    learningMode.elements.startScreen.classList.add('hidden');

    const showCommonButtons = () => {
      this.elements.homeBtn.classList.remove('hidden');
      this.elements.ttsToggleBtn.classList.remove('hidden');
    };

    if (['quiz-play', 'learning', 'mistakeReview', 'favorites'].includes(mode)) studyTracker.start();

    if (mode === 'quiz') {
      this.elements.homeBtn.classList.remove('hidden');
      this.elements.quizModeContainer.classList.remove('hidden');
      this.elements.practiceModeControl.classList.remove('hidden');
      quizMode.reset();
      await quizMode.updateRangeInputs();
    } else if (mode === 'quiz-play') {
      showCommonButtons();
      this.elements.quizModeContainer.classList.remove('hidden');
      this.elements.practiceModeControl.classList.remove('hidden');
      quizMode.reset(false);
      if (!state.isWordListReady) await api.loadWordList();
      quizMode.displayNextQuiz();
    } else if (mode === 'learning') {
      showCommonButtons();
      this.elements.learningModeContainer.classList.remove('hidden');
      if (options.startIndex !== undefined && options.startIndex !== -1) {
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
      dashboard.render();
    } else {
      this.elements.selectionScreen.classList.remove('hidden');
      this.elements.logoutBtn.classList.remove('hidden');
      if (this.elements.refreshBtn) this.elements.refreshBtn.classList.remove('hidden');
      quizMode.reset();
      learningMode.reset();
    }
  },

  async forceReload() {
    this.elements.globalLoader.classList.remove('hidden');
    const elementsToDisable = [
      this.elements.refreshBtn, this.elements.selectDashboardBtn,
      this.elements.selectMistakesBtn, this.elements.selectLearningBtn, this.elements.selectQuizBtn
    ];
    elementsToDisable.forEach(el => { if (el) el.classList.add('pointer-events-none', 'opacity-50'); });
    try {
      await api.loadWordList(true);
      await api.loadUserProgress();
      this.updateLastUpdatedText();
      this.showToast('단어 목록을 새로 불러왔습니다!');
    } catch(e) {
      this.showToast(e.message, true);
    } finally {
      elementsToDisable.forEach(el => { if (el) el.classList.remove('pointer-events-none', 'opacity-50'); });
      this.elements.globalLoader.classList.add('hidden');
    }
  },

  showToast(message, isError = false) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      document.body.appendChild(toast);
    }
    clearTimeout(this._toastTimeout);
    toast.textContent = message;
    toast.className = `fixed top-20 left-1/2 -translate-x-1/2 text-white py-2 px-5 rounded-lg shadow-xl z-[200] text-lg font-semibold transition-opacity ${isError ? 'bg-red-500' : 'bg-green-500'}`;
    toast.style.opacity = '1';
    this._toastTimeout = setTimeout(() => {
      toast.style.opacity = '0';
    }, 2500);
  },

  updateLastUpdatedText() {
    if (!this.elements.lastUpdatedText) return;
    if (state.lastCacheTimestamp) {
      const d = new Date(state.lastCacheTimestamp);
      const dateString = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      this.elements.lastUpdatedText.textContent = dateString;
      this.elements.lastUpdatedText.classList.remove('hidden');
    } else {
      this.elements.lastUpdatedText.textContent = '';
      this.elements.lastUpdatedText.classList.remove('hidden');
    }
  },

  toggleVoiceSet() {
    const btn = this.elements.ttsToggleBtn;
    btn.classList.toggle('is-flipped');
    setTimeout(() => {
      state.currentVoiceSet = state.currentVoiceSet === 'UK' ? 'US' : 'UK';
      this.elements.ttsToggleText.textContent = state.currentVoiceSet;
      btn.classList.toggle('bg-indigo-700', state.currentVoiceSet === 'UK');
      btn.classList.toggle('hover:bg-indigo-800', state.currentVoiceSet === 'UK');
      btn.classList.toggle('bg-red-500', state.currentVoiceSet === 'US');
      btn.classList.toggle('hover:bg-red-600', state.currentVoiceSet === 'US');
      try {
        localStorage.setItem(state.LOCALSTORAGEKEYS.TTSVOICE, state.currentVoiceSet);
      } catch(e) { console.error(e); }
    }, 250);
  },

  showImeWarning() {
    this.elements.imeWarning.classList.remove('hidden');
    clearTimeout(this.imeWarningTimeout);
    this.imeWarningTimeout = setTimeout(() => {
      this.elements.imeWarning.classList.add('hidden');
    }, 2000);
  },

  showFatalError(message) {
    const selectionDiv = this.elements.selectionScreen;
    selectionDiv.innerHTML = `
      <div class="p-8 text-center">
        <h1 class="text-3xl font-bold text-red-600 mb-4">앱 초기화 실패</h1>
        <p class="text-gray-700 mb-6">Firebase 연결에 실패했습니다.<br>네트워크를 확인해 주세요.</p>
        <div class="bg-red-50 text-red-700 p-4 rounded-lg text-left text-sm break-all">
          <p class="font-semibold">오류 내용</p>
          <p>${message}</p>
        </div>
      </div>`;
    this.elements.appWrapper.classList.remove('hidden');
    this.elements.selectionScreen.classList.remove('hidden');
    this.elements.quizModeContainer.classList.add('hidden');
    this.elements.learningModeContainer.classList.add('hidden');
  },

  async loadInitialImages() {
    const imageSelectors = [
      '#select-learning-btn img', '#select-quiz-btn img',
      '#start-meaning-quiz-btn img', '#start-blank-quiz-btn img', '#start-definition-quiz-btn img'
    ];
    for (const selector of imageSelectors) {
      const img = document.querySelector(selector);
      if (img) img.src = await imageDBCache.loadImage(img.src);
    }
  },

  searchWordInLearningMode(word) {
    if (!word) return;
    this.navigateTo('learning');
    setTimeout(() => {
      learningMode.elements.startWordInput.value = word;
      learningMode.start();
      ui.hideWordContextMenu();
    }, 10);
  },
};

app.init();
