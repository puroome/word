import { state } from './config.js';
import { api } from './api.js';
import { nonInteractiveWords } from './utils.js';

export const ui = {
    // 텍스트를 클릭 가능한 단어 단위로 쪼개기 (이벤트 리스너 연결)
    createInteractiveFragment(text, isForSampleSentence = false) {
        const fragment = document.createDocumentFragment();
        if (!text || !text.trim()) return fragment;

        // 알파벳, 숫자, 따옴표, 하이픈이 포함된 단어 분리
        const parts = text.split(/([a-zA-Z0-9'-]+)/g);

        parts.forEach(part => {
            if (/([a-zA-Z0-9'-]+)/.test(part) && !nonInteractiveWords.has(part.toLowerCase())) {
                const span = document.createElement('span');
                span.textContent = part;
                span.className = 'interactive-word cursor-pointer hover:text-blue-600 active:text-blue-800 transition-colors';
                
                // 클릭: TTS 재생
                span.onclick = (e) => {
                    if (isForSampleSentence) e.stopPropagation();
                    clearTimeout(state.longPressTimer);
                    api.speak(part, 'word');
                };

                // 우클릭: 단어 메뉴 (사전/즐겨찾기 등)
                span.oncontextmenu = (e) => {
                    e.preventDefault();
                    if (isForSampleSentence) e.stopPropagation();
                    this.showWordContextMenu(e, part);
                };

                // 모바일 롱프레스 대응
                let touchMove = false;
                span.addEventListener('touchstart', (e) => {
                    if (isForSampleSentence) e.stopPropagation();
                    touchMove = false;
                    state.longPressTimer = setTimeout(() => {
                        if (!touchMove) this.showWordContextMenu(e, part);
                    }, 500);
                }, { passive: true });

                span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(state.longPressTimer); }, { passive: true });
                span.addEventListener('touchend', () => clearTimeout(state.longPressTimer));
                span.addEventListener('touchcancel', () => clearTimeout(state.longPressTimer));

                fragment.appendChild(span);
            } else {
                // 비상호작용 텍스트 (공백, 특수문자 등)
                fragment.appendChild(document.createTextNode(part));
            }
        });

        return fragment;
    },

    // 설명 텍스트 렌더링 (대괄호[] 처리)
    renderExplanationText(container, text) {
        if (!container) return;
        container.innerHTML = '';
        if (!text) {
            container.innerHTML = '<span class="text-gray-400">설명이 없습니다.</span>';
            return;
        }

        const lines = text.split('\n');
        lines.forEach(line => {
            const p = document.createElement('p');
            p.className = 'mb-1 leading-relaxed text-gray-700';
            
            // [text] 형태를 굵게 표시
            const parts = line.split(/(\[.*?\])/g);
            parts.forEach(part => {
                if (part.startsWith('[') && part.endsWith(']')) {
                    const span = document.createElement('span');
                    span.className = 'font-bold text-indigo-700 bg-indigo-50 px-1 rounded';
                    span.textContent = part; // 괄호 포함 표시
                    p.appendChild(span);
                } else {
                    p.appendChild(document.createTextNode(part));
                }
            });
            container.appendChild(p);
        });
    },

    // 예문 리스트 출력
    displaySentences(sentences, container) {
        if (!container) return;
        container.innerHTML = ''; // 초기화

        const list = document.createElement('ul');
        list.className = "space-y-3 text-left w-full";

        sentences.forEach(sentenceText => {
            if (!sentenceText.trim()) return;

            const li = document.createElement('li');
            li.className = "p-3 bg-gray-50 rounded-lg border border-gray-100 hover:bg-white hover:shadow-md transition-all duration-200 cursor-pointer group";
            
            // 문장 전체 듣기 및 번역 툴팁
            const showTranslation = async (event) => {
                state.activeTranslationTarget = li;
                const translatedText = await api.translate(sentenceText);
                if (state.activeTranslationTarget !== li) return;
                this.showTranslationTooltip(translatedText, event);
            };

            li.onclick = (e) => {
                // 인터랙티브 단어 클릭 시 상위 이벤트 무시
                if (e.target.classList.contains('interactive-word')) return;
                api.speak(sentenceText, 'sample');
                showTranslation(e);
            };

            // 마우스 호버 번역 (PC용)
            li.addEventListener('mouseenter', (e) => {
                if(e.target === li) {
                    clearTimeout(state.translationTimer);
                    state.activeTranslationTarget = li;
                    state.translationTimer = setTimeout(() => {
                        if (state.activeTranslationTarget === li) showTranslation(e);
                    }, 800);
                }
            });

            li.addEventListener('mouseleave', () => {
                clearTimeout(state.translationTimer);
                if (state.activeTranslationTarget === li) state.activeTranslationTarget = null;
                this.hideTranslationTooltip();
            });

            // 문장 내부 단어 처리 (*강조* 구문 지원)
            const parts = sentenceText.split(/(\*.*?\*)/g);
            parts.forEach(part => {
                if (part.startsWith('*') && part.endsWith('*')) {
                    const strong = document.createElement('strong');
                    strong.className = "text-indigo-600 font-bold bg-indigo-50 px-1 rounded";
                    strong.appendChild(this.createInteractiveFragment(part.slice(1, -1), true));
                    li.appendChild(strong);
                } else {
                    li.appendChild(this.createInteractiveFragment(part, true));
                }
            });

            list.appendChild(li);
        });

        container.appendChild(list);
    },

    // ================================================================
    // Tooltip & Context Menus
    // ================================================================

    showTranslationTooltip(text, event) {
        let tooltip = document.getElementById('translation-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'translation-tooltip';
            tooltip.className = 'fixed bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-xl z-[100] max-w-xs transition-opacity duration-200 opacity-0 pointer-events-none';
            document.body.appendChild(tooltip);
        }

        tooltip.textContent = text;
        tooltip.classList.remove('hidden');
        
        // 위치 계산 (터치/마우스)
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;

        // 화면 밖으로 나가지 않도록 보정
        requestAnimationFrame(() => {
            const rect = tooltip.getBoundingClientRect();
            let top = clientY - rect.height - 15;
            let left = clientX - rect.width / 2;

            if (top < 10) top = clientY + 20; // 위쪽 공간 없으면 아래로
            if (left < 10) left = 10; // 왼쪽 화면 밖 방지
            if (left + rect.width > window.innerWidth - 10) left = window.innerWidth - rect.width - 10; // 오른쪽 화면 밖 방지

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
            tooltip.style.opacity = '1';
        });
    },

    hideTranslationTooltip() {
        const tooltip = document.getElementById('translation-tooltip');
        if (tooltip) {
            tooltip.style.opacity = '0';
            setTimeout(() => tooltip.classList.add('hidden'), 200);
        }
    },

    // 공통 메뉴 위치 보정 함수
    adjustMenuPosition(menu, x, y) {
        menu.classList.remove('hidden');
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            let finalX = x;
            let finalY = y;

            if (x + rect.width > window.innerWidth - 5) finalX = window.innerWidth - rect.width - 5;
            if (y + rect.height > window.innerHeight - 5) finalY = window.innerHeight - rect.height - 5;
            
            menu.style.left = `${Math.max(5, finalX)}px`;
            menu.style.top = `${Math.max(5, finalY)}px`;
        });
    },

    showWordContextMenu(event, word) {
        const menu = document.getElementById('word-context-menu');
        if (!menu) return;

        // 사전 링크 설정
        const dictLink = document.getElementById('dict-link');
        if (dictLink) dictLink.href = `https://en.dict.naver.com/#/search?query=${encodeURIComponent(word)}`;

        // 삭제 버튼 (옵션)
        const delBtn = document.getElementById('context-delete-word-btn');
        if (delBtn) {
            delBtn.onclick = async () => {
                if (confirm(`'${word}' 단어를 삭제하시겠습니까?`)) {
                    await api.deleteWord(word);
                    this.hideWordContextMenu();
                }
            };
        }

        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;

        this.adjustMenuPosition(menu, clientX, clientY);
    },

    hideWordContextMenu() {
        const menu = document.getElementById('word-context-menu');
        if (menu) menu.classList.add('hidden');
    },

    showEditContextMenu(event) {
        const menu = document.getElementById('edit-context-menu');
        if (!menu) return;

        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;

        this.adjustMenuPosition(menu, clientX, clientY);
    },

    hideEditContextMenu() {
        const menu = document.getElementById('edit-context-menu');
        if (menu) menu.classList.add('hidden');
    },

    showCardContextMenu(event) {
        const menu = document.getElementById('card-context-menu');
        if (!menu) return;

        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;

        this.adjustMenuPosition(menu, clientX, clientY);
    },

    hideCardContextMenu() {
        const menu = document.getElementById('card-context-menu');
        if (menu) menu.classList.add('hidden');
    },

    // 삭제 확인 모달
    showDeleteConfirmModal() {
        const modal = document.getElementById('delete-confirm-modal');
        if (modal) modal.classList.remove('hidden');
    },

    hideDeleteConfirmModal() {
        const modal = document.getElementById('delete-confirm-modal');
        if (modal) modal.classList.add('hidden');
    }
};
