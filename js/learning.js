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
        isEditing: false, 
        editSide: null, // 'front' or 'back'
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
            wordHeader: document.getElementById('word-header'),
            meaningDisplay: document.getElementById('meaning-display'),
            explanationDisplay: document.getElementById('explanation-display'),
            meaningContainer: document.getElementById('meaning-container'),
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
            editContextBtn: document.getElementById('edit-context-btn'),
            
            // 배경 우클릭 메뉴 및 삭제 모달 요소
            actionContextMenu: document.getElementById('action-context-menu'),
            createCardBtn: document.getElementById('create-card-btn'),
            deleteCardBtn: document.getElementById('delete-card-btn'),
            deleteModal: document.getElementById('delete-confirm-modal'),
            deleteTargetWord: document.getElementById('delete-target-word'),
            deleteCancelBtn: document.getElementById('delete-cancel-btn'),
            deleteConfirmBtn: document.getElementById('delete-confirm-btn'),
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
        
        // -----------------------------------------------------------
        // [수정 및 정리] 우클릭 이벤트 핸들링
        // -----------------------------------------------------------

        // 1. 표제어 텍스트(h1) 우클릭 -> 사전 검색 메뉴
        this.elements.wordDisplay.addEventListener('contextmenu', (e) => {
            if (this.state.isEditing) return;
            const wordData = this.state.currentWordList[this.state.currentIndex];
            if (wordData) ui.showWordContextMenu(e, wordData.word, { hideAppSearch: true });
        });

        // 2. 표제어 헤더 영역(빈 공간) 우클릭 -> 앞면 편집 메뉴
        this.elements.wordHeader.addEventListener('contextmenu', (e) => {
            if (this.state.isEditing) return;
            // 텍스트나 버튼 클릭이 아닌 경우에만 편집 메뉴
            if (e.target.closest('#word-display') || e.target.closest('#favorite-btn')) return;
            e.preventDefault();
            this.handleEditContextMenu(e, 'front');
        });

        // 3. 뜻/설명 영역 우클릭 -> 앞면 편집 메뉴
        this.elements.meaningContainer.addEventListener('contextmenu', (e) => this.handleEditContextMenu(e, 'front'));
        this.elements.explanationContainer.addEventListener('contextmenu', (e) => this.handleEditContextMenu(e, 'front'));

        // 4. 뒷면 표제어 또는 예문 영역 우클릭 -> 뒷면 편집 메뉴
        this.elements.backTitle.addEventListener('contextmenu', (e) => {
            if (this.state.isEditing) return;
            e.preventDefault();
            e.stopPropagation();
            this.handleEditContextMenu(e, 'back');
        });
        this.elements.cardBack.addEventListener('contextmenu', (e) => {
             if (this.state.isEditing) return;
             if(e.target.closest('.interactive-word')) return; // 인터랙티브 단어는 제외
             this.handleEditContextMenu(e, 'back');
        });

        // 5. [수정됨] 배경 우클릭 -> 카드 생성/삭제 메뉴
        // document 전체에 이벤트를 걸되, 조건을 엄격하게 체크하여 다른 모드에서 뜨지 않도록 함
        document.addEventListener('contextmenu', (e) => {
            // (1) 현재 학습 모드 화면(appContainer)이 숨겨져 있으면 무시 (대시보드, 퀴즈, 시작화면 등)
            if (this.elements.appContainer.classList.contains('hidden')) return;
            // (2) 혹시라도 전체 컨테이너가 숨겨져 있어도 무시
            if (document.getElementById('learning-mode-container').classList.contains('hidden')) return;

            // (3) 카드 내부(앞면/뒷면)나 버튼, 기존 메뉴들을 클릭한 경우 무시
            if (e.target.closest('#learning-card-front') || 
                e.target.closest('#learning-card-back') || 
                e.target.closest('.fixed-buttons') ||
                e.target.closest('#word-context-menu') ||
                e.target.closest('#edit-context-menu') ||
                e.target.closest('#action-context-menu')) {
                return;
            }

            // 위 조건들을 통과한 경우(배경 빈 공간)에만 메뉴 표시
            this.handleActionContextMenu(e);
        });

        // 6. 편집 메뉴 버튼 클릭
        this.elements.editContextBtn.addEventListener('click', () => {
            const side = this.elements.editContextBtn.dataset.side || 'front';
            if (side === 'front') this.enterFrontEditMode();
            else this.enterBackEditMode();
            ui.hideEditContextMenu();
        });

        // 7. 생성/삭제 메뉴 버튼 클릭
        this.elements.createCardBtn.addEventListener('click', () => { this.createNewCard(); this.hideActionMenu(); });
        this.elements.deleteCardBtn.addEventListener('click', () => { this.confirmDeleteCard(); this.hideActionMenu(); });

        // 8. 삭제 모달 버튼
        this.elements.deleteCancelBtn.addEventListener('click', () => this.elements.deleteModal.classList.add('hidden'));
        this.elements.deleteConfirmBtn.addEventListener('click', () => this.deleteCurrentCard());

        // 배경 클릭 시 메뉴 닫기
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#edit-context-menu')) ui.hideEditContextMenu();
            if (!e.target.closest('#action-context-menu')) this.hideActionMenu();
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

    handleEditContextMenu(e, side) {
        if (this.state.isEditing) return;
        e.preventDefault();
        this.elements.editContextBtn.dataset.side = side;
        ui.showEditContextMenu(e);
    },

    handleActionContextMenu(e) {
        if (this.state.isEditing) return;
        e.preventDefault();
        const menu = this.elements.actionContextMenu;
        menu.classList.remove('hidden');
        // 위치 조정 (화면 밖으로 나가지 않도록)
        let x = e.clientX;
        let y = e.clientY;
        const menuRect = menu.getBoundingClientRect(); // 처음엔 숨겨져 있어서 정확하지 않을 수 있으나 일단 시도
        
        // requestAnimationFrame으로 보여진 직후 위치 보정
        requestAnimationFrame(() => {
             const rect = menu.getBoundingClientRect();
             if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 10;
             if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 10;
             menu.style.left = `${x}px`;
             menu.style.top = `${y}px`;
        });
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
    },
    hideActionMenu() {
        this.elements.actionContextMenu.classList.add('hidden');
    },

    async enterFrontEditMode() {
        this.state.isEditing = true;
        this.state.editSide = 'front';
        const wordData = this.state.currentWordList[this.state.currentIndex];

        const posText = wordData.pos ? ` [${wordData.pos}]` : '';
        const wordValue = `${wordData.word}${posText}`;
        
        this.elements.wordDisplay.innerHTML = `<input type="text" id="edit-word-input" class="w-full text-center font-bold bg-white border-b-2 border-blue-500 focus:outline-none" style="font-size:inherit;" value="${wordValue}">`;
        this.elements.meaningDisplay.innerHTML = `<textarea id="edit-meaning-input" class="w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" rows="3">${wordData.meaning || ""}</textarea>`;
        this.elements.explanationDisplay.innerHTML = `<textarea id="edit-explanation-input" class="w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" rows="5">${wordData.explanation || ""}</textarea>`;

        const editImgUrl = 'images/cat-edit.png';
        this.elements.sampleBtnImg.src = await imageDBCache.loadImage(editImgUrl);
    },

    async enterBackEditMode() {
        this.state.isEditing = true;
        this.state.editSide = 'back';
        const wordData = this.state.currentWordList[this.state.currentIndex];

        let currentSample = "";
        if (wordData.sampleSource === 'ai' && wordData.AISample) {
            currentSample = wordData.AISample.en || "";
        } else {
            currentSample = wordData.sample || "";
        }

        this.elements.backContent.innerHTML = `<textarea id="edit-sample-input" class="w-full h-full p-4 border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg leading-relaxed resize-none">${currentSample}</textarea>`;

        const editImgUrl = 'images/cat-edit.png';
        this.elements.sampleBtnImg.src = await imageDBCache.loadImage(editImgUrl);
    },

    async saveAndExitEditMode() {
        const wordData = this.state.currentWordList[this.state.currentIndex];

        if (this.state.editSide === 'front') {
            const wordInput = document.getElementById('edit-word-input');
            const meaningInput = document.getElementById('edit-meaning-input');
            const expInput = document.getElementById('edit-explanation-input');

            if (wordInput && meaningInput && expInput) {
                const fullWordVal = wordInput.value.trim();
                let newWord = fullWordVal;
                let newPos = "";
                
                const match = fullWordVal.match(/^(.*)\s\[(.*)\]$/);
                if (match) {
                    newWord = match[1].trim();
                    newPos = match[2].trim();
                }

                await api.updateWordDetails(wordData, meaningInput.value, expInput.value, newWord, newPos);
            }
        } else if (this.state.editSide === 'back') {
            const sampleInput = document.getElementById('edit-sample-input');
            if (sampleInput) {
                await api.updateWordDetails(wordData, undefined, undefined, undefined, undefined, sampleInput.value);
            }
        }

        this.state.isEditing = false;
        this.state.editSide = null;
        this.displayWord(this.state.currentIndex);
    },

    confirmDeleteCard() {
        const wordData = this.state.currentWordList[this.state.currentIndex];
        this.elements.deleteTargetWord.textContent = wordData.word;
        this.elements.deleteModal.classList.remove('hidden');
    },
    async deleteCurrentCard() {
        const wordData = this.state.currentWordList[this.state.currentIndex];
        this.elements.deleteModal.classList.add('hidden');
        
        await api.deleteWord(wordData);
        
        if (this.state.currentWordList.length === 0) {
            window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "모든 단어가 삭제되었습니다." } }));
            window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'selection' } }));
        } else {
            if (this.state.currentIndex >= this.state.currentWordList.length) {
                this.state.currentIndex = this.state.currentWordList.length - 1;
            }
            this.displayWord(this.state.currentIndex);
            window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "삭제되었습니다." } }));
        }
    },

    async createNewCard() {
        const currentData = this.state.currentWordList[this.state.currentIndex];
        
        await api.createWord(currentData);
        
        this.state.currentIndex = this.state.currentIndex + 1;
        this.displayWord(this.state.currentIndex);
        
        setTimeout(() => this.enterFrontEditMode(), 100);
    },

    async handleFlip() {
        if (this.state.isEditing) {
            await this.saveAndExitEditMode();
            return;
        }

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
            this.appendAIGenButton(this.elements.backContent, wordData);

            this.elements.cardBack.classList.add('is-slid-up');
            this.elements.sampleBtnImg.src = await imageDBCache.loadImage(backImgUrl);
        } else {
            this.elements.cardBack.classList.remove('is-slid-up');
            const hasSample = wordData.sample && wordData.sample.trim() !== '';
            this.elements.sampleBtnImg.src = await imageDBCache.loadImage(hasSample ? sampleImgUrl : noSampleImgUrl);
        }
    },
    
    async displayWord(index, silent = false) {
        this.state.isEditing = false;
        this.updateProgressBar(index);
        this.elements.cardBack.classList.remove('is-slid-up');
        const wordData = this.state.currentWordList[index];
        if (!wordData) return;

         if (!this.state.isMistakeMode && !this.state.isFavoriteMode) {
            try {
                localStorage.setItem(state.LOCAL_STORAGE_KEYS.LAST_INDEX, index);
            } catch (e) { console.error(e); }
        }

        this.elements.wordDisplay.innerHTML = wordData.word;
        this.adjustWordFontSize();
        
        if (wordData.word && !silent) {
            api.speak(wordData.word, 'word');
        }
        
        this.elements.meaningDisplay.innerHTML = wordData.meaning.replace(/\n/g, '<br>');
        ui.renderExplanationText(this.elements.explanationDisplay, wordData.explanation);
        this.elements.explanationContainer.classList.remove('hidden');

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
        if (this.state.isEditing) return;

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
        if (this.state.isEditing) return;

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

        this.appendAIGenButton(this.elements.backContent, wordData);

        const backImgUrl = 'images/cat-remove.png';
        this.elements.sampleBtnImg.src = await imageDBCache.loadImage(backImgUrl);
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
        if (this.elements.appContainer.classList.contains('hidden')) return;
        if (this.state.isEditing) return;
        if (document.activeElement.tagName.match(/INPUT|TEXTAREA/)) return;

        if (e.key === 'ArrowLeft') { e.preventDefault(); this.navigate(-1); } 
        else if (e.key === 'ArrowRight') { e.preventDefault(); this.navigate(1); } 
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.navigate(1); } 
        else if (e.key === 'ArrowDown') { e.preventDefault(); this.navigate(-1); } 
        else if (e.key === 'Enter') { e.preventDefault(); this.handleFlip(); } 
        else if (e.key === ' ') { e.preventDefault(); const word = this.state.currentWordList[this.state.currentIndex]?.word; if (word) api.speak(word, 'word'); } 
        else if (e.key.toLowerCase() === 'z') { e.preventDefault(); this.navigateBackToBack(-1); } 
        else if (e.key.toLowerCase() === 'x') { e.preventDefault(); this.navigateBackToBack(1); }
    },
    handleTouchStart(e) {
         if (this.elements.appContainer.classList.contains('hidden') || e.target.closest('button, a, input, [onclick], #progress-bar-track')) return;
         if (this.state.isEditing) return; 
        this.state.touchStartX = e.touches[0].clientX;
        this.state.touchStartY = e.touches[0].clientY;
    },
    handleTouchEnd(e) {
        if (this.elements.appContainer.classList.contains('hidden') || this.state.touchStartX === 0 || e.target.closest('button, a, input, [onclick], #progress-bar-track')) {
             this.state.touchStartX = this.state.touchStartY = 0;
            return;
        }
        if (this.state.isEditing) return;

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
        if (this.state.isEditing) return;

        const track = this.elements.progressBarTrack;
        const totalWords = this.state.currentWordList.length;
        if (totalWords <= 1) return;

        const handleInteraction = (clientX, isDraggingMove = false) => {
            const rect = track.getBoundingClientRect();
            const x = clientX - rect.left;
            const percentage = Math.max(0, Math.min(1, x / rect.width));
            const newIndex = Math.round(percentage * (totalWords - 1));
            if (newIndex !== this.state.currentIndex) {
                this.state.currentIndex = newIndex;
                this.displayWord(newIndex, isDraggingMove);
            }
        };

        switch (e.type) {
            case 'mousedown':
            case 'touchstart':
                e.preventDefault();
                this.state.isDragging = true;
                handleInteraction(e.type === 'touchstart' ? e.touches[0].clientX : e.clientX, false);
                break;
            case 'mousemove':
            case 'touchmove':
                if (this.state.isDragging) {
                    handleInteraction(e.type === 'touchmove' ? e.touches[0].clientX : e.clientX, true);
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
        this.elements.favoriteIcon.classList.remove('text-gray-400');
        this.elements.favoriteIcon.classList.toggle('text-yellow-400', isFavorite);
        this.elements.favoriteIcon.classList.toggle('text-white', !isFavorite);
    },

    appendAIGenButton(container, wordData) {
        let section = container.querySelector('.ai-gen-section');
        if (!section) {
            section = document.createElement('div');
            section.className = 'ai-gen-section mt-6 border-t pt-4';
            container.appendChild(section);
        }
        section.innerHTML = '';

        if (wordData.AISample && wordData.AISample.en) {
            const sentences = wordData.AISample.en.split('\n').filter(s => s.trim() !== '');
            sentences.forEach((sent, index) => {
                this.renderAIContentRow(section, wordData, sent, index, sentences);
            });
        } else {
            this.renderInitialGenButton(section, wordData);
        }
    },

    renderInitialGenButton(container, wordData) {
        const btn = document.createElement('button');
        btn.className = 'text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-600 py-2 px-4 rounded-full transition-colors font-semibold flex items-center justify-center mx-auto gap-2 shadow-sm';
        btn.innerHTML = `<span>🤖 AI 예문 생성</span>`;
        
        btn.onclick = async () => {
            btn.disabled = true;
            btn.innerHTML = `<span class="animate-spin">⏳</span> 생성 중...`;
            
            try {
                const newSentences = await api.generateAIExamples(wordData, wordData.meaning, 2);
                const fullText = newSentences.join('\n');
                wordData.AISample = { en: fullText, ko: "" };
                api.saveAISamplesToSheet(wordData, fullText);
                this.appendAIGenButton(container.parentNode, wordData);
            } catch (err) {
                console.error(err);
                btn.innerHTML = `⚠️ 실패 (다시 시도)`;
                btn.disabled = false;
            }
        };
        container.appendChild(btn);
    },

    renderAIContentRow(container, wordData, sentenceText, index, allSentences) {
        const p = document.createElement('p');
        p.className = 'p-2 rounded transition-colors hover:bg-gray-200 cursor-pointer relative group'; 

        const botBtn = document.createElement('button');
        botBtn.className = "float-left mr-2 text-base focus:outline-none transition-transform hover:scale-110"; 
        botBtn.innerHTML = "🤖";
        botBtn.title = "이 예문만 다시 만들기";
        
        botBtn.onclick = async (e) => {
            e.stopPropagation();
            botBtn.innerHTML = `<span class="animate-spin text-xs inline-block">⏳</span>`;
            botBtn.disabled = true;

            try {
                const [newSentence] = await api.generateAIExamples(wordData, wordData.meaning, 1);
                allSentences[index] = newSentence;
                const fullText = allSentences.join('\n');
                wordData.AISample = { en: fullText, ko: "" };
                await api.saveAISamplesToSheet(wordData, fullText);
                
                const section = container.parentNode; 
                this.appendAIGenButton(section.parentNode, wordData); 
            } catch (err) {
                console.error(err);
                botBtn.innerHTML = "⚠️";
                botBtn.disabled = false;
                window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "재생성 실패", isError: true } }));
            }
        };

        p.appendChild(botBtn);

        const showTranslation = async (event) => {
            state.activeTranslationTarget = p;
            const translatedText = await api.translate(sentenceText); 
            if (state.activeTranslationTarget !== p) return;
            ui.showTranslationTooltip(translatedText, event);
        };

        p.onclick = (e) => {
            if (e.target === botBtn || e.target.closest('button')) return; 
            if (e.target.closest('.interactive-word')) return;
            api.speak(sentenceText, 'sample');
            showTranslation(e);
        };

        p.addEventListener('mouseenter', (e) => {
             if (e.target === p) {
                clearTimeout(state.translationTimer);
                state.activeTranslationTarget = p;
                state.translationTimer = setTimeout(() => {
                    if (state.activeTranslationTarget === p) {
                        showTranslation(e);
                    }
                }, 1000);
             }
        });

        p.addEventListener('mouseleave', () => {
            clearTimeout(state.translationTimer);
            if (state.activeTranslationTarget === p) {
                state.activeTranslationTarget = null;
            }
            ui.hideTranslationTooltip();
        });

        const sentenceContent = document.createElement('span');
        sentenceContent.className = 'sentence-content-area'; 
        
        const sentenceParts = sentenceText.split(/(\*.*?\*)/g);
        sentenceParts.forEach(part => {
            if (part.startsWith('*') && part.endsWith('*')) {
                const strong = document.createElement('strong');
                strong.appendChild(ui.createInteractiveFragment(part.slice(1, -1), true));
                sentenceContent.appendChild(strong);
            } else if (part) {
                sentenceContent.appendChild(ui.createInteractiveFragment(part, true));
            }
        });

        p.appendChild(sentenceContent);
        container.appendChild(p);
    }
};
