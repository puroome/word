import { state } from './config.js';
import { api } from './api.js';
import { utils, correctBeep, incorrectBeep } from './utils.js';

export const quizMode = {
    state: {
        currentQuiz: {},
        currentQuizType: null,
        isPracticeMode: false,
        sessionAnsweredInSet: 0,
        sessionCorrectInSet: 0,
        sessionMistakes: [],
        answeredWords: new Set(),
        
        // 퀴즈 데이터 캐싱
        preloadedQuizzes: {
            'MULTIPLE_CHOICE_MEANING': null,
            'FILL_IN_THE_BLANK': null,
            'MULTIPLE_CHOICE_DEFINITION': null
        },
        isPreloading: {
            'MULTIPLE_CHOICE_MEANING': false,
            'FILL_IN_THE_BLANK': false,
            'MULTIPLE_CHOICE_DEFINITION': false
        },
        
        // Lifecycle 상태
        mounted: false,
        isProcessingAnswer: false, 
    },

    elements: {},
    handlers: {}, 

    init() {
        this.elements = {
            quizSelectionScreen: document.getElementById('quiz-selection-screen'),
            startMeaningQuizBtn: document.getElementById('start-meaning-quiz-btn'),
            startBlankQuizBtn: document.getElementById('start-blank-quiz-btn'),
            startDefinitionQuizBtn: document.getElementById('start-definition-quiz-btn'),
            loader: document.getElementById('quiz-loader'),
            loaderText: document.getElementById('quiz-loader-text'),
            contentContainer: document.getElementById('quiz-content-container'),
            questionDisplay: document.getElementById('quiz-question-display'),
            choicesContainer: document.getElementById('quiz-choices-container'),
            resultMessage: document.getElementById('quiz-result-message'),
            quizStats: document.getElementById('quiz-stats'),
            correctCountEl: document.getElementById('quiz-correct-count'),
            totalCountEl: document.getElementById('quiz-total-count'),
            // 범위 설정 요소
            quizRangeStart: document.getElementById('quiz-range-start'),
            quizRangeEnd: document.getElementById('quiz-range-end'),
            quizRangeTotal: document.getElementById('quiz-range-total'),
        };

        // 핸들러 바인딩
        this.handlers.startMeaningQuiz = () => this.startQuiz('MULTIPLE_CHOICE_MEANING');
        this.handlers.startBlankQuiz = () => this.startQuiz('FILL_IN_THE_BLANK');
        this.handlers.startDefinitionQuiz = () => this.startQuiz('MULTIPLE_CHOICE_DEFINITION');
        this.handlers.inputRange = (e) => this.validateRangeInput(e);
        this.handlers.blurRange = () => this.saveRangeSettings();
        this.handlers.globalKeydown = (e) => this.handleKeyDown(e);

        // 이벤트 리스너 등록
        if (this.elements.startMeaningQuizBtn) this.elements.startMeaningQuizBtn.addEventListener('click', this.handlers.startMeaningQuiz);
        if (this.elements.startBlankQuizBtn) this.elements.startBlankQuizBtn.addEventListener('click', this.handlers.startBlankQuiz);
        if (this.elements.startDefinitionQuizBtn) this.elements.startDefinitionQuizBtn.addEventListener('click', this.handlers.startDefinitionQuiz);

        if (this.elements.quizRangeStart && this.elements.quizRangeEnd) {
            this.elements.quizRangeStart.addEventListener('input', this.handlers.inputRange);
            this.elements.quizRangeEnd.addEventListener('input', this.handlers.inputRange);
            this.elements.quizRangeStart.addEventListener('blur', this.handlers.blurRange);
            this.elements.quizRangeEnd.addEventListener('blur', this.handlers.blurRange);
        }
    },

    mount() {
        if (this.state.mounted) return;
        document.addEventListener('keydown', this.handlers.globalKeydown);
        this.state.mounted = true;
    },

    unmount() {
        if (!this.state.mounted) return;
        document.removeEventListener('keydown', this.handlers.globalKeydown);
        this.state.mounted = false;
    },

    reset(fullReset = true) {
        if (fullReset) {
            this.unmount();
            this.elements.quizSelectionScreen.classList.remove('hidden');
            this.elements.contentContainer.classList.add('hidden');
            this.elements.loader.classList.add('hidden');
        } else {
            this.mount();
            this.elements.quizSelectionScreen.classList.add('hidden');
            this.elements.contentContainer.classList.remove('hidden');
        }
    },

    preloadAllQuizTypesBasedOnSavedRange() {
        if (!state.isWordListReady) return;
        this.preloadQuiz('MULTIPLE_CHOICE_MEANING');
        this.preloadQuiz('FILL_IN_THE_BLANK');
        this.preloadQuiz('MULTIPLE_CHOICE_DEFINITION');
    },

    validateRangeInput(e) {
        let value = parseInt(e.target.value);
        if (isNaN(value)) return;
        const total = state.wordList.length;
        if (value < 1) value = 1;
        if (value > total) value = total;
    },

    saveRangeSettings() {
        const startEl = this.elements.quizRangeStart;
        const endEl = this.elements.quizRangeEnd;
        if (!startEl || !endEl) return;

        let start = parseInt(startEl.value);
        let end = parseInt(endEl.value);
        const total = state.wordList.length;

        if (isNaN(start) || start < 1) start = 1;
        if (isNaN(end) || end > total) end = total;
        if (start > end) start = end;

        startEl.value = start;
        endEl.value = end;

        localStorage.setItem('quizRangeStart', start);
        localStorage.setItem('quizRangeEnd', end);
        
        this.state.preloadedQuizzes = {
            'MULTIPLE_CHOICE_MEANING': null,
            'FILL_IN_THE_BLANK': null,
            'MULTIPLE_CHOICE_DEFINITION': null
        };
        this.preloadAllQuizTypesBasedOnSavedRange();
    },

    getQuizRange() {
        const total = state.wordList.length;
        if (this.elements.quizRangeTotal) this.elements.quizRangeTotal.textContent = total;

        let start = parseInt(localStorage.getItem('quizRangeStart'));
        let end = parseInt(localStorage.getItem('quizRangeEnd'));

        if (isNaN(start) || start < 1 || start > total) start = 1;
        if (isNaN(end) || end < 1 || end > total) end = total;
        if (end > total) end = total;
        if (start > end) start = 1;

        if (this.elements.quizRangeStart) this.elements.quizRangeStart.value = start;
        if (this.elements.quizRangeEnd) this.elements.quizRangeEnd.value = end;

        return { start: start - 1, end: end - 1 };
    },

    async startQuiz(type) {
        if (!state.isWordListReady) {
            alert("단어 목록을 불러오는 중입니다.");
            return;
        }

        this.state.currentQuizType = type;
        this.state.sessionAnsweredInSet = 0;
        this.state.sessionCorrectInSet = 0;
        this.state.sessionMistakes = [];
        this.state.answeredWords.clear();

        window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'quiz-play' } }));
        this.displayNextQuiz();
    },

    async displayNextQuiz() {
        this.state.isProcessingAnswer = false;
        
        // 연습모드 UI 처리
        if (this.state.isPracticeMode) {
            this.elements.quizStats.classList.add('hidden');
        } else {
            this.elements.quizStats.classList.remove('hidden');
            this.elements.correctCountEl.textContent = this.state.sessionCorrectInSet;
            this.elements.totalCountEl.textContent = this.state.sessionAnsweredInSet;
        }
        
        this.elements.resultMessage.classList.add('hidden');
        this.elements.resultMessage.textContent = '';
        this.elements.resultMessage.className = 'text-center text-lg font-bold mb-4 hidden';

        // 퀴즈 데이터 로딩
        let quizData = this.state.preloadedQuizzes[this.state.currentQuizType];
        
        if (!quizData) {
            this.elements.contentContainer.classList.add('hidden');
            this.elements.loader.classList.remove('hidden');
            this.elements.loaderText.textContent = "문제 생성 중...";
            quizData = await this.generateQuiz(this.state.currentQuizType);
            this.elements.loader.classList.add('hidden');
            this.elements.contentContainer.classList.remove('hidden');
        }

        this.state.preloadedQuizzes[this.state.currentQuizType] = null;
        this.preloadQuiz(this.state.currentQuizType);

        if (!quizData) {
            alert("퀴즈를 생성할 수 없습니다.");
            window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'quiz' } }));
            return;
        }

        this.state.currentQuiz = quizData;
        this.renderQuiz(quizData);
    },

    async preloadQuiz(type) {
        if (this.state.preloadedQuizzes[type] || this.state.isPreloading[type]) return;
        this.state.isPreloading[type] = true;
        try {
            const quiz = await this.generateQuiz(type);
            this.state.preloadedQuizzes[type] = quiz;
        } catch (e) { console.error(e); } 
        finally { this.state.isPreloading[type] = false; }
    },

    async generateQuiz(type) {
        const { start, end } = this.getQuizRange();
        const rangeWords = state.wordList.filter(w => w.index >= start + 1 && w.index <= end + 1);
        if (rangeWords.length < 4) return null;

        let candidates = rangeWords.filter(w => !this.state.answeredWords.has(w.word));
        if (candidates.length === 0) {
            this.state.answeredWords.clear();
            candidates = rangeWords;
        }

        const correctWordData = candidates[Math.floor(Math.random() * candidates.length)];
        this.state.answeredWords.add(correctWordData.word);

        if (type === 'MULTIPLE_CHOICE_MEANING') {
            return this.createMeaningQuiz(correctWordData, rangeWords);
        } else if (type === 'FILL_IN_THE_BLANK') {
            return this.createBlankQuiz(correctWordData, rangeWords);
        } else if (type === 'MULTIPLE_CHOICE_DEFINITION') {
            return this.createDefinitionQuiz(correctWordData, rangeWords);
        }
        return null;
    },

    createMeaningQuiz(correctWordData, rangeWords) {
        const wrongAnswers = new Set();
        while (wrongAnswers.size < 3) {
            const randomWord = rangeWords[Math.floor(Math.random() * rangeWords.length)];
            if (randomWord.word !== correctWordData.word) wrongAnswers.add(randomWord.meaning);
        }
        const choices = utils.shuffleArray([correctWordData.meaning, ...Array.from(wrongAnswers)]);
        return { 
            type: 'MULTIPLE_CHOICE_MEANING', 
            question: correctWordData.word, 
            choices, 
            answer: correctWordData.meaning, 
            correctWord: correctWordData.word 
        };
    },

    createBlankQuiz(correctWordData, rangeWords) {
        let sentenceWithBlank = "";
        if (correctWordData.sample) {
            const sentences = correctWordData.sample.split('\n');
            const targetSentence = sentences[Math.floor(Math.random() * sentences.length)];
            const regex = new RegExp(`\\b${correctWordData.word}\\b`, 'gi');
            if (regex.test(targetSentence)) {
                sentenceWithBlank = targetSentence.replace(regex, '<span class="quiz-blank border-b-2 border-black inline-block min-w-[50px] text-center">_______</span>');
            }
        }
        if (!sentenceWithBlank) return this.createMeaningQuiz(correctWordData, rangeWords);

        const wrongAnswers = new Set();
        let wrongCandidates = rangeWords.filter(w => w.pos === correctWordData.pos && w.word !== correctWordData.word);
        if (wrongCandidates.length < 3) wrongCandidates = rangeWords.filter(w => w.word !== correctWordData.word);

        utils.shuffleArray(wrongCandidates);
        wrongCandidates.slice(0, 3).forEach(w => wrongAnswers.add(w.word));
        while (wrongAnswers.size < 3) {
             const randomWord = rangeWords[Math.floor(Math.random() * rangeWords.length)];
             if (randomWord.word !== correctWordData.word) wrongAnswers.add(randomWord.word);
        }

        const choices = utils.shuffleArray([correctWordData.word, ...Array.from(wrongAnswers)]);
        return { 
            type: 'FILL_IN_THE_BLANK', 
            question: { html: sentenceWithBlank, word: correctWordData.word }, 
            choices, 
            answer: correctWordData.word,
            correctWord: correctWordData.word
        };
    },

    async createDefinitionQuiz(correctWordData, rangeWords) {
        const definition = await api.fetchDefinition(correctWordData.word);
        if (!definition) return this.createMeaningQuiz(correctWordData, rangeWords);

        const wrongAnswers = new Set();
        let wrongCandidates = rangeWords.filter(w => w.pos === correctWordData.pos && w.word !== correctWordData.word);
        if (wrongCandidates.length < 3) wrongCandidates = rangeWords.filter(w => w.word !== correctWordData.word);

        utils.shuffleArray(wrongCandidates);
        wrongCandidates.slice(0, 3).forEach(w => wrongAnswers.add(w.word));
        while (wrongAnswers.size < 3) {
             const randomWord = rangeWords[Math.floor(Math.random() * rangeWords.length)];
             if (randomWord.word !== correctWordData.word) wrongAnswers.add(randomWord.word);
        }

        const choices = utils.shuffleArray([correctWordData.word, ...Array.from(wrongAnswers)]);
        return { 
            type: 'MULTIPLE_CHOICE_DEFINITION', 
            question: { text: definition, word: correctWordData.word }, 
            choices, 
            answer: correctWordData.word,
            correctWord: correctWordData.word
        };
    },

    renderQuiz(quizData) {
        this.elements.choicesContainer.innerHTML = '';
        const qDisplay = this.elements.questionDisplay;

        // [수정] 오디오 재생 로직 제거하고 텍스트만 표시
        if (quizData.type === 'MULTIPLE_CHOICE_MEANING') {
            qDisplay.innerHTML = `<h2 class="text-4xl font-bold text-gray-800">${quizData.question}</h2>`;
            qDisplay.onclick = null; // 클릭 이벤트 제거

        } else if (quizData.type === 'FILL_IN_THE_BLANK') {
            qDisplay.innerHTML = `<p class="text-xl text-gray-700 leading-relaxed font-medium bg-gray-50 p-4 rounded-lg border">${quizData.question.html}</p>`;
            qDisplay.onclick = null;

        } else if (quizData.type === 'MULTIPLE_CHOICE_DEFINITION') {
            qDisplay.innerHTML = `<p class="text-lg text-gray-700 italic bg-yellow-50 p-4 rounded-lg border border-yellow-200">"${quizData.question.text}"</p>`;
            qDisplay.onclick = null;
        }

        // 보기(Choices) 표시
        quizData.choices.forEach((choice, index) => {
            const btn = document.createElement('button');
            btn.className = "w-full text-left p-4 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 flex items-center group relative bg-white shadow-sm active:bg-blue-100";
            btn.innerHTML = `
                <span class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center mr-3 font-bold group-hover:bg-blue-200 group-hover:text-blue-700 transition-colors">${index + 1}</span>
                <span class="text-lg text-gray-700 font-medium group-hover:text-gray-900">${choice}</span>
            `;
            btn.onclick = () => this.handleAnswer(choice, btn);
            this.elements.choicesContainer.appendChild(btn);
        });
    },

    handleAnswer(selectedChoice, btnElement) {
        if (this.state.isProcessingAnswer) return;
        this.state.isProcessingAnswer = true;

        const isCorrect = selectedChoice === this.state.currentQuiz.answer;
        const correctBtn = Array.from(this.elements.choicesContainer.children).find(b => b.textContent.includes(this.state.currentQuiz.answer));

        if (isCorrect) {
            btnElement.classList.replace('border-gray-200', 'border-green-500');
            btnElement.classList.add('bg-green-100');
            btnElement.querySelector('span:first-child').classList.add('bg-green-200', 'text-green-700');
            
            this.elements.resultMessage.textContent = "정답입니다! 🎉";
            this.elements.resultMessage.classList.remove('hidden', 'text-red-500');
            this.elements.resultMessage.classList.add('text-green-600');
            correctBeep();
        } else {
            btnElement.classList.replace('border-gray-200', 'border-red-500');
            btnElement.classList.add('bg-red-100');
            btnElement.querySelector('span:first-child').classList.add('bg-red-200', 'text-red-700');
            
            if (correctBtn) {
                correctBtn.classList.replace('border-gray-200', 'border-green-500');
                correctBtn.classList.add('bg-green-50', 'animate-pulse');
            }
            
            this.elements.resultMessage.textContent = `오답입니다. 정답: ${this.state.currentQuiz.answer}`;
            this.elements.resultMessage.classList.remove('hidden', 'text-green-600');
            this.elements.resultMessage.classList.add('text-red-500');
            incorrectBeep();
        }

        // [수정] 빈칸 퀴즈 정답 시 문장 읽어주는 로직 제거

        if (!this.state.isPracticeMode) {
            this.state.sessionAnsweredInSet++;
            if (isCorrect) this.state.sessionCorrectInSet++;
            else this.state.sessionMistakes.push(this.state.currentQuiz.correctWord);
            
            api.updateWordStatus(this.state.currentQuiz.correctWord, this.state.currentQuizType, isCorrect ? 'correct' : 'wrong');
        }

        setTimeout(() => {
            this.displayNextQuiz();
        }, 1500);
    },

    handleKeyDown(e) {
        if (!this.state.mounted || this.elements.contentContainer.classList.contains('hidden')) return;
        if (this.state.isProcessingAnswer) return;

        const key = e.key;
        const choices = this.elements.choicesContainer.children;
        
        if (['1', '2', '3', '4'].includes(key)) {
            const index = parseInt(key) - 1;
            if (choices[index]) {
                choices[index].click();
            }
        }
    }
};
