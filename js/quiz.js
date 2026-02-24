import { state } from './config.js';
import { api } from './api.js';
import { utils, playSequence, correctBeep, incorrectBeep } from './utils.js';

// #11 fix: PASS 판별용 심볼 상수 (문자열 비교 제거)
const USER_PASSED = Symbol('USER_PASSED');

// #22 fix: createBlankQuiz 정규식 모듈-레벨 캐시
const _blankRegexCache = new Map();

export const quizMode = {
  state: {
    currentQuiz: {},
    currentQuizType: null,
    isPracticeMode: false,
    sessionAnsweredInSet: 0,
    sessionCorrectInSet: 0,
    sessionMistakes: [],
    answeredWords: new Set(),
    preloadedQuizzes: {
      MULTIPLECHOICEMEANING:    null,
      FILLINTHEBLANK:           null,
      MULTIPLECHOICEDEFINITION: null,
    },
    isPreloading: {
      MULTIPLECHOICEMEANING:    false,
      FILLINTHEBLANK:           false,
      MULTIPLECHOICEDEFINITION: false,
    },
    currentRangeInputTarget: null,
  },
  elements: {},

  init() {
    this.elements = {
      quizSelectionScreen: document.getElementById('quiz-selection-screen'),
      startMeaningQuizBtn: document.getElementById('start-meaning-quiz-btn'),
      startBlankQuizBtn:   document.getElementById('start-blank-quiz-btn'),
      startDefinitionQuizBtn: document.getElementById('start-definition-quiz-btn'),
      loader:              document.getElementById('quiz-loader'),
      loaderText:          document.getElementById('quiz-loader-text'),
      contentContainer:    document.getElementById('quiz-content-container'),
      questionDisplay:     document.getElementById('quiz-question-display'),
      choices:             document.getElementById('quiz-choices'),
      modal:               document.getElementById('quiz-result-modal'),
      modalScore:          document.getElementById('quiz-result-score'),
      modalMistakesBtn:    document.getElementById('quiz-result-mistakes-btn'),
      modalContinueBtn:    document.getElementById('quiz-result-continue-btn'),
      quizRangeStart:      document.getElementById('quiz-range-start'),
      quizRangeEnd:        document.getElementById('quiz-range-end'),
      quizRangeLabel:      document.getElementById('quiz-range-label'),
      rangeInputModal:     document.getElementById('range-input-modal'),
      rangeInputLabel:     document.getElementById('range-input-label'),
      rangeInputField:     document.getElementById('range-input-field'),
      rangeInputCancelBtn: document.getElementById('range-input-cancel-btn'),
      rangeInputConfirmBtn:document.getElementById('range-input-confirm-btn'),
      finishedScreen:      document.getElementById('quiz-finished-screen'),
      finishedMessage:     document.getElementById('quiz-finished-message'),
    };
    this.bindEvents();
  },

  bindEvents() {
    this.elements.startMeaningQuizBtn.addEventListener('click',    () => this.start('MULTIPLECHOICEMEANING'));
    this.elements.startBlankQuizBtn.addEventListener('click',      () => this.start('FILLINTHEBLANK'));
    this.elements.startDefinitionQuizBtn.addEventListener('click', () => this.start('MULTIPLECHOICEDEFINITION'));

    this.elements.quizRangeStart.addEventListener('click', e => this.promptForRangeValue(e.target));
    this.elements.quizRangeEnd.addEventListener('click',   e => this.promptForRangeValue(e.target));
    this.elements.rangeInputConfirmBtn.addEventListener('click', () => this.confirmRangeInput());
    this.elements.rangeInputCancelBtn.addEventListener('click',  () => this.hideRangeInput());
    this.elements.rangeInputModal.addEventListener('click',      () => this.hideRangeInput());
    this.elements.rangeInputField.addEventListener('keydown', e => {
      if (e.key === 'Enter')  this.confirmRangeInput();
      if (e.key === 'Escape') this.hideRangeInput();
    });
    this.elements.quizRangeLabel.addEventListener('click', () => this.resetQuizRange());
    this.elements.modalContinueBtn.addEventListener('click', () => this.continueAfterResult());
    this.elements.modalMistakesBtn.addEventListener('click', () => this.reviewSessionMistakes());

    document.addEventListener('keydown', e => {
      const isQuizModeActive = !this.elements.contentContainer.classList.contains('hidden') &&
                               !this.elements.choices.classList.contains('disabled');
      if (!isQuizModeActive) return;
      const choiceCount = Array.from(this.elements.choices.children)
        .filter(el => !el.textContent.includes('PASS')).length;

      if (e.key.toLowerCase() === 'p' || e.key === '0') {
        e.preventDefault();
        const passButton = Array.from(this.elements.choices.children)
          .find(el => el.textContent.includes('PASS'));
        if (passButton) passButton.click();
      } else {
        const choiceIndex = parseInt(e.key);
        if (choiceIndex >= 1 && choiceIndex <= choiceCount) {
          e.preventDefault();
          const targetLi = this.elements.choices.children[choiceIndex - 1];
          targetLi.classList.add('bg-gray-200');
          setTimeout(() => targetLi.classList.remove('bg-gray-200'), 150);
          targetLi.click();
        }
      }
    });
  },

  async start(quizType) {
    this.state.currentQuizType = quizType;
    window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'quiz-play' } }));
  },

  reset(showSelection = true) {
    this.state.currentQuiz            = {};
    this.state.sessionAnsweredInSet   = 0;
    this.state.sessionCorrectInSet    = 0;
    this.state.sessionMistakes        = [];
    if (showSelection) {
      this.state.answeredWords.clear();
      this.state.currentQuizType = null;
    }
    const loaderSpinner = this.elements.loader.querySelector('.loader');
    if (loaderSpinner) loaderSpinner.style.display = 'block';
    this.elements.loaderText.textContent = '퀴즈 준비 중...';

    if (showSelection) {
      this.elements.quizSelectionScreen.classList.remove('hidden');
      this.elements.loader.classList.add('hidden');
    } else {
      this.showLoader(true);
    }
    this.elements.contentContainer.classList.add('hidden');
    this.elements.finishedScreen.classList.add('hidden');
    if (this.elements.modal) this.elements.modal.classList.add('hidden');
    if (showSelection) this.updateRangeInputs();
  },

  async updateRangeInputs() {
    let startValue = 1, endValue = 1, totalWords = 1;
    try {
      if (!state.isWordListReady) await api.loadWordList();
      totalWords = state.wordList?.length || 1;
      endValue   = totalWords;
      const savedStart = localStorage.getItem(state.LOCALSTORAGEKEYS.QUIZRANGESTART);
      const savedEnd   = localStorage.getItem(state.LOCALSTORAGEKEYS.QUIZRANGEEND);
      if (savedStart !== null) {
        const p = parseInt(savedStart);
        if (!isNaN(p) && p >= 1 && p <= totalWords) startValue = p;
        else localStorage.removeItem(state.LOCALSTORAGEKEYS.QUIZRANGESTART);
      }
      if (savedEnd !== null) {
        const p = parseInt(savedEnd);
        if (!isNaN(p) && p >= 1 && p <= totalWords) endValue = p;
        else localStorage.removeItem(state.LOCALSTORAGEKEYS.QUIZRANGEEND);
      }
    } catch(error) {
      startValue = 1; endValue = 1; totalWords = 1;
    } finally {
      this.elements.quizRangeStart.textContent = startValue;
      this.elements.quizRangeStart.dataset.min = 1;
      this.elements.quizRangeStart.dataset.max = totalWords;
      this.elements.quizRangeEnd.textContent   = endValue;
      this.elements.quizRangeEnd.dataset.min   = 1;
      this.elements.quizRangeEnd.dataset.max   = totalWords;
    }
  },

  promptForRangeValue(targetButton) {
    if (!targetButton) return;
    this.state.currentRangeInputTarget = targetButton;
    const isStart = targetButton.id === 'quiz-range-start';
    const min     = parseInt(targetButton.dataset.min) || 1;
    const max     = parseInt(targetButton.dataset.max) || 1;
    this.elements.rangeInputLabel.textContent = isStart ? `시작 번호 (1-${max})` : `끝 번호 (1-${max})`;
    this.elements.rangeInputField.value = targetButton.textContent;
    this.elements.rangeInputField.min   = min;
    this.elements.rangeInputField.max   = max;
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
    const min         = parseInt(targetButton.dataset.min) || 1;
    const max         = parseInt(targetButton.dataset.max) || 1;
    const newValueStr = this.elements.rangeInputField.value;

    if (newValueStr !== null && newValueStr.trim() !== '') {
      const newValue = parseInt(newValueStr);
      if (!isNaN(newValue)) {
        const clamped    = Math.max(min, Math.min(max, newValue));
        targetButton.textContent = clamped;
        const storageKey = targetButton.id === 'quiz-range-start'
          ? state.LOCALSTORAGEKEYS.QUIZRANGESTART
          : state.LOCALSTORAGEKEYS.QUIZRANGEEND;
        try {
          localStorage.setItem(storageKey, clamped);
          this.clearAndPreloadQuizzesForNewRange();
        } catch(e) {
          console.error('퀴즈 범위 저장 오류:', e);
        }
      } else {
        // #14 fix: alert → showToast
        window.dispatchEvent(new CustomEvent('showToast', {
          detail: { message: '올바른 숫자를 입력해주세요.', isError: true }
        }));
      }
    }
    this.hideRangeInput();
  },

  resetQuizRange() {
    const totalWords = state.wordList.length > 0 ? state.wordList.length : 1;
    // #26 fix: dataset.max도 함께 업데이트
    this.elements.quizRangeStart.textContent = 1;
    this.elements.quizRangeStart.dataset.max = totalWords;
    this.elements.quizRangeEnd.textContent   = totalWords;
    this.elements.quizRangeEnd.dataset.max   = totalWords;
    try {
      localStorage.setItem(state.LOCALSTORAGEKEYS.QUIZRANGESTART, 1);
      localStorage.setItem(state.LOCALSTORAGEKEYS.QUIZRANGEEND, totalWords);
      this.clearAndPreloadQuizzesForNewRange();
    } catch(e) {
      console.error(e);
    }
  },

  clearAndPreloadQuizzesForNewRange() {
    Object.keys(this.state.preloadedQuizzes).forEach(type => {
      this.state.preloadedQuizzes[type] = null;
      this.state.isPreloading[type]     = false;
    });
    this.preloadAllQuizTypesBasedOnSavedRange();
  },

  async displayNextQuiz() {
    this.showLoader(true, '다음 문제 준비 중...');
    let nextQuiz  = null;
    const type    = this.state.currentQuizType;
    let preloaded = this.state.preloadedQuizzes[type];

    if (preloaded) {
      const allWords   = state.wordList;
      const startVal   = parseInt(this.elements.quizRangeStart.textContent) || 1;
      const endVal     = parseInt(this.elements.quizRangeEnd.textContent)   || allWords.length;
      const startIndex = Math.max(0, Math.min(startVal, endVal) - 1);
      const endIndex   = Math.min(allWords.length - 1, Math.max(startVal, endVal) - 1);
      const wordIndex  = allWords.findIndex(w => w.word === preloaded.question.word);
      if (wordIndex < startIndex || wordIndex > endIndex) preloaded = null;
      if (preloaded && this.state.answeredWords.has(preloaded.question.word)) preloaded = null;
      if (preloaded && !this.state.isPracticeMode) {
        if (utils.getWordStatus(preloaded.question.word) === 'learned') preloaded = null;
      }
    }

    if (preloaded) {
      nextQuiz = preloaded;
      this.state.preloadedQuizzes[type] = null;
      this.preloadNextQuiz(type, nextQuiz.question.word);
    }
    if (!nextQuiz) {
      nextQuiz = await this.generateSingleQuiz();
      if (nextQuiz) this.preloadNextQuiz(type, nextQuiz.question.word);
    }

    if (nextQuiz) {
      this.state.currentQuiz = nextQuiz;
      this.showLoader(false);
      this.renderQuiz(nextQuiz);
    } else {
      if (this.state.sessionAnsweredInSet === 0) {
        this.showSessionResultModal(true);
      } else {
        this.showFinishedScreen('No more quizzes!');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'quiz' } }));
        }, 800);
      }
    }
  },

  async generateSingleQuiz() {
    const allWords = state.wordList;
    if (allWords.length === 0) return null;
    const startVal   = parseInt(this.elements.quizRangeStart.textContent) || 1;
    const endVal     = parseInt(this.elements.quizRangeEnd.textContent)   || allWords.length;
    const startIndex = Math.max(0, Math.min(startVal, endVal) - 1);
    const endIndex   = Math.min(allWords.length - 1, Math.max(startVal, endVal) - 1);
    const wordsInRange = allWords.slice(startIndex, endIndex + 1);
    if (wordsInRange.length === 0) return null;

    const currentQuizType = this.state.currentQuizType;
    let unsynced;
    try { unsynced = JSON.parse(localStorage.getItem(state.LOCALSTORAGEKEYS.UNSYNCEDPROGRESSUPDATES)); }
    catch(e) { unsynced = null; }

    let candidates = wordsInRange.filter(wordObj => {
      const word = wordObj.word;
      if (this.state.answeredWords.has(word)) return false;
      if (this.state.isPracticeMode) return true;
      if (unsynced?.[word]?.[currentQuizType] === 'correct') return false;
      const sp = state.currentProgress[word];
      if (!unsynced?.[word] && sp?.[currentQuizType] === 'correct') return false;
      return true;
    });
    if (currentQuizType === 'FILLINTHEBLANK')
      candidates = candidates.filter(w => w.sample && w.sample.trim() !== '');
    if (candidates.length === 0) return null;

    utils.shuffleArray(candidates);
    for (const wordData of candidates) {
      let quiz = null;
      if (currentQuizType === 'MULTIPLECHOICEMEANING')
        quiz = this.createMeaningQuiz(wordData, allWords);
      else if (currentQuizType === 'FILLINTHEBLANK')
        quiz = this.createBlankQuiz(wordData, allWords);
      else if (currentQuizType === 'MULTIPLECHOICEDEFINITION')
        quiz = await this.createDefinitionQuiz(wordData, allWords);
      if (quiz) return quiz;
    }
    return null;
  },

  renderQuiz(quizData) {
    const { type, question, choices } = quizData;
    const questionDisplay = this.elements.questionDisplay;
    questionDisplay.innerHTML = '';
    questionDisplay.className = 'bg-green-100 p-4 rounded-lg mb-4 flex min-h-[100px]';

    if (type === 'FILLINTHEBLANK') {
      questionDisplay.classList.add('items-start', 'text-left');
      const p = document.createElement('p');
      p.className = 'text-xl sm:text-2xl text-gray-800 leading-relaxed';
      question.sentencewithblank.split('BLANK').forEach((part, index, arr) => {
        part.split(/(\*[^*]+\*)/g).forEach(seg => {
          if (seg.startsWith('*') && seg.endsWith('*')) {
            const strong = document.createElement('strong');
            strong.textContent = seg.slice(1, -1);
            p.appendChild(strong);
          } else if (seg) {
            p.appendChild(document.createTextNode(seg));
          }
        });
        if (index < arr.length - 1) {
          const blank = document.createElement('span');
          blank.className = 'quiz-blank inline-block font-mono text-blue-600';
          blank.textContent = '________';
          p.appendChild(blank);
        }
      });
      questionDisplay.appendChild(p);
    } else if (type === 'MULTIPLECHOICEMEANING') {
      questionDisplay.classList.add('items-center', 'justify-center');
      questionDisplay.innerHTML =
        `<h1 id="quiz-word" class="text-3xl sm:text-4xl font-bold text-center text-gray-800 cursor-pointer">${question.word}</h1>`;
      questionDisplay.querySelector('#quiz-word').onclick = () => api.speak(question.word, 'word');
    } else if (type === 'MULTIPLECHOICEDEFINITION') {
      questionDisplay.classList.add('items-start', 'text-left');
      questionDisplay.innerHTML =
        `<p class="text-lg sm:text-xl text-gray-800 leading-relaxed">${question.definition}</p>`;
    }

    this.elements.choices.innerHTML = '';
    choices.forEach((choice, index) => {
      const li = document.createElement('li');
      li.className = 'choice-item border-2 border-gray-300 py-3 px-4 rounded-lg cursor-pointer flex items-start transition-all text-lg hover:bg-blue-50';
      li.innerHTML = `<span class="font-bold mr-3 text-blue-600">${index + 1}.</span><span>${choice}</span>`;
      li.onclick = () => this.checkAnswer(li, choice);
      this.elements.choices.appendChild(li);
    });

    const passLi = document.createElement('li');
    passLi.className = 'choice-item border-2 border-red-500 bg-red-500 hover:bg-red-600 text-white p-4 rounded-lg cursor-pointer flex items-center justify-center transition-all font-bold text-lg';
    passLi.innerHTML = '<span>PASS</span>';
    passLi.onclick = () => this.checkAnswer(passLi, USER_PASSED);  // #11 fix
    this.elements.choices.appendChild(passLi);
    this.elements.choices.classList.remove('disabled');
  },

  async checkAnswer(selectedLi, selectedChoice) {
    this.elements.choices.classList.add('disabled');

    const isPass    = selectedChoice === USER_PASSED;           // #11 fix
    const isCorrect = !isPass && selectedChoice === this.state.currentQuiz.answer;
    const word      = this.state.currentQuiz.question.word;
    const quizType  = this.state.currentQuiz.type;

    this.state.answeredWords.add(word);

    // #12 fix: DOM 피드백을 requestAnimationFrame 안에서 처리
    requestAnimationFrame(() => {
      selectedLi.classList.add(isCorrect ? 'correct' : 'incorrect');
      if (!isCorrect) {
        Array.from(this.elements.choices.children)
          .find(li => li.querySelector('span:last-child')?.textContent === this.state.currentQuiz.answer)
          ?.classList.add('correct');
      }
    });

    if (isCorrect && !isPass) playSequence(correctBeep);
    else                      playSequence(incorrectBeep);

    if (!isCorrect && !isPass) this.state.sessionMistakes.push(word);
    this.state.sessionAnsweredInSet++;
    if (isCorrect && !isPass) this.state.sessionCorrectInSet++;

    if (!this.state.isPracticeMode) {
      await api.updateWordStatus(word, quizType, isCorrect && !isPass ? 'correct' : 'incorrect');
    }

    setTimeout(() => {
      if (this.state.sessionAnsweredInSet >= 10) this.showSessionResultModal();
      else this.displayNextQuiz();
    }, 600);
  },

  showLoader(isLoading, message = '문제 로딩 중...') {
    this.elements.loader.classList.toggle('hidden', !isLoading);
    if (message) this.elements.loaderText.textContent = message;
    this.elements.contentContainer.classList.toggle('hidden', isLoading);
    this.elements.quizSelectionScreen.classList.add('hidden');
    this.elements.finishedScreen.classList.add('hidden');
  },

  showFinishedScreen(message) {
    this.showLoader(false);
    this.elements.contentContainer.classList.add('hidden');
    this.elements.finishedScreen.classList.remove('hidden');
    this.elements.finishedMessage.textContent = message;
  },

  showSessionResultModal(isFinal = false) {
    this.elements.modalScore.textContent =
      `${this.state.sessionAnsweredInSet}문제 중 ${this.state.sessionCorrectInSet}개 정답!`;
    this.elements.modalMistakesBtn.classList.toggle('hidden', this.state.sessionMistakes.length === 0);
    this.elements.modalContinueBtn.textContent = isFinal ? '종료' : '계속하기';
    this.elements.modal.classList.remove('hidden');
  },

  continueAfterResult() {
    this.elements.modal.classList.add('hidden');
    if (this.elements.modalContinueBtn.textContent === '종료') {
      window.dispatchEvent(new CustomEvent('syncRequest'));
      window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'quiz' } }));
      return;
    }
    this.state.sessionAnsweredInSet = 0;
    this.state.sessionCorrectInSet  = 0;
    this.state.sessionMistakes      = [];
    this.displayNextQuiz();
  },

  reviewSessionMistakes() {
    this.elements.modal.classList.add('hidden');
    const mistakes = [...new Set(this.state.sessionMistakes)];
    this.state.sessionAnsweredInSet = 0;
    this.state.sessionCorrectInSet  = 0;
    this.state.sessionMistakes      = [];
    window.dispatchEvent(new CustomEvent('syncRequest'));
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { mode: 'mistakeReview', options: { mistakeWords: mistakes } }
    }));
  },

  async preloadAllQuizTypesBasedOnSavedRange() {
    if (!state.isWordListReady) {
      try { await api.loadWordList(); } catch(e) { return; }
    }
    let startValue = 1, endValue = state.wordList.length;
    try {
      const totalWords  = state.wordList.length || 1;
      const savedStart  = localStorage.getItem(state.LOCALSTORAGEKEYS.QUIZRANGESTART);
      const savedEnd    = localStorage.getItem(state.LOCALSTORAGEKEYS.QUIZRANGEEND);
      if (savedStart !== null) {
        const p = parseInt(savedStart);
        if (!isNaN(p) && p >= 1 && p <= totalWords) startValue = p;
      }
      if (savedEnd !== null) {
        const p = parseInt(savedEnd);
        if (!isNaN(p) && p >= 1 && p <= totalWords) endValue = p;
      }
    } catch(e) { console.warn('퀴즈 범위 읽기 오류:', e); }

    for (const type of Object.keys(this.state.preloadedQuizzes)) {
      this.preloadNextQuiz(type, null, { start: startValue, end: endValue });
    }
  },

  async preloadNextQuiz(quizType, wordToExclude = null, rangeOverride = null) {
    if (this.state.isPreloading[quizType] || this.state.preloadedQuizzes[quizType]) return;
    this.state.isPreloading[quizType] = true;
    try {
      const quiz = await this.generateSingleQuizForPreload(quizType, wordToExclude, rangeOverride);
      if (quiz) this.state.preloadedQuizzes[quizType] = quiz;
    } catch(error) {
      console.warn(`프리로딩 실패 (${quizType}):`, error);
    } finally {
      this.state.isPreloading[quizType] = false;
    }
  },

  async generateSingleQuizForPreload(quizType, wordToExclude = null, rangeOverride = null) {
    const allWords = state.wordList;
    if (allWords.length === 0) return null;

    const startVal = rangeOverride ? rangeOverride.start : (parseInt(this.elements.quizRangeStart.textContent) || 1);
    const endVal   = rangeOverride ? rangeOverride.end   : (parseInt(this.elements.quizRangeEnd.textContent)   || allWords.length);
    const startIndex = Math.max(0, Math.min(startVal, endVal) - 1);
    const endIndex   = Math.min(allWords.length - 1, Math.max(startVal, endVal) - 1);
    const wordsInRange = allWords.slice(startIndex, endIndex + 1);
    if (wordsInRange.length === 0) return null;

    let unsynced;
    try { unsynced = JSON.parse(localStorage.getItem(state.LOCALSTORAGEKEYS.UNSYNCEDPROGRESSUPDATES)); }
    catch(e) { unsynced = null; }

    let candidates = wordsInRange.filter(wordObj => {
      const word = wordObj.word;
      if (word === wordToExclude) return false;
      if (this.state.answeredWords.has(word)) return false;
      if (this.state.isPracticeMode) return true;
      if (unsynced?.[word]?.[quizType] === 'correct') return false;
      const sp = state.currentProgress[word];
      if (!unsynced?.[word] && sp?.[quizType] === 'correct') return false;
      return true;
    });
    if (quizType === 'FILLINTHEBLANK')
      candidates = candidates.filter(w => w.sample && w.sample.trim() !== '');
    if (candidates.length === 0) return null;

    utils.shuffleArray(candidates);
    const wordData = candidates[0];
    if (quizType === 'MULTIPLECHOICEMEANING')
      return this.createMeaningQuiz(wordData, allWords);
    if (quizType === 'FILLINTHEBLANK')
      return this.createBlankQuiz(wordData, allWords);
    if (quizType === 'MULTIPLECHOICEDEFINITION')
      return await this.createDefinitionQuiz(wordData, allWords);
    return null;
  },

  createMeaningQuiz(correctWordData, allWordsData) {
    const wrongAnswers = new Set();
    utils.pickRandomItems(allWordsData, 10,
      w => w.pos === correctWordData.pos && w.meaning !== correctWordData.meaning
    ).forEach(w => wrongAnswers.add(w.meaning));
    if (wrongAnswers.size < 3) {
      utils.pickRandomItems(allWordsData, 10,
        w => w.meaning !== correctWordData.meaning && !wrongAnswers.has(w.meaning)
      ).forEach(w => wrongAnswers.add(w.meaning));
    }
    if (wrongAnswers.size < 3) {
      if (allWordsData.length >= 4) [1, 2, 3].forEach(d => wrongAnswers.add(String(d)));
      else return null;
    }
    return {
      type: 'MULTIPLECHOICEMEANING',
      question: { word: correctWordData.word },
      choices: utils.shuffleArray([correctWordData.meaning, ...Array.from(wrongAnswers).slice(0, 3)]),
      answer:  correctWordData.meaning,
    };
  },

  createBlankQuiz(correctWordData, allWordsData) {
    if (!correctWordData.sample || !correctWordData.sample.trim()) return null;
    const firstLine = correctWordData.sample
      .split('\n')[0]
      .replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA70}-\u{1FAFF}]/gu, '')
      .replace(/\*/g, '')
      .trim();

    // #22 fix: 정규식 캐시 사용
    if (!_blankRegexCache.has(correctWordData.word)) {
      _blankRegexCache.set(
        correctWordData.word,
        new RegExp(correctWordData.word.replace(/[-?]/g, '.'), 'i')
      );
    }
    const placeholderRegex = _blankRegexCache.get(correctWordData.word);

    if (!firstLine.match(placeholderRegex)) return null;
    const sentenceWithBlank = firstLine.replace(placeholderRegex, 'BLANK').trim();

    const wrongAnswers = new Set();
    utils.pickRandomItems(allWordsData, 10,
      w => w.pos === correctWordData.pos && w.word !== correctWordData.word
    ).forEach(w => wrongAnswers.add(w.word));
    if (wrongAnswers.size < 3) {
      utils.pickRandomItems(allWordsData, 10,
        w => w.word !== correctWordData.word && !wrongAnswers.has(w.word)
      ).forEach(w => wrongAnswers.add(w.word));
    }
    if (wrongAnswers.size < 3) return null;

    return {
      type: 'FILLINTHEBLANK',
      question: { sentencewithblank: sentenceWithBlank, word: correctWordData.word },
      choices: utils.shuffleArray([correctWordData.word, ...Array.from(wrongAnswers).slice(0, 3)]),
      answer:  correctWordData.word,
    };
  },

  async createDefinitionQuiz(correctWordData, allWordsData) {
    const definition = await api.fetchDefinition(correctWordData.word);
    if (!definition) return null;

    const wrongAnswers = new Set();
    utils.pickRandomItems(allWordsData, 10,
      w => w.pos === correctWordData.pos && w.word !== correctWordData.word
    ).forEach(w => wrongAnswers.add(w.word));
    if (wrongAnswers.size < 3) {
      utils.pickRandomItems(allWordsData, 10,
        w => w.word !== correctWordData.word && !wrongAnswers.has(w.word)
      ).forEach(w => wrongAnswers.add(w.word));
    }
    if (wrongAnswers.size < 3) return null;

    return {
      type: 'MULTIPLECHOICEDEFINITION',
      question: { definition, word: correctWordData.word },
      choices: utils.shuffleArray([correctWordData.word, ...Array.from(wrongAnswers).slice(0, 3)]),
      answer:  correctWordData.word,
    };
  },
};
