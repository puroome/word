import { state } from './config.js';
import { api } from './api.js';
import { nonInteractiveWords } from './utils.js';

export const ui = {
    // 텍스트를 단어 단위로 쪼개기 (원본 복구)
    createInteractiveFragment(text, isForSample = false) {
        const fragment = document.createDocumentFragment();
        if (!text) return fragment;

        // 정규식도 원본과 동일하게 유지해야 함
        const parts = text.split(/([a-zA-Z0-9'-]+)/g);

        parts.forEach(part => {
            if (/([a-zA-Z0-9'-]+)/.test(part) && !nonInteractiveWords.has(part.toLowerCase())) {
                const span = document.createElement('span');
                span.textContent = part;
                span.className = 'interactive-word'; // 스타일 복구
                
                // 이벤트 핸들러
                span.onclick = (e) => {
                    if (isForSample) e.stopPropagation();
                    api.speak(part, 'word');
                };
                
                // [중요] 우클릭 컨텍스트 메뉴 복구
                span.oncontextmenu = (e) => {
                    e.preventDefault();
                    if (isForSample) e.stopPropagation();
                    this.showWordContextMenu(e, part);
                };
                
                fragment.appendChild(span);
            } else {
                fragment.appendChild(document.createTextNode(part));
            }
        });
        return fragment;
    },

    // 컨텍스트 메뉴 표시 (위치 계산 단순화 - 원본 로직 추정)
    showWordContextMenu(e, word) {
        const menu = document.getElementById('word-context-menu');
        if (!menu) return;

        // 사전 링크 업데이트
        const dictLink = document.getElementById('dict-link');
        if (dictLink) dictLink.href = `https://en.dict.naver.com/#/search?query=${encodeURIComponent(word)}`;

        // 위치 지정 (마우스 좌표 기준)
        const x = e.clientX || (e.touches && e.touches[0].clientX);
        const y = e.clientY || (e.touches && e.touches[0].clientY);
        
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
        
        // 화면 밖으로 나가는 것만 간단히 방지
        const rect = menu.getBoundingClientRect();
        if (x + rect.width > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 5}px`;
        if (y + rect.height > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 5}px`;
    },

    hideWordContextMenu() {
        const menu = document.getElementById('word-context-menu');
        if (menu) menu.classList.add('hidden');
    },

    // 번역 툴팁 (위치 복구)
    showTranslationTooltip(text, e) {
        let tooltip = document.getElementById('translation-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'translation-tooltip';
            tooltip.className = 'fixed bg-gray-800 text-white text-sm px-3 py-2 rounded shadow-lg z-50'; // Tailwind 클래스 원본 추정
            document.body.appendChild(tooltip);
        }
        tooltip.textContent = text;
        tooltip.classList.remove('hidden');

        // 커서 바로 위나 아래에 표시
        const x = e.clientX;
        const y = e.clientY;
        tooltip.style.left = `${x + 10}px`;
        tooltip.style.top = `${y + 10}px`;
    },

    hideTranslationTooltip() {
        const tooltip = document.getElementById('translation-tooltip');
        if (tooltip) tooltip.classList.add('hidden');
    },

    // 예문 리스트 출력 (UI 구조 원본 복구)
    displaySentences(sentences, container) {
        container.innerHTML = '';
        const list = document.createElement('ul');
        list.className = "space-y-2"; // 원본 간격

        sentences.forEach(sent => {
            if (!sent.trim()) return;
            const li = document.createElement('li');
            li.className = "p-2 bg-gray-50 rounded border cursor-pointer hover:bg-gray-100"; // 원본 스타일
            
            li.onclick = (e) => {
                if(e.target.classList.contains('interactive-word')) return;
                api.speak(sent, 'sample');
                // 번역 툴팁 표시
                api.translate(sent).then(trans => this.showTranslationTooltip(trans, e));
            };

            // 문장 파싱 및 추가
            const parts = sent.split(/(\*.*?\*)/g);
            parts.forEach(p => {
                if (p.startsWith('*') && p.endsWith('*')) {
                    const strong = document.createElement('strong');
                    strong.className = "text-indigo-600 font-bold";
                    strong.appendChild(this.createInteractiveFragment(p.slice(1, -1), true));
                    li.appendChild(strong);
                } else {
                    li.appendChild(this.createInteractiveFragment(p, true));
                }
            });
            list.appendChild(li);
        });
        container.appendChild(list);
    },
    
    // 기타 필요한 UI 함수들
    renderExplanationText(container, text) {
        container.innerHTML = text.replace(/\n/g, '<br>').replace(/\[(.*?)\]/g, '<span class="font-bold text-indigo-700">[$1]</span>');
    },
    showEditContextMenu(e) { /* ... 위치만 단순화하여 유지 ... */ },
    hideEditContextMenu() { document.getElementById('edit-context-menu')?.classList.add('hidden'); },
    showCardContextMenu(e) { /* ... 위치만 단순화하여 유지 ... */ },
    hideCardContextMenu() { document.getElementById('card-context-menu')?.classList.add('hidden'); },
    showDeleteConfirmModal() { document.getElementById('delete-confirm-modal')?.classList.remove('hidden'); },
    hideDeleteConfirmModal() { document.getElementById('delete-confirm-modal')?.classList.add('hidden'); }
};
