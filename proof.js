/* proof.js — the proofreading pass: spelling, lists, metadata.
 *
 * What a reviewer catches by reading the page, written down as rules:
 *
 *   spelling   a curated list of common misspellings, KONE product names
 *              written wrong (TransSys for TranSys), a word the page spells
 *              two ways (Commerical once, commercial five times), and UK and
 *              US spellings mixed on one page
 *   lists      numbering typed into FAQ questions, bullets typed as
 *              characters, lists written as separate paragraphs, sub-points
 *              flattened into their parent list, mixed end punctuation
 *   metadata   title length and a doubled site name, description length,
 *              keywords spacing, social-sharing tags, an empty search title,
 *              an H1 that shares no word with the title
 *
 * Honest about its limits: there is no dictionary — the tool ships no large
 * assets and makes no external requests — so a misspelling that is on no
 * list, and appears only once, is not caught. The curated and UK/US checks
 * run on English pages only; the "spelled two ways" check runs everywhere.
 *
 * Every finding: { group, verdict ('red'|'amber'), field, text, where,
 * suggestion, note }. Pure functions of the HTML; nothing is fetched.
 *
 * Runs in the browser (window.BriefProof) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriefProof = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    // Common English misspellings, and the ones an elevator page invites.
    misspellings: {
      commerical: 'commercial', comercial: 'commercial', comission: 'commission', commision: 'commission',
      accomodate: 'accommodate', accomodation: 'accommodation', acheive: 'achieve', acheived: 'achieved',
      accross: 'across', adress: 'address', agressive: 'aggressive', apparant: 'apparent', architecure: 'architecture',
      arguement: 'argument', availabe: 'available', availible: 'available', basicly: 'basically', begining: 'beginning',
      beleive: 'believe', buisness: 'business', calender: 'calendar', capabilty: 'capability', catagory: 'category',
      certian: 'certain', comfortible: 'comfortable', commited: 'committed', committment: 'commitment',
      completly: 'completely', concious: 'conscious', consistant: 'consistent', constuction: 'construction',
      contructor: 'contractor', convienient: 'convenient', definately: 'definitely', definitly: 'definitely',
      dependant: 'dependent', desing: 'design', developement: 'development', diffrent: 'different',
      disapear: 'disappear', effeciency: 'efficiency', efficency: 'efficiency', effecient: 'efficient',
      efficent: 'efficient', elevater: 'elevator', elavator: 'elevator', elevtor: 'elevator', embarass: 'embarrass',
      enviroment: 'environment', enviromental: 'environmental', equiment: 'equipment', equippment: 'equipment',
      escalater: 'escalator', esclator: 'escalator', existance: 'existence', experiance: 'experience',
      facilites: 'facilities', familar: 'familiar', finaly: 'finally', foward: 'forward', freind: 'friend',
      garantee: 'guarantee', gaurantee: 'guarantee', goverment: 'government', granted: 'granted', grammer: 'grammar',
      happend: 'happened', hieght: 'height', heigth: 'height', immediatly: 'immediately', independant: 'independent',
      infomation: 'information', informaton: 'information', installtion: 'installation', instalation: 'installation',
      intergrated: 'integrated', knowlege: 'knowledge', liason: 'liaison', libary: 'library', maintainance: 'maintenance',
      maintanance: 'maintenance', maintenence: 'maintenance', maintenace: 'maintenance', managment: 'management',
      millenium: 'millennium', minumum: 'minimum', mischievious: 'mischievous', modernisaton: 'modernisation',
      modernizaton: 'modernization', neccessary: 'necessary', necesary: 'necessary', noticable: 'noticeable',
      occassion: 'occasion', occured: 'occurred', occurence: 'occurrence', ocurred: 'occurred', oppurtunity: 'opportunity',
      opperation: 'operation', paralell: 'parallel', parliment: 'parliament', passanger: 'passenger', passengar: 'passenger',
      perfomance: 'performance', performace: 'performance', persistant: 'persistent', posession: 'possession',
      potentialy: 'potentially', prefered: 'preferred', preformance: 'performance', presense: 'presence',
      priviledge: 'privilege', probaly: 'probably', proffesional: 'professional', profesional: 'professional',
      publically: 'publicly', reccomend: 'recommend', recieve: 'receive', recieved: 'received', reconise: 'recognise',
      refered: 'referred', relevent: 'relevant', reliablity: 'reliability', remeber: 'remember', repitition: 'repetition',
      resistence: 'resistance', responsability: 'responsibility', resturant: 'restaurant', safty: 'safety',
      saftey: 'safety', schedual: 'schedule', seperate: 'separate', seperately: 'separately', sieze: 'seize',
      similiar: 'similar', sucess: 'success', succesful: 'successful', successfull: 'successful', supercede: 'supersede',
      suprise: 'surprise', sustainablity: 'sustainability', techology: 'technology', tecnology: 'technology',
      tommorow: 'tomorrow', tounge: 'tongue', truely: 'truly', untill: 'until', usefull: 'useful', vaccuum: 'vacuum',
      verticle: 'vertical', visable: 'visible', wierd: 'weird', wich: 'which', withold: 'withhold'
    },
    // KONE names as KONE writes them.
    brandTerms: ['TranSys', 'MonoSpace', 'MiniSpace', 'JumpLift', 'SiteFlow', 'UltraRope', 'EcoDisc', 'myKONE',
      'TravelMaster', 'TransitMaster', 'EcoMod', 'JumpLift', 'ProSpace', 'AddNew', 'DX Class', 'KONE Care',
      'E-Link', 'Polaris', 'InfoScreen'],
    // [US, UK]. Neither is wrong; using both on one page is.
    usUk: [['modernization', 'modernisation'], ['modernize', 'modernise'], ['modernized', 'modernised'],
      ['organization', 'organisation'], ['optimize', 'optimise'], ['optimized', 'optimised'], ['optimizing', 'optimising'],
      ['customize', 'customise'], ['customized', 'customised'], ['customizable', 'customisable'], ['analyze', 'analyse'],
      ['center', 'centre'], ['centers', 'centres'], ['color', 'colour'], ['colors', 'colours'], ['behavior', 'behaviour'],
      ['meter', 'metre'], ['meters', 'metres'], ['favor', 'favour'], ['labor', 'labour'], ['minimize', 'minimise'],
      ['maximize', 'maximise'], ['maximizes', 'maximises'], ['realize', 'realise'], ['utilize', 'utilise'],
      ['prioritize', 'prioritise'], ['recognize', 'recognise'], ['standardized', 'standardised'], ['visualize', 'visualise'],
      ['digitalization', 'digitalisation'], ['fiber', 'fibre'], ['gray', 'grey'], ['catalog', 'catalogue'],
      ['defense', 'defence'], ['aluminum', 'aluminium'], ['harmonize', 'harmonise'], ['personalized', 'personalised']],
    ignore: []
  };

  var STOP = {};
  ('the a an and or of for to in on at by with from your you our us we this that all is are be it its as into ' +
    'kone corporation').split(' ').forEach(function (w) { STOP[w] = true; });

  function merge(cfg) {
    cfg = cfg || {};
    var out = { misspellings: {}, brandTerms: [], usUk: DEFAULTS.usUk.concat(cfg.extraUsUk || []), ignore: {} };
    Object.keys(DEFAULTS.misspellings).forEach(function (k) { out.misspellings[k] = DEFAULTS.misspellings[k]; });
    Object.keys(cfg.extraMisspellings || {}).forEach(function (k) { out.misspellings[k.toLowerCase()] = cfg.extraMisspellings[k]; });
    DEFAULTS.brandTerms.concat(cfg.extraBrandTerms || []).forEach(function (b) {
      if (out.brandTerms.indexOf(b) === -1) out.brandTerms.push(b);
    });
    DEFAULTS.ignore.concat(cfg.ignore || []).forEach(function (w) { out.ignore[String(w).toLowerCase()] = true; });
    return out;
  }

  // ─── READING ────────────────────────────────────────────────────────────

  function decode(s) {
    return String(s).replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); });
  }
  function textOf(html) { return decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
  function clean(html) {
    return String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '');
  }

  // Headings, and the accordion questions that act as headings, with their
  // offsets — so every finding can say where on the page it is.
  function landmarks(html) {
    var out = [], m, re = /<(h[1-6]|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    while ((m = re.exec(html)) !== null) {
      if (m[1].toLowerCase() === 'button' && !/accordion-trigger/.test(m[2])) continue;
      var t = textOf(m[3]);
      if (t) out.push({ at: m.index, text: t, tag: m[1].toLowerCase() });
    }
    return out;
  }
  function whereAt(marks, at) {
    var last = null;
    for (var i = 0; i < marks.length && marks[i].at <= at; i++) last = marks[i];
    return last ? 'under "' + clip(last.text, 70) + '"' : 'near the top of the page';
  }
  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // Text runs between tags, each with its offset.
  function runs(html) {
    var out = [], re = /<[^>]*>/g, last = 0, m;
    while ((m = re.exec(html)) !== null) {
      if (m.index > last) push(html.slice(last, m.index), last);
      last = re.lastIndex;
    }
    if (last < html.length) push(html.slice(last), last);
    function push(raw, at) { var t = decode(raw).replace(/\s+/g, ' '); if (t.trim()) out.push({ text: t, at: at }); }
    return out;
  }

  // Optimal-string-alignment distance: a swapped pair of letters is one edit,
  // which is how "Commerical" sits one edit from "commercial".
  function distance(a, b) {
    var i, j, d = [];
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  // The two shapes a slip of the fingers takes that a real word rarely does:
  // two neighbouring letters swapped (Commerical / commercial), or a letter
  // doubled or undoubled (comittee / committee). A different letter in the
  // same place is not one of them — protects and projects are both words,
  // and so are impianto and impianti — so it is never flagged by frequency.
  function slip(a, b) {
    if (a.length === b.length) {
      var diff = [];
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
      return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]
        ? 'two letters swapped' : null;
    }
    var s = a.length < b.length ? a : b, l = a.length < b.length ? b : a;
    if (l.length !== s.length + 1) return null;
    for (var k = 0; k < l.length; k++) {
      if (l.slice(0, k) + l.slice(k + 1) === s) return k > 0 && l[k] === l[k - 1] || l[k] === l[k + 1] ? 'a letter doubled' : null;
    }
    return null;
  }

  var WORD = /[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’]*/g;

  // ─── SPELLING ───────────────────────────────────────────────────────────

  function spelling(html, cfgIn, ctx) {
    ctx = ctx || {};
    var cfg = merge(cfgIn);
    var region = clean(ctx.region != null ? ctx.region : html);
    var marks = landmarks(region);
    var english = ctx.english !== false;
    var words = [];
    runs(region).forEach(function (r) {
      var m;
      WORD.lastIndex = 0;
      while ((m = WORD.exec(r.text)) !== null) words.push({ word: m[0].replace(/['’]s$/, ''), at: r.at, text: r.text });
    });
    (ctx.extraText || []).forEach(function (t) {
      var m;
      WORD.lastIndex = 0;
      while ((m = WORD.exec(t.text)) !== null) words.push({ word: m[0], at: -1, text: t.text, label: t.label });
    });
    var counts = {};
    words.forEach(function (w) { var k = w.word.toLowerCase(); counts[k] = (counts[k] || 0) + 1; });

    var out = [], reported = {};
    function report(f, key) {
      if (reported[key]) return;
      reported[key] = true;
      out.push(f);
    }
    function where(w) { return w.label ? 'in the ' + w.label : whereAt(marks, w.at); }
    var brandLower = cfg.brandTerms.map(function (b) { return b.toLowerCase(); });

    words.forEach(function (w) {
      var lw = w.word.toLowerCase();
      if (cfg.ignore[lw]) return;
      // (a) on the list
      if (english && cfg.misspellings[lw]) {
        report({ group: 'spelling', verdict: 'red', field: 'Misspelling', text: w.word, where: where(w),
          suggestion: matchCase(w.word, cfg.misspellings[lw]), note: clip(w.text.trim(), 120) }, 'm:' + lw);
        return;
      }
      // (b) a KONE name written wrong
      if (w.word.length >= 5) {
        cfg.brandTerms.forEach(function (b, i) {
          if (b.indexOf(' ') !== -1 || w.word === b) return;
          var lb = brandLower[i];
          var d = lw === lb ? 0 : distance(lw, lb);
          if (d === 0 && /[A-Z]/.test(b.slice(1)) && w.word !== b && w.word.toLowerCase() !== w.word) {
            report({ group: 'spelling', verdict: 'amber', field: 'Product name', text: w.word, where: where(w),
              suggestion: b, note: 'KONE writes it ' + b }, 'b:' + w.word);
          } else if (d > 0 && d <= (lb.length >= 8 ? 2 : 1) && brandLower.indexOf(lw) === -1 && !counts[lw + 's'] && Math.abs(lw.length - lb.length) <= 1 &&
              lw.charAt(0) === lb.charAt(0)) {
            report({ group: 'spelling', verdict: 'red', field: 'Product name', text: w.word, where: where(w),
              suggestion: b, note: 'not how KONE spells it — ' + clip(w.text.trim(), 100) }, 'b:' + w.word);
          }
        });
      }
    });

    // (c) a word the page spells two ways — once one way, twice or more the other
    Object.keys(counts).forEach(function (k) {
      if (counts[k] !== 1 || k.length < 6 || cfg.ignore[k] || reported['m:' + k] || brandLower.indexOf(k) !== -1) return;
      var w = words.filter(function (x) { return x.word.toLowerCase() === k; })[0];
      if (reported['b:' + w.word]) return;
      var kind = null;
      var twin = Object.keys(counts).filter(function (o) {
        if (o === k || counts[o] < 2 || usUkPair(cfg, o, k)) return false;
        kind = slip(o, k);
        return !!kind;
      })[0];
      if (!twin) return;
      report({ group: 'spelling', verdict: 'amber', field: 'Possible typo', text: w.word, where: where(w),
        suggestion: matchCase(w.word, twin), note: 'the page writes "' + twin + '" ' + counts[twin] + ' times and "' + w.word + '" once (' + slip(twin, k) + ')' }, 'm:' + k);
    });

    // (d) UK and US spellings on one page
    if (english) {
      var us = [], uk = [];
      cfg.usUk.forEach(function (p) {
        if (counts[p[0]]) us.push(p[0]);
        if (counts[p[1]]) uk.push(p[1]);
      });
      if (us.length && uk.length) {
        out.push({ group: 'spelling', verdict: 'amber', field: 'Mixed spelling', text: us.concat(uk).join(', '), where: 'across the page',
          suggestion: null, note: 'US spellings (' + us.join(', ') + ') and UK spellings (' + uk.join(', ') + ') on one page — pick the market\'s convention' });
      }
    }
    return out;
  }

  function usUkPair(cfg, a, b) {
    return cfg.usUk.some(function (p) { return (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a); });
  }
  function matchCase(found, fix) {
    if (found === found.toUpperCase()) return fix.toUpperCase();
    if (found.charAt(0) === found.charAt(0).toUpperCase()) return fix.charAt(0).toUpperCase() + fix.slice(1);
    return fix;
  }

  // ─── LISTS & NUMBERING ──────────────────────────────────────────────────

  function lists(html) {
    var region = clean(html);
    var marks = landmarks(region);
    var out = [];
    var m;

    // Numbering typed into accordion questions or headings.
    var numbered = marks.filter(function (l) { return /^\d+[.)]\s/.test(l.text); });
    if (numbered.length) {
      var nums = numbered.map(function (l) { return parseInt(l.text, 10); });
      var gaps = nums.some(function (n, i) { return i > 0 && n !== nums[i - 1] + 1; });
      var kind = numbered[0].tag === 'button' ? 'FAQ questions' : 'headings';
      out.push({ group: 'lists', verdict: gaps ? 'red' : 'amber', field: 'Typed numbering', text: numbered.map(function (l) { return clip(l.text, 40); }).slice(0, 3).join(' · ') + (numbered.length > 3 ? ' …' : ''),
        where: whereAt(marks, numbered[0].at - 1), suggestion: 'remove "' + nums[0] + '. " … from the text',
        note: numbered.length + ' ' + kind + ' carry numbers typed into the text (' + nums.join(', ') + ')' + (gaps ? ' — and they skip or repeat' : '') +
          '. Numbers typed in break as soon as one is added, removed or reordered.' });
    }

    // Bullets typed as characters.
    var typed = [], bre = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    while ((m = bre.exec(region)) !== null) {
      var t = textOf(m[2]);
      if (/^[•·▪●◦‣]\s*|^[-–—]\s+/.test(t)) typed.push({ text: t, at: m.index });
    }
    if (typed.length) {
      out.push({ group: 'lists', verdict: 'amber', field: 'Typed bullets', text: clip(typed[0].text, 60), where: whereAt(marks, typed[0].at),
        suggestion: 'use a bulleted list', note: typed.length + ' paragraph' + (typed.length === 1 ? ' starts' : 's start') + ' with a typed bullet character' });
    }

    // A list written as separate paragraphs: "…types include:" and then
    // short, sentence-less paragraphs one after another.
    var paras = [], pre = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = pre.exec(region)) !== null) paras.push({ text: textOf(m[1]), at: m.index, end: pre.lastIndex });
    for (var i = 0; i < paras.length; i++) {
      if (!/:$/.test(paras[i].text)) continue;
      var items = [], j = i + 1;
      while (j < paras.length && /^\s*$/.test(region.slice(paras[j - 1].end, paras[j].at)) &&
             paras[j].text && paras[j].text.length <= 80 && !/[.!?]$/.test(paras[j].text)) {
        items.push(paras[j].text);
        j++;
      }
      if (items.length >= 2) {
        out.push({ group: 'lists', verdict: 'amber', field: 'List as paragraphs', text: paras[i].text, where: whereAt(marks, paras[i].at),
          suggestion: 'make "' + clip(items.join('", "'), 80) + '" a bulleted list',
          note: items.length + ' items written as separate paragraphs, not a list — screen readers and search engines read them as unrelated lines' });
        i = j - 1;
      }
    }

    // Innermost lists: flattened sub-points, mixed punctuation, typed numbers
    // inside <ol>, empty and single items.
    var lre = /<(ul|ol)\b([^>]*)>((?:(?!<\/?(?:ul|ol)\b)[\s\S])*?)<\/\1>/gi;
    while ((m = lre.exec(region)) !== null) {
      if (/breadcrumb/.test(m[2])) continue;
      var lis = [], lim, lire = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      while ((lim = lire.exec(m[3])) !== null) lis.push(textOf(lim[1]));
      var where = whereAt(marks, m.index);
      if (!lis.length) continue;
      var heads = lis.filter(function (t, k) { return /:$/.test(t) && k < lis.length - 1; });
      if (heads.length) {
        out.push({ group: 'lists', verdict: 'amber', field: 'Flattened list', text: heads.map(function (h) { return clip(h, 50); }).join(' · '), where: where,
          suggestion: 'nest the points under each of these as a sub-list',
          note: heads.length + ' item' + (heads.length === 1 ? ' ends' : 's end') + ' with ":" and the points that belong under ' + (heads.length === 1 ? 'it sit' : 'them sit') + ' beside them in the same list' });
      }
      var body = lis.filter(function (t) { return t && !/:$/.test(t); });
      var withStop = body.filter(function (t) { return /[.!?]$/.test(t); }).length;
      if (withStop && withStop < body.length && body.length >= 3) {
        out.push({ group: 'lists', verdict: 'amber', field: 'Mixed punctuation', text: clip(body[0], 60), where: where,
          suggestion: 'end every item the same way', note: withStop + ' of ' + body.length + ' items end with a full stop' });
      }
      if (m[1].toLowerCase() === 'ol' && lis.some(function (t) { return /^\d+[.)]\s/.test(t); })) {
        out.push({ group: 'lists', verdict: 'red', field: 'Double numbering', text: clip(lis[0], 60), where: where,
          suggestion: 'remove the typed numbers', note: 'a numbered list whose items also carry typed numbers shows each number twice' });
      }
      if (lis.some(function (t) { return !t; })) {
        out.push({ group: 'lists', verdict: 'amber', field: 'Empty list item', text: '(empty)', where: where, suggestion: 'remove it', note: 'an empty bullet' });
      }
      if (lis.length === 1 && !/accordion/.test(m[2])) {
        out.push({ group: 'lists', verdict: 'amber', field: 'Single-item list', text: clip(lis[0], 60), where: where,
          suggestion: 'a paragraph', note: 'a list with one item' });
      }
    }
    return out;
  }

  // ─── METADATA ───────────────────────────────────────────────────────────

  function metaContent(head, key) {
    var re = new RegExp('<meta\\b[^>]*(?:name|property)\\s*=\\s*["\']' + key.replace(/:/g, '\\:') + '["\'][^>]*>', 'i');
    var m = re.exec(head);
    if (!m) return null;
    var c = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0]);
    return c ? decode(c[1] !== undefined ? c[1] : c[2]) : '';
  }
  function words(s) {
    return String(s || '').toLowerCase().replace(/[™®©]/g, '').split(/[^a-z0-9à-ÿ]+/)
      .filter(function (w) { return w.length > 2 && !STOP[w]; })
      .map(function (w) { return w.replace(/s$/, ''); });
  }

  function metadata(html, ctx) {
    ctx = ctx || {};
    html = String(html || '');
    var headM = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
    var head = headM ? headM[1] : html;
    var out = [];
    function f(verdict, field, text, suggestion, note, where) {
      out.push({ group: 'metadata', verdict: verdict, field: field, text: text, where: where || 'page head', suggestion: suggestion, note: note });
    }

    // Everything wrong with the title in one row, with one proposed title.
    var tm = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head);
    var rawTitle = tm ? decode(tm[1]) : null;
    var title = rawTitle != null ? rawTitle.replace(/\s+/g, ' ').trim() : '';
    var issues = [], proposed = title;
    if (rawTitle != null && rawTitle !== rawTitle.trim()) issues.push('leading or trailing spaces');
    var doubled = /^(.*?)\s*[-–|]\s*KONE Corporation\s*[-–|]\s*KONE\s+(.+)$/i.exec(title);
    if (doubled) {
      proposed = doubled[1].trim() + ' - KONE ' + doubled[2].trim();
      issues.push('the site name appears twice ("KONE Corporation" and "KONE ' + doubled[2].trim() + '")');
    }
    if (title.length > 60) issues.push(title.length + ' characters, where search results show about 60' +
      (proposed !== title && proposed.length <= 60 ? '' : ' — shorten the page name'));
    if (issues.length) {
      f('amber', 'Title', rawTitle != null && rawTitle !== title ? JSON.stringify(rawTitle) : title,
        proposed !== title || rawTitle !== title ? proposed : null, issues.join('; '));
    }

    var desc = metaContent(head, 'description');
    if (desc == null || !desc.trim()) f('red', 'Meta description', '(none)', null, 'the page has no meta description');
    else if (desc.trim().length < 70 || desc.trim().length > 160) {
      f('amber', 'Meta description', desc.trim(), null, 'the description is ' + desc.trim().length + ' characters; aim for roughly 70–160');
    }

    var kw = metaContent(head, 'keywords');
    if (kw && (/\s,|,(?=\S)|\s$|^\s/.test(kw) || /,\s{2,}/.test(kw))) {
      var tidy = kw.split(',').map(function (k) { return k.trim(); }).filter(Boolean).join(', ');
      if (tidy !== kw) f('amber', 'Meta keywords', kw, tidy, 'stray spaces around the commas or at the ends');
    }

    var swift = /<meta\b[^>]*class\s*=\s*["']?SwifType["']?[^>]*name\s*=\s*["']title["'][^>]*>/i.exec(head) ||
      /<meta\b[^>]*name\s*=\s*["']title["'][^>]*class\s*=\s*["']?SwifType[^>]*>/i.exec(head);
    if (swift) {
      var sc = /content\s*=\s*["']([^"']*)["']/i.exec(swift[0]);
      if (!sc || !sc[1].trim()) f('amber', 'Search title', '(empty)', proposed || null, 'the site search\'s title meta (Swiftype) is empty, so search results fall back to whatever the crawler finds');
    }

    var ogUrl = metaContent(head, 'og:url');
    var canonical = ctx.canonical || null;
    if (ogUrl && canonical && ogUrl.replace(/\/+$/, '') !== canonical.replace(/\/+$/, '')) {
      f('amber', 'og:url', ogUrl, canonical, 'og:url and the canonical name different addresses');
    }
    var ogImage = metaContent(head, 'og:image');
    var twCard = metaContent(head, 'twitter:card');
    var twImage = metaContent(head, 'twitter:image');
    if (twCard === 'summary' && ogImage) {
      f('amber', 'twitter:card', 'summary', 'summary_large_image', 'the page has a share image, but the card type shows it as a small thumbnail');
    }
    if (twImage && ogImage && twImage !== ogImage) {
      f('amber', 'twitter:image', twImage, ogImage, 'X/Twitter and other networks are given different share images');
    }

    var h1m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(clean(ctx.region != null ? ctx.region : html));
    if (h1m) {
      var h1 = textOf(h1m[1]);
      if (/<br\s*\/?>/i.test(h1m[1])) {
        f('amber', 'H1', h1, h1, 'the H1 is broken over lines with <br>' + (/<br\s*\/?>\s*$/i.test(h1m[1].trim()) ? ', including a trailing one' : '') +
          ' — line breaks in a heading belong to styling, and read as run-together words in search results', 'the H1');
      }
      var tw = words(title.replace(/\s*[-–|]\s*KONE\b.*$/i, '')), hw = words(h1);
      if (tw.length && hw.length && !hw.some(function (w) { return tw.indexOf(w) !== -1; })) {
        f('amber', 'H1 and title', h1, null, 'the H1 shares no keyword with the title ("' + clip(title, 60) + '")', 'the H1');
      }
    }
    return out;
  }

  return { spelling: spelling, lists: lists, metadata: metadata, distance: distance, DEFAULTS: DEFAULTS };
}));
