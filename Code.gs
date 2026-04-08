/**
 * @OnlyCurrentDoc
 */

// ================================================================
// [보안 패치] 이곳에 새로 발급받은 API 키를 입력하세요.
// ================================================================
const GEMINI_API_KEY = "AIzaSyAdiHTItdOXrXfxeq_ZUfO_5b4k84699YA";

// ================================================================
// 1. 웹 앱 요청 처리 (doGet)
// ================================================================
function doGet(e) {
  try {
    const action = e.parameter.action;
    let result;

    if (action === 'translate') {
      result = translateText(e);
    } 
    // [보안 패치] 프론트엔드의 AI 요청을 처리하는 분기 추가
    else if (action === 'generate_ai_examples') {
      result = callGeminiForExamples(e);
    } else if (action === 'fetch_word_info_from_ai') {
      result = callGeminiForWordInfo(e);
    } 
    else if (action === 'save_ai_sample') {
      result = saveAIExampleToSheet(e);
    } else if (action === 'update_word_data') {
      result = updateWordDataInSheet(e);
    } else if (action === 'create_word') {
      result = createWordInSheet(e);
    } else if (action === 'delete_word') {
      result = deleteWordInSheet(e);
    } else {
      throw new Error("지원하지 않는 동작(action)입니다: " + action);
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ================================================================
// [보안 패치] 2. Gemini API 백엔드 호출 함수 추가
// ================================================================

function callGeminiForExamples(e) {
  const word = e.parameter.word;
  const count = e.parameter.count || 2;
  if (!word) throw new Error("단어가 없습니다.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const prompt = `
    Word: "${word}"
    Task: Write ${count} simple sentences suitable for children using this word.
    Format: Return ONLY a JSON array of strings. Example: ["Sentence 1.", "Sentence 2."]
    No markdown, no explanations.
  `;

  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());

  if (response.getResponseCode() !== 200) {
    throw new Error("Gemini API Error: " + response.getContentText());
  }

  const text = json.candidates[0].content.parts[0].text;
  const cleanJson = JSON.parse(text.replace(/```json|```/g, '').trim());
  const results = Array.isArray(cleanJson) ? cleanJson : [cleanJson];

  return { success: true, results: results };
}

function callGeminiForWordInfo(e) {
  const word = e.parameter.word;
  if (!word) throw new Error("단어가 없습니다.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const prompt = `
        Act as a linguistics expert for US high school students.
        Analyze the English word: "${word}"

        Output pure JSON with three fields:
        
        1. "meaning": 
           - Return an ARRAY of strings.
           - FORMATTING RULES:
             1. If there are multiple meanings, number them clearly (e.g., "1. ...", "2. ...").
             2. **DO NOT** use part-of-speech tags like (vt), (vi), (n), (adj).
             3. Instead, use the Korean particle to imply the verb type:
                * Transitive (Vt): MUST start with "~(Object)Particle" (e.g., "1. ~을 관찰하다", "2. ~(법)을 준수하다").
                * Intransitive (Vi): Do not use a particle (e.g., "1. 살아남다").
                * If a word is both Vi and Vt (like 'survive'), list BOTH separately:
                  (e.g., "1. 살아남다", "2. ~에서 살아남다").
             4. Mark (slang) or (informal) if applicable.

        2. "explanation": 
           - Generate a structured text with these KOREAN headers: [동의어], [반의어], [파생어], [용례], [심화].
           - FORMAT RULES:
             Rule 1 [동의어/반의어]: Group by specific meanings. 
                     Format: "word1, word2, ... : [Korean Definition]"
                     Max 7 words per group.
                     * Ensure the Korean definition follows the 'meaning' formatting rules (particles included, no POS tags).
             Rule 2 [용례]: Focus on Collocations or Idioms. Format: "Expression : Korean Meaning".
             Rule 3 [심화]: List high-frequency words sharing the SAME ETYMOLOGICAL ROOT. 
                     Format: "Word : Korean Meaning".
                     Example: "preserve : ~을 보존하다"
             Rule 4: Insert an empty line between categories. If a category is empty, omit it.
        
        3. "samples": An array of English example sentences.
           - QUANTITY LOGIC:
             Case A: Single meaning -> 1 sentence.
             Case B: Distinct meanings -> 1 sentence per meaning (Max 5).
           - No translations.

        Do not include Markdown code blocks. Just the JSON string.
  `;

  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());

  if (response.getResponseCode() !== 200) {
    throw new Error("Gemini API Error: " + response.getContentText());
  }

  const textResponse = json.candidates[0].content.parts[0].text;
  const cleanJson = JSON.parse(textResponse.replace(/```json|```/g, '').trim());

  return { success: true, result: cleanJson };
}

// ================================================================
// 유틸리티 및 시트 조작 함수들 (유지)
// ================================================================

function translateText(e) {
  if (!e.parameter.text) throw new Error("번역할 텍스트가 없습니다.");
  const translatedText = LanguageApp.translate(e.parameter.text, 'en', 'ko');
  return { success: true, translatedText: translatedText };
}

function findRowIndexByWord(sheet, wordColIndex, wordToFind) {
  if (!wordToFind) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const range = sheet.getRange(2, wordColIndex + 1, lastRow - 1, 1);
  const finder = range.createTextFinder(wordToFind).matchEntireCell(true);
  const result = finder.findNext();
  if (result) {
    return result.getRow();
  }
  return -1;
}

function saveAIExampleToSheet(e) {
  const wordToFind = e.parameter.word;
  const textToSave = e.parameter.ai_text;
  if (!wordToFind || !textToSave) throw new Error("데이터가 누락되었습니다.");
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Words');
  if (!sheet) throw new Error("'Words' 시트를 찾을 수 없습니다.");
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let wordColIndex = -1;
  let aiSampleColIndex = -1;
  headers.forEach((header, index) => {
    const h = header.toString().trim().toLowerCase().replace(/\s/g, '');
    if (h === 'word') wordColIndex = index;
    if (h === 'aisample') aiSampleColIndex = index;
  });
  if (wordColIndex === -1 || aiSampleColIndex === -1) throw new Error("헤더 확인 필요");
  const targetRowIndex = findRowIndexByWord(sheet, wordColIndex, wordToFind);
  if (targetRowIndex === -1) throw new Error(`시트에서 단어 '${wordToFind}'를 찾을 수 없습니다.`);
  sheet.getRange(targetRowIndex, aiSampleColIndex + 1).setValue(textToSave);

  const rowValues = sheet.getRange(targetRowIndex, 1, 1, headers.length).getValues()[0];
  const headersArr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  updateSingleWordInFirebase(headersArr, rowValues, textToSave);
  return { success: true, message: "저장 및 동기화 완료" };
}

function updateWordDataInSheet(e) {
  const originalWord = e.parameter.original_word;
  const newWord = e.parameter.word; 
  const newPos = e.parameter.pos;
  const newMeaning = e.parameter.meaning;
  const newExplanation = e.parameter.explanation;
  const newSample = e.parameter.manual_sample;

  if (!originalWord) throw new Error("기존 단어 정보가 누락되었습니다.");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Words');
  if (!sheet) throw new Error("'Words' 시트를 찾을 수 없습니다.");

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colMap = {};
  headers.forEach((h, i) => colMap[h.toString().toLowerCase().replace(/\s/g, '')] = i);

  const targetRowIndex = findRowIndexByWord(sheet, colMap['word'], originalWord);
  if (targetRowIndex === -1) throw new Error(`시트에서 단어 '${originalWord}'를 찾을 수 없습니다.`);

  const updates = {};

  if (newWord !== undefined && newWord !== originalWord) {
    setHtmlToCell(sheet.getRange(targetRowIndex, colMap['word'] + 1), newWord);
    updates.word = newWord;
  }

  if (newPos !== undefined) {
    sheet.getRange(targetRowIndex, colMap['pos'] + 1).setValue(newPos);
    updates.pos = newPos;
  }
  
  if (newMeaning !== undefined) {
    setHtmlToCell(sheet.getRange(targetRowIndex, colMap['meaning'] + 1), newMeaning);
    updates.meaning = newMeaning;
  }

  if (newExplanation !== undefined) {
    setHtmlToCell(sheet.getRange(targetRowIndex, colMap['explanation'] + 1), newExplanation);
    updates.explanation = newExplanation;
  }
  if (newSample !== undefined && colMap['manualsample'] !== undefined) {
    sheet.getRange(targetRowIndex, colMap['manualsample'] + 1).setValue(newSample);
    updates.sample = newSample;
  }

  const headersArr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowRichValues = sheet.getRange(targetRowIndex, 1, 1, headers.length).getRichTextValues()[0];
  const updatedRowValues = rowRichValues.map(val => convertRichTextToHtml(val));

  if (newWord !== undefined && newWord !== originalWord) {
    deleteFromFirebase(originalWord);
    updateSingleWordInFirebase(headersArr, updatedRowValues);
  } else {
    updateSingleWordInFirebase(headersArr, updatedRowValues);
  }

  return { success: true, message: "단어 수정 및 동기화 완료" };
}

function createWordInSheet(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
  } catch (e) {
    throw new Error("서버가 혼잡합니다. 잠시 후 다시 시도해주세요.");
  }

  try {
    const word = e.parameter.word;
    const afterWord = e.parameter.after_word;
    const pos = e.parameter.pos || "";
    const meaning = e.parameter.meaning || "";
    const explanation = e.parameter.explanation || "";
    const manualSample = e.parameter.manual_sample || ""; 
    
    if (!word) throw new Error("단어가 누락되었습니다.");
    
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Words');
    if (!sheet) throw new Error("'Words' 시트를 찾을 수 없습니다.");
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colMap = {};
    headers.forEach((h, i) => colMap[h.toString().toLowerCase().replace(/\s/g,'')] = i);
    
    let targetRowIndex = -1;
    if (afterWord) {
        const foundRow = findRowIndexByWord(sheet, colMap['word'], afterWord);
        if (foundRow !== -1) targetRowIndex = foundRow; 
    }
    
    const newRow = new Array(headers.length).fill("");
    if (colMap['word'] !== undefined) newRow[colMap['word']] = word;
    if (colMap['pos'] !== undefined) newRow[colMap['pos']] = pos;
    if (colMap['meaning'] !== undefined) newRow[colMap['meaning']] = meaning;
    if (colMap['explanation'] !== undefined) newRow[colMap['explanation']] = explanation;
    if (colMap['manualsample'] !== undefined) newRow[colMap['manualsample']] = manualSample; 
    
    if (targetRowIndex !== -1 && targetRowIndex < sheet.getLastRow()) {
        sheet.insertRowAfter(targetRowIndex); 
        sheet.getRange(targetRowIndex + 1, 1, 1, newRow.length).setValues([newRow]); 
    } else {
        sheet.appendRow(newRow);
    }
    
    SpreadsheetApp.flush(); 
    Utilities.sleep(500); 
    
    const updatedSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Words');
    
    performFullSyncInternal(updatedSheet);
    
    return { success: true, message: "생성 및 전체 동기화 완료" };

  } catch (error) {
    Logger.log("Create Error: " + error.message);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function deleteWordInSheet(e) {
  const word = e.parameter.word;
  if (!word) throw new Error("삭제할 단어가 없습니다.");
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Words');
  if (!sheet) throw new Error("'Words' 시트를 찾을 수 없습니다.");
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let wordColIndex = -1;
  headers.forEach((h, i) => {
    if (h.toString().trim().toLowerCase() === 'word') wordColIndex = i;
  });
  const targetRowIndex = findRowIndexByWord(sheet, wordColIndex, word);
  if (targetRowIndex !== -1) {
    sheet.deleteRow(targetRowIndex);
    SpreadsheetApp.flush();
    performFullSyncInternal(sheet);
    return { success: true, message: "삭제 및 전체 동기화 완료" };
  } else {
    throw new Error("삭제할 단어를 찾지 못했습니다.");
  }
}

function performFullSyncInternal(sheet) {
    const props = PropertiesService.getScriptProperties();
    const URL = props.getProperty('FIREBASE_URL');
    const SEC = props.getProperty('FIREBASE_SECRET');
    if(!URL || !SEC) return;
    const wordsData = getWordsForSync(sheet); 
    if (wordsData.error) throw new Error(wordsData.message);
    const wordsArray = wordsData.words;
    const dataToSync = {};
    wordsArray.forEach((wordObject, idx) => {
      if (wordObject.word) {
        wordObject.index = idx; 
        const safeKey = wordObject.word.replace(/[.#$\[\]\/]/g, '_');
        dataToSync[safeKey] = wordObject;
      }
    });
    const setUrl = `${URL}/vocabulary.json?auth=${SEC}`;
    UrlFetchApp.fetch(setUrl, {
      'method': 'put', 
      'contentType': 'application/json',
      'payload': JSON.stringify(dataToSync)
    });
}

function updateSingleWordInFirebase(headers, rowData, newAiText) {
  try {
    const props = PropertiesService.getScriptProperties();
    const URL = props.getProperty('FIREBASE_URL');
    const SEC = props.getProperty('FIREBASE_SECRET');
    if(!URL || !SEC) return; 
    const hMap = {};
    headers.forEach((h, i) => { if(h) hMap[h.toString().toLowerCase().replace(/\s/g, '')] = i; });
    const word = String(rowData[hMap['word']]);
    if(!word) return;
    const aiObj = newAiText ? { en: newAiText, ko: "" } : null;
    const safeKey = word.replace(/[.#$\[\]\/]/g, '_');
    const firebaseUrl = `${URL}/vocabulary/${safeKey}/AISample.json?auth=${SEC}`;
    UrlFetchApp.fetch(firebaseUrl, {
      method: 'put', 
      contentType: 'application/json',
      payload: JSON.stringify(aiObj)
    });
  } catch(e) {
    Logger.log("Firebase 동기화 실패: " + e.message);
  }
}

function updateFieldsInFirebase(word, fieldsToUpdate) {
  try {
    const props = PropertiesService.getScriptProperties();
    const URL = props.getProperty('FIREBASE_URL');
    const SEC = props.getProperty('FIREBASE_SECRET');
    if(!URL || !SEC) return; 
    const safeKey = word.replace(/[.#$\[\]\/]/g, '_');
    const firebaseUrl = `${URL}/vocabulary/${safeKey}.json?auth=${SEC}`;
    UrlFetchApp.fetch(firebaseUrl, {
      method: 'patch', 
      contentType: 'application/json',
      payload: JSON.stringify(fieldsToUpdate)
    });
  } catch(e) {
    Logger.log("Firebase 필드 업데이트 실패: " + e.message);
  }
}

function deleteFromFirebase(word) {
  try {
    const props = PropertiesService.getScriptProperties();
    const URL = props.getProperty('FIREBASE_URL');
    const SEC = props.getProperty('FIREBASE_SECRET');
    if(!URL || !SEC) return; 
    const safeKey = word.replace(/[.#$\[\]\/]/g, '_');
    const firebaseUrl = `${URL}/vocabulary/${safeKey}.json?auth=${SEC}`;
    UrlFetchApp.fetch(firebaseUrl, { method: 'delete' });
  } catch(e) {
    Logger.log("Firebase 삭제 실패: " + e.message);
  }
}

function createInFirebase(word, data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const URL = props.getProperty('FIREBASE_URL');
    const SEC = props.getProperty('FIREBASE_SECRET');
    if(!URL || !SEC) return; 
    const safeKey = word.replace(/[.#$\[\]\/]/g, '_');
    const firebaseUrl = `${URL}/vocabulary/${safeKey}.json?auth=${SEC}`;
    UrlFetchApp.fetch(firebaseUrl, {
      method: 'put', 
      contentType: 'application/json',
      payload: JSON.stringify(data)
    });
  } catch(e) {
    Logger.log("Firebase 생성 실패: " + e.message);
  }
}

function getSheet(sheetName = 'Words') {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet '${sheetName}' not found.`);
  return sheet;
}

function getWordsForSync(sheet) {
  try {
    if (!sheet) sheet = getSheet('Words');
    const range = sheet.getDataRange();
    const data = range.getValues();
    const richData = range.getRichTextValues(); 
    
    const headers = data.shift();
    richData.shift(); 

    const headerMap = {};
    headers.forEach((h, i) => { if(h) headerMap[h.toString().trim().toLowerCase().replace(/\s/g, '')] = i; });
    const { 
        word: wordCol, pos: posCol, meaning: meaningCol,
        manualsample: manualSampleCol, aisample: aiSampleCol,
        explanation: explanationCol
    } = headerMap;
    if ([wordCol, posCol, meaningCol].some(c => c === undefined)) {
      throw new Error("필수 헤더(Word, Pos, Meaning)가 없습니다.");
    }
    const words = data.map((row, index) => {
        const rowRich = richData[index]; 

        const wordHtml = convertRichTextToHtml(rowRich[wordCol]);
        const meaningHtml = convertRichTextToHtml(rowRich[meaningCol]);
        const explanationHtml = convertRichTextToHtml(rowRich[explanationCol]);

        const manualSample = String(row[manualSampleCol] || "");
        const aiSampleText = String(row[aiSampleCol] || ""); 
        const sampleText = manualSample;
        const aiSampleObj = aiSampleText ? { en: aiSampleText, ko: "" } : null;
        return {
          index: index, 
          word: wordHtml, 
          pos: String(row[posCol] || ""),
          meaning: meaningHtml, 
          sample: sampleText,
          explanation: explanationHtml, 
          AISample: aiSampleObj 
        }
      })
      .filter(wordObj => wordObj.word && wordObj.word.trim() !== "");
    return { words };
  } catch (e) {
    Logger.log("데이터 읽기 오류: " + e.message);
    return { error: true, message: e.message };
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🔥 Firebase 동기화')
      .addItem('지금 동기화하기', 'syncSheetDataToFirebase').addToUi();
}

function syncSheetDataToFirebase() {
  try {
    const sheet = getSheet('Words');
    performFullSyncInternal(sheet);
    SpreadsheetApp.getUi().alert(`동기화 완료되었습니다.`);
  } catch (e) {
    SpreadsheetApp.getUi().alert("오류 발생: " + e.message);
  }
}

function convertRichTextToHtml(richTextValue) {
  const text = richTextValue.getText();
  const runs = richTextValue.getRuns();
  let html = "";
  
  runs.forEach(run => {
    const style = run.getTextStyle();
    let runText = run.getText();
    runText = runText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    if (style.isBold()) runText = `<b>${runText}</b>`;
    if (style.isItalic()) runText = `<i>${runText}</i>`;
    if (style.isUnderline()) runText = `<u>${runText}</u>`;
    const color = style.getForegroundColor();
    if (color && color !== '#000000') {
      runText = `<span style="color:${color}">${runText}</span>`;
    }
    html += runText;
  });
  return html;
}

function setHtmlToCell(cell, html) {
  if (!html) { cell.setValue(""); return; }
  
  let processedHtml = html.replace(/<br\s*\/?>/gi, '\n') 
                          .replace(/<\/div>/gi, '\n')    
                          .replace(/<\/p>/gi, '\n');     
                          
  const rawText = processedHtml.replace(/<[^>]+>/g, '')  
                      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); 
                      
  const builder = SpreadsheetApp.newRichTextValue().setText(rawText);
  
  const tags = [];
  const regex = /<\/?([a-z]+)[^>]*>/gi;
  let match;
  let currentIdx = 0;
  let textIdx = 0;
  
  const tagStack = [];
  const cleanHtml = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  
  let i = 0;
  let trueLen = 0;
  let inTag = false;
  
  let boldPattern = /<b>(.*?)<\/b>/g;
  let bMatch;
  while ((bMatch = boldPattern.exec(html)) !== null) {
     const start = html.substring(0, bMatch.index).replace(/<[^>]+>/g, '').length;
     const end = start + bMatch[1].replace(/<[^>]+>/g, '').length;
     if (end > start) builder.setTextStyle(start, end, SpreadsheetApp.newTextStyle().setBold(true).build());
  }

  let italicPattern = /<i>(.*?)<\/i>/g;
  let iMatch;
  while ((iMatch = italicPattern.exec(html)) !== null) {
     const start = html.substring(0, iMatch.index).replace(/<[^>]+>/g, '').length;
     const end = start + iMatch[1].replace(/<[^>]+>/g, '').length;
     if (end > start) builder.setTextStyle(start, end, SpreadsheetApp.newTextStyle().setItalic(true).build());
  }

  let underlinePattern = /<u>(.*?)<\/u>/g;
  let uMatch;
  while ((uMatch = underlinePattern.exec(html)) !== null) {
      const start = html.substring(0, uMatch.index).replace(/<[^>]+>/g, '').length;
      const end = start + uMatch[1].replace(/<[^>]+>/g, '').length;
      if (end > start) builder.setTextStyle(start, end, SpreadsheetApp.newTextStyle().setUnderline(true).build());
  }
  
  const spanColorRegex = /<span[^>]*style="[^"]*color:\s*([^";]+)[^"]*"[^>]*>(.*?)<\/span>/gi;
  let sMatch;
  while ((sMatch = spanColorRegex.exec(html)) !== null) {
      const colorCode = sMatch[1].trim();
      const content = sMatch[2];
      const start = html.substring(0, sMatch.index).replace(/<[^>]+>/g, '').length;
      const end = start + content.replace(/<[^>]+>/g, '').length;
      
      if (end > start) {
          try { builder.setTextStyle(start, end, SpreadsheetApp.newTextStyle().setForegroundColor(colorCode).build()); } catch(e) {}
      }
  }

  const fontColorRegex = /<font[^>]*color=['"]?([^'">\s]+)['"]?[^>]*>(.*?)<\/font>/gi;
  let fMatch;
  while ((fMatch = fontColorRegex.exec(html)) !== null) {
      const colorCode = fMatch[1].trim();
      const content = fMatch[2];
      const start = html.substring(0, fMatch.index).replace(/<[^>]+>/g, '').length;
      const end = start + content.replace(/<[^>]+>/g, '').length;
      
      if (end > start) {
          try { builder.setTextStyle(start, end, SpreadsheetApp.newTextStyle().setForegroundColor(colorCode).build()); } catch(e) {}
      }
  }

  cell.setRichTextValue(builder.build());
}