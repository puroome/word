import { state } from './config.js';
import { api } from './api.js';
import { ui } from './ui.js';
import { utils, playSequence, correctBeep, incorrectBeep } from './utils.js';
import { emit } from './events.js';

// 예문에서 제거할 이모지/기호 유니코드 범위 (global 플래그라 replace 후 lastIndex 자동 리셋)
const EMOJI_REGEX = /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA70}-\u{1FAFF}]/gu;

export const quizMode = {
    state: {
        currentQuiz: {},
        currentQuizType: null,
        sessionMode: 'SINGLE',
        sessionLimit: 10,
        mixedQuizTypes: [],
        reviewQueue: [],
        isPracticeMode: false,
        sessionAnsweredInSet: 0,
        sessionCorrectInSet: 0,
        sessionMistakes: [],
        answeredWords: new Set(),
        preloadedQuizzes: { 'MULTIPLE_CHOICE_MEANING': null, 'FILL_IN_THE_BLANK': null, 'MULTIPLE_CHOICE_DEFINITION': null, 'LISTENING_QUIZ': null },
    isPreloading: { 'MULTIPLE_CHOICE_MEANING': false, 'FILL_IN_THE_BLANK': false, 'MULTIPLE_CHOICE_DEFINITION': false, 'LISTENING_QUIZ': false },
        currentRangeInputTarget: null,
        isFinalResult: false,
    },
    elements: {},
    init() {
        this.elements = {
            quizSelectionScreen: document.getElementById('quiz-selection-screen'),
            startMeaningQuizBtn: document.getElementById('start-meaning-quiz-btn'),
            startBlankQuizBtn: document.getElementById('start-blank-quiz-btn'),
            startDefinitionQuizBtn: document.getElementById('start-definition-quiz-btn'),
            startListeningQuizBtn: document.getElementById('start-listening-quiz-btn'),
            startMixedQuizBtn: document.getElementById('start-mixed-quiz-btn'),
            mixedTypeButtons: Array.from(document.querySelectorAll('.mixed-type-btn')),
            loader: document.getElementById('quiz-loader'),
            loaderText: document.getElementById('quiz-loader-text'),
            contentContainer: document.getElementById('quiz-content-container'),
            questionDisplay: document.getElementById('quiz-question-display'),
            choices: document.getElementById('quiz-choices'),
            modal: document.getElementById('quiz-result-modal'),
            modalScore: document.getElementById('quiz-result-score'),
            modalMistakesBtn: document.getElementById('quiz-result-mistakes-btn'),
            modalContinueBtn: document.getElementById('quiz-result-continue-btn'),
            quizRangeStart: document.getElementById('quiz-range-start'),
            quizRangeEnd: document.getElementById('quiz-range-end'),
            quizRangeLabel: document.getElementById('quiz-range-label'),
            rangeInputModal: document.getElementById('range-input-modal'),
            rangeInputLabel: document.getElementById('range-input-label'),
            rangeInputField: document.getElementById('range-input-field'),
            rangeInputCancelBtn: document.getElementById('range-input-cancel-btn'),
            rangeInputConfirmBtn: document.getElementById('range-input-confirm-btn'),
            finishedScreen: document.getElementById('quiz-finished-screen'),
            finishedMessage: document.getElementById('quiz-finished-message'),
        };
        this.bindEvents();
    },
    bindEvents() {
        this.elements.startMeaningQuizBtn.addEventListener('click', () => this.start('MULTIPLE_CHOICE_MEANING'));
        this.elements.startBlankQuizBtn.addEventListener('click', () => this.start('FILL_IN_THE_BLANK'));
                this.elements.startDefinitionQuizBtn.addEventListener('click', () => this.start('MULTIPLE_CHOICE_DEFINITION'));
        this.elements.startListeningQuizBtn.addEventListener('click', () => this.start('LISTENING_QUIZ'));
        this.elements.startMixedQuizBtn.addEventListener('click', () => this.start('MIXED'));
        this.elements.mixedTypeButtons.forEach(button => {
            button.addEventListener('click', () => this.toggleMixedType(button));
        });

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

        this.elements.modalContinueBtn.addEventListener('click', () => this.continueAfterResult());
        this.elements.modalMistakesBtn.addEventListener('click', () => this.reviewSessionMistakes());

document.addEventListener('keydown', (e) => {
            const isQuizModeActive = !this.elements.contentContainer.classList.contains('hidden') && !this.elements.choices.classList.contains('disabled');
            if (!isQuizModeActive) return;

            const choiceCount = Array.from(this.elements.choices.children).filter(el => !el.textContent.includes('PASS')).length;

            if (e.key === ' ') {
                e.preventDefault();
                const quizData = this.state.currentQuiz;
                if (!quizData || !quizData.question) return;

                const type = this.state.currentQuizType;
                if (type === 'MULTIPLE_CHOICE_MEANING') {
                    api.speak(quizData.question.word, 'word');
                } else if (type === 'FILL_IN_THE_BLANK') {
                    this._playBlankCloze(quizData.question.sentence_with_blank);
                } else if (type === 'MULTIPLE_CHOICE_DEFINITION') {
                    this._playDefinition(quizData.question.definition);
                } else if (type === 'LISTENING_QUIZ') {
                    this._playListeningCloze(quizData.question.sentence, quizData.question.word);
                }
                return;
            }

            if (e.key.toLowerCase() === 'p' || e.key === '0') {
                 e.preventDefault();
                 const passButton = Array.from(this.elements.choices.children).find(el => el.textContent.includes('PASS'));
                 if(passButton) passButton.click();
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
        const mixedTypes = this.elements.mixedTypeButtons
            .filter(button => button.getAttribute('aria-pressed') === 'true')
            .map(button => button.dataset.quizType);
        if (quizType === 'MIXED' && mixedTypes.length < 2) {
            emit.toast('혼합할 퀴즈 유형을 두 개 이상 선택하세요.', true);
            return;
        }
        this.configureSession({
            mixed: quizType === 'MIXED',
            mixedTypes
        });
        if (quizType !== 'MIXED') {
            this.state.sessionMode = 'SINGLE';
            this.state.currentQuizType = quizType;
        }
        emit.navigate('quiz-play');
    },
    toggleMixedType(button) {
        const selected = button.getAttribute('aria-pressed') === 'true';
        button.setAttribute('aria-pressed', String(!selected));
    },
    configureSession(options = {}) {
        if (options.reviewItems?.length) {
            this.state.sessionMode = 'REVIEW';
            this.state.reviewQueue = [...options.reviewItems];
            this.state.sessionLimit = this.state.reviewQueue.length;
            this.state.currentQuizType = this.state.reviewQueue[0].quizType;
            return;
        }
        this.state.reviewQueue = [];
        this.state.sessionLimit = 10;
        this.state.sessionMode = options.mixed ? 'MIXED' : 'SINGLE';
        this.state.mixedQuizTypes = options.mixed && options.mixedTypes?.length
            ? [...options.mixedTypes]
            : [];
        if (options.mixed) this.state.currentQuizType = this._pickMixedQuizType();
    },
    _pickMixedQuizType() {
        const types = this.state.mixedQuizTypes;
        return types[Math.floor(Math.random() * types.length)];
    },
    reset(showSelection = true) {
        this.state.currentQuiz = {};
        this.state.sessionAnsweredInSet = 0;
        this.state.sessionCorrectInSet = 0;
        this.state.sessionMistakes = [];
        if (showSelection) {
            this.state.answeredWords.clear();
            this.state.currentQuizType = null;
            this.state.sessionMode = 'SINGLE';
            this.state.reviewQueue = [];
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
        if (this.elements.modal) this.elements.modal.classList.add('hidden');

        if (showSelection) {
            this.updateRangeInputs();
        }
    },
    async updateRangeInputs() {
        let startValue = 1;
        let endValue = 1;
        let totalWords = 1;

        try {
            if (!state.isWordListReady) {
                await api.loadWordList();
            }
            totalWords = state.wordList?.length || 1;
            endValue = totalWords;

            const startStorageKey = state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START;
            const endStorageKey = state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END;

            const savedStart = localStorage.getItem(startStorageKey);
            const savedEnd = localStorage.getItem(endStorageKey);

            if (savedStart !== null) {
                const parsedStart = parseInt(savedStart);
                if (!isNaN(parsedStart) && parsedStart >= 1 && parsedStart <= totalWords) {
                    startValue = parsedStart;
                } else {
                    localStorage.removeItem(startStorageKey);
                }
            }
            if (savedEnd !== null) {
                const parsedEnd = parseInt(savedEnd);
                if (!isNaN(parsedEnd) && parsedEnd >= 1 && parsedEnd <= totalWords) {
                    endValue = parsedEnd;
                } else {
                     localStorage.removeItem(endStorageKey);
                }
            }
        } catch (error) {
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
promptForRangeValue(targetButton) {
        if (!targetButton) return;
        this.state.currentRangeInputTarget = targetButton;
        const isStart = targetButton.id === 'quiz-range-start';
        const min = parseInt(targetButton.dataset.min) || 1;
        const max = parseInt(targetButton.dataset.max) || 1;

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

        const min = parseInt(targetButton.dataset.min) || 1;
        const max = parseInt(targetButton.dataset.max) || 1;
        const newValueStr = this.elements.rangeInputField.value;

        if (newValueStr !== null && newValueStr.trim() !== '') {
            let newValue = parseInt(newValueStr);
            if (!isNaN(newValue)) {
                newValue = Math.max(min, Math.min(max, newValue));
                targetButton.textContent = newValue;

                const storageKey = targetButton.id === 'quiz-range-start'
                                   ? state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START
                                   : state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END;
                try {
                    localStorage.setItem(storageKey, newValue);
                    this.clearAndPreloadQuizzesForNewRange();
                } catch (e) {
                    console.error("Error saving quiz range to localStorage", e);
                }
            } else {
                emit.toast("숫자만 입력 가능합니다.", true);
            }
        }
        this.hideRangeInput();
    },
    resetQuizRange() {
        const allWords = state.wordList || [];
        const totalWords = allWords.length > 0 ? allWords.length : 1;
        this.elements.quizRangeStart.textContent = 1;
        this.elements.quizRangeEnd.textContent = totalWords;
        try {
            localStorage.setItem(state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START, 1);
            localStorage.setItem(state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END, totalWords);
            this.clearAndPreloadQuizzesForNewRange();
        } catch (e) { console.error(e); }
    },
    clearAndPreloadQuizzesForNewRange() {
        const quizTypes = Object.keys(this.state.preloadedQuizzes);
        quizTypes.forEach(quizType => {
            this.state.preloadedQuizzes[quizType] = null;
            this.state.isPreloading[quizType] = false;
        });
        this.preloadAllQuizTypesBasedOnSavedRange();
    },
    async displayNextQuiz() {
        this.showLoader(true, "다음 문제 생성 중...");
        let nextQuiz = null;
        if (this.state.sessionMode === 'MIXED') {
            this.state.currentQuizType = this._pickMixedQuizType();
        }
        const type = this.state.currentQuizType;
        let preloaded = this.state.preloadedQuizzes[type];
        if (this.state.sessionMode !== 'SINGLE') preloaded = null;

        if (preloaded) {
            const allWords = state.wordList || [];
            const startVal = parseInt(this.elements.quizRangeStart.textContent) || 1;
            const endVal = parseInt(this.elements.quizRangeEnd.textContent) || allWords.length;
            const startNum = Math.min(startVal, endVal);
            const endNum = Math.max(startVal, endVal);
            const startIndex = Math.max(0, startNum - 1);
            const endIndex = Math.min(allWords.length - 1, endNum - 1);
            const wordIndex = allWords.findIndex(w => w.word === preloaded.question.word);

            if (wordIndex < startIndex || wordIndex > endIndex) preloaded = null;
            if (preloaded && this.state.answeredWords.has(preloaded.question.word)) preloaded = null;
            if (preloaded && !this.state.isPracticeMode) {
                 const status = utils.getWordStatus(preloaded.question.word);
                 if (status === 'learned') preloaded = null;
            }
        }

        if (preloaded) {
            nextQuiz = preloaded;
            this.state.preloadedQuizzes[type] = null;
            this.preloadNextQuiz(type, nextQuiz.question.word);
        }

        if (!nextQuiz) {
            nextQuiz = await this.generateSingleQuiz();
            if (nextQuiz && this.state.sessionMode === 'SINGLE') this.preloadNextQuiz(type, nextQuiz.question.word);
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
                  const destination = this.state.sessionMode === 'REVIEW' ? 'selection' : 'quiz';
                  setTimeout(() => emit.navigate(destination), 800);
            }
        }
    },
    _getWordRange(allWords, rangeOverride = null) {
        let startVal, endVal;
        if (rangeOverride) {
            startVal = rangeOverride.start;
            endVal   = rangeOverride.end;
        } else {
            startVal = parseInt(this.elements.quizRangeStart.textContent) || 1;
            endVal   = parseInt(this.elements.quizRangeEnd.textContent)   || allWords.length;
        }
        const startNum = Math.min(startVal, endVal);
        const endNum   = Math.max(startVal, endVal);
        return {
            startIndex: Math.max(0, startNum - 1),
            endIndex:   Math.min(allWords.length - 1, endNum - 1)
        };
    },

    _buildDistractors(correctWordData, allWordsData, valueKey, allowFallbacks = false, valueSelector = null) {
        const readValue = valueSelector || ((wordData) => wordData[valueKey]);
        const correctValue = readValue(correctWordData);
        if (correctValue === undefined || correctValue === null || String(correctValue).trim() === '') return null;

        const wrongAnswers = new Set();
        const isInvalidDistractor = (wordData) => {
            const value = readValue(wordData);
            return value === undefined
                || value === null
                || String(value).trim() === ''
                || value === correctValue;
        };

        const samePosDistractors = utils.pickRandomItems(allWordsData, 10,
            (w) => w.pos !== correctWordData.pos || isInvalidDistractor(w)
        );
        samePosDistractors.forEach(w => wrongAnswers.add(readValue(w)));

        if (wrongAnswers.size < 3) {
            const randomDistractors = utils.pickRandomItems(allWordsData, 10,
                (w) => isInvalidDistractor(w) || wrongAnswers.has(readValue(w))
            );
            randomDistractors.forEach(w => wrongAnswers.add(readValue(w)));
        }

        if (wrongAnswers.size < 3) {
            if (allowFallbacks && allWordsData.length < 4) {
                ['오답1', '오답2', '오답3'].forEach(d => wrongAnswers.add(d));
            } else {
                return null;
            }
        }
        return wrongAnswers;
    },

    // 출제 범위 내에서 풀 자격이 있는 후보 단어를 선별해 셔플 후 반환.
    // wordToExclude: 직전 출제어 제외(프리로드용), rangeOverride: 범위 강제 지정.
    _collectQuizCandidates(quizType, { wordToExclude = null, rangeOverride = null } = {}) {
        const allWords = state.wordList || [];
        if (allWords.length === 0) return { allWords, candidates: [] };

        const { startIndex, endIndex } = this._getWordRange(allWords, rangeOverride);
        const wordsInRange = allWords.slice(startIndex, endIndex + 1);
        if (wordsInRange.length === 0) return { allWords, candidates: [] };

        const unsynced = utils.getUnsyncedProgress();

        let candidates = wordsInRange.filter(wordObj => {
            const word = wordObj.word;
            if (wordObj.except === true) return false;
            if (wordToExclude && word === wordToExclude) return false;
            if (this.state.answeredWords.has(word)) return false;
            if (this.state.isPracticeMode) return true;
            if (unsynced[word] && unsynced[word][quizType] === 'correct') return false;
            const serverProgress = state.currentProgress[word];
            if (!unsynced[word] && serverProgress && serverProgress[quizType] === 'correct') return false;
            return true;
        });
        if (quizType === 'FILL_IN_THE_BLANK' || quizType === 'LISTENING_QUIZ') {
            candidates = candidates.filter(w => w.sample && w.sample.trim() !== '');
        }
        utils.shuffleArray(candidates);
        return { allWords, candidates };
    },

    // 후보 목록에서 첫 유효 퀴즈를 생성. 동기형(영한/빈칸)은 순차로,
    // 네트워크형(영영/듣기)은 5개씩 병렬 시도. exhaustive=false면 첫 배치(5개)만 시도(프리로드용).
    async _makeQuizFromCandidates(quizType, candidates, allWords, { exhaustive = true } = {}) {
        if (candidates.length === 0) return null;

        if (quizType === 'MULTIPLE_CHOICE_MEANING') {
            for (const w of candidates) { const q = this.createMeaningQuiz(w, allWords); if (q) return q; }
            return null;
        }
        if (quizType === 'FILL_IN_THE_BLANK') {
            for (const w of candidates) { const q = this.createBlankQuiz(w, allWords); if (q) return q; }
            return null;
        }

        const makeQuiz = (w) => quizType === 'MULTIPLE_CHOICE_DEFINITION'
            ? this.createDefinitionQuiz(w, allWords)
            : this.createListeningClozeQuiz(w, allWords);
        const BATCH_SIZE = 5;
        const limit = exhaustive ? candidates.length : Math.min(BATCH_SIZE, candidates.length);
        for (let i = 0; i < limit; i += BATCH_SIZE) {
            const batch = candidates.slice(i, i + BATCH_SIZE);
            try {
                return await Promise.any(batch.map(async (w) => {
                    const q = await makeQuiz(w);
                    if (!q) throw new Error('no-quiz');   // null은 실패로 간주
                    return q;
                }));
            } catch (_) {
                // 이 배치 전부 실패 → 다음 배치 시도
            }
        }
        return null;
    },

    async generateSingleQuiz() {
        if (this.state.sessionMode === 'REVIEW') {
            const allWords = state.wordList || [];
            while (this.state.reviewQueue.length > 0) {
                const { word, quizType } = this.state.reviewQueue.shift();
                const wordData = allWords.find(item => item.word === word);
                if (!wordData || utils.getCombinedProgress(word)[quizType] !== 'incorrect') continue;
                const quiz = await this._makeQuizFromCandidates(quizType, [wordData], allWords, { exhaustive: true });
                if (quiz) {
                    this.state.currentQuizType = quizType;
                    return quiz;
                }
            }
            return null;
        }
        const types = this.state.sessionMode === 'MIXED'
            ? utils.shuffleArray([...this.state.mixedQuizTypes])
            : [this.state.currentQuizType];

        for (const quizType of types) {
            const { allWords, candidates } = this._collectQuizCandidates(quizType);
            const quiz = await this._makeQuizFromCandidates(quizType, candidates, allWords, { exhaustive: true });
            if (quiz) {
                this.state.currentQuizType = quizType;
                return quiz;
            }
        }
        return null;
    },
    renderQuiz(quizData) {
        const { type, question, choices } = quizData;
        const questionDisplay = this.elements.questionDisplay;
        questionDisplay.innerHTML = '';
        questionDisplay.onclick = null;
        questionDisplay.removeAttribute('role');
        questionDisplay.removeAttribute('tabindex');
        questionDisplay.removeAttribute('aria-label');
        questionDisplay.className = 'bg-green-100 p-4 rounded-lg mb-4 flex min-h-[100px]';

        if (type === 'FILL_IN_THE_BLANK') {
            questionDisplay.classList.add('items-start', 'text-left', 'cursor-pointer');
            questionDisplay.setAttribute('role', 'button');
            questionDisplay.setAttribute('tabindex', '0');
            questionDisplay.setAttribute('aria-label', '빈칸 문장 듣기');
            questionDisplay.onclick = () => this._playBlankCloze(question.sentence_with_blank);
            const p = document.createElement('p');
            p.className = 'text-xl sm:text-2xl text-gray-800 leading-relaxed';
            const parts = question.sentence_with_blank.split('___BLANK___');
            parts.forEach((part, index) => {
                const textParts = part.split(/(\*.*?\*)/g);
                textParts.forEach(textPart => {
                    if (textPart.startsWith('*') && textPart.endsWith('*')) {
                        const strong = document.createElement('strong');
                        strong.textContent = textPart.slice(1, -1);
                        p.appendChild(strong);
                    } else if (textPart) {
                        p.appendChild(document.createTextNode(textPart));
                    }
                });

                if (index < parts.length - 1) {
                    const blankSpan = document.createElement('span');
                    blankSpan.className = 'quiz-blank inline-block font-mono text-blue-600';
                    blankSpan.textContent = '___________';
                    p.appendChild(blankSpan);
                }
            });
            questionDisplay.appendChild(p);
        } else if (type === 'MULTIPLE_CHOICE_MEANING') {
            questionDisplay.classList.add('items-center', 'justify-center');
            const h1 = document.createElement('h1');
            h1.id = 'quiz-word';
            h1.className = 'text-3xl sm:text-4xl font-bold text-center text-gray-800 cursor-pointer';
            h1.textContent = question.word;
            h1.onclick = () => { api.speak(question.word, 'word'); };
            questionDisplay.appendChild(h1);
        } else if (type === 'MULTIPLE_CHOICE_DEFINITION') {
            questionDisplay.classList.add('items-start', 'text-left', 'cursor-pointer');
            questionDisplay.setAttribute('role', 'button');
            questionDisplay.setAttribute('tabindex', '0');
            questionDisplay.setAttribute('aria-label', '영영풀이 듣기');
            questionDisplay.onclick = () => this._playDefinition(question.definition);
            const p = document.createElement('p');
            p.className = 'text-lg sm:text-xl text-gray-800 leading-relaxed';
            p.textContent = question.definition;
            questionDisplay.appendChild(p);
        } else if (type === 'LISTENING_QUIZ') {
        questionDisplay.classList.add('items-center', 'text-left', 'flex-row', 'gap-3');
        const replayBtn = document.createElement('button');
        replayBtn.id = 'listening-replay-btn';
        replayBtn.style.cssText = 'flex-shrink:0;width:2.4rem;height:2.4rem;border-radius:9999px;background:#ef4444;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.18s;';

        const replayText = document.createElement('span');
        replayText.style.cssText = 'font-weight:bold; font-size:16px; color:white;';
        replayText.textContent = 'T';
        replayBtn.appendChild(replayText);
        replayBtn.onmouseover = () => { replayBtn.style.background = '#dc2626'; };
        replayBtn.onmouseout  = () => { replayBtn.style.background = '#ef4444'; };

        replayBtn.onclick = (e) => {
            const escapedWord = utils.escapeRegExp(question.word);
            const regex = new RegExp(`\\b${escapedWord}\\b`, 'i');
            const blankedSentence = question.sentence.replace(regex, '___________');
            ui.showTranslationTooltip(blankedSentence, e);
        };
        replayBtn.onmouseleave = () => { ui.hideTranslationTooltip(); };

        const koreanP = document.createElement('p');
        koreanP.className = 'text-base text-gray-800 leading-relaxed cursor-pointer hover:text-blue-600 transition-colors';
        koreanP.textContent = question.korean;
        koreanP.onclick = () => this._playListeningCloze(question.sentence, question.word);

        questionDisplay.appendChild(replayBtn);
        questionDisplay.appendChild(koreanP);
        setTimeout(() => this._playListeningCloze(question.sentence, question.word), 1000);
    }
    this.elements.choices.innerHTML = '';
        choices.forEach((choice, index) => {
            const li = document.createElement('li');
            li.className = 'choice-item border-2 border-gray-300 py-3 px-4 rounded-lg cursor-pointer flex items-start transition-all text-lg hover:bg-blue-50';
            const indexSpan = document.createElement('span');
            indexSpan.className = 'font-bold mr-3 text-blue-600';
            indexSpan.textContent = `${index + 1}.`;
            const choiceSpan = document.createElement('span');
            choiceSpan.textContent = choice;
            li.append(indexSpan, choiceSpan);
            li._choice = choice;
            li.onclick = () => this.checkAnswer(li, choice);
            this.elements.choices.appendChild(li);
        });

        const passLi = document.createElement('li');
        passLi.className = 'choice-item p-4 rounded-lg cursor-pointer flex items-center justify-center transition-all font-bold text-lg';
        passLi.style.setProperty('background', '#ffe4e6CC', 'important');
        passLi.style.setProperty('color', '#1f2937', 'important');
        const passSpan = document.createElement('span');
        passSpan.textContent = 'PASS';
        passLi.appendChild(passSpan);
        passLi.onclick = () => this.checkAnswer(passLi, 'USER_PASSED');
        this.elements.choices.appendChild(passLi);
        this.elements.choices.classList.remove('disabled');
    },
    async checkAnswer(selectedLi, selectedChoice) {
        this.elements.choices.classList.add('disabled');
        const isCorrect = selectedChoice === this.state.currentQuiz.answer;
        const isPass = selectedChoice === 'USER_PASSED';
        const word = this.state.currentQuiz.question.word;
        const quizType = this.state.currentQuiz.type;

        this.state.answeredWords.add(word);
        selectedLi.classList.add(isCorrect ? 'correct' : 'incorrect');

        if (isCorrect && !isPass) playSequence(correctBeep);
        else playSequence(incorrectBeep);

        if (!isCorrect) {
            Array.from(this.elements.choices.children)
                 .find(li => li._choice === this.state.currentQuiz.answer)
                 ?.classList.add('correct');
             this.state.sessionMistakes.push(word);
        }

        this.state.sessionAnsweredInSet++;
        if (isCorrect && !isPass) this.state.sessionCorrectInSet++;

        if (!this.state.isPracticeMode) {
             await api.updateWordStatus(word, quizType, (isCorrect && !isPass) ? 'correct' : 'incorrect');
        }

        const delayTime = (isCorrect && !isPass) ? 1200 : 2000;

        setTimeout(() => {
            if (this.state.sessionAnsweredInSet >= this.state.sessionLimit) this.showSessionResultModal(true);
            else this.displayNextQuiz();
        }, delayTime);
    },
    showLoader(isLoading, message = '퀴즈를 준비 중입니다...') {
        this.elements.loader.classList.toggle('hidden', !isLoading);
        this.elements.loaderText.textContent = message;
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
        this.elements.modalScore.textContent = `${this.state.sessionAnsweredInSet}문제 중 ${this.state.sessionCorrectInSet}개 정답!`;
        this.elements.modalMistakesBtn.classList.toggle('hidden', this.state.sessionMistakes.length === 0);
        this.state.isFinalResult = isFinal;
        this.elements.modalContinueBtn.textContent = isFinal
            ? (this.state.sessionMode === 'REVIEW' ? "홈으로" : "퀴즈 유형으로")
            : "다음 퀴즈 계속";
        this.elements.modal.classList.remove('hidden');
    },
    continueAfterResult() {
        this.elements.modal.classList.add('hidden');
        if (this.state.isFinalResult) {
            const destination = this.state.sessionMode === 'REVIEW' ? 'selection' : 'quiz';
            emit.sync();
            emit.navigate(destination);
            return;
        }
        this.state.sessionAnsweredInSet = 0;
        this.state.sessionCorrectInSet = 0;
        this.state.sessionMistakes = [];
        this.displayNextQuiz();
    },
    reviewSessionMistakes() {
        this.elements.modal.classList.add('hidden');
        const mistakes = [...new Set(this.state.sessionMistakes)];
        this.state.sessionAnsweredInSet = 0;
        this.state.sessionCorrectInSet = 0;
        this.state.sessionMistakes = [];
        emit.sync();
        emit.navigate('mistakeReview', { mistakeWords: mistakes });
    },

    // 저장된 범위 값을 읽어 [1..totalWords]로 검증. 유효하면 숫자, 아니면 null.
    _readValidRangeValue(key, totalWords) {
        const saved = localStorage.getItem(key);
        if (saved === null) return null;
        const parsed = parseInt(saved);
        return (!isNaN(parsed) && parsed >= 1 && parsed <= totalWords) ? parsed : null;
    },

    async preloadAllQuizTypesBasedOnSavedRange() {
        if (!state.isWordListReady) {
            try { await api.loadWordList(); } catch (e) { return; }
        }

        let startValue = 1;
        let endValue = state.wordList.length;
        try {
            const totalWords = state.wordList.length || 1;
            const s = this._readValidRangeValue(state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START, totalWords);
            const e = this._readValidRangeValue(state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END, totalWords);
            if (s !== null) startValue = s;
            if (e !== null) endValue = e;
        } catch(e) { console.warn("Error reading saved range for initial preload:", e); }

        const quizTypes = Object.keys(this.state.preloadedQuizzes);
        for (const type of quizTypes) {
            this.preloadNextQuiz(type, null, { start: startValue, end: endValue });
        }
    },
    async preloadNextQuiz(quizType, wordToExclude = null, rangeOverride = null) {
        if (this.state.isPreloading[quizType] || this.state.preloadedQuizzes[quizType]) return;

        this.state.isPreloading[quizType] = true;
        try {
            const quiz = await this._generateSingleQuizForPreload(quizType, wordToExclude, rangeOverride);
            if (quiz) this.state.preloadedQuizzes[quizType] = quiz;
        } catch (error) {
            console.warn(`Preloading quiz type ${quizType} failed:`, error);
        } finally {
            this.state.isPreloading[quizType] = false;
        }
    },
    async _generateSingleQuizForPreload(quizType, wordToExclude = null, rangeOverride = null) {
        const { allWords, candidates } = this._collectQuizCandidates(quizType, { wordToExclude, rangeOverride });
        // 프리로드는 1개만 있으면 되므로 네트워크형도 첫 배치(5개)만 시도
        return this._makeQuizFromCandidates(quizType, candidates, allWords, { exhaustive: false });
    },
    createMeaningQuiz(correctWordData, allWordsData) {
        const getFirstMeaningLine = (wordData) => this._getFirstMeaningLine(wordData.meaning);
        const correctMeaning = getFirstMeaningLine(correctWordData);
        if (!correctMeaning) return null;

        const wrongAnswers = this._buildDistractors(
            correctWordData,
            allWordsData,
            'meaning',
            true,
            getFirstMeaningLine
        );
        if (!wrongAnswers) return null;
        const choices = utils.shuffleArray([correctMeaning, ...Array.from(wrongAnswers).slice(0, 3)]);
        return { type: 'MULTIPLE_CHOICE_MEANING', question: { word: correctWordData.word }, choices, answer: correctMeaning };
    },
    // 학습 카드의 전체 뜻은 보존하고, 영한 퀴즈 보기에서만 첫 줄의 일반 텍스트를 사용한다.
    _getFirstMeaningLine(meaning) {
        const plainText = utils.richHtmlToPlainText(meaning).replace(/\u00a0/g, ' ');
        const firstLine = (plainText.split(/\r\n?|\n/, 1)[0] || '').trim();
        return firstLine.replace(/[,;:，；：]+\s*$/, '').trimEnd();
    },
    // 예문 첫 줄을 정리(이모지/강조 제거)하고 표제어 포함 여부를 확인.
    // 미포함이면 null, 포함이면 {firstLine, placeholderRegex} 반환.
    _prepareClozeSentence(wordData) {
        if (!wordData.sample || !wordData.sample.trim()) return null;
        const firstLine = wordData.sample.split('\n')[0]
            .replace(EMOJI_REGEX, '')
            .replace(/\*/g, '').trim();
        const placeholderRegex = new RegExp(`\\b${utils.escapeRegExp(wordData.word)}\\b`, 'i');
        if (!firstLine.match(placeholderRegex)) return null;
        return { firstLine, placeholderRegex };
    },
    createBlankQuiz(correctWordData, allWordsData) {
        const prepared = this._prepareClozeSentence(correctWordData);
        if (!prepared) return null;
        const { firstLine, placeholderRegex } = prepared;
        const sentenceWithBlank = firstLine.replace(placeholderRegex, "___BLANK___").trim();

        const wrongAnswers = this._buildDistractors(correctWordData, allWordsData, 'word', false);
        if (!wrongAnswers) return null;
        const choices = utils.shuffleArray([correctWordData.word, ...Array.from(wrongAnswers).slice(0, 3)]);
        return { type: 'FILL_IN_THE_BLANK', question: { sentence_with_blank: sentenceWithBlank, word: correctWordData.word }, choices, answer: correctWordData.word };
    },
        async createDefinitionQuiz(correctWordData, allWordsData) {
        const definition = await api.fetchDefinition(correctWordData.word);
        if (!definition) return null;
        const wrongAnswers = this._buildDistractors(correctWordData, allWordsData, 'word', false);
        if (!wrongAnswers) return null;
        const choices = utils.shuffleArray([correctWordData.word, ...Array.from(wrongAnswers).slice(0, 3)]);
        return { type: 'MULTIPLE_CHOICE_DEFINITION', question: { definition, word: correctWordData.word }, choices, answer: correctWordData.word };
    },

    async createListeningClozeQuiz(correctWordData, allWordsData) {
        const prepared = this._prepareClozeSentence(correctWordData);
        if (!prepared) return null;
        const { firstLine } = prepared;
        const koreanMeaning = await api.translate(firstLine);
        if (!koreanMeaning || koreanMeaning.includes('실패') || koreanMeaning.includes('오류')) return null;
        const wrongAnswers = this._buildDistractors(correctWordData, allWordsData, 'word', false);
        if (!wrongAnswers) return null;
        const choices = utils.shuffleArray([correctWordData.word, ...Array.from(wrongAnswers).slice(0, 3)]);
        return {
            type: 'LISTENING_QUIZ',
            question: { sentence: firstLine, korean: koreanMeaning, word: correctWordData.word },
            choices,
            answer: correctWordData.word
        };
    },

    _playBlankCloze(sentenceWithBlank) {
        const modified = sentenceWithBlank.replace('___BLANK___', '; blank ;');
        return api.speak(modified, 'sample');
    },

    _playDefinition(definition) {
        return api.speak(definition, 'sample');
    },

    _playListeningCloze(sentence, word) {
        const btn = document.getElementById('listening-replay-btn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
        const enableBtn = () => { if (btn) { btn.disabled = false; btn.style.opacity = '1'; } };

        const escapedWord = utils.escapeRegExp(word);
        const regex = new RegExp(`\\b${escapedWord}\\b`, 'i');
        const modified = sentence.replace(regex, '; blank ;');

        api.speak(modified, 'sample').finally(enableBtn);
    }
};
