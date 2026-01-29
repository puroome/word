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
        editingSide: null, // 'front' or 'back'
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
            learningModeContainer: document.getElementById('learning-mode-container'), // Container ref added
            appContainer: document.getElementById('learning-app-container'),
            cardFront: document.getElementById('learning-card-front'), // Front ref
            cardBack: document.getElementById('learning-card-back'),
            wordHeader: document.getElementById('word-header'), // Word header ref
            wordDisplay: document.getElementById('word-display'),
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
            createCardBtn: document.getElementById('create-card-btn'), // New
            deleteCardBtn: document.getElementById('delete-card-btn'), // New
            deleteConfirmModal: document.getElementById('delete-confirm-modal'), // New
            deleteConfirmBtn: document.getElementById('delete-confirm-btn'), // New
            deleteCancelBtn: document.getElementById('delete-cancel-btn'), // New
        };
        this.bindEvents();
    },
    bindEvents() {
        this.elements.startBtn.addEventListener('click', () => this.start());
        this.elements.startWordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.start(); }
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
            if (word && !this.state.isEditing) { api.speak(word, 'word'); }
        });
        
        // Context Menus
        // 1. Word Header Context Menu (Edit Word)
        this.elements.wordHeader.addEventListener('contextmenu', (e) => this.handleEditContextMenu(e, 'front'));
        this.elements.meaningContainer.addEventListener('contextmenu', (e) => this.handleEditContextMenu(e, 'front'));
        this.elements.explanationContainer.addEventListener('contextmenu', (e) => this.handleEditContextMenu(e, 'front'));

        // 2. Sample Card Context Menu (Edit Sample)
        this.elements.cardBack.addEventListener('contextmenu', (e) => {
            // Prevent if clicking on AI gen button or similar
            if(e.target.closest('button')) return; 
            this.handleEditContextMenu(e, 'back');
        });

        // 3. Gap Context Menu (Create/Delete Card)
        this.elements.learningModeContainer.addEventListener('contextmenu', (e) => this.handleCardContextMenu(e));

        // Edit Button Click
        this.elements.editContextBtn.addEventListener('click', () => {
            this.enterEditMode(this.state.editingSide); // Pass side
            ui.hideEditContextMenu();
        });

        // Create/Delete Button Clicks
        this.elements.createCardBtn.addEventListener('click', () => {
             this.createNewCard();
             ui.hideCardContextMenu();
        });
        this.elements.deleteCardBtn.addEventListener('click', () => {
             ui.showDeleteConfirmModal();
             ui.hideCardContextMenu();
        });

        // Delete Confirm Modal
        this.elements.deleteConfirmBtn.addEventListener('click', () => {
            this.deleteCurrentCard();
            ui.hideDeleteConfirmModal();
        });
        this.elements.deleteCancelBtn.addEventListener('click', () => {
            ui.hideDeleteConfirmModal();
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#edit-context-menu')) ui.hideEditContextMenu();
            if (!e.target.closest('#card-context-menu')) ui.hideCardContextMenu();
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
        if (e.target.classList.contains('interactive-word')) return;
        // Stop propagation to prevent card flip or gap menu
        e.preventDefault();
        e.stopPropagation(); 
        
        this.state.editingSide = side; // Store which side requested edit
        ui.showEditContextMenu(e);
    },

    handleCardContextMenu(e) {
        if (this.state.isEditing) return;
        // Check if click is NOT on the card front or back
        if (e.target.closest('#learning-card-front') || e.target.closest('#learning-card-back') || e.target.closest('#learning-fixed-buttons')) {
            return;
        }
        e.preventDefault();
        ui.showCardContextMenu(e);
    },

    async enterEditMode(side) {
        this.state.isEditing = true;
        const wordData = this.state.currentWordList[this.state.currentIndex];

        if (side === 'front') {
            // Edit Word (Headword + POS), Meaning, Explanation
            const currentPos = wordData.pos || "";
            const currentWord = wordData.word;
            // Display Format: Word [POS]
            const wordInputValue = currentPos ? `${currentWord} [${currentPos}]` : currentWord;
            
            this.elements.wordDisplay.innerHTML = `<input type="text" id="edit-word-input" class="w-full text-center p-1 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold" value="${wordInputValue}">`;

            const currentMeaning = wordData.meaning || "";
            this.elements.meaningDisplay.innerHTML = `<textarea id="edit-meaning-input" class="w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" rows="3">${currentMeaning}</textarea>`;

            const currentExplanation = wordData.explanation || "";
            this.elements.explanationDisplay.innerHTML = `<textarea id="edit-explanation-input" class="w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" rows="5">${currentExplanation}</textarea>`;

        } else {
            // Edit Sample
            // Determine source: 'manual' or 'ai'. If none, default empty.
            let currentSample = "";
            if (wordData.sampleSource === 'manual') currentSample = wordData.sample;
            else if (wordData.sampleSource === 'ai' && wordData.AISample) currentSample = wordData.AISample.en;
            else if (wordData.sample) currentSample = wordData.sample; // fallback

            // We only edit the text content here. 
            // Note: If user edits AI sample, it becomes 'ai' source update or 'manual'? 
            // Requirement says update respective column. 
            this.elements.backContent.innerHTML = `<textarea id="edit-sample-input" class="w-full h-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" rows="10">${currentSample || ""}</textarea>`;
            // Remove AI buttons temporarily
             const aiSection = this.elements.backContent.parentNode.querySelector('.ai-gen-section');
             if(aiSection) aiSection.style.display = 'none';
        }

        const editImgUrl = 'images/cat-edit.png';
        this.elements.sampleBtnImg.src = await imageDBCache.loadImage(editImgUrl);
    },

    async saveAndExitEditMode() {
        const wordData = this.state.currentWordList[this.state.currentIndex];
        const side = this.state.editingSide;

        if (side === 'front') {
            const wordInput = document.getElementById('edit-word-input');
            const meaningInput = document.getElementById('edit-meaning-input');
            const explanationInput = document.getElementById('edit-explanation-input');
            
            if (wordInput && meaningInput && explanationInput) {
                const rawWordValue = wordInput.value.trim();
                const newMeaning = meaningInput.value;
                const newExplanation = explanationInput.value;

                // Parse Word [POS]
                // Regex: Start, Capture Word, Optional (Space [POS]), End
                const match = rawWordValue.match(/^(.*?)\s*\[(.*?)\]$/);
                let newWord = rawWordValue;
                let newPos = undefined; // Undefined means "don't update if not provided" - BUT requirements say handle differently

                if (match) {
                    newWord = match[1].trim();
                    newPos = match[2].trim();
                } else {
                    // No brackets provided. 
                    // If creating new word (wordData is placeholder), POS stays empty.
                    // If editing, POS is preserved (passed as undefined to backend, but logic below needs care)
                    // Requirement: "표제어만 수정할경우 만약 []을 안쓰면 기존의 POS열값은 수정하지말고"
                    newPos = undefined; 
                }

                // Check Duplicates (if word changed)
                if (newWord !== wordData.word) {
                    const isDuplicate = state.wordList.some(w => w.word.toLowerCase() === newWord.toLowerCase() && w !== wordData);
                    if (isDuplicate) {
                        window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "이미 존재하는 단어입니다.", isError: true } }));
                        // Cancel save? Or just revert word?
                        // Reverting word for now
                        newWord = wordData.word; 
                    }
                }

                await api.updateWordDetails(wordData.word, {
                    word: newWord,
                    pos: newPos,
                    meaning: newMeaning,
                    explanation: newExplanation
                });
            }
        } else { // side === 'back'
            const sampleInput = document.getElementById('edit-sample-input');
            if (sampleInput) {
                const newSampleText = sampleInput.value;
                // Update based on source
                if (wordData.sampleSource === 'ai') {
                    await api.updateWordDetails(wordData.word, { aiSample: newSampleText });
                } else {
                    await api.updateWordDetails(wordData.word, { sample: newSampleText });
                }
            }
            // Restore AI section
             const aiSection = this.elements.backContent.parentNode.querySelector('.ai-gen-section');
             if(aiSection) aiSection.style.display = 'block';
        }

        this.state.isEditing = false;
        this.state.editingSide = null;
        
        // Refresh display (handles updated data because updateWordDetails updates local state)
        if (side === 'front') this.displayWord(this.state.currentIndex, true);
        else this.navigateBackToBack(0); // Refresh back
    },
    
    async createNewCard() {
        // Create an empty placeholder card
        const newCard = {
            word: "New Word",
            pos: "",
            meaning: "",
            explanation: "",
            sample: "",
            sampleSource: "manual"
        };
        
        // Add to list via API (create empty row)
        await api.createWord(newCard);
        
        // Move to the new card (last one)
        this.state.currentIndex = state.wordList.length - 1;
        this.displayWord(this.state.currentIndex, true);
        
        // Immediately enter edit mode
        setTimeout(() => {
            this.state.editingSide = 'front';
            this.enterEditMode('front');
        }, 300);
    },
    
    async deleteCurrentCard() {
        const wordData = this.state.currentWordList[this.state.currentIndex];
        if (!wordData) return;
        
        await api.deleteWord(wordData.word);
        
        // Update UI
        // Index handling
        if (this.state.currentIndex >= this.state.currentWordList.length) {
            this.state.currentIndex = Math.max(0, this.state.currentWordList.length - 1);
        }
        
        if (this.state.currentWordList.length === 0) {
            this.reset();
            window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "모든 카드가 삭제되었습니다." } }));
        } else {
             this.displayWord(this.state.currentIndex, true);
             window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "카드가 삭제되었습니다." } }));
        }
    },

    // ... (rest of functions: start, showError, launchApp, reset, resetStartScreen, displaySuggestions, displayWord, adjustWordFontSize, navigate, navigateBackToBack, handleFlip, startMistakeReview, startFavoriteMode, handleKeyDown, handleTouchStart, handleTouchEnd, updateProgressBar, handleProgressBarInteraction, toggleFavorite, updateFavoriteIcon, appendAIGenButton, renderInitialGenButton, renderAIContentRow - KEEP ALL AS IS) ...
    // Note: handleFlip needs modification to save edit mode
    
    // [Modified handleFlip from original to support save]
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
            // Allow flipping even if no sample, so user can edit empty back
            this.elements.backTitle.textContent = wordData.word;
            
            if (!wordData.sample && (!wordData.AISample || !wordData.AISample.en)) {
                 this.elements.backContent.innerHTML = '<div class="flex h-full items-center justify-center text-gray-400">작성된 예문이 없습니다.<br>우클릭하여 편집하세요.</div>';
            } else {
                 ui.displaySentences((wordData.sample || wordData.AISample?.en || "").split('\n'), this.elements.backContent);
            }

            this.appendAIGenButton(this.elements.backContent, wordData);

            this.elements.cardBack.classList.add('is-slid-up');
            this.elements.sampleBtnImg.src = await imageDBCache.loadImage(backImgUrl);
        } else {
            this.elements.cardBack.classList.remove('is-slid-up');
            const hasSample = (wordData.sample && wordData.sample.trim() !== '') || (wordData.AISample && wordData.AISample.en);
            this.elements.sampleBtnImg.src = await imageDBCache.loadImage(hasSample ? sampleImgUrl : noSampleImgUrl);
        }
    },
    
    // ... [Copy the rest of the functions from previous learning.js exactly] ...
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
    async displayWord(index, silent = false) {
        this.state.isEditing = false;
        
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
        
        if (wordData.word && !silent) {
            api.speak(wordData.word, 'word');
        }
        
        this.elements.meaningDisplay.innerHTML = wordData.meaning.replace(/\n/g, '<br>');
        ui.renderExplanationText(this.elements.explanationDisplay, wordData.explanation);
        this.elements.explanationContainer.classList.remove('hidden');

        const hasSample = (wordData.sample && wordData.sample.trim() !== '') || (wordData.AISample && wordData.AISample.en);
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
        } else if (wordData.AISample && wordData.AISample.en) {
             ui.displaySentences(wordData.AISample.en.split('\n'), this.elements.backContent);
        } else {
            this.elements.backContent.innerHTML = '<div class="flex h-full items-center justify-center text-gray-400">작성된 예문이 없습니다.<br>우클릭하여 편집하세요.</div>';
        }

        this.appendAIGenButton(this.elements.backContent, wordData);

        const backImgUrl = 'images/cat-remove.png';
        this.elements.sampleBtnImg.src = await imageDBCache.loadImage(backImgUrl);
    },
    startMistakeReview(mistakeWords) {
        this.state.isMistakeMode = true;
        this.state.isFavoriteMode = false;
        if (!state.isWordListReady) {
            // Wait for main loading
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
