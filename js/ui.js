import { state } from './config.js';
import { api } from './api.js';
import { nonInteractiveWords, utils } from './utils.js';
import { learningMode } from './learning.js';
import { emit } from './events.js';

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

    // 단어 span에 클릭/우클릭/롱프레스(터치) 상호작용을 부착한다.
    // 호출부별 차이는 옵션으로 주입한다.
    //  - onActivate: 클릭/탭 시 동작 (발음 또는 카드 점프 등)
    //  - stopPropagation: 예문 속 단어처럼 상위 클릭으로의 전파를 막을지
    //  - longPressMs: 롱프레스 → 우클릭 컨텍스트 메뉴 임계시간
    //  - passiveTouchStart: touchstart 리스너를 passive로 등록할지
    //  - speakOnTap: 터치 탭(이동 없이 뗌) 시 단어를 발음할지
    _attachWordInteractions(span, word, {
        onActivate,
        stopPropagation = false,
        longPressMs = 800,
        passiveTouchStart = false,
        speakOnTap = false,
    } = {}) {
        span.onclick = (e) => {
            if (stopPropagation) e.stopPropagation();
            clearTimeout(state.longPressTimer);
            onActivate();
        };
        span.oncontextmenu = (e) => {
            e.preventDefault();
            if (stopPropagation) e.stopPropagation();
            this.showWordContextMenu(e, word);
        };
        let touchMove = false;
        span.addEventListener('touchstart', (e) => {
            if (stopPropagation) e.stopPropagation();
            touchMove = false;
            clearTimeout(state.longPressTimer);
            state.longPressTimer = setTimeout(() => {
                if (!touchMove) this.showWordContextMenu(e, word);
            }, longPressMs);
        }, passiveTouchStart ? { passive: true } : undefined);
        span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(state.longPressTimer); });
        span.addEventListener('touchend', () => {
            clearTimeout(state.longPressTimer);
            if (speakOnTap && !touchMove) api.speak(word, 'word');
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
                        this._attachWordInteractions(span, part, {
                            onActivate: () => api.speak(part, 'word'),
                            stopPropagation: isForSampleSentence,
                            longPressMs: 800,
                            speakOnTap: true,
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
            this._attachWordInteractions(span, phrase, {
                onActivate: () => linkedWord ? learningMode.jumpToWord(linkedWord) : api.speak(phrase, 'word'),
                longPressMs: 700,
                passiveTouchStart: true,
            });

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

    // 예문 한 줄(<p>)을 생성: 클릭/호버 시 번역 툴팁 + TTS, *강조*→interactive 단어 분해.
    // 호출부별 차이는 options로 주입한다.
    //  - leadingNode: 문장 앞에 붙일 요소(이모지 span / 🤖 버튼 등)
    //  - getSpeakText(p): 클릭·번역 대상 텍스트(기본: 전달된 sentenceText 그대로)
    //  - shouldIgnoreClick(e): true면 클릭 무시(단어/버튼 클릭 통과용)
    //  - contentCursorText: 본문 span에 cursor:text 적용 여부
    //  - resetTargetOnContentHover: 본문 span hover 시 번역 타깃 해제 여부
    buildSentenceRow(sentenceText, options = {}) {
        const {
            leadingNode = null,
            getSpeakText = () => sentenceText,
            shouldIgnoreClick = () => false,
            contentCursorText = false,
            resetTargetOnContentHover = false,
        } = options;

        const p = document.createElement('p');
        p.className = 'p-2 rounded transition-colors hover:bg-white cursor-pointer relative group shadow-sm hover:shadow';

        const showTranslation = async (event) => {
            state.activeTranslationTarget = p;
            this.showTranslationTooltip("Translating...", event);
            const translatedText = await api.translate(getSpeakText(p));
            if (state.activeTranslationTarget !== p) return;
            this.showTranslationTooltip(translatedText, event);
        };

        p.onclick = (e) => {
            if (shouldIgnoreClick(e)) return;
            api.speak(getSpeakText(p), 'sample');
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

        if (leadingNode) p.appendChild(leadingNode);

        const sentenceContent = document.createElement('span');
        sentenceContent.className = 'sentence-content-area';
        if (contentCursorText) sentenceContent.style.cursor = 'text';

        if (resetTargetOnContentHover) {
            sentenceContent.addEventListener('mouseenter', () => {
                clearTimeout(state.translationTimer);
                if (state.activeTranslationTarget === p) {
                    state.activeTranslationTarget = null;
                }
                this.hideTranslationTooltip();
            });
        }

        sentenceText.split(/(\*.*?\*)/g).forEach(part => {
            if (part.startsWith('*') && part.endsWith('*')) {
                const strong = document.createElement('strong');
                strong.appendChild(this.createInteractiveFragment(part.slice(1, -1), true));
                sentenceContent.appendChild(strong);
            } else if (part) {
                sentenceContent.appendChild(this.createInteractiveFragment(part, true));
            }
        });
        p.appendChild(sentenceContent);

        return p;
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

            const emojiSpan = document.createElement('span');
            emojiSpan.textContent = emojiList[index % emojiList.length];
            emojiSpan.className = 'float-left mr-2 select-none text-xl leading-none mt-1';

            const p = this.buildSentenceRow(sentence, {
                leadingNode: emojiSpan,
                getSpeakText: (p) => p.textContent.replace(/^[\u{1F000}-\u{1F9FF}.]\s*/u, ''),
                shouldIgnoreClick: (e) => e.target.closest('.sentence-content-area .interactive-word'),
                contentCursorText: true,
                resetTargetOnContentHover: true,
            });
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
        document.getElementById('search-app-context-btn').onclick = () => { emit.searchWord(word); this.hideWordContextMenu(); };
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
    // [편집-뒤로가기] '카드 삭제' 모달을 재활용한 예/아니오 확인창 (Promise<boolean> 반환)
    showConfirmModal({ title, message, confirmLabel = '확인', cancelLabel = '취소' }) {
        return new Promise((resolve) => {
            const modal = document.getElementById('nice-alert-modal');
            const titleEl = modal ? modal.querySelector('.nice-modal-title') : null;
            const msgEl = document.getElementById('nice-msg');
            const confirmBtn = document.getElementById('nice-confirm');
            const cancelBtn = document.getElementById('nice-cancel');
            if (!modal || !msgEl || !confirmBtn || !cancelBtn) { resolve(false); return; }

            if (titleEl) titleEl.textContent = title;
            msgEl.innerHTML = message;
            confirmBtn.textContent = confirmLabel;
            cancelBtn.textContent = cancelLabel;
            modal.style.display = 'flex';

            // 사용 후 '카드 삭제' 기본값으로 복원(기존 삭제 확인 흐름 보호)
            const finish = (result) => {
                modal.style.display = 'none';
                if (titleEl) titleEl.textContent = '🗑️ 카드 삭제';
                confirmBtn.textContent = '삭제';
                cancelBtn.textContent = '취소';
                confirmBtn.onclick = null;
                cancelBtn.onclick = null;
                resolve(result);
            };

            confirmBtn.onclick = () => finish(true);
            cancelBtn.onclick = () => finish(false);
        });
    },
    hideCardContextMenu() {
        const menu = document.getElementById('card-context-menu');
        if (menu) menu.classList.add('hidden');
    },
};
