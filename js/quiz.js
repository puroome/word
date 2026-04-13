import { state } from './config.js';
import { api } from './api.js';
import { utils, playSequence, playSingleBeep, correctBeep, incorrectBeep } from './utils.js';
export const quizMode = {
    state: {
        currentQuiz: {},
        currentQuizType: null,
        isPracticeMode: false,
        sessionAnsweredInSet: 0,
        sessionCorrectInSet: 0,
        sessionMistakes: [],
        answeredWords: new Set(),
        preloadedQuizzes: { 'MULTIPLE_CHOICE_MEANING': null, 'FILL_IN_THE_BLANK': null, 'MULTIPLE_CHOICE_DEFINITION': null, 'LISTENING_QUIZ': null },
    isPreloading: { 'MULTIPLE_CHOICE_MEANING': false, 'FILL_IN_THE_BLANK': false, 'MULTIPLE_CHOICE_DEFINITION': false, 'LISTENING_QUIZ': false },
        currentRangeInputTarget: null,
        isFinalResult: false,  // [BUG-3] 텍스트 문자열 비교 대신 사용하는 플래그
    },
    elements: {},
    init() {
        this.elements = {
            quizSelectionScreen: document.getElementById('quiz-selection-screen'),
            startMeaningQuizBtn: document.getElementById('start-meaning-quiz-btn'),
            startBlankQuizBtn: document.getElementById('start-blank-quiz-btn'),
            startDefinitionQuizBtn: document.getElementById('start-definition-quiz-btn'),
            startListeningQuizBtn: document.getElementById('start-listening-quiz-btn'),
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
        this.state.currentQuizType = quizType;
        window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'quiz-play' } }));
    },
    reset(showSelection = true) {
        this.state.currentQuiz = {};
        this.state.sessionAnsweredInSet = 0;
        this.state.sessionCorrectInSet = 0;
        this.state.sessionMistakes = [];
        if (showSelection) {
            this.state.answeredWords.clear();
            this.state.currentQuizType = null;
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
                // [UX-1] alert() 대신 커스텀 toast 사용 (앱 전체 UX 일관성)
                window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "숫자만 입력 가능합니다.", isError: true } }));
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
        const type = this.state.currentQuizType;
        let preloaded = this.state.preloadedQuizzes[type];

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
            if (nextQuiz) this.preloadNextQuiz(type, nextQuiz.question.word);
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
                 setTimeout(() => window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'quiz' } })), 800);
            }
        }
    },
    // --- 공통 헬퍼 ---
    // 범위 파라리터(rangeOverride 또는 DOM)로부터 { startIndex, endIndex }를 계산
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

    // 오답(distractor) Set을 구성하는 공통 로직
    // valueKey: 오답으로 사용할 필드명 ('meaning' 또는 'word')
    // allowFallbacks: 데이터 부족 시 더미 답변 허용 여부 (MeaningQuiz에서만 true)
    _buildDistractors(correctWordData, allWordsData, valueKey, allowFallbacks = false) {
        const correctValue = correctWordData[valueKey];
        const wrongAnswers = new Set();

        // 같은 품사 우선 (최적화된 랜덤 선택)
        const samePosDistractors = utils.pickRandomItems(allWordsData, 10,
            (w) => w.pos !== correctWordData.pos || w[valueKey] === correctValue
        );
        samePosDistractors.forEach(w => wrongAnswers.add(w[valueKey]));

        // 부족하면 임의 단어 추가
        if (wrongAnswers.size < 3) {
            const randomDistractors = utils.pickRandomItems(allWordsData, 10,
                (w) => w[valueKey] === correctValue || wrongAnswers.has(w[valueKey])
            );
            randomDistractors.forEach(w => wrongAnswers.add(w[valueKey]));
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

    async generateSingleQuiz() {
        const allWords = state.wordList || [];
        if (allWords.length === 0) return null;

        const { startIndex, endIndex } = this._getWordRange(allWords);
        const wordsInRange = allWords.slice(startIndex, endIndex + 1);
        if (wordsInRange.length === 0) return null;

        const currentQuizType = this.state.currentQuizType;
        const unsynced = utils.getUnsyncedProgress();

        let candidates = wordsInRange.filter(wordObj => {
            const word = wordObj.word;
            if (this.state.answeredWords.has(word)) return false;
            if (this.state.isPracticeMode) return true;
            if (unsynced[word] && unsynced[word][currentQuizType] === 'correct') return false;
            const serverProgress = state.currentProgress[word];
            if (!unsynced[word] && serverProgress && serverProgress[currentQuizType] === 'correct') return false;
            return true;
        });
        if (currentQuizType === 'FILL_IN_THE_BLANK' || currentQuizType === 'LISTENING_QUIZ') {
            candidates = candidates.filter(w => w.sample && w.sample.trim() !== '');
        }
        if (candidates.length === 0) return null;
        utils.shuffleArray(candidates);
        for (const wordData of candidates) {
            let quiz = null;
            if (currentQuizType === 'MULTIPLE_CHOICE_MEANING') quiz = this.createMeaningQuiz(wordData, allWords);
            else if (currentQuizType === 'FILL_IN_THE_BLANK') quiz = this.createBlankQuiz(wordData, allWords);
            else if (currentQuizType === 'MULTIPLE_CHOICE_DEFINITION') quiz = await this.createDefinitionQuiz(wordData, allWords);
            else if (currentQuizType === 'LISTENING_QUIZ') quiz = await this.createListeningClozeQuiz(wordData, allWords);
            if (quiz) return quiz;
        }
        return null;
    },
    renderQuiz(quizData) {
        const { type, question, choices } = quizData;
        const questionDisplay = this.elements.questionDisplay;
        questionDisplay.innerHTML = '';
        questionDisplay.className = 'bg-green-100 p-4 rounded-lg mb-4 flex min-h-[100px]';

        if (type === 'FILL_IN_THE_BLANK') {
            questionDisplay.classList.add('items-start', 'text-left');
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
            questionDisplay.innerHTML = `<h1 id="quiz-word" class="text-3xl sm:text-4xl font-bold text-center text-gray-800 cursor-pointer">${question.word}</h1>`;
            questionDisplay.querySelector('#quiz-word').onclick = () => { api.speak(question.word, 'word'); };
            } else if (type === 'MULTIPLE_CHOICE_DEFINITION') {
        questionDisplay.classList.add('items-start', 'text-left');
        questionDisplay.innerHTML = `<p class="text-lg sm:text-xl text-gray-800 leading-relaxed">${question.definition}</p>`;
    } else if (type === 'LISTENING_QUIZ') {
        questionDisplay.classList.add('items-center', 'text-left', 'flex-row', 'gap-3');
        const replayBtn = document.createElement('button');
        replayBtn.id = 'listening-replay-btn';
        replayBtn.title = '다시 듣기';
        replayBtn.style.cssText = 'flex-shrink:0;width:2.4rem;height:2.4rem;border-radius:9999px;background:#ef4444;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.18s;';
        replayBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="white"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;
        replayBtn.onmouseover = () => { replayBtn.style.background = '#dc2626'; };
        replayBtn.onmouseout  = () => { replayBtn.style.background = '#ef4444'; };
        replayBtn.onclick = () => this._playListeningCloze(question.sentence, question.word);
        const koreanP = document.createElement('p');
        koreanP.className = 'text-base text-gray-800 leading-relaxed';
        koreanP.textContent = question.korean;
        questionDisplay.appendChild(replayBtn);
        questionDisplay.appendChild(koreanP);
        setTimeout(() => this._playListeningCloze(question.sentence, question.word), 1000);
    }
    this.elements.choices.innerHTML = '';
        choices.forEach((choice, index) => {
            const li = document.createElement('li');
            li.className = 'choice-item border-2 border-gray-300 py-3 px-4 rounded-lg cursor-pointer flex items-start transition-all text-lg hover:bg-blue-50';
            li.innerHTML = `<span class="font-bold mr-3 text-blue-600">${index + 1}.</span> <span>${choice}</span>`;
            li.onclick = () => this.checkAnswer(li, choice);
            this.elements.choices.appendChild(li);
        });

        const passLi = document.createElement('li');
        passLi.className = 'choice-item p-4 rounded-lg cursor-pointer flex items-center justify-center transition-all font-bold text-lg';
        passLi.style.setProperty('background', '#ffe4e6CC', 'important'); /* 80% 투명도 적용 */
        passLi.style.setProperty('color', '#1f2937', 'important'); /* 검정색 텍스트 */
        passLi.innerHTML = `<span>PASS</span>`;
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
                 .find(li => li.textContent.includes(this.state.currentQuiz.answer))
                 ?.classList.add('correct');
             if (!isPass) this.state.sessionMistakes.push(word);
        }

        this.state.sessionAnsweredInSet++;
        if (isCorrect && !isPass) this.state.sessionCorrectInSet++;

        if (!this.state.isPracticeMode) {
             await api.updateWordStatus(word, quizType, (isCorrect && !isPass) ? 'correct' : 'incorrect');
        }

        setTimeout(() => {
            if (this.state.sessionAnsweredInSet >= 10) this.showSessionResultModal();
            else this.displayNextQuiz();
        }, 1200);
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
        this.state.isFinalResult = isFinal;  // [BUG-3] 플래그로 상태 관리
        this.elements.modalContinueBtn.textContent = isFinal ? "퀴즈 유형으로" : "다음 퀴즈 계속";
        this.elements.modal.classList.remove('hidden');
    },
    continueAfterResult() {
        this.elements.modal.classList.add('hidden');
        if (this.state.isFinalResult) {  // [BUG-3] 문자열 비교 대신 플래그 사용
            window.dispatchEvent(new CustomEvent('syncRequest'));
            window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'quiz' } }));
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
        window.dispatchEvent(new CustomEvent('syncRequest'));
        window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'mistakeReview', options: { mistakeWords: mistakes } } }));
    },
    async preloadAllQuizTypesBasedOnSavedRange() {
        if (!state.isWordListReady) {
            try { await api.loadWordList(); } catch (e) { return; }
        }

        let startValue = 1;
        let endValue = state.wordList.length;
        try {
            const savedStart = localStorage.getItem(state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START);
            const savedEnd = localStorage.getItem(state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END);
            const totalWords = state.wordList.length || 1;

            if (savedStart !== null) {
                const parsedStart = parseInt(savedStart);
                if (!isNaN(parsedStart) && parsedStart >= 1 && parsedStart <= totalWords) startValue = parsedStart;
            }
            if (savedEnd !== null) {
                const parsedEnd = parseInt(savedEnd);
                if (!isNaN(parsedEnd) && parsedEnd >= 1 && parsedEnd <= totalWords) endValue = parsedEnd;
            }
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
        const allWords = state.wordList || [];
        if (allWords.length === 0) return null;

        const { startIndex, endIndex } = this._getWordRange(allWords, rangeOverride);
        const wordsInRange = allWords.slice(startIndex, endIndex + 1);
        if (wordsInRange.length === 0) return null;

        const unsynced = utils.getUnsyncedProgress();

        let candidates = wordsInRange.filter(wordObj => {
            const word = wordObj.word;
            if (word === wordToExclude) return false;
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
        if (candidates.length === 0) return null;
        utils.shuffleArray(candidates);
        const wordData = candidates[0];
        if (quizType === 'MULTIPLE_CHOICE_MEANING') return this.createMeaningQuiz(wordData, allWords);
        if (quizType === 'FILL_IN_THE_BLANK') return this.createBlankQuiz(wordData, allWords);
        if (quizType === 'MULTIPLE_CHOICE_DEFINITION') return await this.createDefinitionQuiz(wordData, allWords);
        if (quizType === 'LISTENING_QUIZ') return await this.createListeningClozeQuiz(wordData, allWords);
        return null;
    },
    createMeaningQuiz(correctWordData, allWordsData) {
        const wrongAnswers = this._buildDistractors(correctWordData, allWordsData, 'meaning', true);
        if (!wrongAnswers) return null;
        const choices = utils.shuffleArray([correctWordData.meaning, ...Array.from(wrongAnswers).slice(0, 3)]);
        return { type: 'MULTIPLE_CHOICE_MEANING', question: { word: correctWordData.word }, choices, answer: correctWordData.meaning };
    },
    createBlankQuiz(correctWordData, allWordsData) {
        if (!correctWordData.sample || !correctWordData.sample.trim()) return null;

        const firstLine = correctWordData.sample.split('\n')[0]
            .replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA70}-\u{1FAFF}]/gu, "")
            .replace(/\*/g, '').trim();

        const placeholderRegex = new RegExp(`\\b${correctWordData.word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        if (!firstLine.match(placeholderRegex)) return null;
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
        if (!correctWordData.sample || !correctWordData.sample.trim()) return null;
        const firstLine = correctWordData.sample.split('\n')[0]
            .replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA70}-\u{1FAFF}]/gu, '')
            .replace(/\*/g, '').trim();
        const placeholderRegex = new RegExp(`\\b${correctWordData.word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        if (!firstLine.match(placeholderRegex)) return null;
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

    _playListeningCloze(sentence, word) {
        const btn = document.getElementById('listening-replay-btn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
        const enableBtn = () => { if (btn) { btn.disabled = false; btn.style.opacity = '1'; } };

        const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedWord}\\b`, 'i');
        const modified = sentence.replace(regex, ', blank, ');

        api.speak(modified, 'sample').finally(enableBtn);
    }
};
