import { state } from './config.js';
import { api } from './api.js';
import { nonInteractiveWords } from './utils.js';
import { learningMode } from './learning.js'; 

export const ui = {
// [신규] 서식 툴팁 요소 생성
    createFormatTooltip() {
        if (document.getElementById('format-tooltip')) return;

        const tooltip = document.createElement('div');
        tooltip.id = 'format-tooltip';
        tooltip.className = 'hidden';
        
        // 🔴 Red
        const btnRed = document.createElement('button');
        btnRed.className = 'format-btn btn-red';
        btnRed.onmousedown = (e) => { e.preventDefault(); this.applyFormat('foreColor', '#ef4444'); };
        
        // 🔵 Blue
        const btnBlue = document.createElement('button');
        btnBlue.className = 'format-btn btn-blue';
        btnBlue.onmousedown = (e) => { e.preventDefault(); this.applyFormat('foreColor', '#3b82f6'); };

        // 🟢 Green
        const btnGreen = document.createElement('button');
        btnGreen.className = 'format-btn btn-green';
        btnGreen.onmousedown = (e) => { e.preventDefault(); this.applyFormat('foreColor', '#22c55e'); };

        // 🚮 Clear
        const btnClear = document.createElement('button');
        btnClear.className = 'format-btn btn-clear';
        btnClear.innerHTML = '🗑️'; 
        btnClear.onmousedown = (e) => { e.preventDefault(); this.applyFormat('removeFormat'); };

        tooltip.append(btnRed, btnBlue, btnGreen, btnClear);
        document.body.appendChild(tooltip);
    },

    // [신규] 서식 적용 실행
    applyFormat(command, value = null) {
        document.execCommand(command, false, value);
        this.hideFormatTooltip();
        // 편집 내용 변경 이벤트 트리거
        if (state.activeEditingElement) {
            state.activeEditingElement.dispatchEvent(new Event('input', { bubbles: true }));
        }
    },

    // [신규] 서식 툴팁 표시
    showFormatTooltip(x, y) {
        this.createFormatTooltip();
        const tooltip = document.getElementById('format-tooltip');
        tooltip.classList.remove('hidden');
        
        const rect = tooltip.getBoundingClientRect();
        let top = y - rect.height - 10;
        let left = x - (rect.width / 2);

        if (top < 10) top = y + 20; 
        if (left < 10) left = 10;
        if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 10;

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    },

    // [신규] 서식 툴팁 숨기기
    hideFormatTooltip() {
        const tooltip = document.getElementById('format-tooltip');
        if (tooltip) tooltip.classList.add('hidden');
    },

    // [수정] 모든 메뉴 닫기 (기존 함수가 있다면 이걸로 덮어씌워줘)
    hideAllMenus() {
        if(this.hideWordContextMenu) this.hideWordContextMenu();
        if(this.hideEditContextMenu) this.hideEditContextMenu();
        if(this.hideCardContextMenu) this.hideCardContextMenu();
        if(this.hideTranslationTooltip) this.hideTranslationTooltip();
        this.hideFormatTooltip(); // 👈 이게 추가된 핵심이야
    },

    // [수정] HTML 태그 지원 및 단어 클릭 기능 통합
    createInteractiveFragment(text, isForSampleSentence = false) {
        const fragment = document.createDocumentFragment();
        if (!text || !text.trim()) return fragment;

        // HTML 태그가 포함되어 있는지 확인
        const hasHtml = /<[a-z][\s\S]*>/i.test(text);

        if (!hasHtml) {
            return this.createInteractiveFragmentFromPlainText(text, isForSampleSentence);
        } else {
            return this.createInteractiveFragmentFromHtml(text, isForSampleSentence);
        }
    },

    // 기존 로직 분리 (Plain Text용)
    createInteractiveFragmentFromPlainText(text, isForSampleSentence) {
        const fragment = document.createDocumentFragment();
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

    // [신규] HTML 구조를 유지하면서 텍스트 노드만 찾아 Interactive하게 변환
    createInteractiveFragmentFromHtml(html, isForSampleSentence) {
        const fragment = document.createDocumentFragment();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        const processNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return this.createInteractiveFragmentFromPlainText(node.textContent, isForSampleSentence);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const newEl = node.cloneNode(false);
                Array.from(node.childNodes).forEach(child => {
                    newEl.appendChild(processNode(child));
                });
                return newEl;
            }
            return node.cloneNode(true);
        };

        Array.from(tempDiv.childNodes).forEach(child => {
            fragment.appendChild(processNode(child));
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
        (sentences || []).forEach((sentence, index) => {
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
                ui.hideTranslationTooltip();
            });

            // 문장 내 단어 Interactive 처리 (RichText 미지원인 경우 대비)
            const sentenceContent = document.createElement('span');
            sentenceContent.className = 'sentence-content-area'; 
            const sentenceParts = sentence.split(/(\*.*?\*)/g);
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
            containerElement.appendChild(p);
        });
    },

    showTranslationTooltip(text, event) {
        let tooltip = document.getElementById('translation-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'translation-tooltip';
            tooltip.className = 'absolute bg-black text-white text-sm rounded px-3 py-2 z-50 max-w-xs transition-opacity duration-200 opacity-0 pointer-events-none hidden';
            document.body.appendChild(tooltip);
        }
        tooltip.textContent = text;
        tooltip.classList.remove('hidden');
        requestAnimationFrame(() => tooltip.classList.remove('opacity-0'));

        const target = event.target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        
        let top = target.top - tooltipRect.height - 10 + window.scrollY;
        let left = target.left + (target.width - tooltipRect.width) / 2 + window.scrollX;

        if (top < 0) top = target.bottom + 10 + window.scrollY;
        if (left < 10) left = 10;
        if (left + tooltipRect.width > document.body.clientWidth - 10) left = document.body.clientWidth - tooltipRect.width - 10;

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    },

    hideTranslationTooltip() {
        const tooltip = document.getElementById('translation-tooltip');
        if (tooltip) {
            tooltip.classList.add('opacity-0');
            setTimeout(() => tooltip.classList.add('hidden'), 200);
        }
        if (state.activeTranslationTarget) state.activeTranslationTarget = null;
    },

    showWordContextMenu(event, word) {
        let menu = document.getElementById('word-context-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'word-context-menu';
            menu.className = 'fixed bg-white border border-gray-200 shadow-xl rounded-lg z-50 hidden overflow-hidden';
            document.body.appendChild(menu);
        }
        
        menu.innerHTML = `
            <div class="py-1 min-w-[160px]">
                <button id="ctx-search-naver" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 active:bg-blue-100 border-b border-gray-100">📖 네이버 사전</button>
                <button id="ctx-search-google" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 active:bg-blue-100 border-b border-gray-100">🖼️ 구글 이미지</button>
                <button id="ctx-copy-word" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 active:bg-blue-100">📋 단어 복사</button>
            </div>
        `;
        
        document.getElementById('ctx-search-naver').onclick = () => {
            window.open(`https://en.dict.naver.com/#/search?query=${encodeURIComponent(word)}`, '_blank');
            this.hideWordContextMenu();
        };
        document.getElementById('ctx-search-google').onclick = () => {
            window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(word)}`, '_blank');
            this.hideWordContextMenu();
        };
        document.getElementById('ctx-copy-word').onclick = () => {
            navigator.clipboard.writeText(word);
            window.dispatchEvent(new CustomEvent('showToast', { detail: { message: "단어가 복사되었습니다." } }));
            this.hideWordContextMenu();
        };

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

    hideWordContextMenu() {
        const menu = document.getElementById('word-context-menu');
        if (menu) menu.classList.add('hidden');
    },

    showEditContextMenu(event) {
        let menu = document.getElementById('edit-context-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'edit-context-menu';
            menu.className = 'fixed bg-white border border-gray-200 shadow-xl rounded-lg z-50 hidden';
            document.body.appendChild(menu);
        }
        menu.innerHTML = `<div class="p-2"><button id="edit-context-btn" class="w-full text-left px-4 py-2 hover:bg-gray-100 rounded">✏️ 편집하기</button></div>`;
        const btn = document.getElementById('edit-context-btn');
        btn.onclick = () => {
            learningMode.elements.editContextBtn.click();
            this.hideEditContextMenu();
        };

        const x = event.touches ? event.touches[0].clientX : event.clientX;
        const y = event.touches ? event.touches[0].clientY : event.clientY;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
    },
    hideEditContextMenu() {
        const menu = document.getElementById('edit-context-menu');
        if (menu) menu.classList.add('hidden');
    },
    showCardContextMenu(event) {
        let menu = document.getElementById('card-context-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'card-context-menu';
            menu.className = 'fixed bg-white border border-gray-200 shadow-xl rounded-lg z-50 hidden';
            document.body.appendChild(menu);
        }
        menu.innerHTML = `
            <div class="p-2 flex flex-col gap-1">
                <button id="create-card-btn" class="text-left px-4 py-2 hover:bg-gray-100 rounded">➕ 새 카드 추가</button>
                <button id="delete-card-btn" class="text-left px-4 py-2 hover:bg-red-50 text-red-600 rounded">🗑️ 현재 카드 삭제</button>
            </div>`;
        
        document.getElementById('create-card-btn').onclick = () => { learningMode.createNewCard(); this.hideCardContextMenu(); };
        document.getElementById('delete-card-btn').onclick = () => { learningMode.confirmDeleteCard(); this.hideCardContextMenu(); };

        const x = event.touches ? event.touches[0].clientX : event.clientX;
        const y = event.touches ? event.touches[0].clientY : event.clientY;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
    },
    hideCardContextMenu() {
        const menu = document.getElementById('card-context-menu');
        if (menu) menu.classList.add('hidden');
    }
};
