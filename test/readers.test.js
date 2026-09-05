// test/readers.test.js — reading uploaded briefs.
// Run: npm test
//
// The fixtures are real ZIP bytes, assembled here with local file headers, a
// central directory and an EOCD record, then compressed with raw DEFLATE —
// exactly what Word and Excel emit. Testing against a mocked unzip would
// prove nothing about whether a real .docx opens.

var assert = require('assert');
var zlib = require('zlib');
var Readers = require('../readers.js');

var passed = 0, failed = 0;
function test(name, fn) {
  var done = function (err) {
    if (err) { failed++; console.log('  FAIL ' + name + '\n       ' + err.message); }
    else { passed++; console.log('  ok   ' + name); }
  };
  try {
    var r = fn();
    if (r && typeof r.then === 'function') return r.then(function () { done(); }, done);
    done();
  } catch (e) { done(e); }
  return Promise.resolve();
}

// ─── A minimal ZIP writer ────────────────────────────────────────────────

function zip(files) {
  var chunks = [], central = [], offset = 0;

  Object.keys(files).forEach(function (name) {
    var nameBuf = Buffer.from(name, 'utf8');
    var raw = Buffer.from(files[name], 'utf8');
    var deflated = zlib.deflateRawSync(raw);
    var crc = zlib.crc32 ? zlib.crc32(raw) : crc32(raw);

    var local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(8, 8);           // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    var dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);

    chunks.push(local, nameBuf, deflated);
    central.push(Buffer.concat([dir, nameBuf]));
    offset += local.length + nameBuf.length + deflated.length;
  });

  var centralBuf = Buffer.concat(central);
  var eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([Buffer.concat(chunks), centralBuf, eocd]);
}

var crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── FIXTURES ────────────────────────────────────────────────────────────

function para(text) { return '<w:p><w:r><w:t>' + text + '</w:t></w:r></w:p>'; }
function cell(text) { return '<w:tc><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:tc>'; }

var DOCX = zip({
  '[Content_Types].xml': '<Types/>',
  'word/document.xml':
    '<?xml version="1.0"?><w:document><w:body>' +
    para('Meta Title: Lift Safety Features | KONE India') +
    para('Meta Description: Learn about the key safety features.') +
    para('URL Path: https://www.kone.in/blog/lift-safety-features') +
    para('') +
    para('Emergency Braking Systems[2.1]') +
    para('These systems activate if the elevator exceeds its designated speed.') +
    '<w:tbl>' +
    '<w:tr>' + cell('Meta title') + cell('KONE MonoSpace 100 DX') + cell('KONE MonoSpace 100 DX dvigalo') + '</w:tr>' +
    '<w:tr>' + cell('Headline') + cell('Save space') + cell('Prihranite prostor') + '</w:tr>' +
    '</w:tbl>' +
    '</w:body></w:document>'
});

var XLSX = zip({
  '[Content_Types].xml': '<Types/>',
  'xl/sharedStrings.xml':
    '<sst><si><t>URL</t></si><si><t>Page Type</t></si><si><t>Priority</t></si>' +
    '<si><t>Primary Keyword</t></si><si><t>https://www.kone.com.au/</t></si>' +
    '<si><t>Homepage</t></si><si><t>High</t></si><si><t>Elevators and escalators Australia</t></si></sst>',
  'xl/worksheets/sheet1.xml':
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2" t="s"><v>6</v></c><c r="D2" t="s"><v>7</v></c></row>' +
    '</sheetData></worksheet>'
});

console.log('WCM Helper — brief reader verification\n');

var run = Promise.resolve();

run = run.then(function () {
  return test('1. a .docx opens and its paragraphs come back as lines', function () {
    return Readers.readDocx(new Uint8Array(DOCX)).then(function (text) {
      assert.ok(/Meta Title: Lift Safety Features \| KONE India/.test(text), 'got:\n' + text);
      assert.ok(/URL Path: https:\/\/www\.kone\.in\/blog\/lift-safety-features/.test(text));
      assert.ok(/Emergency Braking Systems\[2\.1\]/.test(text), 'section markers must survive');
    });
  });
});

