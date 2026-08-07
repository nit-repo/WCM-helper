/* export.js — Excel export for the WCM Brief Analyser.
 *
 * The plan called for SheetJS from a CDN. This writes SpreadsheetML 2003 (the
 * XML workbook format Excel opens natively) instead, because the analyser is
 * otherwise a zero-request, zero-dependency page — pulling a script from a CDN
 * would break it behind a strict CSP or on an air-gapped network, which is
 * exactly where WCM work tends to happen. Same 14 columns either way.
 *
 * Runs in the browser (window.BriefExport) and in Node (module.exports), so the
 * column contract is testable without a DOM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriefExport = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HEADERS = [
    'Work Type',
    'CMS Platform',
    'Target Page Location',
    'Completeness Score',
    'Missing Fields',
    'Risk Flags',
    'Identified Components',
    'Recommended Components',
    'Identified/Missing Assets',
    'Execution Steps',
    'Brief Summary',
    'Environment Scope',
    'Classification Confidence',
    'Matched Keywords (Audit)'
  ];

  function join(list, sep) { return (list || []).join(sep || ' | '); }

  function locationCell(a) {
    var parts = [];
    (a.location.paths || []).slice(0, 3).forEach(function (p) { parts.push(p.value); });
    (a.location.markets || []).forEach(function (m) { parts.push(m.code + ' (' + m.name + ')'); });
    (a.location.regions || []).forEach(function (r) { parts.push(r.code); });
    if (a.location.pageType) parts.push('page type: ' + a.location.pageType);
    return join(parts);
  }

  function riskCell(a) {
    var blocks = (a.hardBlocks || []).map(function (b) { return 'BLOCK: ' + b.label; });
    var flags = (a.riskFlags || []).map(function (f) { return f.severity + ' ' + f.label + (f.source === 'standing' ? ' (standing)' : ''); });
    return join(blocks.concat(flags));
  }

  function assetCell(a) {
    var supplied = (a.assets.supplied || []).map(function (x) { return 'supplied: ' + x.label; });
    var missing = (a.assets.missing || []).map(function (x) { return 'MISSING: ' + x.label; });
    return join(supplied.concat(missing));
  }

  function confidenceCell(a) {
    var text = a.workType.confidence + '%';
    if (a.workType.overridden) text += ' (manual override)';
    if (a.workType.ambiguous) text += ' — AMBIGUOUS';
    if (a.workType.runnerUp) text += ', runner-up: ' + a.workType.runnerUp.label + ' ' + a.workType.runnerUp.confidence + '%';
    return text;
  }

  function buildRow(a) {
    return [
      a.workType.label,
      a.cms.label,
      locationCell(a),
      a.completeness.score + '% (' + a.completeness.rag.toUpperCase() + ')',
      join((a.completeness.missing || []).map(function (f) { return f.label; })),
      riskCell(a),
      join((a.components.identified || []).map(function (c) { return c.name; }), ', '),
      join((a.components.recommended || []).map(function (c) { return c.name; }), ', '),
      assetCell(a),
      (a.executionSteps || []).map(function (s) { return s.n + '. ' + s.instruction; }).join('\n'),
      a.summary,
      join(a.location.environments || [], ', ') || 'Not stated',
      confidenceCell(a),
      join((a.workType.matchedKeywords || []).map(function (k) { return k.term + ' (' + k.weight + ')'; }))
    ];
  }

  function buildTable(analyses) {
    return { headers: HEADERS.slice(), rows: (analyses || []).map(buildRow) };
  }

  function escapeXml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      // Control characters are not legal in XML 1.0 and Excel rejects the file
      // outright if any survive; newlines are kept for the step list.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function cell(value) {
    return '<Cell><Data ss:Type="String">' + escapeXml(value).replace(/\n/g, '&#10;') + '</Data></Cell>';
  }

  function toSpreadsheetXml(analyses) {
    var table = buildTable(analyses);
    var out = [];
    out.push('<?xml version="1.0"?>');
    out.push('<?mso-application progid="Excel.Sheet"?>');
    out.push('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">');
    out.push('<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#D0DCFD" ss:Pattern="Solid"/></Style>');
    out.push('<Style ss:ID="wrap"><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style></Styles>');
    out.push('<Worksheet ss:Name="Brief Analysis"><Table>');

    out.push('<Row>' + table.headers.map(function (h) {
      return '<Cell ss:StyleID="hdr"><Data ss:Type="String">' + escapeXml(h) + '</Data></Cell>';
    }).join('') + '</Row>');

    table.rows.forEach(function (row) {
      out.push('<Row ss:StyleID="wrap">' + row.map(cell).join('') + '</Row>');
    });

    out.push('</Table></Worksheet></Workbook>');
    return out.join('\n');
  }

  function toCsv(analyses) {
    var table = buildTable(analyses);
    function esc(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    return [table.headers.map(esc).join(',')]
      .concat(table.rows.map(function (r) { return r.map(esc).join(','); }))
      .join('\r\n');
  }

  function download(analyses, format) {
    var isCsv = format === 'csv';
    var content = isCsv ? toCsv(analyses) : toSpreadsheetXml(analyses);
    var type = isCsv ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel;charset=utf-8';
    var name = 'wcm-brief-analysis-' + new Date().toISOString().substring(0, 10) + (isCsv ? '.csv' : '.xls');

    var blob = new Blob(['﻿' + content], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return name;
  }

  return { HEADERS: HEADERS, buildTable: buildTable, toSpreadsheetXml: toSpreadsheetXml, toCsv: toCsv, download: download };
}));
