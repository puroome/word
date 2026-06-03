import { state } from './config.js';
import { api } from './api.js';
import { nonInteractiveWords, utils } from './utils.js';
import { learningMode } from './learning.js';

export const ui = {
    hideAllMenus() {
        this.hideWordContextMenu();
        this.hideEditContextMenu();
        this.hideCardContextMenu();
        this.hideTranslationTooltip();
    },

    _getEventCoords(event) {
        const touch = event.touches ? event.touches[0] : null;
        return {
            x: touch ? touch.clientX : event.clientX,
            y: touch ? touch.clientY : event.clientY
        };
    },

    _positionMenu(menu, x, y) {
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            let finalX = x;
            let finalY = y;
            if (x + rect.width > window.innerWidth - 10) finalX = window.innerWidth - rect.width - 10;
            if (y + rect.height > window.innerHeight - 10) finalY = window.innerHeight - rect.height - 10;
            if (finalX < 10) finalX = 10;
            if (finalY < 10) finalY = 10;
            menu.style.left = `${finalX}px`;
            menu.style.top = `${finalY}px`;
        });
    },

    createInteractiveFragment(content, isForSampleSentence = false, treatAsPhrase = false) {
        const fragment = document.createDocumentFragment();
        if (!content || !content.trim()) return fragment;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;

        const walkAndProcess = (node) => {
            if (node.nodeType === 3) {
                const text = node.nodeValue;
                if (!text.trim()) return document.createTextNode(text);

                const textFragment = document.createDocumentFragment();

                const splitRegex = treatAsPhrase
                    ? /(\[.*?\])|([a-zA-Z0-9'-]+(?:[\s'-]*[a-zA-Z0-9'-]+)*)/g
                    : /([a-zA-Z0-9'-]+)/g;

                const parts = text.split(splitRegex);

                parts.forEach(part => {
                    if (!part) return;

                    const isInteractive = treatAsPhrase
                        ? /^[a-zA-Z0-9'-]+(?:[\s'-]*[a-zA-Z0-9'-]+)*$/.test(part)
                        : /([a-zA-Z0-9'-]+)/.test(part);

                    if (isInteractive && !nonInteractiveWords.has(part.toLowerCase())) {
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
                                this.showWordContextMenu(e, part);
                            }, 800);
                        });
                        span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(state.longPressTimer); });
                        span.addEventListener('touchend', () => {
                            clearTimeout(state.longPressTimer);
                            if (!touchMove) api.speak(part, 'word');
                        });

                        textFragment.appendChild(span);
                    } else {
                        textFragment.appendChild(document.createTextNode(part));
                    }
                });
                return textFragment;

            } else if (node.nodeType === 1) {
                const newElement = node.cloneNode(false);
                node.childNodes.forEach(child => {
                    newElement.appendChild(walkAndProcess(child));
                });
                return newElement;
            }
            return node.cloneNode(true);
        };

        tempDiv.childNodes.forEach(child => {
            fragment.appendChild(walkAndProcess(child));
        });

        return fragment;
    },

    renderExplanationText(targetElement, text) {
        const wordMap = utils.getWordIndexMap();
        const currentWordLower = (learningMode.state.currentWordList[learningMode.state.currentIndex]?.word || '').toLowerCase();

        // 설명 속 영어 단어 span 하나를 만들어 반환 (카드로 존재하면 점프 링크로)
        const buildWordSpan = (phrase) => {
            const span = document.createElement('span');
            span.textContent = phrase;

            if (nonInteractiveWords.has(phrase.toLowerCase())) {
                return span; // 기능어는 비활성 텍스트
            }

            const lower = phrase.toLowerCase();
            const linkedWord = (wordMap.has(lower) && lower !== currentWordLower) ? wordMap.get(lower) : null;

            span.className = linkedWord ? 'interactive-word linked-word' : 'interactive-word';

            span.onclick = () => {
                clearTimeout(state.longPressTimer);
                if (linkedWord) {
                    document.dispatchEvent(new CustomEvent('searchWord', { detail: linkedWord }));
                } else {
                    api.speak(phrase, 'word');
                }
            };
            span.oncontextmenu = (e) => { e.preventDefault(); this.showWordContextMenu(e, phrase); };

            let touchMove = false;
            span.addEventListener('touchstart', (e) => {
                touchMove = false;
                clearTimeout(state.longPressTimer);
                state.longPressTimer = setTimeout(() => { if (!touchMove) this.showWordContextMenu(e, phrase); }, 700);
            }, { passive: true });
            span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(state.longPressTimer); });
            span.addEventListener('touchend', () => { clearTimeout(state.longPressTimer); });

            return span;
        };

        targetElement.innerHTML = '';
        if (!text || !text.trim()) return;

        // HTML 태그(색/굵게 등)가 섞인 경우: 텍스트 노드만 골라 단어 분해, 태그 구조는 보존
        if (/<[a-z][\s\S]*>/i.test(text)) {
            const phraseRegex = /(\[.*?\])|([a-zA-Z0-9'-]+(?:[\s'-]*[a-zA-Z0-9'-]+)*)/g;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = text;

            const walk = (node) => {
                if (node.nodeType === 3) { // 텍스트 노드
                    const frag = document.createDocumentFragment();
                    const str = node.nodeValue;
                    let last = 0, m;
                    while ((m = phraseRegex.exec(str))) {
                        if (m.index > last) frag.appendChild(document.createTextNode(str.substring(last, m.index)));
                        const [, bracket, phrase] = m;
                        if (phrase) frag.appendChild(buildWordSpan(phrase));
                        else if (bracket) frag.appendChild(document.createTextNode(bracket));
                        last = phraseRegex.lastIndex;
                    }
                    if (last < str.length) frag.appendChild(document.createTextNode(str.substring(last)));
                    return frag;
                }
                if (node.nodeType === 1) { // 요소 노드: 복제 후 자식 재귀
                    const el = node.cloneNode(false);
                    node.childNodes.forEach(child => el.appendChild(walk(child)));
                    return el;
                }
                return node.cloneNode(true);
            };

            tempDiv.childNodes.forEach(child => targetElement.appendChild(walk(child)));
            return;
        }

        // 평문 경우: 줄 단위로 분해
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
                    targetElement.appendChild(buildWordSpan(englishPhrase));
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

    showWordContextMenu(event, word, options = {}) {
        this.hideAllMenus();
        event.preventDefault();
        const menu = document.getElementById('word-context-menu');
        if (!menu) return;

        const { x, y } = this._getEventCoords(event);
        this._positionMenu(menu, x, y);

        const encodedWord = encodeURIComponent(word);
        document.getElementById('search-app-context-btn').onclick = () => { document.dispatchEvent(new CustomEvent('searchWord', { detail: word })); this.hideWordContextMenu(); };
        document.getElementById('search-daum-context-btn').onclick = () => { window.open(`https://dic.daum.net/search.do?q=${encodedWord}`, 'dict_daum'); this.hideWordContextMenu(); };
        document.getElementById('search-naver-context-btn').onclick = () => { window.open(`https://en.dict.naver.com/#/search?query=${encodedWord}`, 'dict_naver'); this.hideWordContextMenu(); };
        document.getElementById('search-etym-context-btn').onclick = () => { window.open(`https://www.etymonline.com/search?q=${encodedWord}`, 'dict_etym'); this.hideWordContextMenu(); };
        document.getElementById('search-longman-context-btn').onclick = () => { window.open(`https://www.ldoceonline.com/dictionary/${encodedWord}`, 'dict_longman'); this.hideWordContextMenu(); };
    },
    hideWordContextMenu() {
        const menu = document.getElementById('word-context-menu');
        if (menu) menu.classList.add('hidden');
    },

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

    showCardContextMenu(event) {
        this.hideAllMenus();

        const menu = document.getElementById('card-context-menu');
        if (!menu) return;

        const currentWord = learningMode.state.currentWordList[learningMode.state.currentIndex];
        const deleteBtn = document.getElementById('delete-card-btn');

        if (deleteBtn && currentWord) {
            deleteBtn.onclick = () => {
                this.hideAllMenus();
                this.showDeleteConfirm(currentWord);
            };
        }

        const { x, y } = this._getEventCoords(event);
        this._positionMenu(menu, x, y);
    },

    showDeleteConfirm(currentWord) {
        const modal = document.getElementById('nice-alert-modal');
        const msgEl = document.getElementById('nice-msg');
        const confirmBtn = document.getElementById('nice-confirm');
        const cancelBtn = document.getElementById('nice-cancel');
        if (!modal || !msgEl || !confirmBtn || !cancelBtn) return;

        msgEl.innerHTML = `'<b>${currentWord.word}</b>' 단어를<br>정말 삭제하시겠습니까?`;
        modal.style.display = 'flex';

        cancelBtn.onclick = () => { modal.style.display = 'none'; };

        confirmBtn.onclick = async () => {
            modal.style.display = 'none';

            await api.deleteWord(currentWord.word);

            const currentList = learningMode.state.currentWordList;
            learningMode.state.currentWordList = currentList.filter(w => w.word !== currentWord.word);

            if (learningMode.state.currentIndex >= learningMode.state.currentWordList.length) {
                learningMode.state.currentIndex = Math.max(0, learningMode.state.currentWordList.length - 1);
            }

            if (learningMode.state.currentWordList.length === 0) {
                alert("모든 단어가 삭제되었습니다.");
                location.reload();
            } else {
                learningMode.displayWord(learningMode.state.currentIndex, true);
            }
        };
    },
    hideCardContextMenu() {
        const menu = document.getElementById('card-context-menu');
        if (menu) menu.classList.add('hidden');
    },
};
