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
        
        // 퀴즈 데이터 캐싱 (Preloading)
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
        
        currentRangeInputTarget: null,
        
        // Lifecycle 상태
        mounted: false,
        isProcessingAnswer: false, // 정답 처리 중 입력 방지
    },

    elements: {},
    handlers: {}, // 이벤트 핸들러 저장소

    init() {
        // DOM 요소 캐싱
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
            quizRangeConfig: document.getElementById('quiz-range-config'),
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

        // 초기화 시 정적 버튼 이벤트 등록
        if (this.elements.startMeaningQuizBtn) this.elements.startMeaningQuizBtn.addEventListener('click', this.handlers.startMeaningQuiz);
        if (this.elements.startBlankQuizBtn) this.elements.startBlankQuizBtn.addEventListener('click', this.handlers.startBlankQuiz);
        if (this.elements.startDefinitionQuizBtn) this.elements.startDefinitionQuizBtn.addEventListener('click', this.handlers.startDefinitionQuiz);

        // 범위 설정 입력 이벤트
        if (this.elements.quizRangeStart && this.elements.quizRangeEnd) {
            this.elements.quizRangeStart.addEventListener('input', this.handlers.inputRange);
            this.elements.quizRangeEnd.addEventListener('input', this.handlers.inputRange);
            this.elements.quizRangeStart.addEventListener('blur', this.handlers.blurRange);
            this.elements.quizRangeEnd.addEventListener('blur', this.handlers.blurRange);
        }
    },

    // [Lifecycle] 화면 진입 시 (main.js에서 호출)
    mount() {
        if (this.state.mounted) return;
        document.addEventListener('keydown', this.handlers.globalKeydown);
        this.state.mounted = true;
    },

    // [Lifecycle] 화면 이탈 시 (main.js에서 호출)
    unmount() {
        if (!this.state.mounted) return;
        document.removeEventListener('keydown', this.handlers.globalKeydown);
        this.state.mounted = false;
    },

    // 퀴즈 모드 초기화 (화면 전환 시 호출됨)
    reset(fullReset = true) {
        if (fullReset) {
            // 완전히 나갈 때 (Dashboard 등으로 이동)
            this.unmount();
            this.elements.quizSelectionScreen.classList.remove('hidden');
            this.elements.contentContainer.classList.add('hidden');
            this.elements.loader.classList.add('hidden');
        } else {
            // 퀴즈 플레이 화면만 유지할 때 (Play 모드 진입)
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
        
        // UI에는 즉시 반영하지 않고(타이핑 방해 방지), 저장 시점에만 검증하거나 블러 시점에 처리
        this.state.currentRangeInputTarget = e.target;
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
        
        // 범위가 바뀌었으므로 프리로드 데이터 초기화
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
        
        // 저장된 값이 있어도 현재 단어장 크기가 줄었을 수 있으므로 재보정
        if (end > total) end = total;
        if (start > end) start = 1;

        if (this.elements.quizRangeStart) this.elements.quizRangeStart.value = start;
        if (this.elements.quizRangeEnd) this.elements.quizRangeEnd.value = end;

        return { start: start - 1, end: end - 1 }; // 0-based index
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

        // UI 전환 및 URL 변경
        window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'quiz-play' } }));
        
        this.displayNextQuiz();
    },

    async displayNextQuiz() {
        this.state.isProcessingAnswer = false;
        
        // 연습 모드나 세션 진행도 UI 업데이트
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

        // 퀴즈 데이터 가져오기 (캐시 확인)
        let quizData = this.state.preloadedQuizzes[this.state.currentQuizType];
        
        // 캐시가 없으면 생성 (로딩 표시)
        if (!quizData) {
            this.elements.contentContainer.classList.add('hidden');
            this.elements.loader.classList.remove('hidden');
            this.elements.loaderText.textContent = "문제 생성 중...";
            
            quizData = await this.generateQuiz(this.state.currentQuizType);
            this.elements.loader.classList.add('hidden');
            this.elements.contentContainer.classList.remove('hidden');
        }

        // 사용한 캐시 비우고 다음 문제 미리 로딩
        this.state.preloadedQuizzes[this.state.currentQuizType] = null;
        this.preloadQuiz(this.state.currentQuizType);

        if (!quizData) {
            alert("퀴즈를 생성할 수 없습니다. 단어 데이터를 확인해주세요.");
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
        } catch (e) {
            console.error("Preload failed:", e);
        } finally {
            this.state.isPreloading[type] = false;
        }
    },

    async generateQuiz(type) {
        const { start, end } = this.getQuizRange();
        const rangeWords = state.wordList.filter(w => w.index >= start + 1 && w.index <= end + 1);

        if (rangeWords.length < 4) return null;

        // 아직 안 푼 단어 우선 선택
        let candidates = rangeWords.filter(w => !this.state.answeredWords.has(w.word));
        if (candidates.length === 0) {
            // 범위 내 모든 단어를 다 풀었으면 초기화
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
            if (randomWord.word !== correctWordData.word) {
                wrongAnswers.add(randomWord.meaning);
            }
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
                sentenceWithBlank = targetSentence.replace(regex, '_______');
            }
        }
        
        // 예문이 없거나 매칭 실패 시 fallback
        if (!sentenceWithBlank) {
             return this.createMeaningQuiz(correctWordData, rangeWords);
        }

        const wrongAnswers = new Set();
        // 품사가 같은 오답 우선 선택
        let wrongCandidates = rangeWords.filter(w => w.pos === correctWordData.pos && w.word !== correctWordData.word);
        
        // 품사 매칭되는게 부족하면 전체에서 선택
        if (wrongCandidates.length < 3) {
            wrongCandidates = rangeWords.filter(w => w.word !== correctWordData.word);
        }

        utils.shuffleArray(wrongCandidates);
        wrongCandidates.slice(0, 3).forEach(w => wrongAnswers.add(w.word));
        
        // 그래도 부족하면 랜덤 채우기
        while (wrongAnswers.size < 3) {
             const randomWord = rangeWords[Math.floor(Math.random() * rangeWords.length)];
             if (randomWord.word !== correctWordData.word) wrongAnswers.add(randomWord.word);
        }

        const choices = utils.shuffleArray([correctWordData.word, ...Array.from(wrongAnswers)]);
        return { 
            type: 'FILL_IN_THE_BLANK', 
            question: { sentence_with_blank: sentenceWithBlank, word: correctWordData.word }, // word는 정답 확인용
            choices, 
            answer: correctWordData.word,
            correctWord: correctWordData.word
        };
    },

    async createDefinitionQuiz(correctWordData, rangeWords) {
        // 정의(Definition) 가져오기 시도
        const definition = await api.fetchDefinition(correctWordData.word);
        if (!definition) {
            // 정의가 없으면 뜻 맞추기 퀴즈로 대체
            return this.createMeaningQuiz(correctWordData, rangeWords);
        }

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
            question: { definition, word: correctWordData.word }, 
            choices, 
            answer: correctWordData.word,
            correctWord: correctWordData.word
        };
    },

    renderQuiz(quizData) {
        this.elements.choicesContainer.innerHTML = '';
        
        // 문제 표시
        if (quizData.type === 'MULTIPLE_CHOICE_MEANING') {
            this.elements.questionDisplay.innerHTML = `<h2 class="text-3xl font-bold text-gray-800">${quizData.question}</h2>`;
        } else if (quizData.type === 'FILL_IN_THE_BLANK') {
            this.elements.questionDisplay.innerHTML = `<p class="text-xl text-gray-700 leading-relaxed">"${quizData.question.sentence_with_blank}"</p>`;
        } else if (quizData.type === 'MULTIPLE_CHOICE_DEFINITION') {
            this.elements.questionDisplay.innerHTML = `<p class="text-lg text-gray-700 italic">"${quizData.question.definition}"</p>`;
        }

        // 보기(Choices) 표시
        quizData.choices.forEach((choice, index) => {
            const btn = document.createElement('button');
            btn.className = "w-full text-left p-4 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 flex items-center group relative";
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
        this.state.isProcessingAnswer = true; // 중복 입력 차단

        const isCorrect = selectedChoice === this.state.currentQuiz.answer;
        const correctBtn = Array.from(this.elements.choicesContainer.children).find(b => b.textContent.includes(this.state.currentQuiz.answer));

        // UI 피드백
        if (isCorrect) {
            btnElement.classList.add('bg-green-100', 'border-green-500');
            btnElement.querySelector('span:first-child').classList.add('bg-green-200', 'text-green-700');
            this.elements.resultMessage.textContent = "정답입니다! 🎉";
            this.elements.resultMessage.classList.remove('hidden', 'text-red-500');
            this.elements.resultMessage.classList.add('text-green-600');
            correctBeep();
        } else {
            btnElement.classList.add('bg-red-100', 'border-red-500');
            btnElement.querySelector('span:first-child').classList.add('bg-red-200', 'text-red-700');
            if (correctBtn) {
                correctBtn.classList.add('bg-green-100', 'border-green-500'); // 정답 알려주기
                correctBtn.classList.add('animate-pulse');
            }
            this.elements.resultMessage.textContent = `오답입니다. 정답: ${this.state.currentQuiz.answer}`;
            this.elements.resultMessage.classList.remove('hidden', 'text-green-600');
            this.elements.resultMessage.classList.add('text-red-500');
            incorrectBeep();
        }

        // 데이터 업데이트 (연습모드 아닐 때만)
        if (!this.state.isPracticeMode) {
            this.state.sessionAnsweredInSet++;
            if (isCorrect) this.state.sessionCorrectInSet++;
            else this.state.sessionMistakes.push(this.state.currentQuiz.correctWord);
            
            // 서버/로컬 저장
            const targetWord = this.state.currentQuiz.correctWord;
            api.updateWordStatus(targetWord, this.state.currentQuizType, isCorrect ? 'correct' : 'wrong');
        }

        // 다음 문제로 이동
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
