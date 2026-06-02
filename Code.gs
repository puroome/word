const GEMINI_MODEL_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const WORDS_SHEET_NAME = 'Words';

function getFirebaseConfig() {
  const props = PropertiesService.getScriptProperties();
  const url    = props.getProperty('FIREBASE_URL');
  const secret = props.getProperty('FIREBASE_SECRET');
  if (!url || !secret) throw new Error("FIREBASE_URL / FIREBASE_SECRET 이 설정되지 않았습니다. setupProperties()를 실행하세요.");
  return { url, secret };
}

function getGeminiApiKey() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error("GEMINI_API_KEY 가 설정되지 않았습니다. setupProperties()를 실행하세요.");
  return key;
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    let result;

    switch (action) {
      case 'translate':             result = handleTranslate(e);           break;
      case 'generate_ai_examples':  result = handleGenerateAiExamples(e);  break;
      case 'fetch_word_info_from_ai': result = handleFetchWordInfoFromAi(e); break;
      case 'save_ai_sample':        result = handleSaveAiSample(e);        break;
      case 'update_word_data':      result = handleUpdateWordData(e);      break;
      case 'create_word':           result = handleCreateWord(e);          break;
      case 'delete_word':           result = handleDeleteWord(e);          break;
      case 'toggle_except':         result = handleToggleExcept(e);        break;

      default:
        throw new Error(`지원하지 않는 action: "${action}"`);
    }

    return jsonResponse(result);
  } catch (err) {
    console.error('[doGet] 오류:', err.message);
    return jsonResponse({ success: false, message: err.message });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


function getSheet(sheetName = WORDS_SHEET_NAME) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error(`'${sheetName}' 시트를 찾을 수 없습니다.`);
  return sheet;
}

function buildHeaderMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    if (h) map[h.toString().trim().toLowerCase().replace(/\s/g, '')] = i;
  });
  return map;
}

function findRowByWord(sheet, wordColIndex, wordToFind) {
  if (!wordToFind) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const found = sheet
    .getRange(2, wordColIndex + 1, lastRow - 1, 1)
    .createTextFinder(wordToFind)
    .matchEntireCell(true)
    .findNext();
  return found ? found.getRow() : -1;
}

function callGeminiApi(prompt) {
  const apiKey = getGeminiApiKey();
  const response = UrlFetchApp.fetch(`${GEMINI_MODEL_URL}?key=${apiKey}`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    muteHttpExceptions: true,
  });
    if (response.getResponseCode() !== 200) {
      throw new Error(`Gemini API 오류 ${response.getResponseCode()}: ${response.getContentText()}`);
    }
    return JSON.parse(response.getContentText()).candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function parseGeminiJson(rawText) {
  // 1. 마크다운 코드 블록 제거
  let cleaned = rawText.replace(/```(json)?\s*|```/gi, '').trim();

  try {
    // 2. 깔끔하게 바로 파싱되는 경우 우선 시도
    return JSON.parse(cleaned);
  } catch (e) {
    // 3. 텍스트가 섞여 있어서 실패한 경우, 정확히 '{' 와 '}' 사이(또는 '[' 와 ']')만 추출
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');

    let start = -1, end = -1;
    if (firstBrace !== -1 && lastBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace; end = lastBrace;
    } else if (firstBracket !== -1 && lastBracket !== -1) {
      start = firstBracket; end = lastBracket;
    }

    if (start !== -1 && end !== -1) {
      try {
        return JSON.parse(cleaned.substring(start, end + 1));
      } catch (err) {
        throw new Error('추출된 데이터 파싱 실패: ' + err.message);
      }
    }
    throw new Error('AI 응답에서 유효한 JSON을 찾을 수 없습니다.');
  }
}

