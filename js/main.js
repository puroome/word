import { config, state } from './config.js';
import { utils, translationCache, imageDBCache, audioCache } from './utils.js';
import { api } from './api.js';
import { ui } from './ui.js';
import { learningMode } from './learning.js';
import { quizMode } from './quiz.js';
import { dashboard } from './dashboard.js';

// #18 fix: 모듈 레벨 상수
const INACTIVITY_LIMIT = 30_000;

const studyTracker = {
  sessionSeconds: 0,
  lastActivityTimestamp: 0,
  timerInterval: null,
  saveInterval: null,

  start() {
    if (this.timerInterval) return;
    this.lastActivityTimestamp = Date.now();
    this.sessionSeconds = 0;
    this.timerInterval = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - this.lastActivityTimestamp < INACTIVITY_LIMIT) { // #18 fix
        this.sessionSeconds++;
      }
    }, 1000);
    this.saveInterval = setInterval(() => {
      if (this.sessionSeconds > 0) {
        try {
          const current = parseInt(localStorage.getItem(state.LOCALSTORAGEKEYS.UNSYNCEDTIME) || '0', 10);
          localStorage.setItem(state.LOCALSTORAGEKEYS.UNSYNCEDTIME, current + this.sessionSeconds);
          this.sessionSeconds = 0;
        } catch(e) { console.error(e); }
      }
    }, 10000);
    ['click', 'keydown', 'touchstart'].forEach(ev =>
      document.body.addEventListener(ev, this.recordActivity, true)
    );
  },

  stopAndSave() {
    if (!this.timerInterval) return;
    clearInterval(this.timerInterval);
    clearInterval(this.saveInterval);
    this.timerInterval = null;
    this.saveInterval  = null;
    try {
      if (this.sessionSeconds > 0) {
        const current = parseInt(localStorage.getItem(state.LOCALSTORAGEKEYS.UNSYNCEDTIME) || '0', 10);
        localStorage.setItem(state.LOCALSTORAGEKEYS.UNSYNCEDTIME, current + this.sessionSeconds);
      }
    } catch(e) { console.error(e); }
    this.sessionSeconds = 0;
    ['click', 'keydown', 'touchstart'].forEach(ev =>
      document.body.removeEventListener(ev, this.recordActivity, true)
    );
  },

  recordActivity() {
    studyTracker.lastActivityTimestamp = Date.now();
  },
};

