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

  // ─── TABLE SHAPE ─────────────────────────────────────────────────────────
  // Every localization brief read so far has been "rows = content fields,
  // columns = markets" — a Headline row, a Body row, one cell per market.
  // A real KONE sheet is the transpose: "rows = markets, columns = content
  // fields" — one row per country, with a header-text column and a body-text
  // column. Its rows never open with a field label ("Headline", "Body"), so
  // the existing check finds nothing and the whole sheet reads as empty.
  //
  // The market names in that sheet — Bulgaria, Croatia, Germany — are not
  // (and cannot practically all be) in config's markets.list, so detecting
  // this shape from a market-name vocabulary would fail on real data. What
  // is detectable without a vocabulary is the shape itself: a column of
  // short, distinct identifiers next to a column of actual prose. A
  // configured market name corroborates when it is there; it is never
  // required.

  var DEFAULT_FIELD_LABELS = ['headline', 'subheading', 'title', 'body',
    'meta title', 'meta description', 'meta keywords', 'page name', 'url path'];

  function isFieldLabelCell(cell, fieldLabels) {
    var v = normaliseCell(cell).toLowerCase().replace(/\s*\d+\s*$/, '').replace(/\s*\/.*$/, '');
    return fieldLabels.indexOf(v) !== -1 || /^cta\b/i.test(normaliseCell(cell));
  }

  // Short, no sentence punctuation, four words or fewer — a country, a
  // language, a code. Real prose runs longer than this whatever language
  // it is written in, which is what makes this check language-independent.
  function looksLikeIdentifier(cell) {
    var s = normaliseCell(cell);
    return !!s && s.length <= 30 && s.split(/\s+/).length <= 4 && !/[.!?](\s|$)/.test(s);
  }

  function looksLikeProse(cell) { return normaliseCell(cell).length >= 40; }

  // The same role vocabulary compare.js's readMarketsByField uses to
  // classify a column once the header row is known — used here a step
  // earlier, to find the header row itself among several tabular
  // candidates. Kept as its own copy rather than a shared import: brief.js
  // stays a dependency of compare.js, never the other way round.
  var HEADER_ROLE_RE = /header|title|headline|\btext\b|paragraph|description|content|copy/i;

  // rows: splitRows() output. config: the same work-types.json-shaped object
  // Brief.parse already takes, so markets.list is available as a bonus
  // signal without a new calling convention. Returns 'unknown' with a
  // reason rather than guessing when neither known shape fits.
  function detectOrientation(rows, config) {
    var fieldLabels = (config && config.compare && config.compare.fieldLabels) || DEFAULT_FIELD_LABELS;
    var marketList = (config && config.markets && config.markets.list) || [];
    var tabular = [];
    rows.forEach(function (r, i) { if (r.length >= 3) tabular.push({ cells: r, row: i }); });

    if (tabular.length < 2) {
      return { orientation: 'unknown', reason: 'Fewer than two rows have three or more columns.' };
    }

    // fields-by-market: a data row's first cell names a content field.
    var fieldHits = tabular.filter(function (r) { return isFieldLabelCell(r.cells[0], fieldLabels); });
    if (fieldHits.length >= 2) {
      return {
        orientation: 'fields-by-market',
        reason: fieldHits.length + ' of ' + tabular.length + ' tabular rows open with a known field label (' +
          fieldHits.slice(0, 3).map(function (r) { return r.cells[0]; }).join(', ') + ', ...).'
      };
    }

    // markets-by-field: the transpose. Column 1 reads as a short, distinct
    // identifier on most rows; at least one other column reads as prose on
    // most rows.
    //
    // The header row is not always the first tabular row — a real sheet can
    // carry stray front matter above the real table ("46 / / / Option 1
    // text in English / Option 2 text in English / confirm" sat above the
    // real "Country / Languages / ..." header on the sheet this was built
    // against). Pick whichever tabular row's own cells read most like
    // column labels — SECTION_ROLE_RE/BODY_ROLE_RE hits from column 2
    // onward — rather than assuming position. A row with no role-reading
    // cells at all falls back to the first tabular row, unchanged from
    // before.
    var headerRow = tabular.reduce(function (best, r) {
      var hits = r.cells.slice(1).filter(function (c) { return HEADER_ROLE_RE.test(c); }).length;
      return hits > (best.hits || 0) ? { row: r, hits: hits } : best;
    }, {}).row || tabular[0];

    // A trailing status column ("yes"/"N/A") some rows carry and others
    // don't is not a shape mismatch — only the columns the header itself
    // names are ever read, so extra trailing cells are simply unused. Only
    // rows after the header count as its data — stray front matter above
    // the real header (seen on a real sheet: a leftover "46 / / / Option 1
    // text in English / ..." row one line above the true header) must
    // never be read as if it were one of the header's own rows.
    var dataRows = tabular.filter(function (r) {
      return r.row > headerRow.row && r.cells.length >= headerRow.cells.length;
    });
    if (dataRows.length < 2) {
      return { orientation: 'unknown', reason: 'Fewer than two rows after the header carry at least as many columns as it does.' };
    }

    var idCells = dataRows.filter(function (r) { return looksLikeIdentifier(r.cells[0]); });
    var distinct = {};
    idCells.forEach(function (r) { distinct[normaliseCell(r.cells[0]).toLowerCase()] = true; });
    var namedMarkets = dataRows.filter(function (r) {
      return marketList.some(function (m) { return normaliseCell(r.cells[0]).toLowerCase() === String(m.name).toLowerCase(); });
    }).length;

    var proseColumns = [];
    for (var c = 1; c < headerRow.cells.length; c++) {
      (function (col) {
        var n = dataRows.filter(function (r) { return looksLikeProse(r.cells[col]); }).length;
        if (n >= Math.ceil(dataRows.length * 0.6)) proseColumns.push(col);
      }(c));
    }

    var idRatio = idCells.length / dataRows.length;
    var distinctRatio = Object.keys(distinct).length / dataRows.length;

    if (idRatio >= 0.8 && distinctRatio >= 0.8 && proseColumns.length >= 1) {
      return {
        orientation: 'markets-by-field',
        headerRowIndex: headerRow.row,
        headerCells: headerRow.cells,
        dataRows: dataRows.map(function (r) { return r.row; }),
        reason: Math.round(idRatio * 100) + '% of rows open with a short, distinct label in column 1' +
          (namedMarkets ? ' (' + namedMarkets + ' a known market name)' : ' (none a configured market name — read from shape alone)') +
          ', and column' + (proseColumns.length > 1 ? 's ' : ' ') +
          proseColumns.map(function (c) { return c + 1; }).join(', ') + ' read as prose on most rows.',
        evidence: {
          dataRows: dataRows.length, identifierRows: idCells.length,
          distinctIdentifiers: Object.keys(distinct).length, proseColumns: proseColumns, namedMarketRows: namedMarkets
        }
      };
    }

    return {
      orientation: 'unknown',
      reason: 'Neither known shape fits (identifier ' + Math.round(idRatio * 100) + '%, distinct ' +
        Math.round(distinctRatio * 100) + '%, prose columns ' + proseColumns.length + ') — not read as a table.'
    };
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

  // The market object itself (name, domain, column) by name — engine.js's
  // detectCms and compare.js's brief-picking both need the domain, which a
  // column index alone can't give them. marketColumn below is the same
  // lookup with only the column kept, for the one caller (filler.js) that
  // only ever wanted that.
  function marketOf(model, marketName) {
    if (!marketName) return null;
    return model.markets.filter(function (m) {
      return m.name.toLowerCase() === String(marketName).toLowerCase();
    })[0] || null;
  }

  function marketColumn(model, marketName) {
    var m = marketOf(model, marketName);
    return m ? m.column : -1;
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
    marketOf: marketOf,
    linesOf: linesOf,
    detectOrientation: detectOrientation
  };
}));
