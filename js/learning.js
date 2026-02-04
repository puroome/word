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

        // [수정] 표제어 영역 우클릭 시 동작 분기
        this.elements.wordHeader.addEventListener('contextmenu', (e) => {
            // 1. 글자(word-display) 위에서 클릭했으면 -> 사전 팝업 (Explanation과 동일하게)
            if (e.target.closest('#word-display')) {
                e.preventDefault();
                e.stopPropagation();
                const word = this.state.currentWordList[this.state.currentIndex]?.word;
                if (word) {
                    ui.showWordContextMenu(e, word);
                }
            } 
            // 2. 글자 밖의 빈 헤더 공간을 클릭했으면 -> 편집 메뉴 (기존 기능 유지)
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
            e.target.closest('#learning-card-back')) { 
            return;
        }
        e.preventDefault();
        ui.showCardContextMenu(e);
    },

// [신규] 플로팅 툴바 생성 (최초 1회만 실행됨)
    initFloatingToolbar() {
        if (document.getElementById('floating-toolbar')) return;

        const toolbar = document.createElement('div');
        toolbar.id = 'floating-toolbar';
        
        // 자주 쓰는 색상 10가지 + 서식 지우기(🗑️)
        const colors = ['#000000', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#6B7280', '#9CA3AF'];
        
        let html = '';
        colors.forEach(color => {
            html += `<div class="color-btn" style="background-color:${color}" data-cmd="foreColor" data-val="${color}"></div>`;
        });
        // 구분선 및 지우기 버튼
        html += `<div style="width:1px; height:16px; background:#555; margin:0 2px;"></div>`;
        html += `<div class="clear-btn" data-cmd="removeFormat" title="서식 지우기">🗑️</div>`; // 아이콘으로 변경

        toolbar.innerHTML = html;
        document.body.appendChild(toolbar);

        // 버튼 클릭 이벤트 (이벤트 위임)
        toolbar.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 포커스 잃지 않게 방지
            const target = e.target;
            const cmd = target.dataset.cmd;
            const val = target.dataset.val;

            if (cmd) {
                document.execCommand(cmd, false, val || null);
                this.updateFloatingToolbarPosition(); // 적용 후 위치 재조정 (선택영역 변동 가능성)
            }
        });
    },

    // [신규] 드래그 시 툴바 위치 계산 및 표시
    bindFloatingToolbarEvents(inputId) {
        const inputEl = document.getElementById(inputId);
        if (!inputEl) return;

        const updateToolbar = () => {
            const toolbar = document.getElementById('floating-toolbar');
            const selection = window.getSelection();

            // 선택된 텍스트가 없거나, 다른 영역을 선택했으면 숨김
            if (selection.isCollapsed || !inputEl.contains(selection.anchorNode)) {
                toolbar.style.display = 'none';
                return;
            }

            this.updateFloatingToolbarPosition();
        };

        // 마우스를 뗐을 때(드래그 끝), 키보드로 선택했을 때 체크
        inputEl.addEventListener('mouseup', () => setTimeout(updateToolbar, 10)); // 약간의 지연 필요
        inputEl.addEventListener('keyup', (e) => {
            if (e.key === 'Shift' || e.key.startsWith('Arrow')) setTimeout(updateToolbar, 10);
        });
        
        // 입력 중이거나 포커스를 잃으면 숨김
        inputEl.addEventListener('input', () => { document.getElementById('floating-toolbar').style.display = 'none'; });
        inputEl.addEventListener('blur', () => { 
             // 툴바 버튼 클릭 시 blur가 먼저 발생할 수 있으므로 살짝 지연 체크
             setTimeout(() => {
                 const selection = window.getSelection();
                 if (selection.isCollapsed) document.getElementById('floating-toolbar').style.display = 'none';
             }, 200);
        });
    },

    // [신규] 툴바 위치 실제 계산 함수
    updateFloatingToolbarPosition() {
        const toolbar = document.getElementById('floating-toolbar');
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect(); // 선택된 텍스트의 좌표

        if (rect.width === 0) return; // 실제 선택된 게 없으면 종료

        toolbar.style.display = 'flex';
        
        // 툴바 위치: 선택 영역 바로 위 가운데
        const toolbarHeight = toolbar.offsetHeight || 40;
        const toolbarWidth = toolbar.offsetWidth || 300;
        
        let top = rect.top + window.scrollY - toolbarHeight - 10; // 10px 여백
        let left = rect.left + window.scrollX + (rect.width / 2) - (toolbarWidth / 2);

        // 화면 밖으로 나가는 것 방지
        if (left < 10) left = 10;
        if (left + toolbarWidth > window.innerWidth) left = window.innerWidth - toolbarWidth - 10;
        if (top < 10) top = rect.bottom + window.scrollY + 10; // 위 공간 없으면 아래로

        toolbar.style.top = `${top}px`;
        toolbar.style.left = `${left}px`;
    },
    