const app = {
  elements: {
    loginScreen:          document.getElementById('login-screen'),
    googleLoginBtn:       document.getElementById('google-login-btn'),
    loginError:           document.getElementById('login-error'),
    logoutBtn:            document.getElementById('logout-btn'),
    appWrapper:           document.getElementById('app-wrapper'),
    selectionScreen:      document.getElementById('selection-screen'),
    homeBtn:              document.getElementById('home-btn'),
    refreshBtn:           document.getElementById('refresh-btn'),
    ttsToggleBtn:         document.getElementById('tts-toggle-btn'),
    ttsToggleText:        document.getElementById('tts-toggle-text'),
    quizModeContainer:    document.getElementById('quiz-mode-container'),
    learningModeContainer:document.getElementById('learning-mode-container'),
    dashboardContainer:   document.getElementById('dashboard-container'),
    imeWarning:           document.getElementById('ime-warning'),
    globalLoader:         document.getElementById('global-loader'),
    wordContextMenu:      document.getElementById('word-context-menu'),
    selectLearningBtn:    document.getElementById('select-learning-btn'),
    selectQuizBtn:        document.getElementById('select-quiz-btn'),
    selectDashboardBtn:   document.getElementById('select-dashboard-btn'),
    selectMistakesBtn:    document.getElementById('select-mistakes-btn'),
    selectFavoritesBtn:   document.getElementById('select-favorites-btn'),
    progressBarContainer: document.getElementById('progress-bar-container'),
    lastUpdatedText:      document.getElementById('last-updated-text'),
    practiceModeControl:  document.getElementById('practice-mode-control'),
    practiceModeCheckbox: document.getElementById('practice-mode-checkbox'),
  },

  init() {
    const startFirebaseApp = () => {
      const {
        initializeApp, getDatabase, getAuth, getFirestore,
        onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup,
      } = window.firebaseSDK;
      const firebaseApp = initializeApp(config.FIREBASECONFIG);
      const database    = getDatabase(firebaseApp);
      const auth        = getAuth(firebaseApp);
      const db          = getFirestore(firebaseApp);
      api.init(db, database);

      onAuthStateChanged(auth, async user => {
        if (user && user.email === config.ALLOWEDUSEREMAIL) {
          state.userId = user.uid;
          const { doc, setDoc } = window.firebaseSDK;
          await setDoc(doc(db, 'users', user.uid),
            { displayName: user.displayName, email: user.email }, { merge: true });
          this.elements.loginScreen.classList.add('hidden');
          this.elements.appWrapper.classList.remove('hidden');
          if (!state.isAppStarted) await this.startApp();
        } else {
          this.elements.loginScreen.classList.remove('hidden');
          this.elements.appWrapper.classList.add('hidden');
          if (user) signOut(auth);
        }
      });
      this.bindGlobalEvents(auth, signInWithPopup, GoogleAuthProvider, signOut);
    };

    if (window.firebaseSDK) startFirebaseApp();
    else document.addEventListener('firebaseSDKLoaded', startFirebaseApp);
  },

  async startApp() {
    state.isAppStarted = true;

    // 설정 복원
    try {
      const savedVoice = localStorage.getItem(state.LOCALSTORAGEKEYS.TTSVOICE);
      if (savedVoice) {
        state.currentVoiceSet = savedVoice;
        this.elements.ttsToggleText.textContent = savedVoice;
        this._setTtsButtonStyle(savedVoice); // #21 fix
      }
      const savedPractice = localStorage.getItem(state.LOCALSTORAGEKEYS.PRACTICEMODE);
      if (savedPractice === 'true') {
        quizMode.state.isPracticeMode = true;
        this.elements.practiceModeCheckbox.checked = true;
      }
    } catch(e) { console.error(e); }

    // #10 fix: utils.js 캐시 객체를 window에 바인딩
    window.imageDBCache = imageDBCache;
    window.audioCache   = audioCache;
    try {
      await Promise.all([
        translationCache.init(),
        imageDBCache.init(),
        audioCache.init(),
      ]);
    } catch(e) { console.error('캐시 초기화 실패:', e); }

    await this.syncOfflineData();

    // #15 fix: 단어 목록 로드 실패 시 명시적 처리 (앱은 계속 실행)
    try {
      await api.loadWordList();
      await api.loadUserProgress();
      this.updateLastUpdatedText();
    } catch(e) {
      console.error('단어 목록 로드 실패:', e);
      this.showToast('단어 목록을 불러오지 못했습니다. 새로고침 해주세요.', true);
    }

    quizMode.init();
    learningMode.init();
    dashboard.init();
    quizMode.preloadAllQuizTypesBasedOnSavedRange();
    await this.loadInitialImages();

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
        this.elements.loginError.textContent =
          error.code === 'auth/popup-closed-by-user'
            ? '로그인이 취소되었습니다.'
            : 'Google 로그인에 실패했습니다.';
      }
    });
    this.elements.logoutBtn.addEventListener('click', () => signOut(auth));

    // AudioContext 잠금 해제
    const unlockAudio = async () => {
      if (!state.audioContext) {
        const AC = window.AudioContext || window.webkitAudioContext;
        state.audioContext = new AC();
      }
      if (state.audioContext.state === 'suspended') {
        try { await state.audioContext.resume(); } catch(e) {}
      }
    };
    ['click', 'touchstart', 'keydown'].forEach(ev =>
      document.body.addEventListener(ev, unlockAudio, { capture: true, once: true })
    );

    this.elements.selectQuizBtn.addEventListener('click',     () => this.navigateTo('quiz'));
    this.elements.selectLearningBtn.addEventListener('click', () => this.navigateTo('learning'));
    this.elements.selectDashboardBtn.addEventListener('click',() => this.navigateTo('dashboard'));
    this.elements.selectFavoritesBtn.addEventListener('click',() => this.navigateTo('favorites'));
    this.elements.selectMistakesBtn.addEventListener('click', async () => {
      const mistakeWords = state.wordList
        .filter(w => utils.getWordStatus(w.word) === 'review')
        .map(w => w.word);
      if (mistakeWords.length === 0) { this.showToast('복습할 단어가 없습니다.', true); return; }
      this.navigateTo('mistakeReview', { mistakeWords });
    });
    this.elements.homeBtn.addEventListener('click',    () => this.navigateTo('selection'));
    this.elements.refreshBtn.addEventListener('click', () => this.forceReload());
    this.elements.ttsToggleBtn.addEventListener('click', () => this.toggleVoiceSet());
    this.elements.practiceModeCheckbox.addEventListener('change', e => {
      quizMode.state.isPracticeMode = e.target.checked;
      try { localStorage.setItem(state.LOCALSTORAGEKEYS.PRACTICEMODE, e.target.checked); }
      catch(err) { console.error(err); }
      if (history.state?.mode === 'quiz-play') {
        quizMode.reset(false);
        quizMode.displayNextQuiz();
      }
    });

    document.addEventListener('click', e => {
      if (this.elements.wordContextMenu && !this.elements.wordContextMenu.contains(e.target))
        ui.hideWordContextMenu();
    });

    window.addEventListener('popstate', e => {
      this.syncOfflineData();
      this.renderMode(e.state?.mode || 'selection', e.state?.options || {});
    });

    document.addEventListener('contextmenu', e => {
      const t = e.target;
      if (!t.closest('.interactive-word, #word-display, #word-context-menu, #edit-context-menu, #meaning-container, #explanation-container'))
        e.preventDefault();
    });

    // #13 fix: beforeunload는 동기 함수만 호출
    window.addEventListener('beforeunload', () => {
      studyTracker.stopAndSave();
      this.syncOfflineDataSync();
    });

    window.addEventListener('navigate',       e => this.navigateTo(e.detail.mode, e.detail.options));
    window.addEventListener('showToast',      e => this.showToast(e.detail.message, e.detail.isError));
    window.addEventListener('showImeWarning', () => this.showImeWarning());
    window.addEventListener('syncRequest',    () => this.syncOfflineData());
    document.addEventListener('searchWord',   e => this.searchWordInLearningMode(e.detail));
  },

  async syncOfflineData() {
    if (!state.userId) return;
    try {
      const timeKey     = state.LOCALSTORAGEKEYS.UNSYNCEDTIME;
      const quizKey     = state.LOCALSTORAGEKEYS.UNSYNCEDQUIZ;
      const progressKey = state.LOCALSTORAGEKEYS.UNSYNCEDPROGRESSUPDATES;
      const timeToSync  = parseInt(localStorage.getItem(timeKey) || '0', 10);
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
    } catch(error) { console.error('오프라인 동기화 실패:', error); }
  },

  // #13 fix: beforeunload용 — localStorage 보존만 확인 (async 불가)
  syncOfflineDataSync() {
    if (!state.userId) return;
    const hasPending =
      localStorage.getItem(state.LOCALSTORAGEKEYS.UNSYNCEDTIME)            ||
      localStorage.getItem(state.LOCALSTORAGEKEYS.UNSYNCEDQUIZ)            ||
      localStorage.getItem(state.LOCALSTORAGEKEYS.UNSYNCEDPROGRESSUPDATES);
    if (hasPending) console.log('미동기 데이터 존재 — 다음 접속 시 자동 동기화됩니다.');
  },

  navigateTo(mode, options = {}) {
    const currentMode    = history.state?.mode;
    const currentOptions = history.state?.options;
    if (currentMode !== mode) this.syncOfflineData();

    // #20 fix: 반복 재진입 허용 모드 목록 명시
    const allowRepeat = ['learning', 'mistakeReview', 'favorites', 'quiz-play'];
    if (currentMode === mode &&
        JSON.stringify(currentOptions) === JSON.stringify(options) &&
        !allowRepeat.includes(mode)) return;

    const newPath = mode === 'selection'
      ? window.location.pathname + window.location.search
      : `#${mode}`;
    history.pushState({ mode, options }, '', newPath);
    this.renderMode(mode, options);
  },

  async renderMode(mode, options = {}) {
    studyTracker.stopAndSave();
    if (this.elements.refreshBtn) this.elements.refreshBtn.classList.add('hidden');

    // 전체 숨기기
    [
      this.elements.selectionScreen, this.elements.quizModeContainer,
      this.elements.learningModeContainer, this.elements.dashboardContainer,
      this.elements.homeBtn, this.elements.logoutBtn, this.elements.ttsToggleBtn,
      this.elements.progressBarContainer, this.elements.practiceModeControl,
      learningMode.elements.fixedButtons, learningMode.elements.appContainer,
      learningMode.elements.startScreen,
    ].forEach(el => el?.classList.add('hidden'));

    const showCommon = () => {
      this.elements.homeBtn.classList.remove('hidden');
      this.elements.ttsToggleBtn.classList.remove('hidden');
    };

    if (['quiz-play', 'learning', 'mistakeReview', 'favorites'].includes(mode))
      studyTracker.start();

    if (mode === 'quiz') {
      this.elements.homeBtn.classList.remove('hidden');
      this.elements.quizModeContainer.classList.remove('hidden');
      this.elements.practiceModeControl.classList.remove('hidden');
      quizMode.reset();
      await quizMode.updateRangeInputs(); // #16 fix
    } else if (mode === 'quiz-play') {
      showCommon();
      this.elements.quizModeContainer.classList.remove('hidden');
      this.elements.practiceModeControl.classList.remove('hidden');
      quizMode.reset(false);
      if (!state.isWordListReady) await api.loadWordList();
      quizMode.displayNextQuiz();
    } else if (mode === 'learning') {
      showCommon();
      this.elements.learningModeContainer.classList.remove('hidden');
      if (options?.startIndex !== undefined && options.startIndex !== -1) {
        learningMode.state.isMistakeMode   = false;
        learningMode.state.isFavoriteMode  = false;
        learningMode.state.currentWordList = state.wordList;
        learningMode.state.currentIndex    = options.startIndex;
        learningMode.launchApp();
      } else {
        learningMode.elements.startScreen.classList.remove('hidden');
        learningMode.resetStartScreen();
      }
    } else if (mode === 'mistakeReview') {
      showCommon();
      this.elements.learningModeContainer.classList.remove('hidden');
      learningMode.startMistakeReview(options?.mistakeWords || []);
    } else if (mode === 'favorites') {
      showCommon();
      this.elements.learningModeContainer.classList.remove('hidden');
      learningMode.startFavoriteMode();
    } else if (mode === 'dashboard') {
      this.elements.homeBtn.classList.remove('hidden');
      this.elements.dashboardContainer.classList.remove('hidden');
      dashboard.render();
    } else {
      // selection
      this.elements.selectionScreen.classList.remove('hidden');
      this.elements.logoutBtn.classList.remove('hidden');
      if (this.elements.refreshBtn) this.elements.refreshBtn.classList.remove('hidden');
      quizMode.reset();
      learningMode.reset();
    }
  },

  async forceReload() {
    this.elements.globalLoader.classList.remove('hidden');
    // #25 fix: 비활성화 대상 배열로 DRY 처리
    const toDisable = [
      this.elements.refreshBtn,     this.elements.selectDashboardBtn,
      this.elements.selectMistakesBtn, this.elements.selectLearningBtn,
      this.elements.selectQuizBtn,
    ];
    toDisable.forEach(el => el?.classList.add('pointer-events-none', 'opacity-50'));
    try {
      await api.loadWordList(true);
      await api.loadUserProgress();
      this.updateLastUpdatedText();
      this.showToast('단어 목록이 새로고침되었습니다!');
    } catch(e) {
      this.showToast(e.message, true);
    } finally {
      toDisable.forEach(el => el?.classList.remove('pointer-events-none', 'opacity-50'));
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
      toast.style.opacity    = '0';
      setTimeout(() => toast.remove(), 500);
    }, 2500);
  },

  updateLastUpdatedText() {
    if (!this.elements.lastUpdatedText) return;
    if (state.lastCacheTimestamp) {
      const d = new Date(state.lastCacheTimestamp);
      const pad = n => String(n).padStart(2, '0');
      this.elements.lastUpdatedText.textContent =
        `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } else {
      this.elements.lastUpdatedText.textContent = '';
    }
    this.elements.lastUpdatedText.classList.remove('hidden');
  },

  // #21 fix: TTS 버튼 스타일 헬퍼
  _setTtsButtonStyle(voiceSet) {
    const btn  = this.elements.ttsToggleBtn;
    const isUK = voiceSet === 'UK';
    btn.classList.toggle('bg-indigo-700',      isUK);
    btn.classList.toggle('hover:bg-indigo-800', isUK);
    btn.classList.toggle('bg-red-500',         !isUK);
    btn.classList.toggle('hover:bg-red-600',   !isUK);
  },

  toggleVoiceSet() {
    this.elements.ttsToggleBtn.classList.toggle('is-flipped');
    setTimeout(() => {
      state.currentVoiceSet = state.currentVoiceSet === 'UK' ? 'US' : 'UK';
      this.elements.ttsToggleText.textContent = state.currentVoiceSet;
      this._setTtsButtonStyle(state.currentVoiceSet); // #21 fix
      try { localStorage.setItem(state.LOCALSTORAGEKEYS.TTSVOICE, state.currentVoiceSet); }
      catch(e) { console.error(e); }
    }, 250);
  },

  showImeWarning() {
    this.elements.imeWarning.classList.remove('hidden');
    clearTimeout(this.imeWarningTimeout);
    this.imeWarningTimeout = setTimeout(() =>
      this.elements.imeWarning.classList.add('hidden'), 2000
    );
  },

  // #17 fix: Promise.all 병렬 이미지 로드
  async loadInitialImages() {
    const selectors = [
      '#select-learning-btn img',   '#select-quiz-btn img',
      '#start-meaning-quiz-btn img','#start-blank-quiz-btn img',
      '#start-definition-quiz-btn img',
    ];
    await Promise.all(selectors.map(async sel => {
      const img = document.querySelector(sel);
      if (img && window.imageDBCache)
        img.src = await window.imageDBCache.loadImage(img.src);
    }));
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

  showFatalError(message) {
    this.elements.selectionScreen.innerHTML = `
      <div class="p-8 text-center">
        <h1 class="text-3xl font-bold text-red-600 mb-4">앱 초기화 실패</h1>
        <p class="text-gray-700 mb-6">Firebase 연결에 문제가 발생했습니다.<br>페이지를 새로고침 해주세요.</p>
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
};

app.init();
