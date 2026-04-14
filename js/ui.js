import { state } from './config.js';
import { api } from './api.js';
import { nonInteractiveWords } from './utils.js';
import { learningMode } from './learning.js'; 

export const ui = {
    // [신규] 모든 팝업/메뉴 닫기
    hideAllMenus() {
        this.hideWordContextMenu();
        this.hideEditContextMenu();
        this.hideCardContextMenu();
        this.hideTranslationTooltip();
    },

    // --- 공통 헬퍼 ---
    // 터치/마우스 이벤트에서 클라이언트 좌표를 통일하여 반환
    _getEventCoords(event) {
        const touch = event.touches ? event.touches[0] : null;
        return {
            x: touch ? touch.clientX : event.clientX,
            y: touch ? touch.clientY : event.clientY
        };
    },

    // 메뉴 엘리먼트를 (x, y) 위치에 배치하되 화면 밖으로 넘치지 않도록 보정
    _positionMenu(menu, x, y) {
        menu.style.left = `${x}px`;
        menu.style.top  = `${y}px`;
        menu.classList.remove('hidden');
        requestAnimationFrame(() => {
            const rect   = menu.getBoundingClientRect();
            let finalX = x;
            let finalY = y;
            if (x + rect.width  > window.innerWidth  - 10) finalX = window.innerWidth  - rect.width  - 10;
            if (y + rect.height > window.innerHeight - 10) finalY = window.innerHeight - rect.height - 10;
            if (finalX < 10) finalX = 10;
            if (finalY < 10) finalY = 10;
            menu.style.left = `${finalX}px`;
            menu.style.top  = `${finalY}px`;
        });
    },

    // [수정] treatAsPhrase 매개변수 추가 (true일 경우 단어 뭉치를 유지)
    createInteractiveFragment(content, isForSampleSentence = false, treatAsPhrase = false) {
        const fragment = document.createDocumentFragment();
        if (!content || !content.trim()) return fragment;

        // 1. 임시 컨테이너를 만들어 HTML 구조 파싱
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;

        // 2. 재귀적으로 노드를 탐색하며 텍스트만 Interactive 하게 변환하는 함수
        const walkAndProcess = (node) => {
            if (node.nodeType === 3) { // 텍스트 노드인 경우
                const text = node.nodeValue;
                if (!text.trim()) return document.createTextNode(text);

                const textFragment = document.createDocumentFragment();
                
                // [수정] 모드에 따라 분리 정규식 선택 (단어 vs 뭉치)
                // treatAsPhrase가 true면 explanation 영역의 뭉치 로직을 사용합니다.
                const splitRegex = treatAsPhrase 
                    ? /(\[.*?\])|([a-zA-Z0-9'-]+(?:[\s'-]*[a-zA-Z0-9'-]+)*)/g 
                    : /([a-zA-Z0-9'-]+)/g;

                const parts = text.split(splitRegex);
                
                parts.forEach(part => {
                    if (!part) return; // 정규식 그룹 매칭으로 인한 빈 값 방지

                    // 클릭 가능한 요소인지 판별
                    const isInteractive = treatAsPhrase
                        ? /^[a-zA-Z0-9'-]+(?:[\s'-]*[a-zA-Z0-9'-]+)*$/.test(part) // 뭉치 모드일 때
                        : /([a-zA-Z0-9'-]+)/.test(part); // 단어 모드일 때

                    if (isInteractive && !nonInteractiveWords.has(part.toLowerCase())) {
                        const span = document.createElement('span');
                        span.textContent = part;
                        span.className = 'interactive-word';
                        
                        // 클릭 이벤트 (TTS)
                        span.onclick = (e) => {
                            if (isForSampleSentence) e.stopPropagation();
                            clearTimeout(state.longPressTimer);
                            api.speak(part, 'word');
                        };
                        // 우클릭 이벤트 (메뉴)
                        span.oncontextmenu = (e) => {
                            e.preventDefault();
                            if (isForSampleSentence) e.stopPropagation();
                            this.showWordContextMenu(e, part);
                        };
                        // 터치 이벤트
                        let touchMove = false;
                        span.addEventListener('touchstart', (e) => {
                            if (isForSampleSentence) e.stopPropagation();
                            touchMove = false;
                            state.longPressTimer = setTimeout(() => {
                                this.showWordContextMenu(e, part);
                            }, 800);
                        });
                        span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(state.longPressTimer); });
                        span.addEventListener('touchend', () => { 
                            clearTimeout(state.longPressTimer);
                            if(!touchMove) api.speak(part, 'word'); 
                        });

                        textFragment.appendChild(span);
                    } else {
                        textFragment.appendChild(document.createTextNode(part));
                    }
                });
                return textFragment;

            } else if (node.nodeType === 1) { // 요소 노드(태그)인 경우 (예: <b>, <span style...>)
                const newElement = node.cloneNode(false); // 껍데기만 복사 (속성 유지)
                node.childNodes.forEach(child => {
                    newElement.appendChild(walkAndProcess(child)); // 자식들도 재귀적으로 처리
                });
                return newElement;
            }
            return node.cloneNode(true); // 그 외 노드는 그냥 복사
        };

        // 3. 변환된 노드들을 fragment에 추가
        tempDiv.childNodes.forEach(child => {
            fragment.appendChild(walkAndProcess(child));
        });

        return fragment;
    },
    renderExplanationText(targetElement, text) {
        // [수정] 서식 태그(<...>)가 있어도 포기하지 않고 createInteractiveFragment를 사용
        if (text && /<[a-z][\s\S]*>/i.test(text)) {
            targetElement.innerHTML = '';
            // [수정] 3번째 인자로 true를 넘겨서 '뭉치(Phrase)' 단위 처리를 유지하도록 함
            targetElement.appendChild(this.createInteractiveFragment(text, false, true));
            return;
        }

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
            p.className = 'p-2 rounded transition-colors hover:bg-white cursor-pointer relative group shadow-sm hover:shadow';

            const showTranslation = async (event) => {
                state.activeTranslationTarget = p;
                this.showTranslationTooltip("Translating...", event);
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

    // [수정] 사전 메뉴 표시
    showWordContextMenu(event, word, options = {}) {
        this.hideAllMenus();
        event.preventDefault();
        const menu = document.getElementById('word-context-menu');
        if (!menu) return;

        const { x, y } = this._getEventCoords(event);
        this._positionMenu(menu, x, y);

        const encodedWord = encodeURIComponent(word);
        document.getElementById('search-app-context-btn').onclick    = () => { document.dispatchEvent(new CustomEvent('searchWord', { detail: word })); this.hideWordContextMenu(); };
        document.getElementById('search-daum-context-btn').onclick   = () => { window.open(`https://dic.daum.net/search.do?q=${encodedWord}`, 'dict_daum'); this.hideWordContextMenu(); };
        document.getElementById('search-naver-context-btn').onclick  = () => { window.open(`https://en.dict.naver.com/#/search?query=${encodedWord}`, 'dict_naver'); this.hideWordContextMenu(); };
        document.getElementById('search-etym-context-btn').onclick   = () => { window.open(`https://www.etymonline.com/search?q=${encodedWord}`, 'dict_etym'); this.hideWordContextMenu(); };
        document.getElementById('search-longman-context-btn').onclick = () => { window.open(`https://www.ldoceonline.com/dictionary/${encodedWord}`, 'dict_longman'); this.hideWordContextMenu(); };
    },
    hideWordContextMenu() {
        const menu = document.getElementById('word-context-menu');
        if (menu) menu.classList.add('hidden');
    },

    // [수정] 편집 메뉴 표시
    showEditContextMenu(event) {
        this.hideAllMenus();
        const menu = document.getElementById('edit-context-menu');
        if (!menu) return;
        const { x, y } = this._getEventCoords(event);
        this._positionMenu(menu, x, y);
    },
    hideEditContextMenu() {
        const menu = document.getElementById('edit-context-menu');
        if (menu) menu.classList.add('hidden');
    },
    
    // [중복 메시지 제거 및 삭제 기능 수정 완료]
    showCardContextMenu(event) {
        this.hideAllMenus(); // 메뉴 닫기

        const menu = document.getElementById('card-context-menu');
        if (!menu) return;

        // 1. 현재 카드 데이터 가져오기
        const currentWord = learningMode.state.currentWordList[learningMode.state.currentIndex];

        // 2. HTML에 있는 삭제 버튼 찾기 (ID: delete-card-btn)
        let deleteBtn = document.getElementById('delete-card-btn');

        // 3. 버튼이 있고 단어도 있다면?
        if (deleteBtn && currentWord) {
            // [핵심] 기존 버튼을 복제해서 교체합니다.
            // 이렇게 하면 기존 코드(main.js 등)에서 붙여놓은 '빨간 모달(2번째 창)' 이벤트가 싹 사라집니다.
            const newDeleteBtn = deleteBtn.cloneNode(true);
            deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
            deleteBtn = newDeleteBtn; // 참조 변수 업데이트

            // 4. 이제 깨끗해진 버튼에 "우리가 원하는 동작(1번째 창)"만 붙입니다.
            deleteBtn.onclick = () => {
                this.hideAllMenus();

                // 1. 예쁜 팝업창이 없으면 자동으로 만들기 (CSS + HTML 자동 주입)
                if (!document.getElementById('nice-alert-modal')) {
                    const style = document.createElement('style');
                    style.innerHTML = `
                        .nice-modal-overlay { position: fixed; inset:0; background: rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:9999; backdrop-filter: blur(2px); }
                        .nice-modal-box { background: white; padding: 24px; border-radius: 16px; width: 85%; max-width: 300px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.2); animation: popIn 0.2s ease-out; }
                        .nice-modal-title { font-size: 1.2rem; font-weight: bold; margin-bottom: 8px; color: #1f2937; }
                        .nice-modal-desc { color: #4b5563; margin-bottom: 20px; line-height: 1.5; font-size: 1rem; }
                        .nice-modal-btns { display: flex; gap: 10px; }
                        .nice-btn { flex: 1; padding: 12px; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; transition: 0.1s; font-size: 1rem; }
                        .nice-btn:active { transform: scale(0.96); }
                        .nice-btn-cancel { background: #f3f4f6; color: #4b5563; }
                        .nice-btn-del { background: #ef4444; color: white; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.3); }
                        @keyframes popIn { from{transform:scale(0.95);opacity:0} to{transform:scale(1);opacity:1} }
                    `;
                    document.head.appendChild(style);

                    const html = `
                        <div id="nice-alert-modal" class="nice-modal-overlay" style="display:none">
                            <div class="nice-modal-box">
                                <div class="nice-modal-title">🗑️ 카드 삭제</div>
                                <div id="nice-msg" class="nice-modal-desc"></div>
                                <div class="nice-modal-btns">
                                    <button id="nice-cancel" class="nice-btn nice-btn-cancel">취소</button>
                                    <button id="nice-confirm" class="nice-btn nice-btn-del">삭제</button>
                                </div>
                            </div>
                        </div>`;
                    document.body.insertAdjacentHTML('beforeend', html);
                }

                // 2. 팝업창 띄우기
                const modal = document.getElementById('nice-alert-modal');
                const msgEl = document.getElementById('nice-msg');
                const confirmBtn = document.getElementById('nice-confirm');
                const cancelBtn = document.getElementById('nice-cancel');

                // 메시지 설정 (현재 단어 이름 넣기)
                msgEl.innerHTML = `'<b>${currentWord.word}</b>' 단어를<br>정말 삭제하시겠습니까?`;
                modal.style.display = 'flex';
                document.body.style.overflow = 'hidden'; // ✨ 삭제 모달 열릴 때 잠금

                // 기존 이벤트 제거를 위해 버튼 재생성 (중복 클릭 방지)
                const newConfirm = confirmBtn.cloneNode(true);
                const newCancel = cancelBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
                cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

                // [취소] 버튼 클릭 시
                newCancel.onclick = () => {
                    modal.style.display = 'none';
                    document.body.style.overflow = ''; // ✨ 취소해서 닫힐 때 해제
                };
                // [삭제] 버튼 클릭 시 (실제 삭제 로직)
                newConfirm.onclick = async () => {
                    modal.style.display = 'none'; // 창 닫기
                    document.body.style.overflow = ''; // ✨ 삭제 후 닫힐 때 해제
                    
                    // (1) 서버 데이터 삭제
                    await api.deleteWord(currentWord.word);

                    // (2) 리스트 갱신
                    const currentList = learningMode.state.currentWordList;
                    learningMode.state.currentWordList = currentList.filter(w => w.word !== currentWord.word);

                    // (3) 인덱스 조정 (마지막 카드였을 경우 앞 카드로)
                    if (learningMode.state.currentIndex >= learningMode.state.currentWordList.length) {
                        learningMode.state.currentIndex = Math.max(0, learningMode.state.currentWordList.length - 1);
                    }

                    // (4) 화면 즉시 갱신 (다음 카드로 이동)
                    if (learningMode.state.currentWordList.length === 0) {
                        alert("모든 단어가 삭제되었습니다.");
                        location.reload(); 
                    } else {
                        // 바로 다음 단어 보여주기
                        learningMode.displayWord(learningMode.state.currentIndex, true); 
                    }
                };
            };
        }

        // 메뉴 위치 지정
        const { x, y } = this._getEventCoords(event);
        this._positionMenu(menu, x, y);
    },
    hideCardContextMenu() {
        const menu = document.getElementById('card-context-menu');
        if (menu) menu.classList.add('hidden');
    },
};
