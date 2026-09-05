/* readers.js — turn an uploaded brief into text the engine can read.
 *
 * .docx and .xlsx are ZIP containers, and DecompressionStream('deflate-raw')
 * is native in browsers and in Node, so this needs no library. That matters:
 * the project has no dependencies and vendoring a Word parser to read a Word
 * file would be the largest thing in the repo.
 *
 * A spreadsheet comes out as tab-separated rows on purpose — the localization
 * and keyword playbooks already parse tables in that shape, so an .xlsx brief
 * feeds the existing parsers with no special case.
 *
 * Runs in the browser (window.BriefReaders) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriefReaders = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── ZIP ─────────────────────────────────────────────────────────────────
  // Only what an Office file needs: walk the central directory, find an entry
  // by name, inflate it. Stored (method 0) and deflate (method 8) only, which
  // is everything Word and Excel emit.

  function u16(b, i) { return b[i] | (b[i + 1] << 8); }
  function u32(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; }

  function findEndOfCentralDirectory(bytes) {
    // The EOCD sits at the end, after a comment of unknown length.
    for (var i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i--) {
      if (u32(bytes, i) === 0x06054b50) return i;
    }
    return -1;
  }

  function listEntries(bytes) {
    var eocd = findEndOfCentralDirectory(bytes);
    if (eocd === -1) throw new Error('Not a ZIP file — no end-of-central-directory record.');

    var count = u16(bytes, eocd + 10);
    var offset = u32(bytes, eocd + 16);
    var entries = {};
    var decoder = new TextDecoder('utf-8');

    for (var n = 0; n < count && offset < bytes.length; n++) {
      if (u32(bytes, offset) !== 0x02014b50) break;
      var method = u16(bytes, offset + 10);
      var compressedSize = u32(bytes, offset + 20);
      var nameLength = u16(bytes, offset + 28);
      var extraLength = u16(bytes, offset + 30);
      var commentLength = u16(bytes, offset + 32);
      var localOffset = u32(bytes, offset + 42);
      var name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

      entries[name] = { method: method, compressedSize: compressedSize, localOffset: localOffset };
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  function readEntry(bytes, entry) {
    // The local header repeats the name and extra fields at their own lengths.
    var o = entry.localOffset;
    if (u32(bytes, o) !== 0x04034b50) throw new Error('Corrupt ZIP entry header.');
    var nameLength = u16(bytes, o + 26);
    var extraLength = u16(bytes, o + 28);
    var start = o + 30 + nameLength + extraLength;
    var data = bytes.subarray(start, start + entry.compressedSize);

    if (entry.method === 0) return Promise.resolve(new TextDecoder('utf-8').decode(data));
    if (entry.method !== 8) return Promise.reject(new Error('Unsupported ZIP compression method ' + entry.method));

    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }

  function entryText(bytes, name) {
    var entries = listEntries(bytes);
    if (!entries[name]) return Promise.resolve(null);
    return readEntry(bytes, entries[name]);
  }

  // ─── XML ─────────────────────────────────────────────────────────────────

  function decodeXml(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
      .replace(/&amp;/g, '&');
  }

  // ─── DOCX ────────────────────────────────────────────────────────────────

  function docxToText(xml) {
    var paragraphs = [];
    var pre = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, pm;

    while ((pm = pre.exec(xml)) !== null) {
      var body = pm[1];
      var text = '', tm, tre = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
      while ((tm = tre.exec(body)) !== null) text += decodeXml(tm[1]);
      // <w:tab/> inside a paragraph is a real column break in table-shaped briefs.
      if (/<w:tab\b/.test(body) && text) {
        text = '';
        var pieces = body.split(/<w:tab\b[^>]*\/>/);
        text = pieces.map(function (piece) {
          var t = '', m2, re2 = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
          while ((m2 = re2.exec(piece)) !== null) t += decodeXml(m2[1]);
          return t;
        }).join('\t');
      }
      // A numbered or bulleted paragraph is a list item; keep it on its own
      // line rather than inventing a bullet character the brief never had.
      paragraphs.push(text);
    }

    // Table cells become tab-separated so table-shaped briefs survive.
    if (!paragraphs.length) return '';
    return paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function docxTablesToText(xml) {
    // Word tables carry each row as <w:tr> and each cell as <w:tc>. Briefs
    // like the localization sheet live entirely in one of these.
    var rows = [], rm, rre = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
    while ((rm = rre.exec(xml)) !== null) {
      var cells = [], cm, cre = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
      while ((cm = cre.exec(rm[1])) !== null) {
        var t = '', tm2, tre2 = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
        while ((tm2 = tre2.exec(cm[1])) !== null) t += decodeXml(tm2[1]);
        cells.push(t.trim());
      }
      if (cells.length) rows.push(cells.join('\t'));
    }
    return rows.join('\n');
  }

  function readDocx(bytes) {
    return entryText(bytes, 'word/document.xml').then(function (xml) {
      if (!xml) throw new Error('No word/document.xml — is this really a .docx?');
      var tables = docxTablesToText(xml);
      // Strip the tables out before reading loose paragraphs, or every cell
      // is counted twice.
      var withoutTables = xml.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, '');
      var body = docxToText(withoutTables);
      return [body, tables].filter(Boolean).join('\n\n').trim();
    });
  }

  // ─── XLSX ────────────────────────────────────────────────────────────────

  function columnIndex(ref) {
    var letters = /^([A-Z]+)/.exec(ref || '');
    if (!letters) return 0;
    var n = 0;
    for (var i = 0; i < letters[1].length; i++) n = n * 26 + (letters[1].charCodeAt(i) - 64);
    return n - 1;
  }

  function readXlsx(bytes) {
    var entries = listEntries(bytes);
    var sheetName = Object.keys(entries).filter(function (n) {
      return /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
    }).sort()[0];
    if (!sheetName) throw new Error('No worksheet found — is this really an .xlsx?');

    return entryText(bytes, 'xl/sharedStrings.xml').then(function (sharedXml) {
      var shared = [];
      if (sharedXml) {
        var sm, sre = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
        while ((sm = sre.exec(sharedXml)) !== null) {
          var t = '', tm, tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
          while ((tm = tre.exec(sm[1])) !== null) t += decodeXml(tm[1]);
          shared.push(t);
        }
      }
      return readEntry(bytes, entries[sheetName]).then(function (sheetXml) {
        var rows = [], rm, rre = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
        while ((rm = rre.exec(sheetXml)) !== null) {
          var cells = [], cm, cre = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
          while ((cm = cre.exec(rm[1])) !== null) {
            var attrs = cm[1] || '', inner = cm[2] || '';
            var refM = /r\s*=\s*"([A-Z]+\d+)"/.exec(attrs);
            var at = refM ? columnIndex(refM[1]) : cells.length;
            var typeM = /t\s*=\s*"([^"]+)"/.exec(attrs);
            var vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
            var value = '';
            if (typeM && typeM[1] === 's' && vM) value = shared[+vM[1]] || '';
            else if (typeM && typeM[1] === 'inlineStr') {
              var iM = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(inner);
              value = iM ? decodeXml(iM[1]) : '';
            } else if (vM) value = decodeXml(vM[1]);
            while (cells.length < at) cells.push('');
            cells[at] = value;
          }
          rows.push(cells.join('\t'));
        }
        return rows.join('\n').trim();
      });
    });
  }

  // ─── PASTE DAMAGE ────────────────────────────────────────────────────────
  // Word does not survive a copy-paste intact. These are artefacts of the
  // brief, not of the page, so they are reported as a brief-quality note
  // rather than counted as a deviation.

  function briefWarnings(text) {
    var out = [];
    text = String(text || '');

    if (/^[\s]*[●•▪◦]\s*/m.test(text)) {
      out.push('Bullets came through as literal ● characters rather than a list. Word list formatting is lost on paste — the text is still readable, but a bullet may end up in the page copy.');
    }
    if (/mso-list|mso-spacerun|<!--\[if\s|<o:p>/i.test(text)) {
      out.push('Word markup (mso-list, conditional comments) is still in the brief. Paste as plain text, or upload the .docx.');
    }
    if (/[‘’“”]/.test(text) && /["']/.test(text)) {
      out.push('The brief mixes smart quotes with straight quotes. Comparison folds them together, but the page may end up inconsistent.');
    }
    return out;
  }

  // ─── PUBLIC ──────────────────────────────────────────────────────────────

  function readFile(name, buffer, rawText) {
    var lower = String(name || '').toLowerCase();

    if (/\.docx$/.test(lower)) return readDocx(new Uint8Array(buffer));
    if (/\.xlsx$/.test(lower)) return readXlsx(new Uint8Array(buffer));
    if (/\.csv$/.test(lower)) {
      return Promise.resolve(String(rawText || '').split(/\r?\n/).map(function (line) {
        return line.split(',').map(function (c) { return c.replace(/^"|"$/g, '').trim(); }).join('\t');
      }).join('\n'));
    }
    if (/\.(doc|xls)$/.test(lower)) {
      return Promise.reject(new Error('Old binary ' + lower.slice(-4) +
        ' files cannot be read. Save it as .docx or .xlsx and try again.'));
    }
    return Promise.resolve(String(rawText || ''));
  }

  return {
    readFile: readFile,
    readDocx: readDocx,
    readXlsx: readXlsx,
    briefWarnings: briefWarnings,
    listEntries: listEntries
  };
}));
