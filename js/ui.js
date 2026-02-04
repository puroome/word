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

        // HTML 태그 확인 (단순 줄바꿈 제외)
        const hasHTML = /<[a-z][\s\S]*>/i.test(text);
        if (!hasHTML) {
            text = text.replace(/\n/g, '<br>');
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = text;

        const processNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const content = node.textContent;
                if (!content.trim()) return document.createTextNode(content);
                return this.createInteractiveFragment(content);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName.toLowerCase() === 'br') return node.cloneNode(true);
                const newNode = node.cloneNode(false);
                Array.from(node.childNodes).forEach(child => {
                    newNode.appendChild(processNode(child));
                });
                return newNode;
            }
            return node.cloneNode(true);
        };

        Array.from(tempDiv.childNodes).forEach(child => {
            targetElement.appendChild(processNode(child));
        });
    },
    
// ui.js - displaySentences 함수 앞부분 수정

    displaySentences(sentencesInput, containerElement) {
        containerElement.innerHTML = '';
        const emojiList = ['🐭','🐮','🐯','🐰','🐲','🐍','🐴','🐑','🐒','🐔','🐶','🐷','🐋','🦐','🦉','🐝','🐞','🦋','🐜'];

        let sentences = [];
        if (typeof sentencesInput === 'string') {
            const raw = sentencesInput
                .replace(/<div>/gi, '__BR__')
                .replace(/<\/div>/gi, '')
                .replace(/<p>/gi, '__BR__')
                .replace(/<\/p>/gi, '')
                .replace(/<br\s*\/?>/gi, '__BR__');
            
            // [수정됨] .filter(s => s.trim() !== '') 삭제!
            // 빈 줄도 배열에 포함시켜야 화면에 여백으로 나옵니다.
            sentences = raw.split('__BR__'); 
        } else if (Array.isArray(sentencesInput)) {
            sentences = sentencesInput;
        }

        sentences.forEach((sentence, index) => {
            // [수정됨] 빈 줄이면 높이가 있는 투명 박스(spacer) 추가하고 종료
            if (!sentence || !sentence.trim()) {
                // 연속된 줄바꿈이 너무 좁아 보이지 않게 최소 높이(h-6) 부여
                const spacer = document.createElement('div');
                spacer.className = 'h-6 w-full'; 
                containerElement.appendChild(spacer);
                return; 
            }
            
            const p = document.createElement('p');
            p.className = 'p-2 rounded transition-colors hover:bg-gray-200 cursor-pointer relative group flex items-start';

            // 번역/TTS 기능 (기존 로직)
            const showTranslation = async (event) => {
                state.activeTranslationTarget = p;
                this.showTranslationTooltip("Translating...", event);
                const cleanText = p.textContent.replace(/^[\u{1F000}-\u{1F9FF}.]\s*/u, '');
                const translatedText = await api.translate(cleanText); 
                if (state.activeTranslationTarget !== p) return;
                this.showTranslationTooltip(translatedText, event);
            };

            p.onclick = (e) => {
                if (e.target.closest('.interactive-word')) return;
                const cleanText = p.textContent.replace(/^[\u{1F000}-\u{1F9FF}.]\s*/u, '');
                api.speak(cleanText, 'sample');
                showTranslation(e);
            };
            
            p.addEventListener('mouseenter', (e) => {
                 if (e.target === p) {
                    clearTimeout(state.translationTimer);
                    state.activeTranslationTarget = p;
                    state.translationTimer = setTimeout(() => { if (state.activeTranslationTarget === p) showTranslation(e); }, 1000);
                 }
            });
            p.addEventListener('mouseleave', () => {
                clearTimeout(state.translationTimer);
                if (state.activeTranslationTarget === p) state.activeTranslationTarget = null;
                this.hideTranslationTooltip();
            });

            // 이모지
            const emojiSpan = document.createElement('span');
            emojiSpan.textContent = emojiList[index % emojiList.length]; 
            emojiSpan.className = 'flex-shrink-0 mr-2 select-none text-xl leading-snug mt-0.5';
            p.appendChild(emojiSpan);

            // [핵심] HTML 구조를 유지하면서 텍스트 노드만 찾아 클릭 기능 입히기 (재귀 함수)
            const contentSpan = document.createElement('span');
            contentSpan.className = 'flex-grow sentence-content-area leading-snug';
            contentSpan.style.cursor = 'text';

            const processNode = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const content = node.textContent;
                    if (!content.trim()) return document.createTextNode(content);
                    // 기존 createInteractiveFragment 재사용 (단어 클릭 기능)
                    return this.createInteractiveFragment(content, true);
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const tagName = node.tagName.toLowerCase();
                    // 줄바꿈 태그는 이미 위에서 처리했으므로 여기선 무시하거나 공백 처리
                    if (tagName === 'br' || tagName === 'div' || tagName === 'p') {
                        return document.createTextNode(' '); 
                    }
                    
                    const newNode = node.cloneNode(false); // 태그 껍데기 복사 (style, class 등 포함)
                    Array.from(node.childNodes).forEach(child => {
                        newNode.appendChild(processNode(child));
                    });
                    return newNode;
                }
                return node.cloneNode(true);
            };

            // HTML 문자열을 DOM으로 변환 후 처리
            const tempContainer = document.createElement('div');
            tempContainer.innerHTML = sentence;
            Array.from(tempContainer.childNodes).forEach(child => {
                contentSpan.appendChild(processNode(child));
            });

            p.appendChild(contentSpan);
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

    // [수정] 편집 메뉴 표시
    showEditContextMenu(event) {
        this.hideAllMenus(); 

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

                // 기존 이벤트 제거를 위해 버튼 재생성 (중복 클릭 방지)
                const newConfirm = confirmBtn.cloneNode(true);
                const newCancel = cancelBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
                cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

                // [취소] 버튼 클릭 시
                newCancel.onclick = () => { modal.style.display = 'none'; };
                
                // [삭제] 버튼 클릭 시 (실제 삭제 로직)
                newConfirm.onclick = async () => {
                    modal.style.display = 'none'; // 창 닫기
                    
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

        // 메뉴 위치 지정 (원본 UI 코드 그대로)
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
};
