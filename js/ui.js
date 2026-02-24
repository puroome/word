import { state } from './config.js';
import { api } from './api.js';
import { nonInteractiveWords } from './utils.js';
import { learningMode } from './learning.js';

export const ui = {
  hideAllMenus() {
    this.hideWordContextMenu();
    this.hideEditContextMenu();
    this.hideCardContextMenu();
    this.hideTranslationTooltip();
  },

  _positionMenu(menu, x, y) {
    menu.style.left = '0px';
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

  createInteractiveFragment(content, isForSampleSentence = false, treatAsPhrase = false) {
    const fragment = document.createDocumentFragment();
    if (!content || !content.trim()) return fragment;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;

    const walkAndProcess = node => {
      if (node.nodeType === 3) {
        const text = node.nodeValue;
        if (!text.trim()) return document.createTextNode(text);
        const textFragment = document.createDocumentFragment();
        const splitRegex = treatAsPhrase
          ? /((?:[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*))/g
          : /([a-zA-Z0-9-]+)/g;
        const parts = text.split(splitRegex);
        parts.forEach(part => {
          if (!part) return;
          const isInteractive = treatAsPhrase
            ? /[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)?/.test(part)
            : /[a-zA-Z0-9-]/.test(part);
          if (isInteractive && !nonInteractiveWords.has(part.toLowerCase())) {
            const span = document.createElement('span');
            span.textContent = part;
            span.className = 'interactive-word';
            span.onclick = e => {
              if (isForSampleSentence) e.stopPropagation();
              clearTimeout(state.longPressTimer);
              api.speak(part, 'word');
            };
            span.oncontextmenu = e => {
              e.preventDefault();
              if (isForSampleSentence) e.stopPropagation();
              this.showWordContextMenu(e, part);
            };
            let touchMove = false;
            span.addEventListener('touchstart', e => {
              if (isForSampleSentence) e.stopPropagation();
              touchMove = false;
              state.longPressTimer = setTimeout(() => this.showWordContextMenu(e, part), 800);
            });
            span.addEventListener('touchmove', () => {
              touchMove = true;
              clearTimeout(state.longPressTimer);
            });
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
        node.childNodes.forEach(child => newElement.appendChild(walkAndProcess(child)));
        return newElement;
      }
      return node.cloneNode(true);
    };

    tempDiv.childNodes.forEach(child => fragment.appendChild(walkAndProcess(child)));
    return fragment;
  },

  renderExplanationText(targetElement, text) {
    targetElement.innerHTML = '';
    if (!text || !text.trim()) return;
    if (/^[a-z]/i.test(text)) {
      targetElement.appendChild(this.createInteractiveFragment(text, false, true));
      return;
    }
    text.split('\n').forEach((line, lineIndex, lineArr) => {
      const regex = /([^a-zA-Z0-9]*)([a-zA-Z0-9]+(?:[-'][a-zA-Z0-9]+)*)/g;
      let lastIndex = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          targetElement.appendChild(document.createTextNode(line.substring(lastIndex, match.index)));
        }
        const [, nonClickable, englishPhrase] = match;
        if (nonClickable) targetElement.appendChild(document.createTextNode(nonClickable));
        if (englishPhrase) {
          const span = document.createElement('span');
          span.textContent = englishPhrase;
          if (!nonInteractiveWords.has(englishPhrase.toLowerCase())) {
            span.className = 'interactive-word';
            span.onclick = () => { clearTimeout(state.longPressTimer); api.speak(englishPhrase, 'word'); };
            span.oncontextmenu = e => { e.preventDefault(); this.showWordContextMenu(e, englishPhrase); };
            let touchMove = false;
            span.addEventListener('touchstart', e => {
              touchMove = false;
              clearTimeout(state.longPressTimer);
              state.longPressTimer = setTimeout(() => {
                if (!touchMove) this.showWordContextMenu(e, englishPhrase);
              }, 700);
            }, { passive: true });
            span.addEventListener('touchmove', () => { touchMove = true; clearTimeout(state.longPressTimer); });
            span.addEventListener('touchend', () => { clearTimeout(state.longPressTimer); });
          }
          targetElement.appendChild(span);
        }
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < line.length) targetElement.appendChild(document.createTextNode(line.substring(lastIndex)));
      if (lineIndex < lineArr.length - 1) targetElement.appendChild(document.createElement('br'));
    });
  },

  displaySentences(sentences, containerElement) {
    containerElement.innerHTML = '';
    const emojiList = ['📚','💡','📝','🌟','✨','🎯','🔍','💬','🎓','📖','🌱','🔥','💪','🎉','🌈','🎨','🌺','🌎'];
    sentences.forEach((sentence, index) => {
      if (!sentence || !sentence.trim()) {
        const spacer = document.createElement('div');
        spacer.className = 'h-6 w-full';
        containerElement.appendChild(spacer);
        return;
      }
      const p = document.createElement('p');
      p.className = 'p-2 rounded transition-colors hover:bg-gray-200 cursor-pointer relative group';

      const showTranslation = async event => {
        state.activeTranslationTarget = p;
        this.showTranslationTooltip('Translating...', event);
        const translatedText = await api.translate(p.textContent.replace(/[\u{1F000}-\u{1F9FF}]/u, ''));
        if (state.activeTranslationTarget !== p) return;
        this.showTranslationTooltip(translatedText, event);
      };

      p.onclick = e => {
        if (e.target.closest('.sentence-content-area .interactive-word')) return;
        api.speak(p.textContent.replace(/[\u{1F000}-\u{1F9FF}]/u, ''), 'sample');
        showTranslation(e);
      };
      p.addEventListener('mouseenter', e => {
        if (e.target !== p) return;
        clearTimeout(state.translationTimer);
        state.activeTranslationTarget = p;
        state.translationTimer = setTimeout(() => {
          if (state.activeTranslationTarget === p) showTranslation(e);
        }, 1000);
      });
      p.addEventListener('mouseleave', () => {
        clearTimeout(state.translationTimer);
        if (state.activeTranslationTarget === p) {
          state.activeTranslationTarget = null;
          this.hideTranslationTooltip();
        }
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
          this.hideTranslationTooltip();
        }
      });

      const sentenceParts = sentence.split(/(\*[^*]+\*)/g);
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
    if (!tooltip) return;
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
      if (tooltipRect.right > window.innerWidth - 10)
        tooltip.style.left = `${window.innerWidth - tooltipRect.width - 10}px`;
      if (left < 10) tooltip.style.left = '10px';
    });
  },

  hideTranslationTooltip() {
    const tooltip = document.getElementById('translation-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
  },

  showWordContextMenu(event, word, options = {}) {
    this.hideAllMenus();
    event.preventDefault();
    const menu = document.getElementById('word-context-menu');
    if (!menu) return;
    const touch = event.touches ? event.touches[0] : null;
    const x = touch ? touch.clientX : event.clientX;
    const y = touch ? touch.clientY : event.clientY;
    this._positionMenu(menu, x, y);
    const encodedWord = encodeURIComponent(word);
    document.getElementById('search-app-context-btn').onclick = () => {
      document.dispatchEvent(new CustomEvent('searchWord', { detail: word }));
      this.hideWordContextMenu();
    };
    document.getElementById('search-daum-context-btn').onclick = () => {
      window.open(`https://dic.daum.net/search.do?q=${encodedWord}`, 'dictdaum');
      this.hideWordContextMenu();
    };
    document.getElementById('search-naver-context-btn').onclick = () => {
      window.open(`https://en.dict.naver.com/search?query=${encodedWord}`, 'dictnaver');
      this.hideWordContextMenu();
    };
    document.getElementById('search-etym-context-btn').onclick = () => {
      window.open(`https://www.etymonline.com/search?q=${encodedWord}`, 'dictetym');
      this.hideWordContextMenu();
    };
    document.getElementById('search-longman-context-btn').onclick = () => {
      window.open(`https://www.ldoceonline.com/dictionary/${encodedWord}`, 'dictlongman');
      this.hideWordContextMenu();
    };
  },

  hideWordContextMenu() {
    const menu = document.getElementById('word-context-menu');
    if (menu) menu.classList.add('hidden');
  },

  showEditContextMenu(event) {
    this.hideAllMenus();
    const menu = document.getElementById('edit-context-menu');
    if (!menu) return;
    const touch = event.touches ? event.touches[0] : null;
    const x = touch ? touch.clientX : event.clientX;
    const y = touch ? touch.clientY : event.clientY;
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
    let deleteBtn = document.getElementById('delete-card-btn');
    if (deleteBtn && currentWord) {
      const newDeleteBtn = deleteBtn.cloneNode(true);
      deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
      deleteBtn = newDeleteBtn;
      deleteBtn.onclick = () => {
        this.hideAllMenus();
        if (!document.getElementById('nice-alert-modal')) {
          const style = document.createElement('style');
          style.innerHTML = `
            .nice-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:9999;backdrop-filter:blur(2px)}
            .nice-modal-box{background:white;padding:24px;border-radius:16px;width:85%;max-width:300px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.2);animation:popIn 0.2s ease-out}
            .nice-modal-title{font-size:1.2rem;font-weight:bold;margin-bottom:8px;color:#1f2937}
            .nice-modal-desc{color:#4b5563;margin-bottom:20px;line-height:1.5;font-size:1rem}
            .nice-modal-btns{display:flex;gap:10px}
            .nice-btn{flex:1;padding:12px;border:none;border-radius:10px;font-weight:bold;cursor:pointer;transition:.1s;font-size:1rem}
            .nice-btn:active{transform:scale(0.96)}
            .nice-btn-cancel{background:#f3f4f6;color:#4b5563}
            .nice-btn-del{background:#ef4444;color:white;box-shadow:0 4px 10px rgba(239,68,68,0.3)}
            @keyframes popIn{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}`;
          document.head.appendChild(style);
          document.body.insertAdjacentHTML('beforeend', `
            <div id="nice-alert-modal" class="nice-modal-overlay" style="display:none">
              <div class="nice-modal-box">
                <div class="nice-modal-title">단어 삭제</div>
                <div id="nice-msg" class="nice-modal-desc"></div>
                <div class="nice-modal-btns">
                  <button id="nice-cancel" class="nice-btn nice-btn-cancel">취소</button>
                  <button id="nice-confirm" class="nice-btn nice-btn-del">삭제</button>
                </div>
              </div>
            </div>`);
        }
        const modal = document.getElementById('nice-alert-modal');
        const msgEl = document.getElementById('nice-msg');
        const confirmBtn = document.getElementById('nice-confirm');
        const cancelBtn = document.getElementById('nice-cancel');
        msgEl.innerHTML = `<b>${currentWord.word}</b><br>정말 삭제하시겠습니까?`;
        modal.style.display = 'flex';
        const newConfirm = confirmBtn.cloneNode(true);
        const newCancel = cancelBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
        newCancel.onclick = () => { modal.style.display = 'none'; };
        newConfirm.onclick = async () => {
          modal.style.display = 'none';
          await api.deleteWord(currentWord.word);
          const currentList = learningMode.state.currentWordList;
          learningMode.state.currentWordList = currentList.filter(w => w.word !== currentWord.word);
          if (learningMode.state.currentIndex >= learningMode.state.currentWordList.length) {
            learningMode.state.currentIndex = Math.max(0, learningMode.state.currentWordList.length - 1);
          }
          if (learningMode.state.currentWordList.length === 0) {
            window.dispatchEvent(new CustomEvent('showToast', { detail: { message: '모든 단어가 삭제되었습니다.' } }));
            window.dispatchEvent(new CustomEvent('navigate', { detail: { mode: 'selection' } }));
          } else {
            learningMode.displayWord(learningMode.state.currentIndex, true);
          }
        };
      };
    }
    const touch = event.touches ? event.touches[0] : null;
    const x = touch ? touch.clientX : event.clientX;
    const y = touch ? touch.clientY : event.clientY;
    this._positionMenu(menu, x, y);
  },

  hideCardContextMenu() {
    const menu = document.getElementById('card-context-menu');
    if (menu) menu.classList.add('hidden');
  },
};
