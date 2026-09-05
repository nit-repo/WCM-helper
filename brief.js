/* brief.js — one parse of the brief, shared by Analyse, Compare and Fill.
 *
 * Every fix made to compare.js in isolation turned out to be a fix every
 * other feature needed too: splitting rows without honouring CSV/Excel
 * quoting shattered engine.js's signal counts and filler.js's row alignment
 * the same way it shattered compare.js's expectations; filler.js took
 * whichever column happened to be last as "the" localized text, which is
 * right for a three-column brief and silently wrong for a four-column one
 * naming Spain, Italy and Portugal. Three files kept re-deriving the same
 * facts about a brief and getting them wrong in three different places.
 *
 * This module derives those facts once:
 *   - rows, split with the quoting rules Excel and CSV actually use
 *   - which row is a section header, so a finding can say where it came from
 *   - which columns are markets, and which one is the English master
 *   - which market the brief is actually targeting, and that it is
 *     overridable rather than guessed once and locked in
 *
 * Runs in the browser (window.BriefShared) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriefShared = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── ROWS AND CELLS ──────────────────────────────────────────────────────
  // Briefs arrive as Excel and CSV exports, and a cell holding more than one
  // paragraph is wrapped in quotes and keeps its newlines. Splitting the text
  // on \n before honouring those quotes tears one row into several: the row
  // stops looking tabular, so the whole brief falls to whatever a caller does
  // with un-tabular text, and the fragments carry an orphan quote nothing
  // downstream will match. That one mistake produced 74 phantom findings on
  // a real brief when this lived only in compare.js.

  function splitRows(text) {
    var rows = [], cells = [], cell = '', quoted = false;
    var s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');

    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (quoted) {
        // "" inside a quoted cell is an escaped quote, not the end of it.
        if (ch !== '"') { cell += ch; continue; }
        if (s.charAt(i + 1) === '"') { cell += '"'; i++; continue; }
        quoted = false;
        continue;
      }
      // A quote only opens a cell at its start; mid-cell it is punctuation.
      if (ch === '"' && cell === '') { quoted = true; continue; }
      if (ch === '\t') { cells.push(cell); cell = ''; continue; }
      if (ch === '\n') { cells.push(cell); rows.push(cells); cells = []; cell = ''; continue; }
      cell += ch;
    }
    cells.push(cell);
    rows.push(cells);

    return rows.filter(function (r) {
      return r.some(function (c) { return c.trim() !== ''; });
    });
  }

  // Where in the brief a row sits. The section is the nearest preceding row
  // carrying a single cell — "Hero section", "Proof point" — and is what lets
  // a finding say "a component is missing" rather than just "line 34 is short".

  function sectionsByRow(rows) {
    var out = [], current = null;
    rows.forEach(function (cells, i) {
      var filled = cells.filter(function (c) { return c.trim() !== ''; });
      if (filled.length === 1 && filled[0].trim().length <= 60) current = filled[0].trim();
      out[i] = current;
    });
    return out;
  }

  function want(text, section, row) {
    return { text: text, section: section || null, row: row || null };
  }

  // ─── MARKETS ─────────────────────────────────────────────────────────────
  // A localization brief with one local-language column is what compare.js
  // and filler.js were both built around: cells[cells.length - 1] is always
  // right there. A brief with several — English, Spain, Italy, Portugal — has
  // no "last column", only a target, and taking the last one anyway is how
  // Fill handed back Portuguese for a Spain job. Finding the market columns is
  // what makes "the last column" become "the target market's column".

  function findHeaderRow(rows, marketList) {
    var names = marketList.map(function (m) { return String(m.name).toLowerCase(); });
    for (var i = 0; i < rows.length; i++) {
      var hits = rows[i].filter(function (c) {
        return names.indexOf(normaliseCell(c).toLowerCase()) !== -1;
      }).length;
      if (hits >= 2) return i;
    }
    return -1;
  }

  function normaliseCell(s) { return String(s == null ? '' : s).trim(); }

  function marketColumns(headerCells, marketList) {
    var byName = {};
    marketList.forEach(function (m) { byName[String(m.name).toLowerCase()] = m; });

    var found = [];
    headerCells.forEach(function (cell, i) {
      var m = byName[normaliseCell(cell).toLowerCase()];
      if (m) found.push({ name: m.name, domain: m.domain, column: i });
    });
    return found;
  }

  // Among the columns the header row does not claim for a market, the
  // English master is whichever one is actually there to be one: a header
  // literally saying so, or else the first non-empty column after the label.
  function findMasterColumn(headerCells, marketCols) {
    var claimed = {};
    marketCols.forEach(function (m) { claimed[m.column] = true; });

    var byLabel = -1;
    headerCells.forEach(function (cell, i) {
      if (byLabel !== -1 || claimed[i] || i === 0) return;
      if (/english|master/i.test(cell)) byLabel = i;
    });
    if (byLabel !== -1) return byLabel;

    for (var i = 1; i < headerCells.length; i++) {
      if (!claimed[i] && normaliseCell(headerCells[i])) return i;
    }
    return -1;
  }

  // The target market is declared in the brief's front matter — above the
  // table, typically as a "Level 2" or "Market" row — not chosen by looking
  // at the table itself. Only rows before the header count as front matter;
  // a market name inside the table is a column header, not a declaration.
  function findTargetMarket(rows, headerRowIndex, marketCols) {
    var names = {};
    marketCols.forEach(function (m) { names[m.name.toLowerCase()] = m.name; });

    var limit = headerRowIndex === -1 ? rows.length : headerRowIndex;
    for (var i = 0; i < limit; i++) {
      for (var c = 0; c < rows[i].length; c++) {
        var hit = names[normaliseCell(rows[i][c]).toLowerCase()];
        if (hit) return hit;
      }
    }
    return null;
  }

  // ─── PUBLIC ──────────────────────────────────────────────────────────────

  function parse(text, config) {
    var marketList = (config && config.markets && config.markets.list) || [];
    var cellRows = splitRows(text);
    var sectionAt = sectionsByRow(cellRows);

    var rows = cellRows.map(function (cells, i) {
      return { cells: cells, section: sectionAt[i], row: i + 1 };
    });

    var headerRowIndex = findHeaderRow(cellRows, marketList);
    var markets = headerRowIndex === -1 ? [] : marketColumns(cellRows[headerRowIndex], marketList);
    var masterColumn = headerRowIndex === -1 ? -1 : findMasterColumn(cellRows[headerRowIndex], markets);
    var targetMarket = findTargetMarket(cellRows, headerRowIndex, markets);

    return {
      rows: rows,
      headerRow: headerRowIndex === -1 ? null : headerRowIndex + 1,
      markets: markets,
      masterColumn: masterColumn,
      targetMarket: targetMarket
    };
  }

  function marketColumn(model, marketName) {
    if (!marketName) return -1;
    var hit = model.markets.filter(function (m) {
      return m.name.toLowerCase() === String(marketName).toLowerCase();
    })[0];
    return hit ? hit.column : -1;
  }

  // engine.js's signal regexes are written against whole lines. Reconstituting
  // tab-joined lines from quote-aware rows lets it keep those regexes exactly
  // as they are while no longer shredding a quoted multi-line cell to get them.
  function linesOf(model) {
    return model.rows.map(function (r) { return r.cells.join('\t'); });
  }

  return {
    splitRows: splitRows,
    sectionsByRow: sectionsByRow,
    want: want,
    parse: parse,
    marketColumn: marketColumn,
    linesOf: linesOf
  };
}));