run = run.then(function () {
  return test('2. a Word table comes back tab-separated, so the table playbooks can read it', function () {
    return Readers.readDocx(new Uint8Array(DOCX)).then(function (text) {
      assert.ok(/Meta title\tKONE MonoSpace 100 DX\tKONE MonoSpace 100 DX dvigalo/.test(text),
        'table rows should be tab separated, got:\n' + text);
      assert.ok(/Headline\tSave space\tPrihranite prostor/.test(text));
    });
  });
});

run = run.then(function () {
  return test('3. table cells are not also counted as loose paragraphs', function () {
    return Readers.readDocx(new Uint8Array(DOCX)).then(function (text) {
      var occurrences = text.split('Prihranite prostor').length - 1;
      assert.strictEqual(occurrences, 1, 'cell text appeared ' + occurrences + ' times');
    });
  });
});

run = run.then(function () {
  return test('4. an .xlsx comes back as tab-separated rows', function () {
    return Readers.readXlsx(new Uint8Array(XLSX)).then(function (text) {
      var lines = text.split('\n');
      assert.strictEqual(lines[0], 'URL\tPage Type\tPriority\tPrimary Keyword', 'got: ' + lines[0]);
      assert.strictEqual(lines[1], 'https://www.kone.com.au/\tHomepage\tHigh\tElevators and escalators Australia', 'got: ' + lines[1]);
    });
  });
});

run = run.then(function () {
  return test('5. a spreadsheet brief feeds the keyword playbook unchanged', function () {
    var BriefEngine = require('../engine.js');
    var fs = require('fs'), path = require('path');
    var engine = BriefEngine.create({
      'work-types': JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'work-types.json'), 'utf8'))
    });
    return Readers.readXlsx(new Uint8Array(XLSX)).then(function (text) {
      var a = engine.analyse(text);
      assert.strictEqual(a.workType.id, 'keyword-update', 'got ' + a.workType.id);
      assert.strictEqual(a.needs.missing.length, 0, 'should be complete: ' + JSON.stringify(a.needs.missing));
    });
  });
});

run = run.then(function () {
  return test('6. a .csv becomes tab-separated rows', function () {
    return Readers.readFile('keywords.csv', null, 'URL,Priority\nhttps://www.kone.com.au/,High')
      .then(function (text) {
        assert.strictEqual(text, 'URL\tPriority\nhttps://www.kone.com.au/\tHigh', 'got: ' + JSON.stringify(text));
      });
  });
});

run = run.then(function () {
  return test('7. plain text passes through untouched', function () {
    return Readers.readFile('brief.txt', null, 'Delete this paragraph.').then(function (text) {
      assert.strictEqual(text, 'Delete this paragraph.');
    });
  });
});

run = run.then(function () {
  return test('8. an old binary .doc is refused with a usable message', function () {
    return Readers.readFile('brief.doc', null, '').then(function () {
      throw new Error('should have been rejected');
    }, function (err) {
      assert.ok(/Save it as \.docx/.test(err.message), 'got: ' + err.message);
    });
  });
});

run = run.then(function () {
  return test('9. paste damage is reported against the brief, not the page', function () {
    var warnings = Readers.briefWarnings('● First bullet\n● Second bullet');
    assert.ok(warnings.some(function (w) { return /literal ● characters/.test(w); }), 'got: ' + JSON.stringify(warnings));

    var mso = Readers.briefWarnings('<!--[if !supportLists]--><span style="mso-list:Ignore">1.</span>');
    assert.ok(mso.some(function (w) { return /Word markup/.test(w); }), 'got: ' + JSON.stringify(mso));

    assert.deepStrictEqual(Readers.briefWarnings('A clean brief with nothing wrong.'), [],
      'a clean brief should raise nothing');
  });
});

run.then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
});