function callFirebaseRtdb(path, method, payload) {
  const { url, secret } = getFirebaseConfig();
  const options = {
    method: method,
    contentType: 'application/json',
    muteHttpExceptions: true,
  };
  if (payload !== undefined) options.payload = JSON.stringify(payload);

  const response = UrlFetchApp.fetch(`${url}/${path}.json?auth=${secret}`, options);
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Firebase 오류 ${code}: ${response.getContentText()}`);
  }
  const text = response.getContentText();
  return text ? JSON.parse(text) : null;
}

function toFirebaseKey(word) {
  return word.replace(/[.#$[\]/]/g, '_');
}

function patchWordInFirebase(word, fields) {
  try {
    callFirebaseRtdb(`vocabulary/${toFirebaseKey(word)}`, 'PATCH', fields);
  } catch (e) {
    console.warn(`Firebase PATCH 실패 (${word}):`, e.message);
  }
}

function deleteWordFromFirebase(word) {
  try {
    callFirebaseRtdb(`vocabulary/${toFirebaseKey(word)}`, 'DELETE');
  } catch (e) {
    console.warn(`Firebase DELETE 실패 (${word}):`, e.message);
  }
}


function handleTranslate(e) {
  const text = e.parameter.text;
  if (!text) throw new Error('번역할 텍스트가 없습니다.');
  const translatedText = LanguageApp.translate(text, 'en', 'ko');
  return { success: true, translatedText };
}


function handleGenerateAiExamples(e) {
  const word  = e.parameter.word;
  const count = parseInt(e.parameter.count || '2', 10);
  if (!word) throw new Error('단어가 없습니다.');

  const prompt = `Word: "${word}"
Task: Write ${count} simple sentences suitable for high school students using this word.
Format: Return ONLY a JSON array of strings. Example: ["Sentence 1.", "Sentence 2."]
No markdown, no explanations.`;

  const results = parseGeminiJson(callGeminiApi(prompt));
  return { success: true, results: Array.isArray(results) ? results : [results] };
}

function handleFetchWordInfoFromAi(e) {
  const word = e.parameter.word;
  if (!word) throw new Error('단어가 없습니다.');

  const prompt = `Act as a linguistics expert for US high school students.
Analyze the English word: "${word}"

Output pure JSON with three fields:

1. "meaning":
   - Return an ARRAY of strings.
   - FORMATTING RULES:
     1. If there are multiple meanings, number them clearly (e.g., "1. ...", "2. ...").
     2. DO NOT use part-of-speech tags like (vt), (vi), (n), (adj).
     3. Instead, use the Korean particle to imply the verb type:
        * Transitive (Vt): MUST start with "~(Object)Particle" (e.g., "1. ~을 관찰하다").
        * Intransitive (Vi): Do not use a particle (e.g., "1. 살아남다").
        * If a word is both Vi and Vt, list BOTH separately.
     4. Mark (slang) or (informal) if applicable.

2. "explanation":
   - Generate structured text with KOREAN headers: [동의어], [반의어], [파생어], [용례], [심화].
   - FORMAT RULES:
     Rule 1 [동의어/반의어]: Group by specific meanings.
             Format: "word1, word2, ... : [Korean Definition]" (Max 7 words per group)
     Rule 2 [용례]: Collocations or Idioms. Format: "Expression : Korean Meaning".
     Rule 3 [심화]: High-frequency words sharing the SAME ETYMOLOGICAL ROOT.
             Format: "Word : Korean Meaning". Example: "preserve : ~을 보존하다"
     Rule 4: Insert an empty line between categories. Omit empty categories.

3. "samples": An array of English example sentences.
   - QUANTITY LOGIC:
     Case A: Single meaning -> 1 sentence.
     Case B: Distinct meanings -> 1 sentence per meaning (Max 5).
   - No translations.

Do not include Markdown code blocks. Just the JSON string.`;

  const result = parseGeminiJson(callGeminiApi(prompt));
  return { success: true, result };
}


function handleSaveAiSample(e) {
  const word    = e.parameter.word;
  const aiText  = e.parameter.ai_text;
  if (!word || aiText === undefined) throw new Error('word, ai_text 파라미터가 필요합니다.');

  const sheet   = getSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colMap  = buildHeaderMap(headers);

  if (colMap['word'] === undefined || colMap['aisample'] === undefined) {
    throw new Error('Word 또는 AISample 헤더를 찾을 수 없습니다.');
  }

  const rowIdx = findRowByWord(sheet, colMap['word'], word);
  if (rowIdx === -1) throw new Error(`시트에서 단어 '${word}'를 찾을 수 없습니다.`);

  sheet.getRange(rowIdx, colMap['aisample'] + 1).setValue(aiText);

  patchWordInFirebase(word, { AISample: aiText ? { en: aiText, ko: '' } : null });

  return { success: true, message: '저장 및 동기화 완료' };
}

function handleUpdateWordData(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (_) {
    throw new Error('서버가 혼잡합니다. 잠시 후 다시 시도해주세요.');
  }

  try {
    const originalWord = e.parameter.original_word;
    if (!originalWord) throw new Error('original_word 파라미터가 필요합니다.');

    const sheet   = getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap  = buildHeaderMap(headers);

    const rowIdx = findRowByWord(sheet, colMap['word'], originalWord);
    if (rowIdx === -1) throw new Error(`시트에서 단어 '${originalWord}'를 찾을 수 없습니다.`);

    const fieldMap = {
      word:          'word',
      pos:           'pos',
      meaning:       'meaning',
      explanation:   'explanation',
      manual_sample: 'manualsample',
    };

    const firebaseUpdates = {};
    for (const [paramKey, colKey] of Object.entries(fieldMap)) {
      const value = e.parameter[paramKey];
      if (value === undefined || colMap[colKey] === undefined) continue;
      const cell = sheet.getRange(rowIdx, colMap[colKey] + 1);
      if (['word', 'meaning', 'explanation'].includes(paramKey)) {
        setHtmlToCell(cell, value);
      } else {
        cell.setValue(value);
      }
      firebaseUpdates[paramKey === 'manual_sample' ? 'sample' : paramKey] = value;
    }

    if (Object.keys(firebaseUpdates).length > 0) {
      const newWord = e.parameter.word;
      if (newWord && newWord !== originalWord) {
        const existing = callFirebaseRtdb(`vocabulary/${toFirebaseKey(originalWord)}`, 'GET') || {};
        callFirebaseRtdb(`vocabulary/${toFirebaseKey(newWord)}`, 'PUT', { ...existing, ...firebaseUpdates });
        deleteWordFromFirebase(originalWord);
      } else {
        patchWordInFirebase(originalWord, firebaseUpdates);
      }
    }

    return { success: true, message: '단어 수정 및 동기화 완료' };
  } finally {
    lock.releaseLock();
  }
}

function handleCreateWord(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (_) {
    throw new Error('서버가 혼잡합니다. 잠시 후 다시 시도해주세요.');
  }

  try {
    const word         = e.parameter.word;
    const afterWord    = e.parameter.after_word || '';
    const pos          = e.parameter.pos          || '';
    const meaning      = e.parameter.meaning      || '';
    const explanation  = e.parameter.explanation  || '';
    const manualSample = e.parameter.manual_sample || '';

    if (!word) throw new Error('단어가 누락되었습니다.');

    const sheet   = getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap  = buildHeaderMap(headers);

    const newRow = new Array(headers.length).fill('');
    if (colMap['word']         !== undefined) newRow[colMap['word']]         = word;
    if (colMap['pos']          !== undefined) newRow[colMap['pos']]          = pos;
    if (colMap['meaning']      !== undefined) newRow[colMap['meaning']]      = meaning;
    if (colMap['explanation']  !== undefined) newRow[colMap['explanation']]  = explanation;
    if (colMap['manualsample'] !== undefined) newRow[colMap['manualsample']] = manualSample;

    if (afterWord) {
      const afterRowIdx = findRowByWord(sheet, colMap['word'], afterWord);
      if (afterRowIdx !== -1) {
        sheet.insertRowAfter(afterRowIdx);
        sheet.getRange(afterRowIdx + 1, 1, 1, newRow.length).setValues([newRow]);
      } else {
        sheet.appendRow(newRow);
      }
    } else {
      sheet.appendRow(newRow);
    }

    SpreadsheetApp.flush();

    performFullSync(sheet);

    return { success: true, message: '생성 및 전체 동기화 완료' };
  } finally {
    lock.releaseLock();
  }
}

function handleDeleteWord(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (_) {
    throw new Error('서버가 혼잡합니다. 잠시 후 다시 시도해주세요.');
  }

  try {
    const word = e.parameter.word;
    if (!word) throw new Error('삭제할 단어가 없습니다.');

    const sheet   = getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap  = buildHeaderMap(headers);

    const rowIdx = findRowByWord(sheet, colMap['word'], word);
    if (rowIdx === -1) throw new Error(`시트에서 단어 '${word}'를 찾을 수 없습니다.`);

    sheet.deleteRow(rowIdx);
    SpreadsheetApp.flush();

    performFullSync(sheet);

    return { success: true, message: '삭제 및 전체 동기화 완료' };
  } finally {
    lock.releaseLock();
  }
}

function handleToggleExcept(e) {
    const word = e.parameter.word;
    const value = e.parameter.value;
    if (!word) throw new Error('word 파라미터가 없습니다.');

    const sheet = getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap  = buildHeaderMap(headers);

    if (colMap['except'] === undefined) {
        const lastCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, lastCol).setValue('except');
        colMap['except'] = lastCol - 1;
    }

    const rowIdx = findRowByWord(sheet, colMap['word'], word);
    if (rowIdx === -1) throw new Error(`'${word}' 단어를 찾을 수 없습니다.`);

    sheet.getRange(rowIdx, colMap['except'] + 1).setValue(value);

    patchWordInFirebase(word, { except: value === '1' });

    return { success: true, message: 'except 업데이트 완료' };
}

function performFullSync(sheet) {
  if (!sheet) sheet = getSheet();
  const { words, error, message } = readWordsFromSheet(sheet);
  if (error) throw new Error(message);

  const dataToSync = {};
  words.forEach((wordObj, idx) => {
    if (!wordObj.word) return;
    wordObj.index = idx;
    dataToSync[toFirebaseKey(wordObj.word)] = wordObj;
  });

  callFirebaseRtdb('vocabulary', 'PUT', dataToSync);
}

function syncSheetDataToFirebase() {
  try {
    performFullSync(getSheet());
    SpreadsheetApp.getUi().alert('동기화 완료!');
  } catch (e) {
    SpreadsheetApp.getUi().alert(`오류: ${e.message}`);
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔥 Firebase 동기화')
    .addItem('지금 동기화하기', 'syncSheetDataToFirebase')
    .addToUi();
}


function readWordsFromSheet(sheet) {
  try {
    if (!sheet) sheet = getSheet();
    const range    = sheet.getDataRange();
    const values   = range.getValues();
    const richData = range.getRichTextValues();

    const headerRow = values.shift();
    richData.shift();

    const colMap = buildHeaderMap(headerRow);
    const { word: wc, pos: pc, meaning: mc, manualsample: msc, aisample: asc, explanation: ec, except: exc } = colMap;

    if ([wc, pc, mc].some(c => c === undefined)) {
      throw new Error('필수 헤더(Word, Pos, Meaning)가 없습니다.');
    }

    const words = [];
    values.forEach((row, idx) => {
      const rich    = richData[idx];
      const wordHtml = convertRichTextToHtml(rich[wc]);
      if (!wordHtml || !wordHtml.trim()) return;

      const manualSample = String(row[msc] || '');
      const aiSampleText = String(row[asc] || '');

words.push({
    index:       idx,
    word:        wordHtml,
    pos:         String(row[pc]  || ''),
    meaning:     convertRichTextToHtml(rich[mc]),
    explanation: ec !== undefined ? convertRichTextToHtml(rich[ec]) : '',
    sample:      manualSample,
    AISample:    aiSampleText ? { en: aiSampleText, ko: '' } : null,
    except:      exc !== undefined ? (String(row[exc] || '').trim() === '1') : false,
});
    });

    return { words };
  } catch (e) {
    console.error('readWordsFromSheet 오류:', e.message);
    return { error: true, message: e.message };
  }
}


function convertRichTextToHtml(richTextValue) {
  if (!richTextValue) return '';
  let html = '';
  richTextValue.getRuns().forEach(run => {
    const style  = run.getTextStyle();
    let text = run.getText()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (style.isBold())      text = `<b>${text}</b>`;
    if (style.isItalic())    text = `<i>${text}</i>`;
    if (style.isUnderline()) text = `<u>${text}</u>`;

    const color = style.getForegroundColor();
    if (color && color !== '#000000') text = `<span style="color:${color}">${text}</span>`;

    html += text;
  });
  return html;
}

function setHtmlToCell(cell, html) {
  if (!html) { cell.setValue(''); return; }

  const withNewlines = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n');

  const rawText = withNewlines
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n');

  const builder = SpreadsheetApp.newRichTextValue().setText(rawText);

  const applyStyle = (regex, styleFn) => {
    let m;
    while ((m = regex.exec(html)) !== null) {
      const innerText  = m[1] || m[2];
      const start = html.substring(0, m.index).replace(/<[^>]+>/g, '').length;
      const end   = start + innerText.replace(/<[^>]+>/g, '').length;
      if (end > start) {
        try { builder.setTextStyle(start, end, styleFn()); } catch (_) {}
      }
    }
  };

  applyStyle(/<b>(.*?)<\/b>/gi,    () => SpreadsheetApp.newTextStyle().setBold(true).build());
  applyStyle(/<i>(.*?)<\/i>/gi,    () => SpreadsheetApp.newTextStyle().setItalic(true).build());
  applyStyle(/<u>(.*?)<\/u>/gi,    () => SpreadsheetApp.newTextStyle().setUnderline(true).build());

  const colorRegexes = [
    /<span[^>]*style="[^"]*color:\s*([^";]+)[^"]*"[^>]*>(.*?)<\/span>/gi,
    /<font[^>]*color=['"]?([^'">\s]+)['"]?[^>]*>(.*?)<\/font>/gi,
  ];
  colorRegexes.forEach(regex => {
    let m;
    while ((m = regex.exec(html)) !== null) {
      const color     = m[1].trim();
      const innerText = m[2];
      const start = html.substring(0, m.index).replace(/<[^>]+>/g, '').length;
      const end   = start + innerText.replace(/<[^>]+>/g, '').length;
      if (end > start) {
        try { builder.setTextStyle(start, end, SpreadsheetApp.newTextStyle().setForegroundColor(color).build()); } catch (_) {}
      }
    }
  });

  cell.setRichTextValue(builder.build());
}
