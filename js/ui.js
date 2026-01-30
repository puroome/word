import { state } from './config.js';
import { api } from './api.js';
import { nonInteractiveWords } from './utils.js';

export const ui = {
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
                    state.longPressTimer = setTimeout(() => {
                        if (!touchMove) this.showWordContextMenu(e, part);
                    }, 500);
                }, { passive: true });
                span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(state.longPressTimer); }, { passive: true });
                span.addEventListener('touchend', () => clearTimeout(state.longPressTimer));

                fragment.appendChild(span);
            } else {
                fragment.appendChild(document.createTextNode(part));
            }
        });

        return fragment;
    },

    renderExplanationText(container, explanation) {
        if (!container || !explanation) return;
        container.innerHTML = '';
        const parts = explanation.split(/(\*.*?\*)/g);
        parts.forEach(part => {
            if (part.startsWith('*') && part.endsWith('*')) {
                const strong = document.createElement('strong');
                strong.appendChild(this.createInteractiveFragment(part.slice(1, -1)));
                container.appendChild(strong);
            } else {
                container.appendChild(this.createInteractiveFragment(part));
            }
        });
    },

    displaySentences(sentences, container) {
        if (!container) return;
        container.innerHTML = '';
        sentences.forEach(sent => {
            if (sent.trim()) {
                const p = document.createElement('p');
                p.className = 'p-2 rounded transition-colors hover:bg-gray-200 cursor-pointer relative group';
                
                const showTranslation = async (event) => {
                    state.activeTranslationTarget = p;
                    const translatedText = await api.translate(sent);
                    if (state.activeTranslationTarget !== p) return;
                    this.showTranslationTooltip(translatedText, event);
                };

                p.onclick = (e) => {
                    if (e.target.closest('.interactive-word')) return;
                    api.speak(sent, 'sample');
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

                p.appendChild(this.createInteractiveFragment(sent, true));
                container.appendChild(p);
            }
        });
    },

    showTranslationTooltip(text, event) {
        let tooltip = document.getElementById('translation-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'translation-tooltip';
            document.body.appendChild(tooltip);
        }

        tooltip.textContent = text;
        tooltip.classList.remove('hidden');

        const isTouch = event.touches && event.touches.length > 0;
        const clientX = isTouch ? event.touches[0].clientX : event.clientX;
        const clientY = isTouch ? event.touches[0].clientY : event.clientY;

        const rect = tooltip.getBoundingClientRect();
        let top = clientY - rect.height - 10;
        let left = clientX - (rect.width / 2);

        if (top < 10) top = clientY + 20;
        if (left < 10) left = 10;
        if (left + rect.width > window.innerWidth - 10) left = window.innerWidth - rect.width - 10;

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    },

    hideTranslationTooltip() {
        const tooltip = document.getElementById('translation-tooltip');
        if (tooltip) tooltip.classList.add('hidden');
    },

    showWordContextMenu(event, word) {
        const menu = document.getElementById('word-context-menu');
        const contextWordSpan = document.getElementById('context-word');
        const contextMeaningBtn = document.getElementById('context-meaning-btn');
        const contextNaverBtn = document.getElementById('context-naver-btn');

        if (menu && contextWordSpan) {
            contextWordSpan.textContent = word;
            
            // 이벤트 리스너 중복 방지를 위한 클론 노드 교체
            const newMeaningBtn = contextMeaningBtn.cloneNode(true);
            const newNaverBtn = contextNaverBtn.cloneNode(true);
            
            contextMeaningBtn.parentNode.replaceChild(newMeaningBtn, contextMeaningBtn);
            contextNaverBtn.parentNode.replaceChild(newNaverBtn, contextNaverBtn);

            newMeaningBtn.addEventListener('click', () => {
                 window.open(`https://en.dict.naver.com/#/search?query=${encodeURIComponent(word)}`, '_blank');
                 this.hideWordContextMenu();
            });

            newNaverBtn.addEventListener('click', () => {
                 window.open(`https://search.naver.com/search.naver?query=${encodeURIComponent(word)}`, '_blank');
                 this.hideWordContextMenu();
            });

            const isTouch = event.touches && event.touches.length > 0;
            const x = isTouch ? event.touches[0].clientX : event.clientX;
            const y = isTouch ? event.touches[0].clientY : event.clientY;

            menu.style.left = `${x}px`;
            menu.style.top = `${y}px`;
            menu.classList.remove('hidden');

            // 화면 밖으로 나가는 것 방지
            requestAnimationFrame(() => {
                const menuRect = menu.getBoundingClientRect();
                let finalX = x;
                let finalY = y;

                if (x + menuRect.width > window.innerWidth - 10) finalX = window.innerWidth - menuRect.width - 10;
                if (y + menuRect.height > window.innerHeight - 10) finalY = window.innerHeight - menuRect.height - 10;
                
                menu.style.left = `${finalX}px`;
                menu.style.top = `${finalY}px`;
            });
        }
    },

    hideWordContextMenu() {
        const menu = document.getElementById('word-context-menu');
        if (menu) menu.classList.add('hidden');
    },

    showEditContextMenu(event) {
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
        const menu = document.getElementById('card-context-menu');
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

    hideCardContextMenu() {
        const menu = document.getElementById('card-context-menu');
        if (menu) menu.classList.add('hidden');
    },

    showDeleteConfirmModal() {
        const modal = document.getElementById('delete-confirm-modal');
        if (modal) modal.classList.remove('hidden');
    },

    hideDeleteConfirmModal() {
        const modal = document.getElementById('delete-confirm-modal');
        if (modal) modal.classList.add('hidden');
    },

    // [신규 기능] 알림 토스트 메시지 표시
    showToast(message, isError = false) {
        let toast = document.getElementById('ui-toast-message');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ui-toast-message';
            toast.className = 'fixed bottom-24 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-full shadow-lg text-white font-semibold transition-opacity duration-300 z-50 pointer-events-none opacity-0';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        if (isError) {
            toast.classList.remove('bg-gray-800');
            toast.classList.add('bg-red-500');
        } else {
            toast.classList.remove('bg-red-500');
            toast.classList.add('bg-gray-800');
        }

        toast.classList.remove('opacity-0');
        
        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        this.toastTimeout = setTimeout(() => {
            toast.classList.add('opacity-0');
        }, 2500);
    }
};
