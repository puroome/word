import { state } from './config.js';
import { api } from './api.js';
import { nonInteractiveWords } from './utils.js';
import { learningMode } from './learning.js'; 

export const ui = {
    // ============================================================
    // [신규] 서식 편집 툴팁 (여기만 추가됨)
    // ============================================================
    createFormatTooltip() {
        if (document.getElementById('format-tooltip')) return;

        const tooltip = document.createElement('div');
        tooltip.id = 'format-tooltip';
        // 스타일은 style.css에 정의됨
        tooltip.style.display = 'none'; 
        tooltip.style.position = 'absolute';
        tooltip.style.zIndex = '1000';
        tooltip.style.gap = '8px';
        tooltip.style.backgroundColor = 'white';
        tooltip.style.padding = '8px 12px';
        tooltip.style.borderRadius = '8px';
        tooltip.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
        tooltip.style.border = '1px solid #e5e7eb';
        
        const colors = [
            { cmd: '#ef4444', label: '🔴' },
            { cmd: '#3b82f6', label: '🔵' },
            { cmd: '#22c55e', label: '🟢' }
        ];

        colors.forEach(c => {
            const btn = document.createElement('button');
            btn.textContent = c.label;
            btn.style.fontSize = '18px';
            btn.style.cursor = 'pointer';
            btn.style.marginRight = '5px';
            btn.onmousedown = (e) => { 
                e.preventDefault(); 
                document.execCommand('foreColor', false, c.cmd);
                this.hideFormatTooltip();
            };
            tooltip.appendChild(btn);
        });

        const btnClear = document.createElement('button');
        btnClear.textContent = '🚮';
        btnClear.style.fontSize = '18px';
        btnClear.style.cursor = 'pointer';
        btnClear.onmousedown = (e) => {
            e.preventDefault();
            document.execCommand('removeFormat', false, null);
            document.execCommand('foreColor', false, '#000000');
            this.hideFormatTooltip();
        };
        tooltip.appendChild(btnClear);

        document.body.appendChild(tooltip);
    },

    showFormatTooltip(x, y) {
        this.createFormatTooltip();
        const tooltip = document.getElementById('format-tooltip');
        tooltip.style.display = 'flex';
        
        // 위치 조정
        const rect = tooltip.getBoundingClientRect();
        let top = y - rect.height - 10;
        let left = x - (rect.width / 2);
        
        if (top < 10) top = y + 20;
        if (left < 10) left = 10;
        if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 10;

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    },

    hideFormatTooltip() {
        const tooltip = document.getElementById('format-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    },

    // ============================================================
    // [기존 기능 복원] 메뉴 닫기 및 인터랙티브 단어 생성
    // ============================================================

    hideAllMenus() {
        this.hideWordContextMenu();
        this.hideEditContextMenu();
        this.hideCardContextMenu();
        this.hideTranslationTooltip();
        this.hideFormatTooltip(); // 이것만 추가
    },

    createInteractiveFragment(text, isForSampleSentence = false) {
        const fragment = document.createDocumentFragment();
        if (!text || !text.trim()) return fragment;

        // HTML 태그가 이미 포함된 경우(서식 적용된 텍스트) 단순 텍스트 분리 대신 HTML 파싱 필요
        // 하지만 기존 로직 유지를 위해, 태그가 없는 경우만 분리하거나 
        // 태그 내부의 텍스트만 발음 가능하게 하는 복잡한 로직이 필요함.
        // 여기서는 간단히 HTML 태그가 있으면 innerHTML로 처리하고, 클릭 이벤트는 상위에서 위임받거나
        // 서식이 있는 경우 개별 단어 클릭(발음) 기능을 일부 포기하고 서식 보여주기에 집중하는 절충안을 씁니다.
        // *편집된 서식(HTML)이 들어오면 태그를 유지해서 보여줌*
        if (text.includes('<') && text.includes('>')) {
            const span = document.createElement('span');
            span.innerHTML = text; // HTML 태그 그대로 렌더링
            
            // HTML 내부의 텍스트 노드에 대해 클릭 이벤트를 걸어주고 싶지만 복잡하므로
            // 여기서는 통째로 렌더링만 합니다. (서식 우선)
            // 대신 우클릭/클릭 시 전체 문장이나 단어가 잡힐 수 있습니다.
            return span;
        }

        // 기존 로직 (태그가 없는 일반 텍스트)
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
        // [수정] 서식(HTML)이 포함된 경우 그대로 렌더링
        if (text && (text.includes('<b>') || text.includes('span style'))) {
            targetElement.innerHTML = text;
            return;
        }

        // 기존 로직 유지
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

    showWordContextMenu(event, word, options = {}) {
        this.hideAllMenus(); 

        event.preventDefault();
        const menu = document.getElementById('word-context-menu');
        if (!menu) return;

        const touch = event.touches ? event.touches[0] : null;
        const x = touch ? touch.clientX : event.clientX;
        const y = touch ? touch.clientY : event.clientY;
        
        menu.classList.remove('hidden');
        
        // 위치 조정
        const menuRect = menu.getBoundingClientRect();
        let finalX = x;
        let finalY = y;
        if (x + menuRect.width > window.innerWidth - 10) finalX = window.innerWidth - menuRect.width - 10;
        if (y + menuRect.height > window.innerHeight - 10) finalY = window.innerHeight - menuRect.height - 10;
        if (finalX < 10) finalX = 10;
        if (finalY < 10) finalY = 10;
        
        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;

        const encodedWord = encodeURIComponent(word);
        document.getElementById('search-app-context-btn').onclick = () => {
            document.dispatchEvent(new CustomEvent('searchWord', { detail: word }));
            this.hideWordContextMenu();
        };
        document.getElementById('search-daum-context-btn').onclick = () => {
            window.open(`https://dic.daum.net/search.do?q=${encodedWord}`, 'dict_daum');
            this.hideWordContextMenu();
        };
        document.getElementById('search-naver-context-btn').onclick = () => {
            window.open(`https://en.dict.naver.com/#/search?query=${encodedWord}`, 'dict_naver');
            this.hideWordContextMenu();
        };
        document.getElementById('search-etym-context-btn').onclick = () => {
            window.open(`https://www.etymonline.com/search?q=${encodedWord}`, 'dict_etym');
            this.hideWordContextMenu();
        };
        document.getElementById('search-google-img-context-btn').onclick = () => {
            window.open(`https://www.google.com/search?tbm=isch&q=${encodedWord}`, 'dict_google_img');
            this.hideWordContextMenu();
        };
    },
    hideWordContextMenu() {
        const menu = document.getElementById('word-context-menu');
        if (menu) menu.classList.add('hidden');
    },
    
    // ... 나머지 기존 Edit/Card Context Menu 관련 코드 ...
    showEditContextMenu(event) {
        this.hideAllMenus();
        event.preventDefault();
        const menu = document.getElementById('edit-context-menu');
        if (!menu) return;
        const touch = event.touches ? event.touches[0] : null;
        const x = touch ? touch.clientX : event.clientX;
        const y = touch ? touch.clientY : event.clientY;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
    },
    hideEditContextMenu() {
        const menu = document.getElementById('edit-context-menu');
        if (menu) menu.classList.add('hidden');
    },
    showCardContextMenu(event) {
        this.hideAllMenus();
        event.preventDefault();
        const menu = document.getElementById('card-context-menu');
        if (!menu) return;
        const touch = event.touches ? event.touches[0] : null;
        const x = touch ? touch.clientX : event.clientX;
        const y = touch ? touch.clientY : event.clientY;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
    },
    hideCardContextMenu() {
        const menu = document.getElementById('card-context-menu');
        if (menu) menu.classList.add('hidden');
    }
};
