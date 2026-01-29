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
        editingSide: null, 
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
            learningModeContainer: document.getElementById('learning-mode-container'),
            appContainer: document.getElementById('learning-app-container'),
            cardFront: document.getElementById('learning-card-front'),
            cardBack: document.getElementById('learning-card-back'),
            wordHeader: document.getElementById('word-header'),
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
            createCardBtn: document.getElementById('create-card-btn'),
            deleteCardBtn: document.getElementById('delete-card-btn'),
            deleteConfirmModal: document.getElementById('delete-confirm-modal'),
            deleteConfirmBtn: document.getElementById('delete-confirm-btn'),
            deleteCancelBtn: document.getElementById('delete-cancel-btn'),
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
        
        const preventCardMenu = (e, side) => {
            this.handleEditContextMenu(e, side); 
            e.stopPropagation(); 
        };

        this.elements.wordHeader.addEventListener('contextmenu', (e) => preventCardMenu(e, 'front'));
        this.elements.meaningContainer.addEventListener('contextmenu', (e) => preventCardMenu(e, 'front'));
        this.elements.explanationContainer.addEventListener('contextmenu', (e) => preventCardMenu(e, 'front'));

        this.elements.cardBack.addEventListener('contextmenu', (e) => {
            if(e.target.closest('button')) return; 
            preventCardMenu(e, 'back');
        });

        this.elements.learningModeContainer.addEventListener('contextmenu', (e) => this.handleCardContextMenu(e));

        this.elements.editContextBtn.addEventListener('click', () => {
            this.enterEditMode(this.state.editingSide);
            ui.hideEditContextMenu();
        });

        if (this.elements.createCardBtn) {
            this.elements.createCardBtn.addEventListener('click', () => {
                this.createNewCard();
                ui.hideCardContextMenu();
            });
        }
        if (this.elements.deleteCardBtn) {
            this.elements.deleteCardBtn.addEventListener('click', () => {
                ui.showDeleteConfirmModal();
                ui.hideCardContextMenu();
            });
        }

        if (this.elements.deleteConfirmBtn) {
            this.elements.deleteConfirmBtn.addEventListener('click', () => {
                this.deleteCurrentCard();
                ui.hideDeleteConfirmModal();
            });
        }
        if (this.elements.deleteCancelBtn) {
            this.elements.deleteCancelBtn.addEventListener('click', () => {
                ui.hideDeleteConfirmModal();
            });
        }

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
        e.preventDefault();
        this.state.editingSide = side; 
        ui.showEditContextMenu(e);
    },

    handleCardContextMenu(e) {
        if (this.state.isEditing) return;
        if (!this.elements.startScreen.classList.contains('hidden')) return;
        if (e.target.closest('#word-header') || 
            e.target.closest('#meaning-container') || 
            e.target.closest('#explanation-container') || 
            e.target.closest('#learning-card-back') || 
            e.target.closest('#learning-fixed-buttons')) {
            return;
        }
        e.preventDefault();
        ui.showCardContextMenu(e);
    },

    async enterEditMode(side) {
        this.state.isEditing = true;
        const wordData = this.state.currentWordList[this.state.currentIndex];

        if (side === 'front') {
            const currentPos = wordData.pos || "";
            const currentWord = wordData.word || ""; // 빈 문자열 처리
            const wordInputValue = currentPos ? `${currentWord} [${currentPos}]` : currentWord;
            
            this.elements.wordDisplay.innerHTML = `<input type="text" id="edit-word-input" class="w-full text-center p-1 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold" value="${wordInputValue}" placeholder="Word [POS]">`;
            const currentMeaning = wordData.meaning || "";
            this.elements.meaningDisplay.innerHTML = `<textarea id="edit-meaning-input" class="w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" rows="3" placeholder="뜻">${currentMeaning}</textarea>`;
            const currentExplanation = wordData.explanation || "";
            this.elements.explanationDisplay.innerHTML = `<textarea id="edit-explanation-input" class="w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" rows="5" placeholder="설명">${currentExplanation}</textarea>`;

        } else {
            let currentSample = "";
            if (wordData.sampleSource === 'manual') currentSample = wordData.sample;
            else if (wordData.sampleSource === 'ai' && wordData.AISample) currentSample = wordData.AISample.en;
            else if (wordData.sample) currentSample = wordData.sample; 

            this.elements.backContent.innerHTML = `<textarea id="edit-sample-input" class="w-full h-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" rows="10" placeholder="예문">${currentSample || ""}</textarea>`;
             const aiSection = this.elements.backContent.parentNode.querySelector('.ai-gen-section');
             if(aiSection) aiSection.style.display = 'none';
        }

        const editImgUrl = 'images/cat-edit.png';
        this.elements.sampleBtnImg.src = await imageDBCache.loadImage(editImgUrl);
    },

    // [핵심 수정] 저장 로직 분기 (신규 vs 수정)
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

                const match = rawWordValue.match(/^(.*?)\s*\[(.*?)\]$/);
                let newWord = rawWordValue;
                let newPos = undefined; 

                if (match) {
                    newWord = match[1].trim();
                    newPos = match[2].trim();
                } else {
                    // 신규 생성일 경우 POS 기본값은 빈값
                    if (wordData.isNew) newPos = ""; 
                    else newPos = undefined; 
                }
                
                // 표제어 필수 확인
                if (!newWord) {
                     window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "표제어를 입력해주세요.", isError: true } }));
                     return;
                }

                // 중복 체크 (본인 제외)
                if (newWord !== wordData.word) {
                    const isDuplicate = state.wordList.some(w => w.word.toLowerCase() === newWord.toLowerCase() && w !== wordData);
                    if (isDuplicate) {
                        window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "이미 존재하는 단어입니다.", isError: true } }));
                        return; // 저장 중단
                    }
                }

                // [분기점] 신규 카드 저장 vs 기존 카드 수정
                if (wordData.isNew) {
                    // 1. 신규 카드 데이터 구성
                    const newCardData = {
                        word: newWord,
                        pos: newPos || "",
                        meaning: newMeaning,
                        explanation: newExplanation
                    };
                    
                    // 2. 위치 찾기: 현재 카드의 '앞' 카드 단어를 찾음 (삽입 기준점)
                    // 현재 wordData는 이미 리스트에 splice로 들어가 있으므로, currentIndex - 1 이 바로 앞 카드
                    let afterWord = null;
                    if (this.state.currentIndex > 0) {
                        afterWord = this.state.currentWordList[this.state.currentIndex - 1].word;
                    }

                    // 3. 서버 저장 요청 (afterWord 전달)
                    await api.createWord(newCardData, afterWord);
                    
                    // 4. 로컬 상태 확정 (플래그 제거)
                    wordData.word = newWord;
                    wordData.pos = newPos || "";
                    wordData.meaning = newMeaning;
                    wordData.explanation = newExplanation;
                    delete wordData.isNew;
                    
                    window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "새 카드가 저장되었습니다." } }));

                } else {
                    // 기존 수정 로직
                    await api.updateWordDetails(wordData.word, {
                        word: newWord,
                        pos: newPos,
                        meaning: newMeaning,
                        explanation: newExplanation
                    });
                }
            }
        } else { 
            // 뒷면(예문) 저장
            const sampleInput = document.getElementById('edit-sample-input');
            if (sampleInput) {
                const newSampleText = sampleInput.value;
                
                // 신규 카드인데 뒷면부터 저장하려는 경우 방지 혹은 처리
                if (wordData.isNew) {
                     // 뒷면만 먼저 저장해도 로컬 객체엔 반영, 실제 저장은 앞면 저장시? 
                     // 정책: 앞면(표제어)이 있어야 저장이 가능하므로, 표제어가 없으면 경고
                     if (!wordData.word) {
                         window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "앞면의 표제어를 먼저 입력해주세요.", isError: true } }));
                         return;
                     }
                     // 이미 표제어가 있다면 createWord 호출해야 함 (복잡해짐).
                     // 간단히: 신규 카드는 앞면 편집을 강제하므로 이쪽으로 올 일은 거의 없음.
                     wordData.sample = newSampleText;
                     wordData.sampleSource = 'manual';
                } else {
                    if (wordData.sampleSource === 'ai') {
                        await api.updateWordDetails(wordData.word, { aiSample: newSampleText });
                    } else {
                        await api.updateWordDetails(wordData.word, { sample: newSampleText });
                    }
                }
            }
             const aiSection = this.elements.backContent.parentNode.querySelector('.ai-gen-section');
             if(aiSection) aiSection.style.display = 'block';
        }

        this.state.isEditing = false;
        this.state.editingSide = null;
        
        if (side === 'front') this.displayWord(this.state.currentIndex, true);
        else this.navigateBackToBack(0); 
    },
    
    // [핵심 수정] 새 카드 생성 (화면상에만 임시 추가)
    async createNewCard() {
        // 1. 임시 빈 카드 객체 생성
        const tempCard = {
            word: "", // 아직 비어있음
            pos: "",
            meaning: "",
            explanation: "",
            sample: "",
            sampleSource: "manual",
            isNew: true // [중요] 저장 전임을 표시
        };
        
        // 2. 현재 위치 바로 다음(currentIndex + 1)에 삽입
        const insertIndex = this.state.currentIndex + 1;
        this.state.currentWordList.splice(insertIndex, 0, tempCard);
        
        // 3. 인덱스 이동 및 화면 갱신
        this.state.currentIndex = insertIndex;
        this.displayWord(this.state.currentIndex, true);
        
        // 4. 즉시 편집 모드 진입
        setTimeout(() => {
            this.state.editingSide = 'front';
            this.enterEditMode('front');
        }, 100);
    },
    
    async deleteCurrentCard() {
        const wordData = this.state.currentWordList[this.state.currentIndex];
        if (!wordData) return;
        
        // [수정] 작성 중인(저장 안 된) 카드라면 서버 요청 없이 로컬에서만 삭제
        if (wordData.isNew) {
            this.state.currentWordList.splice(this.state.currentIndex, 1);
            if (this.state.currentIndex >= this.state.currentWordList.length) {
                this.state.currentIndex = Math.max(0, this.state.currentWordList.length - 1);
            }
             if (this.state.currentWordList.length === 0) {
                this.reset();
            } else {
                 this.displayWord(this.state.currentIndex, true);
            }
            return;
        }

        // 기존 카드라면 서버 삭제 요청
        await api.deleteWord(wordData.word);
        
        // UI 처리 (이전 로직 유지)
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
    // ... 나머지 함수들 (showError, launchApp, reset, resetStartScreen, displaySuggestions, displayWord, adjustWordFontSize, navigate, navigateBackToBack, handleFlip, startMistakeReview, startFavoriteMode, handleKeyDown, handleTouchStart, handleTouchEnd, updateProgressBar, handleProgressBarInteraction, toggleFavorite, updateFavoriteIcon, appendAIGenButton, renderInitialGenButton, renderAIContentRow) ...
    // 기존 코드 그대로 유지
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
        if (!wordData) { console.error(`Word data not found for index: ${index}`); return; }

         if (!this.state.isMistakeMode && !this.state.isFavoriteMode) {
            try { localStorage.setItem(state.LOCAL_STORAGE_KEYS.LAST_INDEX, index); } catch (e) { console.error(e); }
        }

        this.elements.wordDisplay.textContent = wordData.word;
        this.adjustWordFontSize();
        
        if (wordData.word && !silent) { api.speak(wordData.word, 'word'); }
        
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
        } else { navigateAction(); }
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
    async handleFlip() {
        if (this.state.isEditing) { await this.saveAndExitEditMode(); return; }
        const isBackVisible = this.elements.cardBack.classList.contains('is-slid-up');
        const wordData = this.state.currentWordList[this.state.currentIndex];
        if (!wordData) return;
        const backImgUrl = 'images/cat-remove.png';
        const sampleImgUrl = 'images/cat-delivery.png';
        const noSampleImgUrl = 'images/cat-add.png';
        if (!isBackVisible) {
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
    startMistakeReview(mistakeWords) {
        this.state.isMistakeMode = true;
        this.state.isFavoriteMode = false;
        if (!state.isWordListReady) {}
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
        if (!state.isWordListReady) { await api.loadWordList(); await api.loadUserProgress(); }
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
        else if (e.key === ' ') {
            e.preventDefault();
            const word = this.state.currentWordList[this.state.currentIndex]?.word;
            if (word) { api.speak(word, 'word'); }
        } else if (e.key.toLowerCase() === 'z') { e.preventDefault(); this.navigateBackToBack(-1); }
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
        } else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > swipeThreshold) {
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
