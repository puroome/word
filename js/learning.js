import { state } from './config.js';
import { api } from './api.js';
import { utils, imageDBCache } from './utils.js';
import { ui } from './ui.js';

export const learningMode = {
    state: {
        currentIndex: 0,
        isMistakeMode: false,
        isFavoriteMode: false,
        currentWordList: [],
        isDragging: false,
        touchStartX: 0,
        touchStartY: 0,
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
    bindEvents() {
        this.elements.startBtn.addEventListener('click', () => this.start());
        this.elements.startWordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this.start();
            }
        });
        this.elements.startWordInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^a-zA-Z\s'-]/g, (match) => {
                if (match) window.dispatchEvent(new CustomEvent('showImeWarning'));
                return '';
            });
        });
        this.elements.backToStartBtn.addEventListener('click', () => this.resetStartScreen());
        this.elements.nextBtn.addEventListener('click', () => this.navigate(1));
        this.elements.prevBtn.addEventListener('click', () => this.navigate(-1));
        this.elements.sampleBtn.addEventListener('click', () => this.handleFlip());
        this.elements.favoriteBtn.addEventListener('click', () => this.toggleFavorite());

        this.elements.wordDisplay.addEventListener('click', () => {
            const word = this.state.currentWordList[this.state.currentIndex]?.word;
            if (word) { api.speak(word, 'word'); }
        });
        this.elements.wordDisplay.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const wordData = this.state.currentWordList[this.state.currentIndex];
            if (wordData) ui.showWordContextMenu(e, wordData.word, { hideAppSearch: true });
        });

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
        this.state.isMistakeMode = false;
        this.state.isFavoriteMode = false;
        this.elements.startScreen.classList.add('hidden');
        this.elements.loader.classList.remove('hidden');
        if (!state.isWordListReady) {
            this.elements.loaderText.textContent = "단어 목록 동기화 중...";
            try {
                await api.loadWordList();
                await api.loadUserProgress();
            } catch(e) {
                this.showError("단어 목록 로딩 실패. 새로고침 해주세요.");
                return;
            }
        }
        const startWord = this.elements.startWordInput.value.trim();
        this.state.currentWordList = state.wordList;

        if (this.state.currentWordList.length === 0) { this.showError("학습할 단어가 없습니다."); return; }

        if (!startWord) {
            try {
                const savedIndex = parseInt(localStorage.getItem(state.LOCAL_STORAGE_KEYS.LAST_INDEX) || '0');
                 this.state.currentIndex = (savedIndex >= 0 && savedIndex < this.state.currentWordList.length) ? savedIndex : 0;
            } catch (e) {
                console.warn("Error reading last index:", e);
                this.state.currentIndex = 0;
            }
            this.launchApp();
            return;
        }

        const lowerCaseStartWord = startWord.toLowerCase();
        const exactMatchIndex = this.state.currentWordList.findIndex(item => item.word.toLowerCase() === lowerCaseStartWord);
        if (exactMatchIndex !== -1) {
            this.state.currentIndex = exactMatchIndex;
            this.launchApp();
            return;
        }

        const levenshteinSuggestions = this.state.currentWordList.map((item, index) => ({
            word: item.word, index, distance: utils.levenshteinDistance(lowerCaseStartWord, item.word.toLowerCase())
        })).sort((a, b) => a.distance - b.distance).slice(0, 5).filter(s => s.distance < s.word.length / 2 + 1);

        const searchRegex = new RegExp(`\\b${lowerCaseStartWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        const explanationMatches = this.state.currentWordList
            .map((item, index) => ({ word: item.word, index }))
            .filter((item, index) => {
                const explanation = this.state.currentWordList[index].explanation;
                 if (!explanation) return false;
                const cleanedExplanation = explanation.replace(/\[.*?\]|\*/g, '');
                return searchRegex.test(cleanedExplanation);
            });

        const title = (levenshteinSuggestions.length > 0 || explanationMatches.length > 0)
            ? `<strong>'${startWord}'</strong>(을)를 찾을 수 없습니다. 혹시 이 단어인가요?`
            : `<strong>'${startWord}'</strong>에 대한 검색 결과가 없습니다.`;
        this.displaySuggestions(levenshteinSuggestions, explanationMatches, title);
    },
    showError(message) {
        this.elements.loader.querySelector('.loader').style.display = 'none';
        this.elements.loaderText.innerHTML = `<p class="text-red-500 font-bold">오류 발생</p><p class="text-sm text-gray-600 mt-2 break-all">${message}</p>`;
    },
    launchApp() {
        this.elements.startScreen.classList.add('hidden');
        this.elements.loader.classList.add('hidden');
        this.elements.appContainer.classList.remove('hidden');
        this.elements.fixedButtons.classList.remove('hidden');
        document.getElementById('progress-bar-container').classList.remove('hidden');
        this.displayWord(this.state.currentIndex);
    },
    reset() {
        this.elements.startScreen.classList.add('hidden');
        this.elements.appContainer.classList.add('hidden');
        this.elements.loader.classList.add('hidden');
        this.elements.fixedButtons.classList.add('hidden');
        document.getElementById('progress-bar-container').classList.add('hidden');
        this.resetStartScreen();
    },
    resetStartScreen() {
        this.elements.startInputContainer.classList.remove('hidden');
        this.elements.suggestionsContainer.classList.add('hidden');
        this.elements.startWordInput.value = '';
        this.elements.startWordInput.focus();
    },
    displaySuggestions(vocabSuggestions, explanationSuggestions, title) {
        this.elements.loader.classList.add('hidden');
        this.elements.startScreen.classList.remove('hidden');
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
                btn.className = 'w-full text-left bg-gray-100 hover:bg-gray-200 py-3 px-4 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300';
                btn.textContent = word;
                btn.onclick = () => {
                     this.state.currentIndex = index;
                     this.launchApp();
                 };
                listElement.appendChild(btn);
            });
        };
        populateList(this.elements.suggestionsVocabList, vocabSuggestions);
        populateList(this.elements.suggestionsExplanationList, explanationSuggestions);
        this.elements.suggestionsContainer.classList.remove('hidden');
    },
    async displayWord(index) {
        this.updateProgressBar(index);
        this.elements.cardBack.classList.remove('is-slid-up');
        const wordData = this.state.currentWordList[index];
        if (!wordData) {
             console.error(`Word data not found for index: ${index}`);
             return;
        }

         if (!this.state.isMistakeMode && !this.state.isFavoriteMode) {
            try {
                localStorage.setItem(state.LOCAL_STORAGE_KEYS.LAST_INDEX, index);
            } catch (e) { console.error(e); }
        }

        this.elements.wordDisplay.textContent = wordData.word;
        this.adjustWordFontSize();
        
        if (wordData.word) {
            api.speak(wordData.word, 'word');
        }
        
        this.elements.meaningDisplay.innerHTML = wordData.meaning.replace(/\n/g, '<br>');
        ui.renderExplanationText(this.elements.explanationDisplay, wordData.explanation);
        this.elements.explanationContainer.classList.toggle('hidden', !wordData.explanation?.trim());

        const hasSample = wordData.sample && wordData.sample.trim() !== '';
        const sampleImgUrl = 'images/cat-delivery.png';
        const noSampleImgUrl = 'images/cat-add.png';
        this.elements.sampleBtnImg.src = await imageDBCache.loadImage(hasSample ? sampleImgUrl : noSampleImgUrl);

        this.updateFavoriteIcon(utils.isFavorite(wordData.word));
    },
    adjustWordFontSize() {
        const wordDisplay = this.elements.wordDisplay;
        const container = wordDisplay.parentElement;
        if (!container) return;

        wordDisplay.style.fontSize = '';
        const defaultFontSize = parseFloat(window.getComputedStyle(wordDisplay).fontSize);
        let currentFontSize = defaultFontSize;
        const padding = 80;

        while (wordDisplay.scrollWidth > container.clientWidth - padding && currentFontSize > 12) {
            currentFontSize -= 1;
            wordDisplay.style.fontSize = `${currentFontSize}px`;
        }
    },
    navigate(direction) {
        const len = this.state.currentWordList.length;
        if (len === 0) return;

        const isBackVisible = this.elements.cardBack.classList.contains('is-slid-up');
        const navigateAction = () => {
            this.state.currentIndex = (this.state.currentIndex + direction + len) % len;
            this.displayWord(this.state.currentIndex);
        };

        if (isBackVisible) {
            this.handleFlip();
            setTimeout(navigateAction, 300);
        } else {
            navigateAction();
        }
    },
    async navigateBackToBack(direction) {
        const len = this.state.currentWordList.length;
        if (len === 0) return;

        this.state.currentIndex = (this.state.currentIndex + direction + len) % len;
        const wordData = this.state.currentWordList[this.state.currentIndex];

        this.displayWord(this.state.currentIndex);

        if (!this.elements.cardBack.classList.contains('is-slid-up')) {
            this.elements.cardBack.classList.add('is-slid-up');
        }

        this.elements.backTitle.textContent = wordData.word;
        
        if (wordData.sample && wordData.sample.trim()) {
            ui.displaySentences(wordData.sample.split('\n'), this.elements.backContent);
        } else {
            this.elements.backContent.innerHTML = '<div class="flex h-full items-center justify-center text-gray-400">등록된 예문이 없습니다.</div>';
        }

        // ▼▼▼ [수정됨] AI 예문 생성 버튼 추가 ▼▼▼
        this.appendAIGenButton(this.elements.backContent, wordData);
        // ▲▲▲

        const backImgUrl = 'images/cat-remove.png';
        this.elements.sampleBtnImg.src = await imageDBCache.loadImage(backImgUrl);
    },
    async handleFlip() {
        const isBackVisible = this.elements.cardBack.classList.contains('is-slid-up');
        const wordData = this.state.currentWordList[this.state.currentIndex];
        if (!wordData) return;

        const backImgUrl = 'images/cat-remove.png';
        const sampleImgUrl = 'images/cat-delivery.png';
        const noSampleImgUrl = 'images/cat-add.png';

        if (!isBackVisible) {
            if (!wordData.sample || !wordData.sample.trim()) {
                window.dispatchEvent(new CustomEvent('showNoSampleMessage'));
                return;
            }
            this.elements.backTitle.textContent = wordData.word;
            ui.displaySentences(wordData.sample.split('\n'), this.elements.backContent);

            // ▼▼▼ [수정됨] AI 예문 생성 버튼 추가 ▼▼▼
            this.appendAIGenButton(this.elements.backContent, wordData);
            // ▲▲▲

            this.elements.cardBack.classList.add('is-slid-up');
            this.elements.sampleBtnImg.src = await imageDBCache.loadImage(backImgUrl);
        } else {
            this.elements.cardBack.classList.remove('is-slid-up');
            const hasSample = wordData.sample && wordData.sample.trim() !== '';
            this.elements.sampleBtnImg.src = await imageDBCache.loadImage(hasSample ? sampleImgUrl : noSampleImgUrl);
        }
    },
    async startMistakeReview(mistakeWords) {
        this.state.isMistakeMode = true;
        this.state.isFavoriteMode = false;
        if (!state.isWordListReady) {
            await api.loadWordList();
            await api.loadUserProgress();
        }
        const wordMap = new Map(state.wordList.map(wordObj => [wordObj.word, wordObj]));
        this.state.currentWordList = mistakeWords.map(word => wordMap.get(word)).filter(Boolean);
        this.state.currentIndex = 0;

        if (this.state.currentWordList.length === 0) {
            window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "오답 노트에 단어가 없습니다.", isError: true } }));
            window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'selection' } }));
            return;
        }
        this.launchApp();
    },
    async startFavoriteMode() {
        this.state.isMistakeMode = false;
        this.state.isFavoriteMode = true;
        if (!state.isWordListReady) {
            await api.loadWordList();
            await api.loadUserProgress();
        }
        const favoriteWords = utils.getFavoriteWords();
        if(favoriteWords.length === 0) {
            window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "즐겨찾기에 등록된 단어가 없습니다.", isError: true } }));
            window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'selection' } }));
            return;
        }
        const wordMap = new Map(state.wordList.map(wordObj => [wordObj.word, wordObj]));
        this.state.currentWordList = favoriteWords.map(word => wordMap.get(word)).filter(Boolean);
        this.state.currentIndex = 0;
        this.launchApp();
    },
    handleKeyDown(e) {
        if (this.elements.appContainer.classList.contains('hidden') || document.activeElement.tagName.match(/INPUT|TEXTAREA/)) return;

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            this.navigate(-1);
        } else if (e.key === 'ArrowRight') {
             e.preventDefault();
            this.navigate(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.navigate(1);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.navigate(-1);
        } else if (e.key === 'Enter') {
             e.preventDefault();
            this.handleFlip();
        } else if (e.key === ' ') {
            e.preventDefault();
            const word = this.state.currentWordList[this.state.currentIndex]?.word;
            if (word) {
                api.speak(word, 'word');
            }
        } else if (e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.navigateBackToBack(-1);
        } else if (e.key.toLowerCase() === 'x') {
            e.preventDefault();
            this.navigateBackToBack(1);
        }
    },
    handleTouchStart(e) {
         if (this.elements.appContainer.classList.contains('hidden') || e.target.closest('button, a, input, [onclick], #progress-bar-track')) return;
        this.state.touchStartX = e.touches[0].clientX;
        this.state.touchStartY = e.touches[0].clientY;
    },
    handleTouchEnd(e) {
        if (this.elements.appContainer.classList.contains('hidden') || this.state.touchStartX === 0 || e.target.closest('button, a, input, [onclick], #progress-bar-track')) {
             this.state.touchStartX = this.state.touchStartY = 0;
            return;
        }
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchEndX - this.state.touchStartX;
        const deltaY = touchEndY - this.state.touchStartY;
        const swipeThreshold = 50;

        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > swipeThreshold) {
            this.navigate(deltaX > 0 ? -1 : 1);
        }
        else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > swipeThreshold) {
            this.handleFlip();
        }

        this.state.touchStartX = this.state.touchStartY = 0;
    },
    updateProgressBar(index) {
        const total = this.state.currentWordList.length;
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
        if (this.elements.appContainer.classList.contains('hidden')) return;

        const track = this.elements.progressBarTrack;
        const totalWords = this.state.currentWordList.length;
        if (totalWords <= 1) return;

        const handleInteraction = (clientX) => {
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
    async toggleFavorite() {
        const wordData = this.state.currentWordList[this.state.currentIndex];
        if (!wordData) return;
        const newStatus = await api.toggleFavorite(wordData.word);
        this.updateFavoriteIcon(newStatus);

        if (this.state.isFavoriteMode && !newStatus) {
            this.state.currentWordList.splice(this.state.currentIndex, 1);
            if (this.state.currentWordList.length === 0) {
                window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "즐겨찾기 목록이 비었습니다." } }));
                window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'selection' } }));
                return;
            }
            if(this.state.currentIndex >= this.state.currentWordList.length) {
                this.state.currentIndex = this.state.currentWordList.length - 1;
            }
            this.displayWord(this.state.currentIndex);
        }
    },
    updateFavoriteIcon(isFavorite) {
        this.elements.favoriteIcon.classList.toggle('text-yellow-400', isFavorite);
        this.elements.favoriteIcon.classList.toggle('text-gray-400', !isFavorite);
        this.elements.favoriteIcon.classList.toggle('fill-current', isFavorite);
    },

    // ▼▼▼ [새로 추가] AI 버튼 생성 및 처리 함수 ▼▼▼
    appendAIGenButton(container, wordData) {
        // 이미 생성된 AI 섹션이 있다면 중복 추가 방지
        if (container.querySelector('.ai-gen-section')) return;

        const section = document.createElement('div');
        section.className = 'ai-gen-section mt-6 border-t pt-4 text-center';

        const btn = document.createElement('button');
        btn.className = 'text-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-700 py-2 px-4 rounded-full transition-colors font-semibold flex items-center justify-center mx-auto gap-2';
        btn.innerHTML = `<span>🤖 다른 뜻 예문 추가 (AI)</span>`;
        
        btn.onclick = async () => {
            btn.disabled = true;
            btn.innerHTML = `<div class="loader w-4 h-4 border-2 border-indigo-700 border-t-transparent rounded-full animate-spin"></div> 생성 중...`;
            
            try {
                // API 호출
                const aiSentences = await api.generateAIExamples(wordData.word, wordData.meaning);
                
                // 결과 표시를 위해 섹션 초기화
                section.innerHTML = ''; 
                
                const label = document.createElement('div');
                label.className = 'text-left text-xs font-bold text-indigo-500 mb-2 ml-1';
                label.textContent = '🤖 AI가 만든 추가 예문 (다른 뜻 활용)';
                section.appendChild(label);

                // 예문 렌더링
                aiSentences.forEach(item => {
                    const p = document.createElement('p');
                    p.className = 'p-2 rounded transition-colors hover:bg-indigo-50 cursor-pointer text-left mb-1';
                    
                    // 🤖 아이콘
                    const iconSpan = document.createElement('span');
                    iconSpan.textContent = '🤖 ';
                    p.appendChild(iconSpan);

                    // 영어 문장
                    const contentSpan = document.createElement('span');
                    contentSpan.textContent = item.en;
                    p.appendChild(contentSpan);

                    // 클릭 시 읽어주기 + 번역 툴팁
                    p.onclick = (e) => {
                        api.speak(item.en, 'sample');
                        ui.showTranslationTooltip(item.ko, e);
                    };

                    section.appendChild(p);
                });

            } catch (err) {
                btn.innerHTML = `⚠️ 생성 실패 (다시 시도)`;
                btn.disabled = false;
                console.error(err);
                // 에러 토스트 메시지
                window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "AI 예문 생성 중 오류가 발생했습니다.", isError: true } }));
            }
        };

        section.appendChild(btn);
        container.appendChild(section);
    }
    // ▲▲▲ [여기까지 추가됨] ▲▲▲
};
