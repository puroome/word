// ================================================================
// study-modes.js : 퀴즈 모드 및 학습 모드
// ================================================================

const quizMode = {
    state: { currentQuiz: {}, currentQuizType: null, isPracticeMode: false, sessionAnsweredInSet: 0, sessionCorrectInSet: 0, sessionMistakes: [], answeredWords: new Set(), preloadedQuizzes: { 'MULTIPLE_CHOICE_MEANING': null, 'FILL_IN_THE_BLANK': null, 'MULTIPLE_CHOICE_DEFINITION': null }, isPreloading: { 'MULTIPLE_CHOICE_MEANING': false, 'FILL_IN_THE_BLANK': false, 'MULTIPLE_CHOICE_DEFINITION': false }, currentRangeInputTarget: null },
    elements: {},
    init() {
        this.elements = {
            quizSelectionScreen: document.getElementById('quiz-selection-screen'), startMeaningQuizBtn: document.getElementById('start-meaning-quiz-btn'), startBlankQuizBtn: document.getElementById('start-blank-quiz-btn'), startDefinitionQuizBtn: document.getElementById('start-definition-quiz-btn'), loader: document.getElementById('quiz-loader'), loaderText: document.getElementById('quiz-loader-text'), contentContainer: document.getElementById('quiz-content-container'), questionDisplay: document.getElementById('quiz-question-display'), choices: document.getElementById('quiz-choices'),
            modal: document.getElementById('quiz-result-modal'), modalScore: document.getElementById('quiz-result-score'), modalMistakesBtn: document.getElementById('quiz-result-mistakes-btn'), modalContinueBtn: document.getElementById('quiz-result-continue-btn'),
            quizRangeStart: document.getElementById('quiz-range-start'), quizRangeEnd: document.getElementById('quiz-range-end'), quizRangeLabel: document.getElementById('quiz-range-label'), rangeInputModal: document.getElementById('range-input-modal'), rangeInputLabel: document.getElementById('range-input-label'), rangeInputField: document.getElementById('range-input-field'), rangeInputCancelBtn: document.getElementById('range-input-cancel-btn'), rangeInputConfirmBtn: document.getElementById('range-input-confirm-btn'), finishedScreen: document.getElementById('quiz-finished-screen'), finishedMessage: document.getElementById('quiz-finished-message')
        };
        this.bindEvents();
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
        this.elements.rangeInputField.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.confirmRangeInput(); if (e.key === 'Escape') this.hideRangeInput(); });
        this.elements.quizRangeLabel.addEventListener('click', () => this.resetQuizRange());
        this.elements.modalContinueBtn.addEventListener('click', () => this.continueAfterResult());
        this.elements.modalMistakesBtn.addEventListener('click', () => this.reviewSessionMistakes());
        document.addEventListener('keydown', (e) => {
            const isQuizModeActive = !this.elements.contentContainer.classList.contains('hidden') && !this.elements.choices.classList.contains('disabled');
            if (!isQuizModeActive) return;
            const choiceCount = Array.from(this.elements.choices.children).filter(el => !el.textContent.includes('PASS')).length;
            if (e.key.toLowerCase() === 'p' || e.key === '0') { e.preventDefault(); const passButton = Array.from(this.elements.choices.children).find(el => el.textContent.includes('PASS')); if(passButton) passButton.click(); }
            else { const choiceIndex = parseInt(e.key); if (choiceIndex >= 1 && choiceIndex <= choiceCount) { e.preventDefault(); const targetLi = this.elements.choices.children[choiceIndex - 1]; targetLi.classList.add('bg-gray-200'); setTimeout(() => targetLi.classList.remove('bg-gray-200'), 150); targetLi.click(); } }
        });
    },
    async start(quizType) { this.state.currentQuizType = quizType; app.navigateTo('quiz-play'); },
    reset(showSelection = true) {
        this.state.currentQuiz = {}; this.state.sessionAnsweredInSet = 0; this.state.sessionCorrectInSet = 0; this.state.sessionMistakes = [];
        if (showSelection) { this.state.answeredWords.clear(); this.state.currentQuizType = null; }
        this.elements.loader.querySelector('.loader').style.display = 'block'; this.elements.loaderText.textContent = "퀴즈 데이터를 불러오는 중...";
        if (showSelection) { this.elements.quizSelectionScreen.classList.remove('hidden'); this.elements.loader.classList.add('hidden'); } else { this.showLoader(true); }
        this.elements.contentContainer.classList.add('hidden'); this.elements.finishedScreen.classList.add('hidden'); if (this.elements.modal) this.elements.modal.classList.add('hidden');
        if (showSelection) this.updateRangeInputs();
    },
    async updateRangeInputs() {
        let startValue = 1; let endValue = 1; let totalWords = 1;
        try {
            if (!app.state.isWordListReady) await api.loadWordList();
            totalWords = app.state.wordList?.length || 1; endValue = totalWords;
            const startStorageKey = app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START; const endStorageKey = app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END;
            const savedStart = localStorage.getItem(startStorageKey); const savedEnd = localStorage.getItem(endStorageKey);
            if (savedStart !== null) startValue = parseInt(savedStart) || 1;
            if (savedEnd !== null) endValue = parseInt(savedEnd) || totalWords;
        } catch (error) { console.error("Error updating range inputs:", error); startValue = 1; endValue = 1; totalWords = 1; }
        finally {
            this.elements.quizRangeStart.textContent = startValue; this.elements.quizRangeStart.dataset.min = 1; this.elements.quizRangeStart.dataset.max = totalWords;
            this.elements.quizRangeEnd.textContent = endValue; this.elements.quizRangeEnd.dataset.min = 1; this.elements.quizRangeEnd.dataset.max = totalWords;
        }
    },
    promptForRangeValue(targetButton) {
        if (!targetButton) return;
        this.state.currentRangeInputTarget = targetButton;
        const isStart = targetButton.id === 'quiz-range-start';
        const max = parseInt(targetButton.dataset.max) || 1;
        this.elements.rangeInputLabel.textContent = isStart ? `시작번호 (1-${max}) :` : `마지막번호 (1-${max}) :`;
        this.elements.rangeInputField.value = targetButton.textContent; this.elements.rangeInputField.min = parseInt(targetButton.dataset.min) || 1; this.elements.rangeInputField.max = max;
        this.elements.rangeInputModal.classList.remove('hidden'); this.elements.rangeInputField.focus(); this.elements.rangeInputField.select();
    },
    hideRangeInput() { this.elements.rangeInputModal.classList.add('hidden'); this.state.currentRangeInputTarget = null; },
    confirmRangeInput() {
        const targetButton = this.state.currentRangeInputTarget;
        if (!targetButton) return;
        const min = parseInt(targetButton.dataset.min) || 1; const max = parseInt(targetButton.dataset.max) || 1; const newValueStr = this.elements.rangeInputField.value;
        if (newValueStr !== null && newValueStr.trim() !== '') {
            let newValue = parseInt(newValueStr);
            if (!isNaN(newValue)) {
                newValue = Math.max(min, Math.min(max, newValue));
                targetButton.textContent = newValue;
                const storageKey = targetButton.id === 'quiz-range-start' ? app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START : app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END;
                try { localStorage.setItem(storageKey, newValue); this.clearAndPreloadQuizzesForNewRange(); } catch (e) {}
            } else { app.showToast("숫자만 입력 가능합니다.", true); }
        }
        this.hideRangeInput();
    },
    resetQuizRange() {
        const totalWords = app.state.wordList?.length || 1;
        this.elements.quizRangeStart.textContent = 1; this.elements.quizRangeEnd.textContent = totalWords;
        try { localStorage.setItem(app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START, 1); localStorage.setItem(app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END, totalWords); this.clearAndPreloadQuizzesForNewRange(); } catch (e) {}
    },
    clearAndPreloadQuizzesForNewRange() { Object.keys(this.state.preloadedQuizzes).forEach(type => { this.state.preloadedQuizzes[type] = null; this.state.isPreloading[type] = false; }); this.preloadAllQuizTypesBasedOnSavedRange(); },
    async displayNextQuiz() {
        this.showLoader(true, "다음 문제 생성 중...");
        let nextQuiz = null; const type = this.state.currentQuizType;
        let preloaded = this.state.preloadedQuizzes[type];
        if (preloaded) {
            const allWords = app.state.wordList || [];
            const startVal = parseInt(this.elements.quizRangeStart.textContent) || 1; const endVal = parseInt(this.elements.quizRangeEnd.textContent) || allWords.length;
            const startIndex = Math.max(0, Math.min(startVal, endVal) - 1); const endIndex = Math.min(allWords.length - 1, Math.max(startVal, endVal) - 1);
            const wordIndex = allWords.findIndex(w => w.word === preloaded.question.word);
            if (wordIndex < startIndex || wordIndex > endIndex || this.state.answeredWords.has(preloaded.question.word) || (!this.state.isPracticeMode && utils.getWordStatus(preloaded.question.word) === 'learned')) preloaded = null;
        }
        if (preloaded) { nextQuiz = preloaded; this.state.preloadedQuizzes[type] = null; this.preloadNextQuiz(type, nextQuiz.question.word); }
        if (!nextQuiz) { nextQuiz = await this.generateSingleQuiz(); if (nextQuiz) this.preloadNextQuiz(type, nextQuiz.question.word); }
        if (nextQuiz) { this.state.currentQuiz = nextQuiz; this.showLoader(false); this.renderQuiz(nextQuiz); }
        else { if (this.state.sessionAnsweredInSet > 0) this.showSessionResultModal(true); else { this.showFinishedScreen("No more quizzes!"); setTimeout(() => app.navigateTo('quiz'), 800); } }
    },
    async generateSingleQuiz() {
        const allWords = app.state.wordList || [];
        if (allWords.length === 0) return null;
        const startVal = parseInt(this.elements.quizRangeStart.textContent) || 1; const endVal = parseInt(this.elements.quizRangeEnd.textContent) || allWords.length;
        const wordsInRange = allWords.slice(Math.max(0, Math.min(startVal, endVal) - 1), Math.min(allWords.length - 1, Math.max(startVal, endVal) - 1) + 1);
        if (wordsInRange.length === 0) return null;
        const currentQuizType = this.state.currentQuizType;
        const localKey = app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES;
        let unsynced = {}; try { unsynced = JSON.parse(localStorage.getItem(localKey) || '{}'); } catch(e) {}
        let candidates = wordsInRange.filter(wordObj => {
            const word = wordObj.word;
            if (this.state.answeredWords.has(word)) return false;
            if (this.state.isPracticeMode) return true;
            if (unsynced[word] && unsynced[word][currentQuizType] === 'correct') return false;
            if (!unsynced[word] && app.state.currentProgress[word] && app.state.currentProgress[word][currentQuizType] === 'correct') return false;
            return true;
        });
        if (this.state.currentQuizType === 'FILL_IN_THE_BLANK') candidates = candidates.filter(word => word.sample && word.sample.trim() !== '');
        if (candidates.length === 0) return null;
        utils.shuffleArray(candidates);
        const usableAllWords = allWords.length >= 4 ? allWords : [...allWords, {word: 'dummy1', meaning: '오답1'}, {word: 'dummy2', meaning: '오답2'}, {word: 'dummy3', meaning: '오답3'}];
        for (const wordData of candidates) {
            let quiz = null;
            if (this.state.currentQuizType === 'MULTIPLE_CHOICE_MEANING') quiz = this.createMeaningQuiz(wordData, usableAllWords);
            else if (this.state.currentQuizType === 'FILL_IN_THE_BLANK') quiz = this.createBlankQuiz(wordData, usableAllWords);
            else if (this.state.currentQuizType === 'MULTIPLE_CHOICE_DEFINITION') quiz = await this.createDefinitionQuiz(wordData, usableAllWords);
            if (quiz) return quiz;
        }
        return null;
    },
    renderQuiz(quizData) {
        const { type, question, choices } = quizData;
        const qD = this.elements.questionDisplay; qD.innerHTML = ''; qD.className = 'bg-green-100 p-4 rounded-lg mb-4 flex min-h-[100px]';
        if (type === 'FILL_IN_THE_BLANK') {
            qD.classList.add('items-start', 'text-left');
            const p = document.createElement('p'); p.className = 'text-xl sm:text-2xl text-gray-800 leading-relaxed';
            question.sentence_with_blank.split('___BLANK___').forEach((part, index, arr) => {
                part.split(/(\*.*?\*)/g).forEach(tp => { if(tp.startsWith('*')&&tp.endsWith('*')) { const s=document.createElement('strong'); s.textContent=tp.slice(1,-1); p.appendChild(s); } else if(tp) p.appendChild(document.createTextNode(tp)); });
                if(index < arr.length-1) { const span=document.createElement('span'); span.className='quiz-blank inline-block font-mono text-blue-600'; span.textContent='＿＿＿＿'; p.appendChild(span); }
            });
            qD.appendChild(p);
        } else if (type === 'MULTIPLE_CHOICE_MEANING') {
            qD.classList.add('items-center', 'justify-center'); qD.innerHTML = `<h1 id="quiz-word" class="text-3xl sm:text-4xl font-bold text-center text-gray-800 cursor-pointer">${question.word}</h1>`;
            qD.querySelector('#quiz-word').onclick = () => { api.speak(question.word, 'word'); };
        } else if (type === 'MULTIPLE_CHOICE_DEFINITION') {
            qD.classList.add('items-start', 'text-left'); qD.innerHTML = `<p class="text-lg sm:text-xl text-gray-800 leading-relaxed">${question.definition}</p>`;
        }
        this.elements.choices.innerHTML = '';
        choices.forEach((choice, index) => {
            const li = document.createElement('li'); li.className = 'choice-item border-2 border-gray-300 py-3 px-4 rounded-lg cursor-pointer flex items-start transition-all text-lg hover:bg-blue-50';
            li.innerHTML = `<span class="font-bold mr-3 text-blue-600">${index + 1}.</span> <span>${choice}</span>`;
            li.onclick = () => this.checkAnswer(li, choice);
            this.elements.choices.appendChild(li);
        });
        const passLi = document.createElement('li'); passLi.className = 'choice-item border-2 border-red-500 bg-red-500 hover:bg-red-600 text-white p-4 rounded-lg cursor-pointer flex items-center justify-center transition-all font-bold text-lg';
        passLi.innerHTML = `<span>PASS</span>`; passLi.onclick = () => this.checkAnswer(passLi, 'USER_PASSED');
        this.elements.choices.appendChild(passLi);
        this.elements.choices.classList.remove('disabled');
    },
    async checkAnswer(selectedLi, selectedChoice) {
        this.elements.choices.classList.add('disabled');
        const isCorrect = selectedChoice === this.state.currentQuiz.answer;
        const isPass = selectedChoice === 'USER_PASSED';
        const word = this.state.currentQuiz.question.word;
        this.state.answeredWords.add(word);
        selectedLi.classList.add(isCorrect ? 'correct' : 'incorrect');
        if (isCorrect && !isPass) playSequence(correctBeep); else playSequence(incorrectBeep);
        if (!isCorrect) { Array.from(this.elements.choices.children).find(li => li.textContent.includes(this.state.currentQuiz.answer))?.classList.add('correct'); if (!isPass) this.state.sessionMistakes.push(word); }
        this.state.sessionAnsweredInSet++;
        if (isCorrect && !isPass) this.state.sessionCorrectInSet++;
        if (!this.state.isPracticeMode) await api.updateWordStatus(word, this.state.currentQuiz.type, (isCorrect && !isPass) ? 'correct' : 'incorrect');
        setTimeout(() => { if (this.state.sessionAnsweredInSet >= 10) this.showSessionResultModal(); else this.displayNextQuiz(); }, 600);
    },
    showLoader(isLoading, message = '퀴즈를 준비 중입니다...') { this.elements.loader.classList.toggle('hidden', !isLoading); this.elements.loaderText.textContent = message; this.elements.contentContainer.classList.toggle('hidden', isLoading); this.elements.quizSelectionScreen.classList.add('hidden'); this.elements.finishedScreen.classList.add('hidden'); },
    showFinishedScreen(message) { this.showLoader(false); this.elements.contentContainer.classList.add('hidden'); this.elements.finishedScreen.classList.remove('hidden'); this.elements.finishedMessage.textContent = message; },
    showSessionResultModal(isFinal = false) { this.elements.modalScore.textContent = `${this.state.sessionAnsweredInSet}문제 중 ${this.state.sessionCorrectInSet}개 정답!`; this.elements.modalMistakesBtn.classList.toggle('hidden', this.state.sessionMistakes.length === 0); this.elements.modalContinueBtn.textContent = isFinal ? "퀴즈 유형으로" : "다음 퀴즈 계속"; this.elements.modal.classList.remove('hidden'); },
    continueAfterResult() { this.elements.modal.classList.add('hidden'); if (this.elements.modalContinueBtn.textContent === "퀴즈 유형으로") { app.syncOfflineData(); app.navigateTo('quiz'); return; } this.state.sessionAnsweredInSet = 0; this.state.sessionCorrectInSet = 0; this.state.sessionMistakes = []; this.displayNextQuiz(); },
    reviewSessionMistakes() { this.elements.modal.classList.add('hidden'); const mistakes = [...new Set(this.state.sessionMistakes)]; this.state.sessionAnsweredInSet = 0; this.state.sessionCorrectInSet = 0; this.state.sessionMistakes = []; app.syncOfflineData(); app.navigateTo('mistakeReview', { mistakeWords: mistakes }); },
    async preloadAllQuizTypesBasedOnSavedRange() { if (!app.state.isWordListReady) { try { await api.loadWordList(); } catch (e) { return; } } let startValue = 1; let endValue = app.state.wordList.length; try { const savedStart = localStorage.getItem(app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_START); const savedEnd = localStorage.getItem(app.state.LOCAL_STORAGE_KEYS.QUIZ_RANGE_END); const totalWords = app.state.wordList.length || 1; if (savedStart !== null) startValue = parseInt(savedStart)||1; if (savedEnd !== null) endValue = parseInt(savedEnd)||totalWords; } catch(e) {} Object.keys(this.state.preloadedQuizzes).forEach(type => this.preloadNextQuiz(type, null, { start: startValue, end: endValue })); },
    async preloadNextQuiz(quizType, wordToExclude = null, rangeOverride = null) { if (this.state.isPreloading[quizType] || this.state.preloadedQuizzes[quizType]) return; this.state.isPreloading[quizType] = true; try { const quiz = await this._generateSingleQuizForPreload(quizType, wordToExclude, rangeOverride); if (quiz) this.state.preloadedQuizzes[quizType] = quiz; } catch (error) {} finally { this.state.isPreloading[quizType] = false; } },
    async _generateSingleQuizForPreload(quizType, wordToExclude = null, rangeOverride = null) {
        const allWords = app.state.wordList || []; if (allWords.length === 0) return null;
        let startVal, endVal;
        if (rangeOverride) { startVal = rangeOverride.start; endVal = rangeOverride.end; }
        else { startVal = parseInt(this.elements.quizRangeStart.textContent) || 1; endVal = parseInt(this.elements.quizRangeEnd.textContent) || allWords.length; }
        const wordsInRange = allWords.slice(Math.max(0, Math.min(startVal, endVal) - 1), Math.min(allWords.length - 1, Math.max(startVal, endVal) - 1) + 1);
        if (wordsInRange.length === 0) return null;
        let unsynced = {}; try { unsynced = JSON.parse(localStorage.getItem(app.state.LOCAL_STORAGE_KEYS.UNSYNCED_PROGRESS_UPDATES) || '{}'); } catch(e) {}
        let candidates = wordsInRange.filter(wordObj => {
            const word = wordObj.word;
            if (word === wordToExclude || this.state.answeredWords.has(word)) return false;
            if (this.state.isPracticeMode) return true;
            if (unsynced[word] && unsynced[word][quizType] === 'correct') return false;
            if (!unsynced[word] && app.state.currentProgress[word] && app.state.currentProgress[word][quizType] === 'correct') return false;
            return true;
        });
        if (quizType === 'FILL_IN_THE_BLANK') candidates = candidates.filter(word => word.sample && word.sample.trim() !== '');
        if (candidates.length === 0) return null;
        utils.shuffleArray(candidates);
        const usableAllWords = allWords.length >= 4 ? allWords : [...allWords, {word: 'dummy1', meaning: '오답1'}, {word: 'dummy2', meaning: '오답2'}, {word: 'dummy3', meaning: '오답3'}];
        const wordData = candidates[0];
        if (quizType === 'MULTIPLE_CHOICE_MEANING') return this.createMeaningQuiz(wordData, usableAllWords);
        else if (quizType === 'FILL_IN_THE_BLANK') return this.createBlankQuiz(wordData, usableAllWords);
        else if (quizType === 'MULTIPLE_CHOICE_DEFINITION') return await this.createDefinitionQuiz(wordData, usableAllWords);
        return null;
    },
    createMeaningQuiz(correctWordData, allWordsData) {
        const wrongAnswers = new Set(); let candidates = allWordsData.filter(w => w.pos === correctWordData.pos && w.meaning !== correctWordData.meaning); utils.shuffleArray(candidates); candidates.slice(0, 3).forEach(w => wrongAnswers.add(w.meaning));
        while (wrongAnswers.size < 3 && allWordsData.length > wrongAnswers.size + 1) { const rw = allWordsData[Math.floor(Math.random() * allWordsData.length)]; if (rw.meaning !== correctWordData.meaning) wrongAnswers.add(rw.meaning); }
        if (wrongAnswers.size < 3) return null;
        return { type: 'MULTIPLE_CHOICE_MEANING', question: { word: correctWordData.word }, choices: utils.shuffleArray([correctWordData.meaning, ...Array.from(wrongAnswers)]), answer: correctWordData.meaning };
    },
    createBlankQuiz(correctWordData, allWordsData) {
        if (!correctWordData.sample || !correctWordData.sample.trim()) return null;
        const firstLine = correctWordData.sample.split('\n')[0].replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA70}-\u{1FAFF}]/gu, "").replace(/\*/g, '').trim();
        const placeholderRegex = new RegExp(`\\b${correctWordData.word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        if (!firstLine.match(placeholderRegex)) return null;
        const sentenceWithBlank = firstLine.replace(placeholderRegex, "___BLANK___").trim();
        const wrongAnswers = new Set(); let candidates = allWordsData.filter(w => w.pos === correctWordData.pos && w.word !== correctWordData.word); utils.shuffleArray(candidates); candidates.slice(0, 3).forEach(w => wrongAnswers.add(w.word));
        while (wrongAnswers.size < 3 && allWordsData.length > wrongAnswers.size + 1) { const rw = allWordsData[Math.floor(Math.random() * allWordsData.length)]; if (rw.word !== correctWordData.word) wrongAnswers.add(rw.word); }
        if (wrongAnswers.size < 3) return null;
        return { type: 'FILL_IN_THE_BLANK', question: { sentence_with_blank: sentenceWithBlank, word: correctWordData.word }, choices: utils.shuffleArray([correctWordData.word, ...Array.from(wrongAnswers)]), answer: correctWordData.word };
    },
    async createDefinitionQuiz(correctWordData, allWordsData) {
        const definition = await api.fetchDefinition(correctWordData.word);
        if (!definition) return null;
        const wrongAnswers = new Set(); let candidates = allWordsData.filter(w => w.pos === correctWordData.pos && w.word !== correctWordData.word); utils.shuffleArray(candidates); candidates.slice(0, 3).forEach(w => wrongAnswers.add(w.word));
        while (wrongAnswers.size < 3 && allWordsData.length > wrongAnswers.size + 1) { const rw = allWordsData[Math.floor(Math.random() * allWordsData.length)]; if (rw.word !== correctWordData.word) wrongAnswers.add(rw.word); }
        if (wrongAnswers.size < 3) return null;
        return { type: 'MULTIPLE_CHOICE_DEFINITION', question: { definition, word: correctWordData.word }, choices: utils.shuffleArray([correctWordData.word, ...Array.from(wrongAnswers)]), answer: correctWordData.word };
    }
};

const learningMode = {
    state: { currentIndex: 0, isMistakeMode: false, isFavoriteMode: false, currentWordList: [], isDragging: false, touchStartX: 0, touchStartY: 0 },
    nonInteractiveWords: new Set(['a', 'an', 'the', 'I', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those', 'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'something', 'anybody', 'anyone', 'anything', 'nobody', 'no one', 'nothing', 'everybody', 'everyone', 'everything', 'all', 'any', 'both', 'each', 'either', 'every', 'few', 'little', 'many', 'much', 'neither', 'none', 'one', 'other', 'several', 'some', 'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'at', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'by', 'down', 'during', 'for', 'from', 'in', 'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto', 'out', 'outside', 'over', 'past', 'since', 'through', 'throughout', 'to', 'toward', 'under', 'underneath', 'until', 'unto', 'up', 'upon', 'with', 'within', 'without', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'after', 'although', 'as', 'because', 'before', 'if', 'once', 'since', 'than', 'that', 'though', 'till', 'unless', 'until', 'when', 'whenever', 'where', 'whereas', 'wherever', 'whether', 'while', 'that', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'what', 'whatever', 'whichever', 'whoever', 'whomever', 'who', 'whom', 'whose', 'what', 'which', 'when', 'where', 'why', 'how', 'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'done', 'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'ought', 'not', 'very', 'too', 'so', 'just', 'well', 'often', 'always', 'never', 'sometimes', 'here', 'there', 'now', 'then', 'again', 'also', 'ever', 'even', 'how', 'quite', 'rather', 'soon', 'still', 'more', 'most', 'less', 'least', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'then', 'there', 'here', "don't", "didn't", "can't", "couldn't", "she's", "he's", "i'm", "you're", "they're", "we're", "it's", "that's"]),
    elements: {},
    init() {
        this.elements = {
            startScreen: document.getElementById('learning-start-screen'), startInputContainer: document.getElementById('learning-start-input-container'), startWordInput: document.getElementById('learning-start-word-input'), startBtn: document.getElementById('learning-start-btn'), suggestionsContainer: document.getElementById('learning-suggestions-container'), suggestionsTitle: document.getElementById('learning-suggestions-title'), suggestionsVocabList: document.getElementById('learning-suggestions-vocab-list'), suggestionsExplanationList: document.getElementById('learning-suggestions-explanation-list'), backToStartBtn: document.getElementById('learning-back-to-start-btn'), loader: document.getElementById('learning-loader'), loaderText: document.getElementById('learning-loader-text'), appContainer: document.getElementById('learning-app-container'), cardBack: document.getElementById('learning-card-back'), wordDisplay: document.getElementById('word-display'), meaningDisplay: document.getElementById('meaning-display'), explanationDisplay: document.getElementById('explanation-display'), explanationContainer: document.getElementById('explanation-container'), fixedButtons: document.getElementById('learning-fixed-buttons'), nextBtn: document.getElementById('next-btn'), prevBtn: document.getElementById('prev-btn'), sampleBtn: document.getElementById('sample-btn'), sampleBtnImg: document.getElementById('sample-btn-img'), backTitle: document.getElementById('learning-back-title'), backContent: document.getElementById('learning-back-content'), progressBarTrack: document.getElementById('progress-bar-track'), progressBarFill: document.getElementById('progress-bar-fill'), progressBarHandle: document.getElementById('progress-bar-handle'), progressBarNumber: document.getElementById('progress-bar-number'), favoriteBtn: document.getElementById('favorite-btn'), favoriteIcon: document.getElementById('favorite-icon')
        };
        this.bindEvents();
    },
    bindEvents() {
        this.elements.startBtn.addEventListener('click', () => this.start());
        this.elements.startWordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.start(); } });
        this.elements.startWordInput.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^a-zA-Z\s'-]/g, (match) => { if (match) app.showImeWarning(); return ''; }); });
        this.elements.backToStartBtn.addEventListener('click', () => this.resetStartScreen());
        this.elements.nextBtn.addEventListener('click', () => this.navigate(1));
        this.elements.prevBtn.addEventListener('click', () => this.navigate(-1));
        this.elements.sampleBtn.addEventListener('click', () => this.handleFlip());
        this.elements.favoriteBtn.addEventListener('click', () => this.toggleFavorite());
        this.elements.wordDisplay.addEventListener('click', () => { const word = this.state.currentWordList[this.state.currentIndex]?.word; if (word) api.speak(word, 'word'); });
        this.elements.wordDisplay.addEventListener('contextmenu', (e) => { e.preventDefault(); const wordData = this.state.currentWordList[this.state.currentIndex]; if (wordData) ui.showWordContextMenu(e, wordData.word, { hideAppSearch: true }); });
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        document.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        document.addEventListener('touchend', this.handleTouchEnd.bind(this));
        this.elements.progressBarTrack.addEventListener('mousedown', this.handleProgressBarInteraction.bind(this));
        document.addEventListener('mousemove', this.handleProgressBarInteraction.bind(this));
        document.addEventListener('mouseup', this.handleProgressBarInteraction.bind(this));
        this.elements.progressBarTrack.addEventListener('touchstart', this.handleProgressBarInteraction.bind(this), { passive: false });
        document.addEventListener('touchmove', this.handleProgressBarInteraction.bind(this));
        document.addEventListener('touchend', this.handleProgressBarInteraction.bind(this));
    },
    async start() {
        this.state.isMistakeMode = false; this.state.isFavoriteMode = false;
        this.elements.startScreen.classList.add('hidden'); this.elements.loader.classList.remove('hidden');
        if (!app.state.isWordListReady) {
            this.elements.loaderText.textContent = "단어 목록 동기화 중...";
            try { await api.loadWordList(); await api.loadUserProgress(); } catch(e) { this.showError("단어 목록 로딩 실패. 새로고침 해주세요."); return; }
        }
        const startWord = this.elements.startWordInput.value.trim(); this.state.currentWordList = app.state.wordList;
        if (this.state.currentWordList.length === 0) { this.showError("학습할 단어가 없습니다."); return; }
        if (!startWord) {
            try { const savedIndex = parseInt(localStorage.getItem(app.state.LOCAL_STORAGE_KEYS.LAST_INDEX) || '0'); this.state.currentIndex = (savedIndex >= 0 && savedIndex < this.state.currentWordList.length) ? savedIndex : 0; }
            catch (e) { this.state.currentIndex = 0; }
            this.launchApp(); return;
        }
        const lowerCaseStartWord = startWord.toLowerCase();
        const exactMatchIndex = this.state.currentWordList.findIndex(item => item.word.toLowerCase() === lowerCaseStartWord);
        if (exactMatchIndex !== -1) { this.state.currentIndex = exactMatchIndex; this.launchApp(); return; }
        const levenshteinSuggestions = this.state.currentWordList.map((item, index) => ({ word: item.word, index, distance: utils.levenshteinDistance(lowerCaseStartWord, item.word.toLowerCase()) })).sort((a, b) => a.distance - b.distance).slice(0, 5).filter(s => s.distance < s.word.length / 2 + 1);
        const searchRegex = new RegExp(`\\b${lowerCaseStartWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        const explanationMatches = this.state.currentWordList.map((item, index) => ({ word: item.word, index })).filter((item, index) => { const explanation = this.state.currentWordList[index].explanation; if (!explanation) return false; return searchRegex.test(explanation.replace(/\[.*?\]|\*/g, '')); });
        const title = (levenshteinSuggestions.length > 0 || explanationMatches.length > 0) ? `<strong>'${startWord}'</strong>(을)를 찾을 수 없습니다. 혹시 이 단어인가요?` : `<strong>'${startWord}'</strong>에 대한 검색 결과가 없습니다.`;
        this.displaySuggestions(levenshteinSuggestions, explanationMatches, title);
    },
    showError(message) { this.elements.loader.querySelector('.loader').style.display = 'none'; this.elements.loaderText.innerHTML = `<p class="text-red-500 font-bold">오류 발생</p><p class="text-sm text-gray-600 mt-2 break-all">${message}</p>`; },
    launchApp() {
        this.elements.startScreen.classList.add('hidden'); this.elements.loader.classList.add('hidden');
        this.elements.appContainer.classList.remove('hidden'); this.elements.fixedButtons.classList.remove('hidden'); app.elements.progressBarContainer.classList.remove('hidden');
        this.displayWord(this.state.currentIndex);
    },
    reset() { this.elements.startScreen.classList.add('hidden'); this.elements.appContainer.classList.add('hidden'); this.elements.loader.classList.add('hidden'); this.elements.fixedButtons.classList.add('hidden'); app.elements.progressBarContainer.classList.add('hidden'); this.resetStartScreen(); },
    resetStartScreen() { this.elements.startInputContainer.classList.remove('hidden'); this.elements.suggestionsContainer.classList.add('hidden'); this.elements.startWordInput.value = ''; this.elements.startWordInput.focus(); },
    displaySuggestions(vocabSuggestions, explanationSuggestions, title) {
        this.elements.loader.classList.add('hidden'); this.elements.startScreen.classList.remove('hidden'); this.elements.startInputContainer.classList.add('hidden'); this.elements.suggestionsTitle.innerHTML = title;
        const populateList = (listElement, suggestions) => {
            listElement.innerHTML = ''; if (suggestions.length === 0) { listElement.innerHTML = '<p class="text-gray-400 text-sm p-3">결과 없음</p>'; return; }
            suggestions.forEach(({ word, index }) => { const btn = document.createElement('button'); btn.className = 'w-full text-left bg-gray-100 hover:bg-gray-200 py-3 px-4 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300'; btn.textContent = word; btn.onclick = () => { this.state.currentIndex = index; this.launchApp(); }; listElement.appendChild(btn); });
        };
        populateList(this.elements.suggestionsVocabList, vocabSuggestions); populateList(this.elements.suggestionsExplanationList, explanationSuggestions);
        this.elements.suggestionsContainer.classList.remove('hidden');
    },
    async displayWord(index) {
        this.updateProgressBar(index);
        this.elements.cardBack.classList.remove('is-slid-up');
        const wordData = this.state.currentWordList[index];
        if (!wordData) return;
        if (!this.state.isMistakeMode && !this.state.isFavoriteMode) { try { localStorage.setItem(app.state.LOCAL_STORAGE_KEYS.LAST_INDEX, index); } catch (e) {} }
        this.elements.wordDisplay.textContent = wordData.word;
        this.adjustWordFontSize();
        if (wordData.word) api.speak(wordData.word, 'word');
        this.elements.meaningDisplay.innerHTML = wordData.meaning.replace(/\n/g, '<br>');
        ui.renderExplanationText(this.elements.explanationDisplay, wordData.explanation);
        this.elements.explanationContainer.classList.toggle('hidden', !wordData.explanation?.trim());
        const hasSample = wordData.sample && wordData.sample.trim() !== '';
        this.elements.sampleBtnImg.src = await imageDBCache.loadImage(hasSample ? 'images/cat-delivery.png' : 'images/cat-add.png');
        this.updateFavoriteIcon(utils.isFavorite(wordData.word));
    },
    adjustWordFontSize() {
        const wordDisplay = this.elements.wordDisplay; const container = wordDisplay.parentElement; if (!container) return;
        wordDisplay.style.fontSize = '';
        let currentFontSize = parseFloat(window.getComputedStyle(wordDisplay).fontSize);
        while (wordDisplay.scrollWidth > container.clientWidth - 80 && currentFontSize > 12) { currentFontSize -= 1; wordDisplay.style.fontSize = `${currentFontSize}px`; }
    },
    navigate(direction) {
        const len = this.state.currentWordList.length; if (len === 0) return;
        const isBackVisible = this.elements.cardBack.classList.contains('is-slid-up');
        const navigateAction = () => { this.state.currentIndex = (this.state.currentIndex + direction + len) % len; this.displayWord(this.state.currentIndex); };
        if (isBackVisible) { this.handleFlip(); setTimeout(navigateAction, 300); } else { navigateAction(); }
    },
    async navigateBackToBack(direction) {
        const len = this.state.currentWordList.length; if (len === 0) return;
        this.state.currentIndex = (this.state.currentIndex + direction + len) % len;
        const wordData = this.state.currentWordList[this.state.currentIndex];
        this.displayWord(this.state.currentIndex);
        if (!this.elements.cardBack.classList.contains('is-slid-up')) this.elements.cardBack.classList.add('is-slid-up');
        this.elements.backTitle.textContent = wordData.word;
        if (wordData.sample && wordData.sample.trim()) ui.displaySentences(wordData.sample.split('\n'), this.elements.backContent);
        else this.elements.backContent.innerHTML = '<div class="flex h-full items-center justify-center text-gray-400">등록된 예문이 없습니다.</div>';
        this.elements.sampleBtnImg.src = await imageDBCache.loadImage('images/cat-remove.png');
    },
    async handleFlip() {
        const isBackVisible = this.elements.cardBack.classList.contains('is-slid-up');
        const wordData = this.state.currentWordList[this.state.currentIndex];
        if (!wordData) return;
        if (!isBackVisible) {
            if (!wordData.sample || !wordData.sample.trim()) { app.showNoSampleMessage(); return; }
            this.elements.backTitle.textContent = wordData.word;
            ui.displaySentences(wordData.sample.split('\n'), this.elements.backContent);
            this.elements.cardBack.classList.add('is-slid-up');
            this.elements.sampleBtnImg.src = await imageDBCache.loadImage('images/cat-remove.png');
        } else {
            this.elements.cardBack.classList.remove('is-slid-up');
            const hasSample = wordData.sample && wordData.sample.trim() !== '';
            this.elements.sampleBtnImg.src = await imageDBCache.loadImage(hasSample ? 'images/cat-delivery.png' : 'images/cat-add.png');
        }
    },
    async startMistakeReview(mistakeWords) {
        this.state.isMistakeMode = true; this.state.isFavoriteMode = false;
        if (!app.state.isWordListReady) { await api.loadWordList(); await api.loadUserProgress(); }
        const wordMap = new Map(app.state.wordList.map(wordObj => [wordObj.word, wordObj]));
        this.state.currentWordList = mistakeWords.map(word => wordMap.get(word)).filter(Boolean); this.state.currentIndex = 0;
        if (this.state.currentWordList.length === 0) { app.showToast("오답 노트에 단어가 없습니다.", true); app.navigateTo('selection'); return; }
        this.launchApp();
    },
    async startFavoriteMode() {
        this.state.isMistakeMode = false; this.state.isFavoriteMode = true;
        if (!app.state.isWordListReady) { await api.loadWordList(); await api.loadUserProgress(); }
        const favoriteWords = utils.getFavoriteWords();
        if(favoriteWords.length === 0) { app.showToast("즐겨찾기에 등록된 단어가 없습니다.", true); app.navigateTo('selection'); return; }
        const wordMap = new Map(app.state.wordList.map(wordObj => [wordObj.word, wordObj]));
        this.state.currentWordList = favoriteWords.map(word => wordMap.get(word)).filter(Boolean); this.state.currentIndex = 0;
        this.launchApp();
    },
    handleKeyDown(e) {
        if (this.elements.appContainer.classList.contains('hidden') || document.activeElement.tagName.match(/INPUT|TEXTAREA/)) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); this.navigate(-1); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); this.navigate(1); }
        else if (e.key === 'Enter') { e.preventDefault(); this.handleFlip(); }
        else if (e.key === ' ') { e.preventDefault(); const word = this.state.currentWordList[this.state.currentIndex]?.word; if (word) api.speak(word, 'word'); }
        else if (e.key.toLowerCase() === 'z') { e.preventDefault(); this.navigateBackToBack(-1); }
        else if (e.key.toLowerCase() === 'x') { e.preventDefault(); this.navigateBackToBack(1); }
    },
    handleTouchStart(e) { if (this.elements.appContainer.classList.contains('hidden') || e.target.closest('button, a, input, [onclick], #progress-bar-track')) return; this.state.touchStartX = e.touches[0].clientX; this.state.touchStartY = e.touches[0].clientY; },
    handleTouchEnd(e) {
        if (this.elements.appContainer.classList.contains('hidden') || this.state.touchStartX === 0 || e.target.closest('button, a, input, [onclick], #progress-bar-track')) { this.state.touchStartX = this.state.touchStartY = 0; return; }
        const deltaX = e.changedTouches[0].clientX - this.state.touchStartX; const deltaY = e.changedTouches[0].clientY - this.state.touchStartY; const swipeThreshold = 50;
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > swipeThreshold) this.navigate(deltaX > 0 ? -1 : 1);
        else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > swipeThreshold) this.handleFlip();
        this.state.touchStartX = this.state.touchStartY = 0;
    },
    updateProgressBar(index) {
        const total = this.state.currentWordList.length;
        const percentage = total <= 1 ? 100 : (index / (total - 1)) * 100;
        this.elements.progressBarFill.style.width = `${percentage}%`; this.elements.progressBarHandle.style.left = `calc(${percentage}% - ${this.elements.progressBarHandle.offsetWidth / 2}px)`;
        if (this.elements.progressBarNumber) { this.elements.progressBarNumber.textContent = index + 1; this.elements.progressBarNumber.style.left = `${percentage}%`; }
    },
    handleProgressBarInteraction(e) {
        if (learningMode.elements.appContainer.classList.contains('hidden')) return;
        const totalWords = this.state.currentWordList.length; if (totalWords <= 1) return;
        const handleInteraction = (clientX) => { const rect = this.elements.progressBarTrack.getBoundingClientRect(); const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)); const newIndex = Math.round(percentage * (totalWords - 1)); if (newIndex !== this.state.currentIndex) { this.state.currentIndex = newIndex; this.displayWord(newIndex); } };
        switch (e.type) { case 'mousedown': case 'touchstart': e.preventDefault(); this.state.isDragging = true; handleInteraction(e.type === 'touchstart' ? e.touches[0].clientX : e.clientX); break; case 'mousemove': case 'touchmove': if (this.state.isDragging) handleInteraction(e.type === 'touchmove' ? e.touches[0].clientX : e.clientX); break; case 'mouseup': case 'mouseleave': case 'touchend': this.state.isDragging = false; break; }
    },
    async toggleFavorite() {
        const wordData = this.state.currentWordList[this.state.currentIndex]; if (!wordData) return;
        const newStatus = await api.toggleFavorite(wordData.word); this.updateFavoriteIcon(newStatus);
        if (this.state.isFavoriteMode && !newStatus) { this.state.currentWordList.splice(this.state.currentIndex, 1); if (this.state.currentWordList.length === 0) { app.showToast("즐겨찾기 목록이 비었습니다.", false); app.navigateTo('selection'); return; } if(this.state.currentIndex >= this.state.currentWordList.length) this.state.currentIndex = this.state.currentWordList.length - 1; this.displayWord(this.state.currentIndex); }
    },
    updateFavoriteIcon(isFavorite) { this.elements.favoriteIcon.classList.toggle('text-yellow-400', isFavorite); this.elements.favoriteIcon.classList.toggle('text-gray-400', !isFavorite); this.elements.favoriteIcon.classList.toggle('fill-current', isFavorite); }
};

document.addEventListener('firebaseSDKLoaded', () => {
    ({ initializeApp, getDatabase, ref, get, update, set, getAuth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, getFirestore, doc, getDoc, setDoc, updateDoc, writeBatch } = window.firebaseSDK);
    window.firebaseSDK.writeBatch = writeBatch;
    app.init();
});