// [수정됨] 편집 모드 (플로팅 툴바 적용 & AI 자동 완성 로직 호환)
    async enterEditMode(side) {
        this.state.isEditing = true;
        
        // [1] 플로팅 툴바 초기화 (최초 1회 생성)
        if (this.initFloatingToolbar) this.initFloatingToolbar();

        const wordData = this.state.currentWordList[this.state.currentIndex];

        if (side === 'front') {
            const currentPos = wordData.pos || "";
            const currentWord = wordData.word || "";
            const wordInputValue = currentPos ? `${currentWord} [${currentPos}]` : currentWord;
            
            // 1. 표제어 (기존 동일)
            this.elements.wordDisplay.innerHTML = `
                <div class="flex flex-col gap-2">
                    <input type="text" id="edit-word-input" class="w-full text-center p-1 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold" value="${wordInputValue}" placeholder="Word [POS]">
                    <button id="auto-fill-btn" class="self-center text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 py-1 px-3 rounded-full transition-colors mb-2 font-semibold shadow-sm flex items-center gap-1">
                        🪄 AI 자동 완성
                    </button>
                </div>
            `;
            
            // 2. 뜻 (Meaning) - 툴바 없이 contenteditable div만 배치
            const currentMeaning = wordData.meaning || "";
            this.elements.meaningDisplay.innerHTML = `
                <div id="edit-meaning-input" class="w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px] text-left bg-white" contenteditable="true" placeholder="뜻">${currentMeaning}</div>
            `;
            
            // 3. 설명 (Explanation) - 툴바 없이 contenteditable div만 배치
            const currentExplanation = wordData.explanation || "";
            // 줄바꿈을 <br>로 변환하여 에디터에 표시
            const formattedExplanation = currentExplanation.replace(/\n/g, '<br>');
            this.elements.explanationDisplay.innerHTML = `
                <div id="edit-explanation-input" class="w-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[200px] text-left bg-white" contenteditable="true" placeholder="설명">${formattedExplanation}</div>
            `;

            setTimeout(() => {
                // [이벤트 연결] 드래그 시 플로팅 툴바 표시
                if (this.bindFloatingToolbarEvents) {
                    this.bindFloatingToolbarEvents('edit-meaning-input');
                    this.bindFloatingToolbarEvents('edit-explanation-input');
                }

                // AI 버튼 로직 (div contenteditable 호환되도록 수정됨)
                const autoBtn = document.getElementById('auto-fill-btn');
                const wordInput = document.getElementById('edit-word-input');
                const meaningInput = document.getElementById('edit-meaning-input'); 
                const explanationInput = document.getElementById('edit-explanation-input');

                if (autoBtn) {
                    autoBtn.onclick = async () => {
                        let targetWord = wordInput.value.trim();
                        targetWord = targetWord.replace(/\s*\[.*?\]$/, '');

                        if (!targetWord) {
                            window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "단어를 먼저 입력하세요.", isError: true } }));
                            return;
                        }

                        autoBtn.disabled = true;
                        autoBtn.innerHTML = `<span class="animate-spin inline-block">⏳</span> 분석 중...`;

                        try {
                            const aiData = await api.fetchWordInfoFromAI(targetWord);
                            
                            // 뜻 (Meaning) - innerHTML 사용
                            if (aiData.meaning) {
                                const original = meaningInput.innerHTML; 
                                const newContent = aiData.meaning.replace(/\n/g, '<br>'); // 줄바꿈 변환
                                
                                if (original && original.trim() && original !== '<br>') {
                                    if (!original.includes(newContent)) {
                                        meaningInput.innerHTML = original + "<br><br>" + newContent;
                                    }
                                } else {
                                    meaningInput.innerHTML = newContent;
                                }
                            }

                            // 설명 (Explanation) - innerHTML 사용
                            if (aiData.explanation) {
                                const original = explanationInput.innerHTML;
                                const newContent = aiData.explanation.replace(/\n/g, '<br>');
                                
                                if (original && original.trim() && original !== '<br>') {
                                    explanationInput.innerHTML = original + "<br><br>" + newContent;
                                } else {
                                    explanationInput.innerHTML = newContent;
                                }
                            }

                            // 예문 (Samples) - 데이터(wordData)에만 저장
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
            // 뒷면 편집 모드
            let currentSample = wordData.sample || "";
            // 줄바꿈 처리
            const formattedSample = currentSample.replace(/\n/g, '<br>');

            this.elements.backContent.innerHTML = `
                <div id="edit-sample-input" class="w-full h-full p-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-left overflow-y-auto leading-relaxed" contenteditable="true" placeholder="예문" style="min-height: 200px;">${formattedSample}</div>
            `;
            
            setTimeout(() => {
                if (this.bindFloatingToolbarEvents) {
                    this.bindFloatingToolbarEvents('edit-sample-input');
                }
            }, 0);

             const aiSection = this.elements.backContent.parentNode.querySelector('.ai-gen-section');
             if(aiSection) aiSection.style.display = 'none';
        }

        const editImgUrl = 'images/cat-edit.png';
        this.elements.sampleBtnImg.src = editImgUrl;
    },
    
async saveAndExitEditMode() {
        // 현재 편집 중인 카드 객체 (임시로 생성된 카드)
        const wordData = this.state.currentWordList[this.state.currentIndex];
        const side = this.state.editingSide;

        if (side === 'front') {
            const wordInput = document.getElementById('edit-word-input');
            const meaningInput = document.getElementById('edit-meaning-input');
            const explanationInput = document.getElementById('edit-explanation-input');
            
            if (wordInput && meaningInput && explanationInput) {
                const rawWordValue = wordInput.value.trim();
                const newMeaning = meaningInput.innerHTML.replace(/^(<br>)+|(<br>)+$/g, '').trim();
                const newExplanation = explanationInput.innerHTML.replace(/^(<br>)+|(<br>)+$/g, '').trim();
                
                // [중요] AI가 생성한 예문(sample)이 있다면 가져오고, 없으면 빈칸
                const newSample = wordData.sample || "";

                const match = rawWordValue.match(/^(.*?)\s*\[(.*?)\]$/);
                let newWord = rawWordValue;
                let newPos = undefined; 

                if (match) {
                    newWord = match[1].trim();
                    newPos = match[2].trim();
                } else {
                    if (wordData.isNew) newPos = ""; 
                    else newPos = undefined; 
                }
                
                if (!newWord) {
                     window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "표제어를 입력해주세요.", isError: true } }));
                     return;
                }

                // 중복 체크 (자기 자신 제외)
                if (newWord !== wordData.word) {
                    const isDuplicate = state.wordList.some(w => w.word.toLowerCase() === newWord.toLowerCase() && w !== wordData);
                    if (isDuplicate) {
                        window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "이미 존재하는 단어입니다.", isError: true } }));
                        return; 
                    }
                }

                if (wordData.isNew) {
                    // [서버 통신] 새 단어 생성 요청
                    const newCardData = {
                        word: newWord,
                        pos: newPos || "",
                        meaning: newMeaning,
                        explanation: newExplanation,
                        manual_sample: newSample // 예문 포함 전송
                    };
                    
                    let afterWord = null;
                    if (this.state.currentIndex > 0) {
                        // 바로 앞 단어 찾기 (A단어)
                        afterWord = this.state.currentWordList[this.state.currentIndex - 1].word;
                    }

                    // API 호출 (서버에 저장)
                    await api.createWord(newCardData, afterWord);
                    
                    // [UI 데이터 갱신] 임시 카드를 정식 데이터로 확정 (새 카드를 추가하는 게 아님!)
                    wordData.word = newWord;
                    wordData.pos = newPos || "";
                    wordData.meaning = newMeaning;
                    wordData.explanation = newExplanation;
                    wordData.sample = newSample; // 예문 확정
                    delete wordData.isNew; // 이제 더 이상 임시 카드가 아님
                    
                    window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "새 카드가 저장되었습니다." } }));

                } else {
                    // 기존 단어 수정 로직
                    await api.updateWordDetails(wordData.word, {
                        word: newWord,
                        pos: newPos,
                        meaning: newMeaning,
                        explanation: newExplanation,
                        manual_sample: newSample
                    });
                    
                    wordData.word = newWord;
                    if (newPos !== undefined) wordData.pos = newPos;
                    wordData.meaning = newMeaning;
                    wordData.explanation = newExplanation;
                    wordData.sample = newSample;
                }
            }
        } else { 
            // 뒷면 편집 모드 저장
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

        // 편집 모드 종료
        this.state.isEditing = false;
        this.state.editingSide = null;
        
        // [화면 갱신] 변경된 내용으로 현재 카드를 다시 그리기
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
            // sampleSource 제거됨
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

        // 검색어 없을 때: 기존 로직 (마지막 학습 위치로)
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
        
        // [최적화] 통합된 검색 루프 (Single Pass)
        // 기존 4번의 순회를 1번으로 단축하고, Levenshtein 계산에 limit 적용
        const exactMatches = [];
        const startsWithMatches = [];
        const includesMatches = [];
        const fuzzyMatches = [];
        
        const searchRegex = new RegExp(`\\b${lowerCaseStartWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        const explanationMatches = [];

        // 1. 단어 검색 & 설명 검색 동시 수행
        for (let index = 0; index < this.state.currentWordList.length; index++) {
            const item = this.state.currentWordList[index];
            const wordLower = item.word.toLowerCase();
            const wordObj = { word: item.word, index, distance: 0 };
            
            // 표제어 검색
            if (wordLower === lowerCaseStartWord) {
                exactMatches.push(wordObj);
            } else if (wordLower.startsWith(lowerCaseStartWord)) {
                startsWithMatches.push(wordObj);
            } else if (wordLower.includes(lowerCaseStartWord)) {
                includesMatches.push(wordObj);
            } else {
                // Fuzzy Logic (Optimized)
                // 길이 차이가 2 이하인 경우에만 계산
                const lenDiff = Math.abs(wordLower.length - lowerCaseStartWord.length);
                if (lenDiff <= 2) {
                    // limit=2 로 설정하여 조기 종료 유도
                    const dist = utils.levenshteinDistance(lowerCaseStartWord, wordLower, 2);
                    // 거리 2 이하이고, 길이가 충분히 긴 단어(오탐 방지)인 경우만 추가
                    if (dist <= 2 && dist < Math.max(wordLower.length, lowerCaseStartWord.length) * 0.4) {
                        wordObj.distance = dist;
                        fuzzyMatches.push(wordObj);
                    }
                }
            }

            // 설명 검색
            if (item.explanation) {
                const cleanedExplanation = item.explanation.replace(/\[.*?\]|\*/g, '');
                if (searchRegex.test(cleanedExplanation)) {
                    explanationMatches.push({ word: item.word, index });
                }
            }
        }

        // Fuzzy 결과 정렬 (거리 순)
        fuzzyMatches.sort((a, b) => a.distance - b.distance);

        // 결과 통합
        const vocabSuggestions = [
            ...exactMatches,
            ...startsWithMatches,
            ...includesMatches,
            ...fuzzyMatches
        ].slice(0, 50);

        // 3. 결과 표시
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
        
        if (wordData.word && !silent) { api.speak(wordData.word, 'word'); }
        
        this.elements.meaningDisplay.innerHTML = wordData.meaning.replace(/\n/g, '<br>');
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
    }
};
