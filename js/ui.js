import { state } from './config.js';
import { api } from './api.js';
import { nonInteractiveWords } from './utils.js';
import { learningMode } from './learning.js'; // [추가] 카드 갱신을 위해 import

export const ui = {
    // [신규] 모든 팝업/메뉴 닫기 (새 메뉴 열기 전 청소용)
    hideAllMenus() {
        this.hideWordContextMenu();
        this.hideEditContextMenu();
        this.hideCardContextMenu();
        this.hideTranslationTooltip();
    },

    createInteractiveFragment(text, isForSampleSentence = false) {
        const fragment = document.createDocumentFragment();
        if (!text || !text.trim()) return fragment;
        const parts = text.split(/([a-zA-Z0-9'-]+)/g);
        parts.forEach(part => {
            if (/([a-zA-Z0-9'-]+)/.test(part) && !nonInteractiveWords.has(part.toLowerCase())) {
                 const span = document.createElement('span');
                span.textContent = part;
                span.className = 'interactive-word';
                span.onclick = (e) => {
                    if (isForSampleSentence) e.stopPropagation();
                    clearTimeout(state.longPressTimer);
                    api.speak(part, 'word');
                };
                span.oncontextmenu = (e) => {
                    e.preventDefault();
                    if (isForSampleSentence) e.stopPropagation();
                    this.showWordContextMenu(e, part);
                };
                 let touchMove = false;
                span.addEventListener('touchstart', (e) => {
                    if (isForSampleSentence) e.stopPropagation();
                    touchMove = false;
                    clearTimeout(state.longPressTimer);
                    state.longPressTimer = setTimeout(() => { if (!touchMove) { this.showWordContextMenu(e, part); } }, 700);
                }, { passive: true });
                span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(state.longPressTimer); });
                span.addEventListener('touchend', () => { clearTimeout(state.longPressTimer); });
                fragment.appendChild(span);
            } else {
                fragment.appendChild(document.createTextNode(part));
            }
        });
        return fragment;
    },
    renderExplanationText(targetElement, text) {
        targetElement.innerHTML = '';
        if (!text || !text.trim()) return;
        const regex = /(\[.*?\])|([a-zA-Z0-9'-]+(?:[\s'-]*[a-zA-Z0-9'-]+)*)/g;
        text.split('\n').forEach((line, lineIndex, lineArr) => {
            let lastIndex = 0;
            let match;
            while ((match = regex.exec(line))) {
                if (match.index > lastIndex) {
                    targetElement.appendChild(document.createTextNode(line.substring(lastIndex, match.index)));
                }
                const [_, nonClickable, englishPhrase] = match;
                if (englishPhrase) {
                    const span = document.createElement('span');
                    span.textContent = englishPhrase;
                    if (!nonInteractiveWords.has(englishPhrase.toLowerCase())) {
                        span.className = 'interactive-word';
                        span.onclick = () => {
                            clearTimeout(state.longPressTimer);
                            api.speak(englishPhrase, 'word');
                        };
                        span.oncontextmenu = (e) => { e.preventDefault(); this.showWordContextMenu(e, englishPhrase); };
                        let touchMove = false;
                        span.addEventListener('touchstart', (e) => {
                            touchMove = false;
                            clearTimeout(state.longPressTimer);
                            state.longPressTimer = setTimeout(() => { if (!touchMove) this.showWordContextMenu(e, englishPhrase); }, 700);
                        }, { passive: true });
                        span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(state.longPressTimer); });
                        span.addEventListener('touchend', () => { clearTimeout(state.longPressTimer); });
                    }
                    targetElement.appendChild(span);
                } else if (nonClickable) {
                    targetElement.appendChild(document.createTextNode(nonClickable));
                }
                lastIndex = regex.lastIndex;
            }
            if (lastIndex < line.length) {
                targetElement.appendChild(document.createTextNode(line.substring(lastIndex)));
            }
            if (lineIndex < lineArr.length - 1) {
                targetElement.appendChild(document.createElement('br'));
            }
        });
    },

    displaySentences(sentences, containerElement) {
        containerElement.innerHTML = '';
        const emojiList = ['🐭','🐮','🐯','🐰','🐲','🐍','🐴','🐑','🐒','🐔','🐶','🐷','🐋','🦐','🦉','🐝','🐞','🦋','🐜'];

        (sentences || []).forEach((sentence, index) => {
            // 빈 줄(Spacer) 처리
            if (!sentence || !sentence.trim()) {
                const spacer = document.createElement('div');
                spacer.className = 'h-6 w-full'; 
                containerElement.appendChild(spacer);
                return; 
            }

            const p = document.createElement('p');
            p.className = 'p-2 rounded transition-colors hover:bg-gray-200 cursor-pointer relative group';

            const showTranslation = async (event) => {
                state.activeTranslationTarget = p;
                const translatedText = await api.translate(p.textContent.replace(/^[\u{1F000}-\u{1F9FF}.]\s*/u, '')); 
                if (state.activeTranslationTarget !== p) return;
                this.showTranslationTooltip(translatedText, event);
            };

            p.onclick = (e) => {
                if (e.target.closest('.sentence-content-area .interactive-word')) return;
                api.speak(p.textContent.replace(/^[\u{1F000}-\u{1F9FF}.]\s*/u, ''), 'sample');
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
                this.hideTranslationTooltip();
            });

            const emojiSpan = document.createElement('span');
            emojiSpan.textContent = emojiList[index % emojiList.length]; 
            emojiSpan.className = 'float-left mr-2 select-none text-xl leading-none mt-1';
            p.appendChild(emojiSpan);

            const sentenceContent = document.createElement('span');
            sentenceContent.className = 'sentence-content-area';
            sentenceContent.style.cursor = 'text';

            sentenceContent.addEventListener('mouseenter', () => {
                clearTimeout(state.translationTimer);
                if (state.activeTranslationTarget === p) {
                    state.activeTranslationTarget = null;
                }
                this.hideTranslationTooltip();
            });

            const sentenceParts = sentence.split(/(\*.*?\*)/g);
            sentenceParts.forEach(part => {
                if (part.startsWith('*') && part.endsWith('*')) {
                    const strong = document.createElement('strong');
                    strong.appendChild(this.createInteractiveFragment(part.slice(1, -1), true));
                    sentenceContent.appendChild(strong);
                } else if (part) {
                    sentenceContent.appendChild(this.createInteractiveFragment(part, true));
                }
            });
            p.appendChild(sentenceContent);
            containerElement.appendChild(p);
        });
    },
    
    showTranslationTooltip(text, event) {
        const tooltip = document.getElementById('translation-tooltip');
        tooltip.textContent = text;
        tooltip.classList.remove('hidden');
        const rect = event.target.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        let left = rect.left;
        let top = rect.bottom + scrollTop + 5;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

         requestAnimationFrame(() => {
             const tooltipRect = tooltip.getBoundingClientRect();
             if (tooltipRect.right > window.innerWidth - 10) {
                 tooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
             }
             if (left < 10) {
                 tooltip.style.left = '10px';
             }
         });
    },
    hideTranslationTooltip() {
        document.getElementById('translation-tooltip').classList.add('hidden');
    },

    // [수정] 사전 메뉴 표시 (기존 메뉴 닫기 추가)
    showWordContextMenu(event, word, options = {}) {
        this.hideAllMenus(); // 🔥 기존 메뉴 모두 닫기

        event.preventDefault();
        const menu = document.getElementById('word-context-menu');
        if (!menu) return;

        document.getElementById('search-app-context-btn').style.display = options.hideAppSearch ? 'none' : 'block';

        const touch = event.touches ? event.touches[0] : null;
        const x = touch ? touch.clientX : event.clientX;
        const y = touch ? touch.clientY : event.clientY;

        menu.style.left = `0px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');

        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            let finalX = x;
            let finalY = y;
            if (x + menuRect.width > window.innerWidth - 10) {
                finalX = window.innerWidth - menuRect.width - 10;
            }
            if (y + menuRect.height > window.innerHeight - 10) {
                 finalY = window.innerHeight - menuRect.height - 10;
            }
             if (finalX < 10) finalX = 10;
             if (finalY < 10) finalY = 10;

            menu.style.left = `${finalX}px`;
            menu.style.top = `${finalY}px`;
        });

        const encodedWord = encodeURIComponent(word);

        document.getElementById('search-app-context-btn').onclick = () => {
             document.dispatchEvent(new CustomEvent('searchWord', { detail: word }));
             this.hideWordContextMenu();
        };
        document.getElementById('search-daum-context-btn').onclick = () => { window.open(`https://dic.daum.net/search.do?q=${encodedWord}`, 'dict_daum'); this.hideWordContextMenu(); };
        document.getElementById('search-naver-context-btn').onclick = () => { window.open(`https://en.dict.naver.com/#/search?query=${encodedWord}`, 'dict_naver'); this.hideWordContextMenu(); };
        document.getElementById('search-etym-context-btn').onclick = () => { window.open(`https://www.etymonline.com/search?q=${encodedWord}`, 'dict_etym'); this.hideWordContextMenu(); };
        document.getElementById('search-longman-context-btn').onclick = () => { window.open(`https://www.ldoceonline.com/dictionary/${encodedWord}`, 'dict_longman'); this.hideWordContextMenu(); };
    },
    hideWordContextMenu() {
        const menu = document.getElementById('word-context-menu');
        if (menu) menu.classList.add('hidden');
    },

    // [수정] 편집 메뉴 표시 (기존 메뉴 닫기 추가)
    showEditContextMenu(event) {
        this.hideAllMenus(); // 🔥 기존 메뉴 모두 닫기

        const menu = document.getElementById('edit-context-menu');
        if (!menu) return;
        const touch = event.touches ? event.touches[0] : null;
        const x = touch ? touch.clientX : event.clientX;
        const y = touch ? touch.clientY : event.clientY;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            let finalX = x;
            let finalY = y;
            if (x + menuRect.width > window.innerWidth - 10) finalX = window.innerWidth - menuRect.width - 10;
            if (y + menuRect.height > window.innerHeight - 10) finalY = window.innerHeight - menuRect.height - 10;
            if (finalX < 10) finalX = 10;
            if (finalY < 10) finalY = 10;
            menu.style.left = `${finalX}px`;
            menu.style.top = `${finalY}px`;
        });
    },
    hideEditContextMenu() {
        const menu = document.getElementById('edit-context-menu');
        if (menu) menu.classList.add('hidden');
    },
    
    // [수정] 카드 메뉴 표시 (버튼 생성 및 삭제 로직 개선)
    showCardContextMenu(event) {
        this.hideAllMenus(); // 🔥 기존 메뉴 모두 닫기

        const menu = document.getElementById('card-context-menu');
        if (!menu) return;

        // [추가] 현재 카드의 단어 정보 가져오기 (learning.js의 상태 이용)
        const currentWord = learningMode.state.currentWordList[learningMode.state.currentIndex];
        
        // 메뉴 내부 초기화 후 버튼 생성
        menu.innerHTML = '';

        if (currentWord) {
            // 1. 수정 버튼
            const editBtn = document.createElement('div');
            editBtn.className = 'p-3 hover:bg-gray-100 cursor-pointer flex items-center';
            editBtn.innerHTML = '<span class="material-icons text-sm mr-2">edit</span>수정';
            editBtn.onclick = () => {
                this.hideAllMenus();
                if(learningMode.openEditModal) learningMode.openEditModal(currentWord);
            };
            menu.appendChild(editBtn);

            // 2. 추가 버튼
            const addBtn = document.createElement('div');
            addBtn.className = 'p-3 hover:bg-gray-100 cursor-pointer flex items-center';
            addBtn.innerHTML = '<span class="material-icons text-sm mr-2">add</span>이 뒤에 단어 추가';
            addBtn.onclick = () => {
                this.hideAllMenus();
                if(learningMode.openAddModal) learningMode.openAddModal(currentWord.word);
            };
            menu.appendChild(addBtn);

            // 3. 삭제 버튼 [핵심 로직 수정됨]
            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'p-3 hover:bg-gray-100 cursor-pointer text-red-600 flex items-center';
            deleteBtn.innerHTML = '<span class="material-icons text-sm mr-2">delete</span>삭제';
            
            deleteBtn.onclick = async () => {
                if (!confirm(`'${currentWord.word}' 단어를 정말 삭제하시겠습니까?`)) return;

                // (1) 메뉴 닫기
                this.hideAllMenus();
                
                // (2) 서버 및 데이터 삭제 요청
                await api.deleteWord(currentWord.word);

                // (3) [핵심] 현재 학습 화면(UI) 리스트에서 해당 단어를 '쏙' 빼기
                const currentList = learningMode.state.currentWordList;
                learningMode.state.currentWordList = currentList.filter(w => w.word !== currentWord.word);

                // (4) 인덱스 조정 (마지막 카드를 지웠을 때 에러 방지)
                if (learningMode.state.currentIndex >= learningMode.state.currentWordList.length) {
                    learningMode.state.currentIndex = Math.max(0, learningMode.state.currentWordList.length - 1);
                }

                // (5) 화면 즉시 갱신 (새로고침 없이 다음 카드 렌더링)
                if (learningMode.state.currentWordList.length === 0) {
                    alert("모든 단어가 삭제되었습니다.");
                    location.reload(); // 단어가 하나도 없으면 새로고침
                } else {
                    alert("삭제되었습니다."); 
                    learningMode.renderCard(); // 여기가 마법! 다음 카드를 바로 그려줍니다.
                }
            };
            menu.appendChild(deleteBtn);
        }

        // 메뉴 위치 지정 (기존 로직 유지)
        const touch = event.touches ? event.touches[0] : null;
        const x = touch ? touch.clientX : event.clientX;
        const y = touch ? touch.clientY : event.clientY;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            let finalX = x;
            let finalY = y;
            if (x + menuRect.width > window.innerWidth - 10) finalX = window.innerWidth - menuRect.width - 10;
            if (y + menuRect.height > window.innerHeight - 10) finalY = window.innerHeight - menuRect.height - 10;
            if (finalX < 10) finalX = 10;
            if (finalY < 10) finalY = 10;
            menu.style.left = `${finalX}px`;
            menu.style.top = `${finalY}px`;
        });
    },
    hideCardContextMenu() {
        const menu = document.getElementById('card-context-menu');
        if (menu) menu.classList.add('hidden');
    },
    
    showDeleteConfirmModal() {
        document.getElementById('delete-confirm-modal').classList.remove('hidden');
    },
    hideDeleteConfirmModal() {
        document.getElementById('delete-confirm-modal').classList.add('hidden');
    }
};
