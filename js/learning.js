import { config, state } from './config.js';
import { api } from './api.js';
import { utils } from './utils.js';
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

        // [삭제됨] createFormatTooltip 호출 제거 (ui.js에서 관리)
        
        this.bindEvents();
    },

    // [삭제됨] createFormatTooltip, hideFormatTooltip 등 UI 관련 함수 제거 (ui.js 사용)

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

        this.elements.wordHeader.addEventListener('contextmenu', (e) => {
            if (e.target.closest('#word-display')) {
                e.preventDefault();
                e.stopPropagation();
                const word = this.state.currentWordList[this.state.currentIndex]?.word;
                if (word) {
                    ui.showWordContextMenu(e, word);
                }
            } 
            else {
                preventCardMenu(e, 'front');
            }
        });
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
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#edit-context-menu')) ui.hideEditContextMenu();
            if (!e.target.closest('#card-context-menu')) ui.hideCardContextMenu();
            // 서식 툴팁 닫기 추가
            if (!e.target.closest('#format-tooltip') && !this.state.isEditing) ui.hideFormatTooltip();
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

        // [삭제됨] 여기서 selectionchange 이벤트를 잡지 않고, enableEditField 내부에서 처리함.
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
            e.target.closest('#learning-card-back')) { 
            return;
        }
        e.preventDefault();
        ui.showCardContextMenu(e);
    },

    // [수정] 편집 모드 진입 (enableEditField 활용)
    async enterEditMode(side) {
        this.state.isEditing = true;
        const wordData = this.state.currentWordList[this.state.currentIndex];

        if (side === 'front') {
            const currentPos = wordData.pos || "";
            const currentWord = wordData.word_html || wordData.word || "";
            
            // HTML 구조 생성
            this.elements.wordDisplay.innerHTML = `
                <div class="flex flex-col gap-2">
                    <div id="edit-word-input" class="w-full text-center p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold bg-white" placeholder="Word">${currentWord}</div>
                    <input type="text" id="edit-pos-input" class="w-1/2 self-center text-center p-1 border border-gray-300 rounded text-sm text-gray-500" value="${currentPos}" placeholder="POS (품사)">
                    <button id="auto-fill-btn" class="self-center text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 py-1 px-3 rounded-full transition-colors mb-2 font-semibold shadow-sm flex items-center gap-1">
                        🪄 AI 자동 완성
                    </button>
                </div>
            `;
            
            const currentMeaning = wordData.meaning_html || wordData.meaning || "";
            this.elements.meaningDisplay.innerHTML = `<div id="edit-meaning-input" class="w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" style="min-height:3rem;">${currentMeaning}</div>`;
            
            let currentExplanation = wordData.explanation || "";
            if (!currentExplanation.includes('<')) {
                currentExplanation = currentExplanation.replace(/\n/g, '<br>');
            }
            this.elements.explanationDisplay.innerHTML = `<div id="edit-explanation-input" class="w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" style="min-height:8rem;">${currentExplanation}</div>`;

            // [핵심 수정] 여기서 enableEditField를 호출하여 서식 기능 활성화
            this.enableEditField(document.getElementById('edit-word-input'));
            this.enableEditField(document.getElementById('edit-meaning-input'));
            this.enableEditField(document.getElementById('edit-explanation-input'));

            // AI 자동 완성 로직
            setTimeout(() => {
                const autoBtn = document.getElementById('auto-fill-btn');
                const wordDiv = document.getElementById('edit-word-input');
                const meaningDiv = document.getElementById('edit-meaning-input');
                const explanationDiv = document.getElementById('edit-explanation-input');

                if (autoBtn) {
                    autoBtn.onclick = async () => {
                        let targetWord = wordDiv.innerText.trim(); 
                        if (!targetWord) {
                            window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "단어를 먼저 입력하세요.", isError: true } }));
                            return;
                        }
                        autoBtn.disabled = true;
                        autoBtn.innerHTML = `<span class="animate-spin inline-block">⏳</span> 분석 중...`;
                        try {
                            const aiData = await api.fetchWordInfoFromAI(targetWord);
                            if (aiData.meaning) {
                                const original = meaningDiv.innerText.trim();
                                if (original && !original.includes(aiData.meaning)) {
                                    meaningDiv.innerHTML += "<br><br>" + aiData.meaning;
                                } else if(!original) {
                                    meaningDiv.innerHTML = aiData.meaning;
                                }
                            }
                            if (aiData.explanation) {
                                const original = explanationDiv.innerText.trim();
                                const formattedExpl = aiData.explanation.replace(/\n/g, "<br>");
                                if (original) {
                                    explanationDiv.innerHTML += "<br><br>" + formattedExpl;
                                } else {
                                    explanationDiv.innerHTML = formattedExpl;
                                }
                            }
                            if (aiData.samples && Array.isArray(aiData.samples) && aiData.samples.length > 0) {
                                const newSampleText = aiData.samples.join('\n');
                                const originalSample = wordData.sample || "";
                                if (originalSample.trim()) {
                                    wordData.sample = originalSample.trim() + "\n\n" + newSampleText;
                                } else {
                                    wordData.sample = newSampleText;
                                }
                                wordData.manualSample = wordData.sample;
                                window.dispatchEvent(new CustomEvent('showToast', { detail: { message: `정보가 추가되었습니다! (예문 ${aiData.samples.length}개 추가됨)` } }));
                            } else {
                                window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "뜻/설명 추가 완료 (예문 없음)" } }));
                            }
                        } catch (e) {
                            console.error(e);
                            window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "AI 요청 실패", isError: true } }));
                        } finally {
                            autoBtn.disabled = false;
                            autoBtn.innerHTML = `🪄 AI 자동 완성`;
                        }
                    };
                }
            }, 0);

        } else {
            // 뒷면 편집 모드 (예문)
            let currentSample = wordData.sample || "";
            // 뒷면은 textarea 유지 (요청사항이 앞면 서식 변경이었으므로)
            this.elements.backContent.innerHTML = `<textarea id="edit-sample-input" class="w-full h-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" rows="10" placeholder="예문">${currentSample}</textarea>`;
             const aiSection = this.elements.backContent.parentNode.querySelector('.ai-gen-section');
             if(aiSection) aiSection.style.display = 'none';
        }

        const editImgUrl = 'images/cat-edit.png';
        this.elements.sampleBtnImg.src = editImgUrl;
    },

    // [수정] 편집 내용 저장 및 서식 데이터 처리
    async saveAndExitEditMode() {
        const wordData = this.state.currentWordList[this.state.currentIndex];
        const side = this.state.editingSide;
        let updateData = {}; 

        if (side === 'front') {
            const wordDiv = document.getElementById('edit-word-input');
            const posInput = document.getElementById('edit-pos-input');
            const meaningDiv = document.getElementById('edit-meaning-input');
            const explanationDiv = document.getElementById('edit-explanation-input');
            
            if (wordDiv && meaningDiv && explanationDiv) {
                // HTML과 Plain Text 모두 확보
                const newWordHtml = wordDiv.innerHTML;
                const newWordText = wordDiv.innerText.trim();
                const newPos = posInput ? posInput.value.trim() : "";
                const newMeaningHtml = meaningDiv.innerHTML;
                const newMeaningText = meaningDiv.innerText.trim();
                
                // 설명은 텍스트 저장, 필요시 HTML도 저장 가능
                const newExplanation = explanationDiv.innerText.trim(); 
                
                const newSample = wordData.sample || "";

                if (!newWordText) {
                      window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "표제어를 입력해주세요.", isError: true } }));
                      return;
                }

                if (newWordText !== wordData.word) {
                    const isDuplicate = state.wordList.some(w => w.word.toLowerCase() === newWordText.toLowerCase() && w !== wordData);
                    if (isDuplicate) {
                        window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "이미 존재하는 단어입니다.", isError: true } }));
                        return; 
                    }
                }

                const changes = {
                    word: newWordText,
                    word_html: newWordHtml, // HTML 저장
                    pos: newPos,
                    meaning: newMeaningText,
                    meaning_html: newMeaningHtml, // HTML 저장
                    explanation: newExplanation, 
                    manual_sample: newSample
                };

                if (wordData.isNew) {
                    await api.createWord(changes, this.state.currentIndex > 0 ? this.state.currentWordList[this.state.currentIndex - 1].word : null);
                    
                    Object.assign(wordData, changes);
                    wordData.sample = newSample;
                    delete wordData.isNew;
                    
                    window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "새 카드가 저장되었습니다." } }));

                } else {
                    await api.updateWordDetails(wordData.word, changes);

                    if (config.SCRIPT_URL) {
                        const scriptUrl = new URL(config.SCRIPT_URL);
                        scriptUrl.searchParams.append('action', 'update_word_data');
                        const originalWord = wordData.word; 
                        
                        // Apps Script로 보낼 데이터 (HTML 포함)
                        const payload = {
                            originalWord: originalWord,
                            word: newWordText,
                            word_html: newWordHtml,
                            pos: newPos,
                            meaning: newMeaningText,
                            meaning_html: newMeaningHtml,
                            explanation: newExplanation,
                            manualsample: newSample
                        };
                        
                        scriptUrl.searchParams.append('data', JSON.stringify(payload));
                        fetch(scriptUrl.toString(), { method: 'POST' }).catch(e => console.error("Sheet update failed", e));
                    }
                    
                    Object.assign(wordData, changes);
                    wordData.sample = newSample;
                }
            }
        } else { 
            // 뒷면 저장
            const sampleInput = document.getElementById('edit-sample-input');
            if (sampleInput) {
                const newSampleText = sampleInput.value;
                if (wordData.isNew) {
                      if (!wordData.word) {
                          window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "앞면의 표제어를 먼저 입력해주세요.", isError: true } }));
                          return;
                      }
                      wordData.sample = newSampleText;
                } else {
                    await api.updateWordDetails(wordData.word, { manual_sample: newSampleText });
                    wordData.sample = newSampleText;
                }
            }
             const aiSection = this.elements.backContent.parentNode.querySelector('.ai-gen-section');
             if(aiSection) aiSection.style.display = 'block';
        }

        this.state.isEditing = false;
        this.state.editingSide = null;
        ui.hideFormatTooltip(); // 툴팁 숨기기
        
        if (side === 'front') {
            this.displayWord(this.state.currentIndex, true);
        } else {
            this.navigateBackToBack(0); 
        }
    },
    
    async createNewCard() {
        const tempCard = {
            word: "", 
            pos: "",
            meaning: "",
            explanation: "",
            sample: "",
            isNew: true 
        };
        
        const insertIndex = this.state.currentIndex + 1;
        this.state.currentWordList.splice(insertIndex, 0, tempCard);
        
        this.state.currentIndex = insertIndex;
        this.displayWord(this.state.currentIndex, true);
        
        setTimeout(() => {
            this.state.editingSide = 'front';
            this.enterEditMode('front');
        }, 100);
    },
    
    async deleteCurrentCard() {
        const wordData = this.state.currentWordList[this.state.currentIndex];
        if (!wordData) return;
        
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

        await api.deleteWord(wordData.word);
        
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
        
        const exactMatches = [];
        const startsWithMatches = [];
        const includesMatches = [];
        const fuzzyMatches = [];
        
        const searchRegex = new RegExp(`\\b${lowerCaseStartWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        const explanationMatches = [];

        for (let index = 0; index < this.state.currentWordList.length; index++) {
            const item = this.state.currentWordList[index];
            const wordLower = item.word.toLowerCase();
            const wordObj = { word: item.word, index, distance: 0 };
            
            if (wordLower === lowerCaseStartWord) {
                exactMatches.push(wordObj);
            } else if (wordLower.startsWith(lowerCaseStartWord)) {
                startsWithMatches.push(wordObj);
            } else if (wordLower.includes(lowerCaseStartWord)) {
                includesMatches.push(wordObj);
            } else {
                const lenDiff = Math.abs(wordLower.length - lowerCaseStartWord.length);
                if (lenDiff <= 2) {
                    const dist = utils.levenshteinDistance(lowerCaseStartWord, wordLower, 2);
                    if (dist <= 2 && dist < Math.max(wordLower.length, lowerCaseStartWord.length) * 0.4) {
                        wordObj.distance = dist;
                        fuzzyMatches.push(wordObj);
                    }
                }
            }

            if (item.explanation) {
                const cleanedExplanation = item.explanation.replace(/\[.*?\]|\*/g, '');
                if (searchRegex.test(cleanedExplanation)) {
                    explanationMatches.push({ word: item.word, index });
                }
            }
        }

        fuzzyMatches.sort((a, b) => a.distance - b.distance);

        const vocabSuggestions = [
            ...exactMatches,
            ...startsWithMatches,
            ...includesMatches,
            ...fuzzyMatches
        ].slice(0, 50);

        let title = `<strong>'${startWord}'</strong> 검색 결과`;
        if (vocabSuggestions.length === 0 && explanationMatches.length === 0) {
            title = `<strong>'${startWord}'</strong>에 대한 검색 결과가 없습니다.`;
        }

        this.displaySuggestions(vocabSuggestions, explanationMatches, title);
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

    // [수정] 단어 표시 (HTML 서식 지원)
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

        // Word (HTML or Text) - ui.createInteractiveFragment 사용
        this.elements.wordDisplay.innerHTML = '';
        // 저장된 HTML이 있으면 그것을, 없으면 일반 텍스트를 사용
        const wordContent = wordData.word_html || wordData.word;
        this.elements.wordDisplay.appendChild(ui.createInteractiveFragment(wordContent));

        this.adjustWordFontSize();
        
        if (wordData.word && !silent) { api.speak(wordData.word, 'word'); }
        
        // Meaning (HTML or Text)
        this.elements.meaningDisplay.innerHTML = '';
        const meaningContent = wordData.meaning_html || wordData.meaning.replace(/\n/g, '<br>');
        this.elements.meaningDisplay.appendChild(ui.createInteractiveFragment(meaningContent));
        
        // Explanation
        ui.renderExplanationText(this.elements.explanationDisplay, wordData.explanation);
        this.elements.explanationContainer.classList.remove('hidden');

        const hasSample = wordData.sample && wordData.sample.trim() !== '';
        const sampleImgUrl = 'images/cat-delivery.png';
        const noSampleImgUrl = 'images/cat-add.png';
        this.elements.sampleBtnImg.src = hasSample ? sampleImgUrl : noSampleImgUrl;

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
        
        this.elements.backContent.innerHTML = '';
        if (wordData.sample && wordData.sample.trim()) {
            ui.displaySentences(wordData.sample.split('\n'), this.elements.backContent);
        } else if ((!wordData.sample || !wordData.sample.trim()) && (!wordData.AISample || !wordData.AISample.en)) {
            this.elements.backContent.innerHTML = '<div class="flex h-full items-center justify-center text-gray-400">작성된 예문이 없습니다.<br>우클릭하여 편집하세요.</div>';
        }

        this.appendAIGenButton(this.elements.backContent, wordData);
        const backImgUrl = 'images/cat-remove.png';
        this.elements.sampleBtnImg.src = backImgUrl;
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
            this.elements.backTitle.textContent = wordData.word;
            
            this.elements.backContent.innerHTML = '';
            if (wordData.sample && wordData.sample.trim()) {
                 ui.displaySentences(wordData.sample.split('\n'), this.elements.backContent);
            } else if ((!wordData.sample || !wordData.sample.trim()) && (!wordData.AISample || !wordData.AISample.en)) {
                 this.elements.backContent.innerHTML = '<div class="flex h-full items-center justify-center text-gray-400">작성된 예문이 없습니다.<br>우클릭하여 편집하세요.</div>';
            }
            
            this.appendAIGenButton(this.elements.backContent, wordData);
            this.elements.cardBack.classList.add('is-slid-up');
            this.elements.sampleBtnImg.src = backImgUrl;
        } else {
            this.elements.cardBack.classList.remove('is-slid-up');
            const hasSample = (wordData.sample && wordData.sample.trim() !== '') || (wordData.AISample && wordData.AISample.en);
            this.elements.sampleBtnImg.src = hasSample ? sampleImgUrl : noSampleImgUrl;
        }
    },
    startMistakeReview(mistakeWords) {
        this.state.isMistakeMode = true;
        this.state.isFavoriteMode = false;
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
        if (document.activeElement.tagName.match(/INPUT|TEXTAREA/) || document.activeElement.contentEditable === "true") return;
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
            ui.showTranslationTooltip("Translating...", event);
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
    },

    // [신규] 편집 필드 활성화 및 서식/툴팁 기능 연결
    enableEditField(element) {
        element.contentEditable = true;
        state.activeEditingElement = element;

        // 1. 단축키 (Ctrl+B / Ctrl+I)
        element.onkeydown = (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'b' || e.key === 'B') {
                    e.preventDefault();
                    document.execCommand('bold');
                } else if (e.key === 'i' || e.key === 'I') {
                    e.preventDefault();
                    document.execCommand('italic');
                }
            }
        };

        // 2. 텍스트 선택 감지 (툴팁 표시)
        const handleSelection = () => {
            const selection = window.getSelection();
            if (!selection.rangeCount || selection.isCollapsed || !element.contains(selection.anchorNode)) {
                ui.hideFormatTooltip(); // ui.js의 함수 호출
                return;
            }

            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            
            // 툴팁 표시
            ui.showFormatTooltip(rect.left + rect.width / 2, rect.top);
        };

        element.onmouseup = handleSelection;
        element.onkeyup = (e) => {
            if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
                handleSelection();
            }
        };
        
        element.onblur = () => {
             setTimeout(() => {
             }, 200);
        };
    },
};
